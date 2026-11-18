import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestNow } from "@/lib/clock";
import { createBusinessInvoice, createDonationPayment, getBusinessInvoice, getPayment, sendInvoice } from "@/server/payments";
import { createTestBusiness, createTestCheckout, createTestSgo } from "@/server/payments/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { paySandboxInvoiceAction, submitSandboxPaymentAction } from "./sandbox-actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("sandbox server actions", () => {
  useTestDb();
  let paymentId: string;
  let clientSecret: string;

  const card = (number: string, overrides: Record<string, string> = {}) =>
    form({ paymentId, clientSecret, sandboxCardNumber: number, sandboxExpiry: "12/30", sandboxSecurityCode: "123", ...overrides });

  beforeEach(async () => {
    setTestNow("2026-12-10T15:00:00.000Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const orgId = await createTestSgo();
    const payment = await createDonationPayment({
      checkoutSessionId: await createTestCheckout(orgId),
      orgId,
      amountCents: 170_000,
      lines: [{ kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" }],
      idempotencyKey: "attempt-1",
      mode: "test",
    });
    paymentId = payment.id;
    clientSecret = payment.client.clientSecret as string;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("completes a payment and returns only the outcome", async () => {
    const result = await submitSandboxPaymentAction(null, card("4242 4242 4242 4242"));
    expect(result).toEqual({ ok: true, data: { paymentId, status: "succeeded", failureReason: null } });
    // Nothing of what was typed comes back.
    expect(JSON.stringify(result)).not.toContain("4242");
    expect((await getPayment(paymentId)).status).toBe("succeeded");
  });

  it("reports a decline as an outcome, and bad fields as field errors", async () => {
    expect(await submitSandboxPaymentAction(null, card("4000 0000 0000 0002"))).toEqual({ ok: true, data: { paymentId, status: "failed", failureReason: "The test card was declined." } });
    expect(await submitSandboxPaymentAction(null, card("4111 1111 1111 1111", { sandboxExpiry: "1/20" }))).toEqual({
      ok: false,
      error: {
        code: "validation_failed",
        message: "Check the card details and try again.",
        fields: {
          cardNumber: "That is not a sandbox test number. Real card numbers are not accepted here: use one of the test numbers listed on this page.",
          expiry: "Use any expiry date in the future.",
        },
      },
    });
    // A form with nothing in it does not crash the action.
    expect(await submitSandboxPaymentAction(null, new FormData())).toEqual({ ok: false, error: { code: "validation_failed", message: "Check the card details and try again." } });
  });

  it("never throws across the boundary: wrong secret, finished payment", async () => {
    expect(await submitSandboxPaymentAction(null, card("4242424242424242", { clientSecret: "sbx_pay_wrong" }))).toEqual({ ok: false, error: { code: "not_found", message: "Payment not found" } });
    await submitSandboxPaymentAction(null, card("4242424242424242"));
    expect(await submitSandboxPaymentAction(null, card("4242424242424242"))).toEqual({ ok: false, error: { code: "conflict", message: "This payment has already been completed." } });
  });

  it("limits how many attempts one payment gets", async () => {
    for (let i = 0; i < 30; i++) expect(await submitSandboxPaymentAction(null, card("4000000000000002"))).toMatchObject({ ok: true });
    const blocked = await submitSandboxPaymentAction(null, card("4242424242424242"));
    expect(blocked).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect((await getPayment(paymentId)).status).toBe("failed");
  });

  it("marks a sandbox invoice paid with its key, and not without", async () => {
    const sent = await sendInvoice((await createBusinessInvoice({ businessOrgId: await createTestBusiness(), mode: "test", lines: [{ description: "Success fee (synthetic)", amountCents: 2_500 }] })).id);
    const key = new URL(sent.hostedUrl as string).searchParams.get("key") as string;
    expect(await paySandboxInvoiceAction(null, form({ invoiceId: sent.id, key: "wrong" }))).toEqual({ ok: false, error: { code: "not_found", message: "Invoice not found" } });
    expect(await paySandboxInvoiceAction(null, form({ invoiceId: sent.id, key }))).toEqual({ ok: true, data: { invoiceId: sent.id } });
    expect((await getBusinessInvoice(sent.id)).status).toBe("paid");
  });

  it("refuses to operate in production when Stripe is the processor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
    const result = await submitSandboxPaymentAction(null, card("4242 4242 4242 4242"));
    const invoiceResult = await paySandboxInvoiceAction(null, form({ invoiceId: "inv_any", key: "any" }));
    vi.unstubAllEnvs();
    expect(result).toEqual({ ok: false, error: { code: "not_found", message: "Not found" } });
    expect(invoiceResult).toEqual({ ok: false, error: { code: "not_found", message: "Not found" } });
    expect((await getPayment(paymentId)).status).toBe("requires_payment");
  });
});
