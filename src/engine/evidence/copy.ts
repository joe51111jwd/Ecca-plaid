import { invalid } from "@/lib/errors";
import { formatCalendarDate, formatMoney } from "./format";
import { METHOD_CITATIONS, PROPOSED_RULE_ID } from "./policy";
import type {
  EvidenceActorType,
  EvidenceApprovalStatus,
  EvidenceCountyResolution,
  EvidenceDocumentKind,
  EvidenceExtractor,
  EvidenceIncomeSource,
  EvidenceIncomeTreatment,
  EvidenceMemberRole,
  EvidenceMethod,
  EvidenceMethodBasis,
  EvidenceProgram,
  EvidenceRailKind,
  EvidenceReliedOn,
  EvidenceStatus,
} from "./types";

/**
 * Every sentence and label the evidence engine writes, in one module.
 *
 * Rules these words are written to satisfy (docs/architecture.md, "Copy rules"):
 *  - The verification methods are attributed to the proposed regulations and called not final.
 *  - Nothing here says where a limit comes from. The words about the source of the limit, including the
 *    word "provisional", are the threshold label's and are printed as supplied. The single exception is the
 *    adjective "provisional" in the decision summary, used only when the record's own flag says so.
 *  - "Eligible" always refers to the household income requirement, never to a scholarship.
 *
 * To change a sentence, change it here and bump `EVIDENCE_COPY_VERSION`; the version is stored in each record.
 */
export const EVIDENCE_COPY_VERSION = "evidence-copy.v1";

export const DOCUMENT_TITLE = "Income verification evidence pack";

export const STATUS_LABEL: Readonly<Record<EvidenceStatus, string>> = Object.freeze({
  eligible: "Eligible",
  ineligible: "Not eligible",
  needs_review: "Needs review",
});

export const STATUS_DETAIL: Readonly<Record<EvidenceStatus, string>> = Object.freeze({
  eligible: "Household income requirement met",
  ineligible: "Household income requirement not met",
  needs_review: "No eligibility decision yet",
});

export const METHOD_LABEL: Readonly<Record<EvidenceMethod, string>> = Object.freeze({
  direct: "Direct income verification method",
  categorical: "Categorical eligibility verification method",
});
export const METHOD_NOT_DETERMINED = "Not yet determined";

export const METHOD_BASIS_LABEL: Readonly<Record<EvidenceMethodBasis, string>> = Object.freeze({
  written_documentation: "Review of written documentation",
  other_relevant_data_sources: "Other relevant data sources",
  written_documentation_and_other_relevant_data_sources: "Review of written documentation and other relevant data sources",
  categorical_documentation: "Written documentation of program approval",
  none_recorded: "No document or data source recorded yet",
  not_determined: "The method will be settled when the review is resolved",
});

/** Program names as written in the proposed categorical method (docs/reference/sgo-verification-rules.md, F45). */
export const PROGRAM_LABEL: Readonly<Record<EvidenceProgram, string>> = Object.freeze({
  SNAP: "Supplemental Nutrition Assistance Program (SNAP)",
  TANF: "Temporary Assistance for Needy Families (TANF)",
  WIC: "Special Supplemental Nutrition Program for Women, Infants, and Children (WIC)",
  SECTION_8: "Section 8 housing",
  SSI: "Supplemental Security Income (SSI)",
});

export const APPROVAL_LABEL: Readonly<Record<EvidenceApprovalStatus, string>> = Object.freeze({
  approved: "Approved",
  denied: "Denied",
  terminated: "Terminated",
  pending: "Application pending",
  unclear: "Unclear from the document",
});

/** Statuses that rule the categorical method out: the documentation shows there is no current approval. */
export const APPROVAL_RULED_OUT: ReadonlySet<EvidenceApprovalStatus> = new Set(["denied", "terminated", "pending"]);

