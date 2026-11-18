import { describe, expect, it } from "vitest";
import { buildTable, getActiveTable, getTable, getThreshold, type AmiTable } from "@/engine/ami";
import { reconcileIncomeEvidence, type HouseholdMemberInput, type IncomeItemInput } from "@/engine/income";
import { AppError } from "@/lib/errors";
import { decide } from "./decide";
import { DECISION_ENGINE_VERSION, DECISION_RULE_SET, DEFAULT_DECISION_POLICY, METHOD_CITATIONS } from "./policy";
import { applyReviewerResolution } from "./resolution";
import {
  awardLetter,
  DANIEL,
  decisionInput,
  directEvidence,
  FAMILY_OF_FOUR,
  HARRIS,
  INCOME_YEAR,
  MARIA,
  MATEO,
  NO_OTHER_INCOME,
  omit,
  parserSource,
  SOFIA,
  STARR,
  thresholdFixture,
  TODAY,
  wageItem,
} from "./test-fixtures";
import { toThresholdBounds } from "./threshold-bounds";
import { REASON_CODES, type Decision, type DecisionInput } from "./types";

/* Every reason code the scenarios below produce, checked against the full list at the end of the file. */
const seenCodes = new Set<string>();
function record(decision: Decision): Decision {
  for (const reason of [...decision.reasons, ...decision.reviewReasons]) seenCodes.add(reason.code);
  for (const flag of decision.income?.reviewFlags ?? []) seenCodes.add(flag.code);
  for (const flag of decision.coverage?.flags ?? []) seenCodes.add(flag.code);
  return decision;
}
const run = (overrides: Partial<DecisionInput> = {}): Decision => record(decide(decisionInput(overrides)));
const codes = (reasons: Decision["reasons"]): string[] => reasons.map((reason) => reason.code);

const dollars = (amount: number): number => Math.round(amount * 100);
/** Complete, trusted direct evidence whose household total is `total` dollars. */
const incomeOf = (total: number, extra: IncomeItemInput[] = []) => directEvidence(dollars(total) - 4_000_000, 4_000_000, extra);
const starr = (overrides: Partial<DecisionInput> = {}): Decision =>
  run({
    household: { size: 4, countyFips: STARR.fips, members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: false } },
    threshold: thresholdFixture(STARR, { capPct: overrides.sgoPolicy?.capPct ?? 300 }),
    ...overrides,
  });
const extraItem = (overrides: Partial<IncomeItemInput> & Pick<IncomeItemInput, "id" | "category" | "annualAmountCents">): IncomeItemInput => ({
  memberId: MARIA.id,
  incomeYear: INCOME_YEAR,
  source: "document",
  documentId: `doc_${overrides.id}`,
  ...overrides,
});

/** A SYNTHETIC IRS-style table built from the HUD table's areas. It is not an IRS publication. */
function syntheticIrsTable(additionalPersonCents: number | null): AmiTable {
  const hud = getTable("hud-fy2026-tx");
  if (hud.dataset.source !== "hud_provisional") throw new Error("hud-fy2026-tx must be HUD-derived");
  const multipliers = hud.dataset.multipliers.bySizeBps;
  return buildTable({
    schemaVersion: 1,
    version: "irs-synthetic-test",
    state: "TX",
    stateFips: "48",
    effectiveDate: "2027-01-01",
    sourceFile: { name: "SYNTHETIC-not-an-irs-table.csv", sha256: "a".repeat(64), url: null },
    counties: hud.dataset.counties.map((county) => ({ ...county })),
    source: "irs_published",
    method: "irs_published_limit_by_family_size_v1",
    citation: "SYNTHETIC TEST TABLE, not published by the IRS",
    contract: "irs-limitation-csv-v1",
    areas: hud.dataset.areas.map((area) => ({
      code: area.code,
      name: area.name,
      limitCents: multipliers.map((bps) => (area.medianIncomeDollars * 3 * bps) / 100),
      additionalPersonCents,
      medianIncomeDollars: area.medianIncomeDollars,
    })),
  });
}

describe("decide: the direct method", () => {
  it("is eligible when documented household income is within the limit", () => {
    const decision = run({ direct: directEvidence(6_000_000, 4_500_000) });
    expect(decision).toMatchObject({
      status: "eligible",
      method: "direct",
      methodBasis: "written_documentation",
      methodCitation: METHOD_CITATIONS.direct,
      applicationDate: TODAY,
      incomeYear: 2026,
      householdSize: 4,
      countyFips: "48201",
      householdIncomeCents: 10_500_000,
      directOutcome: "within_limit",
      awardProgram: null,
      awardLetterDate: null,
      reviewReasons: [],
      missing: [],
      provisional: true,
      validUntil: "2027-12-31",
      decidedOn: TODAY,
      decidedBy: { type: "engine" },
      engineOutcome: null,
    });
    expect(codes(decision.reasons)).toEqual(["direct_income_within_limit"]);
    expect(decision.reasons[0].message).toContain("not greater than the limit of $312,000 for a household of 4 in Harris County");
    expect(decision.threshold).toMatchObject({ thresholdCents: 31_200_000, lowerBoundCents: 31_200_000, upperBoundCents: 31_200_000, readingsAgree: true, reliedOn: "single_limit", reliedOnLimitCents: 31_200_000 });
    expect(decision.coverage).toMatchObject({ complete: true, documentedMemberCount: 2, otherIncome: "certified_none" });
    expect(decision.income).toMatchObject({ totalCountedCents: 10_500_000, lowerBoundCents: 10_500_000, upperBoundCents: 10_500_000 });
  });

  it("is ineligible only on an affirmative showing: income over the limit with every adult documented", () => {
    const decision = run({ direct: directEvidence(20_000_000, 15_000_000) });
    expect(decision).toMatchObject({ status: "ineligible", method: "direct", directOutcome: "over_limit", householdIncomeCents: 35_000_000, validUntil: "2027-12-31", reviewReasons: [], missing: [] });
    expect(codes(decision.reasons)).toEqual(["direct_income_over_limit"]);
    expect(decision.reasons[0].message).toContain("Every adult in the household is covered by income documents or a signed statement of no income.");
    expect(decision.threshold).toMatchObject({ reliedOn: "single_limit", reliedOnLimitCents: 31_200_000 });
  });

  it("applies the statutory test as written when there is no review band: equal to the limit passes, one cent more does not", () => {
    const noBand = { capPct: 300, reviewBandBps: 0 };
    expect(run({ sgoPolicy: noBand, direct: incomeOf(312_000) }).status).toBe("eligible");
    expect(run({ sgoPolicy: noBand, direct: incomeOf(312_000.01) }).status).toBe("ineligible");
  });

  it("does not apply the review band to an IRS-published limit", () => {
    const irs = thresholdFixture(HARRIS, { source: "irs_published" });
    const atLimit = run({ threshold: irs, direct: incomeOf(312_000) });
    expect(atLimit).toMatchObject({ status: "eligible", provisional: false });
    expect(atLimit.threshold).toMatchObject({ reviewBand: { bps: 500, applied: false, belowLowerCents: 0, aboveUpperCents: 0 }, autoEligibleMaxCents: 31_200_000, autoIneligibleAboveCents: 31_200_000 });
    expect(atLimit.thresholdTable).toEqual({ source: "irs_published", tableVersion: "irs-synthetic-fixture", effectiveDate: "2027-01-01", provisional: false });
    expect(run({ threshold: irs, direct: incomeOf(312_000.01) })).toMatchObject({ status: "ineligible", provisional: false });
  });

  it("sends income within the review band of a provisional limit to a person, on either side", () => {
    // Harris, four persons: $312,000; a 5% band is $15,600 on either side.
    expect(run({ direct: incomeOf(296_399.99) }).status).toBe("eligible");
    const lowEdge = run({ direct: incomeOf(296_400) });
    expect(lowEdge).toMatchObject({ status: "needs_review", method: null, validUntil: null, directOutcome: "needs_review" });
    expect(codes(lowEdge.reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(lowEdge.reviewReasons[0].message).toContain("within 5% of the provisional limit");
    expect(codes(run({ direct: incomeOf(312_000) }).reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(codes(run({ direct: incomeOf(327_600) }).reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(run({ direct: incomeOf(327_600.01) }).status).toBe("ineligible");
    expect(lowEdge.threshold).toMatchObject({ reviewBand: { bps: 500, applied: true, belowLowerCents: 1_560_000, aboveUpperCents: 1_560_000 }, autoEligibleMaxCents: 29_639_999, autoIneligibleAboveCents: 32_760_000 });
  });

  it("stays pending, with the exact list, while an adult's income is not documented", () => {
    const decision = run({ direct: directEvidence(6_000_000, 0, [], { items: [wageItem(MARIA.id, 6_000_000)] }) });
    expect(decision).toMatchObject({ status: "pending", method: null, directOutcome: "incomplete", validUntil: null, householdIncomeCents: 6_000_000 });
    expect(decision.missing.map((item) => [item.code, item.memberId])).toEqual([["member_income_evidence", DANIEL.id]]);
    expect(decision.missing[0].message.en).toContain("Proof of 2026 income for Daniel");
    expect(codes(decision.reasons)).toEqual(["information_missing"]);
  });

  it("is never ineligible while coverage is incomplete, however high the documented part is", () => {
    const decision = run({ direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 90_000_000)] }) });
    expect(decision.status).toBe("pending");
    expect(decision.missing).toHaveLength(1);
  });

  it("is pending without the other-income evidence or certification", () => {
    const decision = run({ direct: directEvidence(6_000_000, 4_500_000, [], { certifications: [] }) });
    expect(decision.status).toBe("pending");
    expect(decision.missing.map((item) => item.code)).toEqual(["other_income_evidence_or_certification"]);
  });

  it("accepts a signed zero-income statement for one adult", () => {
    const decision = run({
      direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 6_000_000)], certifications: [NO_OTHER_INCOME, { ...NO_OTHER_INCOME, kind: "zero_income", memberId: DANIEL.id }] }),
    });
    expect(decision.status).toBe("eligible");
    expect(decision.coverage).toMatchObject({ documentedMemberCount: 1, certifiedZeroIncomeMemberCount: 1 });
  });

  it("does not decide on signed statements alone", () => {
    const decision = run({
      direct: {
        incomeYear: INCOME_YEAR,
        items: [],
        certifications: [NO_OTHER_INCOME, { ...NO_OTHER_INCOME, kind: "zero_income", memberId: MARIA.id }, { ...NO_OTHER_INCOME, kind: "zero_income", memberId: DANIEL.id }],
      },
    });
    expect(decision).toMatchObject({ status: "needs_review", householdIncomeCents: 0 });
    expect(codes(decision.reviewReasons)).toEqual(["no_documentary_evidence"]);
  });

  it("decides when the only documented income belongs to a child and every adult signed a zero-income statement", () => {
    const decision = run({
      direct: {
        incomeYear: INCOME_YEAR,
        items: [extraItem({ id: "ssi", category: "ssi", annualAmountCents: 1_100_000, memberId: SOFIA.id })],
        sources: [parserSource("doc_ssi", { kind: "other_income" })],
        certifications: [NO_OTHER_INCOME, { ...NO_OTHER_INCOME, kind: "zero_income", memberId: MARIA.id }, { ...NO_OTHER_INCOME, kind: "zero_income", memberId: DANIEL.id }],
      },
    });
    expect(decision).toMatchObject({ status: "eligible", householdIncomeCents: 1_100_000 });
    expect(decision.coverage).toMatchObject({ documentedMemberCount: 0, certifiedZeroIncomeMemberCount: 2, evidencedItemCount: 1 });
  });

  it("sends a zero-income statement that the documents contradict to a person", () => {
    const decision = run({ direct: directEvidence(6_000_000, 4_500_000, [], { certifications: [NO_OTHER_INCOME, { ...NO_OTHER_INCOME, kind: "zero_income", memberId: DANIEL.id }] }) });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["zero_income_certification_contradicted"]);
  });

  it("uses only items for the statutory income year and says so when the evidence was assembled for another year", () => {
    const lastYear = directEvidence(6_000_000, 4_500_000);
    const decision = run({ direct: { ...lastYear, incomeYear: 2025, items: lastYear.items.map((item) => ({ ...item, incomeYear: 2025 })), certifications: [{ ...NO_OTHER_INCOME, incomeYear: 2025 }] } });
    expect(decision).toMatchObject({ status: "pending", incomeYear: 2026, householdIncomeCents: 0 });
    expect(codes(decision.reasons)).toEqual(["direct_evidence_wrong_year", "information_missing"]);
    expect(decision.missing.map((item) => item.code)).toEqual(["member_income_evidence", "member_income_evidence", "other_income_evidence_or_certification"]);
    expect(decision.income!.excluded.every((line) => line.reason === "excluded_different_year")).toBe(true);
  });
});

