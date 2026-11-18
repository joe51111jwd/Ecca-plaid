import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { STRIPE_WEBHOOK_TOLERANCE_SECONDS } from "./policy";
import { parseWebhookSecrets, paymentStatusOf, STRIPE_API_VERSION, stripeKeyMode, StripeProcessor } from "./stripe";
import {
  createFakeStripe,
  createFakeStripeProcessor,
  markIntentPaid,
  signStripeBody,
  stripeEventBody,
  SYNTHETIC_CHARGE_CREATED,
  SYNTHETIC_CONNECT_WEBHOOK_SECRET,
  SYNTHETIC_WEBHOOK_SECRET,
  type FakeStripe,
} from "./stripe-test-support";
import type { CreateInvoiceInput, CreatePaymentInput } from "./types";

/**
 * The Stripe adapter against an injected fake client: what is sent to Stripe, and what is made of what
 * comes back. Nothing here reaches the network, and nothing here has been run against a real Stripe account.
 */

const ACCOUNT = "acct_1SyntheticSgo";

function paymentInput(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    purpose: "donation",
    mode: "test",
    amountCents: 170_000,
    designatedAmountCents: 170_000,
    serviceFeeOnTopCents: 0,
    description: "Contribution to Synthetic Scholarship Fund",
    receiptEmail: "donor@synthetic.example",
    idempotencyKey: "payment_pay_synthetic_create_v1",
    metadata: { payment_id: "pay_synthetic", checkout_session_id: "chk_synthetic", org_id: "org_synthetic" },
    settlement: { connectedAccountId: ACCOUNT },
    ...overrides,
  };
}

function invoiceInput(overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    mode: "test",
    customer: { orgId: "org_camp", name: "Synthetic Summer Camp", email: "billing@synthetic-camp.example", processorCustomerId: null },
    lines: [
      { description: "Success fee: booking SYN-1 (synthetic)", amountCents: 2_500 },
      { description: "Success fee: booking SYN-2 (synthetic)", amountCents: 4_000 },
    ],
    dueInDays: 30,
    description: "Invoice INV-TEST-2026-000001",
    metadata: { invoice_id: "inv_synthetic", invoice_number: "INV-TEST-2026-000001", business_org_id: "org_camp" },
    idempotencyKey: "invoice_inv_synthetic_v1",
    ...overrides,
  };
}

