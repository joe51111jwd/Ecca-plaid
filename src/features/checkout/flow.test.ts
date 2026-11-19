import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestDb } from "../../../tests/helpers/db";
import { MS, setTestNow } from "@/lib/clock";
import { actionError, isAppError } from "@/lib/errors";
import { donationsPolicy } from "@/server/donations";
import { createListedSgo, drainJobs, jointPatch, paySandbox, singleFilerPatch } from "@/server/donations/test-support";
import { withoutRejected } from "./form-state";
import { beginGift, loadCheckout, loadReceipt, placeGift, resolveCheckout, saveGift, usStateOptions } from "./flow";

/* All organizations and people are SYNTHETIC (see src/server/donations/test-support.ts). */

const TODAY = new Date("2026-11-18T15:00:00Z");

describe("checkout flow (screens → donations service)", () => {
  useTestDb();
  beforeEach(() => setTestNow(TODAY));
  afterEach(() => setTestNow(null));

  it("starts a checkout with the amount typed on the start screen and the donor's time zone", async () => {
    const sgo = await createListedSgo({ portalRegistered: true });
    const { token, view } = await beginGift({ slug: sgo.slug, source: "hosted", giftCents: 50_000, donorTimeZone: "America/Chicago" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(view.order.giftCents).toBe(50_000);
    expect(view.mode).toBe("test");
    expect(view.banner.state).toBe("not_eligible");
    expect(view.banner.reasonCodes).toEqual(expect.arrayContaining(["sandbox_mode", "before_credit_start", "sgo_list_provisional"]));
  });

  it("keeps the checkout when the start-screen amount is refused, so the form can show the problem", async () => {
    const sgo = await createListedSgo();
    const { token, view } = await beginGift({ slug: sgo.slug, source: "widget", giftCents: donationsPolicy.MAX_GIFT_CENTS + 1 });
    expect(view.order.giftCents).toBeNull();
    expect((await loadCheckout(token)).view.sessionId).toBe(view.sessionId);
  });

  it("refuses an unknown organization", async () => {
    await expect(beginGift({ slug: "no-such-fund", source: "hosted" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("a save refused for one field can be re-sent without it, so the other fields typed alongside are not lost", async () => {
    const sgo = await createListedSgo();
    const { token } = await beginGift({ slug: sgo.slug, source: "hosted" });
    const patch = { email: "jane@", giftCents: 50_000, contributors: { primary: { firstName: "Synthetic", lastName: "Donor" } } };
    const error = await saveGift(token, patch).catch((e: unknown) => e);
    expect(isAppError(error) && error.code === "validation_failed").toBe(true);
    const fields = actionError(error).error.fields ?? {};
    expect(Object.keys(fields)).toEqual(["email"]);
    const view = await saveGift(token, withoutRejected(patch, Object.keys(fields)));
    expect(view.order.giftCents).toBe(50_000);
    expect(view.order.contributors[0]).toMatchObject({ firstName: "Synthetic", lastName: "Donor" });
  });

  it("refuses fields the checkout does not have (an SSN, a student's name, a memo)", async () => {
    const sgo = await createListedSgo();
    const { token } = await beginGift({ slug: sgo.slug, source: "hosted" });
    for (const patch of [{ ssn: "000-00-0000" }, { studentName: "Synthetic Student" }, { memo: "for my niece" }, { contributors: { primary: { tin: "1" } } }]) {
      const error = await saveGift(token, patch).catch((e: unknown) => e);
      expect(isAppError(error) && error.code === "validation_failed").toBe(true);
    }
  });

  it("completes a single-filer sandbox gift end to end and shows the receipt with the outcome at the charge", async () => {
    const sgo = await createListedSgo({ portalRegistered: true });
    const { token } = await beginGift({ slug: sgo.slug, source: "hosted" });
    let view = await saveGift(token, singleFilerPatch());
    expect(view.designation.statement).not.toBeNull();
    view = await saveGift(token, { designationConfirmed: true });
    expect(view.canPlaceOrder).toBe(true);

    const { payment, view: placed } = await placeGift(token, { shownDesignationTextSha256: view.designation.statement?.textSha256 });
    expect(placed.status).toBe("awaiting_payment");
    expect(payment.amountCents).toBe(170_000);
    const active = await resolveCheckout(token, sgo.slug);
    expect(active.kind === "active" && active.loaded.payment?.paymentId).toBe(payment.paymentId);

    await paySandbox(payment);
    await drainJobs();
    const { view: done, receipt } = await loadReceipt(token);
    expect(done.status).toBe("completed");
    expect(receipt.sandbox).toBe(true);
    expect(receipt.paymentStatus).toBe("succeeded");
    expect(receipt.lines).toEqual([expect.objectContaining({ kind: "designated_contribution", amountCents: 170_000 })]);
    expect(receipt.outcome?.creditEligible).toBe(false);
    expect((await resolveCheckout(token, sgo.slug)).kind).toBe("completed");
  });

  it("completes a joint-return gift with one designated line per spouse", async () => {
    const sgo = await createListedSgo({ portalRegistered: true });
    const { token } = await beginGift({ slug: sgo.slug, source: "widget" });
    await saveGift(token, jointPatch());
    const view = await saveGift(token, { designationConfirmed: true, contributors: { primary: { eDeliveryConsent: true }, spouse: { eDeliveryConsent: true } } });
    expect(view.consents.every((c) => c.given)).toBe(true);
    const { payment } = await placeGift(token);
    await paySandbox(payment);
    await drainJobs();
    const { receipt } = await loadReceipt(token);
    expect(receipt.lines.map((l) => l.amountCents)).toEqual([170_000, 170_000]);
    expect(receipt.contributors.map((c) => c.eDelivery)).toEqual([true, true]);
  });

  it("refuses to place an incomplete order with field-level problems", async () => {
    const sgo = await createListedSgo();
    const { token } = await beginGift({ slug: sgo.slug, source: "hosted", giftCents: 10_000 });
    const error = await placeGift(token).catch((e: unknown) => e);
    expect(isAppError(error) && error.code === "validation_failed").toBe(true);
    expect(isAppError(error) && (error.details as { fields: Record<string, string> }).fields).toHaveProperty("email");
  });

  it("refuses a designation confirmed against words that have since changed", async () => {
    const sgo = await createListedSgo();
    const { token } = await beginGift({ slug: sgo.slug, source: "hosted" });
    await saveGift(token, singleFilerPatch());
    await saveGift(token, { designationConfirmed: true });
    await expect(placeGift(token, { shownDesignationTextSha256: "0".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
  });

  it("treats no token, an unknown token, another organization's token and an expired checkout as nothing to resume", async () => {
    const a = await createListedSgo();
    const b = await createListedSgo();
    const { token } = await beginGift({ slug: a.slug, source: "hosted" });
    expect(await resolveCheckout(null, a.slug)).toEqual({ kind: "none" });
    expect(await resolveCheckout("x".repeat(43), a.slug)).toEqual({ kind: "ended", reason: "unknown" });
    expect(await resolveCheckout(token, b.slug)).toEqual({ kind: "ended", reason: "unknown" });
    expect((await resolveCheckout(token, a.slug)).kind).toBe("active");
    setTestNow(new Date(TODAY.getTime() + donationsPolicy.CHECKOUT_IDLE_TTL_MS + MS.minute));
    expect(await resolveCheckout(token, a.slug)).toEqual({ kind: "ended", reason: "expired" });
  });

  it("offers the 50 States and D.C. for the address", () => {
    const states = usStateOptions();
    expect(states).toHaveLength(51);
    expect(states).toContainEqual({ code: "TX", name: "Texas" });
    expect(states).toContainEqual({ code: "DC", name: "District of Columbia" });
  });
});