export const DOCUMENT_KIND_LABEL: Readonly<Record<EvidenceDocumentKind, string>> = Object.freeze({
  award_letter: "Benefits award letter",
  tax_return: "Tax return",
  irs_transcript: "IRS transcript",
  w2: "Form W-2",
  pay_stub: "Pay stub",
  other_income: "Evidence of other income",
  unknown: "Unclassified document",
});

export const EXTRACTOR_LABEL: Readonly<Record<EvidenceExtractor, string>> = Object.freeze({
  parser: "Read by parser",
  model: "Read by model-assisted extraction",
  reviewer: "Keyed by a reviewer",
  none: "No fields read",
});

export const RAIL_KIND_LABEL: Readonly<Record<EvidenceRailKind, string>> = Object.freeze({
  payroll: "Payroll data connection",
  bank: "Bank data connection",
  transcript: "IRS transcript request",
});

export const INCOME_SOURCE_LABEL: Readonly<Record<EvidenceIncomeSource, string>> = Object.freeze({
  document: "Document",
  rail: "Data connection",
  self_reported: "Reported by the family",
  reviewer: "Keyed by a reviewer",
});

export const INCOME_TREATMENT_LABEL: Readonly<Record<EvidenceIncomeTreatment, string>> = Object.freeze({
  counted: "Counted",
  excluded: "Not counted",
  review: "Open: in the upper figure only",
});

/* Outcomes of the shared-custody rule as the decision engine names them. The proposed rule looks to the
   household where the student resided longest in the year and, when time is equal, to the one with the
   higher income (spec, "household intake screens"; docs/reference/sgo-verification-rules.md). */
const CUSTODY_OUTCOME_LABEL: Readonly<Record<string, string>> = Object.freeze({
  not_answered: "The shared-custody question has not been answered.",
  single_household: "The student lives in one household.",
  this_household_longest: "Under the proposed rules this is the student's household: the student resided here longest during the income year.",
  this_household_equal_time_higher_income: "Under the proposed rules this is the student's household: time was equal and this household has the higher income.",
  needs_review: "The shared-custody answers need review.",
});

export function custodyOutcomeLabel(outcome: string): string | null {
  return CUSTODY_OUTCOME_LABEL[outcome] ?? null;
}

export const MEMBER_ROLE_LABEL: Readonly<Record<EvidenceMemberRole, string>> = Object.freeze({
  student: "Student",
  adult: "Adult",
  child: "Child",
  other: "Other household member",
});

export const ACTOR_LABEL: Readonly<Record<EvidenceActorType, string>> = Object.freeze({
  engine: "Decision engine",
  system: "System",
  reviewer: "Reviewer",
  user: "SGO staff",
  family: "Family",
  api_key: "API client",
});

export const COUNTY_RESOLUTION_LABEL: Readonly<Record<EvidenceCountyResolution, string>> = Object.freeze({
  geocoder: "Address matched to the county by geocoder",
  zip_unique: "ZIP code lies in one county",
  self_selected: "County selected by the family",
});

const CONSENT_KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  verification_share: "Consent to share the verification with the SGO",
  electronic_delivery: "Consent to electronic delivery",
  rail_connect: "Consent to connect a data source",
  passport_reuse: "Consent to reuse an earlier verification",
});

export function consentKindLabel(kind: string): string | null {
  return CONSENT_KIND_LABEL[kind] ?? null;
}

export function methodCitation(method: EvidenceMethod): string {
  return METHOD_CITATIONS[method];
}

/* --------------------------------------------------------------------------- generated sentences */

/** Household income for the income year, as the sentences need it. */
export interface IncomeFacts {
  /** The recorded figure: the sum of the counted lines. */
  countedCents: number;
  /** The least and the most income can be when a line can be read more than one way. */
  lowerBoundCents: number;
  upperBoundCents: number;
}

