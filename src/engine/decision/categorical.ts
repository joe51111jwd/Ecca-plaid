/**
 * The categorical eligibility verification method.
 *
 * Proposed Reg. 1.25F-3(c)(6)(iii)(B) (REG-117199-25, not final): income may be verified through "written
 * documentation, such as an award letter, dated within the last 12 months, confirming that an individual in
 * the student's household currently is approved for assistance from or participation in" SNAP, TANF, WIC,
 * Section 8 housing or SSI. The list of programs is closed. The preamble adds that eligibility for free or
 * reduced-price lunch programs that apply to an entire school is not adequate.
 *
 * A letter passes only when every element is shown by a trusted read. A defect is one of two kinds:
 *  - `disqualifying`: the letter cannot support the method (another program, a denial, too old). The
 *    household is told why and the verification falls through to the direct method.
 *  - `ambiguous`: a person can settle it (a field that could not be read, a low-confidence or model read, a
 *    recipient who was not matched to the roster). The verification goes to review.
 * A letter that cannot be used never makes a household ineligible.
 */
import { addMonthsClamped, earliestDate, lastDayOfYear, yearOf, type HouseholdMemberInput, type IsoDate } from "@/engine/income";
import type { DecisionPolicy } from "./policy";
import { CATEGORICAL_PROGRAMS, type AwardLetterInput, type CategoricalProgram, type LetterAmbiguousCode, type LetterDefect, type LetterDisqualifyingCode, type LetterEvaluation } from "./types";

export const CATEGORICAL_PROGRAM_LABELS: Readonly<Record<CategoricalProgram, { en: string; es: string }>> = Object.freeze({
  SNAP: { en: "SNAP", es: "SNAP" },
  TANF: { en: "TANF", es: "TANF" },
  WIC: { en: "WIC", es: "WIC" },
  SECTION_8: { en: "Section 8 housing", es: "vivienda de la Sección 8" },
  SSI: { en: "Supplemental Security Income (SSI)", es: "Seguridad de Ingreso Suplementario (SSI)" },
});

export type ProgramClassification =
  | { kind: "qualifying"; program: CategoricalProgram }
  | { kind: "not_qualifying"; code: LetterDisqualifyingCode }
  | { kind: "not_recognized" };

/** The program names of the proposed regulation text, next to the stable ids. */
const QUALIFYING_ALIASES: Readonly<Record<string, CategoricalProgram>> = {
  SNAP: "SNAP",
  SUPPLEMENTAL_NUTRITION_ASSISTANCE_PROGRAM: "SNAP",
  TANF: "TANF",
  TEMPORARY_ASSISTANCE_FOR_NEEDY_FAMILIES: "TANF",
  WIC: "WIC",
  SPECIAL_SUPPLEMENTAL_NUTRITION_PROGRAM_FOR_WOMEN_INFANTS_AND_CHILDREN: "WIC",
  SECTION_8: "SECTION_8",
  SECTION8: "SECTION_8",
  SECTION_8_HOUSING: "SECTION_8",
  SSI: "SSI",
  SUPPLEMENTAL_SECURITY_INCOME: "SSI",
};

/** Programs families commonly send that the proposed list does not contain. */
const NOT_QUALIFYING_ALIASES: Readonly<Record<string, LetterDisqualifyingCode>> = {
  MEDICAID: "program_medicaid_not_listed",
  CHIP: "program_chip_not_listed",
  CHILDRENS_HEALTH_INSURANCE_PROGRAM: "program_chip_not_listed",
  SSDI: "program_ssdi_rsdi_not_listed",
  RSDI: "program_ssdi_rsdi_not_listed",
  SOCIAL_SECURITY_DISABILITY_INSURANCE: "program_ssdi_rsdi_not_listed",
  SOCIAL_SECURITY: "program_ssdi_rsdi_not_listed",
  SCHOOL_MEALS: "program_school_meals_not_accepted",
  SCHOOL_LUNCH: "program_school_meals_not_accepted",
  FREE_OR_REDUCED_PRICE_LUNCH: "program_school_meals_not_accepted",
  FREE_REDUCED_LUNCH: "program_school_meals_not_accepted",
  NSLP: "program_school_meals_not_accepted",
  OTHER: "program_not_listed",
};

/**
 * Classifies the program text read from a document. Case and punctuation are ignored. Text that is neither
 * one of the five programs nor a known program outside the list is `not_recognized` and goes to a person:
 * the engine does not guess what an unfamiliar name means.
 */
export function classifyProgram(raw: string): ProgramClassification {
  const key = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (Object.hasOwn(QUALIFYING_ALIASES, key)) return { kind: "qualifying", program: QUALIFYING_ALIASES[key] };
  if (Object.hasOwn(NOT_QUALIFYING_ALIASES, key)) return { kind: "not_qualifying", code: NOT_QUALIFYING_ALIASES[key] };
  return { kind: "not_recognized" };
}

