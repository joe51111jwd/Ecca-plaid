import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { listAuditLogs } from "@/server/audit";
import { makeBusiness, makeSgo } from "@/server/handoffs/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { beginIdempotentRequest, completeIdempotentRequest, purgeExpiredIdempotencyKeys, stableStringify } from "./idempotency";
import { revokeApiKey } from "./keys";
import { API_RATE_LIMIT, IDEMPOTENCY_IN_FLIGHT_TIMEOUT_MS, MAX_JSON_BODY_BYTES } from "./policy";
import { apiRoute } from "./route";
import { errorSchema, verificationCreatedSchema } from "./schemas";
import { callApi, callJson, makeKey, TEST_ORIGIN } from "./test-support";

const T0 = "2026-11-18T16:00:00.000Z";
const noParams = { params: Promise.resolve({}) };

function request(path: string, init: RequestInit & { key?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.key) headers.set("authorization", `Bearer ${init.key}`);
  return new Request(`${TEST_ORIGIN}/api/v1${path}`, { ...init, headers });
}

describe("apiRoute", () => {
  useTestDb();
  let sgo: string;
  let key: string;
  beforeEach(async () => {
    setTestNow(T0);
    sgo = await makeSgo("Synthetic Route Fund");
    key = await makeKey(sgo, "test");
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("answers every bad key with one uniform 401 body, a request id and no-store", async () => {
      const revoked = await makeKey(sgo, "test", "to revoke");
      const db = await getDb();
      const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, "to revoke"));
      await revokeApiKey(sgo, keys[0].id, { type: "system", reason: "test" });
      const bodies = new Set<string>();
      for (const authorization of [undefined, "Bearer nope", `Bearer ecca_test_${"x".repeat(43)}`, `Bearer ${revoked}`, `Basic ${key}`]) {
        const res = await callApi("GET", "/me", authorization === undefined ? { key: null } : { authorization });
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe('Bearer realm="api"');
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("x-request-id")).toMatch(/^req_/);
        const body = (await res.json()) as { error: { request_id: string } };
        expect(errorSchema.safeParse(body).success).toBe(true);
        expect(body.error.request_id).toBe(res.headers.get("x-request-id"));
        bodies.add(JSON.stringify({ ...body.error, request_id: "" }));
      }
      expect(bodies.size).toBe(1);
    });

    it("refuses a key of the wrong organization type with 403 and a stable reason", async () => {
      const business = await makeBusiness();
      const businessKey = await makeKey(business.orgId, "test");
      const res = await callJson<{ error: { code: string; details: { reason: string } } }>("GET", "/verifications", { key: businessKey });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "forbidden", details: { reason: "wrong_organization_type" } });
      const back = await callJson<{ error: { code: string } }>("GET", "/handoffs", { key });
      expect(back.status).toBe(403);
    });
  });

  describe("rate limits", () => {
    it("sends RateLimit headers on every authenticated response and 429 with Retry-After past the limit", async () => {
      const first = await callApi("GET", "/me", { key });
      expect(first.headers.get("ratelimit-limit")).toBe(String(API_RATE_LIMIT.limit));
      expect(first.headers.get("ratelimit-remaining")).toBe(String(API_RATE_LIMIT.limit - 1));
      expect(first.headers.get("ratelimit-reset")).toBe("60");
      // Errors after authentication carry them too.
      const notFound = await callApi("GET", "/verifications/ver_missing", { key });
      expect(notFound.status).toBe(404);
      expect(notFound.headers.get("ratelimit-remaining")).toBe(String(API_RATE_LIMIT.limit - 2));

      const db = await getDb();
      // Fast-forward the window's count instead of sending 600 requests.
      await db.update(schema.rateLimits).set({ count: API_RATE_LIMIT.limit });
      const limited = await callApi("GET", "/me", { key });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(limited.headers.get("ratelimit-remaining")).toBe("0");
      expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");

      // The limit is per key: another key of the same organization is unaffected.
      const other = await makeKey(sgo, "test", "second");
      expect((await callApi("GET", "/me", { key: other })).status).toBe(200);
      setTestNow("2026-11-18T16:01:00.000Z");
      expect((await callApi("GET", "/me", { key })).status).toBe(200);
    });
  });

  describe("input", () => {
    it("reports validation errors as 422 with snake_case field names and unknown fields", async () => {
      const res = await callJson<{ error: { code: string; details: { fields: Record<string, string> } } }>("POST", "/verifications", {
        key,
        body: { applicant_email: "not-an-email", send_invite: true, student: { first_name: 7 }, surprise: true },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(Object.keys(res.body.error.details.fields).sort()).toEqual(["student.first_name", "surprise"]);

      // Service-level validation (after the schema) is mapped to the API's names as well.
      const svc = await callJson<{ error: { details: { fields: Record<string, string> } } }>("POST", "/verifications", { key, body: { applicant_email: "not-an-email" } });
      expect(svc.status).toBe(422);
      expect(Object.keys(svc.body.error.details.fields)).toEqual(["applicant_email"]);
      const invite = await callJson<{ error: { details: { fields: Record<string, string> } } }>("POST", "/verifications", { key, body: { send_invite: true } });
      expect(Object.keys(invite.body.error.details.fields)).toEqual(["applicant_email"]);
      const ret = await callJson<{ error: { details: { fields: Record<string, string> } } }>("POST", "/verifications", { key, body: { return_url: "http://evil.example/x" } });
      expect(Object.keys(ret.body.error.details.fields)).toEqual(["return_url"]);
    });

    it("refuses bad bodies and query strings with clear 400/422 answers", async () => {
      const cases: Array<[string, Parameters<typeof callApi>[2], number, string?]> = [
        ["/verifications", { key, rawBody: "{not json", headers: { "content-type": "application/json" } }, 400, "invalid_json"],
        ["/verifications", { key, rawBody: '{"external_ref":"x"}', headers: { "content-type": "text/plain" } }, 400, "unsupported_content_type"],
        ["/verifications", { key, rawBody: JSON.stringify({ external_ref: "x".repeat(MAX_JSON_BODY_BYTES) }), headers: { "content-type": "application/json" } }, 400, "body_too_large"],
        ["/verifications", { key, body: [1, 2] }, 422],
        ["/verifications", { key, body: "text" }, 422],
      ];
      for (const [path, opts, status, reason] of cases) {
        const res = await callJson<{ error: { details?: { reason?: string } } }>("POST", path, opts);
        expect(res.status, reason).toBe(status);
        if (reason) expect(res.body.error.details?.reason).toBe(reason);
      }
      expect((await callJson("GET", "/verifications?limit=0", { key })).status).toBe(422);
      expect((await callJson("GET", "/verifications?limit=abc", { key })).status).toBe(422);
      expect((await callJson("GET", "/verifications?limit=101", { key })).status).toBe(422);
      expect((await callJson("GET", "/verifications?status=approved", { key })).status).toBe(422);
      const unknown = await callJson<{ error: { details: { fields: Record<string, string> } } }>("GET", "/verifications?colour=red", { key });
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.details.fields).toEqual({ colour: "Unknown query parameter." });
      expect((await callJson<{ error: { details: { reason: string } } }>("GET", "/verifications?limit=1&limit=2", { key })).body.error.details.reason).toBe("duplicate_query_parameter");
      expect((await callJson("GET", "/me?x=1", { key })).status).toBe(422);
      // A body on a route that takes none.
      const ver = await callJson<{ id: string }>("POST", "/verifications", { key, body: {} });
      expect((await callJson("POST", `/verifications/${ver.body.id}/cancel`, { key, body: { reason: "x" } })).status).toBe(422);
      expect((await callJson("POST", `/verifications/${ver.body.id}/cancel`, { key, body: {} })).status).toBe(200);
    });

    it("treats an impossible id as not found without echoing it", async () => {
      const res = await callJson<{ error: { code: string; message: string } }>("GET", `/verifications/${encodeURIComponent("<script>")}`, { key });
      expect(res.status).toBe(404);
      expect(res.body.error.message).not.toContain("script");
    });
  });

  describe("errors", () => {
    it("never leaks a stack trace or an exception message", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const route = apiRoute({
        orgTypes: ["sgo"],
        handler: async () => {
          throw new Error("SECRET internal detail at /srv/app/db.ts:42");
        },
      });
      const res = await route(request("/x", { key }), noParams);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("db.ts");
      expect(JSON.parse(text)).toMatchObject({ error: { code: "internal", message: "Something went wrong" } });
      expect(spy).toHaveBeenCalled();
    });

    it("passes AppError details through and adds headers from the handler", async () => {
      const route = apiRoute({
        orgTypes: ["sgo"],
        query: z.strictObject({ n: z.string().optional() }),
        handler: async (ctx) => {
          if (ctx.query.n === "boom") throw new AppError("conflict", "Nope", { reason: "synthetic" });
          return { status: 202, body: { ok: true }, headers: { "X-Extra": "1" } };
        },
      });
      const ok = await route(request("/x", { key }), noParams);
      expect(ok.status).toBe(202);
      expect(ok.headers.get("x-extra")).toBe("1");
      const err = await route(request("/x?n=boom", { key }), noParams);
      expect(await err.json()).toMatchObject({ error: { code: "conflict", message: "Nope", details: { reason: "synthetic" } } });
    });
  });

  describe("audit", () => {
    it("audits successful mutating calls with the key, the request id and the target, but not reads", async () => {
      const res = await callApi("POST", "/verifications", { key, body: { external_ref: "AUD-1" }, headers: { "x-forwarded-for": "198.51.100.4", "user-agent": "synthetic-client/1.0" } });
      const body = (await res.json()) as { id: string };
      const logs = await listAuditLogs({ orgId: sgo, action: "api.verification.create" });
      expect(logs.items).toHaveLength(1);
      expect(logs.items[0]).toMatchObject({ actorType: "api_key", targetType: "verification", targetId: body.id, ip: "198.51.100.4", userAgent: "synthetic-client/1.0" });
      expect(logs.items[0].metadata).toMatchObject({ mode: "test", requestId: res.headers.get("x-request-id"), method: "POST", status: 201 });
      expect(JSON.stringify(logs.items[0])).not.toContain("/v/");

      await callApi("GET", "/verifications", { key });
      expect((await listAuditLogs({ orgId: sgo })).items.some((l) => l.action.startsWith("api.") && l.action !== "api.verification.create")).toBe(false);
      // A refused mutation is not recorded as one.
      await callApi("POST", "/verifications", { key, body: { applicant_email: "nope" } });
      expect((await listAuditLogs({ orgId: sgo, action: "api.verification.create" })).items).toHaveLength(1);
    });
  });
});

