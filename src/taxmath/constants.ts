/**
 * Every section 25F number, date and policy switch in the application.
 *
 * Each constant is a `Rule`: the value, how settled it is, and where it comes from. Citations name the
 * provision and the fact id in the verified research notes (docs/reference/donor-credit-rules.md, "F..").
 * Nothing in this file is from memory. Where the sources are silent the constant is tagged
 * `product_policy`: a conservative default this product chose, never to be presented as law.
 *
 * Changing any value, authority tag or citation here requires bumping TAXMATH_VERSION (a test pins the
 * fingerprint of this file to the version string).
 */
import { invalid } from "@/lib/errors";
import {
  ACKNOWLEDGMENT_REFERENCE as ACK,
  DONOR_RULES_REFERENCE as REF,
  IRS_INDIVIDUALS_PAGE_CITATION,
  PROPOSED_REG_CITATION as NPRM,
  STATUTE_CITATION as STATUTE,
  TEMPORARY_REG_CITATION as TD,
  rule,
  type Rule,
} from "./authority";
import { sha256Hex, stableStringify } from "./hash";

/** Version of the rules and algorithms in src/taxmath. Stored with every preview and donation. */
export const TAXMATH_VERSION = "25f-taxmath.2026-11-18.v1";

/* ------------------------------------------------------------------ credit amount */

export const CREDIT_CAP_PER_TAXPAYER_CENTS = rule(
  170_000,
  "statute",
  `${STATUTE}(b)(1): "The credit allowed under subsection (a) to any taxpayer for any taxable year shall not exceed $1,700." The statute text contains no inflation adjustment. [${REF} F11]`,
);

export const CREDIT_BASE_IS_ANNUAL_AGGREGATE = rule(
  true,
  "statute",
  `${STATUTE}(a): the credit is "an amount equal to the aggregate amount of qualified contributions made by the taxpayer during the taxable year", so the cap applies to the year's total across every SGO and every gift (Example 3 adds gifts to two organizations). [${REF} F1, F10, F75]`,
);

export const STATE_CREDIT_REDUCES_CREDIT = rule(
  true,
  "statute",
  `${STATUTE}(b)(2): the credit "shall be reduced by the amount allowed as a credit on any State tax return of the taxpayer for qualified contributions made by the taxpayer during the taxable year." [${REF} F22]`,
);

export const STATE_CREDIT_REDUCTION_BEFORE_CAP = rule(
  true,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(a) and (c)(1) (${NPRM}): qualified contributions are reduced (not below zero) by State credits, then the lesser of that amount and $1,700 is taken. Treasury rejected the cap-then-reduce reading in the preamble. [${REF} F12, F13, F14]`,
);

export const STATE_CREDIT_ABSORPTION_ORDER = rule(
  "non_qualified_contributions_first",
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(c)(2) (${NPRM}): a State credit is "treated as first being allowed with respect to the amount of the donor's contribution that is not a qualified contribution and only thereafter" with respect to qualified contributions; one State-credit dollar against one non-qualified dollar (Example 4). [${REF} F23, F76, F78]`,
);

export const STATE_CREDIT_PARTIAL_SPILLOVER = rule(
  "excess_over_non_qualified_reduces_one_for_one",
  "product_policy",
  `Extrapolation of Prop. Treas. Reg. 1.25F-2(c)(2) to a State credit larger than the non-designated amount. The regulation states the ordering but gives no worked example of a partial spillover; any figure that depends on it is labeled an estimate. [${REF} Engineering Implications 1, fact-check note (i); Open Questions 5 and 25]`,
);

export const GOODS_OR_SERVICES_REDUCE_QUALIFIED_CONTRIBUTION = rule(
  true,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): "the value of those goods and services must be subtracted from the amount of the charitable contribution to arrive at the amount of the qualified contribution." [${REF} F45]`,
);

export const DESIGNATION_REQUIRED_AT_TIME_OF_CONTRIBUTION = rule(
  true,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): a cash contribution is a qualified contribution only "to the extent that the donor designates to the recipient SGO, at the time of making the contribution, that the contribution is intended to be a qualified contribution". Partial designation is allowed ("to the extent"). [${REF} F41]`,
);