export interface LimitFacts {
  provisional: boolean;
  capPct: number;
  lowerBoundCents: number;
  upperBoundCents: number;
  readingsAgree: boolean;
  /** The largest reading at the statutory 300 percent. */
  statutoryUpperBoundCents: number;
  /** Label of the reading that gives the lower bound, and of the one that gives the upper bound. */
  lowerLabel: string;
  upperLabel: string;
  reliedOn: EvidenceReliedOn;
  reliedOnLimitCents: number | null;
  /** True when an ineligible decision rests on lines whose treatment is open rather than on the recorded figure. */
  restsOnOpenLines: boolean;
}

export interface SummaryFacts {
  status: EvidenceStatus;
  method: EvidenceMethod | null;
  decidedByReviewer: boolean;
  incomeYear: number;
  householdSize: number;
  countyName: string;
  state: string;
  limit: LimitFacts;
  /** Null when no income detail is carried. */
  income: IncomeFacts | null;
  /** Categorical detail, when carried. */
  program: EvidenceProgram | null;
  letterDate: string | null;
  approvalStatus: EvidenceApprovalStatus | null;
}

function householdPhrase(facts: SummaryFacts): string {
  return `a household of ${facts.householdSize} in ${facts.countyName}, ${facts.state}`;
}

function limitNoun(limit: LimitFacts): string {
  return limit.provisional ? "provisional income limit" : "income limit";
}

function capLimitText(limit: LimitFacts): string {
  return limit.readingsAgree ? formatMoney(limit.upperBoundCents) : `${formatMoney(limit.lowerBoundCents)} to ${formatMoney(limit.upperBoundCents)}`;
}

/** The decision in words. Stored in the record as `decision.summary` and printed unchanged on the PDF cover. */
export function decisionSummary(facts: SummaryFacts): string {
  const { limit, income } = facts;
  const rules = `the proposed regulations (${PROPOSED_RULE_ID}), which are not final`;

  if (facts.status === "needs_review") {
    const parts = ["Needs review: no eligibility decision has been made."];
    if (facts.method === "categorical" || facts.approvalStatus !== null) {
      const submitted = facts.program ? ` for ${PROGRAM_LABEL[facts.program]}` : "";
      parts.push(`Documentation${submitted} was submitted under the categorical eligibility verification method of ${rules}.`);
    }
    if (income !== null) {
      const range = limit.readingsAgree
        ? `is ${formatMoney(limit.upperBoundCents)}`
        : `is between ${formatMoney(limit.lowerBoundCents)} and ${formatMoney(limit.upperBoundCents)}, depending on the reading shown in the limit calculation`;
      parts.push(`Household cash income counted so far for calendar year ${facts.incomeYear} is ${formatMoney(income.countedCents)}. The ${limitNoun(limit)} for ${householdPhrase(facts)} ${range}.`);
    } else if (facts.method !== "categorical") {
      parts.push(`No household income has been recorded yet for calendar year ${facts.incomeYear}.`);
    }
    parts.push("The reasons are listed in this record.");
    return parts.join(" ");
  }

  if (facts.method === "categorical") {
    if (facts.status === "ineligible" || facts.program === null) {
      // buildEvidenceRecord refuses both before any sentence is written (docs/architecture.md, rule 2).
      throw invalid("A decided categorical verification is eligible and names its program");
    }
    const program = PROGRAM_LABEL[facts.program];
    const dated = facts.letterDate ? ` dated ${formatCalendarDate(facts.letterDate)}` : "";
    const finding =
      facts.approvalStatus === "approved"
        ? `Written documentation${dated} shows that an individual in the student's household currently is approved for ${program}.`
        : `Written documentation${dated} names an individual in the student's household in connection with ${program}. The approval status read from the document was unclear, and a reviewer made the decision; see the review trail.`;
    return `Eligible: the household income requirement is met under the categorical eligibility verification method of ${rules}. ${finding}`;
  }

  if (income === null) throw invalid("A decided direct verification carries its household income");
  const counted = formatMoney(income.countedCents);
  const by = facts.decidedByReviewer ? " A reviewer made the decision; see the review trail." : "";
  const household = householdPhrase(facts);
  const bound =
    limit.reliedOn === "lower_bound"
      ? " (the lower bound of the readings shown in the limit calculation)"
      : limit.reliedOn === "upper_bound"
        ? " (the upper bound of the readings shown in the limit calculation)"
        : "";
  const reliedLimit = formatMoney(limit.reliedOnLimitCents ?? limit.upperBoundCents);

  if (facts.status === "eligible") {
    const lead = `Eligible: the household income requirement is met. Household cash income counted for calendar year ${facts.incomeYear} is ${counted}, which is not greater than the ${limitNoun(limit)} of`;
    if (limit.reliedOn === "statutory_limit") {
      return `${lead} ${reliedLimit} at the statutory 300 percent for ${household}. It is greater than the limit at the SGO's stricter cap of ${limit.capPct} percent (${capLimitText(limit)}).${by}`;
    }
    return `${lead} ${reliedLimit}${bound} for ${household}.${by}`;
  }

  const lead = "Not eligible: the household income requirement is not met.";
  if (limit.restsOnOpenLines) {
    return `${lead} Household cash income counted for calendar year ${facts.incomeYear} is ${counted}; with the lines whose treatment is open it is as much as ${formatMoney(income.upperBoundCents)}, which is greater than the ${limitNoun(limit)} of ${reliedLimit}${bound} for ${household}.${by}`;
  }
  return `${lead} Household cash income counted for calendar year ${facts.incomeYear} is ${counted}, which is greater than the ${limitNoun(limit)} of ${reliedLimit}${bound} for ${household}.${by}`;
}