describe("idempotency", () => {
  useTestDb();
  let sgo: string;
  let key: string;
  beforeEach(async () => {
    setTestNow(T0);
    sgo = await makeSgo("Synthetic Idempotency Fund");
    key = await makeKey(sgo, "test");
  });
  afterEach(() => setTestNow(null));

  const create = (idem: string, body: Record<string, unknown> = { external_ref: "IDEM-1" }, k = key) => callApi("POST", "/verifications", { key: k, body, headers: { "Idempotency-Key": idem } });

  it("replays the stored response for the same key and body, without acting twice", async () => {
    const first = await create("k-1");
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(verificationCreatedSchema.safeParse(firstBody).success).toBe(true);
    const again = await create("k-1", { external_ref: "IDEM-1" });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await again.json()).toEqual(firstBody);
    const db = await getDb();
    expect(await db.select().from(schema.verifications).where(eq(schema.verifications.orgId, sgo))).toHaveLength(1);
    // Key order and whitespace do not make a different request.
    const reordered = await callApi("POST", "/verifications", { key, rawBody: '{ "external_ref" : "IDEM-1" }', headers: { "Idempotency-Key": "k-1", "content-type": "application/json" } });
    expect(reordered.status).toBe(201);
  });

  it("stores responses encrypted (the family link is a credential)", async () => {
    const first = (await (await create("k-enc")).json()) as { family_url: string };
    const db = await getDb();
    const rows = await db.select().from(schema.idempotencyKeys);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(first.family_url.split("/v/")[1]);
    expect(rows[0].keyHash).not.toContain("k-enc");
  });

  it("answers the same key with a different body, path or mode with 409 idempotency_key_reused / separately scoped", async () => {
    await create("k-2");
    const other = await create("k-2", { external_ref: "DIFFERENT" });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: { code: "conflict", details: { reason: "idempotency_key_reused" } } });
    // Same key on another endpoint is a different request too.
    const endpoint = await callApi("POST", "/webhook_endpoints", { key, body: { url: "https://hooks.example.org/x" }, headers: { "Idempotency-Key": "k-2" } });
    expect(endpoint.status).toBe(409);
    // Keys are scoped per mode and per organization.
    const liveKey = await makeKey(sgo, "live");
    expect((await create("k-2", { external_ref: "DIFFERENT" }, liveKey)).status).toBe(201);
    const otherOrgKey = await makeKey(await makeSgo("Synthetic Other Fund"), "test");
    expect((await create("k-2", { external_ref: "DIFFERENT" }, otherOrgKey)).status).toBe(201);
  });

  it("lets exactly one of many concurrent requests with one key run; the rest replay or see 409 in progress", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => create("k-race")));
    const statuses = responses.map((r) => r.status);
    const created = responses.filter((r) => r.status === 201 && r.headers.get("idempotent-replayed") !== "true");
    expect(created).toHaveLength(1);
    for (const r of responses) {
      if (r.status === 409) expect(await r.json()).toMatchObject({ error: { details: { reason: "idempotency_request_in_progress" } } });
      else expect(r.status).toBe(201);
    }
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const db = await getDb();
    expect(await db.select().from(schema.verifications).where(eq(schema.verifications.orgId, sgo))).toHaveLength(1);
  });

  it("reports an in-flight duplicate as 409, and lets a retry take over an abandoned request", async () => {
    const start = await beginIdempotentRequest({ orgId: sgo, mode: "test", key: "k-flight", method: "POST", path: "/api/v1/verifications", body: { external_ref: "F" } });
    expect(start.kind).toBe("proceed");
    const dup = await create("k-flight", { external_ref: "F" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { details: { reason: "idempotency_request_in_progress" } } });
    setTestNow(new Date(new Date(T0).getTime() + IDEMPOTENCY_IN_FLIGHT_TIMEOUT_MS));
    const retry = await create("k-flight", { external_ref: "F" });
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBeNull();
  });

  it("remembers deterministic refusals, forgets crashes, and expires keys after 24 hours", async () => {
    const refused = await create("k-refused", { applicant_email: 5 });
    expect(refused.status).toBe(422);
    // Schema-level validation runs before the key is claimed: nothing stored, the client may fix and reuse the key.
    expect(await (await getDb()).select().from(schema.idempotencyKeys)).toHaveLength(0);
    const fixed = await create("k-refused", { applicant_email: "parent@synthetic.example" });
    expect(fixed.status).toBe(201);
    // A service-level refusal happens after the claim and is remembered.
    expect((await create("k-svc", { applicant_email: "nope" })).status).toBe(422);
    const svcReplay = await create("k-svc", { applicant_email: "nope" });
    expect(svcReplay.status).toBe(422);
    expect(svcReplay.headers.get("idempotent-replayed")).toBe("true");

    // A refusal from the service (after the claim) is remembered and replayed.
    const ver = (await (await create("k-c1", { external_ref: "C" })).json()) as { id: string };
    await callApi("POST", `/verifications/${ver.id}/cancel`, { key });
    const cancelAgain = await callApi("POST", `/verifications/${ver.id}/cancel`, { key, headers: { "Idempotency-Key": "k-cancel" } });
    expect(cancelAgain.status).toBe(409);
    const replay = await callApi("POST", `/verifications/${ver.id}/cancel`, { key, headers: { "Idempotency-Key": "k-cancel" } });
    expect(replay.status).toBe(409);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");

    setTestNow("2026-11-19T16:00:00.001Z");
    const afterExpiry = await create("k-1-expiring", { external_ref: "E" });
    expect(afterExpiry.status).toBe(201);
    expect(await purgeExpiredIdempotencyKeys()).toBeGreaterThan(0);
  });

  it("releases the key when the handler crashes, so the client can retry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const route = apiRoute({
      orgTypes: ["sgo"],
      body: z.strictObject({ n: z.number() }),
      handler: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { status: 201, body: { ok: calls } };
      },
    });
    const send = () => route(request("/x", { key, method: "POST", body: JSON.stringify({ n: 1 }), headers: { "content-type": "application/json", "idempotency-key": "k-crash" } }), noParams);
    expect((await send()).status).toBe(500);
    const second = await send();
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ ok: 2 });
    const third = await send();
    expect(third.headers.get("idempotent-replayed")).toBe("true");
    expect(await third.json()).toEqual({ ok: 2 });
    spy.mockRestore();
  });

  it("rejects malformed keys", async () => {
    for (const bad of ["has space", "x".repeat(256), "ünïcode"]) {
      const res = await create(bad);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toMatchObject({ error: { details: { reason: "invalid_idempotency_key" } } });
    }
  });

  it("canonicalizes bodies for comparison", async () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: null }], u: undefined })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
    expect(stableStringify(null)).toBe("null");
    const s = await beginIdempotentRequest({ orgId: sgo, mode: "test", key: "unit", method: "post", path: "/p", body: { a: 1 } });
    if (s.kind !== "proceed") throw new Error("expected proceed");
    await completeIdempotentRequest(s.recordId, 200, { hello: "world" });
    expect(await beginIdempotentRequest({ orgId: sgo, mode: "test", key: "unit", method: "POST", path: "/p", body: { a: 1 } })).toEqual({ kind: "replay", status: 200, body: { hello: "world" } });
  });
});