/**
 * Whether a document date is "within the last 12 months" of a reference date: from the same day 12 calendar
 * months earlier (inclusive) through the reference date (inclusive).
 */
export function isWithinLetterWindow(letterDate: IsoDate, referenceDate: IsoDate, months: number): boolean {
  return letterDate >= addMonthsClamped(referenceDate, -months) && letterDate <= referenceDate;
}

const DISQUALIFYING_MESSAGES: Record<LetterDisqualifyingCode, string> = {
  program_medicaid_not_listed: "The document is about Medicaid, which is not one of the five programs of the categorical method under the proposed rules (SNAP, TANF, WIC, Section 8 housing, SSI).",
  program_chip_not_listed: "The document is about CHIP, which is not one of the five programs of the categorical method under the proposed rules (SNAP, TANF, WIC, Section 8 housing, SSI).",
  program_ssdi_rsdi_not_listed:
    "The document is about Social Security retirement, survivors or disability insurance (RSDI or SSDI), which is not one of the five programs of the categorical method under the proposed rules. Supplemental Security Income (SSI) is a different program.",
  program_school_meals_not_accepted:
    "The document is about free or reduced-price school meals. Under the proposed rules, meal eligibility that applies to an entire school is not adequate verification, and school meal programs are not among the five listed programs.",
  program_not_listed: "The document is about a program that is not one of the five programs of the categorical method under the proposed rules (SNAP, TANF, WIC, Section 8 housing, SSI).",
  letter_shows_denial: "The document shows a denial, not a current approval.",
  letter_shows_termination: "The document shows that benefits ended or were terminated, not a current approval.",
  letter_shows_pending_application: "The document shows an application that is still pending, not a current approval.",
  letter_older_than_12_months: "The document is dated more than 12 months before the application.",
};

const AMBIGUOUS_MESSAGES: Record<LetterAmbiguousCode, string> = {
  program_not_recognized: "The program named on the document was not recognized. A reviewer must confirm whether it is SNAP, TANF, WIC, Section 8 housing or SSI.",
  approval_status_unclear: "The document does not clearly show whether the person is currently approved. A reviewer must read it.",
  letter_date_unreadable: "The date of the document could not be read, so the 12-month window cannot be checked.",
  letter_dated_in_future: "The document is dated after the decision date. The date was misread or the document is not what it appears to be.",
  letter_window_depends_on_reference_date:
    "Whether the document is dated within the last 12 months depends on the date the 12 months are counted from, which the proposed rules do not state: it passes against one of the application date and the decision date and not the other.",
  benefit_period_ended: "The benefit or certification period printed on the document has ended, so it does not show that the person is currently approved.",
  documentation_not_award_letter:
    "The document is not an award or approval letter. The proposed rules accept written documentation \"such as an award letter\" and do not say what else qualifies, so a reviewer must decide whether it shows current approval.",
  recipient_not_matched: "The person named on the document was not matched to anyone on the household roster. The proposed rules require an individual in the student's household.",
  recipient_match_low_confidence: "The match between the person named on the document and the household roster is not confident enough to rely on without a reviewer.",
  letter_low_extraction_confidence: "The document was read with low confidence. A reviewer must confirm the fields.",
  letter_read_by_model: "The document was read by a model. A model-read document does not support an automatic decision; a reviewer must confirm the fields.",
};

export interface EvaluateLetterContext {
  applicationDate: IsoDate;
  /** The decision date. */
  today: IsoDate;
  members: HouseholdMemberInput[];
  policy: DecisionPolicy;
}

