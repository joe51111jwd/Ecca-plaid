/**
 * The section 25F constants: values, authority tags and citations.
 * Expected values are the ones in docs/reference/donor-credit-rules.md (fact ids in the test names).
 */
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { AUTHORITIES, AUTHORITY_INFO, isAuthority, rule } from "./authority";
import {
  ACKNOWLEDGMENT_DEADLINE,
  CARRYFORWARD_USED_BEFORE_CURRENT_YEAR_CREDIT,
  CARRYFORWARD_USE_ORDER,
  CARRYFORWARD_YEARS,
  CASH_PAYMENT_METHODS,
  CLAIM_FORM,
  CLAIM_FORM_FIRST_FILING_SEASON,
  CREDIT_CAP_PER_TAXPAYER_CENTS,
  DEFAULT_FEE_STRUCTURE,
  DIGITAL_ASSET_PAYMENT_METHODS,
  ELIGIBLE_CURRENCY,
  FIRST_ELIGIBLE_DATE,
  IRS_CONTRIBUTION_REPORT_DEADLINE,
  JOINT_RETURN_MAX_CREDIT_CENTS,
  JOINT_RETURN_SPOUSES_ARE_SEPARATE_TAXPAYERS,
  LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS,
  NO_DOUBLE_BENEFIT,
  RULES,
  RULE_IDS,
  STATE_CREDIT_ABSORPTION_ORDER,
  STATE_CREDIT_REDUCES_CREDIT,
  STATE_CREDIT_REDUCTION_BEFORE_CAP,
  STATE_SGO_LIST_DEADLINE_2027,
  TAXMATH_VERSION,
  UNCREDITED_PORTION_DEDUCTIBILITY,
  acknowledgmentDueDate,
  getRule,
  irsContributionReportDueDate,
  lastCarryforwardYear,
  rulesFingerprint,
  type RuleId,
} from "./constants";

/**
 * The fingerprint of the rules for each published TAXMATH_VERSION. If this test fails you changed a value,
 * an authority tag or a citation: bump TAXMATH_VERSION in constants.ts and add the new fingerprint here.
 */
const PUBLISHED_RULE_FINGERPRINTS: Record<string, string> = {
  "25f-taxmath.2026-11-18.v1": "603d9c836ec8d87e794a85c7e352380bca0bde86615e2ed14e12e65f55490240",
  // v2: same rule values; algorithm changes (live eligibility floored at FIRST_ELIGIBLE_DATE, pre-2027 carryforwards refused).
  "25f-taxmath.2026-11-18.v2": "603d9c836ec8d87e794a85c7e352380bca0bde86615e2ed14e12e65f55490240",
};

describe("values from the statute", () => {
  it("F11: the cap is $1,700 per taxpayer per taxable year", () => {
    expect(CREDIT_CAP_PER_TAXPAYER_CENTS).toMatchObject({ value: 170_000, authority: "statute" });
    expect(CREDIT_CAP_PER_TAXPAYER_CENTS.citation).toContain("shall not exceed $1,700");
  });

  it("F32: five-year carryforward, first in first out", () => {
    expect(CARRYFORWARD_YEARS).toMatchObject({ value: 5, authority: "statute" });
    expect(CARRYFORWARD_USE_ORDER).toMatchObject({ value: "first_in_first_out", authority: "statute" });
    expect(lastCarryforwardYear(2027)).toBe(2032);
  });

  it("F22, F35: State-credit reduction and no double benefit", () => {
    expect(STATE_CREDIT_REDUCES_CREDIT).toMatchObject({ value: true, authority: "statute" });
    expect(NO_DOUBLE_BENEFIT).toMatchObject({ value: true, authority: "statute" });
  });
});

