/**
 * The section 25F credit computation and the data behind the tax-math panel.
 *
 * Implements the algorithm in docs/reference/donor-credit-rules.md (Engineering Implications 1), whose test
 * vectors T1 to T8 are reproduced in `credit.test.ts`:
 *
 *   per taxpayer, per tax year
 *     qualified contribution = designated cash - goods or services from the SGO            (F41, F45)
 *                              + the taxpayer's other qualified contributions that year     (F10)
 *     State credit reduction = State credit left after the non-designated cash absorbs it,
 *                              one State-credit dollar per non-designated dollar            (F23)
 *     credit                 = min(max(qualified contribution - reduction, 0), $1,700)      (F12, F13)
 *   joint return             = the same computation for each spouse, then added             (F15, F16)
 *   liability (optional)     = limit from the donor's own estimate; carryforwards oldest
 *                              first, then this year's credit; five-year life               (F30 to F34)
 *
 * Integer cents throughout; the credit computation has no division and so no rounding. Pure: the caller
 * passes the instant the preview is for. Nothing here estimates a donor's tax.
 */
import { z } from "zod";
import { invalid } from "@/lib/errors";
import {
  CARRYFORWARD_YEARS,
  CREDIT_CAP_PER_TAXPAYER_CENTS,
  DATE_BEGUN_EVERYWHERE_TIME_ZONE,
  FIRST_ELIGIBLE_DATE,
  JOINT_RETURN_MAX_CREDIT_CENTS,
  RULES,
  TAXMATH_VERSION,
  YEAR_END_NOTICE_START,
  lastCarryforwardYear,
  type RuleId,
} from "./constants";
import { COPY, COPY_VERSION, type CopyId } from "./copy";
import { formatIsoDateLong, zonedDateTime } from "./dates";
import { isBeforeCreditStart } from "./eligibility";
import { centsSchema, instantSchema, isoDateSchema, parseInput, sumCents, taxYearSchema } from "./validation";

/* ------------------------------------------------------------------ one taxpayer */

export interface StateCreditInput {
  /** State credit expected to be allowed, in cents, including any part the State would carry to another year. */
  amountCents: number;
  /** Non-designated cash given to the SGO(s) that this same State credit is also allowed for, in cents. */
  nonQualifiedBaseCents: number;
}

export interface TaxpayerCreditInput {
  /** Cash this taxpayer designates as section 25F qualified contributions for the tax year, in cents. */
  designatedCents: number;
  /** Cash given to the same SGO(s) and not designated (an ordinary gift), in cents. Default 0. */
  nonDesignatedCents?: number;
  /** Value of goods or services the SGO provides in consideration for the designated amount, in cents. Default 0. */
  goodsOrServicesValueCents?: number;
  /**
   * Qualified contributions the same taxpayer makes in the same tax year outside this gift (to any SGO,
   * already net of goods or services), in cents. They share the one annual cap. Default 0.
   */
  otherQualifiedContributionsCents?: number;
  /**
   * Simple form: one State credit, assumed to be allowed for the whole gift (designated and non-designated),
   * so the entire non-designated amount absorbs it first. Default 0. Not together with `stateCredits`.
   */
  expectedStateCreditCents?: number;
  /**
   * Detailed form: each State credit with the non-designated cash it is also allowed for. The bases may not
   * add up to more than `nonDesignatedCents` (two credits cannot absorb against the same dollars).
   */
  stateCredits?: StateCreditInput[];
}

export interface TaxpayerCredit {
  designatedCents: number;
  nonDesignatedCents: number;
  goodsOrServicesValueCents: number;
  /** This gift's designated cash less goods or services, never below zero. */
  giftQualifiedContributionCents: number;
  otherQualifiedContributionsCents: number;
  /** The taxpayer's qualified contributions for the year: this gift's plus the other ones entered. */
  qualifiedContributionCents: number;
  /** All State credit entered. */
  stateCreditCents: number;
  /** State credit soaked up by the non-designated cash (does not touch the qualified contribution). */
  stateCreditAbsorbedByNonQualifiedCents: number;
  /** State credit left after absorption; it reduces the qualified contribution. */
  stateCreditReductionCents: number;
  /** Qualified contribution that earns no credit because of the State credit. No assurance it is deductible. */
  removedByStateCreditCents: number;
  qualifiedAfterStateCreditCents: number;
  capCents: number;
  /** The section 25F credit for the year, before the tax-liability limit. */
  creditCents: number;
  /** The part of `creditCents` that this gift adds on top of what the other contributions would earn alone. */
  creditAddedByThisGiftCents: number;
  /** Qualified contribution above the cap: no credit, never carried forward; "may be deductible" under section 170 rules. */
  overCapCents: number;
  /** Qualified contribution for which no credit is allowed: `overCapCents + removedByStateCreditCents`. */
  noCreditAllowedCents: number;
  /** What the credit would be with no State credit, to show whether the State credit costs federal credit. */
  creditWithoutStateCreditCents: number;
  stateCreditReducesCredit: boolean;
  /** A State credit exceeded its non-designated base: the reduction rests on an extrapolation, show it as an estimate. */
  stateCreditSpilloverEstimated: boolean;
  /** The year's qualified contributions are above the cap (designating more cannot raise the credit for a fixed gift). */
  designatedAboveCap: boolean;
  goodsOrServicesExceedDesignated: boolean;
  rulesApplied: RuleId[];
}

const stateCreditSchema = z.strictObject({ amountCents: centsSchema, nonQualifiedBaseCents: centsSchema });