export const DESIGNATION_IRREVOCABLE = rule(
  true,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): "Such designation, once made, is irrevocable." [${REF} F42]`,
);

/* ------------------------------------------------------------------ joint returns */

export const JOINT_RETURN_SPOUSES_ARE_SEPARATE_TAXPAYERS = rule(
  true,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(a) (${NPRM}): "married taxpayers who elect to file a joint return under section 6013(a) ... are treated as separate taxpayers" for the section 25F(b)(1) limit; each spouse must make their own qualified contributions. The statute says only "any taxpayer". [${REF} F15, F16, F74]`,
);

export const JOINT_RETURN_MAX_CREDIT_CENTS = rule(
  2 * CREDIT_CAP_PER_TAXPAYER_CENTS.value,
  "proposed_reg",
  `Twice the per-taxpayer limit, reachable only when each spouse makes qualified contributions: Prop. Treas. Reg. 1.25F-2(a) and Example 2 (${NPRM}); ${IRS_INDIVIDUALS_PAGE_CITATION}. [${REF} F15, F16]`,
);

export const JOINT_RETURN_COMBINED_LIABILITY_LIMIT = rule(
  true,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2, Example 2 (${NPRM}): the spouses' credits are added and "subject to their combined tax liability limitation under section 26(a)". [${REF} F19]`,
);

export const JOINT_STATE_CREDIT_ALLOCATION = rule(
  "entered_separately_for_each_spouse",
  "product_policy",
  `How a State credit allowed on a joint State return is divided between two spouses' separate federal computations is not in the sources, so the product never splits one automatically. [${REF} F20; Open Questions 4]`,
);

export const JOINT_CARRYFORWARD_TRACKING = rule(
  "single_pool_per_return",
  "product_policy",
  `How carryforward buckets are tracked per spouse (and after marriage, divorce or a change of filing status) is not in the sources; the liability preview treats them as one pool for the return. [${REF} Engineering Implications 1; Open Questions 17]`,
);

/* ------------------------------------------------------------------ liability limit and carryforward */

export const CREDIT_IS_NONREFUNDABLE = rule(
  true,
  "statute",
  `${STATUTE}(a) and (f): the credit is allowed against tax, and the part that exceeds the section 26(a) limitation is carried forward rather than refunded. Described as nonrefundable in Prop. Treas. Reg. 1.25F-2(a) and on the IRS FSTC pages. [${REF} F29, F31]`,
);

export const LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS = rule(
  ["21", "22", "24", "25", "25A", "25B", "25C", "25E"] as const,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(d) (${NPRM}): the credit may not exceed tax liability as defined in section 26(a) "as reduced by the sum of the nonrefundable personal credits allowable under sections 21, 22, 24, 25, 25A, 25B, 25C and 25E". The statute says "credits allowable under this subpart (other than this section, section 23, and section 25D)". Refer to these credits by section number only; plain-English names are unverified. [${REF} F30, F30a]`,
);

export const LIABILITY_ESTIMATE_SOURCE = rule(
  "donor_supplied_estimate_only",
  "product_policy",
  `The sources name section 26(a) but never reproduce its definition, so a donor's limit cannot be computed here. The preview takes the donor's own estimate and never invents one. [${REF} F30a; Engineering Implications 1 and 5]`,
);

export const CARRYFORWARD_YEARS = rule(
  5,
  "statute",
  `${STATUTE}(f): "No credit may be carried forward under this subsection to any taxable year following the fifth taxable year after the taxable year in which the credit arose." [${REF} F32]`,
);

export const CARRYFORWARD_USE_ORDER = rule(
  "first_in_first_out",
  "statute",
  `${STATUTE}(f): "credits shall be treated as used on a first-in first-out basis." [${REF} F32]`,
);

export const CARRYFORWARD_USED_BEFORE_CURRENT_YEAR_CREDIT = rule(
  true,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(e)(3) (${NPRM}): "a section 25F credit carried forward must be used prior to using any section 25F credit that arose for such taxable year." [${REF} F33, F77]`,
);

export const CAP_LIMITS_CREDIT_GENERATED_NOT_CREDIT_USED = rule(
  true,
  "proposed_reg",
  `Preamble and Example 5 of ${NPRM}: carryforwards can be used against more than $1,700 of tax in one year, but the amount entering the carryforward pool from any one year is at most $1,700 per taxpayer (2032 row of Table 1). [${REF} F34, F77]`,
);

/* ------------------------------------------------------------------ section 170 coordination */

export const NO_DOUBLE_BENEFIT = rule(
  true,
  "statute",
  `${STATUTE}(e): "Any qualified contribution for which a credit is allowed under this section shall not be taken into account as a charitable contribution for purposes of section 170." [${REF} F35]`,
);

