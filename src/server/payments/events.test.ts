import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import type { InvoiceStatus, PaymentStatus } from "@/db/schema";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { listJobs } from "@/server/jobs";
import { useTestDb } from "../../../tests/helpers/db";
import { applyProcessorEvent, canInvoiceBecome, decidePaymentTransition, paidAtFor, type PaymentDecision, type PaymentStateView } from "./events";
import { META } from "./metadata";
import { PAID_AT_BASIS } from "./policy";
import { createTestBusiness, createTestCheckout, createTestSgo } from "./test-support";
import type { InvoiceEvent, PaymentEvent, ProcessorEvent } from "./types";

const NOW = new Date("2027-01-04T18:00:00.000Z");
const at = (iso: string) => new Date(iso);

/* The pure rule ---------------------------------------------------------------------------------------- */

const BASE = { id: "evt_synthetic", processor: "stripe" as const, livemode: false, processorPaymentId: "pi_synthetic" };

function event(type: PaymentEvent["type"], overrides: Record<string, unknown> = {}): PaymentEvent {
  const occurredAt = at("2027-01-02T10:00:00Z");
  const byType = {
    "payment.processing": {},
    "payment.succeeded": { chargedAt: occurredAt },
    "payment.failed": { failureReason: "Your card was declined." },
    "payment.canceled": {},
    "payment.refunded": { refundedAmountCents: 10_000, fullyRefunded: true },
  }[type];
  return { ...BASE, occurredAt, type, ...byType, ...overrides } as PaymentEvent;
}

function state(status: PaymentStatus, overrides: Partial<PaymentStateView> = {}): PaymentStateView {
  return { status, attemptId: null, lastEventAt: null, refundedCents: 0, ...overrides };
}

const STATUSES: PaymentStatus[] = ["requires_payment", "processing", "succeeded", "failed", "canceled", "refunded"];
const short = (d: PaymentDecision) => (d.action === "transition" ? d.to : d.action === "update" ? "update" : `ignore:${d.reason}${d.retry ? ":retry" : ""}`);