const taxpayerCreditShape = {
  designatedCents: centsSchema,
  nonDesignatedCents: centsSchema.optional(),
  goodsOrServicesValueCents: centsSchema.optional(),
  otherQualifiedContributionsCents: centsSchema.optional(),
  expectedStateCreditCents: centsSchema.optional(),
  stateCredits: z.array(stateCreditSchema).max(50, "Too many State credits").optional(),
};

const taxpayerCreditSchema = z.strictObject(taxpayerCreditShape) satisfies z.ZodType<TaxpayerCreditInput>;

function computeParsedTaxpayerCredit(input: TaxpayerCreditInput, path: string): TaxpayerCredit {
  const designatedCents = input.designatedCents;
  const nonDesignatedCents = input.nonDesignatedCents ?? 0;
  const goodsOrServicesValueCents = input.goodsOrServicesValueCents ?? 0;
  const otherQualifiedContributionsCents = input.otherQualifiedContributionsCents ?? 0;
  const field = (name: string) => (path === "" ? name : `${path}.${name}`);

  if (input.stateCredits !== undefined && input.expectedStateCreditCents !== undefined) {
    throw invalid("Give either expectedStateCreditCents or stateCredits, not both", {
      fields: { [field("stateCredits")]: "Give either one expected State credit or the detailed list, not both" },
    });
  }
  const stateCredits: StateCreditInput[] =
    input.stateCredits ?? (input.expectedStateCreditCents ? [{ amountCents: input.expectedStateCreditCents, nonQualifiedBaseCents: nonDesignatedCents }] : []);
  sumCents(field("designatedCents"), designatedCents, nonDesignatedCents);
  const totalBaseCents = sumCents(field("stateCredits"), ...stateCredits.map((credit) => credit.nonQualifiedBaseCents));
  if (totalBaseCents > nonDesignatedCents) {
    throw invalid("State credits cannot absorb against more non-designated cash than was given", {
      fields: { [field("stateCredits")]: "The non-designated amounts for the State credits add up to more than the non-designated gift" },
    });
  }

  const rules = new Set<RuleId>(["designationRequiredAtTimeOfContribution", "creditCapPerTaxpayerCents"]);
  if (goodsOrServicesValueCents > 0) rules.add("goodsOrServicesReduceQualifiedContribution");
  if (otherQualifiedContributionsCents > 0) rules.add("creditBaseIsAnnualAggregate");
  const giftQualifiedContributionCents = Math.max(0, designatedCents - goodsOrServicesValueCents);
  const qualifiedContributionCents = sumCents(field("otherQualifiedContributionsCents"), giftQualifiedContributionCents, otherQualifiedContributionsCents);

  let absorbedCents = 0;
  let reductionCents = 0;
  let spillover = false;
  for (const credit of stateCredits) {
    absorbedCents += Math.min(credit.amountCents, credit.nonQualifiedBaseCents);
    reductionCents += Math.max(0, credit.amountCents - credit.nonQualifiedBaseCents);
    if (credit.nonQualifiedBaseCents > 0 && credit.amountCents > credit.nonQualifiedBaseCents) spillover = true;
  }
  const stateCreditCents = sumCents(field("stateCredits"), ...stateCredits.map((credit) => credit.amountCents));
  if (stateCreditCents > 0) {
    rules.add("stateCreditReducesCredit");
    rules.add("stateCreditReductionBeforeCap");
    if (absorbedCents > 0) rules.add("stateCreditAbsorptionOrder");
    if (spillover) rules.add("stateCreditPartialSpillover");
  }

  const capCents = CREDIT_CAP_PER_TAXPAYER_CENTS.value;
  const qualifiedAfterStateCreditCents = Math.max(0, qualifiedContributionCents - reductionCents);
  const creditCents = Math.min(qualifiedAfterStateCreditCents, capCents);
  const creditWithoutStateCreditCents = Math.min(qualifiedContributionCents, capCents);

  return {
    designatedCents,
    nonDesignatedCents,
    goodsOrServicesValueCents,
    giftQualifiedContributionCents,
    otherQualifiedContributionsCents,
    qualifiedContributionCents,
    stateCreditCents,
    stateCreditAbsorbedByNonQualifiedCents: absorbedCents,
    stateCreditReductionCents: reductionCents,
    removedByStateCreditCents: qualifiedContributionCents - qualifiedAfterStateCreditCents,
    qualifiedAfterStateCreditCents,
    capCents,
    creditCents,
    creditAddedByThisGiftCents: Math.max(0, creditCents - Math.min(otherQualifiedContributionsCents, capCents)),
    overCapCents: qualifiedAfterStateCreditCents - creditCents,
    noCreditAllowedCents: qualifiedContributionCents - creditCents,
    creditWithoutStateCreditCents,
    stateCreditReducesCredit: creditCents < creditWithoutStateCreditCents,
    stateCreditSpilloverEstimated: spillover,
    designatedAboveCap: qualifiedContributionCents > capCents,
    goodsOrServicesExceedDesignated: goodsOrServicesValueCents > designatedCents,
    rulesApplied: [...rules],
  };
}

/** The section 25F credit of one taxpayer for one tax year, before the tax-liability limit. */
export function computeTaxpayerCredit(input: TaxpayerCreditInput): TaxpayerCredit {
  return computeParsedTaxpayerCredit(parseInput(taxpayerCreditSchema, input, "credit input"), "");
}

/* ------------------------------------------------------------------ liability limit and carryforward */

export interface CarryforwardBucketInput {
  /** Tax year in which the unused credit arose. */
  originYear: number;
  amountCents: number;
}

