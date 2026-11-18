/**
 * Checkout gates: may this gift be labeled "credit-eligible"?
 *
 * Implements the gates in docs/reference/donor-credit-rules.md, Engineering Implications 2. The function
 * never refuses a gift; it says whether the credit-eligible label may be shown and, if not, every reason
 * why, in words taken from the copy registry. Pure: the caller passes the charge instant, the configured
 * start date and a snapshot of the SGO's list status.
 *
 * Where the sources are silent (which time zone decides a date, what happens on the removal day, whether a
 * provisional listing is enough) the behaviour is a conservative product policy named in `./constants`.
 */
import { z } from "zod";
import type { Authority } from "./authority";
import {
  CASH_PAYMENT_METHODS,
  DATE_BEGUN_ANYWHERE_TIME_ZONE,
  DATE_BEGUN_EVERYWHERE_TIME_ZONE,
  DIGITAL_ASSET_PAYMENT_METHODS,
  ELIGIBLE_CURRENCY,
  TAX_YEAR_BASIS,
  TAXMATH_VERSION,
} from "./constants";
import { COPY_VERSION, getCopy, renderCopyDynamic, type CopyId, type RenderCopyOptions } from "./copy";
import { formatIsoDateLong, startOfDateInTimeZone, zonedDateTime } from "./dates";
import { instantSchema, isoDateSchema, parseInput } from "./validation";

export const SGO_LIST_SOURCES = ["provisional_curated", "irs_published"] as const;
export type SgoListSource = (typeof SGO_LIST_SOURCES)[number];

/** "not_listed" is for an organization with no entry on the list in use. */
export const SGO_LIST_STATUSES = ["listed", "removed", "not_listed"] as const;
export type SgoListStatus = (typeof SGO_LIST_STATUSES)[number];

/**
 * Where the SGO's State stands for the calendar year of the gift. An advance election is not complete until
 * the State submits its SGO list (for 2027, by February 15, 2027).
 */
export const STATE_PARTICIPATION_STATUSES = ["list_submitted", "advance_election_only", "not_participating"] as const;
export type StateParticipationStatus = (typeof STATE_PARTICIPATION_STATUSES)[number];

export interface CreditEligibilityInput {
  /** The instant the payment was charged. */
  paidAt: Date;
  /** The instant the donor started this payment. When given it must also fall on or after the credit start. */
  initiatedAt?: Date | null;
  /** First credit-eligible date, YYYY-MM-DD (platform setting `credit.startDate`; FIRST_ELIGIBLE_DATE by default). */
  creditStartDate: string;
  sgo: {
    /** Which list the entry comes from. Only the IRS-published list supports the credit-eligible label. */
    listSource: SgoListSource;
    listStatus: SgoListStatus;
    /** Removal date shown on the list, YYYY-MM-DD. */
    removedOn?: string | null;
    /** First date the organization is shown as listed, YYYY-MM-DD. */
    listedFrom?: string | null;
    /** The SGO has registered in the IRS SGO portal (it cannot create unique donor numbers before that). */
    portalRegistered: boolean;
    /** False when the SGO has not authorized the IRS to publish it; the donor then has no list reliance. */
    publicListingAuthorized?: boolean | null;
    /** Status of the SGO's State for the calendar year of the gift, when known. */
    stateParticipation?: StateParticipationStatus | null;
  };
  attestations: {
    individual: boolean;
    usCitizenOrResident: boolean;
    noEarmark: boolean;
    notInExchangeForScholarship: boolean;
  };
  /** Payment method identifier from the processor, for example "card" or "us_bank_account". */
  paymentMethod: string;
  /** ISO 4217 currency code of the charge. */
  currency: string;
  /** False for sandbox (test-mode) gifts, where no money moves. */
  liveMode: boolean;
  /** The donor's IANA time zone. When given, the result includes the tax year and flags a year-boundary gift. */
  donorTimeZone?: string | null;
}

