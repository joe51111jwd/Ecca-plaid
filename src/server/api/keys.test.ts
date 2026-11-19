import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { addMember, makeBusiness, makeSgo, makeUser } from "@/server/handoffs/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { authenticateApiKey, createApiKey, hasActiveLiveKey, listApiKeys, orgAllowsMode, parseBearer, revokeApiKey, UNAUTHENTICATED_MESSAGE } from "./keys";
import { API_KEY_PATTERN, MAX_ACTIVE_KEYS_PER_MODE } from "./policy";

const SYSTEM = { type: "system", reason: "keys test" } as const;
const T0 = "2026-11-18T16:00:00.000Z";

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

const req = (authorization?: string, ip = "203.0.113.9") => new Request("http://localhost/api/v1/me", { headers: { ...(authorization !== undefined ? { authorization } : {}), "x-forwarded-for": ip } });

describe("API keys", () => {
  useTestDb();
  beforeEach(() => setTestNow(T0));
  afterEach(() => setTestNow(null));

  it("creates a key shown once, stores only its hash and a display prefix, and audits it", async () => {
    const org = await makeSgo();
    const { apiKey, secret } = await createApiKey(org, { name: "  Applicant   system ", mode: "test" }, SYSTEM);
    expect(secret).toMatch(API_KEY_PATTERN);
    expect(secret.startsWith("ecca_test_")).toBe(true);
    expect(secret.length).toBe("ecca_test_".length + 43);
    expect(apiKey).toMatchObject({ orgId: org, name: "Applicant system", mode: "test", revokedAt: null, lastUsedAt: null });
    expect(apiKey.prefix).toBe(secret.slice(0, "ecca_test_".length + 6));
    expect(JSON.stringify(apiKey)).not.toContain(secret.slice(16));

    const [row] = await (await getDb()).select().from(schema.apiKeys).where(eq(schema.apiKeys.id, apiKey.id));
    expect(row.keyHash).toBe(hashToken(secret));
    expect(JSON.stringify(row)).not.toContain(secret);

    const logs = await listAuditLogs({ orgId: org, action: "api_key.create" });
    expect(logs.items).toHaveLength(1);
    expect(JSON.stringify(logs.items[0])).not.toContain(secret);
  });

  it("generates distinct keys and live keys with the live prefix", async () => {
    const org = await makeSgo();
    const a = await createApiKey(org, { name: "a", mode: "live" }, SYSTEM);
    const b = await createApiKey(org, { name: "b", mode: "live" }, SYSTEM);
    expect(a.secret.startsWith("ecca_live_")).toBe(true);
    expect(a.secret).not.toBe(b.secret);
    expect(await hasActiveLiveKey(org)).toBe(true);
  });

  it("validates the name and the mode", async () => {
    const org = await makeSgo();
    expect((await errorOf(createApiKey(org, { name: "   ", mode: "test" }, SYSTEM))).code).toBe("validation_failed");
    expect((await errorOf(createApiKey(org, { name: "x".repeat(101), mode: "test" }, SYSTEM))).code).toBe("validation_failed");
    expect((await errorOf(createApiKey(org, { name: "bad\u0007name", mode: "test" }, SYSTEM))).code).toBe("validation_failed");
    expect((await errorOf(createApiKey(org, { name: "k", mode: "prod" as never }, SYSTEM))).code).toBe("validation_failed");
    expect((await errorOf(createApiKey(org, { name: "k", mode: "test", extra: 1 } as never, SYSTEM))).code).toBe("validation_failed");
  });

  it("refuses live keys for organizations not approved for live mode, keeps test keys for pending ones", async () => {
    const org = await makeSgo();
    const db = await getDb();
    await db.update(schema.organizations).set({ status: "pending" }).where(eq(schema.organizations.id, org));
    expect((await errorOf(createApiKey(org, { name: "live", mode: "live" }, SYSTEM))).code).toBe("forbidden");
    await expect(createApiKey(org, { name: "test", mode: "test" }, SYSTEM)).resolves.toBeTruthy();
    await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, org));
    expect((await errorOf(createApiKey(org, { name: "test", mode: "test" }, SYSTEM))).code).toBe("forbidden");
    expect(orgAllowsMode("active", "live")).toBe(true);
    expect(orgAllowsMode("pending", "live")).toBe(false);
    expect(orgAllowsMode("pending", "test")).toBe(true);
    expect(orgAllowsMode("suspended", "test")).toBe(false);
  });

  it("checks the manager: admins and platform admins may, viewers and strangers may not", async () => {
    const org = await makeSgo();
    const admin = await makeUser();
    const viewer = await makeUser();
    const stranger = await makeUser();
    await addMember(org, admin, "admin");
    await addMember(org, viewer, "viewer");
    await expect(createApiKey(org, { name: "k", mode: "test" }, { type: "user", userId: admin })).resolves.toBeTruthy();
    expect((await errorOf(createApiKey(org, { name: "k", mode: "test" }, { type: "user", userId: viewer }))).code).toBe("forbidden");
    expect((await errorOf(createApiKey(org, { name: "k", mode: "test" }, { type: "user", userId: stranger }))).code).toBe("forbidden");
    expect((await errorOf(createApiKey(org, { name: "k", mode: "test" }, { type: "user", userId: "usr_missing" }))).code).toBe("forbidden");
    expect((await errorOf(createApiKey(org, { name: "k", mode: "test" }, { type: "system", reason: " " }))).code).toBe("forbidden");

    const db = await getDb();
    const platform = newId("org");
    await db.insert(schema.organizations).values({ id: platform, type: "platform", name: "Platform (synthetic)", slug: `platform-${platform.slice(-6).toLowerCase()}` });
    const platformAdmin = await makeUser();
    await addMember(platform, platformAdmin, "owner");
    await expect(createApiKey(org, { name: "k", mode: "test" }, { type: "user", userId: platformAdmin })).resolves.toBeTruthy();
    // The platform organization itself has no API surface.
    expect((await errorOf(createApiKey(platform, { name: "k", mode: "test" }, SYSTEM))).code).toBe("forbidden");
    expect((await errorOf(createApiKey("org_missing", { name: "k", mode: "test" }, SYSTEM))).code).toBe("not_found");
  });

  it("caps active keys per mode, counting concurrent creations correctly", async () => {
    const org = await makeSgo();
    const results = await Promise.allSettled(Array.from({ length: MAX_ACTIVE_KEYS_PER_MODE + 3 }, (_, i) => createApiKey(org, { name: `k${i}`, mode: "test" }, SYSTEM)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_ACTIVE_KEYS_PER_MODE);
    expect(results.filter((r) => r.status === "rejected").every((r) => isAppError((r as PromiseRejectedResult).reason) && (r as PromiseRejectedResult).reason.code === "conflict")).toBe(true);
    // The live cap is separate.
    await expect(createApiKey(org, { name: "live", mode: "live" }, SYSTEM)).resolves.toBeTruthy();
    const keys = await listApiKeys(org, { mode: "test", activeOnly: true });
    await revokeApiKey(org, keys[0].id, SYSTEM);
    await expect(createApiKey(org, { name: "again", mode: "test" }, SYSTEM)).resolves.toBeTruthy();
  });

  it("lists newest first, filters, and revokes idempotently within the organization only", async () => {
    const org = await makeSgo();
    const other = await makeSgo();
    const first = await createApiKey(org, { name: "first", mode: "test" }, SYSTEM);
    setTestNow("2026-11-18T16:01:00.000Z");
    const second = await createApiKey(org, { name: "second", mode: "live" }, SYSTEM);
    expect((await listApiKeys(org)).map((k) => k.id)).toEqual([second.apiKey.id, first.apiKey.id]);
    expect((await listApiKeys(org, { mode: "live" })).map((k) => k.id)).toEqual([second.apiKey.id]);
    expect(await listApiKeys(other)).toEqual([]);

    expect((await errorOf(revokeApiKey(other, first.apiKey.id, SYSTEM))).code).toBe("not_found");
    const revoked = await revokeApiKey(org, first.apiKey.id, SYSTEM);
    expect(revoked.revokedAt).toEqual(new Date("2026-11-18T16:01:00.000Z"));
    setTestNow("2026-11-18T16:05:00.000Z");
    expect((await revokeApiKey(org, first.apiKey.id, SYSTEM)).revokedAt).toEqual(revoked.revokedAt);
    expect((await listAuditLogs({ orgId: org, action: "api_key.revoke" })).items).toHaveLength(1);
    expect((await listApiKeys(org, { activeOnly: true })).map((k) => k.id)).toEqual([second.apiKey.id]);
    expect((await errorOf(listApiKeys(org, { mode: "x" as never }))).code).toBe("validation_failed");
  });
});