describe("decide: two readings of the provisional limit", () => {
  const noBand = { capPct: 300, reviewBandBps: 0 };

  it("decides automatically only where both readings agree (Starr County: $116,100 against $251,100)", () => {
    const within = starr({ sgoPolicy: noBand, direct: incomeOf(116_100) });
    expect(within.status).toBe("eligible");
    expect(within.threshold).toMatchObject({ readingsAgree: false, lowerBoundCents: 11_610_000, upperBoundCents: 25_110_000, reliedOn: "lower_bound", reliedOnLimitCents: 11_610_000 });
    expect(within.reasons[0].message).toContain("under every reading");

    const justAbove = starr({ sgoPolicy: noBand, direct: incomeOf(116_100.01) });
    expect(justAbove).toMatchObject({ status: "needs_review", method: null });
    expect(codes(justAbove.reviewReasons)).toEqual(["between_provisional_readings"]);
    // Both figures are shown to the reviewer.
    expect(justAbove.reviewReasons[0].message).toContain("$116,100");
    expect(justAbove.reviewReasons[0].message).toContain("$251,100");
    expect(justAbove.threshold!.readings.map((reading) => [reading.id, reading.thresholdCents])).toEqual([
      ["median_product", 11_610_000],
      ["section8_vli", 25_110_000],
    ]);

    expect(codes(starr({ sgoPolicy: noBand, direct: incomeOf(200_000) }).reviewReasons)).toEqual(["between_provisional_readings"]);
    expect(codes(starr({ sgoPolicy: noBand, direct: incomeOf(251_100) }).reviewReasons)).toEqual(["between_provisional_readings"]);

    const over = starr({ sgoPolicy: noBand, direct: incomeOf(251_100.01) });
    expect(over.status).toBe("ineligible");
    expect(over.threshold).toMatchObject({ reliedOn: "upper_bound", reliedOnLimitCents: 25_110_000 });
  });

  it("widens both ends by the review band", () => {
    // 5% of $116,100 is $5,805; 5% of $251,100 is $12,555.
    expect(starr({ direct: incomeOf(110_294.99) }).status).toBe("eligible");
    expect(codes(starr({ direct: incomeOf(110_295) }).reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(codes(starr({ direct: incomeOf(116_100) }).reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(codes(starr({ direct: incomeOf(150_000) }).reviewReasons)).toEqual(["between_provisional_readings"]);
    expect(codes(starr({ direct: incomeOf(255_000) }).reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(codes(starr({ direct: incomeOf(263_655) }).reviewReasons)).toEqual(["near_provisional_threshold"]);
    expect(starr({ direct: incomeOf(263_655.01) }).status).toBe("ineligible");
  });

  it("treats Harris County, where both readings give $312,000, as a single limit", () => {
    const decision = run({ sgoPolicy: noBand, direct: incomeOf(312_000) });
    expect(decision.status).toBe("eligible");
    expect(decision.threshold).toMatchObject({ readingsAgree: true, reliedOn: "single_limit" });
    expect(decision.threshold!.readings).toHaveLength(2);
  });

  it("carries one reading for an IRS-published table, with or without a readings field", () => {
    const irs = starr({ threshold: thresholdFixture(STARR, { source: "irs_published" }), direct: incomeOf(116_100.01) });
    expect(irs.status).toBe("ineligible");
    expect(irs.threshold!.readings.map((reading) => reading.id)).toEqual(["irs_published"]);
    const bareIrs = omit(thresholdFixture(STARR, { source: "irs_published" }), "readings", "lowerBoundCents", "upperBoundCents", "readingsAgree");
    const fallback = starr({ threshold: bareIrs, direct: incomeOf(116_100.01) });
    expect(fallback.status).toBe("ineligible");
    expect(fallback.threshold).toMatchObject({ boundsSource: "single_threshold", readingsAgree: true, lowerBoundCents: 11_610_000, reliedOn: "single_limit" });
  });

  it("refuses a HUD-derived threshold without its readings rather than deciding on one of them", () => {
    // Regression: the old fallback made $116,100.01 in Starr County "ineligible" although reading B is $251,100.
    const bare = omit(thresholdFixture(STARR), "readings", "lowerBoundCents", "upperBoundCents", "readingsAgree");
    expect(() => starr({ sgoPolicy: noBand, threshold: bare, direct: incomeOf(116_100.01) })).toThrow(/both readings/);
  });
});

describe("decide: the categorical method", () => {
  it("is eligible on a current award letter for one of the five programs", () => {
    const decision = run({ categorical: { letters: [awardLetter()] } });
    expect(decision).toMatchObject({
      status: "eligible",
      method: "categorical",
      methodBasis: "categorical_documentation",
      methodCitation: METHOD_CITATIONS.categorical,
      awardProgram: "SNAP",
      awardLetterDate: "2027-01-10",
      awardLetterDocumentId: "doc_letter",
      householdIncomeCents: null,
      income: null,
      coverage: null,
      directOutcome: "none",
      reviewReasons: [],
      missing: [],
      validUntil: "2027-12-31",
      provisional: true,
      householdSize: 4,
    });
    expect(codes(decision.reasons)).toEqual(["categorical_award_letter_valid"]);
    expect(decision.reasons[0]).toMatchObject({ memberIds: [MARIA.id], sourceIds: ["doc_letter"] });
    expect(decision.reasons[0].message).toContain("under the proposed rules");
    // The limit is still recorded, and no income comparison was relied on.
    expect(decision.threshold).toMatchObject({ thresholdCents: 31_200_000, reliedOn: "none", reliedOnLimitCents: null });
  });

  it("is valid no longer than the letter stays within 12 months or the benefit period lasts", () => {
    expect(run({ categorical: { letters: [awardLetter({ letterDate: "2026-06-01" })] } }).validUntil).toBe("2027-06-01");
    expect(run({ categorical: { letters: [awardLetter({ benefitPeriodEnd: "2027-04-30" })] } }).validUntil).toBe("2027-04-30");
    expect(run({ categorical: { letters: [awardLetter({ letterDate: "2026-03-15" })] } }).validUntil).toBe("2027-03-15");
  });

  it("measures the 12 months on the day before, on and after the boundary", () => {
    expect(run({ categorical: { letters: [awardLetter({ letterDate: "2026-03-16" })] } }).status).toBe("eligible");
    expect(run({ categorical: { letters: [awardLetter({ letterDate: "2026-03-15" })] } }).status).toBe("eligible");
    const tooOld = run({ categorical: { letters: [awardLetter({ letterDate: "2026-03-14" })] } });
    expect(tooOld.status).toBe("pending");
    expect(codes(tooOld.reasons)).toEqual(["letter_older_than_12_months", "information_missing"]);
  });

  it("handles leap-day letters and leap-day applications", () => {
    const household = decisionInput().household;
    const at = (today: string, letterDate: string) => record(decide({ today, sgoPolicy: { capPct: 300, reviewBandBps: 500 }, household, amiTable: getActiveTable(), categorical: { letters: [awardLetter({ letterDate })] } }));
    expect(at("2029-02-28", "2028-02-29")).toMatchObject({ status: "eligible", validUntil: "2029-02-28", incomeYear: 2028 });
    expect(at("2029-03-01", "2028-02-29").status).toBe("pending");
    expect(at("2028-02-29", "2027-02-28")).toMatchObject({ status: "eligible", validUntil: "2028-02-28" });
    expect(at("2028-02-29", "2027-02-27").status).toBe("pending");
    expect(at("2028-02-29", "2028-02-29")).toMatchObject({ status: "eligible", validUntil: "2028-12-31" });
  });

  it("records income documents that were also provided without needing them", () => {
    const complete = run({ categorical: { letters: [awardLetter()] }, direct: directEvidence(3_000_000, 2_000_000) });
    expect(complete).toMatchObject({ status: "eligible", method: "categorical", householdIncomeCents: 5_000_000, directOutcome: "within_limit" });
    expect(codes(complete.reasons)).toEqual(["categorical_award_letter_valid", "direct_evidence_also_provided"]);
    // Incomplete or flagged income documents do not hold up a valid letter.
    const partial = run({ categorical: { letters: [awardLetter()] }, direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 3_000_000)], certifications: [] }) });
    expect(partial).toMatchObject({ status: "eligible", method: "categorical", directOutcome: "incomplete", missing: [] });
    const flagged = run({ categorical: { letters: [awardLetter()] }, direct: directEvidence(3_000_000, 2_000_000, [extraItem({ id: "se", category: "self_employment_net", annualAmountCents: 1_000_000 })]) });
    expect(flagged).toMatchObject({ status: "eligible", method: "categorical", reviewReasons: [] });
  });

  it("never approves silently when the income documents show income over the limit", () => {
    const decision = run({ categorical: { letters: [awardLetter()] }, direct: directEvidence(20_000_000, 15_000_000) });
    expect(decision).toMatchObject({ status: "needs_review", method: null, awardProgram: null, validUntil: null });
    expect(codes(decision.reviewReasons)).toEqual(["categorical_direct_conflict"]);
    expect(decision.reviewReasons[0].sourceIds).toEqual(["doc_letter"]);
    // Also when only part of the household is documented, or the figure is merely possible.
    const partial = run({ categorical: { letters: [awardLetter()] }, direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 40_000_000)], certifications: [] }) });
    expect(codes(partial.reviewReasons)).toEqual(["categorical_direct_conflict"]);
    const possible = run({ categorical: { letters: [awardLetter()] }, direct: directEvidence(3_000_000, 2_000_000, [extraItem({ id: "gain", category: "realized_capital_gains", annualAmountCents: 40_000_000 })]) });
    expect(codes(possible.reviewReasons)).toEqual(["categorical_direct_conflict"]);
    // Between the two readings counts as over under one of them.
    expect(codes(starr({ categorical: { letters: [awardLetter()] }, direct: incomeOf(150_000) }).reviewReasons)).toEqual(["categorical_direct_conflict"]);
  });

  it("never makes a household ineligible because of a letter that cannot be used", () => {
    for (const [overrides, code] of [
      [{ program: "MEDICAID" }, "program_medicaid_not_listed"],
      [{ program: "CHIP" }, "program_chip_not_listed"],
      [{ program: "SSDI" }, "program_ssdi_rsdi_not_listed"],
      [{ program: "SCHOOL_MEALS" }, "program_school_meals_not_accepted"],
      [{ program: "OTHER" }, "program_not_listed"],
      [{ approvalStatus: "denied" }, "letter_shows_denial"],
      [{ approvalStatus: "terminated" }, "letter_shows_termination"],
      [{ approvalStatus: "pending" }, "letter_shows_pending_application"],
      [{ letterDate: "2025-12-31" }, "letter_older_than_12_months"],
    ] as const) {
      const decision = run({ categorical: { letters: [awardLetter(overrides)] } });
      expect(decision.status, code).toBe("pending");
      expect(codes(decision.reasons), code).toEqual([code, "information_missing"]);
      expect(decision.missing.map((item) => item.code), code).toEqual(["evidence_for_any_method"]);
      expect(decision.letters[0].outcome, code).toBe("fail");
    }
  });

  it("falls through to the direct method after a letter that cannot be used", () => {
    const within = run({ categorical: { letters: [awardLetter({ program: "MEDICAID" })] }, direct: directEvidence(6_000_000, 4_500_000) });
    expect(within).toMatchObject({ status: "eligible", method: "direct" });
    expect(codes(within.reasons)).toEqual(["program_medicaid_not_listed", "direct_income_within_limit"]);
    const over = run({ categorical: { letters: [awardLetter({ program: "MEDICAID" })] }, direct: directEvidence(20_000_000, 15_000_000) });
    expect(over).toMatchObject({ status: "ineligible", method: "direct" });
    const partial = run({ categorical: { letters: [awardLetter({ program: "MEDICAID" })] }, direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 6_000_000)] }) });
    expect(partial.status).toBe("pending");
    expect(partial.missing.map((item) => item.code)).toEqual(["member_income_evidence"]);
  });

  it("sends a letter only a person can confirm to review, not to the household", () => {
    for (const [overrides, code] of [
      [{ extractedBy: "model" }, "letter_read_by_model"],
      [{ extractionConfidence: 0.5 }, "letter_low_extraction_confidence"],
      [{ matchedMemberId: null }, "recipient_not_matched"],
      [{ nameMatchConfidence: 0.5 }, "recipient_match_low_confidence"],
      [{ approvalStatus: "unclear" }, "approval_status_unclear"],
      [{ letterDate: null }, "letter_date_unreadable"],
      [{ letterDate: "2027-06-01" }, "letter_dated_in_future"],
      [{ benefitPeriodEnd: "2027-02-28" }, "benefit_period_ended"],
      [{ program: "UNKNOWN" }, "program_not_recognized"],
      [{ documentType: "other" }, "documentation_not_award_letter"],
    ] as const) {
      const decision = run({ categorical: { letters: [awardLetter(overrides)] } });
      expect(decision, code).toMatchObject({ status: "needs_review", method: null, missing: [], awardProgram: null });
      expect(codes(decision.reviewReasons), code).toEqual([code]);
      expect(decision.reviewReasons[0].sourceIds, code).toEqual(["doc_letter"]);
    }
  });

  it("goes to review when the 12 months depend on the reference date", () => {
    const decision = run({ applicationDate: "2027-02-20", categorical: { letters: [awardLetter({ letterDate: "2026-03-01" })] } });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["letter_window_depends_on_reference_date"]);
  });

  it("does not need a doubtful letter once the income documents settle it, and needs a person when they do not", () => {
    const blurry = awardLetter({ extractionConfidence: 0.4 });
    const settled = run({ categorical: { letters: [blurry] }, direct: directEvidence(6_000_000, 4_500_000) });
    expect(settled).toMatchObject({ status: "eligible", method: "direct", reviewReasons: [] });
    expect(codes(settled.reasons)).toEqual(["direct_income_within_limit", "letter_low_extraction_confidence"]);

    const over = run({ categorical: { letters: [blurry] }, direct: directEvidence(20_000_000, 15_000_000) });
    expect(over.status).toBe("needs_review");
    expect(codes(over.reviewReasons)).toEqual(["letter_low_extraction_confidence", "categorical_direct_conflict"]);

    // A reviewer may be able to settle the file from the letter alone, so the household is not asked for more yet.
    const partial = run({ categorical: { letters: [blurry] }, direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 6_000_000)] }) });
    expect(partial).toMatchObject({ status: "needs_review", missing: [] });
    expect(partial.coverage!.missing.map((item) => item.code)).toEqual(["member_income_evidence"]);
  });

  it("uses the valid letter when several are on file", () => {
    const decision = run({
      categorical: { letters: [awardLetter({ documentId: "doc_medicaid", program: "MEDICAID" }), awardLetter({ documentId: "doc_wic", program: "WIC", letterDate: "2026-12-01" }), awardLetter({ documentId: "doc_model", extractedBy: "model" })] },
    });
    expect(decision).toMatchObject({ status: "eligible", awardProgram: "WIC", awardLetterDocumentId: "doc_wic", awardLetterDate: "2026-12-01" });
    expect(decision.letters.map((letter) => letter.outcome)).toEqual(["fail", "pass", "review"]);
  });
});

