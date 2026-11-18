import Stripe from "stripe";
import type { InvoiceStatus, Mode, PaymentStatus } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import { AppError, badRequest, invalid } from "@/lib/errors";
import { CURRENCY, MAX_CHARGE_CENTS, MAX_INVOICE_LINES, MIN_CHARGE_CENTS, STRIPE_GIFT_PAYMENT_METHOD_TYPES, STRIPE_INVOICE_PAYMENT_METHOD_TYPES, STRIPE_WEBHOOK_TOLERANCE_SECONDS } from "./policy";
import type {
  CreateInvoiceInput,
  CreatePaymentInput,
  PaymentLookup,
  PaymentProcessor,
  ProcessorEvent,
  ProcessorInvoice,
  ProcessorPayment,
  ProcessorPaymentDetails,
  ProcessorRefund,
  RefundPaymentInput,
  SettlementMode,
} from "./types";

/**
 * Stripe, behind the PaymentProcessor interface. Written against stripe-node 23.1 / API 2026-10-28.endive
 * as verified in docs/reference/payments-and-rails.md (Part A); parameter names follow that file.
 *
 * How a designated gift is charged
 *  - DEFAULT, "direct": a direct charge on the SGO's own connected account (`Stripe-Account` header). The
 *    gift never touches the platform's balance. No `application_fee_amount` is ever sent, so the charge
 *    lands with the SGO in full. Known consequence, to be agreed with each SGO before onboarding: refunds,
 *    chargebacks and ACH returns are debited from the SGO's Stripe balance, and from its bank account if
 *    that balance goes negative (reference fact 5A).
 *  - "destination" — REQUIRES COUNSEL SIGN-OFF: a charge on the platform account with `on_behalf_of` and
 *    `transfer_data.destination` set to the SGO. The whole designated amount is transferred; refunds and
 *    disputes are debited from the platform. Selectable only with a recorded sign-off reference.
 *
 * What is deliberately absent
 *  - `application_fee_amount`: a fee is never taken out of a designated gift.
 *  - `receipt_email`: we send our own receipt; a Stripe receipt could be mistaken for the SGO's
 *    acknowledgment (reference Open Question 12).
 *  - `payment_method_types`: removed from this API version. Automatic payment methods are on by default and
 *    are narrowed with `allowed_payment_method_types` (reference facts 20 and 23).
 *  - Donor personal data in metadata, descriptions or idempotency keys.
 *
 * Idempotency keys only protect for about a day (Stripe may prune them after 24 hours, reference fact 24A).
 * Lasting uniqueness is the service's job: it stores each Stripe object id on our own row and never calls
 * `create` again for a row that already has one.
 *
 * NOT EXERCISED AGAINST A LIVE STRIPE ACCOUNT in this codebase's tests: request shapes are checked against
 * the SDK's types and the reference notes with an injected client, and webhook verification with Stripe's
 * own test-signature helper.
 */

/** The API version stripe@23.1 pins. Bump it together with the package. */
export const STRIPE_API_VERSION = "2026-10-28.endive";

/** The parts of the Stripe client this adapter calls. Tests inject a fake with the same shape. */
export interface StripeClient {
  paymentIntents: Pick<Stripe["paymentIntents"], "create" | "retrieve" | "cancel">;
  refunds: Pick<Stripe["refunds"], "create">;
  customers: Pick<Stripe["customers"], "create" | "update">;
  invoices: Pick<Stripe["invoices"], "create" | "finalizeInvoice" | "voidInvoice" | "pay">;
  invoiceItems: Pick<Stripe["invoiceItems"], "create">;
  webhooks: Pick<Stripe["webhooks"], "constructEvent">;
}

export interface StripeProcessorOptions {
  client: StripeClient;
  /** Signing secrets of the webhook destinations ("Your account" and "Connected accounts" each have their own). */
  webhookSecrets: readonly string[];
  /** Whether the secret key is a test or a live key, when that can be told. */
  keyMode: Mode | null;
}

