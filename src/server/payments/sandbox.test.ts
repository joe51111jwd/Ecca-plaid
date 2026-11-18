import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { addMs, MS, setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { listJobs } from "@/server/jobs";
import { useTestDb } from "../../../tests/helpers/db";
import { createDonationPayment, getPayment, type DonationPayment } from "./donation-payments";
import { SANDBOX_ASYNC_SETTLE_DELAY_MS } from "./policy";
import {
  assertSandboxAvailable,
  confirmSandboxPayment,
  getSandboxPaymentView,
  isSandboxAvailable,
  SANDBOX_SETTLE_JOB,
  SandboxProcessor,
  sandboxPaymentSecret,
  settleSandboxPayment,
} from "./sandbox";
import { SANDBOX_TEST_CARDS } from "./sandbox-cards";
import { createTestCheckout, createTestSgo, recordingHandlers, runQueue } from "./test-support";

const T0 = new Date("2026-12-10T15:00:00.000Z");
const CARD = { success: "4242 4242 4242 4242", declined: "4000 0000 0000 0002", insufficient: "4000000000009995", asyncOk: "4242 4242 4242 0000", asyncFail: "4242-4242-4242-0018" };

async function newPayment(amountCents = 170_000): Promise<DonationPayment> {
  const orgId = await createTestSgo();
  const checkoutSessionId = await createTestCheckout(orgId);
  return createDonationPayment({
    checkoutSessionId,
    orgId,
    amountCents,
    lines: [{ kind: "designated_contribution", amountCents, description: "Designated contribution (synthetic)" }],
    receiptEmail: "donor@synthetic.example",
    idempotencyKey: "attempt-1",
    mode: "test",
  });
}

function pay(payment: DonationPayment, cardNumber: string, overrides: Partial<{ expiry: string; securityCode: string; clientSecret: string }> = {}) {
  return confirmSandboxPayment({
    paymentId: payment.id,
    clientSecret: overrides.clientSecret ?? sandboxPaymentSecret(payment.id),
    cardNumber,
    expiry: overrides.expiry ?? "12/30",
    securityCode: overrides.securityCode ?? "123",
  });
}

async function fieldErrorsOf(promise: Promise<unknown>): Promise<Record<string, string>> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("validation_failed");
  return ((error as AppError).details as { fields: Record<string, string> }).fields;
}

