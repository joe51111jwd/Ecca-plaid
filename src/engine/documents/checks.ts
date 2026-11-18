/**
 * Checks that need context the document itself does not carry: the reference date of the verification and
 * the household roster. Both are optional inputs of `readDocument`; the decision service runs the
 * authoritative 12-month test, so these produce review reasons only, never a rejection.
 */
import { addDays, daysBetween, subtractMonths } from "./dates";
import { matchNameToHousehold, type HouseholdNameMatch, type HouseholdPerson } from "./names";
import type { Extraction, IsoDate, ReviewReason } from "./types";

/**
 * The 12-month window (P0 "Date rules"): `reference − 12 calendar months ≤ letter date ≤ reference`.
 * A letter within `marginDays` of the lower bound is `boundary_date` (inclusivity is not in the sources).
 * A printed benefit end before the reference date is `benefit_period_ended` (P0 `BENEFIT_NOT_ENDED`).
 */
export function checkAwardLetterDates(
  letterDate: IsoDate | null,
  benefitEnd: IsoDate | null,
  referenceDate: IsoDate,
  marginDays: number,
): ReviewReason[] {
  const out: ReviewReason[] = [];
  if (letterDate) {
    const lower = subtractMonths(referenceDate, 12);
    if (letterDate > referenceDate) {
      out.push({ code: "future_dated", message: "The letter is dated after the reference date." });
    } else if (letterDate < addDays(lower, -marginDays)) {
      out.push({ code: "stale_document", message: "The letter is dated more than 12 months before the reference date." });
    } else if (Math.abs(daysBetween(lower, letterDate)) <= marginDays) {
      out.push({ code: "boundary_date", message: "The letter is dated within a few days of the 12-month limit; a person must decide." });
    }
  }
  if (benefitEnd && benefitEnd < referenceDate) {
    out.push({ code: "benefit_period_ended", message: "The benefit period printed on the document ended before the reference date." });
  }
  return out;
}

export interface NameCheck {
  printedName: string;
  match: HouseholdNameMatch;
}

/** Matches every person the document names against the household; returns per-name results and reasons. */
export function checkNames(extraction: Extraction, household: readonly HouseholdPerson[]): { checks: NameCheck[]; reasons: ReviewReason[] } {
  const names = new Set<string>();
  if (extraction.award) {
    if (extraction.award.recipientName) names.add(extraction.award.recipientName);
    for (const n of extraction.award.householdMembers) names.add(n);
  }
  if (extraction.income) for (const p of extraction.income.people) if (p.role !== "dependent") names.add(p.name);
  const checks = [...names].map((printedName) => ({ printedName, match: matchNameToHousehold(printedName, household) }));
  const reasons: ReviewReason[] = [];
  if (checks.length === 0) return { checks, reasons };
  const best = checks.some((c) => c.match.grade === "exact" || c.match.grade === "strong")
    ? "good"
    : checks.some((c) => c.match.grade === "weak")
      ? "weak"
      : "none";
  if (best === "weak") reasons.push({ code: "name_weak_match", message: "The name on the document only partly matches a household member." });
  if (best === "none") reasons.push({ code: "name_not_in_household", message: "No one named on the document matches a household member." });
  if (checks.some((c) => c.match.ambiguous)) reasons.push({ code: "name_weak_match", message: "A name on the document matches more than one household member." });
  return { checks, reasons };
}

/**
 * Text addressed to a machine has no place in a benefit letter or a tax form. Its presence does not change
 * what is extracted (instructions in a document are data); it sends the document to a person.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /ignore (?:all |any )?(?:of )?(?:the )?(?:previous|prior|above|earlier|preceding) (?:instructions|directions|rules|prompts?)/i,
  /disregard (?:all |any )?(?:the )?(?:previous|prior|above|earlier) /i,
  /\bsystem prompt\b/i,
  /you are (?:now )?(?:an? )?(?:AI|assistant|language model|LLM)\b/i,
  /(?:mark|set|classify|treat|report|record) (?:this|the) (?:document|household|applicant|letter|family|case) as (?:approved|eligible|verified|valid)/i,
  /\b(?:AI|model|assistant|parser|reviewer)s?,? (?:must|should|please) (?:approve|accept|output|return)/i,
  /<\/?(?:system|instructions?|assistant)>/i,
];

export function findSuspiciousInstructions(text: string): string[] {
  return INSTRUCTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.slice(0, 40));
}
