import { describe, expect, it } from "vitest";
import {
  DEPENDENT_DEDUCTION_CENTS_BY_INCOME_YEAR,
  dependentDeductionCents,
  getIncomeCategory,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_KEYS,
  INCOME_GROUP_LABELS,
  INCOME_STRUCTURAL_RULES,
  INCOME_TAXONOMY_VERSION,
  INCOME_TREATMENT_LABELS,
  incomeCategoryLabel,
  isIncomeCategoryKey,
  listIncomeCategories,
  type IncomeTreatment,
} from "./index";

/**
 * Second, independent transcription of the "counted" column of the Income Category Table in
 * docs/reference/hud-ami-and-annual-income.md (yes -> counted, no -> excluded, needs-review -> review;
 * the two "partial" rows and the "yes (amount basis needs-review)" row are counted with their own rule).
 * A change to a treatment has to be made here and in categories.ts, on purpose.
 */
const EXPECTED_TREATMENT: Record<string, IncomeTreatment> = {
  wages_salary: "counted",
  tips_commissions_bonuses_overtime: "counted",
  self_employment_net: "counted",
  gig_contractor_daylabor_seasonal: "counted",
  business_withdrawals: "review",
  minor_earned_income: "excluded",
  minor_head_or_spouse_income: "counted",
  dependent_ft_student_earned: "counted",
  military_pay_cash: "counted",
  military_hostile_fire_pay: "excluded",
  census_temp_employment: "excluded",
  training_program_earnings: "excluded",
  live_in_aide_income: "excluded",
  foster_member_income: "excluded",
  medicaid_caregiver_payments: "review",
  social_security: "counted",
  ss_ssi_va_lump_sum_backpay: "excluded",
  ssi: "counted",
  tanf_cash: "counted",
  unemployment: "counted",
  workers_comp: "excluded",
  disability_insurance_private: "review",
  pension_annuity: "counted",
  retirement_periodic_distributions: "counted",
  retirement_lump_sum_withdrawal: "review",
  va_compensation_pension: "counted",
  va_aid_and_attendance: "excluded",
  child_support_received: "counted",
  alimony_received: "counted",
  support_paid: "excluded",
  regular_contributions_from_outside: "review",
  adoption_assistance: "counted",
  foster_kinship_payments: "excluded",
  guaranteed_income_pilot: "review",
  severance_strike_other: "review",
  interest_dividends: "counted",
  rental_income_net: "counted",
  imputed_asset_return: "excluded",
  unrealized_appreciation: "excluded",
  realized_capital_gains: "review",
  retirement_account_internal_earnings: "excluded",
  education_savings_income: "excluded",
  trust_distributions: "review",
  tax_refunds_credits: "excluded",
  stimulus_recovery: "excluded",
  lottery_inheritance_lump_sum: "excluded",
  insurance_settlements: "excluded",
  injury_civil_settlements: "excluded",
  occasion_gifts: "excluded",
  crowdfunding: "review",
  loan_proceeds: "excluded",
  disaster_emergency_aid: "excluded",
  crime_victim_comp: "excluded",
  property_tax_rebates: "excluded",
  medical_reimbursements: "excluded",
  program_expense_reimbursements: "excluded",
  tribal_and_special_federal: "review",
  snap: "excluded",
  wic: "excluded",
  school_meals: "excluded",
  housing_assistance: "excluded",
  health_coverage: "excluded",
  liheap_childcare_subsidy: "excluded",
  employer_noncash_benefits: "excluded",
  in_kind_donations: "excluded",
  higher_ed_student_aid: "excluded",
  k12_scholarships: "review",
};