describe("sandbox processor, end to end", () => {
  useTestDb();

  beforeEach(() => {
    setTestNow(T0);
  });
  afterEach(() => {
    // First: the clock override below refuses to run while NODE_ENV is stubbed to "production".
    vi.unstubAllEnvs();
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("creates a test payment that is waiting to be paid, with what the browser needs", async () => {
    const payment = await newPayment();
    expect(payment).toMatchObject({ processor: "sandbox", status: "requires_payment", mode: "test", amountCents: 170_000, designatedAmountCents: 170_000, serviceFeeCents: 0, created: true });
    expect(payment.processorPaymentId).toMatch(/^sbx_pi_[0-9a-f]{24}$/);
    expect(payment.client).toMatchObject({ provider: "sandbox", paymentId: payment.id, amountCents: 170_000, status: "requires_payment" });
    if (payment.client.provider !== "sandbox") throw new Error("expected a sandbox payment");
    expect(payment.client.sandboxUrl).toBe(`/sandbox/pay/${payment.id}?key=${encodeURIComponent(payment.client.clientSecret)}`);
    expect(payment.client.testCards.map((c) => c.number)).toEqual(SANDBOX_TEST_CARDS.map((c) => c.number));
  });

  it("4242 4242 4242 4242 succeeds: paid at the sandbox charge time, and the donations job is enqueued", async () => {
    const payment = await newPayment();
    const { handlers, recorded } = recordingHandlers();

    expect(await pay(payment, CARD.success)).toEqual({ paymentId: payment.id, status: "succeeded", failureReason: null });

    const paid = await getPayment(payment.id);
    expect(paid).toMatchObject({ status: "succeeded", method: "card", failureReason: null });
    expect(paid.paidAt?.toISOString()).toBe(T0.toISOString());
    await runQueue(handlers);
    expect(recorded["donation.payment_updated"]).toEqual([{ paymentId: payment.id }]);
  });

  it("4000 0000 0000 0002 is declined, and the payer can try again with another number", async () => {
    const payment = await newPayment();
    expect(await pay(payment, CARD.declined)).toEqual({ paymentId: payment.id, status: "failed", failureReason: "The test card was declined." });
    expect(await getPayment(payment.id)).toMatchObject({ status: "failed", failureReason: "The test card was declined.", paidAt: null });

    // The clock is frozen: the retry happens at the very same instant and must still go through.
    expect((await pay(payment, CARD.success)).status).toBe("succeeded");
    expect(await getPayment(payment.id)).toMatchObject({ status: "succeeded", failureReason: null });
  });

  it("4000 0000 0000 9995 fails for insufficient funds, and a second decline shows the newer reason", async () => {
    const payment = await newPayment();
    await pay(payment, CARD.declined);
    expect(await pay(payment, CARD.insufficient)).toMatchObject({ status: "failed", failureReason: "The test card has insufficient funds." });
    expect((await getPayment(payment.id)).failureReason).toBe("The test card has insufficient funds.");
  });

  it("the asynchronous number stays processing until the delayed job settles it, keeping the original charge time", async () => {
    const payment = await newPayment();
    const { handlers, recorded } = recordingHandlers();

    expect(await pay(payment, CARD.asyncOk)).toEqual({ paymentId: payment.id, status: "processing", failureReason: null });
    expect(await getPayment(payment.id)).toMatchObject({ status: "processing", method: "us_bank_account", paidAt: null });
    const [settle] = await listJobs({ type: SANDBOX_SETTLE_JOB });
    expect(settle.runAt.toISOString()).toBe(addMs(T0, SANDBOX_ASYNC_SETTLE_DELAY_MS).toISOString());

    // Not due yet: only the "processing" notification runs.
    await runQueue(handlers);
    expect(recorded["donation.payment_updated"]).toHaveLength(1);
    expect((await getPayment(payment.id)).status).toBe("processing");

    // Three days later the job runs. The gift is dated when it was charged, not when the job ran.
    setTestNow(addMs(T0, 3 * MS.day));
    await runQueue(handlers);
    const settled = await getPayment(payment.id);
    expect(settled.status).toBe("succeeded");
    expect(settled.paidAt?.toISOString()).toBe(T0.toISOString());
    expect(recorded["donation.payment_updated"]).toEqual([{ paymentId: payment.id }, { paymentId: payment.id }]);
  });

  it("the processing-then-fails number ends failed and can be retried", async () => {
    const payment = await newPayment();
    const { handlers } = recordingHandlers();
    await pay(payment, CARD.asyncFail);
    setTestNow(addMs(T0, MS.minute));
    await runQueue(handlers);
    expect(await getPayment(payment.id)).toMatchObject({ status: "failed", failureReason: "The test payment was returned unpaid.", paidAt: null });
    expect((await pay(payment, CARD.success)).status).toBe("succeeded");
  });

  it("the settle job is idempotent and ignores a payment that has moved on", async () => {
    const payment = await newPayment();
    await pay(payment, CARD.asyncOk);
    const [job] = await listJobs({ type: SANDBOX_SETTLE_JOB });
    setTestNow(addMs(T0, MS.minute));
    await settleSandboxPayment(job.payload);
    await settleSandboxPayment(job.payload);
    await settleSandboxPayment({ ...job.payload, outcome: "failed" });
    expect((await getPayment(payment.id)).status).toBe("succeeded");
    // One job for "processing", one for "succeeded": the repeats enqueued nothing.
    expect(await listJobs({ type: "donation.payment_updated" })).toHaveLength(2);
    await expect(settleSandboxPayment({ paymentId: payment.id })).rejects.toThrow();
  });

  it("refuses to pay a payment twice", async () => {
    const payment = await newPayment();
    await pay(payment, CARD.success);
    await expect(pay(payment, CARD.success)).rejects.toMatchObject({ code: "conflict", message: "This payment has already been completed." });
    const processing = await newPayment();
    await pay(processing, CARD.asyncOk);
    await expect(pay(processing, CARD.success)).rejects.toMatchObject({ code: "conflict", message: "This payment is already being processed." });
  });

  it("accepts only the documented test numbers and never keeps what was typed", async () => {
    const payment = await newPayment();
    // A Luhn-valid number that is not a test number stands in for a real card typed by mistake.
    const typed = "4111 1111 1111 1111";
    const fields = await fieldErrorsOf(pay(payment, typed));
    expect(fields.cardNumber).toMatch(/not a sandbox test number/);
    expect(await getPayment(payment.id)).toMatchObject({ status: "requires_payment" });

    await pay(payment, CARD.success);
    const db = await getDb();
    const everything = JSON.stringify({
      payments: await db.select().from(schema.payments),
      jobs: await db.select().from(schema.jobs),
      audit: await db.select().from(schema.auditLogs),
    });
    for (const secret of ["4111111111111111", "4111 1111 1111 1111", "4242424242424242", "4242 4242 4242 4242", "12/30"]) expect(everything).not.toContain(secret);
  });

  it("validates the card fields with a message per field", async () => {
    const payment = await newPayment();
    expect(await fieldErrorsOf(pay(payment, "", { expiry: "13/30", securityCode: "12" }))).toEqual({
      cardNumber: "Enter one of the test card numbers.",
      expiry: "Enter the expiry date as MM/YY.",
      securityCode: "Enter any 3 or 4 digits.",
    });
    expect(await fieldErrorsOf(pay(payment, CARD.success, { expiry: "11/26" }))).toEqual({ expiry: "Use any expiry date in the future." });
    // The card is good through the end of its expiry month.
    expect((await pay(payment, CARD.success, { expiry: "12/2026" })).status).toBe("succeeded");
  });

  it("is closed to anyone without the payment's secret", async () => {
    const payment = await newPayment();
    const other = await newPayment();
    await expect(pay(payment, CARD.success, { clientSecret: "sbx_pay_wrong" })).rejects.toMatchObject({ code: "not_found" });
    await expect(pay(payment, CARD.success, { clientSecret: sandboxPaymentSecret(other.id) })).rejects.toMatchObject({ code: "not_found" });
    await expect(getSandboxPaymentView(payment.id, null)).rejects.toMatchObject({ code: "not_found" });
    await expect(getSandboxPaymentView("pay_missing", sandboxPaymentSecret("pay_missing"))).rejects.toMatchObject({ code: "not_found" });
    expect((await getPayment(payment.id)).status).toBe("requires_payment");

    const view = await getSandboxPaymentView(payment.id, sandboxPaymentSecret(payment.id));
    expect(view.payeeName).toBe("Synthetic Scholarship Fund");
    // Exactly what a checkout page gets for the same payment, so the hosted page and an embedded form agree.
    expect(view.payment).toEqual(payment.client);
    expect(view.payment).toMatchObject({ provider: "sandbox", mode: "test", status: "requires_payment", amountCents: 170_000, description: "Contribution to Synthetic Scholarship Fund", testExpiry: "12/30" });
    expect(view.payment.lines).toEqual([{ kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" }]);
  });

  it("never touches a payment that belongs to another processor", async () => {
    const payment = await newPayment();
    const db = await getDb();
    await db.update(schema.payments).set({ processor: "stripe" }).where(eq(schema.payments.id, payment.id));
    await expect(pay(payment, CARD.success)).rejects.toMatchObject({ code: "not_found" });
    await expect(getSandboxPaymentView(payment.id, sandboxPaymentSecret(payment.id))).rejects.toMatchObject({ code: "not_found" });
  });

  describe("availability", () => {
    it("is on by default, and in production while the sandbox is the configured processor", () => {
      expect(isSandboxAvailable()).toBe(true);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PAYMENTS_PROVIDER", "sandbox");
      expect(isSandboxAvailable()).toBe(true);
      vi.stubEnv("PAYMENTS_PROVIDER", "");
      expect(isSandboxAvailable()).toBe(true);
    });

    it("is on outside production even when Stripe is configured (payments made before the switch can finish)", () => {
      vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
      expect(isSandboxAvailable()).toBe(true);
    });

    it("switches off in production when Stripe is the processor: nothing can be viewed, paid or settled", async () => {
      const payment = await newPayment();
      const pending = await newPayment();
      await pay(pending, CARD.asyncOk);
      const [job] = await listJobs({ type: SANDBOX_SETTLE_JOB });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
      expect(isSandboxAvailable()).toBe(false);
      expect(() => assertSandboxAvailable()).toThrow(AppError);
      await expect(pay(payment, CARD.success)).rejects.toMatchObject({ code: "not_found" });
      await expect(getSandboxPaymentView(payment.id, sandboxPaymentSecret(payment.id))).rejects.toMatchObject({ code: "not_found" });
      await settleSandboxPayment(job.payload);
      expect(warn).toHaveBeenCalledOnce();
      vi.unstubAllEnvs();

      expect((await getPayment(payment.id)).status).toBe("requires_payment");
      expect((await getPayment(pending.id)).status).toBe("processing");
    });
  });

  describe("as a PaymentProcessor", () => {
    const processor = new SandboxProcessor();

    it("only takes test payments", () => {
      expect(() => processor.assertModeSupported("test")).not.toThrow();
      expect(() => processor.assertModeSupported("live")).toThrow(/never moves money/);
    });

    it("names the same payment for the same idempotency key", async () => {
      const input = {
        purpose: "donation" as const,
        mode: "test" as const,
        amountCents: 5_000,
        designatedAmountCents: 5_000,
        serviceFeeOnTopCents: 0,
        description: "Synthetic",
        idempotencyKey: "payment_pay_synthetic_create_v1",
        metadata: { payment_id: "pay_synthetic" },
      };
      const first = await processor.createPayment(input);
      expect(await processor.createPayment(input)).toEqual(first);
      expect((await processor.createPayment({ ...input, idempotencyKey: "another" })).processorPaymentId).not.toBe(first.processorPaymentId);
      await expect(processor.createPayment({ ...input, mode: "live" })).rejects.toMatchObject({ code: "not_available" });
      await expect(processor.createPayment({ ...input, amountCents: 49, designatedAmountCents: 49 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createPayment({ ...input, metadata: {} })).rejects.toMatchObject({ code: "internal" });
    });

    it("reads its payments from the database and has no webhooks", async () => {
      const payment = await newPayment();
      expect(await processor.retrievePayment(payment.processorPaymentId as string)).toMatchObject({ status: "requires_payment", amountCents: 170_000, livemode: false });
      await pay(payment, CARD.success);
      const found = await processor.retrievePayment(payment.processorPaymentId as string);
      expect(found).toMatchObject({ status: "succeeded", method: "card" });
      expect(found.chargedAt?.toISOString()).toBe(T0.toISOString());
      await expect(processor.retrievePayment("sbx_pi_missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(processor.cancelPayment(payment.processorPaymentId as string)).rejects.toMatchObject({ code: "conflict" });
      await expect(processor.parseWebhook()).rejects.toMatchObject({ code: "not_available" });
    });
  });
});
