import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { applyVerificationOutcome, completeHandoff, createHandoff, handoffSystemActor } from "@/server/handoffs";
import { createVerification } from "@/server/verifications";
import { useTestDb } from "../../../tests/helpers/db";
import { addMember, apiSource, eventsOf, makeApiKey, makeBusiness, makeHousehold, makeSgo, makeUser, partner, setVerificationState } from "../handoffs/test-support";
import { AWARD_PAYMENT_METHODS, awardComplianceReminders, MAX_AWARD_CENTS, UNSETTLED_VENDOR_TYPES } from "./policy";
import { canChangeAwardStatus, declineAwardForHandoff, getAwardContext, listAwards, offerAward, updateAwardStatus, type AwardActor } from "./service";

// Every organization, person, booking and amount below is SYNTHETIC.

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
const VALID_UNTIL = new Date("2027-11-18T00:00:00Z");

describe("awardComplianceReminders", () => {
  const codes = (r: ReturnType<typeof awardComplianceReminders>) => r.map((x) => x.code);

  it("always reminds of the eligible-student / qualified-expense rule, income-only scope, no family payment, and that an award is not a payment", () => {
    const r = codes(awardComplianceReminders({ vendorType: null }));
    expect(r).toEqual(expect.arrayContaining(["eligible_student_qualified_expense", "verification_covers_income_only", "no_payment_to_family", "award_is_not_a_payment"]));
    expect(r).not.toContain("vendor_type_not_settled");
    expect(r).not.toContain("business_fee_private_benefit");
  });

  it("a summer camp booking carries the 'not settled in the proposed rules' caution; a private school does not", () => {
    expect(codes(awardComplianceReminders({ vendorType: "summer_camp" }))).toContain("vendor_type_not_settled");
    expect(codes(awardComplianceReminders({ vendorType: "after_school" }))).toContain("vendor_type_not_settled");
    expect(codes(awardComplianceReminders({ vendorType: "microschool" }))).toContain("vendor_type_not_settled");
    expect(codes(awardComplianceReminders({ vendorType: "private_school" }))).not.toContain("vendor_type_not_settled");
    expect(codes(awardComplianceReminders({ vendorType: "private_school" }))).toContain("business_fee_private_benefit");
    expect(UNSETTLED_VENDOR_TYPES.has("summer_camp")).toBe(true);
  });

  it("shows the vendor reimbursement conditions for direct-to-vendor and the wallet note for a qualified digital wallet", () => {
    expect(codes(awardComplianceReminders({ vendorType: null, paymentMethod: "direct_to_vendor" }))).toContain("vendor_direct_payment_conditions");
    expect(codes(awardComplianceReminders({ vendorType: null, paymentMethod: "direct_to_vendor" }))).not.toContain("qualified_digital_wallet_proposed");
    expect(codes(awardComplianceReminders({ vendorType: null, paymentMethod: "qualified_digital_wallet" }))).toEqual(expect.arrayContaining(["qualified_digital_wallet_proposed"]));
    expect(codes(awardComplianceReminders({ vendorType: null, paymentMethod: "qualified_digital_wallet" }))).not.toContain("vendor_direct_payment_conditions");
    // Before a method is chosen, both are shown.
    expect(codes(awardComplianceReminders({ vendorType: null }))).toEqual(expect.arrayContaining(["vendor_direct_payment_conditions", "qualified_digital_wallet_proposed"]));
    const vendor = awardComplianceReminders({ vendorType: null, paymentMethod: "direct_to_vendor" }).find((r) => r.code === "vendor_direct_payment_conditions")!;
    expect(vendor.text).toContain("required to reimburse");
  });

  it("labels proposed-rule content as proposed and cites a reference for every reminder", () => {
    for (const r of awardComplianceReminders({ vendorType: "summer_camp" })) {
      expect(r.source.length).toBeGreaterThan(0);
      expect(["caution", "info"]).toContain(r.severity);
    }
    const all = awardComplianceReminders({ vendorType: "summer_camp" }).map((r) => r.text).join(" ");
    expect(all).toContain("proposed rules");
    expect(all).not.toMatch(/final (rule|regulation)s? (require|say)/i);
  });

  it("has the three payment methods", () => {
    expect(AWARD_PAYMENT_METHODS).toEqual(["direct_to_vendor", "qualified_digital_wallet", "other"]);
  });
});