/** Stripe secret and restricted keys carry their mode in the name (sk_test_…, sk_live_…, rk_test_…, rk_live_…). */
export function stripeKeyMode(secretKey: string): Mode | null {
  if (/^(sk|rk)_live_/.test(secretKey)) return "live";
  if (/^(sk|rk)_test_/.test(secretKey)) return "test";
  return null;
}

/** `STRIPE_WEBHOOK_SECRET` may hold several secrets separated by commas or spaces (one per webhook destination). */
export function parseWebhookSecrets(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Builds the processor from the environment. Throws not_available when Stripe is selected but not configured. */
export function createStripeProcessorFromEnv(): StripeProcessor {
  const e = env();
  if (!e.STRIPE_SECRET_KEY) throw new AppError("not_available", "Stripe is not configured: STRIPE_SECRET_KEY is not set");
  const client = new Stripe(e.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    appInfo: { name: BRAND.name },
  });
  return new StripeProcessor({ client, webhookSecrets: parseWebhookSecrets(e.STRIPE_WEBHOOK_SECRET), keyMode: stripeKeyMode(e.STRIPE_SECRET_KEY) });
}

const CONNECTED_ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;

const PROCESSOR_UNREACHABLE = "The payment processor could not be reached. Please try again in a moment.";

/** Stripe errors can carry internal ids and parameter names: they are logged, and the caller gets a plain message. */
function translateStripeError(e: unknown, action: string): unknown {
  if (!(e instanceof Stripe.errors.StripeError)) return e;
  console.error(`[payments] Stripe ${action} failed: ${e.type}${e.code ? ` (${e.code})` : ""}: ${e.message}${e.requestId ? ` [request ${e.requestId}]` : ""}`);
  if (e instanceof Stripe.errors.StripeCardError) return new AppError("payment_failed", e.message, { code: e.code ?? null });
  if (e instanceof Stripe.errors.StripeConnectionError || e instanceof Stripe.errors.StripeAPIError || e instanceof Stripe.errors.StripeRateLimitError) {
    return new AppError("not_available", PROCESSOR_UNREACHABLE);
  }
  if (e instanceof Stripe.errors.StripeIdempotencyError) return new AppError("conflict", "This request was already made with different details.");
  return new AppError("payment_failed", "The payment processor did not accept the request.", { code: e.code ?? null });
}

const toDate = (unixSeconds: number): Date => new Date(unixSeconds * 1000);

const idOf = (value: string | { id: string } | null | undefined): string | undefined => (typeof value === "string" ? value : (value?.id ?? undefined));

/** Our payment status for a PaymentIntent. A declined attempt returns the intent to `requires_payment_method` with an error attached. */
export function paymentStatusOf(intent: Pick<Stripe.PaymentIntent, "status" | "last_payment_error">): PaymentStatus {
  switch (intent.status) {
    case "succeeded":
      return "succeeded";
    case "processing":
    case "requires_capture":
      return "processing";
    case "canceled":
      return "canceled";
    case "requires_payment_method":
      return intent.last_payment_error ? "failed" : "requires_payment";
    default:
      return "requires_payment";
  }
}

const INVOICE_STATUSES: readonly InvoiceStatus[] = ["draft", "open", "paid", "void", "uncollectible"];

function invoiceStatusOf(status: Stripe.Invoice["status"]): InvoiceStatus {
  const known = INVOICE_STATUSES.find((s) => s === status);
  if (!known) throw new AppError("internal", `Stripe returned an invoice in an unexpected state (${String(status)})`);
  return known;
}

/**
 * The message a payer may see. Stripe documents card-error messages as showable to users; anything else can
 * be technical, so it is replaced.
 */
function failureMessage(error: Stripe.PaymentIntent.LastPaymentError | null): string {
  if (error?.type === "card_error" && error.message) return error.message;
  return "The payment could not be completed. Please try again or use a different payment method.";
}

interface ResolvedSettlement {
  settlementMode: SettlementMode;
  connectedAccountId: string;
}

