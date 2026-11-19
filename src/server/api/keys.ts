/**
 * Secret API keys: one organization, one mode each. The full key is returned exactly once, by createApiKey; only
 * `hashToken(key)` and a short display prefix are stored. Authentication looks the hash up (a unique index), so the
 * comparison of secrets happens inside an equality lookup on a hash rather than on the secret itself.
 */
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode, OrgStatus, OrgType } from "@/db/schema";
import { addMs, now } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId, newToken } from "@/lib/ids";
import { audit, normalizeIp, requestInfoFromHeaders, type AuditRequestInfo } from "@/server/audit";
import { assertOrgMember, isPlatformAdmin } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import {
  API_KEY_DISPLAY_CHARS,
  API_KEY_NAME_MAX,
  API_KEY_PATTERN,
  API_KEY_PREFIX,
  API_KEY_RANDOM_BYTES,
  AUTH_FAILURE_RATE_LIMIT,
  LAST_USED_WRITE_INTERVAL_MS,
  LIVE_KEY_ORG_STATUSES,
  MAX_ACTIVE_KEYS_PER_MODE,
  TEST_KEY_ORG_STATUSES,
} from "./policy";

type ApiKeyRow = typeof schema.apiKeys.$inferSelect;
export type Organization = typeof schema.organizations.$inferSelect;

/** Organization types that may hold API keys. The platform organization has no API surface. */
export const API_ORG_TYPES: readonly OrgType[] = ["sgo", "business"];

/** Least role that may create or revoke keys from the dashboard. */
export const API_KEY_MANAGER_ROLE = "admin" as const;

/** A key as shown in the dashboard. There is deliberately no hash and no secret field. */
export interface ApiKeySummary {
  id: string;
  orgId: string;
  name: string;
  /** e.g. "ecca_test_AbC123" — enough to recognize a key, useless to use it. */
  prefix: string;
  mode: Mode;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Who manages keys: a signed-in member (role-checked here) or trusted server code (seed scripts). */
export type ApiKeyActor = { type: "user"; userId: string; request?: AuditRequestInfo | null } | { type: "system"; reason: string };

function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    prefix: row.prefix,
    mode: row.mode,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/** Whether an organization in `status` may use keys of `mode`. */
export function orgAllowsMode(status: OrgStatus, mode: Mode): boolean {
  const allowed: readonly OrgStatus[] = mode === "live" ? LIVE_KEY_ORG_STATUSES : TEST_KEY_ORG_STATUSES;
  return allowed.includes(status);
}

async function loadApiOrg(db: DbOrTx, orgId: string): Promise<Organization> {
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 128) throw notFound("Organization");
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org) throw notFound("Organization");
  if (!API_ORG_TYPES.includes(org.type)) throw forbidden("Only scholarship organizations and businesses can hold API keys.");
  return org;
}

async function authorizeManager(db: DbOrTx, orgId: string, actor: ApiKeyActor): Promise<{ auditActor: { type: "user" | "system"; id: string | null }; request: AuditRequestInfo | null; createdBy: string }> {
  if (!actor || typeof actor !== "object") throw forbidden();
  if (actor.type === "system") {
    if (typeof actor.reason !== "string" || actor.reason.trim() === "") throw forbidden();
    return { auditActor: { type: "system", id: null }, request: null, createdBy: `system:${actor.reason.trim().slice(0, 80)}` };
  }
  if (actor.type !== "user" || typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
  if (!user) throw forbidden();
  if (!(await isPlatformAdmin(user.id, db))) await assertOrgMember(user, orgId, API_KEY_MANAGER_ROLE, db);
  return { auditActor: { type: "user", id: user.id }, request: actor.request ?? null, createdBy: user.id };
}

const createSchema = z.strictObject({
  name: z
    .string("Give the key a name.")
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Give the key a name.").max(API_KEY_NAME_MAX, `Keep the name under ${API_KEY_NAME_MAX} characters.`))
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "The name contains control characters."),
  mode: z.enum(["test", "live"], "mode must be test or live"),
});

/** First half of the two-int advisory lock key ("APIK") that serializes key creation per organization. */
const KEY_CAP_LOCK_NAMESPACE = 0x4150494b;