describe("decide: household facts", () => {
  const letter = { categorical: { letters: [awardLetter()] } };
  const single = { livesInMultipleHouseholds: false };

  it("is pending while the household size, the county, the roster or the custody answer is missing, whatever else is on file", () => {
    const sizeMissing = run({ ...letter, household: { size: null, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody: single } });
    expect(sizeMissing).toMatchObject({ status: "pending", threshold: null, householdSize: null, method: null });
    expect(sizeMissing.missing.map((item) => item.code)).toEqual(["household_size"]);
    // The table in use is still recorded.
    expect(sizeMissing.thresholdTable).toMatchObject({ source: "hud_provisional", provisional: true });
    expect(sizeMissing.provisional).toBe(true);

    const countyMissing = run({ ...letter, household: { size: 4, countyFips: null, members: FAMILY_OF_FOUR, custody: single } });
    expect(countyMissing.missing.map((item) => item.code)).toEqual(["county"]);
    expect(countyMissing.threshold).toBeNull();

    const malformed = record(decide({ today: TODAY, sgoPolicy: { capPct: 300, reviewBandBps: 500 }, household: { size: 4, countyFips: "4820", members: FAMILY_OF_FOUR, custody: single }, ...letter }));
    expect(malformed.status).toBe("pending");
    expect(malformed.missing.map((item) => item.code)).toEqual(["county"]);

    const custodyMissing = run({ ...letter, household: { size: 4, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody: null } });
    expect(custodyMissing.status).toBe("pending");
    expect(custodyMissing.missing.map((item) => item.code)).toEqual(["shared_custody_answers"]);
    expect(custodyMissing.missing[0].message).toEqual({
      en: "Whether the student lived in more than one household during 2026.",
      es: "Si el estudiante vivió en más de un hogar durante 2026.",
    });
    expect(custodyMissing.custody).toEqual({ outcome: "not_answered", facts: null });
  });

  it("requires the stated size to equal the number of people listed", () => {
    const decision = run({ ...letter, household: { size: 5, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody: single }, threshold: thresholdFixture(HARRIS, { householdSize: 5 }) });
    expect(decision.status).toBe("pending");
    expect(decision.missing.map((item) => item.code)).toEqual(["household_roster"]);
    expect(decision.missing[0].message.en).toBe("Each person who lives in the home. The household size you gave is 5, and 4 people are listed.");
    const one = run({ household: { size: 2, countyFips: HARRIS.fips, members: [MARIA], custody: single }, threshold: thresholdFixture(HARRIS, { householdSize: 2 }) });
    expect(one.missing[0].message.en).toContain("1 person is listed");
    expect(one.missing[0].message.es).toContain("1 persona en la lista");
  });

  it("sends a county the table does not cover to a person", () => {
    const base = { today: TODAY, sgoPolicy: { capPct: 300, reviewBandBps: 500 }, ...letter };
    const elsewhere = record(decide({ ...base, household: { size: 4, countyFips: "06037", members: FAMILY_OF_FOUR, custody: single } }));
    expect(elsewhere).toMatchObject({ status: "needs_review", threshold: null, method: null });
    expect(codes(elsewhere.reviewReasons)).toEqual(["county_not_in_threshold_table"]);
    const unknown = record(decide({ ...base, household: { size: 4, countyFips: "48999", members: FAMILY_OF_FOUR, custody: single } }));
    expect(codes(unknown.reviewReasons)).toEqual(["county_not_in_threshold_table"]);
    expect(unknown.thresholdTable.tableVersion).toBe(getActiveTable().version);
  });

  it("sends a household size the published table does not list to a person", () => {
    const nine: HouseholdMemberInput[] = [...FAMILY_OF_FOUR, ...[5, 6, 7, 8, 9].map((n) => ({ id: `hm_child_${n}`, firstName: `Child${n}`, ageBand: "minor" as const }))];
    const household = { size: 9, countyFips: HARRIS.fips, members: nine, custody: single };
    const base = { today: TODAY, sgoPolicy: { capPct: 300, reviewBandBps: 500 }, household, direct: directEvidence(6_000_000, 4_500_000) };
    const notListed = record(decide({ ...base, amiTable: syntheticIrsTable(null) }));
    expect(notListed).toMatchObject({ status: "needs_review", threshold: null, provisional: false, directOutcome: "not_evaluated" });
    expect(codes(notListed.reviewReasons)).toEqual(["household_size_not_in_published_table"]);
    expect(notListed.thresholdTable).toEqual({ source: "irs_published", tableVersion: "irs-synthetic-test", effectiveDate: "2027-01-01", provisional: false });
    // With a published per-person amount the same household is decided.
    const listed = record(decide({ ...base, amiTable: syntheticIrsTable(2_496_000) }));
    expect(listed).toMatchObject({ status: "eligible", provisional: false });
    expect(listed.threshold).toMatchObject({ householdSize: 9, readingsAgree: true, reviewBand: { applied: false } });
  });

  describe("shared custody is never guessed", () => {
    const withCustody = (custody: DecisionInput["household"]["custody"], extra: Partial<DecisionInput> = {}) =>
      run({ household: { size: 4, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody }, direct: directEvidence(6_000_000, 4_500_000), ...extra });

    it("applies the proposed rule when the facts are clear", () => {
      const longest = withCustody({ livesInMultipleHouseholds: true, monthsInThisHousehold: 8 });
      expect(longest.status).toBe("eligible");
      expect(codes(longest.reasons)).toEqual(["custody_this_household_longest", "direct_income_within_limit"]);
      expect(longest.custody.outcome).toBe("this_household_longest");
      const tieBreak = withCustody({ livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "yes" });
      expect(tieBreak.status).toBe("eligible");
      expect(codes(tieBreak.reasons)).toEqual(["custody_equal_time_higher_income", "direct_income_within_limit"]);
    });

    it.each([
      [{ livesInMultipleHouseholds: true }, "custody_time_unclear"],
      [{ livesInMultipleHouseholds: true, monthsInThisHousehold: 5 }, "custody_time_unclear"],
      [{ livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "unknown" as const }, "custody_equal_time_income_unknown"],
      [{ livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "no" as const }, "custody_equal_time_other_household_higher"],
      [{ livesInMultipleHouseholds: false, equalTime: true }, "custody_answers_inconsistent"],
    ])("flags %j for review even with perfect income evidence", (custody, code) => {
      const decision = withCustody(custody);
      expect(decision).toMatchObject({ status: "needs_review", method: null, validUntil: null, custody: { outcome: "needs_review" } });
      expect(codes(decision.reviewReasons)).toEqual([code]);
    });

    it("flags it on the categorical method and on an over-the-limit household too", () => {
      const unclear = { livesInMultipleHouseholds: true };
      expect(withCustody(unclear, { direct: undefined, categorical: { letters: [awardLetter()] } }).status).toBe("needs_review");
      expect(withCustody(unclear, { direct: directEvidence(20_000_000, 15_000_000) }).status).toBe("needs_review");
    });
  });

  it("does not guess the income year when the application and the decision fall in different calendar years", () => {
    const decision = run({ today: "2027-01-05", applicationDate: "2026-12-20", direct: directEvidence(6_000_000, 4_500_000, [], {}) });
    expect(decision).toMatchObject({ status: "needs_review", incomeYear: 2025, applicationDate: "2026-12-20", decidedOn: "2027-01-05" });
    expect(codes(decision.reviewReasons)).toEqual(["application_date_in_earlier_year"]);
    // The household is not asked for another year's documents until a reviewer has confirmed the year.
    expect(decision.missing).toEqual([]);
    expect(decision.coverage!.missing.length).toBeGreaterThan(0);
    const nothingOnFile = run({ today: "2027-01-05", applicationDate: "2026-12-20" });
    expect(nothingOnFile).toMatchObject({ status: "needs_review", missing: [] });
    // An over-the-limit showing for the wrong year decides nothing either.
    const over = run({ today: "2027-01-05", applicationDate: "2026-12-20", direct: { ...directEvidence(20_000_000, 15_000_000), incomeYear: 2025, items: directEvidence(20_000_000, 15_000_000).items.map((item) => ({ ...item, incomeYear: 2025 })), certifications: [{ ...NO_OTHER_INCOME, incomeYear: 2025 }] } });
    expect(over.status).toBe("needs_review");
    // Same calendar year: the application date fixes the income year and nothing is flagged.
    const sameYear = run({ today: "2027-06-30", applicationDate: "2027-01-02", direct: directEvidence(6_000_000, 4_500_000) });
    expect(sameYear).toMatchObject({ status: "eligible", incomeYear: 2026, validUntil: "2027-12-31" });
  });
});