const eligibilityInputSchema = z.strictObject({
  paidAt: instantSchema,
  initiatedAt: instantSchema.nullish(),
  creditStartDate: isoDateSchema,
  sgo: z.strictObject({
    listSource: z.enum(SGO_LIST_SOURCES, "Must be provisional_curated or irs_published"),
    listStatus: z.enum(SGO_LIST_STATUSES, "Must be listed, removed or not_listed"),
    removedOn: isoDateSchema.nullish(),
    listedFrom: isoDateSchema.nullish(),
    portalRegistered: z.boolean("Must be true or false"),
    publicListingAuthorized: z.boolean("Must be true or false").nullish(),
    stateParticipation: z.enum(STATE_PARTICIPATION_STATUSES, "Must be list_submitted, advance_election_only or not_participating").nullish(),
  }),
  attestations: z.strictObject({
    individual: z.boolean("Must be true or false"),
    usCitizenOrResident: z.boolean("Must be true or false"),
    noEarmark: z.boolean("Must be true or false"),
    notInExchangeForScholarship: z.boolean("Must be true or false"),
  }),
  paymentMethod: z.string("Must be a payment method identifier").trim().min(1, "Must be a payment method identifier"),
  currency: z.string("Must be a currency code").trim().min(1, "Must be a currency code"),
  liveMode: z.boolean("Must be true or false"),
  donorTimeZone: z.string("Must be an IANA time zone").trim().min(1, "Must be an IANA time zone").nullish(),
}) satisfies z.ZodType<CreditEligibilityInput>;

export const ELIGIBILITY_BLOCKER_CODES = [
  "sandbox_mode",
  "before_credit_start",
  "initiated_before_credit_start",
  "state_not_participating",
  "state_list_not_submitted",
  "sgo_not_listed",
  "sgo_removed",
  "sgo_not_yet_listed",
  "sgo_list_provisional",
  "sgo_not_portal_registered",
  "attestation_individual_missing",
  "attestation_us_citizen_or_resident_missing",
  "attestation_no_earmark_missing",
  "attestation_not_in_exchange_missing",
  "payment_method_digital_asset",
  "payment_method_not_cash",
  "currency_not_usd",
] as const;
export type EligibilityBlockerCode = (typeof ELIGIBILITY_BLOCKER_CODES)[number];

export const ELIGIBILITY_WARNING_CODES = ["list_reliance_unavailable", "sgo_removed_after_gift", "tax_year_boundary_ambiguous"] as const;
export type EligibilityWarningCode = (typeof ELIGIBILITY_WARNING_CODES)[number];

export interface EligibilityFinding<Code extends string> {
  code: Code;
  /** Donor-facing sentence, rendered from the copy registry. */
  message: string;
  copyId: CopyId;
  /** How settled the reason is; `product_policy` reasons are this product's caution, not a legal bar. */
  authority: Authority;
}

export type EligibilityBlocker = EligibilityFinding<EligibilityBlockerCode>;
export type EligibilityWarning = EligibilityFinding<EligibilityWarningCode>;

export type PaymentMethodClass = "cash" | "digital_asset" | "unrecognized";

export interface TaxYearDetermination {
  /** The year this product assigns the gift to: the calendar year of the charge in the donor's time zone. */
  taxYear: number;
  basis: typeof TAX_YEAR_BASIS.value;
  timeZone: string;
  /** Calendar date of the charge in the donor's time zone, YYYY-MM-DD. */
  localDate: string;
  localYear: number;
  utcYear: number;
  /** True when the UTC and donor-local calendar years differ: the gift needs a human look at year end. */
  yearBoundaryAmbiguous: boolean;
}

export interface CreditEligibilityResult {
  /** True only when no gate blocks the credit-eligible label. */
  creditEligible: boolean;
  blockers: EligibilityBlocker[];
  warnings: EligibilityWarning[];
  /** True when the sandbox is the only thing keeping this gift off the credit-eligible path. */
  onlyBlockedBySandbox: boolean;
  /** One sentence for the donor that sums up why the gift is not credit-eligible; null when it is. */
  headline: { copyId: CopyId; message: string } | null;
  /** `headline.message`, for `donations.credit_ineligible_reason`. */
  ineligibleReason: string | null;
  beforeCreditStart: boolean;
  /** The instant the credit-eligible path opens for `creditStartDate`, ISO 8601 UTC. */
  creditStartInstant: string;
  paymentMethodClass: PaymentMethodClass;
  /** Present when `donorTimeZone` was given. */
  taxYear: TaxYearDetermination | null;
  taxmathVersion: string;
  copyVersion: string;
}

