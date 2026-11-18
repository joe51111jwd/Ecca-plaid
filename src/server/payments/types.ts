import type { InvoiceStatus, Mode, PaymentStatus } from "@/db/schema";

/**
 * The contract between the payments service and a payment processor.
 *
 * Two implementations exist: `SandboxProcessor` (no money moves; the default) and `StripeProcessor`.
 * Everything above this interface — the `payments` and `business_invoices` rows, the state machine, the
 * jobs — is processor-agnostic and lives in the service (./index).
 */

export type ProcessorName = "sandbox" | "stripe";

/* Settlement ------------------------------------------------------------------------------------------- */

/**
 * How a designated gift reaches the SGO.
 *
 *  - "direct" (the default): the charge is created on the SGO's own connected account. The gift never
 *    passes through the platform's balance. Treasury's preamble speaks of contributing "directly to one or
 *    more SGOs, rather than through one or more entities" (docs/reference/payments-and-rails.md, fact 2A).
 *    Consequence to agree with each SGO beforehand: refunds, chargebacks and ACH returns are debited from
 *    the SGO's processor balance, and from its bank account if that balance goes negative (fact 5A).
 *  - "destination": the charge is created on the platform's account with the SGO as settlement merchant and
 *    the funds are transferred to the SGO. REQUIRES COUNSEL SIGN-OFF before any use: the gift passes
 *    through the platform's balance (fact 2A, Open Question 2). It can only be selected together with a
 *    reference to that sign-off.
 *
 * Neither mode has a parameter for an application fee: no fee is ever taken out of a designated gift.
 */
export type SettlementMode = "direct" | "destination";

export interface DirectSettlement {
  settlementMode?: "direct";
  /** The SGO's connected account (Stripe: acct_...). Required by Stripe, ignored by the sandbox. */
  connectedAccountId?: string;
}

export interface DestinationSettlement {
  /** Requires counsel sign-off. See SettlementMode. */
  settlementMode: "destination";
  connectedAccountId: string;
  /** Where counsel's written sign-off for routing gifts through the platform account is filed. */
  counselSignoffRef: string;
}

export type Settlement = DirectSettlement | DestinationSettlement;

/* Payments --------------------------------------------------------------------------------------------- */

export interface CreatePaymentInput {
  purpose: "donation";
  /** `test` payments must never reach a live processor account, and the reverse. */
  mode: Mode;
  /** Total charged to the donor in cents. Always `designatedAmountCents + serviceFeeOnTopCents`. */
  amountCents: number;
  /** The designated contribution. The SGO receives exactly this amount under every settlement mode. */
  designatedAmountCents: number;
  /**
   * A donor-paid service fee charged ON TOP of the gift (0 for none). It is the only fee this interface can
   * express: a fee taken out of the designated amount has no parameter.
   */
  serviceFeeOnTopCents: number;
  /** Shown on the processor's records and the sandbox pay page. No donor names or other personal data. */
  description: string;
  /**
   * Where our own receipt goes. Processors must NOT send their own receipt to it: a processor receipt is
   * easy to mistake for the SGO's written acknowledgment (reference Open Question 12).
   */
  receiptEmail?: string;
  /** Stable per payment. Must not contain personal data (it is sent to the processor). */
  idempotencyKey: string;
  /** Must include `payment_id` (our payments.id). Ids and codes only, never donor personal data. */
  metadata: Record<string, string>;
  settlement?: Settlement;
}

export interface ProcessorPayment {
  processorPaymentId: string;
  /** What the browser needs to complete the payment. Never stored. */
  clientSecret?: string;
  status: PaymentStatus;
}

export interface PaymentLookup {
  /** Stripe direct charges live on the connected account and can only be read through it. */
  connectedAccountId?: string | null;
}

export interface ProcessorPaymentDetails extends ProcessorPayment {
  amountCents: number;
  /** When the processor created the charge (card: the charge; ACH: the debit initiation). */
  chargedAt?: Date;
  /** card | us_bank_account | ... */
  method?: string;
  failureReason?: string;
  canceledAt?: Date;
  livemode: boolean;
}

