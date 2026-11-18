/**
 * Input and output of the decision service.
 *
 * A `Decision` is plain data (strings, safe integers, booleans, null, arrays, objects): it is stored as
 * JSON in `verifications.decision`, shown by the dashboard and summarized in the evidence pack.
 */
import type { AmiTable, ThresholdResult, ThresholdSource } from "@/engine/ami";
import type {
  CoverageAssessment,
  HouseholdIncomeResult,
  HouseholdMemberInput,
  IncomeCertification,
  IncomeDocumentSource,
  IncomeFlagCode,
  IncomeItemInput,
  IncomeReviewFlag,
  IsoDate,
  MissingItem,
} from "@/engine/income";
import { INCOME_FLAG_CODES } from "@/engine/income";
import type { DecisionPolicy } from "./policy";
import type { ThresholdBounds, ThresholdBoundsInput } from "./threshold-bounds";

/* ---------------------------------------------------------------------------------------- input */

/** The SGO's income policy (`sgo_profiles.income_cap_pct`, `sgo_profiles.review_band_bps`). */
export interface SgoPolicyInput {
  /** Percent of area median gross income the SGO awards up to. A whole percent from 1 to 300. */
  capPct: number;
  /** While the limit is provisional, income within this many basis points of it goes to a person. 0 turns the band off. */
  reviewBandBps: number;
}

/**
 * Shared-custody facts. The same shape as `CustodyInfo` in src/db/schema/verification.ts (mirrored here
 * because the engine does not import the database layer).
 */
export interface CustodyInfo {
  livesInMultipleHouseholds: boolean;
  /** Months of the income year the student lived in THIS household (0 to 12), when known. */
  monthsInThisHousehold?: number | null;
  equalTime?: boolean | null;
  /** Only relevant when time is equal: is this the household with the higher income? */
  thisHouseholdHasHigherIncome?: "yes" | "no" | "unknown" | null;
  notes?: string | null;
}

export interface DecisionHouseholdInput {
  /** Family size the household stated: everyone residing with the student, the student included. Null when not given yet. */
  size: number | null;
  /** 5-digit county FIPS code of the residence. Null when not resolved yet. */
  countyFips: string | null;
  /** The roster. `size` must equal its length. */
  members: HouseholdMemberInput[];
  /** Null when the shared-custody question has not been answered. */
  custody: CustodyInfo | null;
}

/** The closed program list of the proposed categorical method. */
export const CATEGORICAL_PROGRAMS = ["SNAP", "TANF", "WIC", "SECTION_8", "SSI"] as const;
export type CategoricalProgram = (typeof CATEGORICAL_PROGRAMS)[number];

export type AwardLetterApprovalStatus = "approved" | "denied" | "terminated" | "pending" | "unclear";

/** What was read from one uploaded benefits document. */
export interface AwardLetterInput {
  documentId: string;
  /**
   * The program the document is about. One of `CATEGORICAL_PROGRAMS`; a known program that does not qualify
   * (`MEDICAID`, `CHIP`, `SSDI`, `RSDI`, `SCHOOL_MEALS`, `OTHER`); or `UNKNOWN` when it could not be read.
   * Case and punctuation are ignored. Any other text is treated as not recognized and goes to a person.
   */
  program: string;
  /** Date printed on the document; null when it could not be read. */
  letterDate: IsoDate | null;
  approvalStatus: AwardLetterApprovalStatus;
  recipientName: string | null;
  /** Household member the recipient was matched to; null when no match was made. */
  matchedMemberId: string | null;
  /** Confidence of that match, 0 to 1. */
  nameMatchConfidence: number;
  /** Lowest confidence among the fields above, 0 to 1. */
  extractionConfidence: number;
  extractedBy: "parser" | "model" | "reviewer";
  /** End of the certification or benefit period printed on the document, when one was read. */
  benefitPeriodEnd?: IsoDate | null;
}