describe("decide: evidence that cannot be relied on never produces a yes or a no", () => {
  const good = directEvidence(6_000_000, 4_500_000);
  const over = directEvidence(20_000_000, 15_000_000);

  it("sends a model-read income document to a person", () => {
    for (const evidence of [good, over]) {
      const decision = run({ direct: { ...evidence, sources: [parserSource("doc_w2_hm_maria", { extractedBy: "model", extractionConfidence: 1 }), parserSource("doc_w2_hm_daniel")] } });
      expect(decision.status).toBe("needs_review");
      expect(codes(decision.reviewReasons)).toEqual(["document_read_by_model"]);
      expect(decision.reviewReasons[0]).toMatchObject({ sourceIds: ["doc_w2_hm_maria"], memberIds: [MARIA.id] });
    }
  });

  it("sends a low-confidence parse to a person", () => {
    const decision = run({ direct: { ...good, sources: [parserSource("doc_w2_hm_maria", { extractionConfidence: 0.89 }), parserSource("doc_w2_hm_daniel")] } });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["document_low_confidence"]);
    expect(run({ direct: { ...good, sources: [parserSource("doc_w2_hm_maria", { extractionConfidence: 0.9 }), parserSource("doc_w2_hm_daniel")] } }).status).toBe("eligible");
  });

  it("sends an income document that could not be read to a person, and does not ask the household for it again", () => {
    const unreadDocuments = [{ documentId: "doc_scan", memberId: DANIEL.id }];
    // Nothing else on file: the scan may be the proof.
    const scanOnly = run({ direct: { incomeYear: INCOME_YEAR, items: [], unreadDocuments } });
    expect(scanOnly).toMatchObject({ status: "needs_review", missing: [], directOutcome: "needs_review" });
    expect(codes(scanOnly.reviewReasons)).toEqual(["document_not_read"]);
    expect(scanOnly.reviewReasons[0]).toMatchObject({ sourceIds: ["doc_scan"], memberIds: [DANIEL.id] });
    expect(scanOnly.coverage!.missing.length).toBeGreaterThan(0);
    // One adult documented, the other adult's document unreadable.
    const partial = run({ direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 6_000_000)], unreadDocuments }) });
    expect(partial).toMatchObject({ status: "needs_review", missing: [] });
    // A complete, readable file with one more document nobody could read is still not decided automatically.
    for (const evidence of [good, over]) {
      const decision = run({ direct: { ...evidence, unreadDocuments } });
      expect(decision.status).toBe("needs_review");
      expect(codes(decision.reviewReasons)).toEqual(["document_not_read"]);
    }
    // A valid award letter does not need it.
    expect(run({ categorical: { letters: [awardLetter()] }, direct: { incomeYear: INCOME_YEAR, items: [], unreadDocuments } })).toMatchObject({ status: "eligible", method: "categorical" });
  });

  it("does not trust an item whose document has no extraction record", () => {
    const decision = run({ direct: { ...good, sources: [parserSource("doc_w2_hm_maria")] } });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["evidence_source_unknown"]);
    expect(codes(run({ direct: { ...good, sources: undefined } }).reviewReasons)).toEqual(["evidence_source_unknown", "evidence_source_unknown"]);
  });

  it("trusts what a reviewer keyed", () => {
    const keyed = run({ direct: { ...good, sources: [parserSource("doc_w2_hm_maria", { extractedBy: "reviewer", extractionConfidence: 0 }), parserSource("doc_w2_hm_daniel")] } });
    expect(keyed.status).toBe("eligible");
    const entered = run({ direct: { ...good, items: [wageItem(MARIA.id, 6_000_000, { source: "reviewer", documentId: null }), wageItem(DANIEL.id, 4_500_000)] } });
    expect(entered).toMatchObject({ status: "eligible", methodBasis: "written_documentation" });
  });

  it("accepts payroll data from a rail as another relevant data source, and never bank deposits as income", () => {
    const railItems = [wageItem(MARIA.id, 6_000_000, { source: "rail", documentId: null, railConnectionId: "rail_maria" }), wageItem(DANIEL.id, 4_500_000)];
    const payroll = { railConnectionId: "rail_maria", provider: "simulated", kind: "payroll" as const, dataBasis: "payroll_gross" as const, retrievedOn: "2027-03-12" };
    const mixed = run({ direct: { ...good, items: railItems }, railReports: [payroll] });
    expect(mixed).toMatchObject({ status: "eligible", methodBasis: "written_documentation_and_other_relevant_data_sources" });
    const railOnly = run({
      direct: { ...good, items: [railItems[0], wageItem(DANIEL.id, 4_500_000, { source: "rail", documentId: null, railConnectionId: "rail_maria" })], sources: [] },
      railReports: [payroll],
    });
    expect(railOnly).toMatchObject({ status: "eligible", methodBasis: "other_relevant_data_sources" });

    const bank = run({ direct: { ...good, items: railItems }, railReports: [{ ...payroll, kind: "bank", dataBasis: "bank_net_deposits" }] });
    expect(bank.status).toBe("needs_review");
    expect(codes(bank.reviewReasons)).toEqual(["rail_bank_net_deposits"]);
    const noReport = run({ direct: { ...good, items: railItems } });
    expect(codes(noReport.reviewReasons)).toEqual(["evidence_source_unknown"]);
  });

  it("always sends self-employment to a person, under or over the limit", () => {
    const item = (cents: number) => extraItem({ id: "se", category: "self_employment_net", annualAmountCents: cents });
    for (const cents of [1_000_000, 90_000_000]) {
      const decision = run({ direct: directEvidence(3_000_000, 2_000_000, [item(cents)]) });
      expect(decision.status).toBe("needs_review");
      expect(codes(decision.reviewReasons)).toEqual(["self_employment_income"]);
    }
  });

  it("sends an item with no roster member or the wrong category to a person", () => {
    const ghost = run({ direct: directEvidence(3_000_000, 2_000_000, [extraItem({ id: "ghost", category: "wages_salary", annualAmountCents: 100_000, memberId: "hm_ghost" })]) });
    expect(codes(ghost.reviewReasons)).toEqual(["income_item_unknown_member"]);
    const misfiled = run({ direct: directEvidence(3_000_000, 2_000_000, [extraItem({ id: "misfiled", category: "minor_earned_income", annualAmountCents: 100_000 })]) });
    expect(codes(misfiled.reviewReasons)).toEqual(["category_member_mismatch"]);
  });

  it("passes on the flags raised while reading the documents", () => {
    const reconciled = (evidence: Parameters<typeof reconcileIncomeEvidence>[0]["evidence"]) => reconcileIncomeEvidence({ incomeYear: INCOME_YEAR, evidence });
    const base = { origin: "document" as const, taxYear: INCOME_YEAR };
    const marias = { ...base, kind: "w2" as const, sourceId: "doc_w2_m", memberId: MARIA.id, employerName: "Synthetic Employer", wagesCents: 6_000_000, medicareWagesCents: null };
    const daniels = { ...marias, sourceId: "doc_w2_d", memberId: DANIEL.id, wagesCents: 4_000_000 };
    const decideOn = (result: ReturnType<typeof reconciled>) =>
      run({
        direct: {
          incomeYear: INCOME_YEAR,
          items: result.items,
          certifications: [NO_OTHER_INCOME],
          evidenceFlags: result.flags,
          sources: [...new Set(result.items.map((item) => item.documentId as string))].map((documentId) => parserSource(documentId)),
        },
      });

    // A filed return that reports less than the W-2s on file.
    const conflict = decideOn(reconciled([marias, daniels, { ...base, kind: "tax_record", sourceId: "doc_1040", form: "filed_return", memberIds: [MARIA.id, DANIEL.id], wagesCents: 8_000_000, otherIncome: { status: "none" } }]));
    expect(conflict.status).toBe("needs_review");
    expect(codes(conflict.reviewReasons)).toEqual(["income_figures_conflict"]);
    expect(conflict.householdIncomeCents).toBe(8_000_000);
    expect(conflict.income!.upperBoundCents).toBe(10_000_000);

    // A mid-year pay stub: a projection, not a number.
    const stub = { origin: "document" as const, kind: "pay_stub" as const, sourceId: "doc_stub", memberId: MARIA.id, employerName: "Synthetic Employer", payDate: "2026-06-19", payFrequency: "biweekly" as const, grossYtdCents: 2_600_000, markedFinal: false };
    const projection = decideOn(reconciled([stub, daniels]));
    expect(projection.status).toBe("needs_review");
    expect(codes(projection.reviewReasons)).toEqual(["pay_stub_projection_only"]);

    // A return whose other lines were not read, a Schedule E style figure, overlapping returns.
    const unread = decideOn(reconciled([{ ...base, kind: "tax_record", sourceId: "doc_1040", form: "filed_return", memberIds: [MARIA.id, DANIEL.id], wagesCents: 8_000_000, otherIncome: { status: "not_read" } }]));
    expect(codes(unread.reviewReasons)).toEqual(["tax_record_incompletely_read"]);
    const scheduleE = decideOn(
      reconciled([
        { ...base, kind: "tax_record", sourceId: "doc_1040", form: "filed_return", memberIds: [MARIA.id, DANIEL.id], wagesCents: 8_000_000, otherIncome: { status: "itemized", lines: [{ line: "rental_royalty_partnership_income", amountCents: 500_000 }] } },
      ]),
    );
    expect(codes(scheduleE.reviewReasons)).toEqual(["schedule_e_income_needs_review"]);
    const overlap = decideOn(
      reconciled([
        { ...base, kind: "tax_record", sourceId: "doc_a", form: "filed_return", memberIds: [MARIA.id, DANIEL.id], wagesCents: 8_000_000, otherIncome: { status: "none" } },
        { ...base, kind: "tax_record", sourceId: "doc_b", form: "filed_return", memberIds: [DANIEL.id, SOFIA.id], wagesCents: 1_000, otherIncome: { status: "none" } },
      ]),
    );
    expect(codes(overlap.reviewReasons)).toContain("tax_records_overlap");

    // A year-end pay stub is an upper figure only: it decides when it is under the limit, and not when it is over.
    const yearEnd = { ...stub, payDate: "2026-12-24", grossYtdCents: 5_200_000 };
    const under = decideOn(reconciled([yearEnd, daniels]));
    expect(under.status).toBe("eligible");
    expect(codes(under.reasons)).toEqual(["income_ambiguity_does_not_change_result", "direct_income_within_limit"]);
    const stubOver = decideOn(reconciled([{ ...yearEnd, grossYtdCents: 40_000_000 }, daniels]));
    expect(stubOver.status).toBe("needs_review");
    expect(codes(stubOver.reviewReasons)).toEqual(["income_range_spans_limit", "amount_basis_unsettled", "wages_from_pay_stub_only"]);
  });
});