export const CARRIED_FORWARD_CREDIT_TREATED_AS_ALLOWED = rule(
  true,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(f) (${NPRM}): "an amount is treated as allowed if it may be carried forward", so credit blocked by the liability limit is not deductible. [${REF} F36]`,
);

export const UNCREDITED_PORTION_DEDUCTIBILITY = rule(
  "may_be_deductible_only_if_section_170_requirements_are_met",
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2(f) (${NPRM}): "Any portion of a qualified contribution for which a credit under section 25F is not allowed may be deductible as a charitable contribution if it meets the requirements of section 170 and the regulations thereunder." The sources say "may be", never "is"; the examples apply it to the amount over $1,700 and say nothing about the amount removed by a State credit. [${REF} F37, F37a, F38]`,
);

/* ------------------------------------------------------------------ timing */

export const FIRST_ELIGIBLE_DATE = rule(
  "2027-01-01",
  "temporary_reg",
  `${TD}, preamble: "Taxpayers may begin making qualified contributions on January 1, 2027." ${STATUTE} applies to taxable years ending after December 31, 2026; ${IRS_INDIVIDUALS_PAGE_CITATION} ("Beginning Jan. 1, 2027"). [${REF} F60, F61]`,
);

export const DATE_BEGUN_EVERYWHERE_TIME_ZONE = rule(
  "Pacific/Honolulu",
  "product_policy",
  `The sources do not say which time zone decides when a contribution is made. A calendar date is treated as reached only once it has begun in every one of the 50 States (midnight Hawaii time, 10:00 UTC), and a payment must be both started and charged after that instant. Used for the credit start date and for an organization's listed-from date. [${REF} F62; Engineering Implications 2, gate 1]`,
);

export const DATE_BEGUN_ANYWHERE_TIME_ZONE = rule(
  "America/New_York",
  "product_policy",
  `The sources do not say whether a gift on an organization's removal date counts, or in which time zone. The removal date is treated as begun as soon as it starts anywhere in the 50 States and D.C. (midnight Eastern time), and a gift from that instant on is blocked. [${REF} F56; ${ACK} Engineering Implications E5 item 5, Q9]`,
);

export const TAX_YEAR_BASIS = rule(
  "calendar_year_of_charge_in_donor_time_zone",
  "product_policy",
  `The credit is for contributions "made by the taxpayer during the taxable year", but no section 25F source says when a card or bank payment is made or which time zone decides a gift near midnight on December 31. The product uses the calendar year of the charge in the donor's own time zone and flags gifts whose UTC year differs. [${REF} F62; Open Questions 1]`,
);

/* ------------------------------------------------------------------ checkout gates */

export const PROVISIONAL_LIST_IS_NOT_CREDIT_ELIGIBLE = rule(
  true,
  "product_policy",
  `Until an organization is on its State's submitted list and on the IRS SGO list, a gift to it is not labeled credit-eligible: the IRS says the SGO must appear on a State's list "at the time of the contribution", and no source says a later listing cures an earlier gift. [${REF} F54a; Engineering Implications 2, gates 7 and 8; Open Questions 6]`,
);

export const PORTAL_REGISTRATION_REQUIRED_FOR_CREDIT_PATH = rule(
  true,
  "product_policy",
  `Temp. Treas. Reg. 1.25F-4T(b) (${TD}): until an organization registers in the IRS SGO portal it cannot create unique donor numbers, and a donor needs that number for Form 8525. Closing the credit-eligible path until then is this product's choice. [${REF} F66, F69; Engineering Implications 2, gate 4; ${ACK} E3 item 4]`,
);

export const UNAUTHORIZED_PUBLIC_LISTING_HANDLING = rule(
  "warn",
  "product_policy",
  `An SGO that has not authorized disclosure is absent from the public IRS list, so the proposed list-reliance rule is unavailable to its donors; the research allows either not offering it or warning. This product warns. [${REF} F57; Engineering Implications 2, gate 3]`,
);