/**
 * Creates a key and returns it in full. This is the only time the secret exists outside the caller's hands: show it
 * now, it cannot be retrieved later. Live keys only for organizations allowed live mode (see LIVE_KEY_ORG_STATUSES).
 * Audited as `api_key.create`.
 */
export async function createApiKey(orgId: string, input: { name: string; mode: Mode }, actor: ApiKeyActor, dbOrTx?: DbOrTx): Promise<{ apiKey: ApiKeySummary; secret: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "input")] ??= issue.message;
    throw invalid(Object.values(fields)[0] ?? "The key request is not valid.", { fields });
  }
  const { name, mode } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const org = await loadApiOrg(tx, orgId);
    const who = await authorizeManager(tx, org.id, actor);
    if (!orgAllowsMode(org.status, mode)) {
      throw forbidden(mode === "live" ? "Live keys are available once your organization is approved. Test keys work now." : "This organization cannot create API keys.");
    }
    await tx.execute(sql`select pg_advisory_xact_lock(${KEY_CAP_LOCK_NAMESPACE}::int4, hashtext(${org.id}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.orgId, org.id), eq(schema.apiKeys.mode, mode), isNull(schema.apiKeys.revokedAt)));
    if (n >= MAX_ACTIVE_KEYS_PER_MODE) throw conflict(`An organization can have at most ${MAX_ACTIVE_KEYS_PER_MODE} active ${mode} keys. Revoke one to add another.`);

    const random = newToken(API_KEY_RANDOM_BYTES);
    const secret = `${API_KEY_PREFIX[mode]}${random}`;
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({
        id: newId("apiKey"),
        orgId: org.id,
        name,
        prefix: `${API_KEY_PREFIX[mode]}${random.slice(0, API_KEY_DISPLAY_CHARS)}`,
        keyHash: hashToken(secret),
        mode,
        createdBy: who.createdBy,
        createdAt: now(),
      })
      .returning();
    await audit({ actor: who.auditActor, orgId: org.id, action: "api_key.create", target: { type: "api_key", id: row.id }, metadata: { mode, prefix: row.prefix, name }, request: who.request }, tx);
    return { apiKey: toSummary(row), secret };
  });
}

/** The organization's keys, newest first. Revoked keys are included unless `activeOnly`. Callers guard access first. */
export async function listApiKeys(orgId: string, opts: { mode?: Mode; activeOnly?: boolean } = {}, dbOrTx?: DbOrTx): Promise<ApiKeySummary[]> {
  if (opts.mode !== undefined && opts.mode !== "test" && opts.mode !== "live") throw invalid("mode must be test or live");
  const db = dbOrTx ?? (await getDb());
  const k = schema.apiKeys;
  const rows = await db
    .select()
    .from(k)
    .where(and(eq(k.orgId, orgId), opts.mode ? eq(k.mode, opts.mode) : undefined, opts.activeOnly ? isNull(k.revokedAt) : undefined))
    .orderBy(desc(k.createdAt), desc(k.id));
  return rows.map(toSummary);
}

/**
 * Revokes a key: it stops working on the next request. Revoking a revoked key returns it unchanged. Another
 * organization's key is not found. Audited as `api_key.revoke`.
 */
export async function revokeApiKey(orgId: string, keyId: string, actor: ApiKeyActor, dbOrTx?: DbOrTx): Promise<ApiKeySummary> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const org = await loadApiOrg(tx, orgId);
    const who = await authorizeManager(tx, org.id, actor);
    if (typeof keyId !== "string" || keyId.length === 0 || keyId.length > 128) throw notFound("API key");
    const [row] = await tx
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.orgId, org.id)))
      .for("update");
    if (!row) throw notFound("API key");
    if (row.revokedAt) return toSummary(row);
    const [updated] = await tx.update(schema.apiKeys).set({ revokedAt: now() }).where(eq(schema.apiKeys.id, row.id)).returning();
    await audit({ actor: who.auditActor, orgId: org.id, action: "api_key.revoke", target: { type: "api_key", id: row.id }, metadata: { mode: row.mode, prefix: row.prefix }, request: who.request }, tx);
    return toSummary(updated);
  });
}

/* ------------------------------------------------------------------------------------ authentication */

/** The authenticated caller of an API request. */
export interface ApiAuth {
  org: Organization;
  mode: Mode;
  apiKeyId: string;
  apiKey: ApiKeySummary;
  request: AuditRequestInfo;
}

/** One message for every authentication failure, so a caller learns nothing about which keys exist. */
export const UNAUTHENTICATED_MESSAGE = "Invalid or missing API key. Send a secret key as: Authorization: Bearer ecca_test_…";

/** The key in an `Authorization: Bearer …` header, or null when the header is missing or malformed. */
export function parseBearer(header: string | null | undefined): { key: string; mode: Mode } | null {
  if (typeof header !== "string" || header.length > 300) return null;
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  if (!m) return null;
  const key = m[1];
  const parsed = API_KEY_PATTERN.exec(key);
  if (!parsed) return null;
  return { key, mode: parsed[1] as Mode };
}

async function failAuthentication(request: AuditRequestInfo): Promise<never> {
  const ip = normalizeIp(request.ip ?? null) ?? "unknown";
  const limited = await rateLimit(`api:auth-failure:${ip}`, AUTH_FAILURE_RATE_LIMIT);
  if (!limited.allowed) {
    throw new AppError("rate_limited", "Too many requests with an invalid API key. Slow down and check the key.", { retryAfterSeconds: limited.retryAfterSeconds });
  }
  throw new AppError("unauthenticated", UNAUTHENTICATED_MESSAGE);
}

/**
 * Authenticates a request by its `Authorization: Bearer ecca_…` header. Missing, malformed, unknown and revoked keys
 * all get the same 401 (`unauthenticated`). A key of a suspended organization, or a live key of an organization not
 * allowed live mode, gets 403. `last_used_at` is refreshed at most once per LAST_USED_WRITE_INTERVAL_MS.
 */
export async function authenticateApiKey(request: Request, dbOrTx?: DbOrTx): Promise<ApiAuth> {
  const info = requestInfoFromHeaders(request.headers);
  const bearer = parseBearer(request.headers.get("authorization"));
  if (!bearer) return failAuthentication(info);

  const db = dbOrTx ?? (await getDb());
  const [found] = await db
    .select({ key: schema.apiKeys, org: schema.organizations })
    .from(schema.apiKeys)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.apiKeys.orgId))
    .where(eq(schema.apiKeys.keyHash, hashToken(bearer.key)))
    .limit(1);
  // The mode in the key text must match the stored mode: a hash collision across prefixes is impossible, but the
  // check keeps the two sources of truth from ever disagreeing silently.
  if (!found || found.key.revokedAt !== null || found.key.mode !== bearer.mode) return failAuthentication(info);

  const { key, org } = found;
  if (!API_ORG_TYPES.includes(org.type)) return failAuthentication(info);
  if (org.status === "suspended") throw forbidden("This organization's API access is suspended. Contact support.");
  if (!orgAllowsMode(org.status, key.mode)) throw forbidden("Live keys work once your organization is approved. Use a test key until then.");

  const at = now();
  if (!key.lastUsedAt || key.lastUsedAt.getTime() <= at.getTime() - LAST_USED_WRITE_INTERVAL_MS) {
    // Conditional so concurrent requests write once; the result is not needed.
    await db
      .update(schema.apiKeys)
      .set({ lastUsedAt: at })
      .where(and(eq(schema.apiKeys.id, key.id), or(isNull(schema.apiKeys.lastUsedAt), lte(schema.apiKeys.lastUsedAt, addMs(at, -LAST_USED_WRITE_INTERVAL_MS)))));
    key.lastUsedAt = at;
  }
  return { org, mode: key.mode, apiKeyId: key.id, apiKey: toSummary(key), request: info };
}

/** Whether the organization holds at least one active live key (see WEBHOOK_WRITE_NEEDS_LIVE_KEY_ONCE_LIVE). */
export async function hasActiveLiveKey(orgId: string, dbOrTx?: DbOrTx): Promise<boolean> {
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .select({ id: schema.apiKeys.id })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.orgId, orgId), eq(schema.apiKeys.mode, "live"), isNull(schema.apiKeys.revokedAt)))
    .orderBy(asc(schema.apiKeys.createdAt))
    .limit(1);
  return Boolean(row);
}
