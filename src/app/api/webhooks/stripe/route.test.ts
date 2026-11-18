import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listJobs } from "@/server/jobs";
import { createDonationPayment } from "@/server/payments";
import { setProcessorForTests } from "@/server/payments/processor";
import { StripeProcessor } from "@/server/payments/stripe";
import {
  createFakeStripeProcessor,
  markIntentPaid,
  signStripeBody,
  stripeEventBody,
  SYNTHETIC_CHARGE_CREATED,
  SYNTHETIC_CONNECT_WEBHOOK_SECRET,
  type FakeStripe,
} from "@/server/payments/stripe-test-support";
import { createTestCheckout, createTestSgo } from "@/server/payments/test-support";
import { useTestDb } from "../../../../../tests/helpers/db";
import { POST } from "./route";

const URL = "http://localhost/api/webhooks/stripe";
const ACCOUNT = "acct_1SyntheticSgo";

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new Request(URL, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
}

describe("POST /api/webhooks/stripe", () => {
  const t = useTestDb();
  let stripe: FakeStripe;
  let paymentId: string;

  const payment = async () => (await t.db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)))[0];
  const jobs = async () => (await listJobs({ type: "donation.payment_updated" })).map((j) => j.payload);
  const intent = (overrides: Record<string, unknown> = {}) => ({ id: "pi_synthetic1", object: "payment_intent", amount: 170_000, amount_received: 170_000, status: "succeeded", latest_charge: "ch_pi_synthetic1", last_payment_error: null, ...overrides });
  const succeeded = () => stripeEventBody("payment_intent.succeeded", intent(), { account: ACCOUNT });

  beforeEach(async () => {
    setTestNow("2027-01-04T18:00:00.000Z");
    const fake = createFakeStripeProcessor();
    stripe = fake.stripe;
    setProcessorForTests("stripe", fake.processor);
    vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_synthetic");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const orgId = await createTestSgo({ paymentsAccountId: ACCOUNT });
    const created = await createDonationPayment({
      checkoutSessionId: await createTestCheckout(orgId),
      orgId,
      amountCents: 170_000,
      lines: [{ kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" }],
      idempotencyKey: "attempt-1",
      mode: "test",
    });
    paymentId = created.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
    setProcessorForTests("stripe", null);
    vi.restoreAllMocks();
  });

  it("verifies the raw body, records the payment with Stripe's charge time and enqueues the donations job", async () => {
    markIntentPaid(stripe, "pi_synthetic1", { method: "card" });
    const body = succeeded();
    // Signed by the "Connected accounts" destination: direct charges report from the SGO's account.
    const res = await post(body, { "stripe-signature": signStripeBody(body, SYNTHETIC_CONNECT_WEBHOOK_SECRET) });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ received: true, events: 1, applied: 1 });
    const paid = await payment();
    expect(paid).toMatchObject({ status: "succeeded", method: "card" });
    // December 31, 2026 in Texas — not the webhook's time, and not "now" (January 4).
    expect(paid.paidAt?.toISOString()).toBe(new Date(SYNTHETIC_CHARGE_CREATED * 1000).toISOString());
    expect(await jobs()).toEqual([{ paymentId }]);
  });

  it("answers 400 and changes nothing for a bad, missing, tampered or stale signature", async () => {
    markIntentPaid(stripe, "pi_synthetic1");
    const body = succeeded();
    const signature = signStripeBody(body);
    const stale = signStripeBody(body, undefined, Math.floor(Date.now() / 1000) - 3600);

    const attempts = [
      await post(body),
      await post(body, { "stripe-signature": "" }),
      await post(body, { "stripe-signature": "t=1,v1=deadbeef" }),
      await post(body, { "stripe-signature": signStripeBody(body, "whsec_not_ours") }),
      await post(body.replace('"amount_received":170000', '"amount_received":1'), { "stripe-signature": signature }),
      await post(`${body} `, { "stripe-signature": signature }),
      await post(body, { "stripe-signature": stale }),
    ];
    expect(attempts.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    expect(await attempts[0].json()).toEqual({ error: { code: "bad_request", message: "Missing Stripe-Signature header" } });
    expect(await attempts[4].json()).toEqual({ error: { code: "bad_request", message: "The Stripe signature could not be verified" } });
    expect(await payment()).toMatchObject({ status: "requires_payment", paidAt: null });
    expect(await jobs()).toHaveLength(0);
    // Nothing was looked up at Stripe for a request that did not verify.
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("is idempotent: the same event delivered again is acknowledged and applied once", async () => {
    markIntentPaid(stripe, "pi_synthetic1");
    const body = succeeded();
    const headers = { "stripe-signature": signStripeBody(body) };
    expect(await (await post(body, headers)).json()).toEqual({ received: true, events: 1, applied: 1 });
    for (let i = 0; i < 3; i++) {
      const again = await post(body, headers);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ received: true, events: 1, applied: 0 });
    }
    expect(await jobs()).toHaveLength(1);
  });

  it("acknowledges events it does not act on, and events for objects that are not ours", async () => {
    const other = stripeEventBody("customer.created", { id: "cus_1", object: "customer" });
    expect(await (await post(other, { "stripe-signature": signStripeBody(other) })).json()).toEqual({ received: true, events: 0, applied: 0 });
    const foreign = stripeEventBody("payment_intent.processing", intent({ id: "pi_for_an_invoice", status: "processing" }));
    const res = await post(foreign, { "stripe-signature": signStripeBody(foreign) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, events: 1, applied: 0 });
    expect((await payment()).status).toBe("requires_payment");
  });

  it("handles a decline followed by a successful retry on the same intent", async () => {
    const declined = stripeEventBody(
      "payment_intent.payment_failed",
      intent({ status: "requires_payment_method", amount_received: 0, latest_charge: "ch_declined", last_payment_error: { type: "card_error", code: "card_declined", message: "Your card was declined.", charge: "ch_declined" } }),
      { created: 1_800_000_000 },
    );
    expect((await post(declined, { "stripe-signature": signStripeBody(declined) })).status).toBe(200);
    expect(await payment()).toMatchObject({ status: "failed", failureReason: "Your card was declined." });

    markIntentPaid(stripe, "pi_synthetic1");
    const ok = stripeEventBody("payment_intent.succeeded", intent(), { created: 1_800_000_060 });
    expect((await post(ok, { "stripe-signature": signStripeBody(ok) })).status).toBe(200);
    expect(await payment()).toMatchObject({ status: "succeeded", failureReason: null });
    // The first attempt's decline, redelivered late, does not undo the success.
    expect(await (await post(declined, { "stripe-signature": signStripeBody(declined) })).json()).toEqual({ received: true, events: 1, applied: 0 });
    expect((await payment()).status).toBe("succeeded");
  });

  it("asks Stripe to redeliver a refund that arrives before its payment's success", async () => {
    const refund = stripeEventBody("charge.refunded", { id: "ch_pi_synthetic1", object: "charge", payment_intent: "pi_synthetic1", amount: 170_000, amount_refunded: 170_000, refunded: true });
    const early = await post(refund, { "stripe-signature": signStripeBody(refund) });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ received: false, retry: true });
    expect((await payment()).status).toBe("requires_payment");

    markIntentPaid(stripe, "pi_synthetic1");
    const ok = succeeded();
    await post(ok, { "stripe-signature": signStripeBody(ok) });
    const redelivered = await post(refund, { "stripe-signature": signStripeBody(refund) });
    expect(redelivered.status).toBe(200);
    expect(await payment()).toMatchObject({ status: "refunded" });
  });

  it("answers 409 and records nothing when Stripe collected a different amount than was asked for", async () => {
    markIntentPaid(stripe, "pi_synthetic1");
    const wrong = stripeEventBody("payment_intent.succeeded", intent({ amount_received: 100 }));
    const res = await post(wrong, { "stripe-signature": signStripeBody(wrong) });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(await payment()).toMatchObject({ status: "requires_payment", paidAt: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("fails (so Stripe retries) when the charge time cannot be read from Stripe", async () => {
    // Stripe still reports the intent as unpaid when we look: the success event cannot be completed yet.
    stripe.paymentIntents.retrieve.mockRejectedValueOnce(new Error("socket hang up"));
    const body = succeeded();
    const res = await post(body, { "stripe-signature": signStripeBody(body) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal", message: "Something went wrong" } });
    expect((await payment()).status).toBe("requires_payment");
  });

  it("refuses oversized bodies without reading or verifying them", async () => {
    const declared = await post("{}", { "content-length": "5000000", "stripe-signature": "t=1,v1=x" });
    expect(declared.status).toBe(413);
    const huge = "x".repeat(1_000_001);
    const actual = await post(huge, { "stripe-signature": signStripeBody(huge) });
    expect(actual.status).toBe(413);
  });

  it("answers 503 when Stripe is not configured here", async () => {
    setProcessorForTests("stripe", new StripeProcessor({ client: stripe.client, webhookSecrets: [], keyMode: "test" }));
    const body = succeeded();
    const res = await post(body, { "stripe-signature": signStripeBody(body) });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("not_available");
  });
});