export interface ReliedOnFacts {
  status: EvidenceStatus;
  method: EvidenceMethod | null;
  limit: LimitFacts;
  income: IncomeFacts | null;
}

const NOT_COMPARED =
  "Household income was not compared with the income limit: this verification uses the categorical eligibility verification method. The limit for the household's area and size is recorded for reference.";

function rangeNote(income: IncomeFacts): string {
  if (income.lowerBoundCents === income.countedCents && income.upperBoundCents === income.countedCents) return "";
  return ` Lines that can be read more than one way put household income between ${formatMoney(income.lowerBoundCents)} and ${formatMoney(income.upperBoundCents)}.`;
}

/** Which figure the decision compared income with, stated plainly. Stored as `threshold.relied_on_statement`. */
export function reliedOnStatement(facts: ReliedOnFacts): string {
  const { limit, income } = facts;
  const lower = formatMoney(limit.lowerBoundCents);
  const upper = formatMoney(limit.upperBoundCents);

  if (income === null) {
    if (facts.method === "categorical") return NOT_COMPARED;
    return "No eligibility decision has been made, so no limit has been relied on. No household income has been recorded yet.";
  }
  const counted = formatMoney(income.countedCents);

  if (facts.status === "needs_review") {
    const position = limit.readingsAgree
      ? `${income.countedCents <= limit.upperBoundCents ? "not greater than" : "greater than"} the limit of ${upper}`
      : income.countedCents <= limit.lowerBoundCents
        ? `not greater than the lower bound of ${lower}`
        : income.countedCents <= limit.upperBoundCents
          ? `greater than the lower bound of ${lower} and not greater than the upper bound of ${upper}`
          : `greater than the upper bound of ${upper}`;
    return `No eligibility decision has been made, so no limit has been relied on. Household income counted so far is ${counted}, which is ${position}.${rangeNote(income)}`;
  }

  if (limit.reliedOn === "statutory_limit") {
    return `The decision relied on the limit at the statutory 300 percent, ${formatMoney(limit.statutoryUpperBoundCents)}. Household income of ${counted} is not greater than it, and is greater than the limit at the SGO's stricter cap of ${limit.capPct} percent (${capLimitText(limit)}).${rangeNote(income)}`;
  }

  if (limit.restsOnOpenLines) {
    const figure = limit.readingsAgree ? `the income limit of ${upper}` : `the lower bound, ${lower} (${limit.lowerLabel})`;
    return `The decision relied on ${figure}. Recorded household income of ${counted} is not greater than it; with the lines whose treatment is open, household income is as much as ${formatMoney(income.upperBoundCents)}, which is greater. The decision rests on those lines.`;
  }

  if (limit.reliedOn === "single_limit") {
    const relation = facts.status === "eligible" ? "is not greater than" : "is greater than";
    return `The decision compared household income of ${counted} with the income limit of ${upper}. Income ${relation} the limit.${rangeNote(income)}`;
  }

  const lead = "The readings give different limits.";
  if (facts.status === "eligible") {
    const body =
      limit.reliedOn === "lower_bound"
        ? `The decision relied on the lower bound, ${lower} (${limit.lowerLabel}). Household income of ${counted} is not greater than the lower bound, so it is not greater than the limit under any reading shown.`
        : `The decision relied on the upper bound, ${upper} (${limit.upperLabel}). Household income of ${counted} is greater than the lower bound of ${lower} (${limit.lowerLabel}) and not greater than the upper bound.`;
    return `${lead} ${body}${rangeNote(income)}`;
  }
  const body =
    limit.reliedOn === "upper_bound"
      ? `The decision relied on the upper bound, ${upper} (${limit.upperLabel}). Household income of ${counted} is greater than the upper bound, so it is greater than the limit under every reading shown.`
      : `The decision relied on the lower bound, ${lower} (${limit.lowerLabel}). Household income of ${counted} is greater than the lower bound and not greater than the upper bound of ${upper} (${limit.upperLabel}).`;
  return `${lead} ${body}${rangeNote(income)}`;
}

