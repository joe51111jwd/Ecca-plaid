import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { listJobs } from "@/server/jobs";
import { setSetting } from "@/server/settings";
import { useTestDb } from "../../../tests/helpers/db";
import { cancelPayment, cancelRow, createDonationPayment, getPayment, getPaymentForClient, refundPayment, syncPaymentWithProcessor, type CreateDonationPaymentInput } from "./donation-payments";
import { applyProcessorEvent } from "./events";
import { META } from "./metadata";
import { setProcessorForTests } from "./processor";
import { confirmSandboxPayment, sandboxPaymentSecret } from "./sandbox";
import { createFakeStripeProcessor, markIntentPaid, SYNTHETIC_CHARGE_CREATED, type FakeStripe } from "./stripe-test-support";
import { createTestCheckout, createTestSgo } from "./test-support";

const NOW = new Date("2026-12-10T15:00:00.000Z");
const ACCOUNT = "acct_1SyntheticSgo";
const OPERATOR = "usr_synthetic_operator";

describe("donation payments", () => {
  const t = useTestDb();
  let orgId: string;
  let checkoutSessionId: string;

  function input(overrides: Partial<CreateDonationPaymentInput> = {}): CreateDonationPaymentInput {
    return {
      checkoutSessionId,
      orgId,
      amountCents: 170_000,
      lines: [{ kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" }],
      receiptEmail: "donor@synthetic.example",
      idempotencyKey: "attempt-1",
      mode: "test",
      ...overrides,
    };
  }

  const payWithTestCard = (paymentId: string, cardNumber = "4242424242424242") =>
    confirmSandboxPayment({ paymentId, clientSecret: sandboxPaymentSecret(paymentId), cardNumber, expiry: "12/30", securityCode: "123" });
  const rows = () => t.db.select().from(schema.payments);
  const jobs = async () => (await listJobs({ type: "donation.payment_updated" })).map((j) => j.payload.paymentId);

  async function fieldsOf(promise: Promise<unknown>): Promise<string[]> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "validation_failed" });
    return Object.keys(((error as AppError).details as { fields: Record<string, string> }).fields);
  }

  beforeEach(async () => {
    setTestNow(NOW);
    orgId = await createTestSgo({ paymentsAccountId: ACCOUNT });
    checkoutSessionId = await createTestCheckout(orgId);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
    setProcessorForTests("stripe", null);
    vi.restoreAllMocks();
  });

  describe("createDonationPayment", () => {
    it("creates the row and the processor payment, and records what the payment is made of", async () => {
      const payment = await createDonationPayment(
        input({
          amountCents: 171_700,
          lines: [
            { kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" },
            { kind: "donor_service_fee", amountCents: 1_700, description: "Service fee (synthetic)" },
          ],
        }),
      );
      expect(payment).toMatchObject({
        processor: "sandbox",
        purpose: "donation",
        checkoutSessionId,
        orgId,
        mode: "test",
        amountCents: 171_700,
        designatedAmountCents: 170_000,
        serviceFeeCents: 1_700,
        currency: "usd",
        status: "requires_payment",
        paidAt: null,
        description: "Contribution to Synthetic Scholarship Fund",
        created: true,
      });
      expect(payment.id).toMatch(/^pay_/);
      expect(payment.lines).toHaveLength(2);
      const [row] = await rows();
      expect(row.processorPaymentId).toBe(payment.processorPaymentId);
      // The receipt address is for our own receipt; it is not kept with the payment.
      expect(JSON.stringify(row)).not.toContain("donor@synthetic.example");
      const [entry] = (await listAuditLogs({ targetId: payment.id })).items;
      expect(entry).toMatchObject({ action: "payment.created", orgId });
      expect(entry.metadata).toMatchObject({ processor: "sandbox", mode: "test", amountCents: 171_700, designatedCents: 170_000, settlementMode: "direct" });
    });

    it("rejects amounts and lines that could hide a fee inside the gift", async () => {
      // The total must be exactly the sum of the lines.
      expect(await fieldsOf(createDonationPayment(input({ amountCents: 169_000 })))).toEqual(["amountCents"]);
      // A "negative fee" (a deduction) cannot be expressed.
      expect(
        await fieldsOf(
          createDonationPayment(
            input({
              amountCents: 168_300,
              lines: [
                { kind: "designated_contribution", amountCents: 170_000, description: "Gift" },
                { kind: "donor_service_fee", amountCents: -1_700, description: "Fee out of the gift" },
              ],
            }),
          ),
        ),
      ).toEqual(["lines.1.amountCents"]);
      // A payment that is only a fee is not a donation payment.
      expect(await fieldsOf(createDonationPayment(input({ amountCents: 1_700, lines: [{ kind: "donor_service_fee", amountCents: 1_700, description: "Fee" }] })))).toEqual(["lines"]);
      expect(
        await fieldsOf(
          createDonationPayment(
            input({
              amountCents: 170_200,
              lines: [
                { kind: "designated_contribution", amountCents: 170_000, description: "Gift" },
                { kind: "donor_service_fee", amountCents: 100, description: "Fee" },
                { kind: "donor_service_fee", amountCents: 100, description: "Another fee" },
              ],
            }),
          ),
        ),
      ).toEqual(["lines"]);
      expect(await fieldsOf(createDonationPayment(input({ amountCents: 49, lines: [{ kind: "designated_contribution", amountCents: 49, description: "Gift" }] })))).toEqual(["amountCents"]);
      expect(await fieldsOf(createDonationPayment(input({ amountCents: 1700.5, lines: [{ kind: "designated_contribution", amountCents: 1700.5, description: "Gift" }] })))).toContain("amountCents");
      expect(await fieldsOf(createDonationPayment(input({ lines: [] })))).toContain("lines");
      expect(await fieldsOf(createDonationPayment(input({ receiptEmail: "not-an-email" })))).toEqual(["receiptEmail"]);
      expect(await fieldsOf(createDonationPayment(input({ idempotencyKey: "" })))).toEqual(["idempotencyKey"]);
      expect(await fieldsOf(createDonationPayment(input({ mode: "production" as "live" })))).toEqual(["mode"]);
      // The settlement option only exists in its counsel-approved form.
      expect(await fieldsOf(createDonationPayment(input({ settlement: { settlementMode: "destination", counselSignoffRef: "" } })))).toEqual(["settlement.counselSignoffRef"]);
      expect(await fieldsOf(createDonationPayment(input({ settlement: { settlementMode: "destination", counselSignoffRef: "Memo", applicationFeeCents: 100 } as never })))).toEqual(["settlement"]);
      expect(await rows()).toHaveLength(0);
    });

    it("returns the same payment for the same idempotency key, and refuses the key for different details", async () => {
      const first = await createDonationPayment(input());
      const again = await createDonationPayment(input());
      expect(again).toMatchObject({ id: first.id, processorPaymentId: first.processorPaymentId, created: false });
      expect(again.client).toEqual(first.client);
      expect(await rows()).toHaveLength(1);
      await expect(createDonationPayment(input({ amountCents: 100_000, lines: [{ kind: "designated_contribution", amountCents: 100_000, description: "Gift" }] }))).rejects.toMatchObject({
        code: "conflict",
        details: { paymentId: first.id },
      });
      // Still the same after it has been paid: the key names that payment for good.
      await payWithTestCard(first.id);
      expect(await createDonationPayment(input())).toMatchObject({ id: first.id, status: "succeeded", created: false });
    });

    it("makes one payment when the same request arrives several times at once", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => createDonationPayment(input())));
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await rows()).toHaveLength(1);
    });

    it("a new key replaces the earlier unpaid payment, so only one can ever be paid", async () => {
      const first = await createDonationPayment(input());
      const second = await createDonationPayment(input({ idempotencyKey: "attempt-2", amountCents: 100_000, lines: [{ kind: "designated_contribution", amountCents: 100_000, description: "Gift" }] }));
      expect(second.id).not.toBe(first.id);
      expect(await getPayment(first.id)).toMatchObject({ status: "canceled" });
      expect((await rows()).find((r) => r.id === first.id)?.metadata[META.cancelReason]).toBe("superseded");
      expect(await jobs()).toEqual([first.id]);
      // The replaced payment can no longer be paid, even by someone still holding its page open.
      await expect(payWithTestCard(first.id)).rejects.toMatchObject({ code: "conflict" });
      expect((await payWithTestCard(second.id)).status).toBe("succeeded");
    });

    it("refuses a second payment once the checkout is being paid or has been paid", async () => {
      const first = await createDonationPayment(input());
      await payWithTestCard(first.id, "4242424242420000");
      await expect(createDonationPayment(input({ idempotencyKey: "attempt-2" }))).rejects.toMatchObject({ code: "conflict", message: "A payment for this checkout is already being processed.", details: { paymentId: first.id } });

      const otherCheckout = await createTestCheckout(orgId);
      const paid = await createDonationPayment(input({ checkoutSessionId: otherCheckout }));
      await payWithTestCard(paid.id);
      await expect(createDonationPayment(input({ checkoutSessionId: otherCheckout, idempotencyKey: "attempt-2" }))).rejects.toMatchObject({ code: "conflict", message: "This checkout has already been paid." });
      expect(await rows()).toHaveLength(2);
    });

    it("lets a failed payment be replaced", async () => {
      const first = await createDonationPayment(input());
      await payWithTestCard(first.id, "4000000000000002");
      const second = await createDonationPayment(input({ idempotencyKey: "attempt-2" }));
      expect(second.status).toBe("requires_payment");
      expect((await getPayment(first.id)).status).toBe("canceled");
    });

    it("checks that the checkout belongs to the organization, is in the same mode and is still open", async () => {
      const otherOrg = await createTestSgo({ name: "Another Synthetic Fund" });
      await expect(createDonationPayment(input({ orgId: otherOrg }))).rejects.toMatchObject({ code: "not_found" });
      await expect(createDonationPayment(input({ checkoutSessionId: "chk_missing" }))).rejects.toMatchObject({ code: "not_found" });
      for (const status of ["completed", "expired", "canceled"] as const) {
        const closed = await createTestCheckout(orgId, { status });
        await expect(createDonationPayment(input({ checkoutSessionId: closed }))).rejects.toMatchObject({ code: "conflict" });
      }
      // A business is not an SGO: it cannot receive a gift.
      const businessId = newId("org");
      await t.db.insert(schema.organizations).values({ id: businessId, type: "business", name: "Synthetic Camp", slug: `camp-${businessId}` });
      const businessCheckout = await createTestCheckout(businessId);
      await expect(createDonationPayment(input({ orgId: businessId, checkoutSessionId: businessCheckout }))).rejects.toMatchObject({ code: "not_found" });
      expect(await rows()).toHaveLength(0);
    });

    it("never takes a live payment through the sandbox", async () => {
      const liveCheckout = await createTestCheckout(orgId, { mode: "live" });
      await expect(createDonationPayment(input({ checkoutSessionId: liveCheckout, mode: "live" }))).rejects.toMatchObject({ code: "not_available", message: expect.stringContaining("never moves money") });
      // And a test payment cannot be attached to a live checkout.
      await expect(createDonationPayment(input({ checkoutSessionId: liveCheckout }))).rejects.toMatchObject({ code: "conflict" });
      expect(await rows()).toHaveLength(0);
    });
  });

  describe("reading", () => {
    it("gives the browser what it needs, and only within the caller's scope", async () => {
      const payment = await createDonationPayment(input());
      const client = await getPaymentForClient(payment.id, { checkoutSessionId });
      expect(client).toEqual(payment.client);
      expect(client).toMatchObject({ provider: "sandbox", paymentId: payment.id, mode: "test", status: "requires_payment", amountCents: 170_000, currency: "usd", failureReason: null });
      expect(await getPaymentForClient(payment.id)).toEqual(client);
      expect(await getPaymentForClient(payment.id, { orgId })).toEqual(client);

      const otherCheckout = await createTestCheckout(orgId);
      await expect(getPaymentForClient(payment.id, { checkoutSessionId: otherCheckout })).rejects.toMatchObject({ code: "not_found" });
      await expect(getPaymentForClient(payment.id, { orgId: "org_other" })).rejects.toMatchObject({ code: "not_found" });
      await expect(getPayment(payment.id, { orgId: "org_other" })).rejects.toMatchObject({ code: "not_found" });
      await expect(getPaymentForClient("pay_missing")).rejects.toMatchObject({ code: "not_found" });

      await payWithTestCard(payment.id, "4000000000000002");
      expect(await getPaymentForClient(payment.id)).toMatchObject({ status: "failed", failureReason: "The test card was declined." });
    });
  });

  describe("cancelPayment", () => {
    it("cancels an unpaid payment and tells the donations domain", async () => {
      const payment = await createDonationPayment(input());
      expect(await cancelPayment(payment.id, { checkoutSessionId, reason: "donor_left" })).toMatchObject({ id: payment.id, status: "canceled" });
      expect(await jobs()).toEqual([payment.id]);
      // Again: nothing new happens.
      expect((await cancelPayment(payment.id)).status).toBe("canceled");
      expect(await jobs()).toHaveLength(1);
      await expect(payWithTestCard(payment.id)).rejects.toMatchObject({ code: "conflict" });
    });

    it("refuses once the payment is being processed or paid, and respects the scope", async () => {
      const payment = await createDonationPayment(input());
      await expect(cancelPayment(payment.id, { checkoutSessionId: "chk_other" })).rejects.toMatchObject({ code: "not_found" });
      await payWithTestCard(payment.id);
      await expect(cancelPayment(payment.id)).rejects.toMatchObject({ code: "conflict" });
      expect((await getPayment(payment.id)).status).toBe("succeeded");
    });
  });

  describe("refundPayment", () => {
    it("does nothing without an explicit operator override and a real reason", async () => {
      const payment = await createDonationPayment(input());
      await payWithTestCard(payment.id);
      const request = { paymentId: payment.id, reason: "Duplicate gift; SGO director confirmed by email (synthetic).", actorUserId: OPERATOR };

      await expect(refundPayment({ ...request } as never)).rejects.toMatchObject({ code: "forbidden" });
      await expect(refundPayment({ ...request, operatorOverride: false } as never)).rejects.toMatchObject({ code: "forbidden" });
      await expect(refundPayment({ ...request, operatorOverride: "true" } as never)).rejects.toMatchObject({ code: "forbidden" });
      await expect(refundPayment({ ...request, operatorOverride: true, reason: "oops" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(refundPayment({ ...request, operatorOverride: true, actorUserId: "" })).rejects.toMatchObject({ code: "validation_failed" });

      expect((await getPayment(payment.id)).status).toBe("succeeded");
      expect((await listAuditLogs({ targetId: payment.id })).items.map((a) => a.action)).not.toContain("payment.refund_requested");
    });

    it("refunds the whole payment, records who and why, and tells the donations domain", async () => {
      const payment = await createDonationPayment(input());
      await payWithTestCard(payment.id);
      setTestNow("2027-02-01T12:00:00.000Z");

      const result = await refundPayment({
        paymentId: payment.id,
        operatorOverride: true,
        reason: "Duplicate gift; SGO director confirmed by email (synthetic).",
        actorUserId: OPERATOR,
        request: { ip: "203.0.113.7", userAgent: "synthetic-agent" },
      });
      expect(result.refund).toEqual({ processorRefundId: expect.stringMatching(/^sbx_re_/), status: "succeeded" });
      expect(result.payment).toMatchObject({ status: "refunded", refundedCents: 170_000 });
      expect(result.payment.refundedAt?.toISOString()).toBe("2027-02-01T12:00:00.000Z");
      // The charge time is untouched.
      expect(result.payment.paidAt?.toISOString()).toBe(NOW.toISOString());
      expect(await jobs()).toEqual([payment.id, payment.id]);

      const trail = (await listAuditLogs({ targetId: payment.id })).items;
      const requested = trail.find((a) => a.action === "payment.refund_requested");
      expect(requested).toMatchObject({ actorType: "user", actorId: OPERATOR, orgId, ip: "203.0.113.7" });
      expect(requested?.metadata).toMatchObject({ operatorOverride: true, reason: "Duplicate gift; SGO director confirmed by email (synthetic).", amountCents: 170_000 });
      expect(trail.find((a) => a.action === "payment.refund_issued")).toMatchObject({ actorType: "user", actorId: OPERATOR });

      await expect(refundPayment({ paymentId: payment.id, operatorOverride: true, reason: "A second refund attempt (synthetic).", actorUserId: OPERATOR })).rejects.toMatchObject({ code: "conflict" });
    });

    it("only refunds a completed payment", async () => {
      const payment = await createDonationPayment(input());
      const request = { operatorOverride: true as const, reason: "Operator-initiated refund (synthetic).", actorUserId: OPERATOR };
      await expect(refundPayment({ ...request, paymentId: payment.id })).rejects.toMatchObject({ code: "conflict" });
      await expect(refundPayment({ ...request, paymentId: "pay_missing" })).rejects.toMatchObject({ code: "not_found" });
      await payWithTestCard(payment.id, "4000000000000002");
      await expect(refundPayment({ ...request, paymentId: payment.id })).rejects.toMatchObject({ code: "conflict" });
    });
  });

  describe("with Stripe as the processor", () => {
    let stripe: FakeStripe;

    beforeEach(() => {
      const fake = createFakeStripeProcessor();
      stripe = fake.stripe;
      setProcessorForTests("stripe", fake.processor);
      vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_synthetic");
    });

    it("creates one direct charge on the SGO's account and stores Stripe's id on our row", async () => {
      const payment = await createDonationPayment(input());
      expect(payment).toMatchObject({ processor: "stripe", processorPaymentId: "pi_synthetic1", status: "requires_payment" });
      expect(payment.client).toEqual({
        provider: "stripe",
        paymentId: payment.id,
        mode: "test",
        status: "requires_payment",
        amountCents: 170_000,
        currency: "usd",
        description: "Contribution to Synthetic Scholarship Fund",
        lines: [{ kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" }],
        failureReason: null,
        clientSecret: "pi_synthetic1_secret_synthetic",
        publishableKey: "pk_test_synthetic",
        connectedAccountId: ACCOUNT,
      });

      const [params, requestOptions] = stripe.paymentIntents.create.mock.calls[0];
      expect(requestOptions).toEqual({ idempotencyKey: `payment_${payment.id}_create_v1`, stripeAccount: ACCOUNT });
      // Ids only: nothing about the donor goes to Stripe, and the caller's own key is not forwarded.
      expect(params.metadata).toEqual({
        payment_id: payment.id,
        checkout_session_id: checkoutSessionId,
        org_id: orgId,
        purpose: "donation",
        mode: "test",
        settlement_mode: "direct",
        designated_cents: "170000",
        service_fee_cents: "0",
      });
      expect(JSON.stringify(stripe.paymentIntents.create.mock.calls)).not.toContain("donor@synthetic.example");
      expect(JSON.stringify(stripe.paymentIntents.create.mock.calls)).not.toContain("attempt-1");
      // The client secret is not kept on our side.
      expect(JSON.stringify(await rows())).not.toContain("_secret_");
    });

    it("never calls create twice for one payment: later calls read the intent Stripe already has", async () => {
      const first = await createDonationPayment(input());
      const again = await createDonationPayment(input());
      const client = await getPaymentForClient(first.id, { checkoutSessionId });
      expect(again.id).toBe(first.id);
      expect(client).toMatchObject({ clientSecret: "pi_synthetic1_secret_synthetic", connectedAccountId: ACCOUNT });
      expect(stripe.paymentIntents.create).toHaveBeenCalledOnce();
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_synthetic1", { expand: ["latest_charge"] }, { stripeAccount: ACCOUNT });
    });

    it("finishes an interrupted creation instead of starting a second payment", async () => {
      stripe.paymentIntents.create.mockRejectedValueOnce(new Error("connection reset"));
      await expect(createDonationPayment(input())).rejects.toThrow("connection reset");
      const [orphan] = await rows();
      expect(orphan).toMatchObject({ status: "requires_payment", processorPaymentId: null });
      // The browser cannot be handed a payment that Stripe does not have yet.
      await expect(getPaymentForClient(orphan.id)).rejects.toMatchObject({ code: "conflict" });

      const resumed = await createDonationPayment(input());
      expect(resumed).toMatchObject({ id: orphan.id, processorPaymentId: "pi_synthetic1", created: false });
      expect(await rows()).toHaveLength(1);
    });

    it("refuses to attach one Stripe payment to two of our payments", async () => {
      await createDonationPayment(input());
      // A second checkout for which Stripe (wrongly) answers with the first intent again.
      const otherCheckout = await createTestCheckout(orgId);
      stripe.paymentIntents.create.mockResolvedValueOnce(stripe.intents.get("pi_synthetic1"));
      await expect(createDonationPayment(input({ checkoutSessionId: otherCheckout }))).rejects.toMatchObject({ code: "internal" });
      expect((await rows()).filter((r) => r.processorPaymentId === "pi_synthetic1")).toHaveLength(1);
    });

    it("needs the SGO's connected account before it creates anything", async () => {
      const unconnected = await createTestSgo({ name: "Unconnected Synthetic Fund" });
      const checkout = await createTestCheckout(unconnected);
      await expect(createDonationPayment(input({ orgId: unconnected, checkoutSessionId: checkout }))).rejects.toMatchObject({ code: "not_available" });
      expect(await rows()).toHaveLength(0);
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it("routes through the platform account only with counsel's sign-off on record", async () => {
      const payment = await createDonationPayment(input({ settlement: { settlementMode: "destination", counselSignoffRef: "Memo 2027-01 (synthetic)" } }));
      const [params, requestOptions] = stripe.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({ on_behalf_of: ACCOUNT, transfer_data: { destination: ACCOUNT }, metadata: { settlement_mode: "destination" } });
      expect(params).not.toHaveProperty("application_fee_amount");
      expect(requestOptions).toEqual({ idempotencyKey: `payment_${payment.id}_create_v1` });
      // The browser must NOT load Stripe.js for the connected account: the intent lives on the platform.
      expect(payment.client).toMatchObject({ provider: "stripe", connectedAccountId: null });
      const [entry] = (await listAuditLogs({ targetId: payment.id })).items;
      expect(entry.metadata).toMatchObject({ settlementMode: "destination", counselSignoffRef: "Memo 2027-01 (synthetic)" });
    });

    it("syncs a paid intent through the state machine with the charge's own time", async () => {
      const payment = await createDonationPayment(input());
      markIntentPaid(stripe, "pi_synthetic1", { method: "us_bank_account" });
      setTestNow("2027-01-05T09:00:00.000Z");

      const synced = await syncPaymentWithProcessor(payment.id, { checkoutSessionId });
      expect(synced).toMatchObject({ status: "succeeded", method: "us_bank_account" });
      expect(synced.paidAt?.toISOString()).toBe(new Date(SYNTHETIC_CHARGE_CREATED * 1000).toISOString());
      expect(await jobs()).toEqual([payment.id]);
      // Syncing again, or the webhook arriving afterwards, changes nothing.
      await syncPaymentWithProcessor(payment.id);
      expect(await jobs()).toHaveLength(1);
      // Once paid, the browser gets no client secret and Stripe is not asked for one.
      stripe.paymentIntents.retrieve.mockClear();
      expect(await getPaymentForClient(payment.id)).toMatchObject({ status: "succeeded", clientSecret: null });
      expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it("cancels at Stripe a payment that was superseded while its creation was in flight", async () => {
      // Regression: the superseded row was canceled locally, then its Stripe intent was attached and left
      // open, and the caller got back a "created" payment that was already canceled.
      const gated = createFakeStripeProcessor();
      stripe = gated.stripe;
      setProcessorForTests("stripe", gated.processor);
      const create = gated.processor.createPayment.bind(gated.processor);
      let entered!: () => void;
      let release!: () => void;
      const inFlight = new Promise<void>((resolve) => (entered = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      vi.spyOn(gated.processor, "createPayment")
        .mockImplementationOnce(async (args) => {
          entered();
          await gate;
          return create(args);
        })
        .mockImplementation(create);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const first = createDonationPayment(input({ idempotencyKey: "attempt-a" }));
      const firstOutcome = first.then(
        () => null,
        (e: unknown) => e,
      );
      await inFlight;
      const second = await createDonationPayment(input({ idempotencyKey: "attempt-b" }));
      release();

      expect(await firstOutcome).toMatchObject({ code: "conflict" });
      const all = await rows();
      const superseded = all.find((r) => r.id !== second.id);
      expect(superseded).toMatchObject({ status: "canceled" });
      expect(superseded?.processorPaymentId).toBeTruthy();
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(superseded?.processorPaymentId, { cancellation_reason: "abandoned" }, { stripeAccount: ACCOUNT });
      expect(stripe.intents.get(superseded?.processorPaymentId as string)?.status).toBe("canceled");
      expect(all.find((r) => r.id === second.id)).toMatchObject({ status: "requires_payment" });
    });

    it("cancels at the processor a payment whose creation finished after it was read", async () => {
      // Regression: a stale snapshot without a processor id made the cancel a local no-op, and the newer
      // request was refused with "This checkout has already been paid." although nothing was paid.
      const created = await createDonationPayment(input());
      const stale = { ...(await rows())[0], processorPaymentId: null };
      expect(await cancelRow(stale, "superseded")).toBe("canceled");
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(created.processorPaymentId, { cancellation_reason: "abandoned" }, { stripeAccount: ACCOUNT });
      expect((await getPayment(created.id)).status).toBe("canceled");
    });

    it("syncs a bank debit that failed after the processing webhook was recorded", async () => {
      // Regression: the charge's creation time is older than the processing event, so a sync that only
      // compared timestamps dropped the failure as "stale" and the payment stayed processing for good.
      const payment = await createDonationPayment(input());
      const chargeCreated = 1_800_000_000;
      await applyProcessorEvent({
        id: "evt_processing_synthetic",
        processor: "stripe",
        occurredAt: new Date((chargeCreated + 5) * 1000),
        livemode: false,
        connectedAccountId: ACCOUNT,
        type: "payment.processing",
        processorPaymentId: "pi_synthetic1",
        attemptId: "ch_ach_synthetic",
      });
      expect((await getPayment(payment.id)).status).toBe("processing");

      Object.assign(stripe.intents.get("pi_synthetic1") as Record<string, unknown>, {
        status: "requires_payment_method",
        latest_charge: { id: "ch_ach_synthetic", object: "charge", created: chargeCreated, payment_method_details: { type: "us_bank_account" } },
        last_payment_error: { type: "invalid_request_error", code: "payment_method_microdeposit_failed", charge: "ch_ach_synthetic", message: "internal detail" },
      });
      const synced = await syncPaymentWithProcessor(payment.id, { checkoutSessionId });
      expect(synced.status).toBe("failed");
      expect(synced.failureReason).not.toContain("internal detail");
    });

    it("does not cancel a payment the donor has just paid; it records the payment instead", async () => {
      const first = await createDonationPayment(input());
      markIntentPaid(stripe, "pi_synthetic1");
      vi.spyOn(console, "error").mockImplementation(() => {});
      // The donor changed the amount in another tab after paying in this one.
      await expect(createDonationPayment(input({ idempotencyKey: "attempt-2" }))).rejects.toMatchObject({ code: "conflict", message: "This checkout has already been paid.", details: { paymentId: first.id } });
      const all = await rows();
      expect(all.find((r) => r.id === first.id)?.status).toBe("succeeded");
      // The replacement was withdrawn before it reached Stripe.
      expect(all.find((r) => r.id !== first.id)).toMatchObject({ status: "canceled", processorPaymentId: null });
      expect(stripe.paymentIntents.create).toHaveBeenCalledOnce();
    });

    it("refunds a direct charge on the SGO's account and waits for Stripe when the refund is pending", async () => {
      const payment = await createDonationPayment(input());
      markIntentPaid(stripe, "pi_synthetic1");
      await syncPaymentWithProcessor(payment.id);
      stripe.refunds.create.mockResolvedValueOnce({ id: "re_pending", status: "pending", created: 1_800_000_500, amount: 170_000 });

      const result = await refundPayment({ paymentId: payment.id, operatorOverride: true, reason: "SGO asked for a refund; counsel approved (synthetic).", actorUserId: OPERATOR });
      expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_synthetic1", metadata: { payment_id: payment.id } }, { idempotencyKey: `payment_${payment.id}_refund_v1`, stripeAccount: ACCOUNT });
      expect(result.refund).toEqual({ processorRefundId: "re_pending", status: "pending" });
      // Not refunded yet: Stripe reports the outcome by event.
      expect(result.payment.status).toBe("succeeded");
      expect((await rows())[0].metadata).toMatchObject({ [META.processorRefundId]: "re_pending", [META.refundStatus]: "pending" });
      await expect(refundPayment({ paymentId: payment.id, operatorOverride: true, reason: "Clicked twice by mistake (synthetic).", actorUserId: OPERATOR })).rejects.toMatchObject({ code: "conflict" });
      expect(stripe.refunds.create).toHaveBeenCalledOnce();
    });

    it("records a refund the processor could not issue, and leaves the payment as it was", async () => {
      const payment = await createDonationPayment(input());
      markIntentPaid(stripe, "pi_synthetic1");
      await syncPaymentWithProcessor(payment.id);
      stripe.refunds.create.mockRejectedValueOnce(new Error("processor unavailable"));
      await expect(refundPayment({ paymentId: payment.id, operatorOverride: true, reason: "SGO asked for a refund (synthetic).", actorUserId: OPERATOR })).rejects.toThrow("processor unavailable");
      expect((await getPayment(payment.id)).status).toBe("succeeded");
      expect((await listAuditLogs({ targetId: payment.id })).items.map((a) => a.action)).toEqual(expect.arrayContaining(["payment.refund_requested", "payment.refund_failed"]));
    });

    describe("live gifts", () => {
      beforeEach(() => {
        const live = createFakeStripeProcessor({ livemode: true });
        stripe = live.stripe;
        setProcessorForTests("stripe", live.processor);
      });

      it("stay off until a platform admin turns them on, and until the credit start date", async () => {
        const liveCheckout = await createTestCheckout(orgId, { mode: "live" });
        const live = input({ checkoutSessionId: liveCheckout, mode: "live" });

        await expect(createDonationPayment(live)).rejects.toMatchObject({ code: "forbidden", message: "Live gifts are not being accepted yet." });
        await setSetting("gifts.liveEnabled", true, { actorUserId: null });
        // December 10, 2026: before the credit exists.
        await expect(createDonationPayment(live)).rejects.toMatchObject({ code: "forbidden", message: "Live gifts cannot be collected before 2027-01-01." });
        // Still December 31 everywhere on Earth.
        setTestNow("2026-12-31T09:59:00.000Z");
        await expect(createDonationPayment(live)).rejects.toMatchObject({ code: "forbidden" });
        expect(await rows()).toHaveLength(0);
        expect(stripe.paymentIntents.create).not.toHaveBeenCalled();

        // January 1 has begun somewhere: this backstop steps aside and the donations domain's own gate decides.
        setTestNow("2026-12-31T10:00:00.000Z");
        expect(await createDonationPayment(live)).toMatchObject({ mode: "live", processor: "stripe", status: "requires_payment" });
        // A test key cannot take them, and a live key cannot take test payments.
        await expect(createDonationPayment(input({ idempotencyKey: "test-on-live-key" }))).rejects.toMatchObject({ code: "not_available" });
      });
    });
  });

  it("applies processor events to the right row only", async () => {
    const payment = await createDonationPayment(input());
    const untouched = await createDonationPayment(input({ checkoutSessionId: await createTestCheckout(orgId) }));
    await payWithTestCard(payment.id);
    expect((await getPayment(untouched.id)).status).toBe("requires_payment");
    const [row] = await t.db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(row.status).toBe("succeeded");
  });
});
