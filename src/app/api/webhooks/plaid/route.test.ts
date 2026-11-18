import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { createPlaidRail, setRailProviderForTests } from "@/server/rails";
import { fakePlaidFetch, makeWebhookSigner, signJwt } from "@/server/rails/test-support";
import { useTestDb } from "../../../../../tests/helpers/db";
import { POST } from "./route";

// SYNTHETIC keys and ids only.

const T0 = "2026-11-18T15:00:00Z";
const NOW_S = Math.floor(Date.parse(T0) / 1000);

function body(userId = "usr_synthetic") {
  return JSON.stringify({ webhook_type: "INCOME", webhook_code: "USER_INCOME_VERIFICATION", item_id: "item_1", user_id: userId, verification_status: "VERIFICATION_STATUS_PROCESSING_COMPLETE", environment: "sandbox" }, null, 2);
}

function post(raw: string, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/webhooks/plaid", { method: "POST", body: raw, headers: { "content-type": "application/json", ...headers } }));
}

describe("POST /api/webhooks/plaid", () => {
  useTestDb();
  const signer = makeWebhookSigner("kid-route", NOW_S - 3600);
  let plaid: ReturnType<typeof fakePlaidFetch>;

  beforeEach(() => {
    setTestNow(T0);
    plaid = fakePlaidFetch({ "/webhook_verification_key/get": () => ({ json: { key: signer.key } }) });
    setRailProviderForTests("plaid", createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: plaid.fetch }));
  });
  afterEach(() => {
    setTestNow(null);
    setRailProviderForTests("plaid", null);
  });

  it("answers 401 to an unsigned or forged webhook and records nothing", async () => {
    const res = await post(body());
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const forged = await post(body(), { "plaid-verification": "eyJhbGciOiJub25lIn0.eyJpYXQiOjF9.x" });
    expect(forged.status).toBe(401);
    const db = await getDb();
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
    expect(await db.select().from(schema.auditLogs)).toHaveLength(0);
  });

  it("answers 401 when the body was changed after signing", async () => {
    const jwt = signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid }, { iat: NOW_S, request_body_sha256: sha256Hex(body()) });
    const res = await post(body("usr_other"), { "plaid-verification": jwt });
    expect(res.status).toBe(401);
  });

  it("answers 200 to a verified webhook, even when it names no connection", async () => {
    const raw = body();
    const jwt = signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid }, { iat: NOW_S, request_body_sha256: sha256Hex(raw) });
    const res = await post(raw, { "plaid-verification": jwt });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "ignored" });
  });

  it("answers 413 to an oversized body without reading it", async () => {
    const res = await post("x".repeat(70_000));
    expect(res.status).toBe(413);
    expect(plaid.calls).toHaveLength(0);
  });

  it("answers 413 to a streamed body with no Content-Length once it passes the limit, without buffering the rest", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(16_000).fill(120);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/webhooks/plaid", { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(plaid.calls).toHaveLength(0);
  });

  it("answers 503 when Plaid is not configured", async () => {
    setRailProviderForTests("plaid", null);
    const saved = { id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET };
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    try {
      const res = await post(body());
      expect(res.status).toBe(503);
    } finally {
      if (saved.id !== undefined) process.env.PLAID_CLIENT_ID = saved.id;
      if (saved.secret !== undefined) process.env.PLAID_SECRET = saved.secret;
    }
  });
});