function resolveSettlement(input: CreatePaymentInput): ResolvedSettlement {
  const settlement = input.settlement ?? {};
  const connectedAccountId = settlement.connectedAccountId?.trim() ?? "";
  if (!CONNECTED_ACCOUNT_ID.test(connectedAccountId)) {
    // Without a connected account the charge would land on the platform's own account: never for a designated gift.
    throw new AppError("not_available", "This organization cannot receive gifts yet: its payments account has not been connected.");
  }
  if (settlement.settlementMode === "destination") {
    if (!settlement.counselSignoffRef?.trim()) {
      throw new AppError("forbidden", "Destination charges route a gift through the platform's account and require counsel sign-off: record its reference first.");
    }
    return { settlementMode: "destination", connectedAccountId };
  }
  return { settlementMode: "direct", connectedAccountId };
}

export class StripeProcessor implements PaymentProcessor {
  readonly name = "stripe" as const;
  private readonly client: StripeClient;
  private readonly webhookSecrets: readonly string[];
  private readonly keyMode: Mode | null;

  constructor(options: StripeProcessorOptions) {
    this.client = options.client;
    this.webhookSecrets = options.webhookSecrets;
    this.keyMode = options.keyMode;
  }

  assertModeSupported(mode: Mode): void {
    if (this.keyMode === null || this.keyMode === mode) return;
    throw new AppError(
      "not_available",
      mode === "live"
        ? "Live payments are not available: this deployment is configured with a Stripe test key."
        : "Test payments are not available: this deployment is configured with a live Stripe key.",
    );
  }

  private requestOptions(lookup: PaymentLookup | undefined, extra: Stripe.RequestOptions = {}): Stripe.RequestOptions {
    return lookup?.connectedAccountId ? { ...extra, stripeAccount: lookup.connectedAccountId } : extra;
  }

  async createPayment(input: CreatePaymentInput): Promise<ProcessorPayment> {
    this.assertModeSupported(input.mode);
    const { amountCents, designatedAmountCents, serviceFeeOnTopCents } = input;
    if (![amountCents, designatedAmountCents, serviceFeeOnTopCents].every(Number.isSafeInteger) || designatedAmountCents <= 0 || serviceFeeOnTopCents < 0) {
      throw invalid("Payment amounts must be whole cents");
    }
    if (designatedAmountCents + serviceFeeOnTopCents !== amountCents) {
      throw new AppError("internal", "The designated amount and the service fee must add up to the amount charged");
    }
    if (amountCents < MIN_CHARGE_CENTS || amountCents > MAX_CHARGE_CENTS) throw invalid("The amount is outside what can be charged");
    if (!input.metadata.payment_id) throw new AppError("internal", "metadata.payment_id is required");

    const settlement = resolveSettlement(input);
    const params: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency: CURRENCY,
      allowed_payment_method_types: [...STRIPE_GIFT_PAYMENT_METHOD_TYPES],
      // The Payment Element supports only automatic or instant verification for ACH (reference fact 43).
      payment_method_options: { us_bank_account: { verification_method: "automatic" } },
      description: input.description,
      metadata: {
        ...input.metadata,
        purpose: input.purpose,
        mode: input.mode,
        settlement_mode: settlement.settlementMode,
        designated_cents: String(designatedAmountCents),
        service_fee_cents: String(serviceFeeOnTopCents),
      },
    };

    if (settlement.settlementMode === "direct" && serviceFeeOnTopCents > 0) {
      // Everything in a direct charge lands in the SGO's account, which may hold designated gifts only.
      throw new AppError(
        "not_available",
        "A donor service fee cannot be added to a gift that is charged directly on the organization's account. It must be its own charge on the platform account.",
      );
    }

