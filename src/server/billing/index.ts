/**
 * Business billing: the success fee a camp, school or other vendor pays when a booking is completed with
 * scholarship funds, and its monthly invoice. The public API of src/server/billing.
 *
 * The business pays on its own account. Nothing here can bill a family, read a household, a family email, a
 * donation, an award or a scholarship payment, and the fee is never netted from scholarship funds (spec, Business
 * model §2; "Keep that fee on the business invoice").
 *
 *  - accrueSuccessFee(handoffId, tx)    called by the handoffs service when a booking is completed
 *  - generateMonthlyInvoices()          recurring "invoice.generate" (daily; bills fees accrued before this month)
 *  - applyInvoicePaymentUpdate(id)      job "invoice.payment_updated" { invoiceId } from the payments service
 *  - listInvoices / getInvoice / listSuccessFees / feeSummary   business portal read models
 */
export { accrueSuccessFee, computeSuccessFeeCents, describeSuccessFee, type FeeLedgerRow, type SuccessFeeTerms } from "./fees";
export { applyInvoicePaymentUpdate, generateMonthlyInvoices, type InvoiceRunFailure, type InvoiceRunResult } from "./invoicing";
export { feeSummary, getInvoice, listInvoices, listSuccessFees, type FeeSummary, type InvoiceSummary } from "./read";
export { INVOICE_GENERATE_EVERY_MS, INVOICE_GENERATE_JOB } from "./jobs";
