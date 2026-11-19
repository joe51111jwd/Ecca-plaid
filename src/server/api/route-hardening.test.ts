import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { makeSgo } from "@/server/handoffs/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { MAX_JSON_BODY_BYTES } from "./policy";
import { callApi, makeKey, TEST_ORIGIN } from "./test-support";

/** Lets a test make the API layer's own audit write fail once, standing in for a database hiccup after the handler. */
const auditFailure = vi.hoisted(() => ({ action: null as string | null }));

vi.mock("@/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return {
    ...actual,
    audit: (async (...args: Parameters<typeof actual.audit>) => {
      if (auditFailure.action !== null && args[0].action === auditFailure.action) {
        auditFailure.action = null;
        throw new Error("synthetic audit outage");
      }
      return actual.audit(...args);
    }) as typeof actual.audit,
  };
});

describe("apiRoute hardening", () => {
  useTestDb();
  let sgo: string;
  let key: string;
  beforeEach(async () => {
    setTestNow("2026-11-18T16:00:00.000Z");
    sgo = await makeSgo("Synthetic Hardening Fund");
    key = await makeKey(sgo, "test");
  });
  afterEach(() => {
    setTestNow(null);
    auditFailure.action = null;
    vi.restoreAllMocks();
  });

  it("stops reading a chunked body without Content-Length at the size limit instead of buffering it whole", async () => {
    const { POST } = await import("@/app/api/v1/verifications/route");
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    // An endless body: the old arrayBuffer() read never returned.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`${TEST_ORIGIN}/api/v1/verifications`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(request.headers.get("content-length")).toBeNull();
    const res = await POST(request, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("body_too_large");
    expect(pulled).toBeLessThan(MAX_JSON_BODY_BYTES + 4 * chunk.byteLength);
  });

  it("still accepts a chunked body under the limit", async () => {
    const { POST } = await import("@/app/api/v1/verifications/route");
    const bytes = new TextEncoder().encode(JSON.stringify({ external_ref: "CHUNKED-1" }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 5));
        controller.enqueue(bytes.slice(5));
        controller.close();
      },
    });
    const request = new Request(`${TEST_ORIGIN}/api/v1/verifications`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const res = await POST(request, { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { external_ref: string }).external_ref).toBe("CHUNKED-1");
  });

  it("keeps the stored response when the audit write fails after the handler acted, so a retry does not act twice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    auditFailure.action = "api.verification.create";
    const headers = { "Idempotency-Key": "audit-outage-1" };
    const first = await callApi("POST", "/verifications", { key, body: { external_ref: "AUDIT-OUTAGE" }, headers });
    // The client saw a failure, but the verification exists.
    expect(first.status).toBe(500);
    const db = await getDb();
    expect(await db.select().from(schema.verifications).where(eq(schema.verifications.orgId, sgo))).toHaveLength(1);

    const retry = await callApi("POST", "/verifications", { key, body: { external_ref: "AUDIT-OUTAGE" }, headers });
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(await db.select().from(schema.verifications).where(eq(schema.verifications.orgId, sgo))).toHaveLength(1);
  });
});
