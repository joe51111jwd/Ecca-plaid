import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { decryptField, hashToken } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { useTestDb } from "../../../tests/helpers/db";
import { chooseHandoffSgo, createHandoff, NO_PARTNER_ERROR_MESSAGE, reissueHandoffLink } from "./create";
import { getHandoffView } from "./view";
import { EMBED_RATE_LIMITS, FAMILY_LINK_PURPOSE } from "./policy";
import { addMember, apiSource, embedSource, eventsOf, makeBusiness, makeSgo, makeUser, partner, SYNTHETIC_ORIGIN } from "./test-support";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

const NOW = "2026-11-18T16:00:00.000Z";
const booking = { bookingRef: "SYN-CAMP-001", bookingDescription: "Session 2, June 8-12 (synthetic)", bookingAmountCents: 45_000, channel: "redirect" as const };

// Every organization, booking and person below is synthetic.
describe("createHandoff", () => {
  const t = useTestDb();
  beforeEach(() => setTestNow(NOW));
  afterEach(() => setTestNow(null));

  describe("server-to-server (secret API key)", () => {
    it("creates a handoff with a hashed token, a hold window, the linked verification and a handoff.started event", async () => {
      const biz = await makeBusiness({ holdWindowHours: 48 });
      const sgo = await makeSgo("Synthetic Fund A");
      await partner(biz.orgId, sgo);
      const res = await createHandoff({ ...booking, familyEmail: "Parent@Example.com", studentFirstName: "Riley", metadata: { order: "o_1" } }, await apiSource(biz.orgId));

      expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.url).toBe(`http://localhost:3000/h/${res.token}`);
      expect(res.embedUrl).toBe(`http://localhost:3000/embed/handoff/${res.token}`);
      const h = res.handoff;
      expect(h).toMatchObject({ status: "started", mode: "test", channel: "redirect", createdVia: "api", sgoOrgId: sgo, sgoChosenBy: "single_partner", bookingAmountConfirmed: true, familyEmail: "parent@example.com" });
      expect(h.tokenHash).toBe(hashToken(res.token));
      expect(h.tokenHash).not.toContain(res.token);
      expect(h.holdExpiresAt?.toISOString()).toBe("2026-11-20T16:00:00.000Z");

      const [v] = await t.db.select().from(schema.verifications).where(eq(schema.verifications.handoffId, h.id));
      expect(v).toMatchObject({ orgId: sgo, mode: "test", createdByType: "handoff", createdById: h.id, applicantEmail: "parent@example.com", studentFirstName: "Riley" });
      expect(h.verificationId).toBe(v.id);
      // The stored family link opens exactly that verification.
      expect(hashToken(decryptField(h.familyLinkEnc!, FAMILY_LINK_PURPOSE))).toBe(v.familyTokenHash);

      const events = await eventsOf(biz.orgId);
      expect(events.map((e) => e.type)).toEqual(["handoff.started"]);
      expect(events[0].payload).toEqual({
        id: h.id,
        object: "handoff",
        booking_ref: "SYN-CAMP-001",
        status: "started",
        hold_expires_at: "2026-11-20T16:00:00.000Z",
        verification_status: "pending",
        award: null,
        sgo: { name: "Synthetic Fund A" },
        metadata: { order: "o_1" },
      });
      // Never family data in the business's event.
      expect(JSON.stringify(events[0].payload)).not.toMatch(/parent@example|Riley/i);
    });

    it("refuses an API key of another business, a revoked key or a key of the other mode", async () => {
      const biz = await makeBusiness();
      const other = await makeBusiness();
      const sgo = await makeSgo();
      await partner(biz.orgId, sgo);
      const foreign = await apiSource(other.orgId);
      expect(await codeOf(createHandoff(booking, { ...foreign, businessOrgId: biz.orgId }))).toBe("forbidden");
      const live = await apiSource(biz.orgId, "live");
      expect(await codeOf(createHandoff(booking, { ...live, mode: "test" }))).toBe("forbidden");
      const src = await apiSource(biz.orgId);
      await t.db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, src.apiKeyId));
      expect(await codeOf(createHandoff(booking, src))).toBe("forbidden");
    });

    it("refuses a reused idempotency key with the existing handoff's id", async () => {
      const biz = await makeBusiness();
      const sgo = await makeSgo();
      await partner(biz.orgId, sgo);
      const src = await apiSource(biz.orgId);
      const first = await createHandoff({ ...booking, idempotencyKey: "idem-1" }, src);
      try {
        await createHandoff({ ...booking, idempotencyKey: "idem-1" }, src);
        expect.unreachable();
      } catch (e) {
        expect(isAppError(e) && e.code).toBe("conflict");
        expect(isAppError(e) && e.details).toEqual({ handoffId: first.handoff.id });
      }
      // The same key in the other mode, or without a key, is a different request.
      expect(await codeOf(createHandoff(booking, src))).toBe("ok");
    });
  });

  describe("partner selection", () => {
    it("with no active partner the business gets a clear conflict", async () => {
      const biz = await makeBusiness();
      const sgo = await makeSgo("Not accepting", { acceptsHandoffs: false });
      void sgo;
      try {
        await createHandoff(booking, await apiSource(biz.orgId));
        expect.unreachable();
      } catch (e) {
        expect(isAppError(e) && e.code).toBe("conflict");
        expect((e as Error).message).toBe(NO_PARTNER_ERROR_MESSAGE);
      }
      expect(await t.db.select().from(schema.handoffs)).toHaveLength(0);
    });

    it("with several partners and none named, the family picks from display names", async () => {
      const biz = await makeBusiness();
      const a = await makeSgo("Beta Fund");
      const b = await makeSgo("Alpha Fund");
      await partner(biz.orgId, a);
      await partner(biz.orgId, b);
      const res = await createHandoff(booking, await apiSource(biz.orgId));
      expect(res.handoff).toMatchObject({ sgoOrgId: null, verificationId: null, familyLinkEnc: null, sgoChosenBy: null });
      expect(await t.db.select().from(schema.verifications)).toHaveLength(0);

      const view = await getHandoffView(res.token);
      expect(view.step).toBe("choose_sgo");
      expect(view.partnerChoices.map((p) => p.displayName)).toEqual(["Alpha Fund", "Beta Fund"]);
      expect(view.verificationUrl).toBeNull();

      const chosen = await chooseHandoffSgo(res.token, a);
      expect(chosen).toMatchObject({ sgoOrgId: a, sgoChosenBy: "family" });
      expect(chosen.verificationId).toBeTruthy();
      // Choosing again: the same SGO is a no-op, a different one is refused.
      expect((await chooseHandoffSgo(res.token, a)).verificationId).toBe(chosen.verificationId);
      expect(await codeOf(chooseHandoffSgo(res.token, b))).toBe("conflict");
      const after = await getHandoffView(res.token);
      expect(after.step).toBe("verify");
      expect(after.verificationUrl).toMatch(/^http:\/\/localhost:3000\/v\/[A-Za-z0-9_-]{43}$/);
    });

    it("the family cannot choose an SGO that is not an active partner", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo("One"));
      await partner(biz.orgId, await makeSgo("Two"));
      const stranger = await makeSgo("Stranger Fund");
      const res = await createHandoff(booking, await apiSource(biz.orgId));
      expect(await codeOf(chooseHandoffSgo(res.token, stranger))).toBe("forbidden");
      expect(await codeOf(chooseHandoffSgo("not-a-token", stranger))).toBe("not_found");
    });

    it("a named SGO must be an active partner; named, it wins over the single-partner rule", async () => {
      const biz = await makeBusiness();
      const a = await makeSgo("A");
      const b = await makeSgo("B");
      await partner(biz.orgId, a);
      await partner(biz.orgId, b);
      const res = await createHandoff({ ...booking, sgoOrgId: b }, await apiSource(biz.orgId));
      expect(res.handoff).toMatchObject({ sgoOrgId: b, sgoChosenBy: "business" });
      const stranger = await makeSgo("C");
      expect(await codeOf(createHandoff({ ...booking, sgoOrgId: stranger }, await apiSource(biz.orgId)))).toBe("forbidden");
    });
  });

  describe("embed (publishable key)", () => {
    it("creates from an allowed origin; the amount is recorded as unconfirmed", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      const res = await createHandoff({ ...booking, channel: "embed" }, embedSource(biz.publishableKey));
      expect(res.handoff).toMatchObject({ createdVia: "embed", channel: "embed", bookingAmountConfirmed: false, createdByApiKeyId: null });
      const [entry] = await t.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "handoff.create"));
      expect(entry).toMatchObject({ actorType: "family", orgId: biz.orgId, ip: "203.0.113.7" });
    });

    it("refuses a missing, foreign, null or look-alike origin, and an unknown key, the same way", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      for (const origin of [null, "https://evil.example.com", "null", `${SYNTHETIC_ORIGIN}.evil.com`, `${SYNTHETIC_ORIGIN}/path`, "http://camp.synthetic-example.org", SYNTHETIC_ORIGIN.toUpperCase()]) {
        expect(await codeOf(createHandoff(booking, embedSource(biz.publishableKey, { origin })))).toBe("forbidden");
      }
      expect(await codeOf(createHandoff(booking, embedSource("pk_test_" + "x".repeat(32))))).toBe("forbidden");
      expect(await codeOf(createHandoff(booking, embedSource("sk_live_whatever")))).toBe("forbidden");
      expect(await t.db.select().from(schema.handoffs)).toHaveLength(0);
    });

    it("refuses an idempotency key from the browser", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      expect(await codeOf(createHandoff({ ...booking, idempotencyKey: "x" }, embedSource(biz.publishableKey)))).toBe("validation_failed");
    });

    it("rate-limits per key and IP, and per key across IPs", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      for (let i = 0; i < EMBED_RATE_LIMITS.perKeyAndIp.limit; i++) {
        expect(await codeOf(createHandoff({ ...booking, bookingRef: `R${i}` }, embedSource(biz.publishableKey, { ip: "198.51.100.1" })))).toBe("ok");
      }
      expect(await codeOf(createHandoff(booking, embedSource(biz.publishableKey, { ip: "198.51.100.1" })))).toBe("rate_limited");
      // Another visitor is unaffected...
      expect(await codeOf(createHandoff(booking, embedSource(biz.publishableKey, { ip: "198.51.100.2" })))).toBe("ok");
      // ...and the window ends.
      setTestNow(new Date(new Date(NOW).getTime() + EMBED_RATE_LIMITS.perKeyAndIp.windowMs + 1000));
      expect(await codeOf(createHandoff(booking, embedSource(biz.publishableKey, { ip: "198.51.100.1" })))).toBe("ok");
    });

    it("the per-key limit caps one leaked snippet across many addresses", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      // Pre-fill the per-key counter instead of creating hundreds of handoffs.
      const { rateLimit } = await import("@/server/ratelimit");
      for (let i = 0; i < EMBED_RATE_LIMITS.perKey.limit; i++) await rateLimit(`handoff:embed:key:${biz.orgId}`, EMBED_RATE_LIMITS.perKey);
      expect(await codeOf(createHandoff(booking, embedSource(biz.publishableKey, { ip: "192.0.2.50" })))).toBe("rate_limited");
    });
  });

  describe("input validation", () => {
    async function setup() {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      return { biz, src: await apiSource(biz.orgId) };
    }

    it("treats booking fields as untrusted display text", async () => {
      const { src } = await setup();
      expect(await codeOf(createHandoff({ ...booking, bookingRef: "" }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, bookingRef: "   " }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, bookingRef: "x".repeat(101) }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, bookingRef: "bad\u0000ref" }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, bookingDescription: "y".repeat(301) }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, bookingDescription: "esc\u001b[31m" }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, studentFirstName: "n".repeat(101) }, src))).toBe("validation_failed");
      const ok = await createHandoff({ ...booking, bookingRef: "  SYN   42 ", bookingDescription: "<script>alert(1)</script>\n Week 1" }, src);
      // Stored as plain text (whitespace collapsed); escaping is the renderer's job, never interpretation.
      expect(ok.handoff.bookingRef).toBe("SYN 42");
      expect(ok.handoff.bookingDescription).toBe("<script>alert(1)</script> Week 1");
    });

    it("validates amounts, email, channel and metadata", async () => {
      const { src } = await setup();
      for (const bookingAmountCents of [0, -1, 1.5, 10_000_001, Number.NaN]) expect(await codeOf(createHandoff({ ...booking, bookingAmountCents }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, familyEmail: "not-an-email" }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, channel: "popup" as "embed" }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, metadata: { "bad key": "v" } }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, metadata: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])) }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, metadata: { k: 5 as unknown as string } }, src))).toBe("validation_failed");
      expect(await codeOf(createHandoff({ ...booking, bookingAmountCents: null, familyEmail: "" }, src))).toBe("ok");
    });

    it("accepts a return URL only on an allowed origin", async () => {
      const { src } = await setup();
      expect((await createHandoff({ ...booking, returnUrl: `${SYNTHETIC_ORIGIN}/checkout?b=1` }, src)).handoff.returnUrl).toBe(`${SYNTHETIC_ORIGIN}/checkout?b=1`);
      for (const returnUrl of ["https://evil.example.com/x", `${SYNTHETIC_ORIGIN}.evil.com/`, `https://user@camp.synthetic-example.org/`, "javascript:alert(1)", "//evil.example.com", "http://camp.synthetic-example.org/"]) {
        expect(await codeOf(createHandoff({ ...booking, returnUrl }, src))).toBe("validation_failed");
      }
    });

    it("refuses a suspended business", async () => {
      const { biz, src } = await setup();
      const db = await getDb();
      await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, biz.orgId));
      expect(await codeOf(createHandoff(booking, src))).toBe("forbidden");
      expect(await codeOf(createHandoff(booking, embedSource(biz.publishableKey)))).toBe("forbidden");
    });
  });

  describe("reissueHandoffLink", () => {
    it("rotates the token so the old link stops working; only members may do it", async () => {
      const biz = await makeBusiness();
      await partner(biz.orgId, await makeSgo());
      const res = await createHandoff(booking, await apiSource(biz.orgId));
      const staff = await makeUser();
      await addMember(biz.orgId, staff, "reviewer");
      const viewer = await makeUser();
      await addMember(biz.orgId, viewer, "viewer");
      expect(await codeOf(reissueHandoffLink(biz.orgId, res.handoff.id, { type: "user", userId: viewer }))).toBe("forbidden");
      const other = await makeBusiness();
      const otherStaff = await makeUser();
      await addMember(other.orgId, otherStaff, "owner");
      expect(await codeOf(reissueHandoffLink(other.orgId, res.handoff.id, { type: "user", userId: otherStaff }))).toBe("not_found");

      const again = await reissueHandoffLink(biz.orgId, res.handoff.id, { type: "user", userId: staff });
      expect(again.token).not.toBe(res.token);
      expect(await codeOf(getHandoffView(res.token))).toBe("not_found");
      expect((await getHandoffView(again.token)).id).toBe(res.handoff.id);
    });
  });
});
