import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { computeHouseholdIncome, INCOME_CATEGORIES, INCOME_TAXONOMY_VERSION, type HouseholdMemberInput, type IncomeItemInput } from "./index";

/* Synthetic household. No real family data. */
const YEAR = 2026;
const maria: HouseholdMemberInput = { id: "hm_maria", firstName: "Maria", ageBand: "adult", headOrSpouse: true };
const daniel: HouseholdMemberInput = { id: "hm_daniel", firstName: "Daniel", ageBand: "adult", headOrSpouse: true };
const sofia: HouseholdMemberInput = { id: "hm_sofia", firstName: "Sofia", kind: "student", ageBand: "minor" };
const mateo: HouseholdMemberInput = { id: "hm_mateo", firstName: "Mateo", kind: "child", ageBand: "minor" };
const MEMBERS = [maria, daniel, sofia, mateo];

let seq = 0;
function item(partial: Partial<IncomeItemInput> & Pick<IncomeItemInput, "category" | "annualAmountCents">): IncomeItemInput {
  seq += 1;
  return { id: `inc_${seq}`, memberId: maria.id, incomeYear: YEAR, source: "document", documentId: `doc_${seq}`, ...partial };
}
const compute = (items: IncomeItemInput[], members: HouseholdMemberInput[] = MEMBERS, incomeYear = YEAR) => computeHouseholdIncome({ incomeYear, members, items });
const codes = (result: ReturnType<typeof compute>) => result.reviewFlags.map((flag) => flag.code);