export const ELIGIBLE_CURRENCY = rule(
  "usd",
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): cash means the listed methods "in each case all in U.S. dollars". [${REF} F44]`,
);

/**
 * Payment-method identifiers accepted as "cash", mapped to the regulation's category. The categories are
 * the regulation's; which processor identifiers fall in each is this product's mapping.
 */
export const CASH_PAYMENT_METHODS = rule(
  {
    card: "electronic_transfer",
    us_bank_account: "electronic_transfer",
    ach: "electronic_transfer",
    bank_transfer: "electronic_transfer",
    check: "check",
    money_order: "money_order",
    currency: "physical_currency",
    payroll_deduction: "after_tax_payroll_deduction",
  } as const,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): cash "(A) Means physical currency, check, money order, electronic transfer, after-tax payroll deduction, or other similar method, in each case all in U.S. dollars". Credit and debit cards are named only in the preamble, as an example of electronic transfer. [${REF} F44]`,
);

export const DIGITAL_ASSET_PAYMENT_METHODS = rule(
  ["crypto", "cryptocurrency", "digital_asset", "stablecoin"] as const,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): cash "(B) Does not mean any digital asset." [${REF} F44]`,
);

export const UNRECOGNIZED_PAYMENT_METHOD_HANDLING = rule(
  "block",
  "product_policy",
  `A payment method this module does not recognize as one of the regulation's cash methods is kept off the credit-eligible path rather than assumed to be an "other similar method". [${REF} F44; Engineering Implications 2, gate 6]`,
);

/* ------------------------------------------------------------------ large donors */

export const SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS = rule(
  500_000,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-3(d)(2) (${NPRM}): a substantial contributor is "any person who contributed an aggregate amount of more than $5,000 to the SGO during the taxable year, if such amount is more than 2 percent of the total contributions received by the SGO during the taxable year"; the same test applies to the section 25F segregated account. [${REF} F50, F53]`,
);

export const SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD = rule(
  { numerator: 2, denominator: 100 } as const,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-3(d)(2) (${NPRM}): "more than 2 percent of the total contributions received". [${REF} F50, F53]`,
);

export const SUBSTANTIAL_CONTRIBUTOR_SPOUSE_ATTRIBUTION = rule(
  true,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-3(d)(2) (${NPRM}): "an individual will be treated as making all contributions made by his or her spouse." [${REF} F50]`,
);

export const SUBSTANTIAL_CONTRIBUTOR_STATUS_TAXABLE_YEARS = rule(
  2,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-3(d) (${NPRM}): status is determined at the close of the SGO's taxable year and lasts for "any taxable year of the SGO in which the individual is so described and for the immediately succeeding taxable year". [${REF} F50, F53]`,
);

/* ------------------------------------------------------------------ substantiation and calendar */

export const CLAIM_FORM = rule(
  { number: "8525", name: "Form 8525", title: "Federal Scholarship Tax Credit" } as const,
  "proposed_reg",
  `Prop. Treas. Reg. 1.25F-2 (${NPRM}): the credit is substantiated "on Form 8525, Federal Scholarship Tax Credit (or successor form)", reporting each SGO's unique donor number; ${IRS_INDIVIDUALS_PAGE_CITATION}. [${REF} F65, F66]`,
);

export const CLAIM_FORM_FIRST_FILING_SEASON = rule(
  2028,
  "irs_web",
  `${IRS_INDIVIDUALS_PAGE_CITATION}: "Form 8525 will be available for the 2028 filing season for contributions made to SGOs during calendar year 2027." [${REF} F65]`,
);

export const ACKNOWLEDGMENT_DEADLINE = rule(
  { month: 1, day: 31, yearsAfterContribution: 1 } as const,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-4T(c)(1) (${TD}): "no later than January 31 of the calendar year following the calendar year in which a donor made a qualified contribution". No weekend or holiday roll-forward is stated. [${REF} F68; ${ACK} F9]`,
);

export const IRS_CONTRIBUTION_REPORT_DEADLINE = rule(
  { month: 2, day: 28, yearsAfterContribution: 1 } as const,
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-4T(c)(2) (${TD}): "no later than February 28 of the year following the year in which such qualified contributions were made". The literal 28th, also in a leap year. [${REF} F70; ${ACK} F34]`,
);

export const STATE_SGO_LIST_DEADLINE_2027 = rule(
  "2027-02-15",
  "temporary_reg",
  `Temp. Treas. Reg. 1.25F-5T(c)(3)(ii) (${TD}): "For calendar year 2027 only, a State may provide its State SGO list on or before February 15, 2027." A State that misses it has no SGOs for 2027. [${REF} F8a, F58]`,
);

/* ------------------------------------------------------------------ fees and defaults (product policy) */

