/**
 * The shared-custody rule.
 *
 * Proposed Reg. 1.25F-3(c)(6)(ii)(B) (REG-117199-25, not final): when the student resides in more than one
 * household during the calendar year, "the relevant household is the one in which the student resides for
 * the longest period of time during the year or, if the time spent by the student in each household is
 * equal, then the household of the taxpayer with the highest household income".
 *
 * The rule is applied only when the facts the household gave make the answer certain. The text does not say
 * how time is measured or how the other household's income is to be known, so everything short of certain
 * goes to a person: shared custody is flagged, never guessed.
 *
 *   one household ............................................ this household
 *   more than half of the year here (over 6 of 12 months) ..... this household: no other can be longer
 *   equal time and this household has the higher income ....... this household
 *   anything else ............................................. review
 *
 * "Longest" is not "majority": with three households the longest stay can be under half the year. Six
 * months or fewer here therefore proves nothing either way and goes to review.
 */
import type { CustodyDetermination, CustodyInfo, CustodyReviewCode, DecisionReason, ReasonCode } from "./types";

const HALF_YEAR_MONTHS = 6;

const MESSAGES: Record<CustodyReviewCode | "custody_this_household_longest" | "custody_equal_time_higher_income", string> = {
  custody_this_household_longest:
    "The student lived in more than one household and spent more than half of the income year in this one, so under the proposed rules this is the relevant household.",
  custody_equal_time_higher_income:
    "The student spent equal time in more than one household and this household reported the higher income, so under the proposed rules this is the relevant household.",
  custody_time_unclear:
    "The student lived in more than one household and the answers do not establish that this is the household where the student lived longest. Under the proposed rules the household where the student lived longest is the one that counts.",
  custody_equal_time_income_unknown:
    "The student spent equal time in more than one household and it is not known which household has the higher income. Under the proposed rules the higher-income household is the one that counts.",
  custody_equal_time_other_household_higher:
    "The student spent equal time in more than one household and the other household has the higher income. Under the proposed rules that household's size and income are the ones that count, not this one's.",
  custody_answers_inconsistent: "The shared-custody answers contradict each other (for example equal time together with more than half of the year in this household).",
};

export interface CustodyEvaluation {
  determination: CustodyDetermination;
  /** Explains the determination when the shared-custody rule was applied; null for a single household. */
  reason: DecisionReason | null;
  /** Set when a person has to settle it. */
  reviewReason: DecisionReason | null;
}

function reason(code: ReasonCode & keyof typeof MESSAGES): DecisionReason {
  return { code, message: MESSAGES[code], memberIds: [], sourceIds: [] };
}

/** Applies the proposed shared-custody rule to the facts the household gave. */
export function evaluateCustody(custody: CustodyInfo | null): CustodyEvaluation {
  if (custody === null) return { determination: { outcome: "not_answered", facts: null }, reason: null, reviewReason: null };

  const settled = (outcome: "this_household_longest" | "this_household_equal_time_higher_income", code: keyof typeof MESSAGES & ReasonCode): CustodyEvaluation => ({
    determination: { outcome, facts: custody },
    reason: reason(code),
    reviewReason: null,
  });
  const review = (code: CustodyReviewCode): CustodyEvaluation => ({ determination: { outcome: "needs_review", facts: custody }, reason: null, reviewReason: reason(code) });

  const months = custody.monthsInThisHousehold ?? null;
  const equalTime = custody.equalTime === true;

  if (!custody.livesInMultipleHouseholds) {
    // "One household" together with a part-year stay or an equal-time answer is a contradiction, not a no.
    if (equalTime || (months !== null && months < 12)) return review("custody_answers_inconsistent");
    return { determination: { outcome: "single_household", facts: custody }, reason: null, reviewReason: null };
  }

  if (equalTime) {
    if (months !== null && months > HALF_YEAR_MONTHS) return review("custody_answers_inconsistent");
    if (custody.thisHouseholdHasHigherIncome === "yes") return settled("this_household_equal_time_higher_income", "custody_equal_time_higher_income");
    if (custody.thisHouseholdHasHigherIncome === "no") return review("custody_equal_time_other_household_higher");
    return review("custody_equal_time_income_unknown");
  }

  if (months !== null && months > HALF_YEAR_MONTHS) return settled("this_household_longest", "custody_this_household_longest");
  return review("custody_time_unclear");
}
