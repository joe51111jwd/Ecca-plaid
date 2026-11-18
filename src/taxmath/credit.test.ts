/**
 * The section 25F credit computation against the published examples.
 *
 * T1 to T8 are the test vectors in docs/reference/donor-credit-rules.md (section M and its test-vector
 * table), which restate Examples 1 to 5 of Prop. Treas. Reg. 1.25F-2(h) and two preamble examples of
 * REG-117199-25. The expected numbers are the regulation's own; do not change one without re-reading the
 * source. Every other fixture in this file is synthetic.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { CREDIT_CAP_PER_TAXPAYER_CENTS, JOINT_RETURN_MAX_CREDIT_CENTS, RULES, TAXMATH_VERSION } from "./constants";
import { COPY, COPY_VERSION } from "./copy";
import {
  applyLiabilityLimit,
  carryforwardWindow,
  computeTaxpayerCredit,
  previewCredit,
  suggestDesignation,
  type CarryforwardBucketInput,
  type CreditPreviewInput,
  type TaxpayerCreditInput,
} from "./credit";

const usd = (dollars: number) => dollars * 100;
const CAP = CREDIT_CAP_PER_TAXPAYER_CENTS.value;

/** "In January 2027" (the examples' facts), safely after the credit start in every time zone. */
const JANUARY_2027 = new Date("2027-01-15T18:00:00Z");

function expectValidationError(run: () => unknown, field?: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  const error = thrown as AppError;
  expect(error.code).toBe("validation_failed");
  expect(error.status).toBe(422);
  if (field) expect(Object.keys((error.details as { fields: Record<string, string> }).fields)).toContain(field);
}