export const DEFAULT_FEE_STRUCTURE = rule(
  "none",
  "product_policy",
  `Build spec, Business model, structure (c): "do not take a percentage of 25F gifts in production until the memo is in hand." How a platform fee affects the qualified contribution is not in the section 25F sources. [${REF} Open Questions 8; Engineering Implications 8]`,
);

export const FEE_STRUCTURES_REQUIRING_COUNSEL_MEMO = rule(
  ["sgo_invoiced", "donor_service_fee"] as const,
  "product_policy",
  `Build spec, Business model: the fee structure "needs a written counsel memo before any live 25F gift is accepted"; structures (a) and (b) are "to discuss with counsel, not to pick in this spec".`,
);

export const FEE_BASE = rule(
  "designated_plus_non_designated_gift",
  "product_policy",
  "The build spec sets no fee amount or base (\"Neither fee amount is set in this spec\"). A percentage fee is computed on the whole gift (designated plus non-designated) and is never taken out of it.",
);

export const FEE_ROUNDING = rule(
  "half_up_to_the_cent",
  "product_policy",
  "The build spec sets no rounding rule for a percentage fee. Fees are rounded half up to the nearest cent.",
);

export const DEFAULT_DESIGNATION = rule(
  "lesser_of_gift_and_cap_per_taxpayer",
  "product_policy",
  `Pre-fill only: the designated amount starts at min(gift, $1,700) per taxpayer and the donor may change it. A higher designation is not blocked (Examples 1 and 2 designate $2,000). [${REF} Engineering Implications 3]`,
);

export const JOINT_DEFAULT_SPLIT = rule(
  "even",
  "product_policy",
  `The IRS page contemplates one combined payment on behalf of both spouses but states no split; an even split is only a starting point the spouses must confirm. [${REF} F17, F17a; Engineering Implications 4; Open Questions 2]`,
);

/* ------------------------------------------------------------------ registry */

export const RULES = Object.freeze({
  creditCapPerTaxpayerCents: CREDIT_CAP_PER_TAXPAYER_CENTS,
  creditBaseIsAnnualAggregate: CREDIT_BASE_IS_ANNUAL_AGGREGATE,
  stateCreditReducesCredit: STATE_CREDIT_REDUCES_CREDIT,
  stateCreditReductionBeforeCap: STATE_CREDIT_REDUCTION_BEFORE_CAP,
  stateCreditAbsorptionOrder: STATE_CREDIT_ABSORPTION_ORDER,
  stateCreditPartialSpillover: STATE_CREDIT_PARTIAL_SPILLOVER,
  goodsOrServicesReduceQualifiedContribution: GOODS_OR_SERVICES_REDUCE_QUALIFIED_CONTRIBUTION,
  designationRequiredAtTimeOfContribution: DESIGNATION_REQUIRED_AT_TIME_OF_CONTRIBUTION,
  designationIrrevocable: DESIGNATION_IRREVOCABLE,
  jointReturnSpousesAreSeparateTaxpayers: JOINT_RETURN_SPOUSES_ARE_SEPARATE_TAXPAYERS,
  jointReturnMaxCreditCents: JOINT_RETURN_MAX_CREDIT_CENTS,
  jointReturnCombinedLiabilityLimit: JOINT_RETURN_COMBINED_LIABILITY_LIMIT,
  jointStateCreditAllocation: JOINT_STATE_CREDIT_ALLOCATION,
  jointCarryforwardTracking: JOINT_CARRYFORWARD_TRACKING,
  creditIsNonrefundable: CREDIT_IS_NONREFUNDABLE,
  liabilityLimitOtherCreditSections: LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS,
  liabilityEstimateSource: LIABILITY_ESTIMATE_SOURCE,
  carryforwardYears: CARRYFORWARD_YEARS,
  carryforwardUseOrder: CARRYFORWARD_USE_ORDER,
  carryforwardUsedBeforeCurrentYearCredit: CARRYFORWARD_USED_BEFORE_CURRENT_YEAR_CREDIT,
  capLimitsCreditGeneratedNotCreditUsed: CAP_LIMITS_CREDIT_GENERATED_NOT_CREDIT_USED,
  noDoubleBenefit: NO_DOUBLE_BENEFIT,
  carriedForwardCreditTreatedAsAllowed: CARRIED_FORWARD_CREDIT_TREATED_AS_ALLOWED,
  uncreditedPortionDeductibility: UNCREDITED_PORTION_DEDUCTIBILITY,
  firstEligibleDate: FIRST_ELIGIBLE_DATE,
  dateBegunEverywhereTimeZone: DATE_BEGUN_EVERYWHERE_TIME_ZONE,
  dateBegunAnywhereTimeZone: DATE_BEGUN_ANYWHERE_TIME_ZONE,
  taxYearBasis: TAX_YEAR_BASIS,
  provisionalListIsNotCreditEligible: PROVISIONAL_LIST_IS_NOT_CREDIT_ELIGIBLE,
  portalRegistrationRequiredForCreditPath: PORTAL_REGISTRATION_REQUIRED_FOR_CREDIT_PATH,
  unauthorizedPublicListingHandling: UNAUTHORIZED_PUBLIC_LISTING_HANDLING,
  eligibleCurrency: ELIGIBLE_CURRENCY,
  cashPaymentMethods: CASH_PAYMENT_METHODS,
  digitalAssetPaymentMethods: DIGITAL_ASSET_PAYMENT_METHODS,
  unrecognizedPaymentMethodHandling: UNRECOGNIZED_PAYMENT_METHOD_HANDLING,
  substantialContributorAmountThresholdCents: SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS,
  substantialContributorShareThreshold: SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD,
  substantialContributorSpouseAttribution: SUBSTANTIAL_CONTRIBUTOR_SPOUSE_ATTRIBUTION,
  substantialContributorStatusTaxableYears: SUBSTANTIAL_CONTRIBUTOR_STATUS_TAXABLE_YEARS,
  claimForm: CLAIM_FORM,
  claimFormFirstFilingSeason: CLAIM_FORM_FIRST_FILING_SEASON,
  acknowledgmentDeadline: ACKNOWLEDGMENT_DEADLINE,
  irsContributionReportDeadline: IRS_CONTRIBUTION_REPORT_DEADLINE,
  stateSgoListDeadline2027: STATE_SGO_LIST_DEADLINE_2027,
  defaultFeeStructure: DEFAULT_FEE_STRUCTURE,
  feeStructuresRequiringCounselMemo: FEE_STRUCTURES_REQUIRING_COUNSEL_MEMO,
  feeBase: FEE_BASE,
  feeRounding: FEE_ROUNDING,
  defaultDesignation: DEFAULT_DESIGNATION,
  jointDefaultSplit: JOINT_DEFAULT_SPLIT,
});

