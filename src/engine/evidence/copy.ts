import { formatCalendarDate, formatMoney } from "./format";
import { METHOD_CITATIONS, PROPOSED_RULE_ID } from "./policy";
import type {
  EvidenceActorType,
  EvidenceApprovalStatus,
  EvidenceCountyResolution,
  EvidenceDocumentKind,
  EvidenceExtractor,
  EvidenceIncomeSource,
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

export const METHOD_BASIS_LABEL: Readonly<Record<EvidenceMethodBasis, string>> = Object.freeze({
  written_documentation: "Review of written documentation",
  other_relevant_data_sources: "Other relevant data sources",
  written_documentation_and_other_relevant_data_sources: "Review of written documentation and other relevant data sources",
  categorical_documentation: "Written documentation of program approval",
  none_recorded: "No document or data source recorded yet",
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
  current: "Currently approved",
  not_current: "Not currently approved",
  unclear: "Unclear from the document",
});

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
  parser: "Read by document parser",
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

export interface SummaryFacts {
  status: EvidenceStatus;
  method: EvidenceMethod;
  decidedByReviewer: boolean;
  incomeYear: number;
  householdSize: number;
  countyName: string;
  state: string;
  provisional: boolean;
  /** Direct method only. */
  incomeCents: number | null;
  reliedOn: EvidenceReliedOn;
  reliedOnLimitCents: number | null;
  lowerBoundCents: number;
  upperBoundCents: number;
  readingsAgree: boolean;
  /** Categorical method only. */
  program: EvidenceProgram | null;
  letterDate: string | null;
  approvalStatus: EvidenceApprovalStatus | null;
}

function householdPhrase(facts: SummaryFacts): string {
  return `a household of ${facts.householdSize} in ${facts.countyName}, ${facts.state}`;
}

function limitNoun(facts: SummaryFacts): string {
  return facts.provisional ? "provisional income limit" : "income limit";
}

/** The decision in words. Stored in the record as `decision.summary` and printed unchanged on the PDF cover. */
export function decisionSummary(facts: SummaryFacts): string {
  if (facts.method === "categorical") {
    const program = facts.program ? PROGRAM_LABEL[facts.program] : null;
    if (facts.status === "eligible") {
      const dated = facts.letterDate ? ` dated ${formatCalendarDate(facts.letterDate)}` : "";
      const finding =
        facts.approvalStatus === "current"
          ? `Written documentation${dated} shows that an individual in the student's household currently is approved for ${program}.`
          : `Written documentation${dated} names an individual in the student's household in connection with ${program}. The approval status read from the document was unclear, and a reviewer made the decision; see the review trail.`;
      return `Eligible: the household income requirement is met under the categorical eligibility verification method of the proposed regulations (${PROPOSED_RULE_ID}), which are not final. ${finding}`;
    }
    const submitted = program ? ` for ${program}` : "";
    return `Needs review: no eligibility decision has been made. Documentation${submitted} was submitted under the categorical eligibility verification method of the proposed regulations (${PROPOSED_RULE_ID}), which are not final. The reasons are listed in this record.`;
  }

  const income = formatMoney(facts.incomeCents ?? 0);
  if (facts.status === "needs_review") {
    const limit = facts.readingsAgree
      ? `is ${formatMoney(facts.upperBoundCents)}`
      : `is between ${formatMoney(facts.lowerBoundCents)} and ${formatMoney(facts.upperBoundCents)}, depending on the reading shown in the limit calculation`;
    return `Needs review: no eligibility decision has been made. Household cash income counted so far for calendar year ${facts.incomeYear} is ${income}. The ${limitNoun(facts)} for ${householdPhrase(facts)} ${limit}. The reasons are listed in this record.`;
  }

  const limit = formatMoney(facts.reliedOnLimitCents ?? facts.upperBoundCents);
  const bound = facts.reliedOn === "lower_bound" ? " (the lower bound of the readings shown in the limit calculation)" : facts.reliedOn === "upper_bound" ? " (the upper bound of the readings shown in the limit calculation)" : "";
  const by = facts.decidedByReviewer ? " A reviewer made the decision; see the review trail." : "";
  if (facts.status === "eligible") {
    return `Eligible: the household income requirement is met. Household cash income counted for calendar year ${facts.incomeYear} is ${income}, which is not greater than the ${limitNoun(facts)} of ${limit}${bound} for ${householdPhrase(facts)}.${by}`;
  }
  return `Not eligible: the household income requirement is not met. Household cash income counted for calendar year ${facts.incomeYear} is ${income}, which is greater than the ${limitNoun(facts)} of ${limit}${bound} for ${householdPhrase(facts)}.${by}`;
}

export interface ReliedOnFacts {
  status: EvidenceStatus;
  method: EvidenceMethod;
  incomeCents: number | null;
  reliedOn: EvidenceReliedOn;
  lowerBoundCents: number;
  upperBoundCents: number;
  readingsAgree: boolean;
  /** Label of the reading that gives the lower bound, and of the one that gives the upper bound. */
  lowerLabel: string;
  upperLabel: string;
}

/** Which figure the decision compared income with, stated plainly. Stored as `threshold.relied_on_statement`. */
export function reliedOnStatement(facts: ReliedOnFacts): string {
  const lower = formatMoney(facts.lowerBoundCents);
  const upper = formatMoney(facts.upperBoundCents);
  if (facts.method === "categorical") {
    return "Household income was not compared with the income limit: this verification uses the categorical eligibility verification method. The limit for the household's area and size is recorded for reference.";
  }
  const income = formatMoney(facts.incomeCents ?? 0);
  if (facts.status === "needs_review") {
    if (facts.readingsAgree) {
      const position = (facts.incomeCents ?? 0) <= facts.upperBoundCents ? "not greater than" : "greater than";
      return `No eligibility decision has been made, so no limit has been relied on. Household income counted so far is ${income}, which is ${position} the limit of ${upper}.`;
    }
    const position =
      (facts.incomeCents ?? 0) <= facts.lowerBoundCents
        ? `not greater than the lower bound of ${lower}`
        : (facts.incomeCents ?? 0) <= facts.upperBoundCents
          ? `greater than the lower bound of ${lower} and not greater than the upper bound of ${upper}`
          : `greater than the upper bound of ${upper}`;
    return `No eligibility decision has been made, so no limit has been relied on. Household income counted so far is ${income}, which is ${position}.`;
  }
  if (facts.reliedOn === "single_limit") {
    const relation = facts.status === "eligible" ? "is not greater than" : "is greater than";
    return `The decision compared household income of ${income} with the income limit of ${upper}. Income ${relation} the limit.`;
  }
  if (facts.status === "eligible") {
    return facts.reliedOn === "lower_bound"
      ? `The readings give different limits. The decision relied on the lower bound, ${lower} (${facts.lowerLabel}). Household income of ${income} is not greater than the lower bound, so it is not greater than the limit under any reading shown.`
      : `The readings give different limits. The decision relied on the upper bound, ${upper} (${facts.upperLabel}). Household income of ${income} is greater than the lower bound of ${lower} (${facts.lowerLabel}) and not greater than the upper bound.`;
  }
  return facts.reliedOn === "upper_bound"
    ? `The readings give different limits. The decision relied on the upper bound, ${upper} (${facts.upperLabel}). Household income of ${income} is greater than the upper bound, so it is greater than the limit under every reading shown.`
    : `The readings give different limits. The decision relied on the lower bound, ${lower} (${facts.lowerLabel}). Household income of ${income} is greater than the lower bound and not greater than the upper bound of ${upper} (${facts.upperLabel}).`;
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
  purged: (date: string) => `Raw file deleted on ${date}; hash retained`,
  retained: "Raw file retained",
  governs: "This PDF is a rendering of the signed JSON record. If the two differ, the signed JSON record governs.",
  transliteration: (count: number) =>
    `${count} ${count === 1 ? "character" : "characters"} in this PDF could not be printed with its standard fonts and ${count === 1 ? "was" : "were"} transliterated or shown as "?". The signed JSON record holds the original text.`,
});
