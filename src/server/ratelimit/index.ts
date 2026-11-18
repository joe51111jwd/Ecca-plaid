import { eq, lte, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { MS, now } from "@/lib/clock";
import { deriveKey, hmacSha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

/**
 * Fixed-window rate limiting on the `rate_limits` table.
 *
 *   await enforceRateLimit(`magic-link:email:${email}`, { limit: 5, windowMs: 15 * MS.minute });
 *   const r = await rateLimit(`api:${apiKeyId}`, { limit: 600, windowMs: MS.minute });   // r.allowed, r.remaining, r.resetAt
 *
 * A window starts at a key's first request and lasts `windowMs`; the next request after it ends starts a
 * new window. The count is taken with one atomic upsert, so concurrent callers can never be granted more
 * than `limit` requests in a window, on any number of app instances.
 *
 * Call it BEFORE opening a transaction (or pass that transaction): on the embedded single-connection
 * database a query outside an open transaction waits for the transaction to finish. Note that a count taken
 * inside a transaction is undone if the transaction rolls back.
 */

export interface RateLimitOptions {
  /** Requests allowed per window (integer ≥ 1). */
  limit: number;
  /** Window length in milliseconds (1 … RATE_LIMIT_MAX_WINDOW_MS). */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (0 when denied). */
  remaining: number;
  /** When the current window ends and the count starts over. */
  resetAt: Date;
  /** Whole seconds until `resetAt` when denied; 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Longest window a limiter may use. Rows do not record their window length, so the purge can only remove
 * rows that are expired for every possible window: those older than this.
 */
export const RATE_LIMIT_MAX_WINDOW_MS = 7 * MS.day;

const MAX_KEY_LENGTH = 512;
const MAX_LIMIT = 1_000_000;
const INT4_MAX = 2_147_483_647;

/**
 * Test/demo switch, never honoured in production (same contract as the clock overrides in src/lib/clock):
 * `ECCA_DISABLE_RATE_LIMITS=true` makes every check pass without touching the database. End-to-end suites
 * sign the same few people in dozens of times, often under a frozen ECCA_FAKE_NOW where a window never ends.
 */
function rateLimitsDisabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const v = process.env.ECCA_DISABLE_RATE_LIMITS;
  return v === "true" || v === "1";
}

/**
 * Row key for a limiter key. Limiter keys routinely contain email addresses and IP addresses; only a keyed
 * hash (HMAC under a sub-key of the master key) is stored. A plain SHA-256 would not do: the whole IPv4 space
 * and any list of known emails can be hashed in minutes, so an unkeyed digest is the address in disguise.
 */
export function rateLimitStorageKey(key: string): string {
  return hmacSha256(deriveKey("ratelimit-key"), `ecca-ratelimit-v2:${key}`).toString("hex");
}

function check(key: string, opts: RateLimitOptions): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new AppError("internal", "Rate limit key must be a non-empty string of at most 512 characters");
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > MAX_LIMIT) {
    throw new AppError("internal", `Rate limit "limit" must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(opts.windowMs) || opts.windowMs < 1 || opts.windowMs > RATE_LIMIT_MAX_WINDOW_MS) {
    throw new AppError("internal", `Rate limit "windowMs" must be an integer between 1 and ${RATE_LIMIT_MAX_WINDOW_MS}`);
  }
}

/** Counts one request against `key` and reports whether it is within the limit. Denied requests count too. */
export async function rateLimit(key: string, opts: RateLimitOptions, dbOrTx?: DbOrTx): Promise<RateLimitResult> {
  check(key, opts);
  const at = now();
  if (rateLimitsDisabled()) {
    return { allowed: true, limit: opts.limit, remaining: opts.limit, resetAt: new Date(at.getTime() + opts.windowMs), retryAfterSeconds: 0 };
  }

  const t = schema.rateLimits;
  const nowTs = sql`${at.toISOString()}::timestamptz`;
  // A stored window is over once it started at or before (now − windowMs). A window that appears to start in
  // the future (clock skew between instances) is treated as current: resetting it would hand out extra requests.
  const windowOver = sql`${t.windowStart} <= ${new Date(at.getTime() - opts.windowMs).toISOString()}::timestamptz`;

  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .insert(t)
    .values({ key: rateLimitStorageKey(key), windowStart: at, count: 1 })
    .onConflictDoUpdate({
      target: t.key,
      // Both expressions read the row as it was before this statement, under the row lock the upsert takes.
      set: {
        count: sql`case when ${windowOver} then 1 else least(${t.count}, ${INT4_MAX - 1}) + 1 end`,
        windowStart: sql`case when ${windowOver} then ${nowTs} else ${t.windowStart} end`,
      },
    })
    .returning({ count: t.count, windowStart: t.windowStart });

  const resetAt = new Date(row.windowStart.getTime() + opts.windowMs);
  const allowed = row.count <= opts.limit;
  return {
    allowed,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - row.count),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - at.getTime()) / MS.second)),
  };
}

function humanDuration(seconds: number): string {
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`;
  if (seconds < 60) return unit(Math.max(1, seconds), "second");
  if (seconds < 3600) return unit(Math.ceil(seconds / 60), "minute");
  if (seconds < 48 * 3600) return unit(Math.ceil(seconds / 3600), "hour");
  return unit(Math.ceil(seconds / 86_400), "day");
}

export interface EnforceRateLimitOptions extends RateLimitOptions {
  /** Start of the error sentence shown to the person. Default "Too many attempts." */
  message?: string;
}

/**
 * Like `rateLimit`, but throws `AppError("rate_limited")` (HTTP 429) with a message a person can act on, e.g.
 * "Too many attempts. Please try again in 12 minutes." `details` carries `{ retryAfterSeconds, resetAt, limit }`.
 */
export async function enforceRateLimit(key: string, opts: EnforceRateLimitOptions, dbOrTx?: DbOrTx): Promise<RateLimitResult> {
  const result = await rateLimit(key, { limit: opts.limit, windowMs: opts.windowMs }, dbOrTx);
  if (!result.allowed) {
    const lead = (opts.message ?? "Too many attempts.").trim();
    throw new AppError("rate_limited", `${lead} Please try again in ${humanDuration(result.retryAfterSeconds)}.`, {
      retryAfterSeconds: result.retryAfterSeconds,
      resetAt: result.resetAt.toISOString(),
      limit: result.limit,
    });
  }
  return result;
}

/** Response headers for an API reply (`RateLimit-*` fields, plus `Retry-After` when denied). */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((result.resetAt.getTime() - now().getTime()) / MS.second))),
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}

/** Forgets a key's count, e.g. clearing a failed-attempt counter after a successful sign-in. */
export async function resetRateLimit(key: string, dbOrTx?: DbOrTx): Promise<void> {
  const db = dbOrTx ?? (await getDb());
  await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key, rateLimitStorageKey(key)));
}

/**
 * Deletes rows whose window ended for every possible limiter (older than RATE_LIMIT_MAX_WINDOW_MS) and
 * returns how many were removed. Safe to run at any time and from several workers; meant to be scheduled
 * (hourly is plenty) by the job runner.
 */
export async function purgeExpiredRateLimits(dbOrTx?: DbOrTx): Promise<number> {
  const db = dbOrTx ?? (await getDb());
  const cutoff = new Date(now().getTime() - RATE_LIMIT_MAX_WINDOW_MS);
  const removed = await db.delete(schema.rateLimits).where(lte(schema.rateLimits.windowStart, cutoff)).returning({ key: schema.rateLimits.key });
  return removed.length;
}