export type RuleId = keyof typeof RULES;

export const RULE_IDS = Object.freeze(Object.keys(RULES)) as readonly RuleId[];

/** Looks a rule up by id with its value widened, for code that only needs the authority or the citation. */
export function getRule(id: RuleId): Rule<unknown> {
  return RULES[id];
}

/** SHA-256 over every rule's id, value, authority and citation. A test pins it to TAXMATH_VERSION. */
export function rulesFingerprint(): string {
  return sha256Hex(stableStringify(RULE_IDS.map((id) => [id, RULES[id].value, RULES[id].authority, RULES[id].citation])));
}

/* ------------------------------------------------------------------ derived dates */

function assertCalendarYear(calendarYear: number): void {
  if (!Number.isInteger(calendarYear) || calendarYear < 1000 || calendarYear > 9999) {
    throw invalid(`calendarYear must be a four-digit year, received ${String(calendarYear)}`, { fields: { calendarYear: "Enter a four-digit year." } });
  }
}

function deadlineIso(calendarYear: number, deadline: { month: number; day: number; yearsAfterContribution: number }): string {
  assertCalendarYear(calendarYear);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${calendarYear + deadline.yearsAfterContribution}-${pad(deadline.month)}-${pad(deadline.day)}`;
}

/** Date (YYYY-MM-DD) by which the SGO must furnish the acknowledgment for gifts made in `calendarYear`. */
export function acknowledgmentDueDate(calendarYear: number): string {
  return deadlineIso(calendarYear, ACKNOWLEDGMENT_DEADLINE.value);
}

/** Date (YYYY-MM-DD) by which the SGO must file its contribution report for gifts made in `calendarYear`. */
export function irsContributionReportDueDate(calendarYear: number): string {
  return deadlineIso(calendarYear, IRS_CONTRIBUTION_REPORT_DEADLINE.value);
}

/** Last tax year in which credit that arose in `originYear` can still be used. */
export function lastCarryforwardYear(originYear: number): number {
  return originYear + CARRYFORWARD_YEARS.value;
}