describe("parseBearer", () => {
  it("accepts only well-formed secret keys", () => {
    const key = `ecca_test_${"A".repeat(43)}`;
    expect(parseBearer(`Bearer ${key}`)).toEqual({ key, mode: "test" });
    expect(parseBearer(`bearer ${key}`)).toEqual({ key, mode: "test" });
    expect(parseBearer(`Bearer ecca_live_${"b".repeat(43)}`)?.mode).toBe("live");
    for (const bad of [null, undefined, "", key, `Basic ${key}`, `Bearer`, `Bearer ecca_prod_${"A".repeat(43)}`, `Bearer ecca_test_short`, `Bearer pk_test_${"A".repeat(32)}`, `Bearer ${key} extra`, `Bearer ${key}\n`, `Bearer ${"x".repeat(400)}`]) {
      expect(parseBearer(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe("authenticateApiKey", () => {
  useTestDb();
  beforeEach(() => setTestNow(T0));
  afterEach(() => setTestNow(null));

  it("authenticates a valid key and refreshes last_used_at at most once a minute", async () => {
    const org = await makeSgo();
    const { secret, apiKey } = await createApiKey(org, { name: "k", mode: "test" }, SYSTEM);
    const auth = await authenticateApiKey(req(`Bearer ${secret}`));
    expect(auth).toMatchObject({ mode: "test", apiKeyId: apiKey.id, org: { id: org, type: "sgo" }, request: { ip: "203.0.113.9" } });
    const lastUsed = async () => (await (await getDb()).select().from(schema.apiKeys).where(eq(schema.apiKeys.id, apiKey.id)))[0].lastUsedAt;
    expect(await lastUsed()).toEqual(new Date(T0));
    setTestNow("2026-11-18T16:00:59.000Z");
    await authenticateApiKey(req(`Bearer ${secret}`));
    expect(await lastUsed()).toEqual(new Date(T0));
    setTestNow("2026-11-18T16:01:00.000Z");
    await authenticateApiKey(req(`Bearer ${secret}`));
    expect(await lastUsed()).toEqual(new Date("2026-11-18T16:01:00.000Z"));
  });

  it("gives missing, malformed, unknown, revoked and mode-mismatched keys the same 401", async () => {
    const org = await makeSgo();
    const { secret, apiKey } = await createApiKey(org, { name: "k", mode: "test" }, SYSTEM);
    const revoked = await createApiKey(org, { name: "r", mode: "test" }, SYSTEM);
    await revokeApiKey(org, revoked.apiKey.id, SYSTEM);
    // A key whose text says live but whose stored mode is test (cannot be issued; checked anyway).
    const db = await getDb();
    const forgedLive = `ecca_live_${secret.slice("ecca_test_".length)}`;
    await db.update(schema.apiKeys).set({ keyHash: hashToken(forgedLive) }).where(eq(schema.apiKeys.id, apiKey.id));

    const attempts = [undefined, "", "Bearer", `Token ${secret}`, `Bearer ecca_test_${"Z".repeat(43)}`, `Bearer ${revoked.secret}`, `Bearer ${forgedLive}`, `Bearer ${secret}`];
    for (const authorization of attempts) {
      const e = await errorOf(authenticateApiKey(req(authorization)));
      expect(e, String(authorization)).toEqual({ code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE, details: undefined });
    }
  });

  it("returns 403 for suspended organizations and for live keys of organizations not approved for live", async () => {
    const org = await makeBusiness();
    const live = await createApiKey(org.orgId, { name: "live", mode: "live" }, SYSTEM);
    const test = await createApiKey(org.orgId, { name: "test", mode: "test" }, SYSTEM);
    const db = await getDb();
    await db.update(schema.organizations).set({ status: "pending" }).where(eq(schema.organizations.id, org.orgId));
    expect((await errorOf(authenticateApiKey(req(`Bearer ${live.secret}`)))).code).toBe("forbidden");
    await expect(authenticateApiKey(req(`Bearer ${test.secret}`))).resolves.toMatchObject({ mode: "test" });
    await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, org.orgId));
    expect((await errorOf(authenticateApiKey(req(`Bearer ${test.secret}`)))).code).toBe("forbidden");
  });

  it("rate-limits repeated failures per client address", async () => {
    const bad = `Bearer ecca_test_${"Q".repeat(43)}`;
    let last = "";
    for (let i = 0; i < 125; i++) last = (await errorOf(authenticateApiKey(req(bad, "198.51.100.77")))).code;
    expect(last).toBe("rate_limited");
    // Another address is unaffected.
    expect((await errorOf(authenticateApiKey(req(bad, "198.51.100.78")))).code).toBe("unauthenticated");
  });
});
