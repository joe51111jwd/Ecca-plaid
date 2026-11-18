/**
 * Payments: the money plumbing behind donor checkout and business invoicing. This file is the domain's
 * public API; nothing outside src/server/payments imports its other files (except the React components in
 * src/features/payments, which import types only).
 *
 * Processors
 *   PAYMENTS_PROVIDER=sandbox (default)  no money moves; pay with a test number at /sandbox/pay/{paymentId}
 *   PAYMENTS_PROVIDER=stripe             Stripe PaymentIntents + Invoicing; events arrive at /api/webhooks/stripe
 *
 * Donor checkout
 *   const payment = await createDonationPayment({ checkoutSessionId, orgId, amountCents, lines, receiptEmail, idempotencyKey, mode });
 *   <PaymentForm payment={payment.client} returnUrl="/give/thanks" />          // src/features/payments
 *   ...the processor reports the outcome → applyProcessorEvent → job "donation.payment_updated" { paymentId }
 *   const paid = await getPayment(paymentId);   // status, paidAt (the charge time: decides the tax year), method
 *
 * Business invoicing
 *   const invoice = await createBusinessInvoice({ businessOrgId, mode, lines });   // draft, numbered INV-2026-000123
 *   await sendInvoice(invoice.id);                                                 // open, hosted page, email
 *   ...paid on the hosted page → job "invoice.payment_updated" { invoiceId }       (or markInvoicePaid / voidInvoice)
 *
 * Money rules this module enforces
 *   - The designated amount and any fee are separate lines; a fee can only be added on top, never deducted.
 *   - The whole designated amount lands with the SGO. No application fee is ever sent to a processor.
 *   - Sandbox payments are `test` only and can never be confused with real ones.
 *   - A refund needs an operator's explicit override and written reason, and is audited.
 */

export { getProcessor } from "./processor";
export type {
  CreateInvoiceInput,
  CreatePaymentInput,
  DestinationSettlement,
  DirectSettlement,
  InvoiceEvent,
  PaymentEvent,
  PaymentLookup,
  PaymentProcessor,
  ProcessorEvent,
  ProcessorEventType,
  ProcessorInvoice,
  ProcessorName,
  ProcessorPayment,
  ProcessorPaymentDetails,
  ProcessorRefund,
  RefundPaymentInput,
  Settlement,
  SettlementMode,
} from "./types";
export { PROCESSOR_EVENT_TYPES } from "./types";

export {
  cancelPayment,
  createDonationPayment,
  getPayment,
  getPaymentForClient,
  refundPayment,
  syncPaymentWithProcessor,
  type ClientPayment,
  type CreateDonationPaymentInput,
  type DonationPayment,
  type PaymentScope,
  type PaymentSummary,
  type RefundPaymentRequest,
  type RefundResult,
} from "./donation-payments";
export type { PaymentLine } from "./metadata";

export { applyProcessorEvent, DONATION_PAYMENT_UPDATED_JOB, INVOICE_PAYMENT_UPDATED_JOB, type ApplyEventResult, type IgnoredReason } from "./events";
export { handleStripeWebhook, type WebhookResult } from "./webhooks";

export {
  createBusinessInvoice,
  getBusinessInvoice,
  listBusinessInvoices,
  markInvoicePaid,
  sendInvoice,
  voidInvoice,
  type BusinessInvoice,
  type CreateBusinessInvoiceInput,
  type InvoiceScope,
  type ListBusinessInvoicesParams,
  type MarkInvoicePaidOptions,
  type SendInvoiceOptions,
  type VoidInvoiceOptions,
} from "./invoices";

export {
  assertSandboxAvailable,
  confirmSandboxPayment,
  getSandboxInvoiceView,
  getSandboxPaymentView,
  isSandboxAvailable,
  paySandboxInvoice,
  type ConfirmSandboxPaymentInput,
  type SandboxConfirmResult,
  type SandboxInvoiceView,
  type SandboxPaymentView,
} from "./sandbox";
export { SANDBOX_TEST_CARDS, type SandboxOutcome, type SandboxTestCard } from "./sandbox-cards";

export * as paymentsPolicy from "./policy";