export interface DirectEvidenceInput {
  /** The calendar year the evidence was assembled for. It is used only when it is the statutory income year. */
  incomeYear: number;
  items: IncomeItemInput[];
  /** Signed zero-income and no-other-income statements. */
  certifications?: IncomeCertification[];
  /** How each document behind `items` was read. An item whose document is not listed is not trusted. */
  sources?: IncomeDocumentSource[];
  /** Flags raised while turning documents into items (`reconcileIncomeEvidence(...).flags`). */
  evidenceFlags?: IncomeReviewFlag[];
}

/** Summary of one data-rail report behind `rail` income items. */
export interface RailReportSummary {
  railConnectionId: string;
  provider: string;
  kind: "payroll" | "bank" | "transcript";
  /**
   * What the amounts are. `bank_net_deposits` is money after taxes and deductions, which is not household
   * income, so items resting on it always go to a person.
   */
  dataBasis: "payroll_gross" | "bank_net_deposits" | "irs_records";
  /** Date the report was retrieved. */
  retrievedOn: IsoDate;
}

/** A `getThreshold` result to use instead of calling the AMI engine: tests, and re-deriving an old decision. */
export type InjectedThreshold = ThresholdResult | (Omit<ThresholdResult, "readings" | "lowerBoundCents" | "upperBoundCents" | "readingsAgree"> & ThresholdBoundsInput);

export interface DecisionInput {
  /** The date the decision is made, YYYY-MM-DD (US Central calendar date; the caller reads the clock). */
  today: IsoDate;
  /** Date of the scholarship application. Defaults to `today`. Never later than `today`. */
  applicationDate?: IsoDate;
  sgoPolicy: SgoPolicyInput;
  household: DecisionHouseholdInput;
  categorical?: { letters: AwardLetterInput[] } | null;
  direct?: DirectEvidenceInput | null;
  railReports?: RailReportSummary[];
  /** Threshold table to use instead of the active one (tests, replays). */
  amiTable?: AmiTable;
  /** Threshold to use instead of calling `getThreshold`. Must be for this household's county, size and cap. */
  threshold?: InjectedThreshold;
  /** Policy to use instead of `DEFAULT_DECISION_POLICY`. */
  policy?: DecisionPolicy;
}

/* -------------------------------------------------------------------------------------- reasons */

/** Why an award letter cannot support the categorical method even after a person looks at it. */
export const LETTER_DISQUALIFYING_CODES = [
  "program_medicaid_not_listed",
  "program_chip_not_listed",
  "program_ssdi_rsdi_not_listed",
  "program_school_meals_not_accepted",
  "program_not_listed",
  "letter_shows_denial",
  "letter_shows_termination",
  "letter_shows_pending_application",
  "letter_older_than_12_months",
] as const;

/** Why an award letter needs a person before it can support the categorical method. */
export const LETTER_AMBIGUOUS_CODES = [
  "program_not_recognized",
  "approval_status_unclear",
  "letter_date_unreadable",
  "letter_dated_in_future",
  "letter_window_depends_on_reference_date",
  "benefit_period_ended",
  "recipient_not_matched",
  "recipient_match_low_confidence",
  "letter_low_extraction_confidence",
  "letter_read_by_model",
] as const;

export const CUSTODY_REVIEW_CODES = ["custody_time_unclear", "custody_equal_time_income_unknown", "custody_equal_time_other_household_higher", "custody_answers_inconsistent"] as const;

/** Codes that only ever explain a decision. */
export const INFORMATIONAL_REASON_CODES = [
  "categorical_award_letter_valid",
  "direct_income_within_limit",
  "direct_income_over_limit",
  "direct_evidence_also_provided",
  "direct_evidence_wrong_year",
  "income_ambiguity_does_not_change_result",
  "sgo_stricter_cap_applied",
  "custody_this_household_longest",
  "custody_equal_time_higher_income",
  "information_missing",
  "reviewer_resolved",
] as const;