    let intent: Stripe.PaymentIntent;
    try {
      if (settlement.settlementMode === "direct") {
        intent = await this.client.paymentIntents.create(params, { idempotencyKey: input.idempotencyKey, stripeAccount: settlement.connectedAccountId });
      } else {
        intent = await this.client.paymentIntents.create(
          {
            ...params,
            on_behalf_of: settlement.connectedAccountId,
            // With no amount the whole charge is transferred. With a service fee on top, exactly the designated
            // amount is transferred and only the fee stays on the platform.
            transfer_data: serviceFeeOnTopCents > 0 ? { destination: settlement.connectedAccountId, amount: designatedAmountCents } : { destination: settlement.connectedAccountId },
          },
          { idempotencyKey: input.idempotencyKey },
        );
      }
    } catch (e) {
      throw translateStripeError(e, "paymentIntents.create");
    }

    if (intent.livemode !== (input.mode === "live")) {
      // The key's mode could not be told in advance and turned out wrong. Nobody has the client secret yet.
      const lookup = settlement.settlementMode === "direct" ? { connectedAccountId: settlement.connectedAccountId } : undefined;
      await this.client.paymentIntents.cancel(intent.id, { cancellation_reason: "abandoned" }, this.requestOptions(lookup)).catch(() => undefined);
      throw new AppError("not_available", `The Stripe key in use is a ${intent.livemode ? "live" : "test"} key and cannot take ${input.mode} payments.`);
    }
    return { processorPaymentId: intent.id, clientSecret: intent.client_secret ?? undefined, status: paymentStatusOf(intent) };
  }

  private toDetails(intent: Stripe.PaymentIntent): ProcessorPaymentDetails {
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const status = paymentStatusOf(intent);
    return {
      processorPaymentId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      status,
      amountCents: status === "succeeded" ? intent.amount_received : intent.amount,
      chargedAt: charge ? toDate(charge.created) : undefined,
      method: charge?.payment_method_details?.type,
      failureReason: status === "failed" ? failureMessage(intent.last_payment_error) : undefined,
      canceledAt: intent.canceled_at ? toDate(intent.canceled_at) : undefined,
      livemode: intent.livemode,
    };
  }

  async retrievePayment(processorPaymentId: string, lookup?: PaymentLookup): Promise<ProcessorPaymentDetails> {
    try {
      // The charge carries the charge time and the payment method actually used; it is not in webhook payloads.
      const intent = await this.client.paymentIntents.retrieve(processorPaymentId, { expand: ["latest_charge"] }, this.requestOptions(lookup));
      return this.toDetails(intent);
    } catch (e) {
      throw translateStripeError(e, "paymentIntents.retrieve");
    }
  }

  async cancelPayment(processorPaymentId: string, lookup?: PaymentLookup): Promise<ProcessorPaymentDetails> {
    try {
      const intent = await this.client.paymentIntents.cancel(processorPaymentId, { cancellation_reason: "abandoned" }, this.requestOptions(lookup));
      return this.toDetails(intent);
    } catch (e) {
      throw translateStripeError(e, "paymentIntents.cancel");
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<ProcessorRefund> {
    try {
      const refund =
        input.settlementMode === "direct"
          ? // A direct charge is refunded on the connected account, out of the SGO's balance.
            await this.client.refunds.create(
              { payment_intent: input.processorPaymentId, metadata: input.metadata },
              this.requestOptions({ connectedAccountId: input.connectedAccountId }, { idempotencyKey: input.idempotencyKey }),
            )
          : // A destination charge is refunded by the platform; the transfer is reversed so the SGO returns the funds.
            await this.client.refunds.create({ payment_intent: input.processorPaymentId, reverse_transfer: true, metadata: input.metadata }, { idempotencyKey: input.idempotencyKey });
      const status = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
      return { processorRefundId: refund.id, status, refundedAt: status === "succeeded" ? toDate(refund.created) : undefined, amountCents: refund.amount };
    } catch (e) {
      throw translateStripeError(e, "refunds.create");
    }
  }

  /** Reuses the business's Stripe customer when we have one that still exists; creates it otherwise. */
  private async upsertCustomer(input: CreateInvoiceInput): Promise<string> {
    const { customer } = input;
    const known = customer.processorCustomerId && CUSTOMER_ID.test(customer.processorCustomerId) ? customer.processorCustomerId : null;
    if (known) {
      try {
        await this.client.customers.update(known, { name: customer.name, email: customer.email });
        return known;
      } catch (e) {
        // A customer deleted in the Stripe Dashboard, or one from the other mode's key: start a new one.
        if (!(e instanceof Stripe.errors.StripeInvalidRequestError && e.code === "resource_missing")) throw e;
      }
    }
    const created = await this.client.customers.create(
      { name: customer.name, email: customer.email, metadata: { org_id: customer.orgId } },
      // A replaced customer needs a fresh key: the original one would replay the deleted customer.
      { idempotencyKey: known ? `${input.idempotencyKey}_customer` : `business_${customer.orgId}_customer_v1` },
    );
    return created.id;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProcessorInvoice> {
    this.assertModeSupported(input.mode);
    if (input.lines.length === 0 || input.lines.length > MAX_INVOICE_LINES) throw invalid(`An invoice needs between 1 and ${MAX_INVOICE_LINES} lines`);
    if (!input.lines.every((l) => Number.isSafeInteger(l.amountCents) && l.amountCents > 0)) throw invalid("Invoice line amounts must be whole cents above zero");
    if (!input.metadata.invoice_id) throw new AppError("internal", "metadata.invoice_id is required");
    const total = input.lines.reduce((sum, l) => sum + l.amountCents, 0);

    try {
      const customerId = await this.upsertCustomer(input);
      const draft = await this.client.invoices.create(
        {
          customer: customerId,
          collection_method: "send_invoice",
          // Payment terms; Stripe needs them to mark an invoice past due (reference fact 46).
          days_until_due: input.dueInDays,
          // Finalized explicitly below, and only with the items added here.
          auto_advance: false,
          pending_invoice_items_behavior: "exclude",
          payment_settings: { payment_method_types: [...STRIPE_INVOICE_PAYMENT_METHOD_TYPES] },
          description: input.description,
          metadata: { ...input.metadata, mode: input.mode },
        },
        { idempotencyKey: `${input.idempotencyKey}_invoice` },
      );
      for (const [index, line] of input.lines.entries()) {
        await this.client.invoiceItems.create(
          { customer: customerId, invoice: draft.id, amount: line.amountCents, currency: CURRENCY, description: line.description, metadata: { invoice_id: input.metadata.invoice_id } },
          { idempotencyKey: `${input.idempotencyKey}_item_${index}` },
        );
      }
      const finalized = await this.client.invoices.finalizeInvoice(draft.id, undefined, { idempotencyKey: `${input.idempotencyKey}_finalize` });
      if (finalized.livemode !== (input.mode === "live")) {
        await this.client.invoices.voidInvoice(finalized.id).catch(() => undefined);
        throw new AppError("not_available", `The Stripe key in use is a ${finalized.livemode ? "live" : "test"} key and cannot issue ${input.mode} invoices.`);
      }
      if (finalized.total !== total) {
        // Something on the Stripe account (automatic tax, a customer balance) changed what the business owes.
        await this.client.invoices.voidInvoice(finalized.id).catch(() => undefined);
        throw new AppError("internal", `Stripe finalized the invoice for ${finalized.total} cents; ${total} cents were expected. The Stripe invoice was voided.`);
      }
      if (!finalized.hosted_invoice_url) throw new AppError("internal", "Stripe finalized the invoice without a hosted invoice page");
      return { processorInvoiceId: finalized.id, hostedUrl: finalized.hosted_invoice_url, status: invoiceStatusOf(finalized.status), processorCustomerId: customerId };
    } catch (e) {
      throw translateStripeError(e, "invoice creation");
    }
  }

  async voidInvoice(processorInvoiceId: string): Promise<{ status: InvoiceStatus }> {
    try {
      const invoice = await this.client.invoices.voidInvoice(processorInvoiceId);
      return { status: invoiceStatusOf(invoice.status) };
    } catch (e) {
      throw translateStripeError(e, "invoices.voidInvoice");
    }
  }

  async markInvoicePaidOutOfBand(processorInvoiceId: string): Promise<{ status: InvoiceStatus }> {
    try {
      const invoice = await this.client.invoices.pay(processorInvoiceId, { paid_out_of_band: true });
      return { status: invoiceStatusOf(invoice.status) };
    } catch (e) {
      throw translateStripeError(e, "invoices.pay");
    }
  }

  /**
   * Verifies the `Stripe-Signature` header against the raw request body (any re-serialization breaks it) with
   * each configured destination secret, then normalizes the event. Signatures older than the tolerance are
   * rejected by the SDK against the real clock.
   */
  async parseWebhook(rawBody: string, signatureHeader: string | null): Promise<ProcessorEvent[]> {
    if (this.webhookSecrets.length === 0) throw new AppError("not_available", "STRIPE_WEBHOOK_SECRET is not set");
    if (!signatureHeader) throw badRequest("Missing Stripe-Signature header");
    let event: Stripe.Event | null = null;
    for (const secret of this.webhookSecrets) {
      try {
        event = this.client.webhooks.constructEvent(rawBody, signatureHeader, secret, STRIPE_WEBHOOK_TOLERANCE_SECONDS);
        break;
      } catch {
        // Not signed with this destination's secret (or too old): try the next one.
      }
    }
    if (!event) throw badRequest("The Stripe signature could not be verified");
    return this.normalize(event);
  }

  /** Maps a verified Stripe event to our normalized events. Types we do not act on map to nothing. */
  async normalize(event: Stripe.Event): Promise<ProcessorEvent[]> {
    const base = {
      id: event.id,
      processor: "stripe" as const,
      occurredAt: toDate(event.created),
      livemode: event.livemode,
      ...(event.account ? { connectedAccountId: event.account } : {}),
    };

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        // The webhook payload names the charge but does not contain it, and the charge time decides the
        // gift's tax year: read it from Stripe. A failure here fails the webhook, and Stripe redelivers.
        const details = typeof intent.latest_charge === "object" && intent.latest_charge ? this.toDetails(intent) : await this.retrievePayment(intent.id, { connectedAccountId: event.account });
        return [
          {
            ...base,
            type: "payment.succeeded",
            processorPaymentId: intent.id,
            chargedAt: details.chargedAt ?? base.occurredAt,
            amountCents: intent.amount_received,
            attemptId: idOf(intent.latest_charge),
            method: details.method,
          },
        ];
      }
      case "payment_intent.processing": {
        const intent = event.data.object;
        return [{ ...base, type: "payment.processing", processorPaymentId: intent.id, attemptId: idOf(intent.latest_charge) }];
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const error = intent.last_payment_error;
        return [
          {
            ...base,
            type: "payment.failed",
            processorPaymentId: intent.id,
            failureReason: failureMessage(error),
            failureCode: error?.decline_code ?? error?.code,
            attemptId: error?.charge ?? idOf(intent.latest_charge),
          },
        ];
      }
      case "payment_intent.canceled": {
        const intent = event.data.object;
        return [{ ...base, type: "payment.canceled", processorPaymentId: intent.id, reason: intent.cancellation_reason ?? undefined }];
      }
      case "charge.refunded": {
        const charge = event.data.object;
        const processorPaymentId = idOf(charge.payment_intent);
        if (!processorPaymentId) return [];
        return [{ ...base, type: "payment.refunded", processorPaymentId, refundedAmountCents: charge.amount_refunded, fullyRefunded: charge.refunded }];
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const paidAt = invoice.status_transitions?.paid_at;
        return [{ ...base, type: "invoice.paid", processorInvoiceId: invoice.id, paidAt: paidAt ? toDate(paidAt) : base.occurredAt }];
      }
      case "invoice.voided":
        return [{ ...base, type: "invoice.voided", processorInvoiceId: event.data.object.id }];
      case "invoice.payment_failed":
        return [{ ...base, type: "invoice.payment_failed", processorInvoiceId: event.data.object.id }];
      default:
        return [];
    }
  }
}