describe("values that exist only in the proposed regulations are tagged proposed_reg", () => {
  it("F13, F15, F23, F30, F33, F37: joint returns, State-credit ordering, liability detail, carryforward ordering, section 170", () => {
    expect(JOINT_RETURN_SPOUSES_ARE_SEPARATE_TAXPAYERS).toMatchObject({ value: true, authority: "proposed_reg" });
    expect(JOINT_RETURN_MAX_CREDIT_CENTS).toMatchObject({ value: 340_000, authority: "proposed_reg" });
    expect(JOINT_RETURN_MAX_CREDIT_CENTS.value).toBe(2 * CREDIT_CAP_PER_TAXPAYER_CENTS.value);
    expect(STATE_CREDIT_REDUCTION_BEFORE_CAP).toMatchObject({ value: true, authority: "proposed_reg" });
    expect(STATE_CREDIT_ABSORPTION_ORDER).toMatchObject({ value: "non_qualified_contributions_first", authority: "proposed_reg" });
    expect(LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS).toMatchObject({ value: ["21", "22", "24", "25", "25A", "25B", "25C", "25E"], authority: "proposed_reg" });
    expect(CARRYFORWARD_USED_BEFORE_CURRENT_YEAR_CREDIT).toMatchObject({ value: true, authority: "proposed_reg" });
    expect(UNCREDITED_PORTION_DEDUCTIBILITY).toMatchObject({ value: "may_be_deductible_only_if_section_170_requirements_are_met", authority: "proposed_reg" });
    expect(CLAIM_FORM).toMatchObject({ value: { number: "8525", name: "Form 8525", title: "Federal Scholarship Tax Credit" }, authority: "proposed_reg" });
  });
});

describe("dates and the compliance calendar", () => {
  it("F61: qualified contributions can begin on January 1, 2027", () => {
    expect(FIRST_ELIGIBLE_DATE).toMatchObject({ value: "2027-01-01", authority: "temporary_reg" });
    expect(FIRST_ELIGIBLE_DATE.citation).toContain("Taxpayers may begin making qualified contributions on January 1, 2027");
  });

  it("F68, F70: acknowledgment by January 31 and IRS report by February 28 of the following year", () => {
    expect(ACKNOWLEDGMENT_DEADLINE).toMatchObject({ value: { month: 1, day: 31, yearsAfterContribution: 1 }, authority: "temporary_reg" });
    expect(IRS_CONTRIBUTION_REPORT_DEADLINE).toMatchObject({ value: { month: 2, day: 28, yearsAfterContribution: 1 }, authority: "temporary_reg" });
    expect(acknowledgmentDueDate(2027)).toBe("2028-01-31");
    expect(irsContributionReportDueDate(2027)).toBe("2028-02-28");
    // 2028 is a leap year: the deadline is still the literal 28th.
    expect(irsContributionReportDueDate(2027)).not.toBe("2028-02-29");
    expect(acknowledgmentDueDate(2031)).toBe("2032-01-31");
    for (const bad of [27, 2027.5, Number.NaN, 10_000, -2027]) {
      expect(() => acknowledgmentDueDate(bad)).toThrow(AppError);
      expect(() => irsContributionReportDueDate(bad)).toThrow(AppError);
    }
  });

  it("F58, F65: the 2027 State-list deadline and the first Form 8525 filing season", () => {
    expect(STATE_SGO_LIST_DEADLINE_2027).toMatchObject({ value: "2027-02-15", authority: "temporary_reg" });
    expect(CLAIM_FORM_FIRST_FILING_SEASON).toMatchObject({ value: 2028, authority: "irs_web" });
  });
});

describe("F44: cash", () => {
  it("maps accepted payment methods to the regulation's categories and excludes digital assets", () => {
    expect(ELIGIBLE_CURRENCY).toMatchObject({ value: "usd", authority: "temporary_reg" });
    expect(CASH_PAYMENT_METHODS.authority).toBe("temporary_reg");
    expect(new Set(Object.values(CASH_PAYMENT_METHODS.value))).toEqual(
      new Set(["physical_currency", "check", "money_order", "electronic_transfer", "after_tax_payroll_deduction"]),
    );
    expect(CASH_PAYMENT_METHODS.value.card).toBe("electronic_transfer");
    expect(DIGITAL_ASSET_PAYMENT_METHODS.authority).toBe("temporary_reg");
    for (const method of DIGITAL_ASSET_PAYMENT_METHODS.value) expect(Object.keys(CASH_PAYMENT_METHODS.value)).not.toContain(method);
  });
});