export interface LiabilityLimitInput {
  taxYear: number;
  /** This year's section 25F credit (for a joint return, both spouses' credits added). */
  currentYearCreditCents: number;
  /** The donor's OWN estimate of federal income tax for the year before the credits below, in cents. */
  estimatedTaxCents: number;
  /** The donor's own estimate of credits under sections 21, 22, 24, 25, 25A, 25B, 25C and 25E, in cents. Default 0. */
  otherCreditsCents?: number;
  /** Unused section 25F credit from earlier years, one bucket per origin year. */
  carryforwards?: CarryforwardBucketInput[];
}

export interface CarryforwardBucket {
  originYear: number;
  amountCents: number;
  /** Last tax year in which this bucket can be used (origin year + 5). */
  lastUsableTaxYear: number;
  /** True when the bucket is more than five tax years old and cannot be used at all. */
  expired: boolean;
  usedCents: number;
  /** Unexpired and not used this year. */
  unusedCents: number;
  /** Part of `unusedCents` that is still usable next year. */
  carriedToNextYearCents: number;
  /** Part of `unusedCents` that expires because this was its last usable year. */
  expiresUnusedCents: number;
}

export interface LiabilityLimit {
  taxYear: number;
  estimatedTaxCents: number;
  otherCreditsCents: number;
  /** max(0, estimated tax - other credits): the most section 25F credit usable this year. */
  limitCents: number;
  buckets: CarryforwardBucket[];
  expiredCarryforwardCents: number;
  availableCarryforwardCents: number;
  carryforwardUsedCents: number;
  currentYearCreditCents: number;
  currentYearCreditUsedCents: number;
  /** This year's credit not used this year: the new carryforward bucket (treated as allowed, so not deductible). */
  newCarryforwardCents: number;
  totalCreditUsedCents: number;
  /** Carried-forward credit in its last usable year that goes unused. */
  expiringUnusedCents: number;
  /** Per origin year, what is left to use next year, oldest first (includes this year's new bucket). */
  carriedToNextYear: CarryforwardBucketInput[];
  totalCarriedToNextYearCents: number;
  /** True when the limit left some available credit unused this year. */
  limitedByLiability: boolean;
}

const carryforwardBucketSchema = z.strictObject({ originYear: taxYearSchema, amountCents: centsSchema });

const liabilityShape = {
  estimatedTaxCents: centsSchema,
  otherCreditsCents: centsSchema.optional(),
  carryforwards: z.array(carryforwardBucketSchema).max(50, "Too many carryforward years").optional(),
};

const liabilityLimitSchema = z.strictObject({
  taxYear: taxYearSchema,
  currentYearCreditCents: centsSchema,
  ...liabilityShape,
}) satisfies z.ZodType<LiabilityLimitInput>;

function applyParsedLiabilityLimit(input: LiabilityLimitInput, path: string): LiabilityLimit {
  const field = (name: string) => (path === "" ? name : `${path}.${name}`);
  const maxPerYearCents = JOINT_RETURN_MAX_CREDIT_CENTS.value;
  if (input.currentYearCreditCents > maxPerYearCents) {
    throw invalid("This year's credit cannot exceed the per-taxpayer limit for each of two spouses", {
      fields: { currentYearCreditCents: "More than the largest credit a return can generate in one year" },
    });
  }
  const seen = new Set<number>();
  const sorted = [...(input.carryforwards ?? [])].sort((a, b) => a.originYear - b.originYear);
  sorted.forEach((bucket) => {
    const where = field("carryforwards");
    if (bucket.originYear >= input.taxYear) {
      throw invalid("A carryforward must come from a tax year before the current one", { fields: { [where]: `Origin year ${bucket.originYear} is not before ${input.taxYear}` } });
    }
    if (seen.has(bucket.originYear)) {
      throw invalid("Give one carryforward amount per origin year", { fields: { [where]: `Origin year ${bucket.originYear} appears more than once` } });
    }
    seen.add(bucket.originYear);
    // The cap limits the credit generated per taxpayer per year, so no year can leave more than two spouses' caps behind.
    if (bucket.amountCents > maxPerYearCents) {
      throw invalid("A carryforward from one year cannot exceed the credit that year could generate", {
        fields: { [where]: `The amount for ${bucket.originYear} is more than the largest credit a return can generate in one year` },
      });
    }
  });

  const otherCreditsCents = input.otherCreditsCents ?? 0;
  const limitCents = Math.max(0, input.estimatedTaxCents - otherCreditsCents);
  let remainingLimitCents = limitCents;

  const buckets: CarryforwardBucket[] = sorted.map((bucket) => {
    const lastUsableTaxYear = lastCarryforwardYear(bucket.originYear);
    const expired = input.taxYear > lastUsableTaxYear;
    const usedCents = expired ? 0 : Math.min(bucket.amountCents, remainingLimitCents);
    remainingLimitCents -= usedCents;
    const unusedCents = expired ? 0 : bucket.amountCents - usedCents;
    const usableNextYear = !expired && input.taxYear + 1 <= lastUsableTaxYear;
    return {
      originYear: bucket.originYear,
      amountCents: bucket.amountCents,
      lastUsableTaxYear,
      expired,
      usedCents,
      unusedCents,
      carriedToNextYearCents: usableNextYear ? unusedCents : 0,
      expiresUnusedCents: usableNextYear ? 0 : unusedCents,
    };
  });

  // Carryforwards are used before the credit that arose this year (Prop. Treas. Reg. 1.25F-2(e)(3)).
  const currentYearCreditUsedCents = Math.min(input.currentYearCreditCents, remainingLimitCents);
  const newCarryforwardCents = input.currentYearCreditCents - currentYearCreditUsedCents;
  const total = (pick: (bucket: CarryforwardBucket) => number) => buckets.reduce((sum, bucket) => sum + pick(bucket), 0);
  const carryforwardUsedCents = total((bucket) => bucket.usedCents);
  const availableCarryforwardCents = total((bucket) => (bucket.expired ? 0 : bucket.amountCents));

  const carriedToNextYear: CarryforwardBucketInput[] = buckets
    .filter((bucket) => bucket.carriedToNextYearCents > 0)
    .map((bucket) => ({ originYear: bucket.originYear, amountCents: bucket.carriedToNextYearCents }));
  if (newCarryforwardCents > 0) carriedToNextYear.push({ originYear: input.taxYear, amountCents: newCarryforwardCents });

  return {
    taxYear: input.taxYear,
    estimatedTaxCents: input.estimatedTaxCents,
    otherCreditsCents,
    limitCents,
    buckets,
    expiredCarryforwardCents: total((bucket) => (bucket.expired ? bucket.amountCents : 0)),
    availableCarryforwardCents,
    carryforwardUsedCents,
    currentYearCreditCents: input.currentYearCreditCents,
    currentYearCreditUsedCents,
    newCarryforwardCents,
    totalCreditUsedCents: carryforwardUsedCents + currentYearCreditUsedCents,
    expiringUnusedCents: total((bucket) => bucket.expiresUnusedCents),
    carriedToNextYear,
    totalCarriedToNextYearCents: carriedToNextYear.reduce((sum, bucket) => sum + bucket.amountCents, 0),
    limitedByLiability: availableCarryforwardCents + input.currentYearCreditCents > limitCents,
  };
}