describe("StripeProcessor", () => {
  let stripe: FakeStripe;
  let processor: StripeProcessor;

  beforeEach(() => {
    ({ stripe, processor } = createFakeStripeProcessor());
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pins the API version the SDK was built for", () => {
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
  });

  describe("createPayment", () => {
    it("by default makes a direct charge on the SGO's own account, for the full amount, with no fee and no receipt", async () => {
      const payment = await processor.createPayment(paymentInput());

      expect(stripe.paymentIntents.create).toHaveBeenCalledOnce();
      const [params, requestOptions] = stripe.paymentIntents.create.mock.calls[0];
      expect(params).toEqual({
        amount: 170_000,
        currency: "usd",
        allowed_payment_method_types: ["card", "us_bank_account"],
        payment_method_options: { us_bank_account: { verification_method: "automatic" } },
        description: "Contribution to Synthetic Scholarship Fund",
        metadata: {
          payment_id: "pay_synthetic",
          checkout_session_id: "chk_synthetic",
          org_id: "org_synthetic",
          purpose: "donation",
          mode: "test",
          settlement_mode: "direct",
          designated_cents: "170000",
          service_fee_cents: "0",
        },
      });
      // The charge is created ON the connected account: the gift never touches the platform's balance.
      expect(requestOptions).toEqual({ idempotencyKey: "payment_pay_synthetic_create_v1", stripeAccount: ACCOUNT });
      expect(payment).toEqual({ processorPaymentId: "pi_synthetic1", clientSecret: "pi_synthetic1_secret_synthetic", status: "requires_payment" });
    });

    it("never sends an application fee, a receipt email, a customer, removed parameters or donor data", async () => {
      await processor.createPayment(paymentInput());
      await processor.createPayment(paymentInput({ idempotencyKey: "k2", settlement: { settlementMode: "destination", connectedAccountId: ACCOUNT, counselSignoffRef: "Memo 2027-01 (synthetic)" } }));
      await processor.createPayment(
        paymentInput({ idempotencyKey: "k3", amountCents: 171_700, serviceFeeOnTopCents: 1_700, settlement: { settlementMode: "destination", connectedAccountId: ACCOUNT, counselSignoffRef: "Memo 2027-01 (synthetic)" } }),
      );
      for (const [params] of stripe.paymentIntents.create.mock.calls) {
        for (const forbidden of ["application_fee_amount", "receipt_email", "payment_method_types", "customer", "automatic_payment_methods", "statement_descriptor"]) {
          expect(params).not.toHaveProperty(forbidden);
        }
        expect(JSON.stringify(params)).not.toContain("donor@synthetic.example");
      }
    });

    it("destination charges need counsel's sign-off reference, and transfer the whole gift", async () => {
      await expect(
        processor.createPayment(paymentInput({ settlement: { settlementMode: "destination", connectedAccountId: ACCOUNT, counselSignoffRef: "  " } })),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();

      await processor.createPayment(paymentInput({ settlement: { settlementMode: "destination", connectedAccountId: ACCOUNT, counselSignoffRef: "Memo 2027-01 (synthetic)" } }));
      const [params, requestOptions] = stripe.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({
        amount: 170_000,
        on_behalf_of: ACCOUNT,
        // No amount: Stripe transfers the entire charge to the SGO.
        transfer_data: { destination: ACCOUNT },
        metadata: { settlement_mode: "destination" },
      });
      // Created on the platform account: no Stripe-Account header.
      expect(requestOptions).toEqual({ idempotencyKey: "payment_pay_synthetic_create_v1" });
    });

    it("a donor service fee on top leaves exactly the designated amount with the SGO", async () => {
      await processor.createPayment(
        paymentInput({ amountCents: 171_700, serviceFeeOnTopCents: 1_700, settlement: { settlementMode: "destination", connectedAccountId: ACCOUNT, counselSignoffRef: "Memo 2027-01 (synthetic)" } }),
      );
      const [params] = stripe.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({ amount: 171_700, transfer_data: { destination: ACCOUNT, amount: 170_000 }, metadata: { designated_cents: "170000", service_fee_cents: "1700" } });
    });

    it("refuses a service fee on a direct charge, where it would land in the SGO's account", async () => {
      await expect(processor.createPayment(paymentInput({ amountCents: 171_700, serviceFeeOnTopCents: 1_700 }))).rejects.toMatchObject({ code: "not_available" });
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it("refuses to charge without a connected account, or with amounts that do not add up", async () => {
      for (const settlement of [undefined, {}, { connectedAccountId: "" }, { connectedAccountId: "not-an-account" }, { connectedAccountId: "acct_1; drop" }]) {
        await expect(processor.createPayment(paymentInput({ settlement }))).rejects.toMatchObject({ code: "not_available" });
      }
      await expect(processor.createPayment(paymentInput({ designatedAmountCents: 169_000 }))).rejects.toMatchObject({ code: "internal" });
      await expect(processor.createPayment(paymentInput({ amountCents: 49, designatedAmountCents: 49 }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createPayment(paymentInput({ amountCents: 100_000_000, designatedAmountCents: 100_000_000 }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createPayment(paymentInput({ amountCents: 1700.5, designatedAmountCents: 1700.5 }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createPayment(paymentInput({ serviceFeeOnTopCents: -1, amountCents: 169_999 }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createPayment(paymentInput({ metadata: {} }))).rejects.toMatchObject({ code: "internal" });
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it("keeps test and live apart: by the key's name, and by what Stripe actually created", async () => {
      expect(() => processor.assertModeSupported("test")).not.toThrow();
      expect(() => processor.assertModeSupported("live")).toThrow(/Stripe test key/);
      await expect(processor.createPayment(paymentInput({ mode: "live" }))).rejects.toMatchObject({ code: "not_available" });
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();

      const live = createFakeStripeProcessor({ livemode: true });
      expect(() => live.processor.assertModeSupported("test")).toThrow(/live Stripe key/);
      await expect(live.processor.createPayment(paymentInput({ mode: "test" }))).rejects.toMatchObject({ code: "not_available" });
      expect((await live.processor.createPayment(paymentInput({ mode: "live" }))).status).toBe("requires_payment");

      // A key whose mode cannot be read from its name: Stripe's answer decides, and the stray intent is canceled.
      const unknown = createFakeStripe({ livemode: true });
      const blind = new StripeProcessor({ client: unknown.client, webhookSecrets: [], keyMode: null });
      await expect(blind.createPayment(paymentInput({ mode: "test" }))).rejects.toMatchObject({ code: "not_available", message: expect.stringMatching(/live key/) });
      expect(unknown.paymentIntents.cancel).toHaveBeenCalledWith("pi_synthetic1", { cancellation_reason: "abandoned" }, { stripeAccount: ACCOUNT });
    });

    it("turns Stripe's errors into plain ones and keeps the details in the log", async () => {
      stripe.paymentIntents.create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ type: "api_error", message: "socket hang up at 10.0.0.1" }));
      await expect(processor.createPayment(paymentInput())).rejects.toMatchObject({ code: "not_available", message: "The payment processor could not be reached. Please try again in a moment." });
      stripe.paymentIntents.create.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "parameter_unknown", message: "Received unknown parameter: foo" }));
      const error = await processor.createPayment(paymentInput({ idempotencyKey: "k-invalid" })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "payment_failed", message: "The payment processor did not accept the request." });
      expect((error as AppError).message).not.toContain("foo");
      expect(console.error).toHaveBeenCalledTimes(2);
    });
  });

  describe("retrieve, cancel, refund", () => {
    it("reads a direct charge through the connected account, with the charge expanded for its time and method", async () => {
      const { processorPaymentId } = await processor.createPayment(paymentInput());
      expect(await processor.retrievePayment(processorPaymentId, { connectedAccountId: ACCOUNT })).toMatchObject({ status: "requires_payment", amountCents: 170_000, livemode: false, chargedAt: undefined });
      expect(stripe.paymentIntents.retrieve).toHaveBeenLastCalledWith(processorPaymentId, { expand: ["latest_charge"] }, { stripeAccount: ACCOUNT });

      markIntentPaid(stripe, processorPaymentId, { method: "us_bank_account" });
      const paid = await processor.retrievePayment(processorPaymentId, { connectedAccountId: ACCOUNT });
      expect(paid).toMatchObject({ status: "succeeded", amountCents: 170_000, method: "us_bank_account" });
      expect(paid.chargedAt?.toISOString()).toBe("2027-01-01T05:59:30.000Z");

      // A destination charge lives on the platform account: no Stripe-Account header.
      await processor.retrievePayment(processorPaymentId, { connectedAccountId: null });
      expect(stripe.paymentIntents.retrieve).toHaveBeenLastCalledWith(processorPaymentId, { expand: ["latest_charge"] }, {});
      await expect(processor.retrievePayment("pi_missing")).rejects.toMatchObject({ code: "payment_failed" });
    });

    it("cancels on the account the payment lives on", async () => {
      const { processorPaymentId } = await processor.createPayment(paymentInput());
      const canceled = await processor.cancelPayment(processorPaymentId, { connectedAccountId: ACCOUNT });
      expect(canceled.status).toBe("canceled");
      expect(canceled.canceledAt?.toISOString()).toBe(new Date(1_800_000_000_000).toISOString());
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(processorPaymentId, { cancellation_reason: "abandoned" }, { stripeAccount: ACCOUNT });
    });

    it("refunds a direct charge on the connected account and a destination charge with the transfer reversed", async () => {
      const { processorPaymentId } = await processor.createPayment(paymentInput());
      const refund = await processor.refundPayment({ processorPaymentId, connectedAccountId: ACCOUNT, settlementMode: "direct", idempotencyKey: "payment_pay_synthetic_refund_v1", metadata: { payment_id: "pay_synthetic" } });
      expect(stripe.refunds.create).toHaveBeenLastCalledWith(
        { payment_intent: processorPaymentId, metadata: { payment_id: "pay_synthetic" } },
        { idempotencyKey: "payment_pay_synthetic_refund_v1", stripeAccount: ACCOUNT },
      );
      expect(refund).toEqual({ processorRefundId: "re_synthetic2", status: "succeeded", refundedAt: new Date(1_800_000_500_000), amountCents: 170_000 });

      await processor.refundPayment({ processorPaymentId, connectedAccountId: null, settlementMode: "destination", idempotencyKey: "refund-destination", metadata: { payment_id: "pay_synthetic" } });
      expect(stripe.refunds.create).toHaveBeenLastCalledWith({ payment_intent: processorPaymentId, reverse_transfer: true, metadata: { payment_id: "pay_synthetic" } }, { idempotencyKey: "refund-destination" });
      for (const [params] of stripe.refunds.create.mock.calls) expect(params).not.toHaveProperty("refund_application_fee");
    });

    it("reports a refund Stripe has not completed yet as pending, with no refund time", async () => {
      const { processorPaymentId } = await processor.createPayment(paymentInput());
      stripe.refunds.create.mockResolvedValueOnce({ id: "re_pending", status: "pending", created: 1_800_000_500, amount: 170_000 });
      expect(await processor.refundPayment({ processorPaymentId, connectedAccountId: ACCOUNT, settlementMode: "direct", idempotencyKey: "r1", metadata: {} })).toEqual({
        processorRefundId: "re_pending",
        status: "pending",
        refundedAt: undefined,
        amountCents: 170_000,
      });
      stripe.refunds.create.mockResolvedValueOnce({ id: "re_failed", status: "failed", created: 1_800_000_500, amount: 170_000 });
      expect((await processor.refundPayment({ processorPaymentId, connectedAccountId: ACCOUNT, settlementMode: "direct", idempotencyKey: "r2", metadata: {} })).status).toBe("failed");
    });
  });

  describe("invoices", () => {
    it("creates the customer, a send_invoice invoice with terms, one item per line, and finalizes it", async () => {
      const invoice = await processor.createInvoice(invoiceInput());

      expect(stripe.customers.create).toHaveBeenCalledWith(
        { name: "Synthetic Summer Camp", email: "billing@synthetic-camp.example", metadata: { org_id: "org_camp" } },
        { idempotencyKey: "business_org_camp_customer_v1" },
      );
      expect(stripe.invoices.create).toHaveBeenCalledWith(
        {
          customer: "cus_synthetic1",
          collection_method: "send_invoice",
          days_until_due: 30,
          auto_advance: false,
          pending_invoice_items_behavior: "exclude",
          payment_settings: { payment_method_types: ["us_bank_account", "card"] },
          description: "Invoice INV-TEST-2026-000001",
          metadata: { invoice_id: "inv_synthetic", invoice_number: "INV-TEST-2026-000001", business_org_id: "org_camp", mode: "test" },
        },
        { idempotencyKey: "invoice_inv_synthetic_v1_invoice" },
      );
      expect(stripe.invoiceItems.create.mock.calls).toEqual([
        [{ customer: "cus_synthetic1", invoice: "in_synthetic2", amount: 2_500, currency: "usd", description: "Success fee: booking SYN-1 (synthetic)", metadata: { invoice_id: "inv_synthetic" } }, { idempotencyKey: "invoice_inv_synthetic_v1_item_0" }],
        [{ customer: "cus_synthetic1", invoice: "in_synthetic2", amount: 4_000, currency: "usd", description: "Success fee: booking SYN-2 (synthetic)", metadata: { invoice_id: "inv_synthetic" } }, { idempotencyKey: "invoice_inv_synthetic_v1_item_1" }],
      ]);
      // `price` was removed from invoice items in this API version.
      for (const [params] of stripe.invoiceItems.create.mock.calls) expect(params).not.toHaveProperty("price");
      expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith("in_synthetic2", undefined, { idempotencyKey: "invoice_inv_synthetic_v1_finalize" });
      expect(invoice).toEqual({ processorInvoiceId: "in_synthetic2", hostedUrl: "https://invoice.stripe.example/i/in_synthetic2", status: "open", processorCustomerId: "cus_synthetic1" });
    });

    it("reuses a known Stripe customer, and replaces one that no longer exists", async () => {
      await processor.createInvoice(invoiceInput({ customer: { orgId: "org_camp", name: "Synthetic Summer Camp", email: "new-billing@synthetic-camp.example", processorCustomerId: "cus_Known123" } }));
      expect(stripe.customers.update).toHaveBeenCalledWith("cus_Known123", { name: "Synthetic Summer Camp", email: "new-billing@synthetic-camp.example" });
      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.invoices.create.mock.calls[0][0]).toMatchObject({ customer: "cus_Known123" });

      stripe.customers.update.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", message: "No such customer" }));
      const replaced = await processor.createInvoice(invoiceInput({ idempotencyKey: "invoice_two", customer: { orgId: "org_camp", name: "Synthetic Summer Camp", email: "b@synthetic-camp.example", processorCustomerId: "cus_Deleted999" } }));
      expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ email: "b@synthetic-camp.example" }), { idempotencyKey: "invoice_two_customer" });
      expect(replaced.processorCustomerId).not.toBe("cus_Deleted999");

      // A sandbox customer id left on the profile is not a Stripe customer: a new one is created.
      await processor.createInvoice(invoiceInput({ idempotencyKey: "invoice_three", customer: { orgId: "org_other", name: "Other Camp", email: "o@synthetic-camp.example", processorCustomerId: "sbx_cus_0123456789abcdef01234567" } }));
      expect(stripe.customers.create).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { org_id: "org_other" } }), { idempotencyKey: "business_org_other_customer_v1" });
    });

    it("voids the Stripe invoice and fails when Stripe's total is not ours, or there is no hosted page", async () => {
      stripe.invoices.finalizeInvoice.mockResolvedValueOnce({ id: "in_taxed", status: "open", livemode: false, total: 7_000, hosted_invoice_url: "https://invoice.stripe.example/i/in_taxed" });
      await expect(processor.createInvoice(invoiceInput())).rejects.toMatchObject({ code: "internal", message: expect.stringContaining("7000 cents") });
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_taxed");

      stripe.invoices.finalizeInvoice.mockResolvedValueOnce({ id: "in_nopage", status: "open", livemode: false, total: 6_500, hosted_invoice_url: null });
      await expect(processor.createInvoice(invoiceInput({ idempotencyKey: "other" }))).rejects.toMatchObject({ code: "internal" });
    });

    it("validates lines and mode before calling Stripe", async () => {
      await expect(processor.createInvoice(invoiceInput({ lines: [] }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createInvoice(invoiceInput({ lines: [{ description: "x", amountCents: 0 }] }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createInvoice(invoiceInput({ lines: Array.from({ length: 251 }, () => ({ description: "x", amountCents: 1 })) }))).rejects.toMatchObject({ code: "validation_failed" });
      await expect(processor.createInvoice(invoiceInput({ mode: "live" }))).rejects.toMatchObject({ code: "not_available" });
      await expect(processor.createInvoice(invoiceInput({ metadata: {} }))).rejects.toMatchObject({ code: "internal" });
      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.invoices.create).not.toHaveBeenCalled();
    });

    it("voids an invoice, and closes one paid outside Stripe without charging anything", async () => {
      expect(await processor.voidInvoice("in_1")).toEqual({ status: "void" });
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_1");
      expect(await processor.markInvoicePaidOutOfBand("in_1")).toEqual({ status: "paid" });
      expect(stripe.invoices.pay).toHaveBeenCalledWith("in_1", { paid_out_of_band: true });
    });
  });

  describe("webhooks", () => {
    const intent = (overrides: Record<string, unknown> = {}) => ({ id: "pi_synthetic1", object: "payment_intent", amount: 170_000, amount_received: 170_000, status: "succeeded", latest_charge: "ch_pi_synthetic1", last_payment_error: null, ...overrides });

    it("accepts a body signed with Stripe's documented test signature, and reads the charge time from Stripe", async () => {
      await processor.createPayment(paymentInput());
      markIntentPaid(stripe, "pi_synthetic1");
      const body = stripeEventBody("payment_intent.succeeded", intent(), { account: ACCOUNT, created: 1_800_000_000 });

      const events = await processor.parseWebhook(body, signStripeBody(body));
      expect(events).toEqual([
        {
          id: expect.stringMatching(/^evt_synthetic/),
          processor: "stripe",
          occurredAt: new Date(1_800_000_000_000),
          livemode: false,
          connectedAccountId: ACCOUNT,
          type: "payment.succeeded",
          processorPaymentId: "pi_synthetic1",
          // Not the event's time: the charge's.
          chargedAt: new Date(SYNTHETIC_CHARGE_CREATED * 1000),
          amountCents: 170_000,
          attemptId: "ch_pi_synthetic1",
          method: "card",
        },
      ]);
      // Direct charge: the intent is read through the connected account the event came from.
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_synthetic1", { expand: ["latest_charge"] }, { stripeAccount: ACCOUNT });
    });

    it("rejects a body that was changed after signing", async () => {
      const body = stripeEventBody("payment_intent.processing", intent({ status: "processing" }));
      const signature = signStripeBody(body);
      await expect(processor.parseWebhook(body.replace("170000", "100"), signature)).rejects.toMatchObject({ code: "bad_request", status: 400 });
      // Re-serializing the JSON is a change too: the signature covers the exact bytes.
      await expect(processor.parseWebhook(JSON.stringify(JSON.parse(body), null, 1), signature)).rejects.toMatchObject({ code: "bad_request" });
      expect(await processor.parseWebhook(body, signature)).toHaveLength(1);
    });

    it("rejects a signature older than the tolerance, and accepts one just inside it", async () => {
      const body = stripeEventBody("payment_intent.processing", intent({ status: "processing" }));
      const nowSeconds = Math.floor(Date.now() / 1000);
      await expect(processor.parseWebhook(body, signStripeBody(body, SYNTHETIC_WEBHOOK_SECRET, nowSeconds - STRIPE_WEBHOOK_TOLERANCE_SECONDS - 60))).rejects.toMatchObject({ code: "bad_request" });
      expect(await processor.parseWebhook(body, signStripeBody(body, SYNTHETIC_WEBHOOK_SECRET, nowSeconds - STRIPE_WEBHOOK_TOLERANCE_SECONDS + 60))).toHaveLength(1);
    });

    it("rejects a wrong secret, a missing or malformed header, and works with either destination's secret", async () => {
      const body = stripeEventBody("payment_intent.processing", intent({ status: "processing" }));
      await expect(processor.parseWebhook(body, signStripeBody(body, "whsec_someone_elses"))).rejects.toMatchObject({ code: "bad_request" });
      await expect(processor.parseWebhook(body, null)).rejects.toMatchObject({ code: "bad_request" });
      await expect(processor.parseWebhook(body, "")).rejects.toMatchObject({ code: "bad_request" });
      await expect(processor.parseWebhook(body, "t=notanumber,v1=abc")).rejects.toMatchObject({ code: "bad_request" });
      await expect(processor.parseWebhook(body, "v0=abc")).rejects.toMatchObject({ code: "bad_request" });
      await expect(processor.parseWebhook("", signStripeBody(body))).rejects.toMatchObject({ code: "bad_request" });
      // The "Connected accounts" destination signs with its own secret.
      expect(await processor.parseWebhook(body, signStripeBody(body, SYNTHETIC_CONNECT_WEBHOOK_SECRET))).toHaveLength(1);
    });

    it("says so when no webhook secret is configured, instead of accepting anything", async () => {
      const unconfigured = new StripeProcessor({ client: stripe.client, webhookSecrets: [], keyMode: "test" });
      const body = stripeEventBody("payment_intent.processing", intent());
      await expect(unconfigured.parseWebhook(body, signStripeBody(body))).rejects.toMatchObject({ code: "not_available" });
    });

    it("fails the webhook (so Stripe redelivers) when the charge time cannot be read", async () => {
      const body = stripeEventBody("payment_intent.succeeded", intent({ id: "pi_unknown_to_fake" }));
      await expect(processor.parseWebhook(body, signStripeBody(body))).rejects.toMatchObject({ code: "payment_failed" });
    });

    it("normalizes each event type it acts on", async () => {
      const parse = async (type: string, object: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
        const body = stripeEventBody(type, object, overrides);
        return processor.parseWebhook(body, signStripeBody(body));
      };

      expect(await parse("payment_intent.processing", intent({ status: "processing" }))).toMatchObject([{ type: "payment.processing", processorPaymentId: "pi_synthetic1", attemptId: "ch_pi_synthetic1" }]);

      const declined = intent({ status: "requires_payment_method", last_payment_error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds.", charge: "ch_declined" } });
      expect(await parse("payment_intent.payment_failed", declined)).toMatchObject([
        { type: "payment.failed", failureReason: "Your card has insufficient funds.", failureCode: "insufficient_funds", attemptId: "ch_declined" },
      ]);
      // Only card errors are documented as showable; anything else gets a neutral sentence.
      const technical = intent({ status: "requires_payment_method", last_payment_error: { type: "api_error", message: "Internal lock timeout on resource ba_123" } });
      const [failed] = await parse("payment_intent.payment_failed", technical);
      expect(failed).toMatchObject({ type: "payment.failed", failureReason: "The payment could not be completed. Please try again or use a different payment method." });

      expect(await parse("payment_intent.canceled", intent({ status: "canceled", cancellation_reason: "abandoned" }))).toMatchObject([{ type: "payment.canceled", reason: "abandoned" }]);

      const charge = { id: "ch_1", object: "charge", payment_intent: "pi_synthetic1", amount: 170_000, amount_refunded: 170_000, refunded: true };
      expect(await parse("charge.refunded", charge, { created: 1_800_000_900 })).toEqual([
        expect.objectContaining({ type: "payment.refunded", processorPaymentId: "pi_synthetic1", refundedAmountCents: 170_000, fullyRefunded: true, occurredAt: new Date(1_800_000_900_000) }),
      ]);
      expect(await parse("charge.refunded", { ...charge, amount_refunded: 5_000, refunded: false })).toMatchObject([{ refundedAmountCents: 5_000, fullyRefunded: false }]);
      // A charge with no PaymentIntent is not one of ours.
      expect(await parse("charge.refunded", { ...charge, payment_intent: null })).toEqual([]);

      expect(await parse("invoice.paid", { id: "in_1", object: "invoice", status: "paid", status_transitions: { paid_at: 1_800_000_123 } })).toMatchObject([
        { type: "invoice.paid", processorInvoiceId: "in_1", paidAt: new Date(1_800_000_123_000) },
      ]);
      expect(await parse("invoice.paid", { id: "in_1", object: "invoice", status: "paid", status_transitions: { paid_at: null } }, { created: 1_800_000_456 })).toMatchObject([{ paidAt: new Date(1_800_000_456_000) }]);
      expect(await parse("invoice.voided", { id: "in_1", object: "invoice", status: "void" })).toMatchObject([{ type: "invoice.voided", processorInvoiceId: "in_1" }]);
      expect(await parse("invoice.payment_failed", { id: "in_1", object: "invoice", status: "open" })).toMatchObject([{ type: "invoice.payment_failed", processorInvoiceId: "in_1" }]);

      // Verified, but not something we act on.
      expect(await parse("customer.created", { id: "cus_1", object: "customer" })).toEqual([]);
      expect(await parse("charge.dispute.created", { id: "dp_1", object: "dispute" })).toEqual([]);
    });
  });

  describe("helpers", () => {
    it("reads the mode from a key's name", () => {
      expect(stripeKeyMode("sk_test_synthetic")).toBe("test");
      expect(stripeKeyMode("rk_test_synthetic")).toBe("test");
      expect(stripeKeyMode("sk_live_synthetic")).toBe("live");
      expect(stripeKeyMode("rk_live_synthetic")).toBe("live");
      expect(stripeKeyMode("something-else")).toBeNull();
    });

    it("splits several webhook secrets", () => {
      expect(parseWebhookSecrets(undefined)).toEqual([]);
      expect(parseWebhookSecrets("  ")).toEqual([]);
      expect(parseWebhookSecrets("whsec_a")).toEqual(["whsec_a"]);
      expect(parseWebhookSecrets("whsec_a, whsec_b\nwhsec_c")).toEqual(["whsec_a", "whsec_b", "whsec_c"]);
    });

    it("maps PaymentIntent statuses to ours", () => {
      const status = (s: string, error: unknown = null) => paymentStatusOf({ status: s, last_payment_error: error } as Parameters<typeof paymentStatusOf>[0]);
      expect(status("succeeded")).toBe("succeeded");
      expect(status("processing")).toBe("processing");
      expect(status("requires_capture")).toBe("processing");
      expect(status("canceled")).toBe("canceled");
      expect(status("requires_payment_method")).toBe("requires_payment");
      expect(status("requires_payment_method", { message: "declined" })).toBe("failed");
      expect(status("requires_confirmation")).toBe("requires_payment");
      expect(status("requires_action")).toBe("requires_payment");
      expect(status("a_status_added_later")).toBe("requires_payment");
    });
  });
});
