import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { setSetting } from "@/server/settings";
import { COPY_VERSION } from "@/taxmath";
import { useTestDb } from "../../../tests/helpers/db";
import { getCheckout, getCheckoutPayment, placeOrder, saveCheckout, startCheckout } from "./checkout";
import { listGiftsForUser } from "./read";
import { createListedSgo, jointPatch, removeFromList, singleFilerPatch, type ListedSgo } from "./test-support";

/* All organizations, people, addresses and EINs are synthetic. */

const NOW = new Date("2026-12-10T15:00:00.000Z");

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

describe("donor checkout", () => {
  const t = useTestDb();
  let sgo: ListedSgo;

  beforeEach(async () => {
    setTestNow(NOW);
    sgo = await createListedSgo();
  });
  afterEach(() => setTestNow(null));

  /** Starts a checkout, saves a complete form and confirms the designation. */
  async function ready(patch = singleFilerPatch()) {
    const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
    await saveCheckout(token, patch);
    const view = await saveCheckout(token, { designationConfirmed: true });
    return { token, view };
  }

  describe("startCheckout", () => {
    it("starts a sandbox checkout for a directory-visible SGO and stores only the token's hash", async () => {
      const { token, view } = await startCheckout({ sgoSlug: sgo.slug, source: "widget" });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(view.mode).toBe("test");
      expect(view.session.status).toBe("open");
      expect(view.session.source).toBe("widget");
      expect(view.sgo.orgId).toBe(sgo.orgId);
      const [row] = await t.db.select().from(schema.checkoutSessions);
      expect(row.tokenHash).not.toBe(token);
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it("starts in live mode only when live gifts are switched on", async () => {
      await setSetting("gifts.liveEnabled", true, { actorUserId: null });
      const { view } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      expect(view.mode).toBe("live");
    });

    it("refuses SGOs the directory would not show", async () => {
      expect((await errorOf(startCheckout({ sgoSlug: "no-such-sgo", source: "hosted" }))).code).toBe("not_found");
      expect((await errorOf(startCheckout({ sgoSlug: "../etc", source: "hosted" }))).code).toBe("not_found");
      await removeFromList(sgo, "2026-12-01");
      const removed = await errorOf(startCheckout({ sgoSlug: sgo.slug, source: "hosted" }));
      expect(removed.code).toBe("conflict");
      expect(removed.message).toMatch(/Removed/);
      const future = await createListedSgo({ listedFrom: "2027-02-15" });
      expect((await errorOf(startCheckout({ sgoSlug: future.slug, source: "hosted" }))).code).toBe("not_found");
    });

    it("refuses an unknown source and an unknown user", async () => {
      expect((await errorOf(startCheckout({ sgoSlug: sgo.slug, source: "api" as "hosted" }))).code).toBe("validation_failed");
      expect((await errorOf(startCheckout({ sgoSlug: sgo.slug, source: "hosted", userId: "usr_missing" }))).code).toBe("forbidden");
    });
  });

  describe("saveCheckout", () => {
    it("saves incrementally and returns the view", async () => {
      const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      let view = await saveCheckout(token, { giftCents: 100_000 });
      expect(view.order.giftCents).toBe(100_000);
      expect(view.errors.filingStatus).toBeTruthy();
      view = await saveCheckout(token, { filingStatus: "single", email: "donor@synthetic.example" });
      expect(view.order.giftCents).toBe(100_000);
      expect(view.errors.filingStatus).toBeUndefined();
      expect((await getCheckout(token)).order.filingStatus).toBe("single");
    });

    it("refuses an SSN, a TIN or any other field the form does not define, and stores nothing", async () => {
      const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      for (const patch of [{ ssn: "123-45-6789" }, { contributors: { primary: { tin: "12-3456789" } } }, { note: "for a particular student" }]) {
        const error = await errorOf(saveCheckout(token, patch as never));
        expect(error.code).toBe("validation_failed");
      }
      const [row] = await t.db.select().from(schema.checkoutSessions);
      expect(JSON.stringify(row.form)).not.toMatch(/123-45-6789|12-3456789|particular/);
    });

    it("binds the designation confirmation to the words shown and clears it when they change", async () => {
      const { token, view } = await ready();
      expect(view.designation.confirmed).toBe(true);
      const changed = await saveCheckout(token, { giftCents: 150_000 });
      expect(changed.designation.confirmed).toBe(false);
      expect(changed.canPlaceOrder).toBe(false);
    });

    it("refuses to confirm the designation before it can be rendered", async () => {
      const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      expect((await errorOf(saveCheckout(token, { designationConfirmed: true }))).code).toBe("validation_failed");
    });

    it("records e-delivery consent against the address it names", async () => {
      const { token } = await ready();
      const view = await saveCheckout(token, { contributors: { primary: { eDeliveryConsent: true } } });
      expect(view.consents[0]).toMatchObject({ email: "donor@synthetic.example", given: true });
      const moved = await saveCheckout(token, { email: "other@synthetic.example" });
      expect(moved.consents[0].given).toBe(false);
    });

    it("expires an idle checkout", async () => {
      const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      setTestNow(new Date(NOW.getTime() + 4 * 86_400_000));
      expect((await errorOf(saveCheckout(token, { giftCents: 1_000 }))).code).toBe("gone");
      expect((await errorOf(getCheckout(token))).code).toBe("gone");
      const [row] = await t.db.select().from(schema.checkoutSessions);
      expect(row.status).toBe("expired");
    });

    it("refuses an unknown or malformed token without revealing anything", async () => {
      expect((await errorOf(getCheckout("short"))).code).toBe("not_found");
      expect((await errorOf(getCheckout("A".repeat(43)))).code).toBe("not_found");
      expect((await errorOf(saveCheckout(42 as unknown as string, {}))).code).toBe("not_found");
    });
  });

  describe("placeOrder", () => {
    it("creates the donor, the pending donation with its immutable designation record, and one payment", async () => {
      const { token, view } = await ready(singleFilerPatch());
      await saveCheckout(token, { contributors: { primary: { eDeliveryConsent: true } } });
      const order = await placeOrder(token, { request: { ip: "203.0.113.7", userAgent: "synthetic-agent" }, shownDesignationTextSha256: view.designation.statement?.textSha256 });
      expect(order.orderNumber).toBe(1);
      expect(order.donationIds).toHaveLength(1);
      expect(order.payment).toMatchObject({ provider: "sandbox", amountCents: 170_000, status: "requires_payment" });
      expect(order.view.session.status).toBe("awaiting_payment");

      const [donor] = await t.db.select().from(schema.donors);
      expect(donor).toMatchObject({ email: "donor@synthetic.example", firstName: "Avery", lastName: "Synthetic", addressLine1: "100 Synthetic Way", state: "TX", zip: "78701" });
      const [donation] = await t.db.select().from(schema.donations);
      expect(donation).toMatchObject({
        id: order.donationIds[0],
        status: "pending",
        paymentId: order.paymentId,
        taxpayerRole: "individual",
        designatedAmountCents: 170_000,
        nonDesignatedAmountCents: 0,
        designated25f: true,
        designatedAt: NOW,
        designationCopyVersion: COPY_VERSION,
        designationCopyId: "designation.statement",
        designationTextSha256: view.designation.statement?.textSha256,
        individualConfirmed: true,
        usCitizenOrResidentConfirmed: true,
        noEarmarkConfirmed: true,
        notInExchangeConfirmed: true,
        stateAllocation: "TX",
        feeStructure: "none",
        platformFeeCents: 0,
        donorServiceFeeCents: 0,
        goodsOrServicesProvided: false,
        creditEligible: false,
      });
      expect(donation.designationText).toContain("I designate $1,700 of this payment");
      expect(donation.attestations.map((a) => a.copyId)).toEqual(["attest.individual", "attest.us_citizen_or_resident", "attest.no_earmark", "attest.not_in_exchange"]);
      expect(donation.relianceAtOrder).toMatchObject({ entryId: sgo.entryId, source: "provisional_curated", status: "provisional", checkedAt: NOW.toISOString() });
      expect(donation.eligibilityAtOrder).toMatchObject({ creditEligible: false });

      const [consent] = await t.db.select().from(schema.donorDeliveryConsents);
      expect(consent).toMatchObject({ id: donation.eDeliveryConsentId, donorId: donor.id, orgId: sgo.orgId, email: "donor@synthetic.example", copyId: "attest.e_delivery_consent", copyVersion: COPY_VERSION, ip: "203.0.113.7" });
      expect(consent.text).toContain("donor@synthetic.example");

      const payments = await t.db.select().from(schema.payments);
      expect(payments).toHaveLength(1);
      expect(payments[0].metadata.idempotency_key).toBe(`checkout_${order.checkoutSessionId}_order_1`);
      const audits = await listAuditLogs({ action: "donation.order_placed" });
      expect(audits.items).toHaveLength(1);
    });

    it("is idempotent: placing the same order again returns the same order and payment", async () => {
      const { token } = await ready();
      const first = await placeOrder(token);
      const again = await placeOrder(token);
      expect(again.paymentId).toBe(first.paymentId);
      expect(again.donationIds).toEqual(first.donationIds);
      expect(await t.db.select().from(schema.donations)).toHaveLength(1);
      expect(await t.db.select().from(schema.payments)).toHaveLength(1);
      expect((await getCheckoutPayment(token)).paymentId).toBe(first.paymentId);
    });

    it("creates ONE order and ONE payment when the same order is placed twice concurrently (double click)", async () => {
      const { token } = await ready();
      const results = await Promise.allSettled([placeOrder(token), placeOrder(token), placeOrder(token)]);
      const placed = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>> => r.status === "fulfilled").map((r) => r.value);
      expect(placed.length).toBeGreaterThan(0);
      expect(new Set(placed.map((p) => p.paymentId)).size).toBe(1);
      expect(new Set(placed.map((p) => p.orderNumber))).toEqual(new Set([1]));
      const donations = await t.db.select().from(schema.donations);
      expect(donations).toHaveLength(1);
      expect(donations[0].paymentId).toBe(placed[0].paymentId);
      const payments = await t.db.select().from(schema.payments);
      expect(payments).toHaveLength(1);
      const [session] = await t.db.select().from(schema.checkoutSessions);
      expect(session.paymentId).toBe(placed[0].paymentId);
      expect(session.orderNumber).toBe(1);
    });

    it("needs a new order when an amount changes after the order was placed", async () => {
      const { token } = await ready();
      const first = await placeOrder(token);
      await saveCheckout(token, { giftCents: 100_000 });
      await saveCheckout(token, { designationConfirmed: true });
      const second = await placeOrder(token);
      expect(second.orderNumber).toBe(2);
      expect(second.paymentId).not.toBe(first.paymentId);
      const rows = await t.db.select().from(schema.donations);
      expect(rows.find((d) => d.id === first.donationIds[0])?.status).toBe("canceled");
      expect(rows.find((d) => d.id === second.donationIds[0])).toMatchObject({ status: "pending", designatedAmountCents: 100_000 });
      const [oldPayment] = await t.db.select().from(schema.payments).where(eq(schema.payments.id, first.paymentId));
      expect(oldPayment.status).toBe("canceled");
    });

    it("refuses an incomplete form with every field error", async () => {
      const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      await saveCheckout(token, { giftCents: 1_000 });
      const error = await errorOf(placeOrder(token));
      expect(error.code).toBe("validation_failed");
      expect(Object.keys((error.details as { fields: Record<string, string> }).fields)).toEqual(expect.arrayContaining(["filingStatus", "email", "designationConfirmed", "attestations.individual"]));
      expect(await t.db.select().from(schema.donations)).toHaveLength(0);
    });

    it("refuses a non-designated part (it cannot be collected outside the 25F account yet)", async () => {
      const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
      await saveCheckout(token, singleFilerPatch({ giftCents: 200_000 }));
      await saveCheckout(token, { designationConfirmed: true });
      const error = await errorOf(placeOrder(token));
      expect(error.code).toBe("validation_failed");
      expect((error.details as { fields: Record<string, string> }).fields["contributors.primary.designatedCents"]).toMatch(/not designated/);
    });

    it("re-runs the list gate at the moment of the order", async () => {
      const { token } = await ready();
      await removeFromList(sgo, "2026-12-10");
      const error = await errorOf(placeOrder(token));
      expect(error.code).toBe("validation_failed");
      expect((error.details as { fields: Record<string, string> }).fields.sgo).toMatch(/Removed/);
      expect(await t.db.select().from(schema.payments)).toHaveLength(0);
    });

    it("refuses when the designation words the page showed differ from the server's", async () => {
      const { token } = await ready();
      const error = await errorOf(placeOrder(token, { shownDesignationTextSha256: "0".repeat(64) }));
      expect(error).toMatchObject({ code: "conflict", details: { reason: "copy_changed" } });
    });

    it("creates one donor and donation per spouse, linked as spouses, for ONE payment of the total", async () => {
      const { token } = await ready(jointPatch());
      await saveCheckout(token, { contributors: { primary: { eDeliveryConsent: true }, spouse: { eDeliveryConsent: true } } });
      const order = await placeOrder(token);
      expect(order.donationIds).toHaveLength(2);
      expect(order.payment.amountCents).toBe(340_000);
      expect(order.payment.lines.map((l) => [l.kind, l.amountCents])).toEqual([
        ["designated_contribution", 170_000],
        ["designated_contribution", 170_000],
      ]);
      const donors = await t.db.select().from(schema.donors);
      expect(donors).toHaveLength(2);
      const [a, b] = donors;
      expect(a.spouseDonorId).toBe(b.id);
      expect(b.spouseDonorId).toBe(a.id);
      const rows = await t.db.select().from(schema.donations);
      expect(rows.map((r) => r.taxpayerRole).sort()).toEqual(["spouse_1", "spouse_2"]);
      expect(rows.every((r) => r.designationCopyId === "designation.statement_joint" && r.jointOnBehalfOfBothConfirmed && r.paymentId === order.paymentId)).toBe(true);
      const consents = await t.db.select().from(schema.donorDeliveryConsents);
      expect(consents.map((c) => c.email).sort()).toEqual(["couple@synthetic.example", "riley@synthetic.example"]);
    });

    it("refuses spouses entered with the same identity", async () => {
      const { token } = await ready(jointPatch({ contributors: { primary: { firstName: "Jordan", lastName: "Testperson" }, spouse: { firstName: "Jordan", lastName: "Testperson" } } }));
      expect((await errorOf(placeOrder(token))).code).toBe("validation_failed");
      expect(await t.db.select().from(schema.donations)).toHaveLength(0);
    });

    it("reuses the donor row for the same person on a later checkout", async () => {
      const first = await ready();
      await placeOrder(first.token);
      const second = await ready(singleFilerPatch({ giftCents: 50_000, email: "DONOR@synthetic.example" }));
      await placeOrder(second.token);
      expect(await t.db.select().from(schema.donors)).toHaveLength(1);
      const moved = await ready(singleFilerPatch({ giftCents: 50_000, address: { line1: "9 Other Synthetic St", city: "Austin", state: "TX", zip: "78702" } }));
      await placeOrder(moved.token);
      expect(await t.db.select().from(schema.donors)).toHaveLength(2);
    });

    it("never attaches someone else's existing donor row to a signed-in user whose email differs", async () => {
      // The victim gave without signing in; another signed-in person retypes the victim's email, name and address.
      const victim = await ready();
      await placeOrder(victim.token);
      const intruderId = newId("user");
      await t.db.insert(schema.users).values({ id: intruderId, email: "intruder@synthetic.example" });
      const intruder = await ready();
      await placeOrder(intruder.token, { userId: intruderId });
      const rows = await t.db.select().from(schema.donors);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBeNull();
      expect(await listGiftsForUser(intruderId)).toEqual([]);

      // The owner of the address, once signed in with it, is linked.
      const ownerId = newId("user");
      await t.db.insert(schema.users).values({ id: ownerId, email: "donor@synthetic.example" });
      const own = await ready(singleFilerPatch({ giftCents: 50_000 }));
      await placeOrder(own.token, { userId: ownerId });
      const [linked] = await t.db.select().from(schema.donors);
      expect(linked.userId).toBe(ownerId);
    });

    it("links a new donor row to the signed-in user who created it", async () => {
      const userId = newId("user");
      await t.db.insert(schema.users).values({ id: userId, email: "someone-else@synthetic.example" });
      const { token } = await ready(singleFilerPatch({ email: "receipts@synthetic.example" }));
      await placeOrder(token, { userId });
      const [row] = await t.db.select().from(schema.donors);
      expect(row.userId).toBe(userId);
    });

    it("splits fees by person and charges a donor service fee on top under that structure", async () => {
      await setSetting("fees.structure", { active: "donor_service_fee", sgoFeeBps: 0, donorServiceFeeBps: 100, counselMemoRef: "MEMO-SYNTHETIC-1", approvedAt: null }, { actorUserId: null });
      const { token } = await ready(jointPatch({ giftCents: 340_001, contributors: { primary: { firstName: "Jordan", lastName: "Testperson", designatedCents: 170_001 }, spouse: { firstName: "Riley", lastName: "Testperson" } } }));
      const order = await placeOrder(token);
      expect(order.payment.amountCents).toBe(340_001 + 3_400);
      expect(order.payment.lines.at(-1)).toMatchObject({ kind: "donor_service_fee", amountCents: 3_400 });
      const rows = await t.db.select().from(schema.donations);
      expect(rows.reduce((sum, r) => sum + r.donorServiceFeeCents, 0)).toBe(3_400);
      expect(rows.map((r) => r.designatedAmountCents).sort()).toEqual([170_000, 170_001]);
    });

    it("refuses a live order while live gifts are switched off", async () => {
      await setSetting("gifts.liveEnabled", true, { actorUserId: null });
      const { token } = await ready();
      await setSetting("gifts.liveEnabled", false, { actorUserId: null });
      const error = await errorOf(placeOrder(token));
      expect(error.code).toBe("validation_failed");
      expect((error.details as { fields: Record<string, string> }).fields.mode).toBeTruthy();
    });
  });
});
