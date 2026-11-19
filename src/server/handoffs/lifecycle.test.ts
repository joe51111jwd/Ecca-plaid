import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { offerAward } from "@/server/awards";
import { updateBusinessProfile, businessSystemActor } from "@/server/businesses";
import { enqueue, runDueJobs } from "@/server/jobs";
import { useTestDb } from "../../../tests/helpers/db";
import { createHandoff } from "./create";
import { jobHandlers, recurringJobs } from "./jobs";
import { cancelHandoff, cancelHandoffByFamily, completeHandoff, expireDueHolds, extendHold, syncDueProgress } from "./lifecycle";
import { getHandoff, getHandoffForSgo, handoffConversionStats, listHandoffs, listHandoffsForSgo, recordToApi } from "./read";
import { getHandoffView } from "./view";
import { addMember, apiSource, eventsOf, makeBusiness, makeSgo, makeUser, partner, setVerificationState, SYNTHETIC_ORIGIN } from "./test-support";

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
const HOUR = 3_600_000;
const booking = { bookingRef: "SYN-CAMP-7", bookingDescription: "Week 3 day camp (synthetic)", bookingAmountCents: 60_000, channel: "redirect" as const, familyEmail: "family@example.com", studentFirstName: "Riley" };

async function statusOf(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.handoffs).where(eq(schema.handoffs.id, id));
  return row;
}

async function runVerificationUpdated(handoffId: string, verificationId: string) {
  await jobHandlers["handoff.verification_updated"]({ handoffId, verificationId }, { jobId: "job_test", attempt: 1 });
}

