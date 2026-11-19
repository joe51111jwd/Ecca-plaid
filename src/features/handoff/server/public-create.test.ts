import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { EMBED_RATE_LIMITS } from "@/server/handoffs";
import { makeBusiness, makeSgo, partner, SYNTHETIC_ORIGIN } from "@/server/handoffs/test-support";
import { useTestDb } from "../../../../tests/helpers/db";
import { PUBLIC_CREATE_MAX_BODY_BYTES } from "../policy";
import { corsHeaders, handlePublicCreate, parsePublicCreateBody, preflightResponse } from "./public-create";

// Every organization, booking and address below is synthetic.
const NOW = "2026-11-18T16:00:00.000Z";

function request(body: unknown, opts: { origin?: string | null; ip?: string; raw?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": opts.ip ?? "203.0.113.9", ...opts.headers };
  if (opts.origin !== null) headers.origin = opts.origin ?? SYNTHETIC_ORIGIN;
  return new Request("http://localhost:3000/embed/handoff/create", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
}

describe("public create endpoint", () => {
  const t = useTestDb();
  beforeEach(() => setTestNow(NOW));
  afterEach(() => setTestNow(null));

  async function camp() {
    const biz = await makeBusiness({ holdWindowHours: 48 });
    await partner(biz.orgId, await makeSgo("Synthetic Fund"));
    return biz;
  }

  it("creates an embed handoff from an allowed origin and returns where to send the family", async () => {
    const biz = await camp();
    const res = await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: "SYN-1", booking_description: "Week 1 (synthetic)", booking_amount_cents: "45000", return_url: `${SYNTHETIC_ORIGIN}/b/SYN-1`, channel: "embed", locale: "es" }));
    expect(res.status).toBe(201);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(SYNTHETIC_ORIGIN);
    expect(res.headers.Vary).toBe("Origin");
    const body = res.body as { handoff_id: string; status: string; hold_expires_at: string; url: string; embed_url: string };
    expect(body).toMatchObject({ object: "handoff_session", status: "started", hold_expires_at: "2026-11-20T16:00:00.000Z" });
    expect(body.url).toMatch(/^http:\/\/localhost:3000\/h\/[A-Za-z0-9_-]{43}$/);
    expect(body.embed_url).toBe(body.url.replace("/h/", "/embed/handoff/"));

    const [row] = await t.db.select().from(schema.handoffs).where(eq(schema.handoffs.id, body.handoff_id));
    expect(row).toMatchObject({ businessOrgId: biz.orgId, createdVia: "embed", channel: "embed", bookingAmountCents: 45_000, bookingAmountConfirmed: false, bookingRef: "SYN-1" });
  });

  it("refuses an origin the business did not allow, with the same answer as an unknown key", async () => {
    const biz = await camp();
    const foreign = await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: "SYN-2" }, { origin: "https://evil.example" }));
    const unknown = await handlePublicCreate(request({ publishable_key: "pk_test_" + "z".repeat(32), booking_ref: "SYN-2" }));
    const missing = await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: "SYN-2" }, { origin: null }));
    for (const r of [foreign, unknown, missing]) expect(r.status).toBe(403);
    expect(foreign.body).toEqual(unknown.body);
    expect(missing.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(await t.db.select().from(schema.handoffs)).toHaveLength(0);
  });

  it("rejects a return URL off the business's origins", async () => {
    const biz = await camp();
    const r = await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: "SYN-3", return_url: "https://evil.example/steal" }));
    expect(r.status).toBe(422);
    expect((r.body as { error: { details: { fields: Record<string, string> } } }).error.details.fields).toHaveProperty("returnUrl");
  });

  it("refuses an idempotency key and unknown fields from the browser", async () => {
    const biz = await camp();
    const r = await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: "SYN-4", idempotency_key: "k" }));
    expect(r.status).toBe(422);
  });

  it.each([
    ["not JSON", "{oops", 400],
    ["a JSON array", "[]", 422],
    ["a numeric booking ref", JSON.stringify({ publishable_key: "pk", booking_ref: 7 }), 422],
    ["a fractional amount", JSON.stringify({ publishable_key: "pk", booking_ref: "x", booking_amount_cents: 1.5 }), 422],
    ["a negative amount string", JSON.stringify({ publishable_key: "pk", booking_ref: "x", booking_amount_cents: "-5" }), 422],
    ["an unknown locale", JSON.stringify({ publishable_key: "pk", booking_ref: "x", locale: "fr" }), 422],
  ])("answers %s with %d", async (_l, raw, status) => {
    const r = await handlePublicCreate(request(null, { raw }));
    expect(r.status).toBe(status);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe(SYNTHETIC_ORIGIN);
  });

  it("refuses an oversized body even when Content-Length is missing", async () => {
    const big = JSON.stringify({ publishable_key: "pk", booking_ref: "x".repeat(PUBLIC_CREATE_MAX_BODY_BYTES) });
    expect((await handlePublicCreate(request(null, { raw: big }))).status).toBe(400);
    expect((await handlePublicCreate(request(null, { raw: "{}", headers: { "content-length": String(PUBLIC_CREATE_MAX_BODY_BYTES + 1) } }))).status).toBe(400);
  });

  it("rate-limits one browser per business", async () => {
    const biz = await camp();
    const statuses: number[] = [];
    for (let i = 0; i <= EMBED_RATE_LIMITS.perKeyAndIp.limit; i++) {
      statuses.push((await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: `SYN-R${i}` }, { ip: "198.51.100.4" }))).status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another browser is not affected.
    expect((await handlePublicCreate(request({ publishable_key: biz.publishableKey, booking_ref: "SYN-other" }, { ip: "198.51.100.5" }))).status).toBe(201);
  });

  it("parses amounts given as numbers or digit strings", () => {
    expect(parsePublicCreateBody(JSON.stringify({ publishable_key: "pk", booking_ref: "x", booking_amount_cents: 100 })).booking_amount_cents).toBe(100);
    expect(parsePublicCreateBody(JSON.stringify({ publishable_key: "pk", booking_ref: "x", booking_amount_cents: " 250 " })).booking_amount_cents).toBe(250);
    expect(parsePublicCreateBody(JSON.stringify({ publishable_key: "pk", booking_ref: "x", booking_amount_cents: "" })).booking_amount_cents).toBeNull();
  });

  it("answers the preflight without credentials", () => {
    const p = preflightResponse("https://Camp.Synthetic-Example.org");
    expect(p.status).toBe(204);
    expect(p.headers).toMatchObject({ "Access-Control-Allow-Origin": "https://camp.synthetic-example.org", "Access-Control-Allow-Methods": "POST, OPTIONS" });
    expect(p.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(corsHeaders("null")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders("https://x.example/path")["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