/** Small deterministic generator so the generated cases are the same on every run. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("published examples (docs/reference/donor-credit-rules.md, section M)", () => {
  it("T1 / F73 Example 1: $2,000 designated, no State credit -> credit $1,700, $300 over the cap", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(2000) });
    expect(credit.creditCents).toBe(usd(1700));
    expect(credit.overCapCents).toBe(usd(300));
    expect(credit.noCreditAllowedCents).toBe(usd(300));
    expect(credit.removedByStateCreditCents).toBe(0);
    expect(credit.designatedAboveCap).toBe(true);

    const preview = previewCredit({ filingStatus: "single", asOf: JANUARY_2027, taxpayers: [{ designatedCents: usd(2000) }] });
    expect(preview.totals.creditCents).toBe(usd(1700));
    expect(preview.totals.overCapCents).toBe(usd(300));
    expect(preview.flags.overCapDesignation).toBe(true);
    // "The remaining $300 ... may be deductible ... if it meets the requirements of section 170": the conditional note, never "is deductible".
    expect(preview.noteIds).toContain("note.excess_may_be_deductible");
    expect(preview.noteIds).toContain("note.section_170_no_double_benefit");
    expect(preview.taxpayers[0].lines.find((line) => line.id === "over_cap")?.amountCents).toBe(usd(300));
  });

  it("T2 / F74 Example 2: spouses B and C each designate $2,000 -> $1,700 + $1,700 = $3,400, $600 over the caps, one combined limit", () => {
    const preview = previewCredit({
      filingStatus: "married_joint",
      asOf: JANUARY_2027,
      taxpayers: [{ designatedCents: usd(2000) }, { designatedCents: usd(2000) }],
    });
    expect(preview.taxpayers.map((taxpayer) => taxpayer.role)).toEqual(["spouse_1", "spouse_2"]);
    expect(preview.taxpayers.map((taxpayer) => taxpayer.creditCents)).toEqual([usd(1700), usd(1700)]);
    expect(preview.totals.creditCents).toBe(usd(3400));
    expect(preview.totals.creditCents).toBe(JOINT_RETURN_MAX_CREDIT_CENTS.value);
    expect(preview.totals.overCapCents).toBe(usd(600));
    expect(preview.totals.applicableCapCents).toBe(usd(3400));
    expect(preview.flags.oneSpouseOnly).toBe(false);
    expect(preview.totalLines).toEqual([{ id: "joint_total_credit", copyId: "line.joint_total_credit", amountCents: usd(3400), role: "result" }]);
    expect(preview.noteIds).toContain("note.joint_each_spouse");
    expect(preview.rulesApplied).toContain("jointReturnSpousesAreSeparateTaxpayers");

    // "The credit will be subject to their combined tax liability limitation under section 26(a)" (F19).
    const limited = previewCredit({
      filingStatus: "married_joint",
      asOf: JANUARY_2027,
      taxYear: 2027,
      taxpayers: [{ designatedCents: usd(2000) }, { designatedCents: usd(2000) }],
      liability: { estimatedTaxCents: usd(2000) },
    });
    expect(limited.liability?.limitCents).toBe(usd(2000));
    expect(limited.liability?.currentYearCreditCents).toBe(usd(3400));
    expect(limited.liability?.totalCreditUsedCents).toBe(usd(2000));
    expect(limited.liability?.newCarryforwardCents).toBe(usd(1400));
    expect(limited.noteIds).toContain("note.joint_combined_limit");
    expect(limited.rulesApplied).toContain("jointReturnCombinedLiabilityLimit");
  });

  it("T3 / F75 Example 3: $1,500 + $500 designated, $400 State credit, nothing non-designated -> $2,000 - $400 = $1,600 credit", () => {
    const detailed = computeTaxpayerCredit({ designatedCents: usd(1500) + usd(500), stateCredits: [{ amountCents: usd(400), nonQualifiedBaseCents: 0 }] });
    const simple = computeTaxpayerCredit({ designatedCents: usd(2000), expectedStateCreditCents: usd(400) });
    for (const credit of [detailed, simple]) {
      expect(credit.qualifiedContributionCents).toBe(usd(2000));
      expect(credit.stateCreditReductionCents).toBe(usd(400));
      expect(credit.qualifiedAfterStateCreditCents).toBe(usd(1600));
      expect(credit.creditCents).toBe(usd(1600));
      expect(credit.removedByStateCreditCents).toBe(usd(400));
      expect(credit.overCapCents).toBe(0);
      expect(credit.stateCreditReducesCredit).toBe(true);
      // No non-designated amount is involved, so this is the regulation's own example, not the spillover extrapolation.
      expect(credit.stateCreditSpilloverEstimated).toBe(false);
    }
  });

  it("T4 / F76 Example 4: $4,000 gift, $1,700 designated, $400 State credit absorbed by the $2,300 non-designated part -> credit $1,700", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(1700), nonDesignatedCents: usd(2300), expectedStateCreditCents: usd(400) });
    expect(credit.stateCreditAbsorbedByNonQualifiedCents).toBe(usd(400));
    expect(credit.stateCreditReductionCents).toBe(0);
    expect(credit.qualifiedAfterStateCreditCents).toBe(usd(1700));
    expect(credit.creditCents).toBe(usd(1700));
    expect(credit.stateCreditReducesCredit).toBe(false);
    // A pro-rata reading (10 percent of every dollar) would give $1,530. One-for-one absorption gives $1,700.
    expect(credit.creditCents).not.toBe(usd(1530));
    expect(credit.rulesApplied).toContain("stateCreditAbsorptionOrder");
  });

  it("T5 / F13 preamble: $2,500 designated with a $500 State credit -> reduce THEN cap = $1,700 (not the rejected $1,200)", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(2500), expectedStateCreditCents: usd(500) });
    expect(credit.qualifiedAfterStateCreditCents).toBe(usd(2000));
    expect(credit.creditCents).toBe(usd(1700));
    expect(credit.creditCents).not.toBe(usd(1200));
    expect(credit.removedByStateCreditCents).toBe(usd(500));
    expect(credit.overCapCents).toBe(usd(300));
    // The State credit reduced the qualified contribution but not the credit itself.
    expect(credit.stateCreditReducesCredit).toBe(false);
    expect(credit.rulesApplied).toContain("stateCreditReductionBeforeCap");
  });

  it("T6 / F78 economic analysis: $5,000 gift, $1,700 designated, $2,000 State credit -> federal $1,700, combined benefit $3,700", () => {
    const preview = previewCredit({
      filingStatus: "single",
      asOf: JANUARY_2027,
      taxpayers: [{ designatedCents: usd(1700), nonDesignatedCents: usd(3300), expectedStateCreditCents: usd(2000) }],
    });
    expect(preview.totals.giftCents).toBe(usd(5000));
    expect(preview.totals.creditCents).toBe(usd(1700));
    expect(preview.totals.combinedFederalAndStateCreditCents).toBe(usd(3700));
    expect(preview.taxpayers[0].stateCreditAbsorbedByNonQualifiedCents).toBe(usd(2000));
    expect(preview.taxpayers[0].removedByStateCreditCents).toBe(0);
    // The rejected alternative (State credit against the qualified contribution first) gives a federal credit of $0.
    expect(preview.totals.creditCents).not.toBe(0);
    expect(preview.flags.stateCreditReducesFederal).toBe(false);
  });

  it("T7 / F77 Example 5, Table 1: six years of carryforward, the cap applied before a year's credit is carried", () => {
    const years = [
      { taxYear: 2027, qualified: 1000, limit: 900 },
      { taxYear: 2028, qualified: 1000, limit: 0 },
      { taxYear: 2029, qualified: 1000, limit: 0 },
      { taxYear: 2030, qualified: 1500, limit: 0 },
      { taxYear: 2031, qualified: 1500, limit: 0 },
      { taxYear: 2032, qualified: 2000, limit: 0 },
    ];
    const expected = {
      cumulativeCarryforwardEntering: [0, 100, 1100, 2100, 3600, 5100],
      creditUsed: [900, 0, 0, 0, 0, 0],
      carryforwardFromThatYear: [100, 1000, 1000, 1500, 1500, 1700],
    };

    let carryforwards: CarryforwardBucketInput[] = [];
    years.forEach((year, index) => {
      const preview = previewCredit({
        filingStatus: "single",
        asOf: new Date(`${year.taxYear}-06-15T18:00:00Z`),
        taxYear: year.taxYear,
        taxpayers: [{ designatedCents: usd(year.qualified) }],
        liability: { estimatedTaxCents: usd(year.limit), carryforwards },
      });
      const liability = preview.liability!;
      expect(liability.availableCarryforwardCents, `cumulative carryforward entering ${year.taxYear}`).toBe(usd(expected.cumulativeCarryforwardEntering[index]));
      expect(liability.totalCreditUsedCents, `credit used in ${year.taxYear}`).toBe(usd(expected.creditUsed[index]));
      expect(liability.newCarryforwardCents, `carryforward from ${year.taxYear}`).toBe(usd(expected.carryforwardFromThatYear[index]));
      carryforwards = liability.carriedToNextYear;
    });

    // 2032: $2,000 of qualified contributions leaves a $1,700 carryforward, not $2,000 (F34).
    // What reaches 2033 is 2028 to 2032; the $100 from 2027 was in its last usable year in 2032.
    expect(carryforwards).toEqual([
      { originYear: 2028, amountCents: usd(1000) },
      { originYear: 2029, amountCents: usd(1000) },
      { originYear: 2030, amountCents: usd(1500) },
      { originYear: 2031, amountCents: usd(1500) },
      { originYear: 2032, amountCents: usd(1700) },
    ]);
  });

  it("T8 / F77 Example 5, 2033 and Table 2: 2027 bucket expired, $4,500 used oldest first, $3,900 carried to 2034", () => {
    const preview = previewCredit({
      filingStatus: "single",
      asOf: new Date("2033-06-15T18:00:00Z"),
      taxYear: 2033,
      taxpayers: [{ designatedCents: usd(2000) }],
      liability: {
        estimatedTaxCents: usd(4500),
        otherCreditsCents: 0,
        carryforwards: [
          { originYear: 2027, amountCents: usd(100) },
          { originYear: 2028, amountCents: usd(1000) },
          { originYear: 2029, amountCents: usd(1000) },
          { originYear: 2030, amountCents: usd(1500) },
          { originYear: 2031, amountCents: usd(1500) },
          { originYear: 2032, amountCents: usd(1700) },
        ],
      },
    });
    const liability = preview.liability!;
    expect(liability.expiredCarryforwardCents).toBe(usd(100));
    expect(liability.availableCarryforwardCents).toBe(usd(6700));
    expect(liability.limitCents).toBe(usd(4500));

    // Table 2, column "Carryforward used in 2033".
    expect(liability.buckets.map((bucket) => [bucket.originYear, bucket.expired, bucket.usedCents])).toEqual([
      [2027, true, 0],
      [2028, false, usd(1000)],
      [2029, false, usd(1000)],
      [2030, false, usd(1500)],
      [2031, false, usd(1000)],
      [2032, false, 0],
    ]);
    expect(liability.carryforwardUsedCents).toBe(usd(4500));
    expect(liability.currentYearCreditCents).toBe(usd(1700));
    expect(liability.currentYearCreditUsedCents).toBe(0);
    expect(liability.newCarryforwardCents).toBe(usd(1700));
    expect(liability.totalCreditUsedCents).toBe(usd(4500));

    // "The remaining $500 from 2031, $1,700 from 2032, and the $1,700 from 2033 will be carried forward".
    expect(liability.carriedToNextYear).toEqual([
      { originYear: 2031, amountCents: usd(500) },
      { originYear: 2032, amountCents: usd(1700) },
      { originYear: 2033, amountCents: usd(1700) },
    ]);
    // Table 2's last column is a running total: 500, 2,200, 3,900.
    const running = liability.carriedToNextYear.reduce<number[]>((totals, bucket) => [...totals, (totals.at(-1) ?? 0) + bucket.amountCents], []);
    expect(running).toEqual([usd(500), usd(2200), usd(3900)]);
    expect(liability.totalCarriedToNextYearCents).toBe(usd(3900));

    expect(preview.flags.carryforwardExpired).toBe(true);
    expect(preview.noteIds).toContain("note.carryforward_expired");
    expect(preview.noteIds).toContain("note.carryforward_before_current");
    expect(preview.rulesApplied).toEqual(expect.arrayContaining(["carryforwardYears", "carryforwardUseOrder", "carryforwardUsedBeforeCurrentYearCredit"]));
  });
});

describe("computeTaxpayerCredit", () => {
  it("is dollar for dollar below the cap and exactly the cap at the cap", () => {
    expect(computeTaxpayerCredit({ designatedCents: 1 }).creditCents).toBe(1);
    expect(computeTaxpayerCredit({ designatedCents: usd(1000) }).creditCents).toBe(usd(1000));
    expect(computeTaxpayerCredit({ designatedCents: CAP - 1 }).creditCents).toBe(CAP - 1);
    const atCap = computeTaxpayerCredit({ designatedCents: CAP });
    expect(atCap.creditCents).toBe(CAP);
    expect(atCap.overCapCents).toBe(0);
    expect(atCap.designatedAboveCap).toBe(false);
    const overCap = computeTaxpayerCredit({ designatedCents: CAP + 1 });
    expect(overCap.creditCents).toBe(CAP);
    expect(overCap.overCapCents).toBe(1);
    expect(overCap.designatedAboveCap).toBe(true);
  });

  it("gives no credit for a gift that is not designated", () => {
    const credit = computeTaxpayerCredit({ designatedCents: 0, nonDesignatedCents: usd(5000) });
    expect(credit.creditCents).toBe(0);
    expect(credit.qualifiedContributionCents).toBe(0);
    expect(credit.noCreditAllowedCents).toBe(0);
  });

  it("subtracts goods or services from the designated amount before anything else (F45)", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(2000), goodsOrServicesValueCents: usd(500) });
    expect(credit.qualifiedContributionCents).toBe(usd(1500));
    expect(credit.creditCents).toBe(usd(1500));
    expect(credit.overCapCents).toBe(0);
    expect(credit.rulesApplied).toContain("goodsOrServicesReduceQualifiedContribution");

    const swallowed = computeTaxpayerCredit({ designatedCents: usd(100), goodsOrServicesValueCents: usd(150) });
    expect(swallowed.qualifiedContributionCents).toBe(0);
    expect(swallowed.creditCents).toBe(0);
    expect(swallowed.goodsOrServicesExceedDesignated).toBe(true);
  });

  it("F10: applies one cap to the year's total, counting the taxpayer's other qualified contributions", () => {
    // Already gave $1,700 elsewhere this year: a further designated $1,000 adds no credit.
    const used = computeTaxpayerCredit({ designatedCents: usd(1000), otherQualifiedContributionsCents: usd(1700) });
    expect(used.qualifiedContributionCents).toBe(usd(2700));
    expect(used.creditCents).toBe(usd(1700));
    expect(used.creditAddedByThisGiftCents).toBe(0);
    expect(used.overCapCents).toBe(usd(1000));
    expect(used.designatedAboveCap).toBe(true);
    expect(used.rulesApplied).toContain("creditBaseIsAnnualAggregate");

    // Gave $1,000 elsewhere: a designated $1,000 adds only the remaining $700.
    const partial = computeTaxpayerCredit({ designatedCents: usd(1000), otherQualifiedContributionsCents: usd(1000) });
    expect(partial.creditCents).toBe(usd(1700));
    expect(partial.creditAddedByThisGiftCents).toBe(usd(700));
    expect(partial.overCapCents).toBe(usd(300));

    // Other contributions are already net; goods or services come off this gift only.
    const net = computeTaxpayerCredit({ designatedCents: usd(500), goodsOrServicesValueCents: usd(600), otherQualifiedContributionsCents: usd(200) });
    expect(net.giftQualifiedContributionCents).toBe(0);
    expect(net.qualifiedContributionCents).toBe(usd(200));
    expect(net.creditCents).toBe(usd(200));
    expect(net.creditAddedByThisGiftCents).toBe(0);

    const none = computeTaxpayerCredit({ designatedCents: usd(1000) });
    expect(none.otherQualifiedContributionsCents).toBe(0);
    expect(none.creditAddedByThisGiftCents).toBe(usd(1000));
    expect(none.rulesApplied).not.toContain("creditBaseIsAnnualAggregate");
  });

  it("T3 / F75 Example 3 as a checkout sees it: $1,500 to Org X with a $400 State credit, $500 given to Org Y -> $1,600 for the year", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(1500), expectedStateCreditCents: usd(400), otherQualifiedContributionsCents: usd(500) });
    expect(credit.qualifiedContributionCents).toBe(usd(2000));
    expect(credit.creditCents).toBe(usd(1600));
    expect(credit.creditAddedByThisGiftCents).toBe(usd(1100));
  });

  it("treats negative zero as zero and never returns it", () => {
    const credit = computeTaxpayerCredit({ designatedCents: -0, nonDesignatedCents: -0, goodsOrServicesValueCents: -0, expectedStateCreditCents: -0 });
    for (const [key, value] of Object.entries(credit)) {
      if (typeof value === "number") expect(Object.is(value, -0), key).toBe(false);
    }
    expect(credit.creditCents).toBe(0);
  });

  it("never lets a State credit push the credit below zero (F12: \"but not to below zero\")", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(1000), expectedStateCreditCents: usd(5000) });
    expect(credit.qualifiedAfterStateCreditCents).toBe(0);
    expect(credit.creditCents).toBe(0);
    expect(credit.removedByStateCreditCents).toBe(usd(1000));
    expect(credit.overCapCents).toBe(0);
  });

  it("partial spillover: the State credit beyond the non-designated amount reduces the qualified contribution, flagged as an estimate", () => {
    const credit = computeTaxpayerCredit({ designatedCents: usd(1700), nonDesignatedCents: usd(300), expectedStateCreditCents: usd(500) });
    expect(credit.stateCreditAbsorbedByNonQualifiedCents).toBe(usd(300));
    expect(credit.stateCreditReductionCents).toBe(usd(200));
    expect(credit.creditCents).toBe(usd(1500));
    expect(credit.stateCreditSpilloverEstimated).toBe(true);
    expect(credit.rulesApplied).toContain("stateCreditPartialSpillover");
    expect(RULES.stateCreditPartialSpillover.authority).toBe("product_policy");
  });

  it("a State credit only absorbs against non-designated cash it is actually allowed for", () => {
    // $400 State credit on a fully designated gift to one SGO; an unrelated $2,000 non-designated gift to another SGO earns no State credit.
    const credit = computeTaxpayerCredit({
      designatedCents: usd(1700),
      nonDesignatedCents: usd(2000),
      stateCredits: [{ amountCents: usd(400), nonQualifiedBaseCents: 0 }],
    });
    expect(credit.stateCreditAbsorbedByNonQualifiedCents).toBe(0);
    expect(credit.creditCents).toBe(usd(1300));
  });

  it("sums several State credits, each against its own non-designated base", () => {
    const credit = computeTaxpayerCredit({
      designatedCents: usd(1700),
      nonDesignatedCents: usd(1000),
      stateCredits: [
        { amountCents: usd(300), nonQualifiedBaseCents: usd(600) },
        { amountCents: usd(500), nonQualifiedBaseCents: usd(400) },
      ],
    });
    expect(credit.stateCreditCents).toBe(usd(800));
    expect(credit.stateCreditAbsorbedByNonQualifiedCents).toBe(usd(700));
    expect(credit.stateCreditReductionCents).toBe(usd(100));
    expect(credit.creditCents).toBe(usd(1600));
  });

  it("refuses two State credits absorbing against the same non-designated dollars, and both input forms at once", () => {
    expectValidationError(
      () =>
        computeTaxpayerCredit({
          designatedCents: usd(1700),
          nonDesignatedCents: usd(500),
          stateCredits: [
            { amountCents: usd(400), nonQualifiedBaseCents: usd(500) },
            { amountCents: usd(400), nonQualifiedBaseCents: usd(500) },
          ],
        }),
      "stateCredits",
    );
    expectValidationError(() => computeTaxpayerCredit({ designatedCents: usd(1700), expectedStateCreditCents: usd(100), stateCredits: [] }), "stateCredits");
  });

  it.each([
    ["a negative amount", { designatedCents: -1 }, "designatedCents"],
    ["NaN", { designatedCents: Number.NaN }, "designatedCents"],
    ["a fraction of a cent", { designatedCents: 100.5 }, "designatedCents"],
    ["Infinity", { designatedCents: Number.POSITIVE_INFINITY }, "designatedCents"],
    ["an unsafe integer", { designatedCents: Number.MAX_SAFE_INTEGER + 1 }, "designatedCents"],
    ["a numeric string", { designatedCents: "170000" }, "designatedCents"],
    ["a missing amount", {}, "designatedCents"],
    ["null", { designatedCents: null }, "designatedCents"],
    ["a negative non-designated amount", { designatedCents: 100, nonDesignatedCents: -5 }, "nonDesignatedCents"],
    ["a NaN State credit", { designatedCents: 100, expectedStateCreditCents: Number.NaN }, "expectedStateCreditCents"],
    ["a negative State credit", { designatedCents: 100, expectedStateCreditCents: -1 }, "expectedStateCreditCents"],
    ["negative goods or services", { designatedCents: 100, goodsOrServicesValueCents: -1 }, "goodsOrServicesValueCents"],
    ["negative other contributions", { designatedCents: 100, otherQualifiedContributionsCents: -1 }, "otherQualifiedContributionsCents"],
    ["fractional other contributions", { designatedCents: 100, otherQualifiedContributionsCents: 0.1 }, "otherQualifiedContributionsCents"],
    ["a negative detailed State credit", { designatedCents: 100, stateCredits: [{ amountCents: -1, nonQualifiedBaseCents: 0 }] }, "stateCredits.0.amountCents"],
    ["a misspelled field", { designatedCents: 100, designatedCent: 5 }, "_"],
  ])("rejects %s with validation_failed", (_label, input, field) => {
    expectValidationError(() => computeTaxpayerCredit(input as unknown as TaxpayerCreditInput), field);
  });

  it("rejects a non-object and totals that cannot be added exactly", () => {
    expectValidationError(() => computeTaxpayerCredit(null as unknown as TaxpayerCreditInput));
    expectValidationError(() => computeTaxpayerCredit(170000 as unknown as TaxpayerCreditInput));
    expectValidationError(() => computeTaxpayerCredit({ designatedCents: Number.MAX_SAFE_INTEGER, nonDesignatedCents: 1 }), "designatedCents");
    expectValidationError(() => computeTaxpayerCredit({ designatedCents: Number.MAX_SAFE_INTEGER, otherQualifiedContributionsCents: 1 }), "otherQualifiedContributionsCents");
  });

  it("handles the largest safe amount without losing a cent", () => {
    const credit = computeTaxpayerCredit({ designatedCents: Number.MAX_SAFE_INTEGER });
    expect(credit.creditCents).toBe(CAP);
    expect(credit.overCapCents).toBe(Number.MAX_SAFE_INTEGER - CAP);
  });

  it("matches the closed form min(designated, cap, max(0, gift - State credit)) on 5,000 generated gifts", () => {
    const random = prng(20261118);
    for (let i = 0; i < 5000; i++) {
      const giftCents = Math.floor(random() * 700_000);
      const designatedCents = Math.floor(random() * (giftCents + 1));
      const stateCreditCents = random() < 0.3 ? 0 : Math.floor(random() * 700_000);
      const credit = computeTaxpayerCredit({ designatedCents, nonDesignatedCents: giftCents - designatedCents, expectedStateCreditCents: stateCreditCents });
      const expected = Math.min(designatedCents, CAP, Math.max(0, giftCents - stateCreditCents));
      expect(credit.creditCents, `gift ${giftCents}, designated ${designatedCents}, State credit ${stateCreditCents}`).toBe(expected);
      expect(credit.creditAddedByThisGiftCents).toBe(credit.creditCents);

      // The same gift on top of other qualified contributions made in the year: one cap for the total.
      const otherCents = Math.floor(random() * 300_000);
      const withOther = computeTaxpayerCredit({
        designatedCents,
        nonDesignatedCents: giftCents - designatedCents,
        expectedStateCreditCents: stateCreditCents,
        otherQualifiedContributionsCents: otherCents,
      });
      const spilloverCents = Math.max(0, stateCreditCents - (giftCents - designatedCents));
      expect(withOther.creditCents).toBe(Math.min(CAP, Math.max(0, designatedCents + otherCents - spilloverCents)));
      expect(withOther.creditCents + withOther.overCapCents + withOther.removedByStateCreditCents).toBe(designatedCents + otherCents);
      expect(withOther.creditAddedByThisGiftCents).toBe(Math.max(0, withOther.creditCents - Math.min(otherCents, CAP)));
      expect(withOther.creditAddedByThisGiftCents).toBeLessThanOrEqual(withOther.creditCents);

      // Accounting identities that hold for every input.
      expect(credit.creditCents + credit.overCapCents + credit.removedByStateCreditCents).toBe(credit.qualifiedContributionCents);
      expect(credit.noCreditAllowedCents).toBe(credit.overCapCents + credit.removedByStateCreditCents);
      expect(credit.stateCreditAbsorbedByNonQualifiedCents + credit.stateCreditReductionCents).toBe(credit.stateCreditCents);
      expect(credit.creditCents).toBeGreaterThanOrEqual(0);
      expect(credit.creditCents).toBeLessThanOrEqual(CAP);
      expect(credit.creditCents).toBeLessThanOrEqual(credit.creditWithoutStateCreditCents);
      expect(Number.isSafeInteger(credit.creditCents)).toBe(true);
    }
  });

  it("for a fixed gift, designating more than the cap never raises the credit; a larger State credit never raises it either", () => {
    const random = prng(1700);
    for (let i = 0; i < 1500; i++) {
      const giftCents = CAP + Math.floor(random() * 500_000);
      const stateCreditCents = Math.floor(random() * 400_000);
      const atCap = computeTaxpayerCredit({ designatedCents: CAP, nonDesignatedCents: giftCents - CAP, expectedStateCreditCents: stateCreditCents });
      const above = CAP + Math.floor(random() * (giftCents - CAP + 1));
      const more = computeTaxpayerCredit({ designatedCents: above, nonDesignatedCents: giftCents - above, expectedStateCreditCents: stateCreditCents });
      expect(more.creditCents).toBe(atCap.creditCents);

      const biggerStateCredit = computeTaxpayerCredit({ designatedCents: above, nonDesignatedCents: giftCents - above, expectedStateCreditCents: stateCreditCents + Math.floor(random() * 100_000) });
      expect(biggerStateCredit.creditCents).toBeLessThanOrEqual(more.creditCents);
    }
  });
});

describe("joint returns: per spouse, then added", () => {
  const joint = (taxpayers: CreditPreviewInput["taxpayers"]) => previewCredit({ filingStatus: "married_joint", asOf: JANUARY_2027, taxpayers });

  it("one spouse designating $3,400 earns $1,700, never min(couple total, $3,400)", () => {
    const twoEntries = joint([{ designatedCents: usd(3400) }, { designatedCents: 0 }]);
    expect(twoEntries.totals.creditCents).toBe(usd(1700));
    expect(twoEntries.totals.creditCents).not.toBe(Math.min(usd(3400), JOINT_RETURN_MAX_CREDIT_CENTS.value));
    expect(twoEntries.totals.applicableCapCents).toBe(usd(1700));
    expect(twoEntries.totals.overCapCents).toBe(usd(1700));
    expect(twoEntries.flags.oneSpouseOnly).toBe(true);
    expect(twoEntries.noteIds).toContain("note.one_spouse_only");
    expect(twoEntries.noteIds).toContain("note.joint_each_spouse");

    const oneEntry = joint([{ designatedCents: usd(3400) }]);
    expect(oneEntry.taxpayers).toHaveLength(1);
    expect(oneEntry.taxpayers[0].role).toBe("spouse_1");
    expect(oneEntry.totals.creditCents).toBe(usd(1700));
    expect(oneEntry.flags.oneSpouseOnly).toBe(true);
  });

  it("an uneven split is capped spouse by spouse", () => {
    const preview = joint([{ designatedCents: usd(2500) }, { designatedCents: usd(900) }]);
    expect(preview.taxpayers.map((taxpayer) => taxpayer.creditCents)).toEqual([usd(1700), usd(900)]);
    expect(preview.totals.creditCents).toBe(usd(2600));
    expect(preview.flags.oneSpouseOnly).toBe(false);
  });

  it("each spouse's State credit only touches that spouse's computation", () => {
    const preview = joint([{ designatedCents: usd(1700), expectedStateCreditCents: usd(700) }, { designatedCents: usd(1700) }]);
    expect(preview.taxpayers.map((taxpayer) => taxpayer.creditCents)).toEqual([usd(1000), usd(1700)]);
    expect(preview.rulesApplied).toContain("jointStateCreditAllocation");
  });

  it("the joint total never exceeds the cap for each contributing spouse, over generated couples", () => {
    const random = prng(3400);
    for (let i = 0; i < 2000; i++) {
      const first = random() < 0.15 ? 0 : Math.floor(random() * 600_000);
      const second = random() < 0.15 ? 0 : Math.floor(random() * 600_000);
      const preview = joint([{ designatedCents: first }, { designatedCents: second }]);
      expect(preview.totals.creditCents).toBe(Math.min(first, CAP) + Math.min(second, CAP));
      expect(preview.totals.creditCents).toBeLessThanOrEqual(preview.totals.applicableCapCents);
      expect(preview.flags.oneSpouseOnly).toBe(first > 0 !== second > 0);
    }
  });

  it("accepts explicit roles and labels, and rejects roles that do not fit the return", () => {
    const preview = joint([
      { role: "spouse_2", label: "  Dana  ", designatedCents: usd(100) },
      { role: "spouse_1", label: "Robin", designatedCents: usd(200) },
    ]);
    expect(preview.taxpayers.map((taxpayer) => [taxpayer.role, taxpayer.label, taxpayer.headingCopyId])).toEqual([
      ["spouse_2", "Dana", "panel.heading.spouse_2"],
      ["spouse_1", "Robin", "panel.heading.spouse_1"],
    ]);

    expectValidationError(() => joint([{ role: "individual", designatedCents: 1 }]), "taxpayers.0.role");
    expectValidationError(() => joint([{ role: "spouse_1", designatedCents: 1 }, { role: "spouse_1", designatedCents: 1 }]), "taxpayers.1.role");
    expectValidationError(() => joint([{ designatedCents: 1 }, { designatedCents: 1 }, { designatedCents: 1 }]), "taxpayers");
    expectValidationError(() => joint([]), "taxpayers");
  });

  it.each(["single", "married_separate", "head_of_household", "qualifying_surviving_spouse"] as const)(
    "%s: one taxpayer, one cap, and no second taxpayer allowed",
    (filingStatus) => {
      const preview = previewCredit({ filingStatus, asOf: JANUARY_2027, taxpayers: [{ designatedCents: usd(5000) }] });
      expect(preview.taxpayers[0].role).toBe("individual");
      expect(preview.totals.creditCents).toBe(usd(1700));
      expect(preview.totalLines).toEqual([]);
      expect(preview.flags.jointReturn).toBe(false);
      expect(preview.noteIds).not.toContain("note.joint_each_spouse");
      expectValidationError(() => previewCredit({ filingStatus, asOf: JANUARY_2027, taxpayers: [{ designatedCents: 1 }, { designatedCents: 1 }] }), "taxpayers");
      expectValidationError(() => previewCredit({ filingStatus, asOf: JANUARY_2027, taxpayers: [{ role: "spouse_1", designatedCents: 1 }] }), "taxpayers.0.role");
    },
  );
});

describe("applyLiabilityLimit", () => {
  it("limits the credit to the donor's estimate after the listed other credits", () => {
    const result = applyLiabilityLimit({ taxYear: 2027, currentYearCreditCents: usd(1700), estimatedTaxCents: usd(2000), otherCreditsCents: usd(800) });
    expect(result.limitCents).toBe(usd(1200));
    expect(result.currentYearCreditUsedCents).toBe(usd(1200));
    expect(result.newCarryforwardCents).toBe(usd(500));
    expect(result.carriedToNextYear).toEqual([{ originYear: 2027, amountCents: usd(500) }]);
    expect(result.limitedByLiability).toBe(true);
  });

  it("floors the limit at zero when the other credits exceed the tax", () => {
    const result = applyLiabilityLimit({ taxYear: 2027, currentYearCreditCents: usd(1700), estimatedTaxCents: usd(500), otherCreditsCents: usd(900) });
    expect(result.limitCents).toBe(0);
    expect(result.totalCreditUsedCents).toBe(0);
    expect(result.newCarryforwardCents).toBe(usd(1700));
  });

  it("uses the whole credit when the limit is high enough, and carries nothing", () => {
    const result = applyLiabilityLimit({ taxYear: 2027, currentYearCreditCents: usd(1700), estimatedTaxCents: usd(9000) });
    expect(result.totalCreditUsedCents).toBe(usd(1700));
    expect(result.newCarryforwardCents).toBe(0);
    expect(result.carriedToNextYear).toEqual([]);
    expect(result.limitedByLiability).toBe(false);
  });

  it("uses buckets oldest first whatever order they are given in, then this year's credit", () => {
    const result = applyLiabilityLimit({
      taxYear: 2031,
      currentYearCreditCents: usd(1700),
      estimatedTaxCents: usd(2500),
      carryforwards: [
        { originYear: 2030, amountCents: usd(1000) },
        { originYear: 2028, amountCents: usd(900) },
        { originYear: 2029, amountCents: usd(800) },
      ],
    });
    expect(result.buckets.map((bucket) => [bucket.originYear, bucket.usedCents])).toEqual([
      [2028, usd(900)],
      [2029, usd(800)],
      [2030, usd(800)],
    ]);
    expect(result.currentYearCreditUsedCents).toBe(0);
    expect(result.carriedToNextYear).toEqual([
      { originYear: 2030, amountCents: usd(200) },
      { originYear: 2031, amountCents: usd(1700) },
    ]);
  });

  it("five-year life: usable through origin year + 5, expired in origin year + 6", () => {
    expect(carryforwardWindow(2027)).toEqual({ firstUsableTaxYear: 2028, lastUsableTaxYear: 2032 });

    const lastYear = applyLiabilityLimit({ taxYear: 2032, currentYearCreditCents: 0, estimatedTaxCents: usd(40), carryforwards: [{ originYear: 2027, amountCents: usd(100) }] });
    expect(lastYear.buckets[0]).toMatchObject({ expired: false, lastUsableTaxYear: 2032, usedCents: usd(40), unusedCents: usd(60), carriedToNextYearCents: 0, expiresUnusedCents: usd(60) });
    expect(lastYear.expiringUnusedCents).toBe(usd(60));
    expect(lastYear.carriedToNextYear).toEqual([]);

    const tooLate = applyLiabilityLimit({ taxYear: 2033, currentYearCreditCents: 0, estimatedTaxCents: usd(5000), carryforwards: [{ originYear: 2027, amountCents: usd(100) }] });
    expect(tooLate.buckets[0]).toMatchObject({ expired: true, usedCents: 0, unusedCents: 0, carriedToNextYearCents: 0 });
    expect(tooLate.expiredCarryforwardCents).toBe(usd(100));
    expect(tooLate.availableCarryforwardCents).toBe(0);
    expect(tooLate.totalCreditUsedCents).toBe(0);
  });

  it("can use more than the cap in one year when it is carryforward (F34), but never creates a bucket above the cap", () => {
    const result = applyLiabilityLimit({
      taxYear: 2030,
      currentYearCreditCents: usd(1700),
      estimatedTaxCents: usd(10_000),
      carryforwards: [
        { originYear: 2028, amountCents: usd(1700) },
        { originYear: 2029, amountCents: usd(1700) },
      ],
    });
    expect(result.totalCreditUsedCents).toBe(usd(5100));
    expect(result.totalCreditUsedCents).toBeGreaterThan(CAP);
    expect(result.newCarryforwardCents).toBe(0);
  });

  it("conserves every cent and keeps each new bucket within the cap, over generated years", () => {
    const random = prng(26);
    for (let i = 0; i < 3000; i++) {
      const taxYear = 2027 + Math.floor(random() * 12);
      const joint = random() < 0.4;
      const currentYearCreditCents = Math.floor(random() * ((joint ? 2 : 1) * CAP + 1));
      const carryforwards: CarryforwardBucketInput[] = [];
      for (let originYear = taxYear - 8; originYear < taxYear; originYear++) {
        if (random() < 0.5) carryforwards.push({ originYear, amountCents: Math.floor(random() * (2 * CAP + 1)) });
      }
      const result = applyLiabilityLimit({
        taxYear,
        currentYearCreditCents,
        estimatedTaxCents: Math.floor(random() * 1_500_000),
        otherCreditsCents: random() < 0.5 ? 0 : Math.floor(random() * 500_000),
        carryforwards,
      });
      expect(result.totalCreditUsedCents).toBeLessThanOrEqual(result.limitCents);
      expect(result.newCarryforwardCents).toBeLessThanOrEqual(currentYearCreditCents);
      expect(result.newCarryforwardCents).toBeLessThanOrEqual((joint ? 2 : 1) * CAP);
      expect(result.availableCarryforwardCents + result.currentYearCreditCents).toBe(
        result.totalCreditUsedCents + result.totalCarriedToNextYearCents + result.expiringUnusedCents,
      );
      // This year's credit is touched only after every usable bucket is exhausted.
      if (result.currentYearCreditUsedCents > 0) expect(result.carryforwardUsedCents).toBe(result.availableCarryforwardCents);
      // First in, first out: a bucket is used only when every older usable bucket is fully used.
      const usable = result.buckets.filter((bucket) => !bucket.expired);
      usable.forEach((bucket, index) => {
        if (bucket.usedCents > 0) usable.slice(0, index).forEach((older) => expect(older.usedCents).toBe(older.amountCents));
      });
      for (const bucket of result.carriedToNextYear) expect(bucket.originYear + 5).toBeGreaterThanOrEqual(taxYear + 1);
    }
  });

  it("rejects impossible carryforwards", () => {
    const base = { taxYear: 2030, currentYearCreditCents: 0, estimatedTaxCents: 0 };
    expectValidationError(() => applyLiabilityLimit({ ...base, carryforwards: [{ originYear: 2030, amountCents: 1 }] }), "carryforwards");
    expectValidationError(() => applyLiabilityLimit({ ...base, carryforwards: [{ originYear: 2031, amountCents: 1 }] }), "carryforwards");
    expectValidationError(
      () =>
        applyLiabilityLimit({
          ...base,
          carryforwards: [
            { originYear: 2028, amountCents: 1 },
            { originYear: 2028, amountCents: 2 },
          ],
        }),
      "carryforwards",
    );
    expectValidationError(() => applyLiabilityLimit({ ...base, carryforwards: [{ originYear: 2028, amountCents: 2 * CAP + 1 }] }), "carryforwards");
    expectValidationError(() => applyLiabilityLimit({ ...base, carryforwards: [{ originYear: 2028, amountCents: -1 }] }), "carryforwards.0.amountCents");
    expectValidationError(() => applyLiabilityLimit({ ...base, carryforwards: [{ originYear: 2028.5, amountCents: 1 }] }), "carryforwards.0.originYear");
    expectValidationError(() => applyLiabilityLimit({ ...base, currentYearCreditCents: 2 * CAP + 1 }), "currentYearCreditCents");
    expectValidationError(() => applyLiabilityLimit({ ...base, estimatedTaxCents: Number.NaN }), "estimatedTaxCents");
    expectValidationError(() => applyLiabilityLimit({ ...base, estimatedTaxCents: -1 }), "estimatedTaxCents");
    expectValidationError(() => applyLiabilityLimit({ ...base, otherCreditsCents: 0.5 }), "otherCreditsCents");
    expectValidationError(() => applyLiabilityLimit({ ...base, taxYear: 27 }), "taxYear");
  });
});

describe("previewCredit: the panel's data", () => {
  const single = (overrides: Partial<CreditPreviewInput> = {}) =>
    previewCredit({ filingStatus: "single", asOf: JANUARY_2027, taxpayers: [{ designatedCents: usd(1700) }], ...overrides });

  it("never invents a tax liability: no liability section unless the donor supplies an estimate", () => {
    const preview = single();
    expect(preview.liability).toBeNull();
    expect(preview.flags.liabilityProvided).toBe(false);
    expect(preview.noteIds).toContain("note.liability_not_estimated");
    expect(preview.noteIds).not.toContain("note.liability_estimate_basis");
    expect(JSON.stringify(preview)).not.toMatch(/estimatedTaxCents/);

    const withEstimate = single({ taxYear: 2027, liability: { estimatedTaxCents: usd(1000) } });
    expect(withEstimate.liability?.estimatedTaxCents).toBe(usd(1000));
    expect(withEstimate.noteIds).toContain("note.liability_estimate_basis");
    expect(withEstimate.noteIds).not.toContain("note.liability_not_estimated");
    expect(withEstimate.flags.creditLimitedByLiability).toBe(true);
    expect(withEstimate.liability?.lines.map((line) => line.id)).toEqual(["liability_limit", "current_year_credit_used", "total_credit_used", "new_carryforward", "carried_to_next_year"]);
  });

  it("requires the tax year with a liability estimate", () => {
    expectValidationError(() => single({ liability: { estimatedTaxCents: usd(1000) } }), "taxYear");
    expectValidationError(() => single({ taxYear: 2027, liability: { estimatedTaxCents: -1 } }), "liability.estimatedTaxCents");
    expectValidationError(() => single({ taxYear: 2027, liability: { estimatedTaxCents: 0, carryforwards: [{ originYear: 2027, amountCents: 1 }] } }), "liability.carryforwards");
  });

  it("separates the amount for which no credit is allowed from credit that is merely unused", () => {
    const preview = single({ taxpayers: [{ designatedCents: usd(2000) }], taxYear: 2027, liability: { estimatedTaxCents: usd(1000) } });
    // No credit allowed (over the cap): "may be deductible ... if".
    expect(preview.totals.noCreditAllowedCents).toBe(usd(300));
    // Allowed but unused: carried forward, and treated as allowed, so not deductible.
    expect(preview.liability?.newCarryforwardCents).toBe(usd(700));
    expect(preview.noteIds).toEqual(expect.arrayContaining(["note.excess_may_be_deductible", "note.carried_forward_not_deductible"]));
  });

  it("always carries the fixed caveats, in a stable order", () => {
    expect(single().noteIds).toEqual([
      "note.preview_not_tax_advice",
      "note.proposed_rules_not_final",
      "note.cap_per_taxpayer",
      "note.cap_is_annual_total",
      "note.state_credit_reduction",
      "note.nonrefundable",
      "note.liability_limit",
      "note.carryforward",
      "note.liability_not_estimated",
      "note.section_170_no_double_benefit",
      "note.carried_forward_not_deductible",
      "note.excess_may_be_deductible",
      "note.what_to_keep",
      "note.claim_form",
      "note.claim_form_availability",
    ]);
  });

  it("adds each conditional caveat exactly when its condition holds", () => {
    const everything = previewCredit({
      filingStatus: "married_joint",
      asOf: new Date("2026-12-01T12:00:00Z"),
      taxYear: 2033,
      donorServiceFeeCents: usd(17),
      taxpayers: [
        { designatedCents: usd(2500), nonDesignatedCents: usd(100), goodsOrServicesValueCents: usd(50), expectedStateCreditCents: usd(600) },
        { designatedCents: 0 },
      ],
      liability: {
        estimatedTaxCents: usd(300),
        carryforwards: [
          { originYear: 2026, amountCents: usd(10) },
          { originYear: 2028, amountCents: usd(500) },
        ],
      },
    });
    expect(everything.noteIds).toEqual([
      "note.before_credit_start",
      "note.preview_not_tax_advice",
      "note.proposed_rules_not_final",
      "note.cap_per_taxpayer",
      "note.cap_is_annual_total",
      "note.joint_each_spouse",
      "note.one_spouse_only",
      "note.over_cap_designation",
      "note.goods_or_services",
      "note.state_credit_reduction",
      "note.state_credit_ordering",
      "note.state_credit_assumed_whole_gift",
      "note.state_credit_spillover_estimate",
      "note.state_credit_offset_not_deductible_here",
      "note.nonrefundable",
      "note.liability_limit",
      "note.carryforward",
      "note.liability_estimate_basis",
      "note.joint_combined_limit",
      "note.carryforward_before_current",
      "note.joint_carryforward_pool",
      "note.carryforward_expired",
      "note.carryforward_expiring",
      "note.section_170_no_double_benefit",
      "note.carried_forward_not_deductible",
      "note.excess_may_be_deductible",
      "note.fee_not_part_of_contribution",
      "note.what_to_keep",
      "note.claim_form",
      "note.claim_form_availability",
    ]);
    expect(new Set(everything.noteIds).size).toBe(everything.noteIds.length);
    expect(everything.notes.map((note) => note.id)).toEqual(everything.noteIds);
    expect(everything.flags).toEqual({
      jointReturn: true,
      oneSpouseOnly: true,
      overCapDesignation: true,
      stateCreditEntered: true,
      stateCreditReducesFederal: false,
      stateCreditSpilloverEstimated: true,
      goodsOrServicesReduceContribution: true,
      otherContributionsEntered: false,
      beforeCreditStart: true,
      nearYearEnd: false,
      liabilityProvided: true,
      creditLimitedByLiability: true,
      carryforwardExpired: true,
      donorServiceFee: true,
      proposedRulesAffectNumbers: true,
    });
    expect(everything.totals.donorServiceFeeCents).toBe(usd(17));
    // The fee never enters the credit.
    expect(everything.totals.creditCents).toBe(usd(1700));
  });

  it("flags a gift before the credit start as an illustration, using the conservative start instant", () => {
    const justBefore = single({ asOf: new Date("2027-01-01T09:59:59.999Z") });
    expect(justBefore.flags.beforeCreditStart).toBe(true);
    expect(justBefore.status).toBe("illustration_before_credit_start");
    expect(justBefore.noteIds[0]).toBe("note.before_credit_start");
    expect(justBefore.notes[0].vars).toEqual({ creditStartDate: "January 1, 2027" });

    const atStart = single({ asOf: new Date("2027-01-01T10:00:00Z") });
    expect(atStart.flags.beforeCreditStart).toBe(false);
    expect(atStart.status).toBe("preview");
    expect(atStart.noteIds).not.toContain("note.before_credit_start");

    // A start date moved for a demo (the setting is movable outside production).
    const demo = single({ asOf: new Date("2026-11-18T12:00:00Z"), creditStartDate: "2026-11-01" });
    expect(demo.flags.beforeCreditStart).toBe(false);
    const explicitNull = single({ asOf: new Date("2026-11-18T12:00:00Z"), creditStartDate: null });
    expect(explicitNull.flags.beforeCreditStart).toBe(true);
  });

  it("adds the year-end timing notice in the last days of December, until the year has ended in every State", () => {
    const at = (iso: string) => single({ asOf: new Date(iso) });
    // December 15 begins in Hawaii at 10:00 UTC.
    expect(at("2027-12-15T09:59:59Z").flags.nearYearEnd).toBe(false);
    expect(at("2027-12-15T10:00:00Z").flags.nearYearEnd).toBe(true);
    expect(at("2027-12-31T23:00:00Z").flags.nearYearEnd).toBe(true);
    // Already January 1 on the mainland, still December 31 in Hawaii.
    expect(at("2028-01-01T09:59:59Z").flags.nearYearEnd).toBe(true);
    expect(at("2028-01-01T10:00:00Z").flags.nearYearEnd).toBe(false);
    expect(at("2027-06-15T18:00:00Z").flags.nearYearEnd).toBe(false);

    const december = at("2027-12-20T18:00:00Z");
    expect(december.noteIds.slice(0, 3)).toEqual(["note.preview_not_tax_advice", "note.proposed_rules_not_final", "note.year_end_timing"]);
    expect(single().noteIds).not.toContain("note.year_end_timing");
    // Before the credit exists the tax year of a gift does not matter yet.
    const december2026 = at("2026-12-20T18:00:00Z");
    expect(december2026.flags).toMatchObject({ beforeCreditStart: true, nearYearEnd: false });
    expect(december2026.noteIds).not.toContain("note.year_end_timing");
  });

  it("shows the lines that reconcile designated amount to credit", () => {
    const preview = single({ taxpayers: [{ designatedCents: usd(2600), nonDesignatedCents: usd(200), goodsOrServicesValueCents: usd(100), expectedStateCreditCents: usd(500) }] });
    const lines = preview.taxpayers[0].lines;
    expect(lines.map((line) => [line.id, line.amountCents, line.role])).toEqual([
      ["designated", usd(2600), "amount"],
      ["goods_or_services", usd(100), "subtraction"],
      ["qualified_contribution", usd(2500), "subtotal"],
      ["state_credit_reduction", usd(300), "subtraction"],
      ["over_cap", usd(500), "subtraction"],
      ["estimated_credit", usd(1700), "result"],
      ["non_designated", usd(200), "information"],
      ["state_credit_absorbed", usd(200), "information"],
    ]);
    const subtractions = lines.filter((line) => line.role === "subtraction").reduce((sum, line) => sum + line.amountCents, 0);
    expect(usd(2600) - subtractions).toBe(usd(1700));
    for (const line of lines) expect(COPY[line.copyId].kind).toBe("label");
  });

  it("shows other qualified contributions, the year's total and what this gift adds", () => {
    const preview = single({ taxpayers: [{ designatedCents: usd(1000), otherQualifiedContributionsCents: usd(1200) }] });
    expect(preview.taxpayers[0].lines.map((line) => [line.id, line.amountCents, line.role])).toEqual([
      ["designated", usd(1000), "amount"],
      ["other_qualified_contributions", usd(1200), "addition"],
      ["qualified_contribution", usd(2200), "subtotal"],
      ["over_cap", usd(500), "subtraction"],
      ["estimated_credit", usd(1700), "result"],
      ["credit_added_by_this_gift", usd(500), "information"],
    ]);
    expect(preview.totals).toMatchObject({ otherQualifiedContributionsCents: usd(1200), qualifiedContributionCents: usd(2200), creditCents: usd(1700), creditAddedByThisGiftCents: usd(500), giftCents: usd(1000) });
    expect(preview.flags.otherContributionsEntered).toBe(true);
    expect(preview.flags.overCapDesignation).toBe(true);
    expect(preview.noteIds).toEqual(expect.arrayContaining(["note.cap_is_annual_total", "note.other_contributions_assumed_no_state_credit", "note.over_cap_designation"]));
    expect(preview.rulesApplied).toContain("creditBaseIsAnnualAggregate");

    // With the detailed State-credit list nothing is assumed about the other contributions.
    const detailed = single({ taxpayers: [{ designatedCents: usd(1000), otherQualifiedContributionsCents: usd(500), stateCredits: [{ amountCents: usd(100), nonQualifiedBaseCents: 0 }] }] });
    expect(detailed.noteIds).not.toContain("note.other_contributions_assumed_no_state_credit");
    expect(detailed.totals.creditCents).toBe(usd(1400));
    expect(single().noteIds).not.toContain("note.other_contributions_assumed_no_state_credit");
  });

  it("the goods-or-services line shows what was actually taken off, so the lines still add up when the value exceeds the gift", () => {
    const preview = single({ taxpayers: [{ designatedCents: usd(100), goodsOrServicesValueCents: usd(150), otherQualifiedContributionsCents: usd(40) }] });
    expect(preview.taxpayers[0].lines.map((line) => [line.id, line.amountCents])).toEqual([
      ["designated", usd(100)],
      ["goods_or_services", usd(100)],
      ["other_qualified_contributions", usd(40)],
      ["qualified_contribution", usd(40)],
      ["estimated_credit", usd(40)],
      ["credit_added_by_this_gift", 0],
    ]);
    expect(preview.taxpayers[0].goodsOrServicesExceedDesignated).toBe(true);
  });

  it("reconciles the lines of every generated preview: amount + additions - subtractions = credit", () => {
    const random = prng(1040);
    for (let i = 0; i < 1500; i++) {
      const preview = single({
        taxpayers: [
          {
            designatedCents: Math.floor(random() * 400_000),
            nonDesignatedCents: random() < 0.5 ? 0 : Math.floor(random() * 200_000),
            goodsOrServicesValueCents: random() < 0.7 ? 0 : Math.floor(random() * 50_000),
            otherQualifiedContributionsCents: random() < 0.6 ? 0 : Math.floor(random() * 250_000),
            expectedStateCreditCents: random() < 0.5 ? 0 : Math.floor(random() * 300_000),
          },
        ],
      });
      const [taxpayer] = preview.taxpayers;
      let running = 0;
      for (const line of taxpayer.lines) {
        if (line.role === "amount" || line.role === "addition") running += line.amountCents;
        if (line.role === "subtraction") running -= line.amountCents;
        if (line.role === "subtotal" || line.role === "result") expect(line.amountCents, `${line.id} of ${JSON.stringify(taxpayer.lines)}`).toBe(running);
        expect(line.amountCents).toBeGreaterThanOrEqual(0);
      }
      expect(taxpayer.lines.at(-1)?.role === "result" || taxpayer.lines.some((line) => line.role === "information")).toBe(true);
    }
  });

  it("includes the 'proposed regulations that are not final' note whenever a proposed rule affected the numbers", () => {
    const random = prng(117199);
    const proposedRuleIds = Object.entries(RULES)
      .filter(([, rule]) => rule.authority === "proposed_reg")
      .map(([id]) => id);
    let withProposedNumbers = 0;
    let withoutProposedNumbers = 0;
    for (let i = 0; i < 1500; i++) {
      const joint = random() < 0.4;
      const taxpayer = () => ({
        designatedCents: Math.floor(random() * 400_000),
        nonDesignatedCents: random() < 0.5 ? 0 : Math.floor(random() * 300_000),
        expectedStateCreditCents: random() < 0.5 ? 0 : Math.floor(random() * 200_000),
      });
      const preview = previewCredit({
        filingStatus: joint ? "married_joint" : "single",
        asOf: JANUARY_2027,
        taxYear: 2030,
        taxpayers: joint && random() < 0.7 ? [taxpayer(), taxpayer()] : [taxpayer()],
        liability: random() < 0.5 ? null : { estimatedTaxCents: Math.floor(random() * 500_000), carryforwards: random() < 0.5 ? [] : [{ originYear: 2028, amountCents: usd(300) }] },
      });
      const usedProposedRule = preview.rulesApplied.some((id) => proposedRuleIds.includes(id));
      expect(preview.flags.proposedRulesAffectNumbers).toBe(usedProposedRule);
      if (usedProposedRule) {
        withProposedNumbers++;
        expect(preview.noteIds).toContain("note.proposed_rules_not_final");
      } else {
        withoutProposedNumbers++;
      }
      // And whenever any proposed-regulation sentence or label is shown at all.
      const shown = [...preview.noteIds, ...preview.taxpayers.flatMap((t) => t.lines.map((l) => l.copyId)), ...preview.totalLines.map((l) => l.copyId), ...(preview.liability?.lines ?? []).map((l) => l.copyId)];
      if (shown.some((id) => id !== "note.proposed_rules_not_final" && COPY[id].authority === "proposed_reg")) {
        expect(preview.noteIds).toContain("note.proposed_rules_not_final");
      }
      expect(preview.noteIds.indexOf("note.proposed_rules_not_final")).toBe(preview.noteIds.indexOf("note.preview_not_tax_advice") + 1);
    }
    // Both kinds of case were exercised.
    expect(withProposedNumbers).toBeGreaterThan(100);
    expect(withoutProposedNumbers).toBeGreaterThan(100);
  });

  it("records which rules entered the computation, proposed-only ones included", () => {
    const plain = single();
    expect(plain.rulesApplied).toEqual(["designationRequiredAtTimeOfContribution", "creditCapPerTaxpayerCents"]);
    expect(plain.flags.proposedRulesAffectNumbers).toBe(false);

    const withStateCredit = single({ taxpayers: [{ designatedCents: usd(1700), nonDesignatedCents: usd(100), expectedStateCreditCents: usd(50) }] });
    expect(withStateCredit.rulesApplied).toEqual(
      expect.arrayContaining(["stateCreditReducesCredit", "stateCreditReductionBeforeCap", "stateCreditAbsorptionOrder"]),
    );
    expect(withStateCredit.flags.proposedRulesAffectNumbers).toBe(true);
    for (const id of withStateCredit.rulesApplied) expect(RULES[id]).toBeDefined();
  });

  it("is plain JSON, stamped with the module and copy versions", () => {
    const preview = single({ taxYear: 2027, liability: { estimatedTaxCents: usd(100), carryforwards: [] } });
    expect(JSON.parse(JSON.stringify(preview))).toEqual(preview);
    expect(preview.taxmathVersion).toBe(TAXMATH_VERSION);
    expect(preview.copyVersion).toBe(COPY_VERSION);
    expect(preview.taxYear).toBe(2027);
    expect(single().taxYear).toBeNull();
  });

  it.each([
    ["an invalid date", { asOf: new Date("not a date") }, "asOf"],
    ["a missing date", { asOf: undefined }, "asOf"],
    ["a date string", { asOf: "2027-01-15" }, "asOf"],
    ["an unknown filing status", { filingStatus: "married" }, "filingStatus"],
    ["an impossible start date", { creditStartDate: "2027-02-30" }, "creditStartDate"],
    ["a negative service fee", { donorServiceFeeCents: -1 }, "donorServiceFeeCents"],
    ["a NaN in a taxpayer", { taxpayers: [{ designatedCents: Number.NaN }] }, "taxpayers.0.designatedCents"],
    ["an empty label", { taxpayers: [{ designatedCents: 1, label: "   " }] }, "taxpayers.0.label"],
    ["a two-digit tax year", { taxYear: 27 }, "taxYear"],
    ["an unknown field", { giftCents: 5 }, "_"],
  ])("rejects %s", (_label, overrides, field) => {
    expectValidationError(() => single(overrides as unknown as Partial<CreditPreviewInput>), field);
  });
});

describe("suggestDesignation (a pre-fill, not a rule)", () => {
  it("pre-fills the lesser of the gift and the cap for one taxpayer", () => {
    expect(suggestDesignation({ giftCents: usd(1000), filingStatus: "single" })).toEqual([
      { role: "individual", giftCents: usd(1000), designatedCents: usd(1000), nonDesignatedCents: 0 },
    ]);
    expect(suggestDesignation({ giftCents: usd(4000), filingStatus: "head_of_household" })).toEqual([
      { role: "individual", giftCents: usd(4000), designatedCents: usd(1700), nonDesignatedCents: usd(2300) },
    ]);
  });

  it("splits a joint gift evenly and gives the odd cent to the first spouse", () => {
    expect(suggestDesignation({ giftCents: usd(3400), filingStatus: "married_joint" })).toEqual([
      { role: "spouse_1", giftCents: usd(1700), designatedCents: usd(1700), nonDesignatedCents: 0 },
      { role: "spouse_2", giftCents: usd(1700), designatedCents: usd(1700), nonDesignatedCents: 0 },
    ]);
    const odd = suggestDesignation({ giftCents: 100_001, filingStatus: "married_joint" });
    expect(odd.map((share) => share.giftCents)).toEqual([50_001, 50_000]);
    expect(odd[0].giftCents + odd[1].giftCents).toBe(100_001);
  });

  it("gives one spouse the whole gift, and one cap, when only one spouse contributes", () => {
    expect(suggestDesignation({ giftCents: usd(3400), filingStatus: "married_joint", bothSpousesContribute: false })).toEqual([
      { role: "spouse_1", giftCents: usd(3400), designatedCents: usd(1700), nonDesignatedCents: usd(1700) },
    ]);
  });

  it("pre-fills only what is left of the cap when the taxpayer has already made qualified contributions this year", () => {
    expect(suggestDesignation({ giftCents: usd(2000), filingStatus: "single", otherQualifiedContributionsCents: [usd(1200)] })).toEqual([
      { role: "individual", giftCents: usd(2000), designatedCents: usd(500), nonDesignatedCents: usd(1500) },
    ]);
    expect(suggestDesignation({ giftCents: usd(2000), filingStatus: "single", otherQualifiedContributionsCents: [usd(5000)] })[0].designatedCents).toBe(0);
    expect(suggestDesignation({ giftCents: usd(3400), filingStatus: "married_joint", otherQualifiedContributionsCents: [0, usd(1700)] })).toEqual([
      { role: "spouse_1", giftCents: usd(1700), designatedCents: usd(1700), nonDesignatedCents: 0 },
      { role: "spouse_2", giftCents: usd(1700), designatedCents: 0, nonDesignatedCents: usd(1700) },
    ]);
    expectValidationError(() => suggestDesignation({ giftCents: 1, filingStatus: "single", otherQualifiedContributionsCents: [0, 0, 0] }), "otherQualifiedContributionsCents");
    expectValidationError(() => suggestDesignation({ giftCents: 1, filingStatus: "single", otherQualifiedContributionsCents: [-1] }), "otherQualifiedContributionsCents.0");
  });

  it("feeds straight into previewCredit and conserves the gift", () => {
    const random = prng(8525);
    for (let i = 0; i < 500; i++) {
      const giftCents = Math.floor(random() * 900_000);
      const shares = suggestDesignation({ giftCents, filingStatus: "married_joint" });
      expect(shares.reduce((sum, share) => sum + share.designatedCents + share.nonDesignatedCents, 0)).toBe(giftCents);
      const preview = previewCredit({
        filingStatus: "married_joint",
        asOf: JANUARY_2027,
        taxpayers: shares.map((share) => ({ role: share.role, designatedCents: share.designatedCents, nonDesignatedCents: share.nonDesignatedCents })),
      });
      expect(preview.totals.overCapCents).toBe(0);
      expect(preview.totals.creditCents).toBe(Math.min(giftCents, shares.reduce((sum, share) => sum + share.designatedCents, 0)));
    }
    expectValidationError(() => suggestDesignation({ giftCents: -1, filingStatus: "single" }), "giftCents");
  });
});
