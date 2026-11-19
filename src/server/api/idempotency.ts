/**
 * Idempotency for POST requests (`Idempotency-Key` header), on the `idempotency_keys` table.
 *
 *   same key, same request   → the stored response is returned again (`Idempotent-Replayed: true`)
 *   same key, other request  → 409 (`idempotency_key_reused`)
 *   same key while the first request is still running → 409 (`idempotency_request_in_progress`)
 *
 * The claim is one `insert … on conflict do nothing` on the (org, key) unique index, so of any number of concurrent
 * requests with one key exactly one runs. Keys are scoped to the organization and the mode and expire after
 * IDEMPOTENCY_TTL_MS. Stored responses are field-encrypted: a create response carries a family link, a credential.
 */
import { and, eq, isNull, lte } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { addMs, now } from "@/lib/clock";
import { decryptJson, encryptJson, sha256Hex } from "@/lib/crypto";
import { badRequest, conflict } from "@/lib/errors";
import { newToken } from "@/lib/ids";
import { IDEMPOTENCY_IN_FLIGHT_TIMEOUT_MS, IDEMPOTENCY_KEY_PATTERN, IDEMPOTENCY_RESPONSE_PURPOSE, IDEMPOTENCY_TTL_MS } from "./policy";

const t = schema.idempotencyKeys;

export type IdempotencyStart = { kind: "proceed"; recordId: string } | { kind: "replay"; status: number; body: unknown };

export interface IdempotencyRequest {
  orgId: string;
  mode: Mode;
  /** The raw header value. */
  key: string;
  method: string;
  path: string;
  /** The parsed JSON body (null when there was none). */
  body: unknown;
}

/** JSON with object keys sorted at every level, so key order and whitespace do not make two requests differ. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function validateIdempotencyKey(raw: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(raw)) throw badRequest("Idempotency-Key must be 1 to 255 printable ASCII characters without spaces.", { reason: "invalid_idempotency_key" });
  return raw;
}

function keyHash(orgId: string, mode: Mode, key: string): string {
  return sha256Hex(`ecca-idempotency-v1\n${orgId}\n${mode}\n${key}`);
}

function requestHash(method: string, path: string, body: unknown): string {
  return sha256Hex(`${method.toUpperCase()}\n${path}\n${stableStringify(body ?? null)}`);
}

interface StoredBody {
  v: 1;
  enc: string;
}

function seal(body: unknown): StoredBody {
  return { v: 1, enc: encryptJson(body, IDEMPOTENCY_RESPONSE_PURPOSE) };
}

function open(stored: Record<string, unknown> | null): unknown {
  if (!stored || stored.v !== 1 || typeof stored.enc !== "string") return null;
  return decryptJson(stored.enc, IDEMPOTENCY_RESPONSE_PURPOSE);
}

const reused = () =>
  conflict("This Idempotency-Key was already used for a different request. Use a new key for a new request.", { reason: "idempotency_key_reused" });
const inProgress = () => conflict("A request with this Idempotency-Key is still being processed. Retry shortly.", { reason: "idempotency_request_in_progress" });

/**
 * Claims the key for this request, or reports what the earlier request with the same key produced. Call
 * `completeIdempotentRequest` with the response once the handler has finished, or `releaseIdempotentRequest` when it
 * failed in a way worth retrying (a 5xx), so the client may retry with the same key.
 */
export async function beginIdempotentRequest(req: IdempotencyRequest, dbOrTx?: DbOrTx): Promise<IdempotencyStart> {
  const key = validateIdempotencyKey(req.key);
  const db = dbOrTx ?? (await getDb());
  const kh = keyHash(req.orgId, req.mode, key);
  const rh = requestHash(req.method, req.path, req.body);

  // Three rounds cover the two state changes another request can make between our statements (an expired row being
  // removed, an abandoned one being taken over); anything busier than that is, by definition, in progress.
  for (let round = 0; round < 3; round++) {
    const at = now();
    const [claimed] = await db
      .insert(t)
      .values({ id: `idk_${newToken(16)}`, orgId: req.orgId, keyHash: kh, method: req.method.toUpperCase(), path: req.path, requestHash: rh, createdAt: at, expiresAt: addMs(at, IDEMPOTENCY_TTL_MS) })
      .onConflictDoNothing({ target: [t.orgId, t.keyHash] })
      .returning({ id: t.id });
    if (claimed) return { kind: "proceed", recordId: claimed.id };

    const [existing] = await db
      .select()
      .from(t)
      .where(and(eq(t.orgId, req.orgId), eq(t.keyHash, kh)))
      .limit(1);
    if (!existing) continue;
    if (existing.expiresAt.getTime() <= at.getTime()) {
      await db.delete(t).where(and(eq(t.id, existing.id), lte(t.expiresAt, at)));
      continue;
    }
    if (existing.requestHash !== rh) throw reused();
    if (existing.responseStatus === null) {
      const cutoff = addMs(at, -IDEMPOTENCY_IN_FLIGHT_TIMEOUT_MS);
      if (existing.createdAt.getTime() > cutoff.getTime()) throw inProgress();
      const [taken] = await db
        .update(t)
        .set({ createdAt: at, expiresAt: addMs(at, IDEMPOTENCY_TTL_MS) })
        .where(and(eq(t.id, existing.id), isNull(t.responseStatus), lte(t.createdAt, cutoff)))
        .returning({ id: t.id });
      if (taken) return { kind: "proceed", recordId: taken.id };
      continue;
    }
    return { kind: "replay", status: existing.responseStatus, body: open(existing.responseBody) };
  }
  throw inProgress();
}

/** Stores the response of a claimed request so retries get it back. */
export async function completeIdempotentRequest(recordId: string, status: number, body: unknown, dbOrTx?: DbOrTx): Promise<void> {
  const db = dbOrTx ?? (await getDb());
  await db
    .update(t)
    .set({ responseStatus: status, responseBody: seal(body) as unknown as Record<string, unknown> })
    .where(eq(t.id, recordId));
}

/** Forgets a claimed request that did not finish usefully, so the client may retry with the same key. */
export async function releaseIdempotentRequest(recordId: string, dbOrTx?: DbOrTx): Promise<void> {
  const db = dbOrTx ?? (await getDb());
  await db.delete(t).where(and(eq(t.id, recordId), isNull(t.responseStatus)));
}

/** Deletes expired keys and returns how many. Safe to run from several workers. */
export async function purgeExpiredIdempotencyKeys(dbOrTx?: DbOrTx): Promise<number> {
  const db = dbOrTx ?? (await getDb());
  const removed = await db.delete(t).where(lte(t.expiresAt, now())).returning({ id: t.id });
  return removed.length;
}