describe("canChangeAwardStatus", () => {
  it("offered → accepted | paid | revoked; accepted → paid | revoked; paid, revoked and declined are final", () => {
    expect(canChangeAwardStatus("offered", "accepted")).toBe(true);
    expect(canChangeAwardStatus("offered", "paid")).toBe(true);
    expect(canChangeAwardStatus("offered", "revoked")).toBe(true);
    expect(canChangeAwardStatus("accepted", "paid")).toBe(true);
    expect(canChangeAwardStatus("accepted", "revoked")).toBe(true);
    expect(canChangeAwardStatus("accepted", "offered")).toBe(false);
    for (const from of ["paid", "revoked", "declined"] as const) {
      for (const to of ["offered", "accepted", "paid", "revoked", "declined"] as const) expect(canChangeAwardStatus(from, to)).toBe(false);
    }
  });
});

describe("awards service", () => {
  useTestDb();
  let biz: { orgId: string; publishableKey: string };
  let sgo: string;
  let otherSgo: string;
  let reviewer: string;
  let viewer: string;
  let actor: AwardActor;
  let seq = 0;

  beforeEach(async () => {
    setTestNow(NOW);
    biz = await makeBusiness({ name: "Synthetic Lake Camp", fee: { flatCents: 2500, bps: 0 } });
    sgo = await makeSgo("Synthetic Fund");
    otherSgo = await makeSgo("Other Synthetic Fund");
    await partner(biz.orgId, sgo);
    reviewer = await makeUser();
    await addMember(sgo, reviewer, "reviewer");
    viewer = await makeUser();
    await addMember(sgo, viewer, "viewer");
    actor = { type: "user", userId: reviewer, mode: "test" };
  });
  afterEach(() => setTestNow(null));

  async function handoff(bookingAmountCents: number | null = 60_000) {
    seq += 1;
    return createHandoff({ bookingRef: `SYN-${seq}`, bookingAmountCents, channel: "embed", familyEmail: `family-${seq}@example.com` }, await apiSource(biz.orgId));
  }

  async function eligibleHandoff(bookingAmountCents: number | null = 60_000) {
    const res = await handoff(bookingAmountCents);
    await setVerificationState(res.handoff.verificationId!, { status: "eligible", expiresAt: VALID_UNTIL });
    await applyVerificationOutcome({ handoffId: res.handoff.id, verificationId: res.handoff.verificationId! });
    return res;
  }

  /** A verification the SGO created itself (no booking). */
  async function standalone(orgId = sgo, status: "eligible" | "pending" = "eligible") {
    const { verification } = await createVerification({ orgId, mode: "test", createdBy: { type: "user", id: reviewer } });
    if (status === "eligible") await setVerificationState(verification.id, { status: "eligible", expiresAt: VALID_UNTIL });
    return verification.id;
  }

  async function handoffRow(id: string) {
    const db = await getDb();
    const [row] = await db.select().from(schema.handoffs).where(eq(schema.handoffs.id, id));
    return row;
  }

  describe("offerAward", () => {
    it("for a booking: records the award, emits award.offered to the SGO and handoff.awarded to the business, once", async () => {
      const res = await eligibleHandoff();
      const { award, handoff: moved } = await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 45_000, paymentMethod: "direct_to_vendor", notes: "  Synthetic note " }, actor);
      expect(award).toMatchObject({ orgId: sgo, handoffId: res.handoff.id, amountCents: 45_000, status: "offered", paymentMethod: "direct_to_vendor", notes: "Synthetic note", decidedBy: reviewer });
      expect(moved).toMatchObject({ status: "awarded", awardId: award.id });

      const offered = await eventsOf(sgo, "award.offered");
      expect(offered).toHaveLength(1);
      expect(offered[0].payload).toMatchObject({ id: award.id, handoff_id: res.handoff.id, amount_usd: "450.00", payment_method: "direct_to_vendor", status: "offered" });
      // The SGO's internal notes never leave its organization.
      expect(JSON.stringify(offered[0].payload)).not.toContain("Synthetic note");

      const awarded = await eventsOf(biz.orgId, "handoff.awarded");
      expect(awarded).toHaveLength(1);
      expect(awarded[0].payload).toMatchObject({ status: "awarded", award: { amount_usd: "450.00", payment_method: "direct_to_vendor" }, verification_status: "eligible" });
      expect(JSON.stringify(awarded[0].payload)).not.toContain("Synthetic note");
      expect(await eventsOf(biz.orgId, "award.offered")).toHaveLength(0);

      // A second offer for the same booking is refused and emits nothing.
      expect(await codeOf(offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 1000, paymentMethod: "other" }, actor))).toBe("conflict");
      expect(await eventsOf(sgo, "award.offered")).toHaveLength(1);
    });

    it("cannot exceed the booking amount; equal is allowed", async () => {
      const res = await eligibleHandoff(60_000);
      expect(await codeOf(offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 60_001, paymentMethod: "direct_to_vendor" }, actor))).toBe("validation_failed");
      const { award } = await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 60_000, paymentMethod: "direct_to_vendor" }, actor);
      expect(award.amountCents).toBe(60_000);
    });

    it("needs an eligible, unexpired verification", async () => {
      const pending = await handoff();
      expect(await codeOf(offerAward(sgo, { verificationId: pending.handoff.verificationId!, amountCents: 100, paymentMethod: "other" }, actor))).toBe("conflict");

      const res = await eligibleHandoff();
      await setVerificationState(res.handoff.verificationId!, { expiresAt: new Date("2026-11-18T15:59:59Z") });
      expect(await codeOf(offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 100, paymentMethod: "other" }, actor))).toBe("conflict");

      const inel = await handoff();
      await setVerificationState(inel.handoff.verificationId!, { status: "ineligible" });
      expect(await codeOf(offerAward(sgo, { verificationId: inel.handoff.verificationId!, amountCents: 100, paymentMethod: "other" }, actor))).toBe("conflict");
      const db = await getDb();
      expect(await db.select().from(schema.awards)).toHaveLength(0);
    });

    it("is never automatic: an eligible verification creates no award by itself", async () => {
      const res = await eligibleHandoff();
      expect((await handoffRow(res.handoff.id)).status).toBe("eligible");
      const db = await getDb();
      expect(await db.select().from(schema.awards)).toHaveLength(0);
    });

    it("refuses a booking whose hold has ended, and a handoff id other than the one that started the verification", async () => {
      const res = await eligibleHandoff();
      const other = await eligibleHandoff();
      expect(await codeOf(offerAward(sgo, { verificationId: res.handoff.verificationId!, handoffId: other.handoff.id, amountCents: 100, paymentMethod: "other" }, actor))).toBe("conflict");

      setTestNow("2026-11-21T16:00:01.000Z");
      const { expireDueHolds } = await import("@/server/handoffs");
      await expireDueHolds();
      expect((await handoffRow(res.handoff.id)).status).toBe("expired");
      expect(await codeOf(offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 100, paymentMethod: "other" }, actor))).toBe("conflict");
      // Nothing half-written: the transaction rolled back.
      const db = await getDb();
      expect(await db.select().from(schema.awards)).toHaveLength(0);
      expect(await eventsOf(sgo, "award.offered")).toHaveLength(0);
    });

    it("a standalone award (no booking) with a student from the verification's household", async () => {
      const verificationId = await standalone();
      const household = await makeHousehold();
      await setVerificationState(verificationId, { householdId: household.householdId, studentMemberIds: [household.studentId] });
      expect(await codeOf(offerAward(sgo, { verificationId, studentMemberId: household.otherHouseholdStudentId, amountCents: 5000, paymentMethod: "qualified_digital_wallet" }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { verificationId, studentMemberId: "member_missing", amountCents: 5000, paymentMethod: "qualified_digital_wallet" }, actor))).toBe("validation_failed");
      const { award, handoff: h } = await offerAward(sgo, { verificationId, studentMemberId: household.studentId, amountCents: 5000, paymentMethod: "qualified_digital_wallet" }, actor);
      expect(h).toBeNull();
      expect(award).toMatchObject({ handoffId: null, studentMemberId: household.studentId });
    });

    it("validates the amount, the payment method and unknown fields", async () => {
      const verificationId = await standalone();
      const base = { verificationId, amountCents: 1000, paymentMethod: "other" as const };
      expect(await codeOf(offerAward(sgo, { ...base, amountCents: 0 }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { ...base, amountCents: -5 }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { ...base, amountCents: 10.5 }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { ...base, amountCents: MAX_AWARD_CENTS + 1 }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { ...base, paymentMethod: "cash_to_family" as "other" }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { ...base, notes: "x".repeat(2001) }, actor))).toBe("validation_failed");
      expect(await codeOf(offerAward(sgo, { ...base, payToFamily: true } as typeof base, actor))).toBe("validation_failed");
    });

    it("tenant isolation and roles: only the SGO's own deciders, keys and verifications", async () => {
      const res = await eligibleHandoff();
      const input = { verificationId: res.handoff.verificationId!, amountCents: 1000, paymentMethod: "other" as const };
      // Another SGO cannot see this verification.
      const otherReviewer = await makeUser();
      await addMember(otherSgo, otherReviewer, "reviewer");
      expect(await codeOf(offerAward(otherSgo, input, { type: "user", userId: otherReviewer, mode: "test" }))).toBe("not_found");
      // Not a member, a viewer, or a member acting on the wrong org id.
      expect(await codeOf(offerAward(sgo, input, { type: "user", userId: otherReviewer, mode: "test" }))).toBe("forbidden");
      expect(await codeOf(offerAward(sgo, input, { type: "user", userId: viewer, mode: "test" }))).toBe("forbidden");
      // A business (not an SGO) cannot award, even with its own key.
      expect(await codeOf(offerAward(biz.orgId, input, { type: "api_key", apiKeyId: await makeApiKey(biz.orgId), mode: "test" }))).toBe("forbidden");
      // The SGO's key of the other mode does not see test data; a live key is refused for a test verification.
      expect(await codeOf(offerAward(sgo, input, { type: "api_key", apiKeyId: await makeApiKey(sgo, "test"), mode: "live" }))).toBe("forbidden");
      expect(await codeOf(offerAward(sgo, input, { type: "api_key", apiKeyId: await makeApiKey(sgo, "live"), mode: "live" }))).toBe("not_found");
      // The SGO's own test key works.
      const { award } = await offerAward(sgo, input, { type: "api_key", apiKeyId: await makeApiKey(sgo, "test"), mode: "test" });
      expect(award.decidedBy).toBeNull();
    });
  });

  describe("declineAwardForHandoff", () => {
    it("declines the booking; the business hears only 'declined', never the reason", async () => {
      const res = await eligibleHandoff();
      expect(await codeOf(declineAwardForHandoff(sgo, res.handoff.id, { reason: "" }, actor))).toBe("validation_failed");
      const declined = await declineAwardForHandoff(sgo, res.handoff.id, { reason: "Synthetic: fund exhausted for this session" }, actor);
      expect(declined).toMatchObject({ status: "declined", declineReason: "sgo_declined" });
      const [ev] = await eventsOf(biz.orgId, "handoff.declined");
      expect(ev.payload).toMatchObject({ status: "declined", verification_status: "eligible", award: null });
      expect(JSON.stringify(ev.payload)).not.toMatch(/exhausted|sgo_declined/);
      // Declining again is a no-op without a second event.
      await declineAwardForHandoff(sgo, res.handoff.id, { reason: "Synthetic again" }, actor);
      expect(await eventsOf(biz.orgId, "handoff.declined")).toHaveLength(1);
    });

    it("is allowed while the decision is pending, refused after an award (revoke instead) and for another SGO", async () => {
      const held = await handoff();
      await setVerificationState(held.handoff.verificationId!, { status: "needs_review", submitted: true });
      await applyVerificationOutcome({ handoffId: held.handoff.id, verificationId: held.handoff.verificationId! });
      expect((await declineAwardForHandoff(sgo, held.handoff.id, { reason: "Synthetic reason" }, actor)).status).toBe("declined");

      const res = await eligibleHandoff();
      await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 1000, paymentMethod: "other" }, actor);
      expect(await codeOf(declineAwardForHandoff(sgo, res.handoff.id, { reason: "Synthetic reason" }, actor))).toBe("conflict");

      const otherReviewer = await makeUser();
      await addMember(otherSgo, otherReviewer, "reviewer");
      const third = await eligibleHandoff();
      expect(await codeOf(declineAwardForHandoff(otherSgo, third.handoff.id, { reason: "Synthetic reason" }, { type: "user", userId: otherReviewer, mode: "test" }))).toBe("not_found");
      expect((await handoffRow(third.handoff.id)).status).toBe("eligible");
    });
  });

  describe("updateAwardStatus", () => {
    it("offered → accepted → paid; paid is final; setting the same status is a no-op", async () => {
      const verificationId = await standalone();
      const { award } = await offerAward(sgo, { verificationId, amountCents: 5000, paymentMethod: "other" }, actor);
      expect((await updateAwardStatus(sgo, award.id, { status: "accepted" }, actor)).award.status).toBe("accepted");
      expect((await updateAwardStatus(sgo, award.id, { status: "accepted" }, actor)).award.status).toBe("accepted");
      expect((await updateAwardStatus(sgo, award.id, { status: "paid", note: "Synthetic check 101" }, actor)).award.status).toBe("paid");
      expect(await codeOf(updateAwardStatus(sgo, award.id, { status: "revoked", note: "Synthetic reason" }, actor))).toBe("conflict");
      expect(await codeOf(updateAwardStatus(sgo, award.id, { status: "offered" as "paid" }, actor))).toBe("validation_failed");
    });

    it("revoking needs a reason and declines a booking that is still awarded", async () => {
      const res = await eligibleHandoff();
      const { award } = await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 1000, paymentMethod: "direct_to_vendor" }, actor);
      expect(await codeOf(updateAwardStatus(sgo, award.id, { status: "revoked" }, actor))).toBe("validation_failed");
      const out = await updateAwardStatus(sgo, award.id, { status: "revoked", note: "Synthetic: issued in error" }, actor);
      expect(out.award.status).toBe("revoked");
      expect(out.handoff).toMatchObject({ status: "declined", declineReason: "award_revoked" });
      const [ev] = await eventsOf(biz.orgId, "handoff.declined");
      // A revoked award is no longer shown to the business.
      expect(ev.payload).toMatchObject({ award: null });
    });

    it("an award on a completed booking cannot be revoked here", async () => {
      const res = await eligibleHandoff();
      const { award } = await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 1000, paymentMethod: "direct_to_vendor" }, actor);
      await completeHandoff(biz.orgId, res.handoff.id, handoffSystemActor("awards test"));
      expect(await codeOf(updateAwardStatus(sgo, award.id, { status: "revoked", note: "Synthetic reason" }, actor))).toBe("conflict");
      expect((await updateAwardStatus(sgo, award.id, { status: "paid" }, actor)).award.status).toBe("paid");
      expect((await handoffRow(res.handoff.id)).status).toBe("completed");
    });

    it("another SGO's award, or the other mode's, is not found", async () => {
      const verificationId = await standalone();
      const { award } = await offerAward(sgo, { verificationId, amountCents: 5000, paymentMethod: "other" }, actor);
      const otherReviewer = await makeUser();
      await addMember(otherSgo, otherReviewer, "reviewer");
      expect(await codeOf(updateAwardStatus(otherSgo, award.id, { status: "paid" }, { type: "user", userId: otherReviewer, mode: "test" }))).toBe("not_found");
      expect(await codeOf(updateAwardStatus(sgo, award.id, { status: "paid" }, { ...actor, mode: "live" }))).toBe("not_found");
      expect(await codeOf(updateAwardStatus(sgo, award.id, { status: "paid" }, { type: "user", userId: viewer, mode: "test" }))).toBe("forbidden");
    });
  });

  describe("reads", () => {
    it("listAwards is scoped to the SGO and mode, filters, and paginates newest first", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        setTestNow(new Date(Date.parse(NOW) + i * 1000));
        const { award } = await offerAward(sgo, { verificationId: await standalone(), amountCents: 1000 + i, paymentMethod: "other" }, actor);
        ids.push(award.id);
      }
      const otherReviewer = await makeUser();
      await addMember(otherSgo, otherReviewer, "reviewer");
      await offerAward(otherSgo, { verificationId: await standalone(otherSgo), amountCents: 999, paymentMethod: "other" }, { type: "user", userId: otherReviewer, mode: "test" });

      const first = await listAwards(sgo, { mode: "test", limit: 2 });
      expect(first.data.map((a) => a.id)).toEqual([ids[2], ids[1]]);
      expect(first.hasMore).toBe(true);
      const second = await listAwards(sgo, { mode: "test", limit: 2, before: first.nextCursor! });
      expect(second.data.map((a) => a.id)).toEqual([ids[0]]);
      expect(second.hasMore).toBe(false);
      expect((await listAwards(sgo, { mode: "live" })).data).toHaveLength(0);
      expect((await listAwards(sgo, { mode: "test", status: "paid" })).data).toHaveLength(0);
      expect(await codeOf(listAwards(sgo, { mode: "test", limit: 0 }))).toBe("validation_failed");
      expect(await codeOf(listAwards(sgo, { mode: "test", before: "award_unknown" }))).toBe("bad_request");
    });

    it("getAwardContext gives the booking, the ceiling, the awardable flag and the camp caution", async () => {
      const res = await eligibleHandoff(60_000);
      const ctx = await getAwardContext(sgo, res.handoff.verificationId!, { mode: "test" });
      expect(ctx.verification).toMatchObject({ id: res.handoff.verificationId, status: "eligible", awardable: true });
      expect(ctx.handoff).toMatchObject({ id: res.handoff.id, business: { vendorType: "summer_camp" }, booking: { amountCents: 60_000, amountConfirmed: true } });
      expect(ctx.maxAmountCents).toBe(60_000);
      expect(ctx.reminders.map((r) => r.code)).toContain("vendor_type_not_settled");

      await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: 1000, paymentMethod: "other" }, actor);
      expect((await getAwardContext(sgo, res.handoff.verificationId!, { mode: "test" })).verification.awardable).toBe(false);

      // A hold whose deadline passed is not awardable, even before the expiry job has swept it.
      const lapsing = await eligibleHandoff(60_000);
      setTestNow("2026-11-21T16:00:00.000Z");
      expect((await getAwardContext(sgo, lapsing.handoff.verificationId!, { mode: "test" })).verification.awardable).toBe(false);
      setTestNow(NOW);

      const plain = await standalone(sgo, "pending");
      const pctx = await getAwardContext(sgo, plain, { mode: "test" });
      expect(pctx).toMatchObject({ handoff: null, maxAmountCents: null, verification: { awardable: false } });
      expect(pctx.reminders.map((r) => r.code)).not.toContain("vendor_type_not_settled");
      expect(await codeOf(getAwardContext(otherSgo, plain, { mode: "test" }))).toBe("not_found");
    });
  });
});
