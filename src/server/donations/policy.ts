import { MS } from "@/lib/clock";
import { paymentsPolicy } from "@/server/payments";

/**
 * Product policies of the donor checkout. Each is a decision the sources (docs/reference/donor-credit-rules.md,
 * acknowledgment-reporting.md, payments-and-rails.md) leave open; the comment says what is open and why the
 * value was chosen, so a counsel decision becomes a one-line change here.
 */

/** A checkout expires this long after the donor last saved it. Not in the sources: long enough to finish, short enough to drop abandoned forms. */
export const CHECKOUT_IDLE_TTL_MS = 3 * MS.day;

/**
 * Smallest and largest gift (designated plus non-designated, before any fee on top). The bounds are the
 * processor's charge limits (payments policy): the sources set no minimum or maximum gift.
 */
export const MIN_GIFT_CENTS = paymentsPolicy.MIN_CHARGE_CENTS;
export const MAX_GIFT_CENTS = paymentsPolicy.MAX_CHARGE_CENTS;

/**
 * Whether a non-designated part of a gift can be collected in the same payment as the designated part.
 *
 * "refuse": the donor checkout refuses an order with a non-designated amount. Why: the payments service charges a
 * donation as a direct charge on the SGO's connected account, whose payouts are meant to land in the section 25F
 * segregated account, and that account "must contain only qualified contributions and the earnings therefrom"
 * (acknowledgment-reporting.md F45; payments-and-rails.md Engineering Implications 3: "Non-designated gifts and all
 * fees need a different account or flow"). The payments service has no line kind for a non-designated gift yet.
 * Partial designation is still modelled end to end (form, preview, donation rows, receipts, fee base); switching to
 * "same_payment" needs a payments line kind that settles outside the 25F account and counsel sign-off.
 */
export const NON_DESIGNATED_COLLECTION: "refuse" | "same_payment" = "refuse";

/**
 * The time zone used to assign a gift to a tax year when the browser did not report the donor's own. The
 * sources do not say which time zone decides (donor-credit-rules.md F62); US Central is the Texas wedge's zone
 * and the reference zone the rest of the product uses for Texas dates. Gifts near midnight on December 31 are
 * flagged `yearBoundaryAmbiguous` either way.
 */
export const DEFAULT_DONOR_TIME_ZONE = "America/Chicago";

/**
 * The payment method assumed when the checkout previews eligibility before the donor has paid. Both methods the
 * checkout offers (card and US bank account) are cash under the temporary regulations; the real method is
 * re-checked when the charge is made.
 */
export const PREVIEW_PAYMENT_METHOD = "card";

/**
 * How the checkout infers the State-list gate (donor-credit-rules.md Engineering Implications 2, gate 8) from the
 * list in use. The IRS SGO list is built from the lists States submit, so an organization shown on the IRS list
 * is treated as on a submitted State list ("list_submitted"). For the provisional curated list nothing is
 * asserted about the State (the provisional-list gate already keeps the credit-eligible label off).
 */
export const STATE_PARTICIPATION_INFERENCE = { irs_published: "list_submitted", provisional_curated: null } as const;

/**
 * The SGO's taxable year used for the substantial-contributor advisory. The profile does not record an SGO's
 * taxable year; calendar years are assumed and the advisory says it is an advisory (Prop. Treas. Reg. 1.25F-3(d)
 * measures the SGO's own taxable year).
 */
export const SGO_TAXABLE_YEAR_BASIS = "calendar_year" as const;

/** Mailing addresses accepted for the acknowledgment and the IRS report: the 50 States and D.C. The sources set no rule; paper delivery and IRS matching need a deliverable US address. */
export const DONOR_ADDRESS_COUNTRY = "US" as const;

/**
 * Whole words that mark a name as an organization's rather than a person's. Checkout is for individuals only
 * (Prop. Treas. Reg. 1.25F-2(a)(3) for partnerships and S corporations; other entities excluded as a cautious
 * product choice), and payments-and-rails.md Engineering Implications 16 asks to "block obviously non-individual
 * donor names". The list is a heuristic, not a legal test; the individual attestation is the real control.
 */
export const NON_INDIVIDUAL_NAME_WORDS = [
  "llc",
  "l.l.c.",
  "inc",
  "inc.",
  "incorporated",
  "corp",
  "corp.",
  "corporation",
  "company",
  "co.",
  "ltd",
  "ltd.",
  "lp",
  "llp",
  "pllc",
  "partnership",
  "partners",
  "trust",
  "trustee",
  "estate",
  "foundation",
  "daf",
] as const;

/** Rows per page in SGO read models. */
export const SGO_LIST_PAGE = { default: 50, max: 200 } as const;

/** Shortest written reason and counsel reference an operator must give for a refund of a designated gift. */
export const REFUND_REASON_MIN_LENGTH = paymentsPolicy.REFUND_REASON_MIN_LENGTH;
export const COUNSEL_REFERENCE_MIN_LENGTH = 3;