describe("decidePaymentTransition", () => {
  it("covers every status for every event type", () => {
    const table = Object.fromEntries(
      (["payment.processing", "payment.succeeded", "payment.failed", "payment.canceled", "payment.refunded"] as const).map((type) => [
        type,
        Object.fromEntries(STATUSES.map((s) => [s, short(decidePaymentTransition(state(s), event(type)))])),
      ]),
    );
    expect(table).toEqual({
      "payment.processing": {
        requires_payment: "processing",
        processing: "ignore:duplicate",
        succeeded: "ignore:stale",
        failed: "processing",
        canceled: "ignore:transition_not_allowed",
        refunded: "ignore:stale",
      },
      "payment.succeeded": {
        requires_payment: "succeeded",
        processing: "succeeded",
        succeeded: "ignore:duplicate",
        failed: "succeeded",
        canceled: "ignore:transition_not_allowed",
        refunded: "ignore:duplicate",
      },
      "payment.failed": {
        requires_payment: "failed",
        processing: "failed",
        succeeded: "ignore:stale",
        failed: "update",
        canceled: "ignore:transition_not_allowed",
        refunded: "ignore:stale",
      },
      "payment.canceled": {
        requires_payment: "canceled",
        processing: "canceled",
        succeeded: "ignore:transition_not_allowed",
        failed: "canceled",
        canceled: "ignore:duplicate",
        refunded: "ignore:transition_not_allowed",
      },
      "payment.refunded": {
        requires_payment: "ignore:awaiting_prior_event:retry",
        processing: "ignore:awaiting_prior_event:retry",
        succeeded: "refunded",
        failed: "ignore:awaiting_prior_event:retry",
        canceled: "ignore:transition_not_allowed",
        refunded: "ignore:duplicate",
      },
    });
  });

  it("never lets an earlier charge attempt overwrite a later one", () => {
    const later = at("2027-01-02T10:05:00Z");
    // Attempt B is processing; attempt A's failure arrives late.
    expect(short(decidePaymentTransition(state("processing", { attemptId: "ch_B", lastEventAt: later }), event("payment.failed", { attemptId: "ch_A" })))).toBe("ignore:stale");
    // The same attempt failing is real, whatever the clocks say.
    expect(short(decidePaymentTransition(state("processing", { attemptId: "ch_B", lastEventAt: later }), event("payment.failed", { attemptId: "ch_B" })))).toBe("failed");
    // An attempt that failed cannot go back to processing…
    expect(short(decidePaymentTransition(state("failed", { attemptId: "ch_A", lastEventAt: at("2027-01-02T09:00:00Z") }), event("payment.processing", { attemptId: "ch_A" })))).toBe("ignore:stale");
    // …but a new attempt can, even in the same second (a frozen test clock, a quick retry).
    expect(short(decidePaymentTransition(state("failed", { attemptId: "ch_A", lastEventAt: at("2027-01-02T10:00:00Z") }), event("payment.processing", { attemptId: "ch_B" })))).toBe("processing");
    // An older "processing" after a newer failure is stale.
    expect(short(decidePaymentTransition(state("failed", { attemptId: "ch_B", lastEventAt: later }), event("payment.processing", { attemptId: "ch_A" })))).toBe("ignore:stale");
    // Without attempt ids the processor's clock decides.
    expect(short(decidePaymentTransition(state("failed", { lastEventAt: later }), event("payment.processing")))).toBe("ignore:stale");
    expect(short(decidePaymentTransition(state("processing", { lastEventAt: later }), event("payment.failed")))).toBe("ignore:stale");
    // A repeat of the same failure is a duplicate; an older one is stale.
    expect(short(decidePaymentTransition(state("failed", { attemptId: "ch_A" }), event("payment.failed", { attemptId: "ch_A" })))).toBe("ignore:duplicate");
    expect(short(decidePaymentTransition(state("failed", { attemptId: "ch_B", lastEventAt: later }), event("payment.failed", { attemptId: "ch_A" })))).toBe("ignore:stale");
  });

  it("treats a partial refund as an update and a repeated one as a duplicate", () => {
    const partial = event("payment.refunded", { refundedAmountCents: 2_500, fullyRefunded: false });
    expect(short(decidePaymentTransition(state("succeeded"), partial))).toBe("update");
    expect(short(decidePaymentTransition(state("succeeded", { refundedCents: 2_500 }), partial))).toBe("ignore:duplicate");
    expect(short(decidePaymentTransition(state("succeeded", { refundedCents: 2_500 }), event("payment.refunded", { refundedAmountCents: 10_000, fullyRefunded: true })))).toBe("refunded");
  });
});

describe("paidAtFor", () => {
  it("dates a gift by the charge under the default policy, and by the confirmation under the alternative", () => {
    const times = { chargedAt: at("2026-12-31T23:59:30-06:00"), occurredAt: at("2027-01-05T15:00:00Z") };
    expect(PAID_AT_BASIS).toBe("charge_created");
    expect(paidAtFor(times)).toBe(times.chargedAt);
    expect(paidAtFor(times, "charge_created")).toBe(times.chargedAt);
    expect(paidAtFor(times, "payment_succeeded")).toBe(times.occurredAt);
  });
});

describe("canInvoiceBecome", () => {
  it("allows paid only from issued invoices, and void from anything unpaid", () => {
    const all: InvoiceStatus[] = ["draft", "open", "paid", "void", "uncollectible"];
    expect(all.filter((s) => canInvoiceBecome(s, "paid"))).toEqual(["open", "uncollectible"]);
    expect(all.filter((s) => canInvoiceBecome(s, "void"))).toEqual(["draft", "open", "uncollectible"]);
  });
});

/* Against the database --------------------------------------------------------------------------------- */