describe("the registry", () => {
  it("every rule carries a value, a valid authority and a citation, and cannot be mutated", () => {
    expect(RULE_IDS.length).toBeGreaterThan(40);
    expect(Object.keys(RULES)).toEqual([...RULE_IDS]);
    for (const id of RULE_IDS) {
      const entry = getRule(id);
      expect(entry.value, id).not.toBeUndefined();
      expect(AUTHORITIES, id).toContain(entry.authority);
      expect(entry.citation.length, id).toBeGreaterThan(30);
      expect(Object.keys(entry).sort(), id).toEqual(["authority", "citation", "value"]);
      expect(Object.isFrozen(entry), id).toBe(true);
      if (typeof entry.value === "object" && entry.value !== null) expect(Object.isFrozen(entry.value), id).toBe(true);
    }
    expect(Object.isFrozen(RULES)).toBe(true);
    expect(() => {
      (CREDIT_CAP_PER_TAXPAYER_CENTS as { value: number }).value = 1;
    }).toThrow(TypeError);
    expect(() => {
      (LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS.value as unknown as string[]).push("23");
    }).toThrow(TypeError);
    expect(CREDIT_CAP_PER_TAXPAYER_CENTS.value).toBe(170_000);
  });

  it("each citation names the document its authority tag stands for", () => {
    const expected: Record<string, RegExp> = {
      statute: /26 U\.S\.C\. 25F/,
      temporary_reg: /T\.D\. 10057/,
      proposed_reg: /REG-117199-25/,
      irs_web: /irs\.gov/,
      // A policy still says where the gap is: the build spec or the research notes.
      product_policy: /[Bb]uild spec|docs\/reference\//,
    };
    for (const id of RULE_IDS) expect(RULES[id].citation, `${id} (${RULES[id].authority})`).toMatch(expected[RULES[id].authority]);
  });

  it("a rule whose citation leans on the proposed regulations is never tagged as statute or temporary regulation", () => {
    for (const id of RULE_IDS) {
      const { authority, citation } = RULES[id];
      if (/Prop\. Treas\. Reg\./.test(citation) && authority !== "proposed_reg") {
        // Allowed only where the proposed text is quoted as a description or an extrapolation base, never as the rule's authority.
        expect(["statute", "product_policy"], id).toContain(authority);
        if (authority === "statute") expect(citation, id).toMatch(/^26 U\.S\.C\. 25F/);
      }
    }
  });

  it("every product policy is labeled as policy: the conservative gates, the fee rules and the pre-fills", () => {
    const policies: RuleId[] = [
      "stateCreditPartialSpillover",
      "jointStateCreditAllocation",
      "jointCarryforwardTracking",
      "liabilityEstimateSource",
      "dateBegunEverywhereTimeZone",
      "dateBegunAnywhereTimeZone",
      "taxYearBasis",
      "yearEndNoticeStart",
      "provisionalListIsNotCreditEligible",
      "portalRegistrationRequiredForCreditPath",
      "unauthorizedPublicListingHandling",
      "unrecognizedPaymentMethodHandling",
      "defaultFeeStructure",
      "feeStructuresRequiringCounselMemo",
      "feeBase",
      "feeRounding",
      "defaultDesignation",
      "jointDefaultSplit",
    ];
    expect(RULE_IDS.filter((id) => RULES[id].authority === "product_policy").sort()).toEqual([...policies].sort());
    expect(DEFAULT_FEE_STRUCTURE.value).toBe("none");
  });

  it("authority tags are described, and rule() builds a frozen rule", () => {
    expect(AUTHORITIES).toEqual(["statute", "temporary_reg", "proposed_reg", "irs_web", "product_policy"]);
    for (const authority of AUTHORITIES) {
      expect(AUTHORITY_INFO[authority].label.length).toBeGreaterThan(3);
      expect(AUTHORITY_INFO[authority].standing.length).toBeGreaterThan(10);
      expect(isAuthority(authority)).toBe(true);
    }
    expect(AUTHORITY_INFO.proposed_reg.standing).toMatch(/Not law/);
    expect(AUTHORITY_INFO.product_policy.standing).toMatch(/Not a legal rule/);
    expect(isAuthority("final_reg")).toBe(false);
    expect(isAuthority(undefined)).toBe(false);
    const built = rule({ nested: [1, 2] }, "product_policy", "Synthetic rule for this test.");
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.value.nested)).toBe(true);
  });

  it("pins the rules to TAXMATH_VERSION: changing a rule without bumping the version fails here", () => {
    expect(TAXMATH_VERSION).toMatch(/^25f-taxmath\.\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(rulesFingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(rulesFingerprint()).toBe(rulesFingerprint());
    expect(Object.keys(PUBLISHED_RULE_FINGERPRINTS)).toContain(TAXMATH_VERSION);
    expect(rulesFingerprint(), "a section 25F rule changed: bump TAXMATH_VERSION and record the new fingerprint in PUBLISHED_RULE_FINGERPRINTS").toBe(
      PUBLISHED_RULE_FINGERPRINTS[TAXMATH_VERSION],
    );
  });
});