/** Codes that send a verification to a person, beyond the letter, custody and income-flag codes. */
export const REVIEW_REASON_CODES = [
  "categorical_direct_conflict",
  "between_provisional_readings",
  "near_provisional_threshold",
  "income_range_spans_limit",
  "no_documentary_evidence",
  "county_not_in_threshold_table",
  "household_size_not_in_published_table",
  "application_date_in_earlier_year",
] as const;

export const REASON_CODES = [
  ...INFORMATIONAL_REASON_CODES,
  ...REVIEW_REASON_CODES,
  ...LETTER_DISQUALIFYING_CODES,
  ...LETTER_AMBIGUOUS_CODES,
  ...CUSTODY_REVIEW_CODES,
  ...INCOME_FLAG_CODES,
] as const;

export type LetterDisqualifyingCode = (typeof LETTER_DISQUALIFYING_CODES)[number];
export type LetterAmbiguousCode = (typeof LETTER_AMBIGUOUS_CODES)[number];
export type CustodyReviewCode = (typeof CUSTODY_REVIEW_CODES)[number];
export type ReasonCode = (typeof INFORMATIONAL_REASON_CODES)[number] | (typeof REVIEW_REASON_CODES)[number] | LetterDisqualifyingCode | LetterAmbiguousCode | CustodyReviewCode | IncomeFlagCode;

export interface DecisionReason {
  code: ReasonCode;
  /** One or two sentences in English for SGO staff and the evidence pack. Never contains a household member's name. */
  message: string;
  /** Household members the reason is about. */
  memberIds: string[];
  /** Documents or rail connections the reason is about. */
  sourceIds: string[];
}

/* --------------------------------------------------------------------------------------- output */

export type DecisionStatus = "eligible" | "ineligible" | "needs_review" | "pending";
export type DecisionMethod = "direct" | "categorical";

/** How the method was satisfied. The same vocabulary as the evidence pack's `method_basis`. */
export type MethodBasis =
  | "written_documentation"
  | "other_relevant_data_sources"
  | "written_documentation_and_other_relevant_data_sources"
  | "categorical_documentation";

/** Which figure household income was compared with. The same vocabulary as the evidence pack's `relied_on`. */
export type ThresholdReliedOn = "single_limit" | "lower_bound" | "upper_bound" | "none";

export interface ThresholdTableInfo {
  source: ThresholdSource;
  tableVersion: string;
  effectiveDate: string;
  /** True while the table is HUD-derived. */
  provisional: boolean;
}

/**
 * The limit used: the full `getThreshold` result, the readings and bounds (always present), and the two
 * cut-offs the direct method compares income with.
 */
export interface DecisionThreshold extends Omit<ThresholdResult, keyof ThresholdBounds>, ThresholdBounds {
  reviewBand: {
    bps: number;
    /** True only while the table is provisional and the band is not zero. */
    applied: boolean;
    /** Width of the band below the lowest reading and above the highest, in cents (0 when not applied). */
    belowLowerCents: number;
    aboveUpperCents: number;
  };
  /** Within the limit automatically only when the UPPER bound of household income is at or below this. */
  autoEligibleMaxCents: number;
  /** Over the limit automatically only when the LOWER bound of household income is above this. */
  autoIneligibleAboveCents: number;
  /** Which figure decided an income comparison; `none` when no comparison decided the outcome. */
  reliedOn: ThresholdReliedOn;
  reliedOnLimitCents: number | null;
}

export type LetterOutcome = "pass" | "review" | "fail";

export interface LetterDefect {
  code: LetterDisqualifyingCode | LetterAmbiguousCode;
  /** `disqualifying`: the letter cannot support the method. `ambiguous`: a person can settle it. */
  kind: "disqualifying" | "ambiguous";
  message: string;
}

/** How one award letter fared against the categorical rule. */
export interface LetterEvaluation {
  documentId: string;
  outcome: LetterOutcome;
  /** The qualifying program, when the document is about one. */
  program: CategoricalProgram | null;
  programAsRead: string;
  letterDate: IsoDate | null;
  approvalStatus: AwardLetterApprovalStatus;
  matchedMemberId: string | null;
  extractedBy: "parser" | "model" | "reviewer";
  benefitPeriodEnd: IsoDate | null;
  /** Last day on which the letter is still dated within the last 12 months; null without a letter date. */
  windowEndsOn: IsoDate | null;
  defects: LetterDefect[];
}

