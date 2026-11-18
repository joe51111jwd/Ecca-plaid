import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { parseCsv } from "@/lib/csv";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listPendingAcknowledgmentRefreshes } from "@/server/acknowledgments";
import { listAuditLogs } from "@/server/audit";
import { listEvents } from "@/server/events";
import { enqueue } from "@/server/jobs";
import { setSetting } from "@/server/settings";
import { useTestDb } from "../../../tests/helpers/db";
import { getCheckout, placeOrder, saveCheckout, startCheckout } from "./checkout";
import { handleDonationPaymentUpdated } from "./payment-updated";
import { donorTotalsForSgo, exportDonationsCsv, getDonationForSgo, listDonationsForSgo, listGiftsForUser } from "./read";
import { recordOperatorRefund } from "./refunds";
import { withdrawEDeliveryConsent } from "./consents";
import { createListedSgo, createPlatformAdmin, drainJobs, jointPatch, paySandbox, removeFromList, singleFilerPatch, type ListedSgo } from "./test-support";

/* All organizations, people, addresses and EINs are synthetic. */

const NOW = new Date("2026-12-10T15:00:00.000Z");
const STAFF = { actor: { type: "user" as const, id: "usr_synthetic_staff" } };

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected an error");
}

describe("donation lifecycle", () => {
  const t = useTestDb();
  let sgo: ListedSgo;

  beforeEach(async () => {
    setTestNow(NOW);
    sgo = await createListedSgo({ portalRegistered: true });
  });
  afterEach(() => setTestNow(null));

  async function order(patch = singleFilerPatch(), extra: Parameters<typeof saveCheckout>[1] = {}) {
    const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
    await saveCheckout(token, patch);
    await saveCheckout(token, { designationConfirmed: true, ...extra });
    return { token, placed: await placeOrder(token) };
  }

  const donationRows = () => t.db.select().from(schema.donations);

  it("finishes a succeeded gift: status, charge time, tax year, re-assessment, receipt, event, totals, acknowledgment", async () => {
    const { token, placed } = await order(singleFilerPatch(), { contributors: { primary: { eDeliveryConsent: true } } });
    await paySandbox(placed.payment);
    await drainJobs();

    const [d] = await donationRows();
    expect(d).toMatchObject({ status: "succeeded", contributedAt: NOW, taxYear: 2026, yearBoundaryAmbiguous: false, creditEligible: false, sgoListStatusAtGift: "provisional", sgoListEntryIdAtGift: sgo.entryId });
    expect(d.creditIneligibleReason).toMatch(/Sandbox/);
    expect(d.relianceAtOrder).toMatchObject({ checkedAt: NOW.toISOString() });
    expect(d.relianceAtCharge).toMatchObject({ entryId: sgo.entryId, status: "provisional", checkedAt: NOW.toISOString() });
    expect((d.eligibilityAtCharge as { blockers: Array<{ code: string }> }).blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["sandbox_mode", "before_credit_start", "sgo_list_provisional"]));
    expect((await getCheckout(token)).session.status).toBe("completed");

    const [email] = await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"));
    expect(email).toMatchObject({ toEmail: "donor@synthetic.example", id: d.receiptEmailId, status: "sent" });
    expect(email.subject).toMatch(/^\[Sandbox\] Payment receipt/);
    expect(email.text).toContain("not the official written acknowledgment");
    expect(email.text).toContain("Sandbox receipt. No money moved");
    expect(email.text).toContain("not labeled credit-eligible");

    const events = await listEvents({ orgId: sgo.orgId, mode: "test" });
    expect(events.map((e) => e.type)).toEqual(["donation.succeeded"]);
    expect(events[0].payload).toMatchObject({ id: d.id, object: "donation", designated_25f: true, designated_amount_cents: 170_000, designation: { text: d.designationText }, donor: { first_name: "Avery", last_name: "Synthetic" }, e_delivery_consent: true });
    expect(JSON.stringify(events[0].payload)).not.toMatch(/"(ssn|tin|itin|tax_id|taxpayer_id)"/i);

    const [totals] = await t.db.select().from(schema.donorYearTotals);
    expect(totals).toMatchObject({ orgId: sgo.orgId, donorId: d.donorId, taxYear: 2026, designatedCents: 170_000, giftCount: 1 });
    expect(totals.substantialContributor).toMatchObject({ status: "not_flagged", sgoTaxableYearBasis: "calendar_year" });
    const pending = await listPendingAcknowledgmentRefreshes({ mode: "test", orgId: sgo.orgId });
    expect(pending).toMatchObject([{ donorId: d.donorId, taxYear: 2026, reason: "gift_succeeded", lastDonationId: d.id }]);
  });

  it("is idempotent: duplicate and retried jobs change nothing a second time", async () => {
    const { placed } = await order();
    await paySandbox(placed.payment);
    await drainJobs();
    await handleDonationPaymentUpdated({ paymentId: placed.paymentId });
    await handleDonationPaymentUpdated({ paymentId: placed.paymentId });
    await enqueue("donation.payment_updated", { paymentId: placed.paymentId });
    await drainJobs();
    expect(await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"))).toHaveLength(1);
    expect((await listEvents({ orgId: sgo.orgId, mode: "test" })).filter((e) => e.type === "donation.succeeded")).toHaveLength(1);
    expect((await listAuditLogs({ action: "donation.succeeded" })).items).toHaveLength(1);
    const [totals] = await t.db.select().from(schema.donorYearTotals);
    expect(totals.designatedCents).toBe(170_000);
  });

  it("rejects a malformed job payload and ignores a payment with no order", async () => {
    await expect(handleDonationPaymentUpdated({})).rejects.toThrow();
    await expect(handleDonationPaymentUpdated({ paymentId: "pay_missing" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("re-assesses as of the charge: a removal between order and charge is recorded, and the money still counts", async () => {
    const { placed } = await order();
    setTestNow(new Date("2026-12-12T15:00:00.000Z"));
    await removeFromList(sgo, "2026-12-11");
    await paySandbox(placed.payment);
    await drainJobs();
    const [d] = await donationRows();
    expect(d.status).toBe("succeeded");
    expect(d.sgoListStatusAtGift).toBe("removed");
    expect(d.relianceAtOrder).toMatchObject({ status: "provisional" });
    expect(d.relianceAtCharge).toMatchObject({ status: "removed", refused: { reason: "sgo_removed" } });
    expect((d.eligibilityAtCharge as { blockers: Array<{ code: string }> }).blockers.map((b) => b.code)).toContain("sgo_removed");
  });

  it("assigns a gift charged just after midnight on January 1 UTC to the donor's local year, flagged ambiguous", async () => {
    const { placed } = await order();
    setTestNow(new Date("2027-01-01T03:00:00.000Z")); // still December 31 in Austin
    await paySandbox(placed.payment);
    await drainJobs();
    const [d] = await donationRows();
    expect(d).toMatchObject({ taxYear: 2026, yearBoundaryAmbiguous: true });
  });

  it("marks a declined payment failed and reopens the checkout; paying again on the same payment succeeds", async () => {
    const { token, placed } = await order();
    await paySandbox(placed.payment, "4000000000000002");
    await drainJobs();
    let [d] = await donationRows();
    expect(d).toMatchObject({ status: "failed" });
    expect(d.failureReason).toMatch(/declined/);
    expect((await getCheckout(token)).session.status).toBe("open");

    const again = await placeOrder(token);
    expect(again.paymentId).toBe(placed.paymentId);
    await paySandbox(again.payment);
    await drainJobs();
    [d] = await donationRows();
    expect(d.status).toBe("succeeded");
    expect((await getCheckout(token)).session.status).toBe("completed");
  });

  it("refuses to change a checkout whose payment is being processed", async () => {
    const { token, placed } = await order();
    await paySandbox(placed.payment, "4242424242420000"); // processing, settles later
    await drainJobs();
    expect((await errorOf(saveCheckout(token, { giftCents: 1_000 }))).code).toBe("conflict");
    const [d] = await donationRows();
    expect(d.status).toBe("pending");
  });

  it("cancels the replaced order's donations without reopening the checkout's newer order", async () => {
    const { token, placed } = await order();
    await saveCheckout(token, { giftCents: 100_000 });
    await saveCheckout(token, { designationConfirmed: true });
    const second = await placeOrder(token);
    await drainJobs();
    const rows = await donationRows();
    expect(rows.find((r) => r.id === placed.donationIds[0])?.status).toBe("canceled");
    expect(rows.find((r) => r.id === second.donationIds[0])?.status).toBe("pending");
    expect((await getCheckout(token)).session).toMatchObject({ status: "awaiting_payment", paymentId: second.paymentId });
    expect(await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"))).toHaveLength(0);
  });

  it("records the money's arrival and its return when the refund is seen before the success", async () => {
    const { placed } = await order();
    await t.db.update(schema.payments).set({ status: "refunded", paidAt: NOW, refundedAt: NOW, method: "card" }).where(eq(schema.payments.id, placed.paymentId));
    await handleDonationPaymentUpdated({ paymentId: placed.paymentId });
    const [d] = await donationRows();
    expect(d).toMatchObject({ status: "refunded", contributedAt: NOW, taxYear: 2026, refundedAt: NOW });
    expect((await listEvents({ orgId: sgo.orgId, mode: "test" })).map((e) => e.type).sort()).toEqual(["donation.refunded", "donation.succeeded"]);
    const [totals] = await t.db.select().from(schema.donorYearTotals);
    expect(totals).toMatchObject({ designatedCents: 0, giftCount: 0 });
    await handleDonationPaymentUpdated({ paymentId: placed.paymentId });
    expect((await listEvents({ orgId: sgo.orgId, mode: "test" }))).toHaveLength(2);
  });

  it("finishes a joint gift: two donations, combined advisory input, one receipt listing both spouses", async () => {
    const { placed } = await order(jointPatch({ giftCents: 1_200_000, contributors: { primary: { firstName: "Jordan", lastName: "Testperson", designatedCents: 600_000 }, spouse: { firstName: "Riley", lastName: "Testperson", designatedCents: 600_000 } } }));
    await paySandbox(placed.payment);
    await drainJobs();
    const rows = await donationRows();
    expect(rows.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
    const totals = await t.db.select().from(schema.donorYearTotals);
    expect(totals).toHaveLength(2);
    for (const row of totals) {
      expect(row.combinedWithSpouseCents).toBe(1_200_000);
      expect(row.substantialContributor).toMatchObject({ status: "over_amount_threshold_share_unknown", aggregateCents: 1_200_000 });
    }
    const receipts = await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].text).toContain("Jordan Testperson");
    expect(receipts[0].text).toContain("Riley Testperson");
    expect((await listEvents({ orgId: sgo.orgId, mode: "test" })).filter((e) => e.type === "donation.succeeded")).toHaveLength(2);
  });

  describe("operator refunds", () => {
    it("requires a platform admin, a reason and a counsel reference", async () => {
      const { placed } = await order();
      await paySandbox(placed.payment);
      await drainJobs();
      const [d] = await donationRows();
      const userId = newId("user");
      await t.db.insert(schema.users).values({ id: userId, email: "staff@synthetic.example" });
      expect((await errorOf(recordOperatorRefund({ donationId: d.id, actorUserId: userId, reason: "Donor asked for a refund", counselReference: "MEMO-1" }))).code).toBe("forbidden");
      const admin = await createPlatformAdmin();
      expect((await errorOf(recordOperatorRefund({ donationId: d.id, actorUserId: admin, reason: "short", counselReference: "MEMO-1" }))).code).toBe("validation_failed");
      expect((await errorOf(recordOperatorRefund({ donationId: d.id, actorUserId: admin, reason: "Donor asked for a refund", counselReference: "" }))).code).toBe("validation_failed");
      expect((await errorOf(recordOperatorRefund({ donationId: "don_missing", actorUserId: admin, reason: "Donor asked for a refund", counselReference: "MEMO-1" }))).code).toBe("not_found");
    });

    it("refunds the payment, then the donations follow: totals drop, fees void, event and acknowledgment refresh", async () => {
      await setSetting("fees.structure", { active: "sgo_invoiced", sgoFeeBps: 100, donorServiceFeeBps: 0, counselMemoRef: "MEMO-SYNTHETIC-2", approvedAt: null }, { actorUserId: null });
      const { placed } = await order();
      await paySandbox(placed.payment);
      await drainJobs();
      let fees = await t.db.select().from(schema.feeLedger);
      expect(fees).toMatchObject([{ kind: "sgo_platform_fee", status: "accrued", amountCents: 1_700, feeBps: 100, baseCents: 170_000, payerOrgId: sgo.orgId }]);
      const [d] = await donationRows();
      expect(d.designatedAmountCents).toBe(170_000);

      const admin = await createPlatformAdmin();
      const result = await recordOperatorRefund({ donationId: d.id, actorUserId: admin, reason: "Duplicate gift confirmed by the SGO", counselReference: "COUNSEL-SYNTHETIC-7" });
      expect(result).toMatchObject({ paymentId: placed.paymentId, donationIds: [d.id], refundStatus: "succeeded" });
      await drainJobs();
      const [after] = await donationRows();
      expect(after.status).toBe("refunded");
      expect(after.refundedAt).toEqual(NOW);
      fees = await t.db.select().from(schema.feeLedger);
      expect(fees[0]).toMatchObject({ status: "void" });
      const [totals] = await t.db.select().from(schema.donorYearTotals);
      expect(totals).toMatchObject({ designatedCents: 0, giftCount: 0 });
      expect((await listEvents({ orgId: sgo.orgId, mode: "test" })).map((e) => e.type)).toEqual(["donation.refunded", "donation.succeeded"]);
      expect((await listPendingAcknowledgmentRefreshes({ mode: "test" }))[0]).toMatchObject({ reason: "gift_refunded" });
      const audits = await listAuditLogs({ action: "donation.refund_requested" });
      expect(audits.items[0].metadata).toMatchObject({ counselReference: "COUNSEL-SYNTHETIC-7" });
      expect((await errorOf(recordOperatorRefund({ donationId: d.id, actorUserId: admin, reason: "Duplicate gift confirmed by the SGO", counselReference: "COUNSEL-SYNTHETIC-7" }))).code).toBe("conflict");
    });

    it("refuses to refund a gift that has not succeeded", async () => {
      const { placed } = await order();
      const admin = await createPlatformAdmin();
      expect((await errorOf(recordOperatorRefund({ donationId: placed.donationIds[0], actorUserId: admin, reason: "Donor asked for a refund", counselReference: "MEMO-1" }))).code).toBe("conflict");
    });
  });

  describe("read models", () => {
    it("lists, reads, totals and exports one SGO's donations, scoped to that SGO, and audits each read", async () => {
      const first = await order(singleFilerPatch(), { contributors: { primary: { eDeliveryConsent: true } } });
      await paySandbox(first.placed.payment);
      const second = await order(singleFilerPatch({ giftCents: 50_000 }));
      await paySandbox(second.placed.payment);
      await drainJobs();

      const page1 = await listDonationsForSgo(sgo.orgId, { mode: "test", limit: 1 }, STAFF);
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).toBeTruthy();
      const page2 = await listDonationsForSgo(sgo.orgId, { mode: "test", limit: 1, cursor: page1.nextCursor }, STAFF);
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
      expect(new Set([...page1.items, ...page2.items].map((i) => i.donation.id)).size).toBe(2);
      expect((await listDonationsForSgo(sgo.orgId, { mode: "live" }, STAFF)).items).toHaveLength(0);
      expect((await listDonationsForSgo(sgo.orgId, { mode: "test", taxYear: 2027 }, STAFF)).items).toHaveLength(0);
      expect((await listDonationsForSgo(sgo.orgId, { mode: "test", status: "succeeded" }, STAFF)).items).toHaveLength(2);

      const other = await createListedSgo();
      expect((await listDonationsForSgo(other.orgId, { mode: "test" }, STAFF)).items).toHaveLength(0);
      expect((await errorOf(getDonationForSgo(other.orgId, first.placed.donationIds[0], STAFF))).code).toBe("not_found");
      const detail = await getDonationForSgo(sgo.orgId, first.placed.donationIds[0], STAFF);
      expect(detail.donor.firstName).toBe("Avery");
      expect(detail.deliveryConsent?.email).toBe("donor@synthetic.example");
      expect(detail.jointWith).toBeNull();

      const totals = await donorTotalsForSgo(sgo.orgId, 2026, { mode: "test" }, STAFF);
      expect(totals).toHaveLength(1);
      expect(totals[0]).toMatchObject({ designatedCents: 220_000, giftCount: 2, donorNumber: { status: "not_assigned", number: null }, acknowledgment: { status: "not_generated", needsRegeneration: true }, eDelivery: { consented: true } });

      const csv = await exportDonationsCsv(sgo.orgId, { mode: "test", taxYear: 2026 }, STAFF);
      expect(csv.rowCount).toBe(2);
      expect(csv.filename).toBe(`sandbox-donations-${sgo.orgId}-2026.csv`);
      const [header, ...rows] = parseCsv(csv.csv);
      expect(header).toContain("designated_amount_cents");
      expect(header.filter((h) => /^(ssn|tin|itin|tax_id|taxpayer_id)$/i.test(h))).toEqual([]);
      expect(rows).toHaveLength(2);

      const actions = (await listAuditLogs({ orgId: sgo.orgId })).items.map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["donation.list", "donation.read", "donation.donor_totals", "donation.export"]));
      await expect(listDonationsForSgo(sgo.orgId, { mode: "test" }, undefined as never)).rejects.toMatchObject({ code: "forbidden" });
      await expect(listDonationsForSgo(sgo.orgId, { mode: "test", cursor: "garbage" }, STAFF)).rejects.toMatchObject({ code: "bad_request" });
    });

    it("shows the donor their gifts by SGO with EIN, the donor-number status and acknowledgment status", async () => {
      const userId = newId("user");
      await t.db.insert(schema.users).values({ id: userId, email: "donor@synthetic.example" });
      const { placed } = await order(singleFilerPatch(), { contributors: { primary: { eDeliveryConsent: true } } });
      await paySandbox(placed.payment);
      await drainJobs();
      const groups = await listGiftsForUser(userId);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        sgo: { orgId: sgo.orgId, ein: sgo.ein },
        donor: { fullName: "Avery Synthetic" },
        taxYear: 2026,
        designatedTotalCents: 170_000,
        donorNumber: { status: "not_assigned", number: null },
        acknowledgment: { status: "not_generated" },
        eDelivery: { consented: true },
      });
      expect(groups[0].donorNumber?.note).toMatch(/cannot be issued yet/);
      expect(groups[0].gifts[0]).toMatchObject({ status: "succeeded", designatedCents: 170_000 });

      const stranger = newId("user");
      await t.db.insert(schema.users).values({ id: stranger, email: "stranger@synthetic.example" });
      expect(await listGiftsForUser(stranger)).toEqual([]);
      expect((await errorOf(withdrawEDeliveryConsent({ consentId: groups[0].eDelivery.consentId as string, userId: stranger }))).code).toBe("not_found");
      await withdrawEDeliveryConsent({ consentId: groups[0].eDelivery.consentId as string, userId });
      expect((await listGiftsForUser(userId))[0].eDelivery).toMatchObject({ consented: false });
      expect((await donorTotalsForSgo(sgo.orgId, 2026, { mode: "test" }, STAFF))[0].eDelivery.consented).toBe(false);
      expect((await errorOf(withdrawEDeliveryConsent({ consentId: groups[0].eDelivery.consentId as string, userId }))).code).toBe("conflict");
    });

    it("shows a sandbox donor number as not valid for filing", async () => {
      const userId = newId("user");
      await t.db.insert(schema.users).values({ id: userId, email: "donor@synthetic.example" });
      const { placed } = await order();
      await paySandbox(placed.payment);
      await drainJobs();
      const [d] = await donationRows();
      await t.db.insert(schema.donorNumbers).values({ id: newId("donorNumber"), orgId: sgo.orgId, donorId: d.donorId, taxYear: 2026, mode: "test", number: "SANDBOX-0001", source: "sandbox_generated" });
      const [group] = await listGiftsForUser(userId);
      expect(group.donorNumber).toMatchObject({ status: "sandbox", number: "SANDBOX-0001" });
      expect(group.donorNumber?.note).toMatch(/not valid for filing/);
    });
  });
});
