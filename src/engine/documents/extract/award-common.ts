/**
 * Shared pieces for benefit-document extractors: program keyword families, the award summary, and the
 * letter-date field.
 */
import type { LineRef } from "../text";
import { CONF_VERIFIED, readLabeledDate, type ExtractContext, type ExtractionBuilder } from "./common";
import type { ApprovalStatus, AwardLetterSummary, BenefitPeriod, BenefitProgram, LookAlikeProgram } from "../types";

export interface ProgramMatch {
  program: BenefitProgram | null;
  lookAlike: LookAlikeProgram | null;
  /** One-Time TANF is assistance from TANF but not ongoing (B13): a reviewer decides. */
  oneTimeTanf: boolean;
}

/** Program keyword families (P2 "Program mapping"). Returns null when nothing matches. */
export function mapProgramText(s: string): ProgramMatch | null {
  if (/\bSNAP\b|Supplemental Nutrition Assistance|food benefits/i.test(s)) return { program: "SNAP", lookAlike: null, oneTimeTanf: false };
  if (/\bTANF\b|Temporary Assistance for Needy Families|cash help/i.test(s)) {
    return { program: "TANF", lookAlike: null, oneTimeTanf: /One[- ]Time TANF/i.test(s) };
  }
  if (/\bCHIP\b/i.test(s)) return { program: null, lookAlike: "CHIP", oneTimeTanf: false };
  if (/\bMedicaid\b|Health Care Benefits|health care/i.test(s)) return { program: null, lookAlike: "MEDICAID", oneTimeTanf: false };
  if (/Healthy Texas Women|Medicare Savings/i.test(s)) return { program: null, lookAlike: "OTHER_HEALTH_CARE", oneTimeTanf: false };
  return null;
}

export interface AwardDraft {
  program: BenefitProgram | null;
  lookAlikeProgram: LookAlikeProgram | null;
  approvalStatus: ApprovalStatus;
  recipientName: string | null;
  householdMembers: string[];
  benefitPeriod: BenefitPeriod | null;
  caseNumberMasked: string | null;
  issuingAgency: string | null;
}

/** Keys whose confidence feeds `extractionConfidence` when present. */
export const AWARD_CORE_KEYS = ["letter_date", "program", "approval_status", "recipient_name"] as const;

/** Records the summary's values as fields too (so every value has provenance) and builds the summary. */
export function finishAward(b: ExtractionBuilder, draft: AwardDraft): AwardLetterSummary {
  const letterDate = b.value<string>("letter_date");
  return {
    program: draft.program,
    lookAlikeProgram: draft.lookAlikeProgram,
    letterDate,
    approvalStatus: draft.approvalStatus,
    recipientName: draft.recipientName,
    householdMembers: draft.householdMembers,
    benefitPeriod: draft.benefitPeriod,
    caseNumberMasked: draft.caseNumberMasked,
    issuingAgency: draft.issuingAgency,
    extractionConfidence: b.minConfidence(AWARD_CORE_KEYS),
    extractedBy: "parser",
  };
}

/** Reads the document's own date after `label` into `letter_date`, reporting missing and ambiguous dates. */
export function readLetterDate(
  ctx: ExtractContext,
  b: ExtractionBuilder,
  label: RegExp,
  confidence = CONF_VERIFIED,
  refs?: readonly LineRef[],
  required = true,
): void {
  const d = readLabeledDate(ctx.doc, label, refs);
  // A document that can never be accepted does not need a reviewer just because its date is unreadable.
  const problem = (code: "date_missing" | "date_ambiguous", message: string) => (required ? b.review(code, message) : b.warn(message));
  if (required) b.require("letter_date");
  if (!d) {
    problem("date_missing", "The document date could not be found.");
    return;
  }
  if (d.ambiguous) {
    b.set("letter_date", null, 0, d.ref);
    problem("date_ambiguous", `The document date "${d.raw}" can be read more than one way; a person must confirm it.`);
    return;
  }
  if (!d.date) {
    problem("date_missing", `The document date "${d.raw}" is not a valid date.`);
    return;
  }
  b.set("letter_date", d.date, confidence, d.ref);
}

/** Negative wording that, found anywhere in the evidence region, is recorded as a signal. */
export function recordNegativeWording(b: ExtractionBuilder, text: string, phrases: readonly RegExp[]): string[] {
  const hits: string[] = [];
  for (const re of phrases) {
    const m = re.exec(text);
    if (m) {
      hits.push(m[0]);
      b.signal(`negative wording: "${m[0]}"`);
    }
  }
  return hits;
}