describe("decide: open income questions are settled by the bounds or by a person", () => {
  const noBand = { capPct: 300, reviewBandBps: 0 };

  it("decides when the whole range is on one side of the limit", () => {
    const decision = run({ direct: incomeOf(100_000, [extraItem({ id: "gain", category: "realized_capital_gains", annualAmountCents: 2_000_000 })]) });
    expect(decision).toMatchObject({ status: "eligible", householdIncomeCents: 10_000_000 });
    expect(decision.income).toMatchObject({ lowerBoundCents: 10_000_000, upperBoundCents: 12_000_000 });
    expect(codes(decision.reasons)).toEqual(["income_ambiguity_does_not_change_result", "direct_income_within_limit"]);
    const over = run({ direct: incomeOf(400_000, [extraItem({ id: "gain", category: "realized_capital_gains", annualAmountCents: 2_000_000 })]) });
    expect(over.status).toBe("ineligible");
  });

  it.each([
    ["a review category", extraItem({ id: "x", category: "severance_strike_other", annualAmountCents: 3_000_000 }), "income_category_needs_review"],
    ["an unknown category", extraItem({ id: "x", category: "mystery_money", annualAmountCents: 3_000_000 }), "unknown_income_category"],
    ["two figures for one income", extraItem({ id: "x", category: "interest_dividends", annualAmountCents: 100_000, lowCents: 100_000, highCents: 3_000_000 }), "amount_basis_unsettled"],
    ["a net rental loss", extraItem({ id: "x", category: "rental_income_net", annualAmountCents: -2_000_000 }), "net_loss_not_offset"],
  ])("goes to a person when %s puts the limit inside the range", (_name, item, code) => {
    // $312,000 limit, no band. Wages alone are $300,000 (or $320,000 for the loss); the open item moves the total across the limit.
    const wages = code === "net_loss_not_offset" ? 320_000 : 300_000;
    const decision = run({ sgoPolicy: noBand, direct: incomeOf(wages, [item]) });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["income_range_spans_limit", code]);
    expect(decision.reviewReasons[0].message).toMatch(/between \$[\d,]+ and \$[\d,]+/);
  });

  it("goes to a person when a member's facts put the limit inside the range", () => {
    const student: HouseholdMemberInput = { id: "hm_student", firstName: "Elena", ageBand: "adult", fullTimeStudent: true };
    const roommate: HouseholdMemberInput = { id: "hm_roommate", firstName: "Sam", ageBand: "adult", role: "unrelated" };
    const teen: HouseholdMemberInput = { id: "hm_teen", firstName: "Ana", ageBand: "minor", headOrSpouse: true };
    for (const [member, code] of [
      [student, "dependent_deduction_amount_unconfirmed"],
      [roommate, "unrelated_member_income"],
      [teen, "minor_head_or_spouse_income"],
    ] as const) {
      const members = [MARIA, DANIEL, SOFIA, member];
      const evidence = directEvidence(15_000_000, 15_000_000, [wageItem(member.id, 3_000_000)]);
      const decision = run({ sgoPolicy: noBand, household: { size: 4, countyFips: HARRIS.fips, members, custody: { livesInMultipleHouseholds: false } }, direct: evidence });
      expect(decision.status, code).toBe("needs_review");
      expect(codes(decision.reviewReasons), code).toEqual(["income_range_spans_limit", code]);
    }
  });

  it("never finds income over the limit on earned income that names no member", () => {
    // Regression: $300,000 of attributed wages plus a $30,000 W-2 attributed to nobody used to be "ineligible" in Harris County ($312,000).
    const unattributed = wageItem(MARIA.id, 3_000_000, { id: "inc_wages_unattributed", memberId: null, documentId: "doc_w2_unattributed" });
    const decision = run({ sgoPolicy: noBand, direct: directEvidence(15_000_000, 15_000_000, [unattributed]) });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["income_range_spans_limit", "earned_income_unattributed"]);
    expect(decision.income).toMatchObject({ lowerBoundCents: 30_000_000, totalCountedCents: 33_000_000, upperBoundCents: 33_000_000 });
  });

  it("asks whether a member is 18 or older before deciding anything that depends on it", () => {
    const cousin: HouseholdMemberInput = { id: "hm_cousin", firstName: "Luis", kind: "other", ageBand: "unknown" };
    const decision = run({
      household: { size: 4, countyFips: HARRIS.fips, members: [MARIA, DANIEL, SOFIA, cousin], custody: { livesInMultipleHouseholds: false } },
      direct: directEvidence(6_000_000, 4_500_000, [wageItem(cousin.id, 2_000_000)]),
    });
    expect(decision.status).toBe("pending");
    expect(decision.missing.map((item) => [item.code, item.memberId])).toEqual([["member_age_band", cousin.id]]);
    expect(decision.income!.reviewFlags.map((flag) => flag.code)).toEqual(["member_age_unknown"]);
  });
});

