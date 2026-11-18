import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { listAuditLogs } from "@/server/audit";
import { setSetting } from "@/server/settings";
import { renderCopy } from "@/taxmath";
import { useTestDb } from "../../../tests/helpers/db";
import { getCheckout, placeOrder, saveCheckout, startCheckout } from "./checkout";
import type { CheckoutPatch } from "./form";
import { getDonationForSgo, listDonationsForSgo } from "./read";
import { recordOperatorRefund } from "./refunds";
import { createListedSgo, createPlatformAdmin, drainJobs, jointPatch, paySandbox, singleFilerPatch, type ListedSgo } from "./test-support";

/*
 * The checkout matrix end to end: filing situations, designation choices, State credit input, the gates, the
 * designation record's immutability, and the three fee structures with their ledger. All data is synthetic.
 */

const BEFORE_START = new Date("2026-12-10T15:00:00.000Z");
const AFTER_START = new Date("2027-03-10T15:00:00.000Z");
const STAFF = { actor: { type: "user" as const, id: "usr_synthetic_staff" } };

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

describe("checkout matrix", () => {
  const t = useTestDb();
  let sgo: ListedSgo;
  let admin: string;

  beforeEach(async () => {
    setTestNow(AFTER_START);
    sgo = await createListedSgo({ portalRegistered: true });
    admin = await createPlatformAdmin();
  });
  afterEach(() => setTestNow(null));

  async function prepare(patch: CheckoutPatch) {
    const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
    await saveCheckout(token, patch);
    const view = await saveCheckout(token, { designationConfirmed: true });
    return { token, view };
  }

  async function give(patch: CheckoutPatch) {
    const { token } = await prepare(patch);
    const placed = await placeOrder(token);
    await paySandbox(placed.payment);
    await drainJobs();
    return { token, placed };
  }

  describe("filing situations", () => {
    it("single filer: one donor, one donation, credit preview capped at $1,700", async () => {
      const { view } = await prepare(singleFilerPatch({ giftCents: 170_000 }));
      expect(view.canPlaceOrder).toBe(true);
      expect(view.preview?.totals).toMatchObject({ designatedCents: 170_000, creditCents: 170_000 });
      await give(singleFilerPatch({ giftCents: 170_000 }));
      expect(await t.db.select().from(schema.donors)).toHaveLength(1);
      expect(await t.db.select().from(schema.donations)).toMatchObject([{ taxpayerRole: "individual", filingStatus: "single", designatedAmountCents: 170_000, status: "succeeded" }]);
    });

    it("married filing jointly, both spouses give: two donors and donations, $3,400 of preview credit", async () => {
      const { view } = await prepare(jointPatch());
      expect(view.order.contributors.map((c) => [c.key, c.giftCents, c.designatedCents])).toEqual([
        ["primary", 170_000, 170_000],
        ["spouse", 170_000, 170_000],
      ]);
      expect(view.preview?.totals.creditCents).toBe(340_000);
      await give(jointPatch());
      const donations = await t.db.select().from(schema.donations);
      expect(donations.map((d) => [d.taxpayerRole, d.designatedAmountCents]).sort()).toEqual([
        ["spouse_1", 170_000],
        ["spouse_2", 170_000],
      ]);
      expect(new Set(donations.map((d) => d.paymentId)).size).toBe(1);
    });

    it("married filing jointly, only one spouse gives: one donor, and only that spouse's $1,700 cap applies", async () => {
      const patch = jointPatch({ giftCents: 170_000, bothSpousesContribute: false, contributors: { primary: { firstName: "Jordan", lastName: "Testperson" }, spouse: null }, attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true } });
      const { view } = await prepare(patch);
      expect(view.order.contributors).toHaveLength(1);
      expect(view.preview?.taxpayers).toHaveLength(1);
      expect(view.preview?.totals.creditCents).toBe(170_000);
      expect(view.canPlaceOrder).toBe(true);
      // $3,400 from one spouse: the default designation is that spouse's cap; the rest would be non-designated.
      const over = await prepare({ ...patch, giftCents: 340_000 });
      expect(over.view.order.contributors[0]).toMatchObject({ designatedCents: 170_000, nonDesignatedCents: 170_000 });
      await give(patch);
      expect(await t.db.select().from(schema.donors)).toHaveLength(1);
      expect(await t.db.select().from(schema.donations)).toMatchObject([{ filingStatus: "married_joint", designatedAmountCents: 170_000 }]);
    });
  });

  describe("designation choices", () => {
    it("partial designation: explained in the view and refused at the order until non-designated gifts can settle outside the 25F account", async () => {
      const { token, view } = await prepare(singleFilerPatch({ giftCents: 200_000, contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 150_000 } } }));
      expect(view.order).toMatchObject({ designatedCents: 150_000, nonDesignatedCents: 50_000 });
      expect(view.capabilities.nonDesignatedCollectible).toBe(false);
      expect(view.canPlaceOrder).toBe(false);
      expect((await errorOf(placeOrder(token))).code).toBe("validation_failed");
      expect(await t.db.select().from(schema.donations)).toHaveLength(0);
    });

    it("over-cap designation: allowed (never hard-blocked), the preview credit stays capped and the excess is explained", async () => {
      const patch = singleFilerPatch({ giftCents: 250_000, contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 250_000 } } });
      const { view } = await prepare(patch);
      expect(view.errors).toEqual({});
      expect(view.preview?.totals).toMatchObject({ designatedCents: 250_000, creditCents: 170_000, overCapCents: 80_000 });
      await give(patch);
      expect(await t.db.select().from(schema.donations)).toMatchObject([{ designatedAmountCents: 250_000, nonDesignatedAmountCents: 0, status: "succeeded" }]);
    });

    it("State credit input reduces the previewed federal credit and is stored with the gift", async () => {
      const patch = singleFilerPatch({ contributors: { primary: { firstName: "Avery", lastName: "Synthetic", expectedStateCreditCents: 40_000 } } });
      const { view } = await prepare(patch);
      expect(view.preview?.totals).toMatchObject({ stateCreditCents: 40_000, removedByStateCreditCents: 40_000, creditCents: 130_000 });
      await give(patch);
      expect(await t.db.select().from(schema.donations)).toMatchObject([{ expectedStateCreditCents: 40_000 }]);
    });
  });

  describe("gates", () => {
    it("before the credit start date: the sandbox gift succeeds and is recorded NOT credit-eligible with the exact reason shown", async () => {
      setTestNow(BEFORE_START);
      const { view } = await prepare(singleFilerPatch());
      expect(view.eligibility.blockers.map((b) => b.code)).toContain("before_credit_start");
      expect(view.labels.beforeCreditStart).toBeTruthy();
      await give(singleFilerPatch());
      const [d] = await t.db.select().from(schema.donations);
      expect(d).toMatchObject({ status: "succeeded", creditEligible: false, taxYear: 2026 });
      const charge = d.eligibilityAtCharge as { ineligibleReason: string; blockers: Array<{ code: string; message: string }> };
      expect(charge.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["before_credit_start", "sandbox_mode"]));
      expect(d.creditIneligibleReason).toBeTruthy();
      expect(d.creditIneligibleReason).toBe(charge.ineligibleReason);
      const [receipt] = await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"));
      expect(receipt.text).toContain(renderCopy("receipt.not_credit_eligible"));
      const beforeStart = charge.blockers.find((b) => b.code === "before_credit_start");
      expect(receipt.text.replace(/\s+/g, " ")).toContain(beforeStart?.message.replace(/\s+/g, " "));
    });

    it("an SGO only on the provisional list is labeled so and never credit-eligible", async () => {
      const { view } = await prepare(singleFilerPatch());
      expect(view.list.status).toBe("provisional");
      expect(view.labels.provisionalList).toBeTruthy();
      expect(view.eligibility.blockers.map((b) => b.code)).toContain("sgo_list_provisional");
      await give(singleFilerPatch());
      const [d] = await t.db.select().from(schema.donations);
      expect(d).toMatchObject({ creditEligible: false, sgoListStatusAtGift: "provisional" });
    });

    it("a missing attestation blocks the order with the field named", async () => {
      for (const key of ["individual", "usCitizenOrResident", "noEarmark", "notInExchangeForScholarship"] as const) {
        const { token, view } = await prepare(singleFilerPatch({ attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true, [key]: false } }));
        expect(view.errors[`attestations.${key}`]).toBeTruthy();
        const err = await errorOf(placeOrder(token));
        expect(err.code).toBe("validation_failed");
        expect((err.details as { fields: Record<string, string> }).fields[`attestations.${key}`]).toBeTruthy();
      }
      expect(await t.db.select().from(schema.donations)).toHaveLength(0);
    });

    it("a joint gift needs the 'on behalf of both spouses' attestation", async () => {
      const { token } = await prepare(jointPatch({ attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true, jointOnBehalfOfBoth: false } }));
      expect((await errorOf(placeOrder(token))).code).toBe("validation_failed");
    });
  });

  describe("designation record", () => {
    it("is immutable: payment, refund and later saves never change the words, hashes, time or amounts", async () => {
      const { token, placed } = await give(singleFilerPatch());
      const designationOf = async () => {
        const [d] = await t.db.select().from(schema.donations).where(eq(schema.donations.id, placed.donationIds[0]));
        return { at: d.designatedAt, text: d.designationText, sha: d.designationTextSha256, template: d.designationTemplateSha256, version: d.designationCopyVersion, amount: d.designatedAmountCents, attestations: d.attestations, designated: d.designated25f };
      };
      const before = await designationOf();
      expect(before.text).toContain("$1,700");
      expect((await errorOf(saveCheckout(token, { giftCents: 100_000 }))).code).toBe("conflict");
      expect((await errorOf(placeOrder(token))).code).toBe("conflict");
      expect((await getCheckout(token)).capabilities.editable).toBe(false);

      setTestNow(new Date(AFTER_START.getTime() + 86_400_000));
      await recordOperatorRefund({ donationId: placed.donationIds[0], actorUserId: admin, reason: "Synthetic duplicate gift confirmed", counselReference: "COUNSEL-SYNTHETIC-1" });
      await drainJobs();
      const after = await designationOf();
      expect(after).toEqual(before);
      const [d] = await t.db.select().from(schema.donations);
      expect(d.status).toBe("refunded");
      expect(d.designated25f).toBe(true);
    });
  });

  describe("fee structures", () => {
    async function ledger() {
      return t.db.select().from(schema.feeLedger);
    }

    it("none: nothing is charged on top, no ledger rows, and the full gift is designated", async () => {
      const { placed } = await give(singleFilerPatch());
      expect(placed.payment.amountCents).toBe(170_000);
      expect(await ledger()).toEqual([]);
      expect(await t.db.select().from(schema.donations)).toMatchObject([{ feeStructure: "none", platformFeeCents: 0, donorServiceFeeCents: 0, designatedAmountCents: 170_000 }]);
    });

    it("cannot leave none without a counsel memo reference", async () => {
      for (const active of ["sgo_invoiced", "donor_service_fee"] as const) {
        await expect(setSetting("fees.structure", { active, sgoFeeBps: 100, donorServiceFeeBps: 100, counselMemoRef: null, approvedAt: null }, { actorUserId: admin })).rejects.toMatchObject({ code: "validation_failed" });
        await expect(setSetting("fees.structure", { active, sgoFeeBps: 100, donorServiceFeeBps: 100, counselMemoRef: "  ", approvedAt: null }, { actorUserId: admin })).rejects.toMatchObject({ code: "validation_failed" });
      }
      const { placed } = await give(singleFilerPatch());
      expect(placed.payment.amountCents).toBe(170_000);
    });

    it("sgo_invoiced: the donor pays exactly the gift, the full amount is designated, and the SGO owes a ledger fee", async () => {
      await setSetting("fees.structure", { active: "sgo_invoiced", sgoFeeBps: 100, donorServiceFeeBps: 0, counselMemoRef: "MEMO-SYNTHETIC-1", approvedAt: null }, { actorUserId: admin });
      const { placed } = await give(singleFilerPatch());
      expect(placed.payment.amountCents).toBe(170_000);
      const [d] = await t.db.select().from(schema.donations);
      expect(d).toMatchObject({ designatedAmountCents: 170_000, feeStructure: "sgo_invoiced", platformFeeCents: 1_700, donorServiceFeeCents: 0 });
      expect(await ledger()).toMatchObject([{ kind: "sgo_platform_fee", payerOrgId: sgo.orgId, amountCents: 1_700, status: "accrued", donationId: d.id, feeBps: 100, baseCents: 170_000 }]);
      const [receipt] = await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"));
      expect(receipt.text).not.toContain("$17");
    });

    it("donor_service_fee: a separate fee on top, never part of or taken from the designated amount", async () => {
      await setSetting("fees.structure", { active: "donor_service_fee", sgoFeeBps: 0, donorServiceFeeBps: 200, counselMemoRef: "MEMO-SYNTHETIC-2", approvedAt: null }, { actorUserId: admin });
      const { view } = await prepare(singleFilerPatch());
      expect(view.totals).toMatchObject({ designatedCents: 170_000, donorServiceFeeCents: 3_400, chargedCents: 173_400, depositedTo25fAccountCents: 170_000 });
      expect(view.preview?.totals.creditCents).toBe(170_000);
      const { placed } = await give(singleFilerPatch());
      expect(placed.payment.amountCents).toBe(173_400);
      expect(placed.payment.lines.map((l) => [l.kind, l.amountCents])).toEqual([
        ["designated_contribution", 170_000],
        ["donor_service_fee", 3_400],
      ]);
      const [d] = await t.db.select().from(schema.donations);
      expect(d).toMatchObject({ designatedAmountCents: 170_000, donorServiceFeeCents: 3_400 });
      expect(await ledger()).toMatchObject([{ kind: "donor_service_fee", amountCents: 3_400, donationId: d.id }]);
      const [receipt] = await t.db.select().from(schema.emails).where(eq(schema.emails.template, "donation_receipt"));
      expect(receipt.text).toContain(renderCopy("fee.line.donor_service_fee"));
      expect(receipt.text).toContain(renderCopy("fee.line.designated_contribution"));
      expect(receipt.text).not.toMatch(/\bfree\b/i);
      // The fee line never calls the fee a contribution.
      const feeLine = receipt.text.split("\n").find((l) => l.includes(renderCopy("fee.line.donor_service_fee")));
      expect(feeLine).not.toMatch(/qualified contribution|designated/i);
    });
  });

  describe("tenant isolation and audit", () => {
    it("never shows one SGO's donations to another", async () => {
      const { placed } = await give(singleFilerPatch());
      const other = await createListedSgo({ portalRegistered: true });
      expect((await listDonationsForSgo(other.orgId, { mode: "test" }, STAFF)).items).toEqual([]);
      expect((await errorOf(getDonationForSgo(other.orgId, placed.donationIds[0], STAFF))).code).toBe("not_found");
      expect((await listDonationsForSgo(sgo.orgId, { mode: "test" }, STAFF)).items).toHaveLength(1);
      expect((await getDonationForSgo(sgo.orgId, placed.donationIds[0], STAFF)).donation.id).toBe(placed.donationIds[0]);
      expect((await listDonationsForSgo(sgo.orgId, { mode: "live" }, STAFF)).items).toEqual([]);
      const actions = (await listAuditLogs({})).items.map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["donation.order_placed", "donation.succeeded", "donation.list", "donation.read"]));
    });
  });
});