describe("income category registry", () => {
  it("contains exactly the rows of the research table, each with the transcribed treatment", () => {
    expect([...INCOME_CATEGORY_KEYS].sort()).toEqual(Object.keys(EXPECTED_TREATMENT).sort());
    for (const category of INCOME_CATEGORIES) {
      expect(category.treatment, category.key).toBe(EXPECTED_TREATMENT[category.key]);
    }
  });

  it("has stable snake_case keys with no duplicates", () => {
    expect(new Set(INCOME_CATEGORY_KEYS).size).toBe(INCOME_CATEGORY_KEYS.length);
    for (const key of INCOME_CATEGORY_KEYS) expect(key).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it("gives every category an English and a Spanish label, one-sentence help text and a citation", () => {
    for (const category of INCOME_CATEGORIES) {
      for (const locale of ["en", "es"] as const) {
        expect(category.label[locale].trim().length, `${category.key} label ${locale}`).toBeGreaterThan(2);
        const help = category.help[locale];
        expect(help, `${category.key} help ${locale}`).toMatch(/^[A-ZÁÉÍÓÚÑ].*\.$/);
        expect(help, `${category.key} help ${locale} is one line`).not.toContain("\n");
        // One sentence: no full stop followed by a new capitalised sentence.
        expect(help, `${category.key} help ${locale} is one sentence`).not.toMatch(/\.\s+[A-ZÁÉÍÓÚÑ]/);
      }
      expect(category.basis.trim().length, `${category.key} basis`).toBeGreaterThan(5);
    }
  });

  it("translates the help text (Spanish is never a copy of the English)", () => {
    for (const category of INCOME_CATEGORIES) expect(category.help.es, category.key).not.toBe(category.help.en);
  });

  it("cites 24 CFR 5.609 and/or the proposed section 25F rule for every category that is settled", () => {
    for (const category of INCOME_CATEGORIES.filter((c) => c.treatment !== "review")) {
      expect(category.basis, category.key).toMatch(/5\.609|1\.25F-3\(c\)\(6\)\(ii\)\(C\)|5\.611|89 FR 6126/);
    }
  });

  it("encodes the three changes the proposed rule makes to HUD annual income", () => {
    // Child support and alimony are included even though they are not in taxable income.
    for (const key of ["child_support_received", "alimony_received"]) {
      const category = getIncomeCategory(key)!;
      expect(category.treatment).toBe("counted");
      expect(category.basis).toContain("Prop. Reg. 1.25F-3(c)(6)(ii)(C)");
    }
    // Imputed returns on assets are disregarded.
    expect(getIncomeCategory("imputed_asset_return")!.treatment).toBe("excluded");
    expect(getIncomeCategory("imputed_asset_return")!.basis).toContain("Prop. Reg. 1.25F-3(c)(6)(ii)(C)");
    expect(getIncomeCategory("unrealized_appreciation")!.treatment).toBe("excluded");
    // Non-cash receipts are excluded; actual cash returns on assets still count.
    for (const key of ["snap", "wic", "housing_assistance", "health_coverage", "employer_noncash_benefits"]) {
      expect(getIncomeCategory(key)!.treatment, key).toBe("excluded");
      expect(getIncomeCategory(key)!.group, key).toBe("non_cash");
    }
    expect(getIncomeCategory("interest_dividends")!.treatment).toBe("counted");
  });

  it("records whose income each person-specific category applies to", () => {
    expect(getIncomeCategory("minor_earned_income")).toMatchObject({ appliesTo: "minor_not_head_or_spouse", treatment: "excluded", earned: true });
    expect(getIncomeCategory("minor_head_or_spouse_income")).toMatchObject({ appliesTo: "minor_head_or_spouse", treatment: "counted" });
    expect(getIncomeCategory("dependent_ft_student_earned")).toMatchObject({ appliesTo: "dependent_full_time_student", cappedAtDependentDeduction: true, earned: true });
    expect(getIncomeCategory("live_in_aide_income")).toMatchObject({ appliesTo: "live_in_aide", treatment: "excluded" });
    expect(getIncomeCategory("foster_member_income")).toMatchObject({ appliesTo: "foster_member", treatment: "excluded" });
    expect(getIncomeCategory("adoption_assistance")).toMatchObject({ appliesTo: "household", cappedAtDependentDeduction: true });
    expect(INCOME_CATEGORIES.filter((c) => c.cappedAtDependentDeduction).map((c) => c.key)).toEqual(["dependent_ft_student_earned", "adoption_assistance"]);
  });

  it("marks earned income per 24 CFR 5.100 and never marks a benefit or pension as earned", () => {
    for (const key of ["wages_salary", "tips_commissions_bonuses_overtime", "self_employment_net", "gig_contractor_daylabor_seasonal", "military_pay_cash"]) {
      expect(getIncomeCategory(key)!.earned, key).toBe(true);
    }
    for (const category of INCOME_CATEGORIES.filter((c) => c.group !== "earned")) expect(category.earned, category.key).toBe(false);
  });

  it("flags self-employment categories and allows a loss only where a loss has meaning", () => {
    expect(INCOME_CATEGORIES.filter((c) => c.selfEmployment).map((c) => c.key)).toEqual(["self_employment_net", "gig_contractor_daylabor_seasonal", "business_withdrawals"]);
    expect(INCOME_CATEGORIES.filter((c) => c.allowsNegative).map((c) => c.key)).toEqual(["self_employment_net", "gig_contractor_daylabor_seasonal", "rental_income_net"]);
  });

  it("never offers a deduction: support paid is recorded and not counted", () => {
    const paid = getIncomeCategory("support_paid")!;
    expect(paid.treatment).toBe("excluded");
    expect(paid.basis).toMatch(/No deduction/);
    expect(INCOME_STRUCTURAL_RULES.map((rule) => rule.key)).toEqual(["no_deductions", "period", "whose_income", "cash_only", "comparison"]);
  });

  it("looks categories up without throwing", () => {
    expect(isIncomeCategoryKey("wages_salary")).toBe(true);
    expect(isIncomeCategoryKey("adjusted_gross_income")).toBe(false);
    expect(isIncomeCategoryKey(42)).toBe(false);
    expect(getIncomeCategory("adjusted_gross_income")).toBeNull();
    expect(incomeCategoryLabel("child_support_received", "es")).toBe("Manutención de menores recibida");
    expect(incomeCategoryLabel("child_support_received")).toBe("Child support received");
    expect(incomeCategoryLabel("not_a_category", "es")).toBe("not_a_category");
  });

  it("filters for the intake form and the reviewer form", () => {
    const family = listIncomeCategories({ audience: "family" });
    expect(family.length).toBeGreaterThan(30);
    expect(family.every((c) => c.audience === "family")).toBe(true);
    for (const key of ["wages_salary", "child_support_received", "alimony_received", "ssi", "tanf_cash", "social_security", "regular_contributions_from_outside"]) {
      expect(family.map((c) => c.key), key).toContain(key);
    }
    // Asset values are never asked for, so the imputed-return rows are reviewer-only.
    expect(family.map((c) => c.key)).not.toContain("imputed_asset_return");
    expect(listIncomeCategories({ group: "non_cash", treatment: "excluded" }).length).toBe(9);
    expect(listIncomeCategories().length).toBe(INCOME_CATEGORIES.length);
    expect(listIncomeCategories({ treatment: "review" }).every((c) => c.reviewerNote !== null)).toBe(true);
  });

  it("labels groups and treatments in both languages", () => {
    for (const labels of [...Object.values(INCOME_GROUP_LABELS), ...Object.values(INCOME_TREATMENT_LABELS)]) {
      expect(labels.en.length).toBeGreaterThan(0);
      expect(labels.es.length).toBeGreaterThan(0);
    }
  });

  it("is immutable and versioned", () => {
    expect(INCOME_TAXONOMY_VERSION).toMatch(/^income-taxonomy\./);
    expect(Object.isFrozen(INCOME_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(INCOME_CATEGORIES[0])).toBe(true);
    expect(Object.isFrozen(INCOME_CATEGORIES[0].label)).toBe(true);
  });

  it("knows the HUD dependent deduction only for years the sources confirm", () => {
    expect(dependentDeductionCents(2024)).toBe(48_000);
    expect(dependentDeductionCents(2025)).toBeNull();
    expect(dependentDeductionCents(2026)).toBeNull();
    expect(Object.keys(DEPENDENT_DEDUCTION_CENTS_BY_INCOME_YEAR)).toEqual(["2024"]);
  });
});