describe("decide: the SGO's own cap", () => {
  it("applies a stricter cap of 185% and 250% and says so", () => {
    // Harris, four persons: 185% is $192,400 and 250% is $260,000.
    const at185 = (total: number) => run({ sgoPolicy: { capPct: 185, reviewBandBps: 0 }, direct: incomeOf(total) });
    expect(at185(192_400)).toMatchObject({ status: "eligible", sgoPolicy: { capPct: 185, reviewBandBps: 0 } });
    expect(at185(192_400.01).status).toBe("ineligible");
    expect(codes(at185(100_000).reasons)).toEqual(["direct_income_within_limit", "sgo_stricter_cap_applied"]);
    expect(at185(100_000).threshold).toMatchObject({ capPct: 185, thresholdCents: 19_240_000, statutoryThresholdCents: 31_200_000, statutoryUpperBoundCents: 31_200_000 });

    const at250 = (total: number) => run({ sgoPolicy: { capPct: 250, reviewBandBps: 0 }, direct: incomeOf(total) });
    expect(at250(260_000).status).toBe("eligible");
    expect(at250(260_000.01).status).toBe("ineligible");
    // The same household is within 300%, within 250% and over 185%.
    expect(run({ sgoPolicy: { capPct: 300, reviewBandBps: 0 }, direct: incomeOf(240_000) }).status).toBe("eligible");
    expect(at250(240_000).status).toBe("eligible");
    expect(at185(240_000).status).toBe("ineligible");
  });

  it("scales both readings and the review band with the cap", () => {
    // Starr, four persons at 185%: $71,595 against $154,845.
    const decision = starr({ sgoPolicy: { capPct: 185, reviewBandBps: 500 }, direct: incomeOf(100_000) });
    expect(decision.status).toBe("needs_review");
    expect(codes(decision.reviewReasons)).toEqual(["between_provisional_readings"]);
    expect(decision.threshold).toMatchObject({ lowerBoundCents: 7_159_500, upperBoundCents: 15_484_500, statutoryUpperBoundCents: 25_110_000 });
    expect(decision.threshold!.reviewBand).toEqual({ bps: 500, applied: true, belowLowerCents: 357_975, aboveUpperCents: 774_225 });
  });

  it("does not let a cap change a categorical result", () => {
    expect(run({ sgoPolicy: { capPct: 50, reviewBandBps: 500 }, categorical: { letters: [awardLetter()] } }).status).toBe("eligible");
  });
});

