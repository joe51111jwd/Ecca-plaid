import { MS } from "@/lib/clock";

/**
 * Policy constants for the payments domain.
 *
 * Each value below is a decision the product spec and the research notes (docs/reference/payments-and-rails.md)
 * either state outright or leave open. Where they leave it open the comment says so: those are the ones to
 * revisit with counsel, and they are constants precisely so that the change is one line.
 */

/** Section 25F cash is "all in U.S. dollars" (reference fact 1). No other currency is ever charged. */
export const CURRENCY = "usd" as const;

/**
 * Payment method types offered for a designated gift on Stripe: cards and ACH debit only. The Dashboard
 * defaults can enable crypto/stablecoin and buy-now-pay-later, which a section 25F gift must not use
 * (reference facts 1 and 23), so the allow-list is always sent explicitly.
 */
export const STRIPE_GIFT_PAYMENT_METHOD_TYPES = ["card", "us_bank_account"] as const;

/** Payment method types offered on a business invoice (reference fact 47: ACH first, it is the cheaper rail). */
export const STRIPE_INVOICE_PAYMENT_METHOD_TYPES = ["us_bank_account", "card"] as const;

/**
 * Smallest and largest charge accepted. The floor is Stripe's documented USD minimum (reference fact 43);
 * the ceiling is the eight-digit limit documented on PaymentIntent.amount. The sandbox applies the same
 * bounds so a flow that works in the sandbox also works on Stripe.
 */
export const MIN_CHARGE_CENTS = 50;
export const MAX_CHARGE_CENTS = 99_999_999;

/**
 * Which processor timestamp becomes `payments.paid_at`, the instant that decides a gift's tax year.
 *
 *  - "charge_created": when the charge was made (card: the moment of the charge; ACH: when the debit was
 *    initiated). The spec's only statement on timing is the section 170 analogy that a card gift is made
 *    "when the charge is made".
 *  - "payment_succeeded": when the processor confirmed the money (for ACH, days later).
 *
 * When an electronic contribution is "made" for section 25F is NOT settled by the statute or the
 * regulations (reference fact 17, Open Question 3). The other timestamp is always kept in
 * `payments.metadata` (`charge_created_at`, `succeeded_at`) so either rule can be applied later.
 */
export type PaidAtBasis = "charge_created" | "payment_succeeded";
export const PAID_AT_BASIS: PaidAtBasis = "charge_created";

/**
 * Refunds are whole-payment only. ACH debits cannot be partially refunded (reference fact 44), and whether
 * a designated gift may be refunded at all is a counsel question (reference fact 3, Open Question 5), so the
 * operator path stays as narrow as possible.
 */
export const REFUNDS_FULL_ONLY = true;

/** Shortest explanation an operator must give for a refund. */
export const REFUND_REASON_MIN_LENGTH = 10;

/** Payment terms on a business invoice when the caller does not choose. The spec sets no terms. */
export const DEFAULT_INVOICE_DUE_DAYS = 30;
export const MAX_INVOICE_DUE_DAYS = 365;

/** Stripe's documented maximum number of items on one invoice (reference fact 46). */
export const MAX_INVOICE_LINES = 250;

/** Invoice numbers: INV-2026-000123 for live invoices, INV-TEST-2026-000123 for sandbox invoices. */
export const INVOICE_NUMBER_PREFIX = { live: "INV", test: "INV-TEST" } as const;
export const INVOICE_NUMBER_DIGITS = 6;

/**
 * How long the sandbox keeps an asynchronous payment in "processing" before the settle job completes it.
 * Short on purpose: it exists to exercise the asynchronous path (ACH on a real processor takes days).
 */
export const SANDBOX_ASYNC_SETTLE_DELAY_MS = 8 * MS.second;

/** Stripe webhook events older than this are rejected (the SDK default; 0 would disable the check). */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