describe("computeHouseholdIncome", () => {
  it("sums counted cash income in integer cents and keeps excluded items for the audit trail", () => {
    const result = compute([
      item({ category: "wages_salary", annualAmountCents: 5_200_000 }),
      item({ category: "wages_salary", annualAmountCents: 4_150_050, memberId: daniel.id }),
      item({ category: "child_support_received", annualAmountCents: 600_000 }),
      item({ category: "snap", annualAmountCents: 480_000 }),
      item({ category: "tax_refunds_credits", annualAmountCents: 310_000 }),
    ]);
    expect(result.totalCountedCents).toBe(9_950_050);
    expect(result.lowerBoundCents).toBe(9_950_050);
    expect(result.upperBoundCents).toBe(9_950_050);
    expect(result.counted.map((line) => line.category)).toEqual(["wages_salary", "wages_salary", "child_support_received"]);
    expect(result.excluded.map((line) => [line.category, line.reason, line.amountCents])).toEqual([
      ["snap", "excluded_category", 480_000],
      ["tax_refunds_credits", "excluded_category", 310_000],
    ]);
    expect(result.excluded[0].basis).toContain("non-cash receipts excluded");
    expect(result.reviewFlags).toEqual([]);
    expect(result.taxonomyVersion).toBe(INCOME_TAXONOMY_VERSION);
    expect(result.incomeYear).toBe(YEAR);
  });

  it("returns zero for a household with no items", () => {
    const result = compute([]);
    expect(result).toMatchObject({ totalCountedCents: 0, lowerBoundCents: 0, upperBoundCents: 0, perMember: [], counted: [], excluded: [], needsReview: [], reviewFlags: [] });
  });

  it("counts child support and alimony although they are not taxable, and never subtracts support paid", () => {
    const result = compute([
      item({ category: "wages_salary", annualAmountCents: 4_000_000 }),
      item({ category: "child_support_received", annualAmountCents: 720_000 }),
      item({ category: "alimony_received", annualAmountCents: 1_200_000 }),
      item({ category: "support_paid", annualAmountCents: 900_000, memberId: daniel.id }),
    ]);
    expect(result.totalCountedCents).toBe(5_920_000);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({ category: "support_paid", lowCents: 0, highCents: 0 });
    expect(result.excluded[0].basis).toMatch(/No deduction/);
  });

  it("never counts an imputed return or unrealized appreciation, but counts interest actually paid", () => {
    const result = compute([
      item({ category: "imputed_asset_return", annualAmountCents: 2_500_000 }),
      item({ category: "unrealized_appreciation", annualAmountCents: 9_000_000 }),
      item({ category: "interest_dividends", annualAmountCents: 12_345 }),
    ]);
    expect(result.totalCountedCents).toBe(12_345);
    expect(result.upperBoundCents).toBe(12_345);
  });

  it("keeps an item for another year out of the total and says why", () => {
    const result = compute([item({ category: "wages_salary", annualAmountCents: 6_000_000, incomeYear: 2025 }), item({ category: "wages_salary", annualAmountCents: 5_000_000 })]);
    expect(result.totalCountedCents).toBe(5_000_000);
    expect(result.excluded[0]).toMatchObject({ reason: "excluded_different_year", amountCents: 6_000_000, incomeYear: 2025 });
    expect(result.excluded[0].basis).toContain("calendar year 2026");
  });

  describe("whose income counts", () => {
    it("excludes a child's earned income and counts a child's unearned income", () => {
      const result = compute([
        item({ category: "wages_salary", annualAmountCents: 320_000, memberId: sofia.id }),
        item({ category: "self_employment_net", annualAmountCents: 80_000, memberId: sofia.id }),
        item({ category: "social_security", annualAmountCents: 1_080_000, memberId: mateo.id }),
        item({ category: "minor_earned_income", annualAmountCents: 50_000, memberId: mateo.id }),
      ]);
      expect(result.totalCountedCents).toBe(1_080_000);
      expect(result.excluded.map((line) => line.reason)).toEqual(["excluded_minor_earned_income", "excluded_minor_earned_income", "excluded_category"]);
      expect(result.excluded[0].basis).toContain("5.609(b)(3)");
      // A child's lawn-mowing business is excluded outright, so it needs no self-employment review.
      expect(result.reviewFlags).toEqual([]);
    });

    it("counts everything for a head of household or spouse under 18, with a bounded flag", () => {
      const teenParent: HouseholdMemberInput = { id: "hm_teen", firstName: "Ana", ageBand: "minor", headOrSpouse: true };
      const result = compute(
        [item({ category: "wages_salary", annualAmountCents: 1_800_000, memberId: teenParent.id }), item({ category: "tanf_cash", annualAmountCents: 300_000, memberId: teenParent.id })],
        [teenParent, mateo],
      );
      expect(result.totalCountedCents).toBe(2_100_000);
      expect(result.upperBoundCents).toBe(2_100_000);
      expect(result.lowerBoundCents).toBe(300_000);
      expect(result.reviewFlags).toHaveLength(1);
      expect(result.reviewFlags[0]).toMatchObject({ code: "minor_head_or_spouse_income", severity: "bounded", memberIds: ["hm_teen"] });
    });

    it("does not guess when it is not known whether a member is 18", () => {
      const cousin: HouseholdMemberInput = { id: "hm_cousin", firstName: "Luis", kind: "other", ageBand: "unknown" };
      const result = compute(
        [item({ category: "wages_salary", annualAmountCents: 2_400_000, memberId: cousin.id }), item({ category: "ssi", annualAmountCents: 900_000, memberId: cousin.id })],
        [maria, cousin],
      );
      // Unearned income counts at any age; earned income waits for the answer.
      expect(result.totalCountedCents).toBe(900_000);
      expect(result.lowerBoundCents).toBe(900_000);
      expect(result.upperBoundCents).toBe(3_300_000);
      expect(result.needsReview[0]).toMatchObject({ reason: "review_member_age_unknown", lowCents: 0, highCents: 2_400_000 });
      expect(codes(result)).toEqual(["member_age_unknown"]);
    });

    it("counts a dependent full-time student's earnings only up to the HUD dependent deduction when the amount is confirmed", () => {
      const student: HouseholdMemberInput = { id: "hm_student", firstName: "Elena", ageBand: "adult", fullTimeStudent: true };
      const result = compute([item({ category: "wages_salary", annualAmountCents: 900_000, memberId: student.id, incomeYear: 2024 })], [maria, student], 2024);
      expect(result.totalCountedCents).toBe(48_000);
      expect(result.lowerBoundCents).toBe(48_000);
      expect(result.upperBoundCents).toBe(48_000);
      expect(result.counted[0]).toMatchObject({ reason: "counted_up_to_dependent_deduction", amountCents: 48_000 });
      expect(result.excluded[0]).toMatchObject({ reason: "excluded_above_dependent_deduction", amountCents: 852_000 });
      expect(result.counted[0].itemId).toBe(result.excluded[0].itemId);
      expect(result.reviewFlags).toEqual([]);
    });

    it("counts all of a small student wage that is under the dependent deduction", () => {
      const student: HouseholdMemberInput = { id: "hm_student", firstName: "Elena", ageBand: "adult", fullTimeStudent: true };
      const result = compute([item({ category: "dependent_ft_student_earned", annualAmountCents: 30_000, memberId: student.id, incomeYear: 2024 })], [maria, student], 2024);
      expect(result.totalCountedCents).toBe(30_000);
      expect(result.excluded).toEqual([]);
    });

    it("puts a student's earnings in the upper bound only when the deduction amount for the year is not in the sources", () => {
      const student: HouseholdMemberInput = { id: "hm_student", firstName: "Elena", ageBand: "adult", fullTimeStudent: true };
      const result = compute([item({ category: "wages_salary", annualAmountCents: 900_000, memberId: student.id })], [maria, student]);
      expect(result.totalCountedCents).toBe(0);
      expect(result.lowerBoundCents).toBe(0);
      expect(result.upperBoundCents).toBe(900_000);
      expect(result.needsReview[0].reason).toBe("review_dependent_deduction_unconfirmed");
      expect(result.reviewFlags[0]).toMatchObject({ code: "dependent_deduction_amount_unconfirmed", severity: "bounded" });
    });

    it("does not apply the student rule to a head of household or spouse who studies full time", () => {
      const result = compute([item({ category: "wages_salary", annualAmountCents: 900_000 })], [{ ...maria, fullTimeStudent: true }]);
      expect(result.totalCountedCents).toBe(900_000);
    });

    it("caps adoption assistance the same way", () => {
      const result = compute([item({ category: "adoption_assistance", annualAmountCents: 600_000, incomeYear: 2024 })], MEMBERS, 2024);
      expect(result.totalCountedCents).toBe(48_000);
      expect(compute([item({ category: "adoption_assistance", annualAmountCents: 600_000 })]).upperBoundCents).toBe(600_000);
    });

    it("excludes all income of a foster member or live-in aide", () => {
      const aide: HouseholdMemberInput = { id: "hm_aide", firstName: "Rosa", ageBand: "adult", role: "live_in_aide" };
      const foster: HouseholdMemberInput = { id: "hm_foster", firstName: "Leo", ageBand: "minor", role: "foster" };
      const result = compute(
        [
          item({ category: "wages_salary", annualAmountCents: 3_000_000, memberId: aide.id }),
          item({ category: "live_in_aide_income", annualAmountCents: 100_000, memberId: aide.id }),
          item({ category: "social_security", annualAmountCents: 700_000, memberId: foster.id }),
        ],
        [maria, aide, foster],
      );
      expect(result.totalCountedCents).toBe(0);
      expect(result.upperBoundCents).toBe(0);
      expect(result.excluded.every((line) => line.reason === "excluded_foster_or_live_in_aide")).toBe(true);
      expect(result.excluded[0].basis).toContain("5.609(b)(8)");
    });

    it("counts an unrelated housemate's income but leaves it out of the lower bound", () => {
      const roommate: HouseholdMemberInput = { id: "hm_roommate", firstName: "Sam", ageBand: "adult", role: "unrelated" };
      const result = compute(
        [item({ category: "wages_salary", annualAmountCents: 4_000_000 }), item({ category: "wages_salary", annualAmountCents: 3_500_000, memberId: roommate.id })],
        [maria, roommate],
      );
      expect(result.totalCountedCents).toBe(7_500_000);
      expect(result.lowerBoundCents).toBe(4_000_000);
      expect(result.upperBoundCents).toBe(7_500_000);
      expect(result.reviewFlags[0]).toMatchObject({ code: "unrelated_member_income", severity: "bounded" });
    });

    it("sends an item filed under a person-specific category for the wrong person to review", () => {
      const result = compute([
        item({ category: "minor_earned_income", annualAmountCents: 4_000_000 }), // an adult's wages filed as a child's
        item({ category: "live_in_aide_income", annualAmountCents: 2_000_000, memberId: daniel.id }),
        item({ category: "foster_member_income", annualAmountCents: 1_000_000, memberId: null }),
      ]);
      expect(result.totalCountedCents).toBe(0);
      expect(result.upperBoundCents).toBe(7_000_000);
      expect(result.needsReview.every((line) => line.reason === "review_category_member_mismatch")).toBe(true);
      expect(result.reviewFlags.map((flag) => [flag.code, flag.severity])).toEqual([
        ["category_member_mismatch", "blocking"],
        ["category_member_mismatch", "blocking"],
        ["category_member_mismatch", "blocking"],
      ]);
    });

    it("blocks on an item that names someone who is not on the roster", () => {
      const result = compute([item({ category: "wages_salary", annualAmountCents: 5_000_000, memberId: "hm_ghost" })]);
      expect(result.totalCountedCents).toBe(0);
      expect(result.upperBoundCents).toBe(5_000_000);
      expect(result.reviewFlags[0]).toMatchObject({ code: "income_item_unknown_member", severity: "blocking" });
      const joint = compute([item({ category: "wages_salary", annualAmountCents: 5_000_000, alsoCoversMemberIds: ["hm_ghost"] })]);
      expect(codes(joint)).toEqual(["income_item_unknown_member"]);
    });

    it("counts a joint-return figure once and attributes it to the first spouse", () => {
      const result = compute([item({ category: "wages_salary", annualAmountCents: 11_000_000, alsoCoversMemberIds: [daniel.id] })]);
      expect(result.totalCountedCents).toBe(11_000_000);
      expect(result.counted[0].alsoCoversMemberIds).toEqual([daniel.id]);
      expect(result.perMember).toEqual([{ memberId: maria.id, countedCents: 11_000_000, lowerBoundCents: 11_000_000, upperBoundCents: 11_000_000, itemIds: [result.counted[0].itemId] }]);
    });
  });

  describe("open treatments become bounds, not guesses", () => {
    it("puts a review-category amount in the upper bound only", () => {
      const result = compute([item({ category: "wages_salary", annualAmountCents: 5_000_000 }), item({ category: "realized_capital_gains", annualAmountCents: 2_000_000 })]);
      expect(result.totalCountedCents).toBe(5_000_000);
      expect(result.lowerBoundCents).toBe(5_000_000);
      expect(result.upperBoundCents).toBe(7_000_000);
      expect(result.needsReview).toHaveLength(1);
      expect(result.needsReview[0]).toMatchObject({ reason: "review_category", treatment: "review", lowCents: 0, highCents: 2_000_000 });
      expect(result.reviewFlags[0]).toMatchObject({ code: "income_category_needs_review", severity: "bounded" });
    });

    it("treats every review category the same way", () => {
      for (const category of INCOME_CATEGORIES.filter((c) => c.treatment === "review" && c.appliesTo === "household")) {
        const result = compute([item({ category: category.key, annualAmountCents: 100_000 })]);
        expect(result.totalCountedCents, category.key).toBe(0);
        expect(result.lowerBoundCents, category.key).toBe(0);
        expect(result.upperBoundCents, category.key).toBe(100_000);
        expect(codes(result), category.key).toContain("income_category_needs_review");
      }
    });

    it("carries an item's own low and high figures (Form W-2 box 1 against gross pay)", () => {
      const result = compute([item({ category: "wages_salary", annualAmountCents: 30_500_000, lowCents: 30_500_000, highCents: 33_000_000 })]);
      expect(result.totalCountedCents).toBe(30_500_000);
      expect(result.lowerBoundCents).toBe(30_500_000);
      expect(result.upperBoundCents).toBe(33_000_000);
      expect(result.reviewFlags[0]).toMatchObject({ code: "amount_basis_unsettled", severity: "bounded" });
    });

    it("sends an unknown category to review instead of dropping it", () => {
      const result = compute([item({ category: "adjusted_gross_income", annualAmountCents: 8_000_000 })]);
      expect(result.totalCountedCents).toBe(0);
      expect(result.upperBoundCents).toBe(8_000_000);
      expect(result.needsReview[0].reason).toBe("review_unknown_category");
      expect(result.reviewFlags[0]).toMatchObject({ code: "unknown_income_category", severity: "bounded" });
    });
  });

  describe("self-employment", () => {
    it("counts reported net income and always raises a blocking flag", () => {
      const result = compute([item({ category: "self_employment_net", annualAmountCents: 3_800_000 }), item({ category: "gig_contractor_daylabor_seasonal", annualAmountCents: 600_000, memberId: daniel.id })]);
      expect(result.totalCountedCents).toBe(4_400_000);
      expect(result.reviewFlags.map((flag) => [flag.code, flag.severity])).toEqual([
        ["self_employment_income", "blocking"],
        ["self_employment_income", "blocking"],
      ]);
      expect(result.reviewFlags[0].message).toContain("5.609(b)(28)");
    });

    it("does not subtract a net loss from other income", () => {
      const result = compute([item({ category: "wages_salary", annualAmountCents: 6_000_000 }), item({ category: "self_employment_net", annualAmountCents: -1_500_000 })]);
      expect(result.totalCountedCents).toBe(6_000_000);
      expect(result.upperBoundCents).toBe(6_000_000);
      expect(result.lowerBoundCents).toBe(4_500_000);
      expect(result.excluded[0]).toMatchObject({ reason: "excluded_net_loss_not_offset", amountCents: -1_500_000 });
      expect(codes(result)).toEqual(["self_employment_income", "net_loss_not_offset"]);
    });

    it("blocks on business withdrawals as well", () => {
      const result = compute([item({ category: "business_withdrawals", annualAmountCents: 1_000_000 })]);
      expect(codes(result)).toEqual(["self_employment_income", "income_category_needs_review"]);
      expect(result.upperBoundCents).toBe(1_000_000);
    });

    it("accepts net and gross rent as the low and high figures", () => {
      const result = compute([item({ category: "rental_income_net", annualAmountCents: 900_000, lowCents: 900_000, highCents: 1_800_000 })]);
      expect([result.lowerBoundCents, result.totalCountedCents, result.upperBoundCents]).toEqual([900_000, 900_000, 1_800_000]);
    });
  });

  it("reports per-member figures in roster order, then unattributed items", () => {
    const result = compute([
      item({ category: "interest_dividends", annualAmountCents: 10_000, memberId: null }),
      item({ category: "wages_salary", annualAmountCents: 4_000_000, memberId: daniel.id }),
      item({ category: "wages_salary", annualAmountCents: 5_000_000 }),
      item({ category: "disability_insurance_private", annualAmountCents: 700_000 }),
    ]);
    expect(result.perMember.map((entry) => [entry.memberId, entry.countedCents, entry.lowerBoundCents, entry.upperBoundCents])).toEqual([
      [maria.id, 5_000_000, 5_000_000, 5_700_000],
      [daniel.id, 4_000_000, 4_000_000, 4_000_000],
      [null, 10_000, 10_000, 10_000],
    ]);
  });

  it("flags carry the item, the member and the document but never a name", () => {
    const result = compute([item({ id: "inc_x", category: "self_employment_net", annualAmountCents: 100, documentId: "doc_x", alsoCoversMemberIds: [daniel.id] })]);
    expect(result.reviewFlags[0]).toMatchObject({ itemId: "inc_x", memberIds: [maria.id, daniel.id], sourceIds: ["doc_x"] });
    for (const flag of result.reviewFlags) expect(flag.message).not.toMatch(/Maria|Daniel/);
  });

  it("holds its arithmetic invariants over generated inputs", () => {
    let state = 20261118;
    const next = (bound: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % bound;
    };
    const keys = INCOME_CATEGORIES.map((category) => category.key);
    const everyone: HouseholdMemberInput[] = [
      maria,
      daniel,
      sofia,
      { id: "hm_student", firstName: "Elena", ageBand: "adult", fullTimeStudent: true },
      { id: "hm_unknown", firstName: "Luis", ageBand: "unknown" },
      { id: "hm_aide", firstName: "Rosa", ageBand: "adult", role: "live_in_aide" },
      { id: "hm_roommate", firstName: "Sam", ageBand: "adult", role: "unrelated" },
    ];
    for (let run = 0; run < 300; run++) {
      const items: IncomeItemInput[] = [];
      for (let i = 0; i < 1 + next(8); i++) {
        const amount = next(40_000_000);
        const spread = next(3) === 0 ? next(5_000_000) : 0;
        const memberIndex = next(everyone.length + 1);
        items.push({
          id: `g${run}_${i}`,
          memberId: memberIndex === everyone.length ? null : everyone[memberIndex].id,
          category: keys[next(keys.length)],
          incomeYear: next(6) === 0 ? 2025 : YEAR,
          annualAmountCents: amount,
          lowCents: amount - Math.min(amount, spread),
          highCents: amount + spread,
          source: "document",
          documentId: `d${run}_${i}`,
        });
      }
      const result = compute(items, everyone);
      const all = [...result.counted, ...result.excluded, ...result.needsReview];
      expect(result.totalCountedCents).toBe(result.counted.reduce((total, line) => total + line.amountCents, 0));
      expect(result.lowerBoundCents).toBe(all.reduce((total, line) => total + line.lowCents, 0));
      expect(result.upperBoundCents).toBe(all.reduce((total, line) => total + line.highCents, 0));
      expect(result.lowerBoundCents).toBeLessThanOrEqual(result.totalCountedCents);
      expect(result.totalCountedCents).toBeLessThanOrEqual(result.upperBoundCents);
      // Every part of every item is accounted for exactly once.
      for (const source of items) {
        expect(all.filter((line) => line.itemId === source.id).reduce((total, line) => total + line.amountCents, 0)).toBe(source.annualAmountCents);
      }
      expect(result.perMember.reduce((total, entry) => total + entry.countedCents, 0)).toBe(result.totalCountedCents);
      expect(Number.isSafeInteger(result.upperBoundCents)).toBe(true);
      expect(compute(items, everyone)).toEqual(result);
    }
  });

  describe("input validation", () => {
    const invalidInputs: Array<[string, () => unknown]> = [
      ["a negative wage", () => compute([item({ category: "wages_salary", annualAmountCents: -1 })])],
      ["a negative amount in an unknown category", () => compute([item({ category: "mystery", annualAmountCents: -1 })])],
      ["fractional cents", () => compute([item({ category: "wages_salary", annualAmountCents: 100.5 })])],
      ["an amount beyond the supported range", () => compute([item({ category: "wages_salary", annualAmountCents: 2_000_000_000_000 })])],
      ["a low figure above the recorded figure", () => compute([item({ category: "wages_salary", annualAmountCents: 100, lowCents: 200 })])],
      ["a high figure below the recorded figure", () => compute([item({ category: "wages_salary", annualAmountCents: 100, highCents: 50 })])],
      ["duplicate item ids", () => compute([item({ id: "same", category: "wages_salary", annualAmountCents: 1 }), item({ id: "same", category: "wages_salary", annualAmountCents: 1 })])],
      ["duplicate member ids", () => compute([], [maria, maria])],
      ["an unknown field on an item", () => compute([{ ...item({ category: "wages_salary", annualAmountCents: 1 }), counted: true } as unknown as IncomeItemInput])],
      ["a missing income year", () => computeHouseholdIncome({ members: MEMBERS, items: [] } as unknown as Parameters<typeof computeHouseholdIncome>[0])],
      ["a member covered twice by one item", () => compute([item({ category: "wages_salary", annualAmountCents: 1, alsoCoversMemberIds: [maria.id] })])],
    ];
    it.each(invalidInputs)("rejects %s", (_name, run) => {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("validation_failed");
    });
  });
});