/**
 * Applies a donor-supplied tax-liability limit: expired buckets dropped, carryforwards used oldest first,
 * then this year's credit, and whatever is left of this year's credit becomes the new bucket.
 * `carriedToNextYear` can be fed straight back in as next year's `carryforwards`.
 */
export function applyLiabilityLimit(input: LiabilityLimitInput): LiabilityLimit {
  return applyParsedLiabilityLimit(parseInput(liabilityLimitSchema, input, "liability input"), "");
}

/* ------------------------------------------------------------------ the panel preview */

export const FILING_STATUSES = ["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export const TAXPAYER_ROLES = ["individual", "spouse_1", "spouse_2"] as const;
export type TaxpayerRole = (typeof TAXPAYER_ROLES)[number];

export interface TaxpayerPreviewInput extends TaxpayerCreditInput {
  /** Defaults to "individual", or "spouse_1" then "spouse_2" on a joint return. */
  role?: TaxpayerRole;
  /** Display name for the panel heading (for example the spouse's first name). */
  label?: string | null;
}

export interface LiabilityPreviewInput {
  /** The donor's OWN estimate of federal income tax for the year before the credits below, in cents. */
  estimatedTaxCents: number;
  /** The donor's own estimate of credits under sections 21, 22, 24, 25, 25A, 25B, 25C and 25E, in cents. */
  otherCreditsCents?: number;
  carryforwards?: CarryforwardBucketInput[];
}

export interface CreditPreviewInput {
  filingStatus: FilingStatus;
  /** One taxpayer, or one or two spouses on a joint return. Each spouse's own contribution, never a combined total. */
  taxpayers: TaxpayerPreviewInput[];
  /** The instant the gift would be made (the caller's clock). Decides the before-credit-start caveat. */
  asOf: Date;
  /** First credit-eligible date, YYYY-MM-DD. Defaults to FIRST_ELIGIBLE_DATE. */
  creditStartDate?: string | null;
  /** Only when the donor typed in their own estimate. Requires `taxYear`. */
  liability?: LiabilityPreviewInput | null;
  /** The tax year the gift belongs to; required with `liability`. */
  taxYear?: number | null;
  /** A separate donor-paid service fee shown next to the gift, in cents. It never enters the credit. */
  donorServiceFeeCents?: number | null;
}

export type PreviewLineId =
  | "designated"
  | "goods_or_services"
  | "other_qualified_contributions"
  | "qualified_contribution"
  | "state_credit_reduction"
  | "over_cap"
  | "estimated_credit"
  | "credit_added_by_this_gift"
  | "non_designated"
  | "state_credit_absorbed"
  | "joint_total_credit"
  | "liability_limit"
  | "carryforward_available"
  | "carryforward_expired"
  | "carryforward_used"
  | "current_year_credit_used"
  | "total_credit_used"
  | "new_carryforward"
  | "expiring_unused"
  | "carried_to_next_year";

/**
 * amount: a starting figure; addition and subtraction: applied to the running figure; subtotal: the running
 * figure so far; result: the computed credit; information: shown beside the sum, not part of it.
 */
export type PreviewLineRole = "amount" | "addition" | "subtraction" | "subtotal" | "result" | "information";

export interface PreviewLine {
  id: PreviewLineId;
  /** Label in the copy registry (`renderCopyDynamic(copyId)`). */
  copyId: CopyId;
  amountCents: number;
  role: PreviewLineRole;
}

export interface PreviewNote {
  /** The caveat's id in the copy registry. */
  id: CopyId;
  /** Variables to pass to `renderCopyDynamic(id, vars)`. */
  vars: Record<string, string>;
}

export interface TaxpayerPreview extends TaxpayerCredit {
  role: TaxpayerRole;
  label: string | null;
  headingCopyId: CopyId;
  lines: PreviewLine[];
}

export interface CreditPreviewTotals {
  designatedCents: number;
  nonDesignatedCents: number;
  /** Designated plus non-designated cash. */
  giftCents: number;
  goodsOrServicesValueCents: number;
  otherQualifiedContributionsCents: number;
  /** Qualified contributions for the year: this gift's plus the other ones entered. */
  qualifiedContributionCents: number;
  stateCreditCents: number;
  removedByStateCreditCents: number;
  overCapCents: number;
  noCreditAllowedCents: number;
  /** Sum of the taxpayers' credits for the year, before the tax-liability limit. */
  creditCents: number;
  /** The part of `creditCents` added by this gift. */
  creditAddedByThisGiftCents: number;
  /** The cap times the number of taxpayers who make a qualified contribution (at least one). */
  applicableCapCents: number;
  /** Federal credit plus State credit entered, before any liability limit. */
  combinedFederalAndStateCreditCents: number;
  donorServiceFeeCents: number;
}

export interface CreditPreviewFlags {
  jointReturn: boolean;
  /** A joint return on which exactly one spouse makes a qualified contribution: one cap, not two. */
  oneSpouseOnly: boolean;
  overCapDesignation: boolean;
  stateCreditEntered: boolean;
  stateCreditReducesFederal: boolean;
  stateCreditSpilloverEstimated: boolean;
  goodsOrServicesReduceContribution: boolean;
  otherContributionsEntered: boolean;
  beforeCreditStart: boolean;
  /** The gift would be made in the last days of a year, when the unsettled "when is a gift made" question matters. */
  nearYearEnd: boolean;
  liabilityProvided: boolean;
  creditLimitedByLiability: boolean;
  carryforwardExpired: boolean;
  donorServiceFee: boolean;
  /** A rule that exists only in the proposed regulations changed or produced a figure in this preview. */
  proposedRulesAffectNumbers: boolean;
}

export interface CreditPreview {
  taxmathVersion: string;
  copyVersion: string;
  /** "illustration_before_credit_start": a gift made at `asOf` would not earn the credit; figures are illustrative. */
  status: "preview" | "illustration_before_credit_start";
  filingStatus: FilingStatus;
  taxYear: number | null;
  taxpayers: TaxpayerPreview[];
  totals: CreditPreviewTotals;
  /** Lines for the whole return (present on a joint return). */
  totalLines: PreviewLine[];
  liability: (LiabilityLimit & { lines: PreviewLine[] }) | null;
  /** The caveats that apply, in display order. */
  notes: PreviewNote[];
  /** `notes.map((note) => note.id)`. */
  noteIds: CopyId[];
  flags: CreditPreviewFlags;
  /** Every rule in `RULES` that entered the computation. */
  rulesApplied: RuleId[];
}

const creditPreviewSchema = z.strictObject({
  filingStatus: z.enum(FILING_STATUSES, "Must be a filing status"),
  taxpayers: z
    .array(
      z.strictObject({
        ...taxpayerCreditShape,
        role: z.enum(TAXPAYER_ROLES, "Must be individual, spouse_1 or spouse_2").optional(),
        label: z.string("Must be text").trim().min(1, "Must not be empty").max(120, "Too long").nullish(),
      }),
    )
    .min(1, "At least one taxpayer is required")
    .max(2, "A return has at most two taxpayers"),
  asOf: instantSchema,
  creditStartDate: isoDateSchema.nullish(),
  liability: z.strictObject(liabilityShape).nullish(),
  taxYear: taxYearSchema.nullish(),
  donorServiceFeeCents: centsSchema.nullish(),
}) satisfies z.ZodType<CreditPreviewInput>;

const HEADING_BY_ROLE: Readonly<Record<TaxpayerRole, CopyId>> = {
  individual: "panel.heading.individual",
  spouse_1: "panel.heading.spouse_1",
  spouse_2: "panel.heading.spouse_2",
};

const LINE_COPY: Readonly<Record<PreviewLineId, CopyId>> = {
  designated: "line.designated",
  goods_or_services: "line.goods_or_services",
  other_qualified_contributions: "line.other_qualified_contributions",
  qualified_contribution: "line.qualified_contribution",
  state_credit_reduction: "line.state_credit_reduction",
  over_cap: "line.over_cap",
  estimated_credit: "line.estimated_credit",
  credit_added_by_this_gift: "line.credit_added_by_this_gift",
  non_designated: "line.non_designated",
  state_credit_absorbed: "line.state_credit_absorbed",
  joint_total_credit: "line.joint_total_credit",
  liability_limit: "line.liability_limit",
  carryforward_available: "line.carryforward_available",
  carryforward_expired: "line.carryforward_expired",
  carryforward_used: "line.carryforward_used",
  current_year_credit_used: "line.current_year_credit_used",
  total_credit_used: "line.total_credit_used",
  new_carryforward: "line.new_carryforward",
  expiring_unused: "line.expiring_unused",
  carried_to_next_year: "line.carried_to_next_year",
};

const line = (id: PreviewLineId, amountCents: number, role: PreviewLineRole): PreviewLine => ({ id, copyId: LINE_COPY[id], amountCents, role });

function taxpayerLines(credit: TaxpayerCredit): PreviewLine[] {
  const lines: PreviewLine[] = [line("designated", credit.designatedCents, "amount")];
  // Shown as designated - min(goods or services, designated) so the lines always add up, even when the value exceeds the gift.
  const goodsOrServicesTakenOffCents = credit.designatedCents - credit.giftQualifiedContributionCents;
  if (credit.goodsOrServicesValueCents > 0) lines.push(line("goods_or_services", goodsOrServicesTakenOffCents, "subtraction"));
  if (credit.otherQualifiedContributionsCents > 0) lines.push(line("other_qualified_contributions", credit.otherQualifiedContributionsCents, "addition"));
  if (credit.goodsOrServicesValueCents > 0 || credit.otherQualifiedContributionsCents > 0) {
    lines.push(line("qualified_contribution", credit.qualifiedContributionCents, "subtotal"));
  }
  if (credit.stateCreditCents > 0) lines.push(line("state_credit_reduction", credit.removedByStateCreditCents, "subtraction"));
  if (credit.overCapCents > 0) lines.push(line("over_cap", credit.overCapCents, "subtraction"));
  lines.push(line("estimated_credit", credit.creditCents, "result"));
  if (credit.otherQualifiedContributionsCents > 0) lines.push(line("credit_added_by_this_gift", credit.creditAddedByThisGiftCents, "information"));
  if (credit.nonDesignatedCents > 0) lines.push(line("non_designated", credit.nonDesignatedCents, "information"));
  if (credit.stateCreditAbsorbedByNonQualifiedCents > 0) {
    lines.push(line("state_credit_absorbed", credit.stateCreditAbsorbedByNonQualifiedCents, "information"));
  }
  return lines;
}

function liabilityLines(liability: LiabilityLimit): PreviewLine[] {
  const lines: PreviewLine[] = [line("liability_limit", liability.limitCents, "amount")];
  if (liability.expiredCarryforwardCents > 0) lines.push(line("carryforward_expired", liability.expiredCarryforwardCents, "information"));
  if (liability.availableCarryforwardCents > 0) {
    lines.push(line("carryforward_available", liability.availableCarryforwardCents, "information"));
    lines.push(line("carryforward_used", liability.carryforwardUsedCents, "amount"));
  }
  lines.push(line("current_year_credit_used", liability.currentYearCreditUsedCents, "amount"));
  lines.push(line("total_credit_used", liability.totalCreditUsedCents, "result"));
  if (liability.newCarryforwardCents > 0) lines.push(line("new_carryforward", liability.newCarryforwardCents, "information"));
  if (liability.expiringUnusedCents > 0) lines.push(line("expiring_unused", liability.expiringUnusedCents, "information"));
  if (liability.totalCarriedToNextYearCents > 0) lines.push(line("carried_to_next_year", liability.totalCarriedToNextYearCents, "information"));
  return lines;
}

function resolveRoles(filingStatus: FilingStatus, taxpayers: readonly TaxpayerPreviewInput[]): TaxpayerRole[] {
  const joint = filingStatus === "married_joint";
  if (!joint && taxpayers.length > 1) {
    throw invalid("Only a joint return has two taxpayers", { fields: { taxpayers: "Enter one taxpayer unless the filing status is married filing jointly" } });
  }
  const roles = taxpayers.map((taxpayer, index): TaxpayerRole => taxpayer.role ?? (joint ? (index === 0 ? "spouse_1" : "spouse_2") : "individual"));
  roles.forEach((role, index) => {
    if (joint === (role === "individual")) {
      throw invalid("The taxpayer role does not match the filing status", {
        fields: { [`taxpayers.${index}.role`]: joint ? "Use spouse_1 or spouse_2 on a joint return" : "Use individual unless the return is joint" },
      });
    }
  });
  if (roles.length === 2 && roles[0] === roles[1]) {
    throw invalid("Each spouse needs their own entry", { fields: { "taxpayers.1.role": "Both entries have the same role" } });
  }
  return roles;
}

/**
 * Everything the tax-math panel shows for a gift: a breakdown per taxpayer, totals, the optional liability
 * section, the caveats that apply (as copy ids, in order) and flags. A preview, not tax advice: the
 * `note.preview_not_tax_advice` note is always present, and `note.proposed_rules_not_final` is present
 * whenever a proposed-regulation rule or sentence is part of the output.
 */
export function previewCredit(input: CreditPreviewInput): CreditPreview {
  const parsed = parseInput(creditPreviewSchema, input, "credit preview input");
  const joint = parsed.filingStatus === "married_joint";
  const roles = resolveRoles(parsed.filingStatus, parsed.taxpayers);
  if (parsed.liability && (parsed.taxYear === null || parsed.taxYear === undefined)) {
    throw invalid("taxYear is required with a liability estimate", { fields: { taxYear: "Enter the tax year the estimate is for" } });
  }

  const rules = new Set<RuleId>();
  const taxpayers: TaxpayerPreview[] = parsed.taxpayers.map((taxpayer, index) => {
    const credit = computeParsedTaxpayerCredit(
      {
        designatedCents: taxpayer.designatedCents,
        nonDesignatedCents: taxpayer.nonDesignatedCents,
        goodsOrServicesValueCents: taxpayer.goodsOrServicesValueCents,
        otherQualifiedContributionsCents: taxpayer.otherQualifiedContributionsCents,
        expectedStateCreditCents: taxpayer.expectedStateCreditCents,
        stateCredits: taxpayer.stateCredits,
      },
      `taxpayers.${index}`,
    );
    credit.rulesApplied.forEach((id) => rules.add(id));
    return { ...credit, role: roles[index], label: taxpayer.label ?? null, headingCopyId: HEADING_BY_ROLE[roles[index]], lines: taxpayerLines(credit) };
  });

  const sum = (pick: (taxpayer: TaxpayerPreview) => number) => sumCents("taxpayers", ...taxpayers.map(pick));
  const contributing = taxpayers.filter((taxpayer) => taxpayer.qualifiedContributionCents > 0).length;
  const donorServiceFeeCents = parsed.donorServiceFeeCents ?? 0;
  const totals: CreditPreviewTotals = {
    designatedCents: sum((t) => t.designatedCents),
    nonDesignatedCents: sum((t) => t.nonDesignatedCents),
    giftCents: sum((t) => t.designatedCents + t.nonDesignatedCents),
    goodsOrServicesValueCents: sum((t) => t.goodsOrServicesValueCents),
    otherQualifiedContributionsCents: sum((t) => t.otherQualifiedContributionsCents),
    qualifiedContributionCents: sum((t) => t.qualifiedContributionCents),
    stateCreditCents: sum((t) => t.stateCreditCents),
    removedByStateCreditCents: sum((t) => t.removedByStateCreditCents),
    overCapCents: sum((t) => t.overCapCents),
    noCreditAllowedCents: sum((t) => t.noCreditAllowedCents),
    // Per spouse, then added. Never min(couple total, 2 x cap): one spouse's gift cannot use the other's cap.
    creditCents: sum((t) => t.creditCents),
    creditAddedByThisGiftCents: sum((t) => t.creditAddedByThisGiftCents),
    applicableCapCents: CREDIT_CAP_PER_TAXPAYER_CENTS.value * Math.max(1, contributing),
    combinedFederalAndStateCreditCents: sum((t) => t.creditCents + t.stateCreditCents),
    donorServiceFeeCents,
  };

  const stateCreditEntered = totals.stateCreditCents > 0;
  if (joint) {
    rules.add("jointReturnSpousesAreSeparateTaxpayers");
    if (stateCreditEntered) rules.add("jointStateCreditAllocation");
  }

  let liability: CreditPreview["liability"] = null;
  if (parsed.liability) {
    const result = applyParsedLiabilityLimit({ ...parsed.liability, taxYear: parsed.taxYear as number, currentYearCreditCents: totals.creditCents }, "liability");
    liability = { ...result, lines: liabilityLines(result) };
    rules.add("creditIsNonrefundable");
    rules.add("liabilityEstimateSource");
    rules.add("liabilityLimitOtherCreditSections");
    rules.add("capLimitsCreditGeneratedNotCreditUsed");
    if (result.buckets.length > 0) {
      rules.add("carryforwardYears");
      rules.add("carryforwardUseOrder");
      rules.add("carryforwardUsedBeforeCurrentYearCredit");
    }
    if (joint) {
      rules.add("jointReturnCombinedLiabilityLimit");
      if (result.buckets.length > 0 || result.newCarryforwardCents > 0) rules.add("jointCarryforwardTracking");
    }
  }

  const creditStartDate = parsed.creditStartDate ?? FIRST_ELIGIBLE_DATE.value;
  const beforeCreditStart = isBeforeCreditStart(parsed.asOf, creditStartDate);
  // December is over last in the last State time zone, so that zone's calendar decides how long the notice shows.
  const lastZoneDate = zonedDateTime(parsed.asOf, DATE_BEGUN_EVERYWHERE_TIME_ZONE.value);
  const nearYearEnd = !beforeCreditStart && lastZoneDate.month === YEAR_END_NOTICE_START.value.month && lastZoneDate.day >= YEAR_END_NOTICE_START.value.day;
  const oneSpouseOnly = joint && contributing === 1;
  const usesSimpleStateCreditForm = parsed.taxpayers.some((t) => (t.expectedStateCreditCents ?? 0) > 0 && (t.nonDesignatedCents ?? 0) > 0);
  const rulesApplied = [...rules];
  const flags: CreditPreviewFlags = {
    jointReturn: joint,
    oneSpouseOnly,
    overCapDesignation: taxpayers.some((t) => t.designatedAboveCap),
    stateCreditEntered,
    stateCreditReducesFederal: taxpayers.some((t) => t.stateCreditReducesCredit),
    stateCreditSpilloverEstimated: taxpayers.some((t) => t.stateCreditSpilloverEstimated),
    goodsOrServicesReduceContribution: totals.goodsOrServicesValueCents > 0,
    otherContributionsEntered: totals.otherQualifiedContributionsCents > 0,
    beforeCreditStart,
    nearYearEnd,
    liabilityProvided: liability !== null,
    creditLimitedByLiability: liability?.limitedByLiability ?? false,
    carryforwardExpired: (liability?.expiredCarryforwardCents ?? 0) > 0,
    donorServiceFee: donorServiceFeeCents > 0,
    proposedRulesAffectNumbers: rulesApplied.some((id) => RULES[id].authority === "proposed_reg"),
  };

  const notes: PreviewNote[] = [];
  const note = (id: CopyId, vars: Record<string, string> = {}) => notes.push({ id, vars });
  if (beforeCreditStart) note("note.before_credit_start", { creditStartDate: formatIsoDateLong(creditStartDate) });
  note("note.preview_not_tax_advice");
  if (nearYearEnd) note("note.year_end_timing");
  note("note.cap_per_taxpayer");
  note("note.cap_is_annual_total");
  if (joint) note("note.joint_each_spouse");
  if (oneSpouseOnly) note("note.one_spouse_only");
  if (flags.overCapDesignation) note("note.over_cap_designation");
  if (flags.goodsOrServicesReduceContribution) note("note.goods_or_services");
  note("note.state_credit_reduction");
  if (stateCreditEntered) {
    note("note.state_credit_ordering");
    if (usesSimpleStateCreditForm) note("note.state_credit_assumed_whole_gift");
    if (flags.stateCreditSpilloverEstimated) note("note.state_credit_spillover_estimate");
    if (totals.removedByStateCreditCents > 0) note("note.state_credit_offset_not_deductible_here");
  }
  // With the detailed State-credit list the caller has said which credits apply to which gifts, so nothing is assumed.
  if (parsed.taxpayers.some((t) => (t.otherQualifiedContributionsCents ?? 0) > 0 && t.stateCredits === undefined)) {
    note("note.other_contributions_assumed_no_state_credit");
  }
  note("note.nonrefundable");
  note("note.liability_limit");
  note("note.carryforward");
  if (liability) {
    note("note.liability_estimate_basis");
    if (joint) note("note.joint_combined_limit");
    if (liability.availableCarryforwardCents > 0) note("note.carryforward_before_current");
    if (joint && (liability.buckets.length > 0 || liability.newCarryforwardCents > 0)) note("note.joint_carryforward_pool");
    if (liability.expiredCarryforwardCents > 0) note("note.carryforward_expired");
    if (liability.expiringUnusedCents > 0) note("note.carryforward_expiring");
  } else {
    note("note.liability_not_estimated");
  }
  note("note.section_170_no_double_benefit");
  note("note.carried_forward_not_deductible");
  note("note.excess_may_be_deductible");
  if (flags.donorServiceFee) note("note.fee_not_part_of_contribution");
  note("note.what_to_keep");
  note("note.claim_form");
  note("note.claim_form_availability");

  const totalLines: PreviewLine[] = joint ? [line("joint_total_credit", totals.creditCents, "result")] : [];

  // The "not final" caveat goes on whenever anything proposed-only is in the output: a rule that shaped a
  // figure, or a line or note whose wording comes from the proposed regulations.
  const shownCopyIds = [...notes.map((n) => n.id), ...taxpayers.flatMap((t) => t.lines.map((l) => l.copyId)), ...totalLines.map((l) => l.copyId), ...(liability?.lines ?? []).map((l) => l.copyId)];
  if (flags.proposedRulesAffectNumbers || shownCopyIds.some((id) => COPY[id].authority === "proposed_reg")) {
    const afterPreviewLabel = notes.findIndex((n) => n.id === "note.preview_not_tax_advice") + 1;
    notes.splice(afterPreviewLabel, 0, { id: "note.proposed_rules_not_final", vars: {} });
  }

  return {
    taxmathVersion: TAXMATH_VERSION,
    copyVersion: COPY_VERSION,
    status: beforeCreditStart ? "illustration_before_credit_start" : "preview",
    filingStatus: parsed.filingStatus,
    taxYear: parsed.taxYear ?? null,
    taxpayers,
    totals,
    totalLines,
    liability,
    notes,
    noteIds: notes.map((n) => n.id),
    flags,
    rulesApplied,
  };
}

/* ------------------------------------------------------------------ pre-fill helper */

export interface SuggestDesignationInput {
  giftCents: number;
  filingStatus: FilingStatus;
  /** On a joint return: false when only one spouse is giving. Default true. */
  bothSpousesContribute?: boolean;
  /**
   * Qualified contributions each taxpayer has already made this tax year, in the order of the result
   * (the individual, or first spouse then second spouse). They use up the cap first. Default 0 each.
   */
  otherQualifiedContributionsCents?: number[];
}

export interface SuggestedDesignation {
  role: TaxpayerRole;
  /** This taxpayer's share of the gift. */
  giftCents: number;
  /** Pre-filled designated amount: the lesser of the share and what is left of the per-taxpayer cap. */
  designatedCents: number;
  nonDesignatedCents: number;
}

const suggestionSchema = z.strictObject({
  giftCents: centsSchema,
  filingStatus: z.enum(FILING_STATUSES, "Must be a filing status"),
  bothSpousesContribute: z.boolean("Must be true or false").optional(),
  otherQualifiedContributionsCents: z.array(centsSchema).max(2, "At most one amount per taxpayer").optional(),
}) satisfies z.ZodType<SuggestDesignationInput>;

/**
 * A starting point for the designation fields, which the donor must confirm or change (product policy, not
 * a rule): min(share of the gift, what is left of $1,700) per taxpayer, with a joint gift split evenly when
 * both spouses contribute (the odd cent goes to the first spouse).
 */
export function suggestDesignation(input: SuggestDesignationInput): SuggestedDesignation[] {
  const parsed = parseInput(suggestionSchema, input, "designation input");
  const cap = CREDIT_CAP_PER_TAXPAYER_CENTS.value;
  const suggestion = (role: TaxpayerRole, giftCents: number, index: number): SuggestedDesignation => {
    const capLeftCents = Math.max(0, cap - (parsed.otherQualifiedContributionsCents?.[index] ?? 0));
    const designatedCents = Math.min(giftCents, capLeftCents);
    return { role, giftCents, designatedCents, nonDesignatedCents: giftCents - designatedCents };
  };
  if (parsed.filingStatus !== "married_joint") return [suggestion("individual", parsed.giftCents, 0)];
  if (parsed.bothSpousesContribute === false) return [suggestion("spouse_1", parsed.giftCents, 0)];
  const secondShare = Math.floor(parsed.giftCents / 2);
  return [suggestion("spouse_1", parsed.giftCents - secondShare, 0), suggestion("spouse_2", secondShare, 1)];
}

/** Tax years in which unused credit that arose in `originYear` can be used: the five years after it. */
export function carryforwardWindow(originYear: number): { firstUsableTaxYear: number; lastUsableTaxYear: number } {
  const year = parseInput(taxYearSchema, originYear, "origin year");
  return { firstUsableTaxYear: year + 1, lastUsableTaxYear: year + CARRYFORWARD_YEARS.value };
}