/* --------------------------------------------------------------------------------- PDF-only copy */

export const PDF_COPY = Object.freeze({
  testWatermark: "TEST MODE",
  testBanner: "TEST MODE. This pack was produced in the sandbox. It is not a record of a live verification.",
  provenance: (sgoName: string) =>
    `Prepared for ${sgoName} from documents and data that the family provided or authorized, under the consent recorded in this pack.`,
  howToReadTitle: "How to read this record",
  howToRead: [
    "This page gives the decision, the method and the income limit. The sections that follow show how the limit was calculated, the evidence reviewed, the consent, and who or what reviewed any exception.",
    "The record covers one requirement: household income for the calendar year before the application, compared with the income limit for the household's area and size. It is not a scholarship award. An award is a separate decision of the scholarship granting organization.",
    `Verification methods follow the proposed regulations (${PROPOSED_RULE_ID}). The proposed regulations are not final.`,
    "Files are identified by SHA-256 hash. Where a raw file has been deleted under the retention policy, its hash and the fields read from it are kept.",
    "The signed JSON record is the authoritative form of this pack. The last section explains how to check its signature.",
  ],
  minimization:
    "Students are named. Other household members appear as initials, role and relationship. Dates of birth, Social Security numbers, street addresses and raw files are not part of this pack.",
  noDocuments: "No documents were uploaded for this verification.",
  noRails: "No data connection was used for this verification.",
  noFields: "No fields were read from this document.",
  noReviewEngine: (engineVersion: string) =>
    `No exception was raised for manual review. The decision was made by the decision engine (version ${engineVersion}).`,
  noReviewEntries: "No separate review entries were recorded.",
  noTimeline: "No timeline events were recorded.",
  noIncomeItems: "No income items were recorded.",
  noBasis: "No household income and no categorical documentation have been recorded yet.",
  incomeOmitted: "Income documents were also on file. Their income detail is not part of this pack, because the decision rests on the categorical method.",
  purged: (date: string) => `Raw file deleted on ${date}; hash retained`,
  retained: "Raw file retained",
  governs: "This PDF is a rendering of the signed JSON record. If the two differ, the signed JSON record governs.",
  transliteration: (count: number) =>
    `${count} ${count === 1 ? "character" : "characters"} in this PDF could not be printed with its standard fonts and ${count === 1 ? "was" : "were"} transliterated or shown as "?". The signed JSON record holds the original text.`,
});