export interface RefundPaymentInput {
  processorPaymentId: string;
  connectedAccountId?: string | null;
  settlementMode: SettlementMode;
  /** Stable per refund. */
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface ProcessorRefund {
  processorRefundId: string;
  /** "pending" refunds complete (or fail) later; the processor reports the outcome by event. */
  status: "succeeded" | "pending" | "failed";
  refundedAt?: Date;
  amountCents: number;
}

/* Invoices --------------------------------------------------------------------------------------------- */

export interface InvoiceCustomer {
  /** The business organization being billed. */
  orgId: string;
  name: string;
  email: string;
  /** The processor's customer id from an earlier invoice, if any. */
  processorCustomerId?: string | null;
}

export interface CreateInvoiceInput {
  mode: Mode;
  customer: InvoiceCustomer;
  lines: Array<{ description: string; amountCents: number }>;
  dueInDays: number;
  description?: string;
  /** Must include `invoice_id` (our business_invoices.id) and `invoice_number`. */
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface ProcessorInvoice {
  processorInvoiceId: string;
  /** The page where the business views and pays the invoice. */
  hostedUrl: string;
  status: InvoiceStatus;
  /** To store on the business profile and pass back next time. */
  processorCustomerId: string;
}

/* Normalized events ------------------------------------------------------------------------------------ */

interface ProcessorEventBase {
  /** The processor's own event id, for audit and logs. */
  id: string;
  processor: ProcessorName;
  /** When the processor says it happened. */
  occurredAt: Date;
  livemode: boolean;
  /** Set when the event came from a connected account (Stripe direct charges). */
  connectedAccountId?: string;
}

export interface PaymentProcessingEvent extends ProcessorEventBase {
  type: "payment.processing";
  processorPaymentId: string;
  /** The processor's id for this charge attempt. A payment can have several (a declined card, then another). */
  attemptId?: string;
  chargedAt?: Date;
  method?: string;
}

export interface PaymentSucceededEvent extends ProcessorEventBase {
  type: "payment.succeeded";
  processorPaymentId: string;
  /** The processor's charge time. Decides the gift's tax year (see PAID_AT_BASIS in ./policy). */
  chargedAt: Date;
  /** What the processor actually collected; checked against the amount we asked for. */
  amountCents?: number;
  attemptId?: string;
  method?: string;
}

export interface PaymentFailedEvent extends ProcessorEventBase {
  type: "payment.failed";
  processorPaymentId: string;
  /** Safe to show to the payer. */
  failureReason: string;
  failureCode?: string;
  attemptId?: string;
  method?: string;
}

export interface PaymentCanceledEvent extends ProcessorEventBase {
  type: "payment.canceled";
  processorPaymentId: string;
  reason?: string;
}

export interface PaymentRefundedEvent extends ProcessorEventBase {
  type: "payment.refunded";
  processorPaymentId: string;
  /** Total refunded so far, in cents. */
  refundedAmountCents: number;
  /** False for a partial refund (which leaves the payment `succeeded`). */
  fullyRefunded: boolean;
}

export interface InvoicePaidEvent extends ProcessorEventBase {
  type: "invoice.paid";
  processorInvoiceId: string;
  paidAt: Date;
}

export interface InvoiceVoidedEvent extends ProcessorEventBase {
  type: "invoice.voided";
  processorInvoiceId: string;
}

export interface InvoicePaymentFailedEvent extends ProcessorEventBase {
  type: "invoice.payment_failed";
  processorInvoiceId: string;
  failureReason?: string;
}

export type PaymentEvent = PaymentProcessingEvent | PaymentSucceededEvent | PaymentFailedEvent | PaymentCanceledEvent | PaymentRefundedEvent;
export type InvoiceEvent = InvoicePaidEvent | InvoiceVoidedEvent | InvoicePaymentFailedEvent;
export type ProcessorEvent = PaymentEvent | InvoiceEvent;
export type ProcessorEventType = ProcessorEvent["type"];

export const PROCESSOR_EVENT_TYPES = [
  "payment.succeeded",
  "payment.failed",
  "payment.processing",
  "payment.canceled",
  "payment.refunded",
  "invoice.paid",
  "invoice.voided",
  "invoice.payment_failed",
] as const satisfies readonly ProcessorEventType[];

/* The processor ---------------------------------------------------------------------------------------- */

export interface PaymentProcessor {
  readonly name: ProcessorName;

  /** Whether this processor, as configured, may take a payment or invoice of the given mode. Throws when not. */
  assertModeSupported(mode: Mode): void;

  /** Creates the processor-side payment for a donation. Safe to repeat with the same idempotency key. */
  createPayment(input: CreatePaymentInput): Promise<ProcessorPayment>;
  retrievePayment(processorPaymentId: string, lookup?: PaymentLookup): Promise<ProcessorPaymentDetails>;
  /** Cancels a payment that has not been paid. */
  cancelPayment(processorPaymentId: string, lookup?: PaymentLookup): Promise<ProcessorPaymentDetails>;
  /**
   * Returns the whole payment to the payer. For operations staff only, through the service's
   * `refundPayment`, which demands an explicit override and a reason and audits both.
   */
  refundPayment(input: RefundPaymentInput): Promise<ProcessorRefund>;

  /** Creates and finalizes an invoice to a business and returns its hosted page. */
  createInvoice(input: CreateInvoiceInput): Promise<ProcessorInvoice>;
  voidInvoice(processorInvoiceId: string): Promise<{ status: InvoiceStatus }>;
  /**
   * Closes an open invoice that was paid outside the processor (a check, a wire), so its hosted page stops
   * accepting payment. No charge is made.
   */
  markInvoicePaidOutOfBand(processorInvoiceId: string): Promise<{ status: InvoiceStatus }>;

  /**
   * Verifies a webhook request against the raw body and returns the events it carries, normalized.
   * Throws AppError("bad_request") when the signature does not verify. Event types we do not act on yield
   * an empty list.
   */
  parseWebhook(rawBody: string, signatureHeader: string | null): Promise<ProcessorEvent[]>;
}