describe("applyProcessorEvent", () => {
  const t = useTestDb();
  let orgId: string;
  let paymentId: string;
  let serial = 0;

  /** A Stripe payment row as createDonationPayment leaves it, without calling any processor. */
  async function insertPayment(overrides: Partial<typeof schema.payments.$inferInsert> = {}): Promise<string> {
    const id = newId("payment");
    await t.db.insert(schema.payments).values({
      id,
      processor: "stripe",
      processorPaymentId: `pi_${id}`,
      purpose: "donation",
      checkoutSessionId: await createTestCheckout(orgId),
      orgId,
      amountCents: 170_000,
      status: "requires_payment",
      metadata: { [META.mode]: "test" },
      ...overrides,
    });
    return id;
  }

  function ev(type: PaymentEvent["type"], overrides: Record<string, unknown> = {}, forPayment = paymentId): PaymentEvent {
    serial++;
    return { ...event(type, { processorPaymentId: `pi_${forPayment}`, ...overrides }), id: `evt_${serial}` } as PaymentEvent;
  }

  const row = async (id = paymentId) => (await t.db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const jobsFor = async (type = "donation.payment_updated") => (await listJobs({ type })).map((j) => j.payload);

  beforeEach(async () => {
    setTestNow(NOW);
    serial = 0;
    orgId = await createTestSgo();
    paymentId = await insertPayment();
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("marks a payment succeeded with the processor's charge time, not the time we heard about it", async () => {
    // Charged on New Year's Eve (Central time); the processor confirmed two days later; we processed it on January 4.
    const chargedAt = at("2026-12-31T23:59:30-06:00");
    const occurredAt = at("2027-01-02T15:00:00Z");
    const result = await applyProcessorEvent(ev("payment.succeeded", { chargedAt, occurredAt, amountCents: 170_000, method: "us_bank_account", attemptId: "ch_1" }));
    expect(result).toEqual({ applied: true, retry: false, paymentId, from: "requires_payment", to: "succeeded" });

    const paid = await row();
    expect(paid.status).toBe("succeeded");
    expect(paid.paidAt?.toISOString()).toBe(chargedAt.toISOString());
    expect(paid.paidAt?.toISOString()).not.toBe(NOW.toISOString());
    expect(paid.method).toBe("us_bank_account");
    expect(paid.updatedAt.toISOString()).toBe(NOW.toISOString());
    // Both timestamps are kept so either tax-year rule can be applied later.
    expect(paid.metadata).toMatchObject({
      [META.chargeCreatedAt]: chargedAt.toISOString(),
      [META.succeededAt]: occurredAt.toISOString(),
      [META.lastEventAt]: occurredAt.toISOString(),
      [META.attemptId]: "ch_1",
      [META.mode]: "test",
    });
    expect(await jobsFor()).toEqual([{ paymentId }]);
  });

  it("applies the same event only once", async () => {
    const succeeded = ev("payment.succeeded");
    expect((await applyProcessorEvent(succeeded)).applied).toBe(true);
    const before = await row();
    for (let i = 0; i < 3; i++) expect(await applyProcessorEvent(succeeded)).toEqual({ applied: false, ignored: "duplicate", retry: false, paymentId });
    expect(await row()).toEqual(before);
    expect(await jobsFor()).toHaveLength(1);
    expect((await listAuditLogs({ targetId: paymentId })).items).toHaveLength(1);
  });

  it("walks requires_payment → processing → succeeded and enqueues one job per step", async () => {
    const started = at("2027-01-02T10:00:00Z");
    await applyProcessorEvent(ev("payment.processing", { occurredAt: started, chargedAt: started, attemptId: "ch_1" }));
    expect(await row()).toMatchObject({ status: "processing", paidAt: null });
    expect((await row()).metadata[META.processingAt]).toBe(started.toISOString());
    await applyProcessorEvent(ev("payment.succeeded", { occurredAt: at("2027-01-04T12:00:00Z"), chargedAt: started, attemptId: "ch_1" }));
    expect((await row()).paidAt?.toISOString()).toBe(started.toISOString());
    expect(await jobsFor()).toEqual([{ paymentId }, { paymentId }]);
  });

  it("ignores events that arrive out of order", async () => {
    const t1 = at("2027-01-02T10:00:00Z");
    const t2 = at("2027-01-02T10:05:00Z");
    // "succeeded" overtakes "processing".
    await applyProcessorEvent(ev("payment.succeeded", { occurredAt: t2, chargedAt: t1 }));
    expect(await applyProcessorEvent(ev("payment.processing", { occurredAt: t1 }))).toMatchObject({ applied: false, ignored: "stale" });
    expect(await applyProcessorEvent(ev("payment.failed", { occurredAt: t1 }))).toMatchObject({ applied: false, ignored: "stale" });
    expect(await row()).toMatchObject({ status: "succeeded", failureReason: null });

    // A second attempt is processing when the first attempt's decline shows up late.
    const other = await insertPayment();
    await applyProcessorEvent(ev("payment.processing", { occurredAt: t2, attemptId: "ch_B" }, other));
    expect(await applyProcessorEvent(ev("payment.failed", { occurredAt: t1, attemptId: "ch_A" }, other))).toMatchObject({ applied: false, ignored: "stale" });
    expect(await row(other)).toMatchObject({ status: "processing", failureReason: null });
  });

  it("lets the payer try again after a failure, and clears the old reason on success", async () => {
    await applyProcessorEvent(ev("payment.failed", { failureReason: "Your card was declined.", failureCode: "card_declined", attemptId: "ch_A", occurredAt: at("2027-01-02T10:00:00Z") }));
    expect(await row()).toMatchObject({ status: "failed", failureReason: "Your card was declined.", paidAt: null });

    // A second decline changes only the reason shown: no status change, no job, no audit entry.
    const again = await applyProcessorEvent(ev("payment.failed", { failureReason: "Your card has insufficient funds.", attemptId: "ch_B", occurredAt: at("2027-01-02T10:01:00Z") }));
    expect(again).toEqual({ applied: false, ignored: "no_state_change", retry: false, paymentId });
    expect((await row()).failureReason).toBe("Your card has insufficient funds.");
    expect(await jobsFor()).toHaveLength(1);

    await applyProcessorEvent(ev("payment.succeeded", { attemptId: "ch_C", occurredAt: at("2027-01-02T10:02:00Z"), chargedAt: at("2027-01-02T10:02:00Z") }));
    expect(await row()).toMatchObject({ status: "succeeded", failureReason: null });
    expect(await jobsFor()).toHaveLength(2);
  });

  it("refunds only a succeeded payment, with the processor's refund time", async () => {
    const refundedAt = at("2027-02-10T16:00:00Z");
    // The refund reaches us before the success does: ask for redelivery rather than lose it.
    expect(await applyProcessorEvent(ev("payment.refunded", { occurredAt: refundedAt }))).toEqual({ applied: false, ignored: "awaiting_prior_event", retry: true, paymentId });
    expect((await row()).status).toBe("requires_payment");

    const chargedAt = at("2027-01-02T10:00:00Z");
    await applyProcessorEvent(ev("payment.succeeded", { chargedAt, occurredAt: chargedAt }));
    expect(await applyProcessorEvent(ev("payment.refunded", { occurredAt: refundedAt, refundedAmountCents: 170_000, fullyRefunded: true }))).toMatchObject({ applied: true, from: "succeeded", to: "refunded" });
    const refunded = await row();
    expect(refunded.status).toBe("refunded");
    expect(refunded.refundedAt?.toISOString()).toBe(refundedAt.toISOString());
    // The charge time is history: a refund does not rewrite it.
    expect(refunded.paidAt?.toISOString()).toBe(chargedAt.toISOString());
    expect(refunded.metadata[META.refundedCents]).toBe("170000");

    expect(await applyProcessorEvent(ev("payment.refunded", { occurredAt: refundedAt }))).toMatchObject({ applied: false, ignored: "duplicate" });
    expect(await applyProcessorEvent(ev("payment.succeeded"))).toMatchObject({ applied: false, ignored: "duplicate" });
    expect(await jobsFor()).toHaveLength(2);
  });

  it("records a partial refund without calling the payment refunded, and still tells the donations domain", async () => {
    await applyProcessorEvent(ev("payment.succeeded"));
    const partial = ev("payment.refunded", { refundedAmountCents: 20_000, fullyRefunded: false, occurredAt: at("2027-02-01T00:00:00Z") });
    expect(await applyProcessorEvent(partial)).toEqual({ applied: true, retry: false, paymentId, from: "succeeded", to: "succeeded" });
    expect(await row()).toMatchObject({ status: "succeeded", refundedAt: null });
    expect((await row()).metadata[META.refundedCents]).toBe("20000");
    expect(await applyProcessorEvent({ ...partial, id: "evt_redelivered" })).toMatchObject({ applied: false, ignored: "duplicate" });
    expect(await jobsFor()).toHaveLength(2);
    expect((await listAuditLogs({ targetId: paymentId })).items.map((a) => a.action)).toEqual(["payment.partially_refunded", "payment.status_changed"]);
  });

  it("cancels an unpaid payment and then accepts nothing more", async () => {
    await applyProcessorEvent(ev("payment.canceled", { reason: "abandoned" }));
    expect(await row()).toMatchObject({ status: "canceled" });
    expect((await row()).metadata[META.cancelReason]).toBe("abandoned");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyProcessorEvent(ev("payment.succeeded"))).toMatchObject({ applied: false, ignored: "transition_not_allowed" });
    // Money reported for a canceled payment must not pass silently.
    expect(error).toHaveBeenCalledOnce();
    expect(await applyProcessorEvent(ev("payment.processing"))).toMatchObject({ applied: false, ignored: "transition_not_allowed" });
    expect(await applyProcessorEvent(ev("payment.canceled"))).toMatchObject({ applied: false, ignored: "duplicate" });
    expect((await row()).status).toBe("canceled");
    expect(await jobsFor()).toHaveLength(1);
  });

  it("ignores payments it does not know, and never crosses processors", async () => {
    expect(await applyProcessorEvent(ev("payment.succeeded", { processorPaymentId: "pi_someone_elses" }))).toEqual({ applied: false, ignored: "unknown_object", retry: false });
    // Same id, other processor.
    expect(await applyProcessorEvent({ ...ev("payment.succeeded"), processor: "sandbox" })).toEqual({ applied: false, ignored: "unknown_object", retry: false });
    expect((await row()).status).toBe("requires_payment");
    expect(await jobsFor()).toHaveLength(0);
  });

  it("ignores an event that comes from a different connected account than the one the payment was charged on", async () => {
    const direct = await insertPayment({ metadata: { [META.mode]: "test", [META.connectedAccountId]: "acct_1SyntheticSgo", [META.settlementMode]: "direct" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyProcessorEvent(ev("payment.succeeded", { connectedAccountId: "acct_1SomeoneElse" }, direct))).toEqual({ applied: false, ignored: "unknown_object", retry: false });
    expect(error).toHaveBeenCalledOnce();
    expect((await row(direct)).status).toBe("requires_payment");
    expect(await applyProcessorEvent(ev("payment.succeeded", { connectedAccountId: "acct_1SyntheticSgo" }, direct))).toMatchObject({ applied: true, to: "succeeded" });
  });

  it("refuses to record a success for an amount other than the one collected", async () => {
    await expect(applyProcessorEvent(ev("payment.succeeded", { amountCents: 100 }))).rejects.toMatchObject({
      code: "conflict",
      details: { paymentId, expectedCents: 170_000, collectedCents: 100 },
    });
    expect(await row()).toMatchObject({ status: "requires_payment", paidAt: null });
    expect(await jobsFor()).toHaveLength(0);
    expect((await listAuditLogs({ targetId: paymentId })).items).toHaveLength(0);
  });

  it("writes the status change, the audit entry and the job in one transaction", async () => {
    const db = await getDb();
    // Caller's transaction rolls back: nothing of the event may remain.
    await expect(
      db.transaction(async (tx) => {
        const result = await applyProcessorEvent(ev("payment.succeeded"), tx);
        expect(result.applied).toBe(true);
        const [inside] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
        expect(inside.status).toBe("succeeded");
        throw new Error("caller failed after the event was applied");
      }),
    ).rejects.toThrow("caller failed");
    expect(await row()).toMatchObject({ status: "requires_payment", paidAt: null });
    expect(await jobsFor()).toHaveLength(0);
    expect((await listAuditLogs({ targetId: paymentId })).items).toHaveLength(0);

    // Caller's transaction commits: all three are there.
    await db.transaction(async (tx) => {
      await applyProcessorEvent(ev("payment.succeeded"), tx);
    });
    expect((await row()).status).toBe("succeeded");
    expect(await jobsFor()).toEqual([{ paymentId }]);
    const [entry] = (await listAuditLogs({ targetId: paymentId })).items;
    expect(entry).toMatchObject({ action: "payment.status_changed", actorType: "webhook", orgId, targetType: "payment" });
    expect(entry.metadata).toMatchObject({ processor: "stripe", event: "payment.succeeded", from: "requires_payment", to: "succeeded" });
  });

  it("rolls the status change back when the job cannot be enqueued", async () => {
    const jobs = await import("@/server/jobs");
    vi.spyOn(jobs, "enqueue").mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(applyProcessorEvent(ev("payment.succeeded"))).rejects.toThrow("queue unavailable");
    expect(await row()).toMatchObject({ status: "requires_payment", paidAt: null });
    expect((await listAuditLogs({ targetId: paymentId })).items).toHaveLength(0);
  });

  describe("invoices", () => {
    let invoiceId: string;
    let businessOrgId: string;

    async function insertInvoice(status: InvoiceStatus = "open"): Promise<string> {
      const id = newId("invoice");
      await t.db.insert(schema.businessInvoices).values({
        id,
        businessOrgId,
        mode: "test",
        number: `INV-TEST-2027-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
        status,
        totalCents: 5_000,
        processor: "stripe",
        processorInvoiceId: `in_${id}`,
      });
      return id;
    }

    function inv(type: InvoiceEvent["type"], overrides: Record<string, unknown> = {}, forInvoice = invoiceId): ProcessorEvent {
      serial++;
      const occurredAt = at("2027-01-03T09:00:00Z");
      return { id: `evt_${serial}`, processor: "stripe", livemode: false, occurredAt, type, processorInvoiceId: `in_${forInvoice}`, ...(type === "invoice.paid" ? { paidAt: occurredAt } : {}), ...overrides } as ProcessorEvent;
    }

    const invoice = async (id = invoiceId) => (await t.db.select().from(schema.businessInvoices).where(eq(schema.businessInvoices.id, id)))[0];

    beforeEach(async () => {
      businessOrgId = await createTestBusiness();
      invoiceId = await insertInvoice();
    });

    it("marks an open invoice paid at the processor's time and tells the billing domain once", async () => {
      const paidAt = at("2027-01-03T08:59:00Z");
      expect(await applyProcessorEvent(inv("invoice.paid", { paidAt }))).toEqual({ applied: true, retry: false, invoiceId, from: "open", to: "paid" });
      expect(await invoice()).toMatchObject({ status: "paid" });
      expect((await invoice()).paidAt?.toISOString()).toBe(paidAt.toISOString());
      expect(await applyProcessorEvent(inv("invoice.paid"))).toEqual({ applied: false, ignored: "duplicate", retry: false, invoiceId });
      expect(await jobsFor("invoice.payment_updated")).toEqual([{ invoiceId }]);
      const [entry] = (await listAuditLogs({ targetId: invoiceId })).items;
      expect(entry).toMatchObject({ action: "invoice.paid", actorType: "webhook", orgId: businessOrgId });
      // A paid invoice cannot be voided by a late event.
      expect(await applyProcessorEvent(inv("invoice.voided"))).toMatchObject({ applied: false, ignored: "transition_not_allowed" });
    });

    it("voids an open invoice, and a voided invoice cannot become paid", async () => {
      expect(await applyProcessorEvent(inv("invoice.voided"))).toMatchObject({ applied: true, from: "open", to: "void" });
      expect(await applyProcessorEvent(inv("invoice.paid"))).toMatchObject({ applied: false, ignored: "transition_not_allowed" });
      expect(await invoice()).toMatchObject({ status: "void", paidAt: null });
      expect(await jobsFor("invoice.payment_updated")).toEqual([{ invoiceId }]);
    });

    it("notes a failed invoice payment for people without changing the invoice", async () => {
      expect(await applyProcessorEvent(inv("invoice.payment_failed", { failureReason: "The bank returned the debit." }))).toEqual({ applied: false, ignored: "no_state_change", retry: false, invoiceId });
      expect((await invoice()).status).toBe("open");
      expect(await jobsFor("invoice.payment_updated")).toHaveLength(0);
      const [entry] = (await listAuditLogs({ targetId: invoiceId })).items;
      expect(entry.action).toBe("invoice.payment_failed");
      expect(entry.metadata).toMatchObject({ reason: "The bank returned the debit." });
    });

    it("ignores invoices it does not know, and rolls back with the caller's transaction", async () => {
      expect(await applyProcessorEvent(inv("invoice.paid", { processorInvoiceId: "in_unknown" }))).toEqual({ applied: false, ignored: "unknown_object", retry: false });
      const db = await getDb();
      await expect(
        db.transaction(async (tx) => {
          await applyProcessorEvent(inv("invoice.paid"), tx);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect((await invoice()).status).toBe("open");
      expect(await jobsFor("invoice.payment_updated")).toHaveLength(0);
    });
  });
});