// Every organization, booking, person and amount below is synthetic.
describe("handoff lifecycle", () => {
  useTestDb();
  let biz: { orgId: string; publishableKey: string };
  let sgo: string;
  let staff: string;
  let sgoReviewer: string;

  beforeEach(async () => {
    setTestNow(NOW);
    biz = await makeBusiness({ holdWindowHours: 72, fee: { flatCents: 2500, bps: 250 } });
    sgo = await makeSgo("Synthetic Fund");
    await partner(biz.orgId, sgo);
    staff = await makeUser();
    await addMember(biz.orgId, staff, "reviewer");
    sgoReviewer = await makeUser();
    await addMember(sgo, sgoReviewer, "reviewer");
  });
  afterEach(() => setTestNow(null));

  async function newHandoff(overrides: Partial<typeof booking> = {}) {
    return createHandoff({ ...booking, ...overrides }, await apiSource(biz.orgId));
  }

  async function toEligible() {
    const res = await newHandoff();
    await setVerificationState(res.handoff.verificationId!, { status: "eligible", expiresAt: new Date("2026-12-31T23:59:59Z") });
    await runVerificationUpdated(res.handoff.id, res.handoff.verificationId!);
    return res;
  }

  async function toAwarded(amountCents = 40_000) {
    const res = await toEligible();
    await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents, paymentMethod: "direct_to_vendor" }, { type: "user", userId: sgoReviewer, mode: "test" });
    return res;
  }

  describe("verification outcome mapping (handoff.verification_updated)", () => {
    it("eligible → eligible, with the event saying exactly that the SGO decides next", async () => {
      const res = await toEligible();
      expect((await statusOf(res.handoff.id)).status).toBe("eligible");
      const [ev] = await eventsOf(biz.orgId, "handoff.eligible");
      expect(ev.payload).toMatchObject({ status: "eligible", verification_status: "eligible", award: null, sgo: { name: "Synthetic Fund" } });
      const api = recordToApi(await getHandoff(biz.orgId, res.handoff.id, { mode: "test" }));
      expect(api.status_detail).toContain("awaiting the SGO's award decision");
      expect(api.status_detail).toContain("not an award and not a payment");
    });

    it("ineligible → declined, revealing only not_eligible", async () => {
      const res = await newHandoff();
      await setVerificationState(res.handoff.verificationId!, { status: "ineligible" });
      await runVerificationUpdated(res.handoff.id, res.handoff.verificationId!);
      const row = await statusOf(res.handoff.id);
      expect(row).toMatchObject({ status: "declined", declineReason: "verification_not_eligible" });
      const [ev] = await eventsOf(biz.orgId, "handoff.declined");
      expect(ev.payload).toMatchObject({ status: "declined", verification_status: "not_eligible" });
      expect(Object.keys(ev.payload).sort()).toEqual(["award", "booking_ref", "hold_expires_at", "id", "metadata", "object", "sgo", "status", "verification_status"]);
    });

    it("needs_review → held; pending after submission → held; pending after opening → verifying", async () => {
      const a = await newHandoff();
      await setVerificationState(a.handoff.verificationId!, { status: "needs_review", started: true, submitted: true });
      await runVerificationUpdated(a.handoff.id, a.handoff.verificationId!);
      expect((await statusOf(a.handoff.id)).status).toBe("held");
      expect((await eventsOf(biz.orgId, "handoff.held"))[0].payload).toMatchObject({ verification_status: "pending" });

      const b = await newHandoff({ bookingRef: "B" });
      await setVerificationState(b.handoff.verificationId!, { status: "pending", started: true, submitted: true });
      await runVerificationUpdated(b.handoff.id, b.handoff.verificationId!);
      expect((await statusOf(b.handoff.id)).status).toBe("held");

      const c = await newHandoff({ bookingRef: "C" });
      await setVerificationState(c.handoff.verificationId!, { status: "pending", started: true });
      await runVerificationUpdated(c.handoff.id, c.handoff.verificationId!);
      expect((await statusOf(c.handoff.id)).status).toBe("verifying");
    });

    it("ignores a verification id that is not the handoff's, and unknown handoffs", async () => {
      const a = await newHandoff();
      const b = await newHandoff({ bookingRef: "B" });
      await setVerificationState(b.handoff.verificationId!, { status: "eligible" });
      await runVerificationUpdated(a.handoff.id, b.handoff.verificationId!);
      expect((await statusOf(a.handoff.id)).status).toBe("started");
      await runVerificationUpdated("ho_missing", b.handoff.verificationId!);
      await expect(jobHandlers["handoff.verification_updated"]({ handoffId: 5 }, { jobId: "j", attempt: 1 })).rejects.toThrow();
    });

    it("emits each transition's webhook event once, even when the job is retried or duplicated", async () => {
      const res = await newHandoff();
      await setVerificationState(res.handoff.verificationId!, { status: "eligible" });
      for (let i = 0; i < 3; i++) await runVerificationUpdated(res.handoff.id, res.handoff.verificationId!);
      // Through the real queue as well (two jobs for the same change, as a retry would produce).
      await enqueue("handoff.verification_updated", { handoffId: res.handoff.id, verificationId: res.handoff.verificationId! });
      await enqueue("handoff.verification_updated", { handoffId: res.handoff.id, verificationId: res.handoff.verificationId! });
      await runDueJobs({ handlers: jobHandlers });
      expect((await eventsOf(biz.orgId)).map((e) => e.type)).toEqual(["handoff.started", "handoff.eligible"]);
    });

    it("a re-review after an award does not move the handoff", async () => {
      const res = await toAwarded();
      await setVerificationState(res.handoff.verificationId!, { status: "ineligible" });
      await runVerificationUpdated(res.handoff.id, res.handoff.verificationId!);
      expect((await statusOf(res.handoff.id)).status).toBe("awarded");
    });

    it("a canceled verification cancels the handoff (no event type for canceled yet)", async () => {
      const res = await newHandoff();
      await setVerificationState(res.handoff.verificationId!, { status: "canceled" });
      await runVerificationUpdated(res.handoff.id, res.handoff.verificationId!);
      expect(await statusOf(res.handoff.id)).toMatchObject({ status: "canceled", canceledBy: "system" });
      expect((await eventsOf(biz.orgId)).map((e) => e.type)).toEqual(["handoff.started"]);
    });
  });

  describe("progress sync (handoff.sync_progress)", () => {
    it("picks up 'family began' and 'family submitted', once each", async () => {
      const res = await newHandoff();
      setTestNow(new Date(Date.parse(NOW) + 60_000));
      await setVerificationState(res.handoff.verificationId!, { status: "pending", started: true });
      expect(await syncDueProgress()).toBe(1);
      expect((await statusOf(res.handoff.id)).status).toBe("verifying");
      expect(await syncDueProgress()).toBe(0);
      setTestNow(new Date(Date.parse(NOW) + 120_000));
      await setVerificationState(res.handoff.verificationId!, { submitted: true });
      expect(await syncDueProgress()).toBe(1);
      expect((await statusOf(res.handoff.id)).status).toBe("held");
      expect((await eventsOf(biz.orgId)).map((e) => e.type)).toEqual(["handoff.started", "handoff.held"]);
    });

    it("the family page syncs too", async () => {
      const res = await newHandoff();
      await setVerificationState(res.handoff.verificationId!, { status: "pending", started: true, submitted: true });
      const view = await getHandoffView(res.token);
      expect(view).toMatchObject({ status: "held", step: "waiting" });
    });

    it("registers its recurring jobs", () => {
      expect(recurringJobs.map((j) => j.type).sort()).toEqual(["handoff.expire_holds", "handoff.sync_progress"]);
    });
  });

  describe("hold expiry (handoff.expire_holds)", () => {
    it("expires holding handoffs once the window passes, never an awarded one", async () => {
      const waiting = await newHandoff();
      const eligible = await toEligible();
      const awarded = await toAwarded();
      setTestNow(new Date(Date.parse(NOW) + 72 * HOUR - 1));
      expect(await expireDueHolds()).toBe(0);
      setTestNow(new Date(Date.parse(NOW) + 72 * HOUR));
      expect(await expireDueHolds()).toBe(2);
      expect((await statusOf(waiting.handoff.id)).status).toBe("expired");
      expect((await statusOf(eligible.handoff.id)).status).toBe("expired");
      expect((await statusOf(awarded.handoff.id)).status).toBe("awarded");
      expect(await expireDueHolds()).toBe(0);
      expect(await eventsOf(biz.orgId, "handoff.expired")).toHaveLength(2);
      // The family is told the hold ended, without a promise.
      const view = await getHandoffView(waiting.token);
      expect(view).toMatchObject({ step: "expired", hold: { active: false, expiresAt: null } });
    });

    it("extendHold adds hours within the policy maximum", async () => {
      const res = await newHandoff();
      const actor = { type: "user" as const, userId: staff };
      const extended = await extendHold(biz.orgId, res.handoff.id, 24, actor);
      expect(extended.holdExpiresAt?.toISOString()).toBe(new Date(Date.parse(NOW) + 96 * HOUR).toISOString());
      expect(extended.holdExtendedHours).toBe(24);
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 697, actor))).toBe("conflict");
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 696, actor))).toBe("ok");
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 1, actor))).toBe("conflict");
      for (const hours of [0, -1, 1.5, 721]) expect(await codeOf(extendHold(biz.orgId, res.handoff.id, hours, actor))).toBe("validation_failed");
    });

    it("extending a lapsed (not yet swept) hold counts from now; ended handoffs cannot be extended", async () => {
      const res = await newHandoff();
      setTestNow(new Date(Date.parse(NOW) + 80 * HOUR));
      const extended = await extendHold(biz.orgId, res.handoff.id, 2, { type: "user", userId: staff });
      expect(extended.holdExpiresAt?.toISOString()).toBe(new Date(Date.parse(NOW) + 82 * HOUR).toISOString());
      expect(await expireDueHolds()).toBe(0);
      await cancelHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff });
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 2, { type: "user", userId: staff }))).toBe("conflict");
    });

    it("only the business's own operators can extend", async () => {
      const res = await newHandoff();
      const viewer = await makeUser();
      await addMember(biz.orgId, viewer, "viewer");
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 1, { type: "user", userId: viewer }))).toBe("forbidden");
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 1, { type: "user", userId: sgoReviewer }))).toBe("forbidden");
      const other = await makeBusiness();
      const otherOwner = await makeUser();
      await addMember(other.orgId, otherOwner, "owner");
      expect(await codeOf(extendHold(other.orgId, res.handoff.id, 1, { type: "user", userId: otherOwner }))).toBe("not_found");
      const liveKey = await apiSource(biz.orgId, "live");
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 1, { type: "api_key", apiKeyId: liveKey.apiKeyId, mode: "live" }))).toBe("not_found");
      const testKey = await apiSource(biz.orgId, "test");
      expect(await codeOf(extendHold(biz.orgId, res.handoff.id, 1, { type: "api_key", apiKeyId: testKey.apiKeyId, mode: "test" }))).toBe("ok");
    });
  });

  describe("completion", () => {
    it("is allowed only from awarded, accrues the success fee and emits handoff.completed", async () => {
      const waiting = await newHandoff();
      expect(await codeOf(completeHandoff(biz.orgId, waiting.handoff.id, { type: "user", userId: staff }))).toBe("conflict");
      const eligible = await toEligible();
      expect(await codeOf(completeHandoff(biz.orgId, eligible.handoff.id, { type: "user", userId: staff }))).toBe("conflict");

      const res = await toAwarded(40_000);
      const done = await completeHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff });
      expect(done.handoff).toMatchObject({ status: "completed" });
      expect(done.handoff.completedAt?.toISOString()).toBe(NOW);
      // $25 flat + 2.5% of $600 = $25 + $15.
      expect(done.fee).toMatchObject({ kind: "business_success_fee", payerOrgId: biz.orgId, amountCents: 4000, status: "accrued", handoffId: res.handoff.id, donationId: null, paymentId: null });
      expect(await codeOf(completeHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff }))).toBe("conflict");
      const [ev] = await eventsOf(biz.orgId, "handoff.completed");
      expect(ev.payload).toMatchObject({ status: "completed", award: { amount_usd: "400.00", payment_method: "direct_to_vendor" } });
    });

    it("a confirmed final amount replaces the reported one but cannot be below the award", async () => {
      const res = await toAwarded(40_000);
      expect(await codeOf(completeHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff }, { bookingAmountCents: 39_999 }))).toBe("conflict");
      expect(await codeOf(completeHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff }, { bookingAmountCents: -5 }))).toBe("validation_failed");
      const done = await completeHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff }, { bookingAmountCents: 50_000 });
      expect(done.handoff).toMatchObject({ bookingAmountCents: 50_000, bookingAmountConfirmed: true });
      expect(done.fee?.amountCents).toBe(2500 + 1250);
    });

    it("writes no fee row when the business's fee is zero", async () => {
      const free = await makeBusiness({ fee: { flatCents: 0, bps: 0 } });
      await partner(free.orgId, sgo);
      const res = await createHandoff(booking, await apiSource(free.orgId));
      await setVerificationState(res.handoff.verificationId!, { status: "eligible" });
      await runVerificationUpdated(res.handoff.id, res.handoff.verificationId!);
      await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 100, paymentMethod: "other" }, { type: "user", userId: sgoReviewer, mode: "test" });
      const done = await completeHandoff(free.orgId, res.handoff.id, handoffSystem());
      expect(done.fee).toBeNull();
      const db = await getDb();
      expect(await db.select().from(schema.feeLedger)).toHaveLength(0);
    });
  });

  describe("cancellation", () => {
    it("the business cancels any open handoff; canceling twice is a no-op; ended ones cannot be canceled", async () => {
      const res = await newHandoff();
      const c = await cancelHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff }, { reason: "Family booked another week" });
      expect(c).toMatchObject({ status: "canceled", canceledBy: "business" });
      expect((await cancelHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff })).status).toBe("canceled");
      const awarded = await toAwarded();
      expect((await cancelHandoff(biz.orgId, awarded.handoff.id, { type: "user", userId: staff })).status).toBe("canceled");
      const declined = await newHandoff({ bookingRef: "D" });
      await setVerificationState(declined.handoff.verificationId!, { status: "ineligible" });
      await runVerificationUpdated(declined.handoff.id, declined.handoff.verificationId!);
      expect(await codeOf(cancelHandoff(biz.orgId, declined.handoff.id, { type: "user", userId: staff }))).toBe("conflict");
      expect(await codeOf(cancelHandoff(biz.orgId, res.handoff.id, { type: "user", userId: staff }, { reason: "x".repeat(501) }))).toBe("validation_failed");
    });

    it("the family cancels with its token; the page then offers no verification link", async () => {
      const res = await newHandoff();
      const c = await cancelHandoffByFamily(res.token);
      expect(c).toMatchObject({ status: "canceled", canceledBy: "family" });
      const view = await getHandoffView(res.token);
      expect(view).toMatchObject({ step: "canceled", verificationUrl: null });
      expect(await codeOf(cancelHandoffByFamily("x".repeat(43)))).toBe("not_found");
    });
  });

  describe("the family page", () => {
    it("never promises an award or a payment, in English or Spanish", async () => {
      const res = await toEligible();
      const view = await getHandoffView(res.token);
      expect(view.step).toBe("eligible");
      expect(view.text.en.body).toContain("decides whether to award");
      expect(view.text.en.body).toContain("a scholarship is not guaranteed");
      expect(view.text.en.body).toContain("has not been paid");
      expect(view.text.es.body).toContain("la beca no está garantizada");
      for (const t of [view.text.en, view.text.es]) expect(`${t.headline} ${t.body}`).not.toMatch(/will be paid|you qualify|será pagad|usted califica/i);
      expect(view.notices.en.join(" ")).toContain("Families never pay");
      expect(view.notices.en.join(" ")).toContain("provisional");
      expect(view.notices.en.join(" ")).toContain("Test mode");
      expect(view.hold.deadline?.en).toMatch(/November 21, 2026/);
      expect(view.frameAncestors).toEqual([SYNTHETIC_ORIGIN]);
      expect(JSON.stringify(view)).not.toMatch(/family@example\.com|incomeCents|threshold/i);
    });

    it("re-checks the return URL against the current allowed origins", async () => {
      const res = await newHandoff({ returnUrl: `${SYNTHETIC_ORIGIN}/thanks` } as Partial<typeof booking>);
      expect((await getHandoffView(res.token)).returnUrl).toBe(`${SYNTHETIC_ORIGIN}/thanks`);
      await updateBusinessProfile(biz.orgId, { allowedOrigins: ["https://other.synthetic-example.org"] }, businessSystemActor("test"));
      expect((await getHandoffView(res.token)).returnUrl).toBeNull();
    });

    it("shows the offered award once awarded", async () => {
      const res = await toAwarded(40_000);
      const view = await getHandoffView(res.token);
      expect(view).toMatchObject({ step: "awarded", award: { amountUsd: "400.00" } });
      expect(view.text.en.body).toContain("handles payment under its own rules");
      expect(await codeOf(getHandoffView("short"))).toBe("not_found");
    });
  });

  describe("read models and tenant isolation", () => {
    it("a business sees only its own handoffs, in the requested mode", async () => {
      const mine = await newHandoff();
      const other = await makeBusiness();
      await partner(other.orgId, sgo);
      const theirs = await createHandoff(booking, await apiSource(other.orgId));
      const page = await listHandoffs(biz.orgId, { mode: "test" });
      expect(page.data.map((r) => r.handoff.id)).toEqual([mine.handoff.id]);
      expect((await listHandoffs(biz.orgId, { mode: "live" })).data).toEqual([]);
      expect(await codeOf(getHandoff(biz.orgId, theirs.handoff.id, { mode: "test" }))).toBe("not_found");
      expect(await codeOf(getHandoff(biz.orgId, mine.handoff.id, { mode: "live" }))).toBe("not_found");
      expect(await codeOf(listHandoffs(biz.orgId, { mode: "test", before: theirs.handoff.id }))).toBe("bad_request");
      const api = recordToApi(page.data[0]);
      expect(JSON.stringify(api)).not.toMatch(/family@example\.com|Riley|token/i);
    });

    it("paginates newest first with a cursor and filters by status", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        setTestNow(new Date(Date.parse(NOW) + i * 1000));
        ids.push((await newHandoff({ bookingRef: `P${i}` })).handoff.id);
      }
      const first = await listHandoffs(biz.orgId, { mode: "test", limit: 2 });
      expect(first.data.map((r) => r.handoff.id)).toEqual([ids[2], ids[1]]);
      expect(first.hasMore).toBe(true);
      const second = await listHandoffs(biz.orgId, { mode: "test", limit: 2, before: first.nextCursor! });
      expect(second.data.map((r) => r.handoff.id)).toEqual([ids[0]]);
      expect(second.hasMore).toBe(false);
      expect((await listHandoffs(biz.orgId, { mode: "test", status: "eligible" })).data).toEqual([]);
      expect(await codeOf(listHandoffs(biz.orgId, { mode: "test", limit: 0 }))).toBe("validation_failed");
    });

    it("an SGO sees only handoffs routed to it", async () => {
      const routed = await newHandoff();
      const otherSgo = await makeSgo("Other Fund");
      const otherBiz = await makeBusiness();
      await partner(otherBiz.orgId, otherSgo);
      const elsewhere = await createHandoff(booking, await apiSource(otherBiz.orgId));
      const list = await listHandoffsForSgo(sgo, { mode: "test" });
      expect(list.map((h) => h.id)).toEqual([routed.handoff.id]);
      expect(list[0]).toMatchObject({ business: { orgId: biz.orgId, vendorType: "summer_camp" }, booking: { amountCents: 60_000, amountConfirmed: true }, verificationStatus: "pending" });
      expect(await codeOf(getHandoffForSgo(sgo, elsewhere.handoff.id, { mode: "test" }))).toBe("not_found");
      expect((await listHandoffsForSgo(otherSgo, { mode: "test" })).map((h) => h.id)).toEqual([elsewhere.handoff.id]);
    });

    it("conversion stats count the funnel in integer basis points", async () => {
      await newHandoff();
      await toEligible();
      const done = await toAwarded();
      await completeHandoff(biz.orgId, done.handoff.id, { type: "user", userId: staff });
      const stats = await handoffConversionStats(biz.orgId, { mode: "test" });
      expect(stats).toMatchObject({ total: 3, reachedEligible: 2, completed: 1, completionRateBps: 3333, eligibleToCompletedBps: 5000 });
      expect(stats.byStatus).toMatchObject({ started: 1, eligible: 1, completed: 1, declined: 0 });
      expect((await handoffConversionStats(biz.orgId, { mode: "live" })).total).toBe(0);
    });
  });
});

function handoffSystem() {
  return { type: "system" as const, reason: "test" };
}