export type CustodyOutcome = "not_answered" | "single_household" | "this_household_longest" | "this_household_equal_time_higher_income" | "needs_review";

export interface CustodyDetermination {
  outcome: CustodyOutcome;
  /** The facts the household gave, as received. */
  facts: CustodyInfo | null;
}

export type DirectOutcome = "none" | "incomplete" | "not_evaluated" | "within_limit" | "over_limit" | "needs_review";

/** Who made the decision. */
export type DecidedBy =
  | { type: "engine" }
  | {
      type: "reviewer";
      reviewerId: string;
      resolvedOn: IsoDate;
      notes: string;
      basis: ReviewerBasis;
    };

/** The listed method a reviewer relied on. A categorical resolution names the letter it rests on. */
export type ReviewerBasis = { method: "direct" } | { method: "categorical"; documentId: string };

/** What the engine itself concluded, preserved when a reviewer resolves the verification. */
export interface EngineOutcome {
  status: DecisionStatus;
  method: DecisionMethod | null;
  reasons: DecisionReason[];
  reviewReasons: DecisionReason[];
  missing: MissingItem[];
  validUntil: IsoDate | null;
  decidedOn: IsoDate;
}

export interface Decision {
  /**
   * `eligible` / `ineligible`: decided. `needs_review`: a person must look (`reviewReasons`). `pending`: the
   * household still owes information (`missing`). A decision is `pending` exactly when `missing` is not
   * empty, and `needs_review` exactly when `missing` is empty and `reviewReasons` is not.
   */
  status: DecisionStatus;
  /** The listed method relied on. Null until the verification is decided. */
  method: DecisionMethod | null;
  methodBasis: MethodBasis | null;
  methodCitation: string | null;
  applicationDate: IsoDate;
  /** The calendar year before the application date. */
  incomeYear: number;
  householdSize: number | null;
  countyFips: string | null;
  /** Source, version and effective date of the threshold table in use. Present on every decision. */
  thresholdTable: ThresholdTableInfo;
  /** Null only when the household's county or size is missing or is not in the table. */
  threshold: DecisionThreshold | null;
  /** Recorded household income for the income year (sum of the counted lines); null without direct evidence. */
  householdIncomeCents: number | null;
  /** The full income computation; null without direct evidence. */
  income: HouseholdIncomeResult | null;
  /** Coverage of the direct evidence; null without direct evidence. */
  coverage: CoverageAssessment | null;
  directOutcome: DirectOutcome;
  /** Program and date of the award letter a categorical decision rests on. */
  awardProgram: CategoricalProgram | null;
  awardLetterDate: IsoDate | null;
  awardLetterDocumentId: string | null;
  /** Every award letter on file with its evaluation. */
  letters: LetterEvaluation[];
  custody: CustodyDetermination;
  /** Why the decision is what it is. */
  reasons: DecisionReason[];
  /** What a person has to settle. Empty on every `eligible` and `ineligible` decision. */
  reviewReasons: DecisionReason[];
  /** What the household still has to provide. The messages may use household members' names: keep them out of evidence packs. */
  missing: MissingItem[];
  /** True while the threshold table is HUD-derived. Every surface must label the result provisional. */
  provisional: boolean;
  /** Last day the result can be reused; null until decided. */
  validUntil: IsoDate | null;
  sgoPolicy: SgoPolicyInput;
  engineVersion: string;
  ruleSet: { id: string; statute: string; proposedRegulation: string; incomeDefinition: string };
  policy: DecisionPolicy;
  /** The date the engine ran. */
  decidedOn: IsoDate;
  decidedBy: DecidedBy;
  /** The engine's own outcome, kept when `decidedBy` is a reviewer; null otherwise. */
  engineOutcome: EngineOutcome | null;
}

export type { MissingItem };