describe("decide: against the installed threshold table", () => {
  const table = getActiveTable();
  const policy = { capPct: 300, reviewBandBps: 500 };

  function membersFor(size: number): HouseholdMemberInput[] {
    if (size === 1) return [{ id: "hm_solo", firstName: "Ana", kind: "student", ageBand: "adult", headOrSpouse: true }];
    return [MARIA, DANIEL, ...Array.from({ length: size - 2 }, (_, index) => ({ id: `hm_child_${index}`, firstName: `Child${index}`, kind: "child" as const, ageBand: "minor" as const }))];
  }
  function evidenceFor(members: HouseholdMemberInput[], totalCents: number) {
    const adults = members.filter((member) => member.ageBand === "adult");
    const items = adults.map((adult, index) => wageItem(adult.id, index === 0 ? totalCents : 0));
    return { incomeYear: INCOME_YEAR, items, certifications: [NO_OTHER_INCOME], sources: items.map((item) => parserSource(item.documentId as string)) };
  }
  function decideAt(countyFips: string, size: number, totalCents: number, sgoPolicy = policy): Decision {
    const members = membersFor(size);
    return record(decide({ today: TODAY, sgoPolicy, household: { size, countyFips, members, custody: { livesInMultipleHouseholds: false } }, direct: evidenceFor(members, totalCents), amiTable: table }));
  }

  it("decides households of 1 to 12 at the cut-offs the table gives", () => {
    for (let size = 1; size <= 12; size++) {
      const probe = decideAt("48201", size, 0);
      const threshold = probe.threshold!;
      const bounds = toThresholdBounds(getThreshold({ countyFips: "48201", householdSize: size, table }));
      expect(threshold.householdSize, `size ${size}`).toBe(size);
      expect([threshold.lowerBoundCents, threshold.upperBoundCents], `size ${size}`).toEqual([bounds.lowerBoundCents, bounds.upperBoundCents]);
      expect(threshold.autoEligibleMaxCents).toBeLessThan(threshold.lowerBoundCents);
      expect(threshold.autoIneligibleAboveCents).toBeGreaterThan(threshold.upperBoundCents);

      expect(decideAt("48201", size, threshold.autoEligibleMaxCents).status, `size ${size} at the eligible cut-off`).toBe("eligible");
      expect(decideAt("48201", size, threshold.autoEligibleMaxCents + 1).status, `size ${size} one cent above it`).toBe("needs_review");
      expect(decideAt("48201", size, threshold.autoIneligibleAboveCents).status, `size ${size} at the ineligible cut-off`).toBe("needs_review");
      expect(decideAt("48201", size, threshold.autoIneligibleAboveCents + 1).status, `size ${size} one cent above it`).toBe("ineligible");
    }
  });

  it("gives larger households a higher limit, including above eight persons", () => {
    const limits = Array.from({ length: 12 }, (_, index) => decideAt("48201", index + 1, 0).threshold!.thresholdCents);
    for (let i = 1; i < limits.length; i++) expect(limits[i], `size ${i + 1}`).toBeGreaterThan(limits[i - 1]);
    // Reading A, four persons, Harris County: 3 x $104,000.
    expect(limits[3]).toBe(31_200_000);
  });

  it("gives every county of a multi-county HUD area the same limit, and a neighbouring area its own", () => {
    const sameArea: string[][] = [
      ["48201", "48157", "48339", "48071", "48167", "48291", "48473"], // Houston-The Woodlands-Sugar Land HMFA
      ["48453", "48491", "48209", "48021", "48055"], // Austin-Round Rock-San Marcos MSA
      ["48113", "48085", "48121"], // Dallas HMFA
      ["48439", "48251", "48367"], // Fort Worth-Arlington HMFA
    ];
    for (const counties of sameArea) {
      const decisions = counties.map((fips) => decideAt(fips, 4, 5_000_000));
      const first = decisions[0].threshold!;
      for (const decision of decisions) {
        expect(decision.status).toBe("eligible");
        expect(decision.threshold!.area.code).toBe(first.area.code);
        expect(decision.threshold!.thresholdCents).toBe(first.thresholdCents);
        expect(decision.threshold!.lowerBoundCents).toBe(first.lowerBoundCents);
        expect(decision.threshold!.upperBoundCents).toBe(first.upperBoundCents);
      }
      expect(new Set(decisions.map((decision) => decision.threshold!.county.fips)).size).toBe(counties.length);
    }
    // Tarrant County is in the same metropolitan area as Dallas County and has its own HUD area and limit.
    expect(decideAt("48439", 4, 0).threshold!.area.code).not.toBe(decideAt("48113", 4, 0).threshold!.area.code);
    expect(decideAt("48439", 4, 0).threshold!.thresholdCents).toBe(33_090_000);
    expect(decideAt("48113", 4, 0).threshold!.thresholdCents).toBe(36_330_000);
  });

  it("applies SGO caps of 185% and 250% to the table's figures", () => {
    for (const capPct of [185, 250]) {
      const decision = decideAt("48201", 4, 5_000_000, { capPct, reviewBandBps: 0 });
      const bounds = toThresholdBounds(getThreshold({ countyFips: "48201", householdSize: 4, capPct, table }));
      expect(decision.threshold).toMatchObject({ capPct, lowerBoundCents: bounds.lowerBoundCents, upperBoundCents: bounds.upperBoundCents, statutoryThresholdCents: 31_200_000 });
      expect(decision.threshold!.thresholdCents).toBe((31_200_000 * capPct) / 300);
      expect(decideAt("48201", 4, bounds.lowerBoundCents, { capPct, reviewBandBps: 0 }).status).toBe("eligible");
      expect(decideAt("48201", 4, bounds.upperBoundCents + 1, { capPct, reviewBandBps: 0 }).status).toBe("ineligible");
    }
  });

  it("records the table on every decision and is provisional exactly when the table is HUD-derived", () => {
    const hud = decideAt("48201", 4, 5_000_000);
    expect(hud.thresholdTable).toEqual({ source: table.source, tableVersion: table.version, effectiveDate: table.effectiveDate, provisional: table.source === "hud_provisional" });
    expect(hud.provisional).toBe(table.source === "hud_provisional");
    expect(hud.threshold).toMatchObject({ source: table.source, tableVersion: table.version, effectiveDate: table.effectiveDate });

    const irs = syntheticIrsTable(2_496_000);
    const members = membersFor(4);
    const published = record(decide({ today: TODAY, sgoPolicy: policy, household: { size: 4, countyFips: "48201", members, custody: { livesInMultipleHouseholds: false } }, direct: evidenceFor(members, 31_200_000), amiTable: irs }));
    expect(published).toMatchObject({ status: "eligible", provisional: false, thresholdTable: { source: "irs_published", provisional: false } });
    expect(published.threshold).toMatchObject({ readingsAgree: true, reviewBand: { applied: false }, reliedOn: "single_limit" });
  });
});