/** Tests one award letter against every element of the categorical rule. */
export function evaluateAwardLetter(letter: AwardLetterInput, context: EvaluateLetterContext): LetterEvaluation {
  const { applicationDate, today, members, policy } = context;
  const defects: LetterDefect[] = [];
  const disqualify = (code: LetterDisqualifyingCode): void => void defects.push({ code, kind: "disqualifying", message: DISQUALIFYING_MESSAGES[code] });
  const doubt = (code: LetterAmbiguousCode): void => void defects.push({ code, kind: "ambiguous", message: AMBIGUOUS_MESSAGES[code] });

  /* The read itself. A reviewer-keyed letter is trusted; a model read never is in v1. */
  const confident = letter.extractedBy === "reviewer" || letter.extractionConfidence >= policy.minExtractionConfidence;
  const trusted = confident && (letter.extractedBy !== "model" || policy.modelReadDocumentsMayAutoDecide);
  if (letter.extractedBy === "model" && !policy.modelReadDocumentsMayAutoDecide) doubt("letter_read_by_model");
  if (!confident) doubt("letter_low_extraction_confidence");

  /* Program: one of the five. */
  const classification = classifyProgram(letter.program);
  if (classification.kind === "not_qualifying") disqualify(classification.code);
  if (classification.kind === "not_recognized") doubt("program_not_recognized");

  /* Currently approved. */
  if (letter.approvalStatus === "denied") disqualify("letter_shows_denial");
  if (letter.approvalStatus === "terminated") disqualify("letter_shows_termination");
  if (letter.approvalStatus === "pending") disqualify("letter_shows_pending_application");
  if (letter.approvalStatus === "unclear") doubt("approval_status_unclear");
  const benefitPeriodEnd = letter.benefitPeriodEnd ?? null;
  if (benefitPeriodEnd !== null && benefitPeriodEnd < today) doubt("benefit_period_ended");
  if (letter.documentType === "other") doubt("documentation_not_award_letter");

  /* Dated within the last 12 months, against both possible reference dates. */
  let windowEndsOn: IsoDate | null = null;
  if (letter.letterDate === null) {
    doubt("letter_date_unreadable");
  } else {
    windowEndsOn = addMonthsClamped(letter.letterDate, policy.awardLetterWindowMonths);
    const againstApplication = isWithinLetterWindow(letter.letterDate, applicationDate, policy.awardLetterWindowMonths);
    const againstDecision = isWithinLetterWindow(letter.letterDate, today, policy.awardLetterWindowMonths);
    if (letter.letterDate > today) doubt("letter_dated_in_future");
    else if (againstApplication !== againstDecision) doubt("letter_window_depends_on_reference_date");
    else if (!againstApplication) disqualify("letter_older_than_12_months");
  }

  /* An individual in the student's household. */
  const onRoster = letter.matchedMemberId !== null && members.some((member) => member.id === letter.matchedMemberId);
  if (!onRoster) doubt("recipient_not_matched");
  else if (letter.extractedBy !== "reviewer" && letter.nameMatchConfidence < policy.minNameMatchConfidence) doubt("recipient_match_low_confidence");

  // A disqualifying finding settles the letter only when the read behind it can be trusted.
  const disqualified = defects.some((defect) => defect.kind === "disqualifying");
  const outcome = disqualified && trusted ? "fail" : defects.length > 0 ? "review" : "pass";

  return {
    documentId: letter.documentId,
    outcome,
    program: classification.kind === "qualifying" ? classification.program : null,
    programAsRead: letter.program,
    letterDate: letter.letterDate,
    approvalStatus: letter.approvalStatus,
    matchedMemberId: onRoster ? letter.matchedMemberId : null,
    extractedBy: letter.extractedBy,
    benefitPeriodEnd,
    windowEndsOn,
    defects,
  };
}

/**
 * Last day a categorical result can be reused: the earliest of December 31 of the application year, the last
 * day the letter is still dated within the last 12 months, and the end of the benefit period when one was
 * read. Product policy; see `DEFAULT_DECISION_POLICY` in policy.ts.
 */
export function categoricalValidUntil(evaluation: Pick<LetterEvaluation, "windowEndsOn" | "benefitPeriodEnd">, applicationDate: IsoDate): IsoDate {
  const candidates = [evaluation.windowEndsOn, evaluation.benefitPeriodEnd].filter((date): date is IsoDate => date !== null);
  return earliestDate(lastDayOfYear(yearOf(applicationDate)), ...candidates);
}

export interface CategoricalEvaluation {
  /** `none`: no letter on file. `pass`: at least one letter passes. `review`: none passes but a person could confirm one. `fail`: none can be used. */
  outcome: "none" | "pass" | "review" | "fail";
  letters: LetterEvaluation[];
  /** The passing letter the decision rests on: the one that stays valid longest. */
  best: LetterEvaluation | null;
}

export function evaluateCategorical(letters: AwardLetterInput[], context: EvaluateLetterContext): CategoricalEvaluation {
  const evaluations = letters.map((letter) => evaluateAwardLetter(letter, context));
  const passing = evaluations
    .filter((evaluation) => evaluation.outcome === "pass")
    .sort((a, b) => {
      const byValidity = categoricalValidUntil(b, context.applicationDate).localeCompare(categoricalValidUntil(a, context.applicationDate));
      return byValidity || (b.letterDate ?? "").localeCompare(a.letterDate ?? "") || a.documentId.localeCompare(b.documentId);
    });
  const outcome = evaluations.length === 0 ? "none" : passing.length > 0 ? "pass" : evaluations.some((evaluation) => evaluation.outcome === "review") ? "review" : "fail";
  return { outcome, letters: evaluations, best: passing[0] ?? null };
}

export { CATEGORICAL_PROGRAMS };
