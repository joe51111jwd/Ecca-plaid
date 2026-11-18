import { describe, expect, it } from "vitest";
import { evaluateCustody } from "./custody";
import type { CustodyInfo } from "./types";

const outcome = (custody: CustodyInfo | null) => {
  const evaluation = evaluateCustody(custody);
  return [evaluation.determination.outcome, evaluation.reason?.code ?? null, evaluation.reviewReason?.code ?? null];
};

describe("evaluateCustody", () => {
  it("treats an unanswered question as unanswered, not as one household", () => {
    expect(outcome(null)).toEqual(["not_answered", null, null]);
  });

  it("accepts a single household", () => {
    expect(outcome({ livesInMultipleHouseholds: false })).toEqual(["single_household", null, null]);
    expect(outcome({ livesInMultipleHouseholds: false, monthsInThisHousehold: 12, equalTime: false, thisHouseholdHasHigherIncome: null })).toEqual(["single_household", null, null]);
  });

  it("applies the longest-period rule only when more than half of the year was spent here", () => {
    expect(outcome({ livesInMultipleHouseholds: true, monthsInThisHousehold: 8 })).toEqual(["this_household_longest", "custody_this_household_longest", null]);
    expect(outcome({ livesInMultipleHouseholds: true, monthsInThisHousehold: 6.5, equalTime: false })).toEqual(["this_household_longest", "custody_this_household_longest", null]);
    expect(outcome({ livesInMultipleHouseholds: true, monthsInThisHousehold: 12 })).toEqual(["this_household_longest", "custody_this_household_longest", null]);
  });

  it("does not treat the longest stay as proven at six months or fewer: with three households it may or may not be", () => {
    for (const months of [6, 5, 4.5, 1, 0]) {
      expect(outcome({ livesInMultipleHouseholds: true, monthsInThisHousehold: months, equalTime: false }), String(months)).toEqual(["needs_review", null, "custody_time_unclear"]);
    }
  });

  it("flags multiple households with no usable answer about time", () => {
    expect(outcome({ livesInMultipleHouseholds: true })).toEqual(["needs_review", null, "custody_time_unclear"]);
    expect(outcome({ livesInMultipleHouseholds: true, monthsInThisHousehold: null, equalTime: null, notes: "It varies" })).toEqual(["needs_review", null, "custody_time_unclear"]);
  });

  it("applies the equal-time tie-break only when this household is the higher-income one", () => {
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "yes" })).toEqual(["this_household_equal_time_higher_income", "custody_equal_time_higher_income", null]);
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true, monthsInThisHousehold: 6, thisHouseholdHasHigherIncome: "yes" })).toEqual([
      "this_household_equal_time_higher_income",
      "custody_equal_time_higher_income",
      null,
    ]);
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "no" })).toEqual(["needs_review", null, "custody_equal_time_other_household_higher"]);
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "unknown" })).toEqual(["needs_review", null, "custody_equal_time_income_unknown"]);
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true })).toEqual(["needs_review", null, "custody_equal_time_income_unknown"]);
    // Equal time among three households is four months each.
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true, monthsInThisHousehold: 4, thisHouseholdHasHigherIncome: "yes" })[0]).toBe("this_household_equal_time_higher_income");
  });

  it("flags answers that contradict each other", () => {
    expect(outcome({ livesInMultipleHouseholds: true, equalTime: true, monthsInThisHousehold: 9, thisHouseholdHasHigherIncome: "yes" })).toEqual(["needs_review", null, "custody_answers_inconsistent"]);
    expect(outcome({ livesInMultipleHouseholds: false, equalTime: true })).toEqual(["needs_review", null, "custody_answers_inconsistent"]);
    expect(outcome({ livesInMultipleHouseholds: false, monthsInThisHousehold: 7 })).toEqual(["needs_review", null, "custody_answers_inconsistent"]);
  });

  it("keeps the facts as given and words every reason as a proposed rule", () => {
    const facts: CustodyInfo = { livesInMultipleHouseholds: true, monthsInThisHousehold: 3, notes: "Alternating weeks, then summer away" };
    const evaluation = evaluateCustody(facts);
    expect(evaluation.determination.facts).toEqual(facts);
    for (const custody of [facts, { livesInMultipleHouseholds: true, monthsInThisHousehold: 9 }, { livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "no" as const }]) {
      const result = evaluateCustody(custody);
      expect((result.reason ?? result.reviewReason)!.message).toContain("nder the proposed rules");
    }
  });
});