/**
 * The instant the credit-eligible path opens: the start date at midnight in the last of the 50 States to
 * reach it (Hawaii). For 2027-01-01 that is 2027-01-01T10:00:00Z. A product policy, not a rule from the sources.
 */
export function creditStartInstant(creditStartDate: string): Date {
  return startOfDateInTimeZone(creditStartDate, DATE_BEGUN_EVERYWHERE_TIME_ZONE.value);
}

/** True while a payment charged at `paidAt` is too early to be on the credit-eligible path. */
export function isBeforeCreditStart(paidAt: Date, creditStartDate: string): boolean {
  const instant = parseInput(instantSchema, paidAt, "payment time");
  return instant.getTime() < creditStartInstant(creditStartDate).getTime();
}

/**
 * The tax year this product assigns to a gift charged at `paidAt` for a donor in `timeZone`, with a flag
 * when the UTC calendar year differs (a gift in the last or first hours of a year). The section 25F sources
 * do not define when a payment is "made", so this is a product policy and the flag asks for a human look.
 */
export function determineTaxYear(paidAt: Date, timeZone: string): TaxYearDetermination {
  const instant = parseInput(instantSchema, paidAt, "payment time");
  const local = zonedDateTime(instant, timeZone);
  const utcYear = instant.getUTCFullYear();
  return {
    taxYear: local.year,
    basis: TAX_YEAR_BASIS.value,
    timeZone,
    localDate: local.isoDate,
    localYear: local.year,
    utcYear,
    yearBoundaryAmbiguous: utcYear !== local.year,
  };
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

/** Sorts a processor's payment-method identifier into cash, digital asset, or not recognized as cash. */
export function classifyPaymentMethod(paymentMethod: string): PaymentMethodClass {
  const method = normalizeIdentifier(paymentMethod);
  if ((DIGITAL_ASSET_PAYMENT_METHODS.value as readonly string[]).includes(method)) return "digital_asset";
  if (Object.prototype.hasOwnProperty.call(CASH_PAYMENT_METHODS.value, method)) return "cash";
  return "unrecognized";
}

export function assessCreditEligibility(input: CreditEligibilityInput): CreditEligibilityResult {
  const parsed = parseInput(eligibilityInputSchema, input, "eligibility input");
  const { paidAt, sgo, attestations } = parsed;
  const renderOptions: RenderCopyOptions = { sgoListSource: sgo.listSource };
  const startDateText = formatIsoDateLong(parsed.creditStartDate);
  const startInstant = creditStartInstant(parsed.creditStartDate);

  const blockers: EligibilityBlocker[] = [];
  const warnings: EligibilityWarning[] = [];
  const finding = <Code extends string>(code: Code, copyId: CopyId, vars: Record<string, string> = {}): EligibilityFinding<Code> => ({
    code,
    message: renderCopyDynamic(copyId, vars, renderOptions),
    copyId,
    authority: getCopy(copyId).authority,
  });
  const block = (code: EligibilityBlockerCode, copyId: CopyId, vars?: Record<string, string>) => blockers.push(finding(code, copyId, vars));
  const warn = (code: EligibilityWarningCode, copyId: CopyId, vars?: Record<string, string>) => warnings.push(finding(code, copyId, vars));

  if (!parsed.liveMode) block("sandbox_mode", "eligibility.sandbox_mode");

  const beforeCreditStart = paidAt.getTime() < startInstant.getTime();
  if (beforeCreditStart) {
    block("before_credit_start", "eligibility.before_credit_start", { creditStartDate: startDateText });
  } else if (parsed.initiatedAt && parsed.initiatedAt.getTime() < startInstant.getTime()) {
    block("initiated_before_credit_start", "eligibility.initiated_before_credit_start", { creditStartDate: startDateText });
  }

  if (sgo.stateParticipation === "not_participating") block("state_not_participating", "eligibility.state_not_participating");
  if (sgo.stateParticipation === "advance_election_only") block("state_list_not_submitted", "eligibility.state_list_not_submitted");

  // A removal counts from the first moment its date begins anywhere in the 50 States and D.C.
  const removalInstant = sgo.removedOn ? startOfDateInTimeZone(sgo.removedOn, DATE_BEGUN_ANYWHERE_TIME_ZONE.value) : null;
  const removedBeforeOrAtGift = removalInstant ? paidAt.getTime() >= removalInstant.getTime() : sgo.listStatus === "removed";

  if (sgo.listStatus === "not_listed") {
    block("sgo_not_listed", "eligibility.sgo_not_listed");
  } else if (removedBeforeOrAtGift) {
    if (sgo.removedOn) block("sgo_removed", "eligibility.sgo_removed_on", { removedOn: formatIsoDateLong(sgo.removedOn) });
    else block("sgo_removed", "eligibility.sgo_removed");
  } else {
    if (sgo.listStatus === "removed" && sgo.removedOn) {
      warn("sgo_removed_after_gift", "eligibility.warning.removed_after_gift", { removedOn: formatIsoDateLong(sgo.removedOn) });
    }
    // A listing counts only once its first day has begun in every one of the 50 States.
    if (sgo.listedFrom && paidAt.getTime() < startOfDateInTimeZone(sgo.listedFrom, DATE_BEGUN_EVERYWHERE_TIME_ZONE.value).getTime()) {
      block("sgo_not_yet_listed", "eligibility.sgo_not_yet_listed", { listedFrom: formatIsoDateLong(sgo.listedFrom) });
    }
    if (sgo.listSource === "provisional_curated") {
      block("sgo_list_provisional", "eligibility.sgo_list_provisional");
    } else if (sgo.publicListingAuthorized === false) {
      warn("list_reliance_unavailable", "notice.list_reliance_unavailable");
    }
  }

  if (!sgo.portalRegistered) block("sgo_not_portal_registered", "eligibility.sgo_not_portal_registered");

  if (!attestations.individual) block("attestation_individual_missing", "eligibility.attestation_individual_missing");
  if (!attestations.usCitizenOrResident) block("attestation_us_citizen_or_resident_missing", "eligibility.attestation_us_missing");
  if (!attestations.noEarmark) block("attestation_no_earmark_missing", "eligibility.attestation_no_earmark_missing");
  if (!attestations.notInExchangeForScholarship) block("attestation_not_in_exchange_missing", "eligibility.attestation_not_in_exchange_missing");

  const paymentMethodClass = classifyPaymentMethod(parsed.paymentMethod);
  if (paymentMethodClass === "digital_asset") block("payment_method_digital_asset", "eligibility.payment_method_digital_asset");
  if (paymentMethodClass === "unrecognized") block("payment_method_not_cash", "eligibility.payment_method_not_cash");
  if (normalizeIdentifier(parsed.currency) !== ELIGIBLE_CURRENCY.value) block("currency_not_usd", "eligibility.currency_not_usd");

  const taxYear = parsed.donorTimeZone ? determineTaxYear(paidAt, parsed.donorTimeZone) : null;
  if (taxYear?.yearBoundaryAmbiguous) warn("tax_year_boundary_ambiguous", "eligibility.warning.year_boundary");

  let headline: CreditEligibilityResult["headline"] = null;
  if (blockers.length > 0) {
    if (!parsed.liveMode && beforeCreditStart) {
      const copyId: CopyId = "eligibility.before_credit_start_sandbox";
      headline = { copyId, message: renderCopyDynamic(copyId, { creditStartDate: startDateText }, renderOptions) };
    } else {
      headline = { copyId: blockers[0].copyId, message: blockers[0].message };
    }
  }

  return {
    creditEligible: blockers.length === 0,
    blockers,
    warnings,
    onlyBlockedBySandbox: blockers.length === 1 && blockers[0].code === "sandbox_mode",
    headline,
    ineligibleReason: headline?.message ?? null,
    beforeCreditStart,
    creditStartInstant: startInstant.toISOString(),
    paymentMethodClass,
    taxYear,
    taxmathVersion: TAXMATH_VERSION,
    copyVersion: COPY_VERSION,
  };
}