describe("decide: the record it returns", () => {
  it("carries the engine version, the rule set with its three sources of authority, and the policy", () => {
    const decision = run({ direct: directEvidence(6_000_000, 4_500_000) });
    expect(decision.engineVersion).toBe(DECISION_ENGINE_VERSION);
    expect(decision.ruleSet).toEqual({ ...DECISION_RULE_SET });
    expect(decision.ruleSet.proposedRegulation).toContain("not final");
    expect(decision.policy).toEqual({ ...DEFAULT_DECISION_POLICY });
    expect(decision.sgoPolicy).toEqual({ capPct: 300, reviewBandBps: 500 });
  });

  it("is plain data that survives JSON, and never names a household member in a reason", () => {
    const decisions = [
      run({ direct: directEvidence(6_000_000, 4_500_000) }),
      run({ categorical: { letters: [awardLetter()] } }),
      run({ categorical: { letters: [awardLetter({ matchedMemberId: null })] }, direct: directEvidence(20_000_000, 15_000_000, [extraItem({ id: "se", category: "self_employment_net", annualAmountCents: 1 })]) }),
      run({}),
    ];
    for (const decision of decisions) {
      expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
      expect(structuredClone(decision)).toEqual(decision);
      for (const reason of [...decision.reasons, ...decision.reviewReasons]) expect(reason.message).not.toMatch(/Maria|Daniel|Sofia|Mateo|Synthetic/);
    }
  });

  it("is deterministic and leaves its input untouched", () => {
    const freeze = <T>(value: T): T => {
      if (typeof value === "object" && value !== null && !(value instanceof Map)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    };
    const input = freeze(decisionInput({ categorical: { letters: [awardLetter({ extractedBy: "model" })] }, direct: directEvidence(6_000_000, 4_500_000) }));
    const first = decide(input);
    expect(decide(input)).toEqual(first);
    expect(decide(structuredClone(input))).toEqual(first);
  });

  it("keeps status, missing and reviewReasons consistent", () => {
    const cases: Decision[] = [
      run({}),
      run({ direct: directEvidence(6_000_000, 4_500_000) }),
      run({ direct: directEvidence(20_000_000, 15_000_000) }),
      run({ direct: incomeOf(312_000) }),
      run({ categorical: { letters: [awardLetter({ extractedBy: "model" })] } }),
      run({ household: { size: null, countyFips: null, members: FAMILY_OF_FOUR, custody: null }, categorical: { letters: [awardLetter({ extractedBy: "model" })] } }),
    ];
    for (const decision of cases) {
      expect(decision.status === "pending").toBe(decision.missing.length > 0);
      expect(decision.status === "needs_review").toBe(decision.missing.length === 0 && decision.reviewReasons.length > 0);
      if (decision.status === "eligible" || decision.status === "ineligible") {
        expect(decision.method).not.toBeNull();
        expect(decision.validUntil).not.toBeNull();
      } else {
        expect([decision.method, decision.methodBasis, decision.methodCitation, decision.validUntil, decision.awardProgram]).toEqual([null, null, null, null, null]);
      }
    }
    // Everything missing at once is listed, household facts first.
    expect(cases[5].missing.map((item) => item.code)).toEqual(["household_size", "county", "shared_custody_answers"]);
    expect(codes(cases[5].reviewReasons)).toEqual(["letter_read_by_model"]);
  });

  it("explains a pending file with no evidence in the household's words", () => {
    const decision = run({});
    expect(decision.status).toBe("pending");
    expect(decision.missing).toHaveLength(1);
    expect(decision.missing[0]).toMatchObject({ code: "evidence_for_any_method", accepts: ["award_letter", "income_document"], incomeYear: 2026 });
    expect(decision.missing[0].message.en).toContain("SNAP, TANF, WIC, Section 8 housing or SSI");
    expect(decision.missing[0].message.en).toContain("proof of 2026 income for each adult");
    expect(decision.missing[0].message.es).toContain("comprobante de los ingresos de 2026 de cada adulto");
  });
});

describe("decide: input validation", () => {
  const invalidInputs: Array<[string, () => unknown]> = [
    ["an SGO cap above 300%", () => decide(decisionInput({ sgoPolicy: { capPct: 301, reviewBandBps: 500 }, threshold: undefined, amiTable: getActiveTable() }))],
    ["an SGO cap of zero", () => decide(decisionInput({ sgoPolicy: { capPct: 0, reviewBandBps: 500 }, amiTable: getActiveTable() }))],
    ["a fractional cap", () => decide(decisionInput({ sgoPolicy: { capPct: 185.5, reviewBandBps: 500 }, amiTable: getActiveTable() }))],
    ["a negative review band", () => decide(decisionInput({ sgoPolicy: { capPct: 300, reviewBandBps: -1 } }))],
    ["a review band above the maximum", () => decide(decisionInput({ sgoPolicy: { capPct: 300, reviewBandBps: 10_001 } }))],
    ["a date that does not exist", () => decide(decisionInput({ today: "2027-02-29" }))],
    ["an application dated after the decision", () => decide(decisionInput({ applicationDate: "2027-03-16" }))],
    ["a household size of zero", () => decide(decisionInput({ household: { size: 0, countyFips: HARRIS.fips, members: [], custody: null } }))],
    ["more than twelve months in a year", () => decide(decisionInput({ household: { size: 4, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: true, monthsInThisHousehold: 13 } } }))],
    ["two letters with the same document id", () => decide(decisionInput({ categorical: { letters: [awardLetter(), awardLetter()] } }))],
    ["a confidence above 1", () => decide(decisionInput({ categorical: { letters: [awardLetter({ extractionConfidence: 1.2 })] } }))],
    ["a letter date that is not a date", () => decide(decisionInput({ categorical: { letters: [awardLetter({ letterDate: "January 10, 2027" })] } }))],
    ["an unknown field", () => decide({ ...decisionInput(), surprise: true } as unknown as DecisionInput)],
    ["an injected threshold for another household size", () => decide(decisionInput({ threshold: thresholdFixture(HARRIS, { householdSize: 5 }) }))],
    ["an injected threshold for another cap", () => decide(decisionInput({ sgoPolicy: { capPct: 185, reviewBandBps: 0 }, threshold: thresholdFixture(HARRIS, { capPct: 300 }) }))],
    ["an injected threshold for another county", () => decide(decisionInput({ threshold: thresholdFixture(STARR) }))],
    ["an injected threshold whose provisional flag contradicts its source", () => decide(decisionInput({ threshold: { ...thresholdFixture(HARRIS), provisional: false } as DecisionInput["threshold"] }))],
    ["a negative wage", () => decide(decisionInput({ direct: directEvidence(-1, 0) }))],
    // Regression: these reached property reads on the injected object and crashed with a TypeError.
    ["an injected threshold that is an empty object", () => decide(decisionInput({ threshold: {} as DecisionInput["threshold"] }))],
    ["an injected threshold without a county", () => decide(decisionInput({ threshold: omit(thresholdFixture(HARRIS), "county") as DecisionInput["threshold"] }))],
    ["an injected threshold that is a string", () => decide(decisionInput({ threshold: "312000" as unknown as DecisionInput["threshold"] }))],
    ["an injected threshold with an unknown source", () => decide(decisionInput({ threshold: { ...thresholdFixture(HARRIS), source: "guess" } as unknown as DecisionInput["threshold"] }))],
  ];
  it.each(invalidInputs)("rejects %s", (_name, attempt) => {
    let thrown: unknown;
    try {
      attempt();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("validation_failed");
  });
});

describe("decide: reason codes", () => {
  it("records a reviewer's resolution with its own code", () => {
    const review = run({ categorical: { letters: [awardLetter({ extractedBy: "model" })] } });
    record(applyReviewerResolution(review, { resolution: "eligible", reviewerId: "usr_reviewer", notes: "Read the letter; fields confirmed.", basis: { method: "categorical", documentId: "doc_letter" }, resolvedOn: TODAY }));
  });

  it("has no duplicate codes", () => {
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
  });

  it("has, for every code, at least one scenario in this file that produces it", () => {
    // Tests in a file run in order, so every scenario above has been recorded by now.
    expect(FAMILY_OF_FOUR).toContain(MATEO);
    expect(seenCodes.size).toBeGreaterThan(50);
    expect([...REASON_CODES].filter((code) => !seenCodes.has(code))).toEqual([]);
    expect([...seenCodes].filter((code) => !(REASON_CODES as readonly string[]).includes(code))).toEqual([]);
  });
});
