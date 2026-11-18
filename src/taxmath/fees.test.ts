/**
 * Fee structures. The invariants at the bottom are the money rules in docs/architecture.md: the designated
 * amount and any platform fee are always separate lines, and a fee is never part of the qualified
 * contribution. All amounts are synthetic.
 */
import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import { AppError } from "@/lib/errors";
import { DEFAULT_FEE_STRUCTURE, FEE_STRUCTURES_REQUIRING_COUNSEL_MEMO, TAXMATH_VERSION } from "./constants";
import { COPY, COPY_VERSION, renderCopy } from "./copy";
import {
  FEE_STRUCTURES,
  FEE_STRUCTURE_FACTS,
  assertFeeStructureAllowed,
  computeGiftLines,
  describeFeeStructure,
  isFeeStructure,
  type FeeStructure,
  type GiftLinesInput,
} from "./fees";

const usd = (dollars: number) => dollars * 100;

function lines(overrides: Partial<GiftLinesInput> = {}) {
  return computeGiftLines({ structure: "none", designatedCents: usd(1700), nonDesignatedCents: 0, sgoFeeBps: 0, donorServiceFeeBps: 0, ...overrides });
}

function expectValidationError(run: () => unknown, field?: string): AppError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe("validation_failed");
  if (field) expect(Object.keys(((thrown as AppError).details as { fields: Record<string, string> }).fields)).toContain(field);
  return thrown as AppError;
}

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

describe("computeGiftLines: the three structures, by example", () => {
  it("none: the donor pays the gift, the SGO receives it, the platform takes nothing even if rates are configured", () => {
    const result = lines({ structure: "none", designatedCents: usd(1700), nonDesignatedCents: usd(300), sgoFeeBps: 100, donorServiceFeeBps: 250 });
    expect(result).toEqual({
      structure: "none",
      lines: [
        { kind: "designated_contribution", label: "Section 25F qualified contribution (designated)", copyId: "fee.line.designated_contribution", amountCents: usd(1700) },
        { kind: "non_designated_gift", label: "Additional gift (not designated, not a qualified contribution)", copyId: "fee.line.non_designated_gift", amountCents: usd(300) },
      ],
      chargedToDonorCents: usd(2000),
      depositedTo25fAccountCents: usd(1700),
      sgoGeneralFundsCents: usd(300),
      sgoInvoicedFeeCents: 0,
      donorServiceFeeCents: 0,
      platformRevenueCents: 0,
      feeBaseCents: usd(2000),
      appliedFeeBps: 0,
      explanation: { copyId: "fee.none.donor", text: renderCopy("fee.none.donor", { platformName: BRAND.name }) },
      taxmathVersion: TAXMATH_VERSION,
      copyVersion: COPY_VERSION,
    });
  });

  it("sgo_invoiced: the donor pays only the gift; the SGO owes a separate invoice", () => {
    const result = lines({ structure: "sgo_invoiced", designatedCents: usd(1700), nonDesignatedCents: usd(300), sgoFeeBps: 100, donorServiceFeeBps: 250 });
    expect(result.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["designated_contribution", usd(1700)],
      ["non_designated_gift", usd(300)],
    ]);
    expect(result.chargedToDonorCents).toBe(usd(2000));
    expect(result.depositedTo25fAccountCents).toBe(usd(1700));
    expect(result.sgoGeneralFundsCents).toBe(usd(300));
    expect(result.sgoInvoicedFeeCents).toBe(usd(20)); // 1 percent of the $2,000 gift
    expect(result.donorServiceFeeCents).toBe(0);
    expect(result.platformRevenueCents).toBe(usd(20));
    expect(result.appliedFeeBps).toBe(100);
    expect(result.explanation.copyId).toBe("fee.sgo_invoiced.donor");
    expect(result.explanation.text).toContain("not from your contribution");
  });

  it("donor_service_fee: the fee is its own line on top, and none of it is deposited or designated", () => {
    const result = lines({ structure: "donor_service_fee", designatedCents: usd(1700), nonDesignatedCents: usd(300), sgoFeeBps: 100, donorServiceFeeBps: 250 });
    expect(result.lines).toEqual([
      { kind: "designated_contribution", label: COPY["fee.line.designated_contribution"].text, copyId: "fee.line.designated_contribution", amountCents: usd(1700) },
      { kind: "non_designated_gift", label: COPY["fee.line.non_designated_gift"].text, copyId: "fee.line.non_designated_gift", amountCents: usd(300) },
      { kind: "donor_service_fee", label: "Service fee (separate charge, not part of your contribution)", copyId: "fee.line.donor_service_fee", amountCents: usd(50) },
    ]);
    expect(result.chargedToDonorCents).toBe(usd(2050));
    expect(result.depositedTo25fAccountCents).toBe(usd(1700));
    expect(result.sgoGeneralFundsCents).toBe(usd(300));
    expect(result.sgoInvoicedFeeCents).toBe(0);
    expect(result.donorServiceFeeCents).toBe(usd(50));
    expect(result.platformRevenueCents).toBe(usd(50));
    expect(result.appliedFeeBps).toBe(250);
    expect(result.explanation.text).toContain("not part of your contribution");
    expect(result.explanation.text).toContain("not covered by the federal credit");
  });

  it("rounds a percentage fee half up to the cent", () => {
    // 1 percent of $0.50 is half a cent, which rounds up; 1 percent of $0.49 rounds down.
    expect(lines({ structure: "donor_service_fee", designatedCents: 50, donorServiceFeeBps: 100 }).donorServiceFeeCents).toBe(1);
    expect(lines({ structure: "donor_service_fee", designatedCents: 49, donorServiceFeeBps: 100 }).donorServiceFeeCents).toBe(0);
    expect(lines({ structure: "sgo_invoiced", designatedCents: 12_345, sgoFeeBps: 175 }).sgoInvoicedFeeCents).toBe(216); // 216.0375
    expect(lines({ structure: "sgo_invoiced", designatedCents: 170_000, sgoFeeBps: 1 }).sgoInvoicedFeeCents).toBe(17);
  });

  it("omits zero lines: no fee line at a zero rate, no designated line for an undesignated gift", () => {
    const zeroRate = lines({ structure: "donor_service_fee", donorServiceFeeBps: 0 });
    expect(zeroRate.lines.map((line) => line.kind)).toEqual(["designated_contribution"]);
    expect(zeroRate.chargedToDonorCents).toBe(usd(1700));

    const undesignated = lines({ structure: "donor_service_fee", designatedCents: 0, nonDesignatedCents: usd(100), donorServiceFeeBps: 300 });
    expect(undesignated.lines.map((line) => line.kind)).toEqual(["non_designated_gift", "donor_service_fee"]);
    expect(undesignated.depositedTo25fAccountCents).toBe(0);
    expect(undesignated.sgoGeneralFundsCents).toBe(usd(100));
  });

  it("names the platform in the explanation, defaulting to the product name", () => {
    expect(lines().explanation.text).toContain(BRAND.name);
    const custom = lines({ structure: "sgo_invoiced", platformName: "Synthetic Platform Co" });
    expect(custom.explanation.text).toContain("Synthetic Platform Co");
    expect(custom.explanation.text).not.toContain(BRAND.name);
  });

  it("stays exact for very large gifts", () => {
    const big = 9_000_000_000_000_00; // $9 trillion, synthetic
    const result = lines({ structure: "donor_service_fee", designatedCents: big, donorServiceFeeBps: 333 });
    expect(result.donorServiceFeeCents).toBe(29_970_000_000_000);
    expect(result.chargedToDonorCents).toBe(big + 29_970_000_000_000);
    expect(result.depositedTo25fAccountCents).toBe(big);
  });

  it.each([
    ["a zero gift", { designatedCents: 0, nonDesignatedCents: 0 }, "designatedCents"],
    ["a negative designated amount", { designatedCents: -1 }, "designatedCents"],
    ["a fractional designated amount", { designatedCents: 100.25 }, "designatedCents"],
    ["a NaN designated amount", { designatedCents: Number.NaN }, "designatedCents"],
    ["an infinite designated amount", { designatedCents: Number.POSITIVE_INFINITY }, "designatedCents"],
    ["an unsafe designated amount", { designatedCents: Number.MAX_SAFE_INTEGER + 1 }, "designatedCents"],
    ["a negative non-designated amount", { nonDesignatedCents: -1 }, "nonDesignatedCents"],
    ["a missing non-designated amount", { nonDesignatedCents: undefined }, "nonDesignatedCents"],
    ["a negative SGO rate", { sgoFeeBps: -1 }, "sgoFeeBps"],
    ["an SGO rate over 100 percent", { sgoFeeBps: 10_001 }, "sgoFeeBps"],
    ["a fractional donor rate", { donorServiceFeeBps: 1.5 }, "donorServiceFeeBps"],
    ["a NaN donor rate", { donorServiceFeeBps: Number.NaN }, "donorServiceFeeBps"],
    ["a missing donor rate", { donorServiceFeeBps: undefined }, "donorServiceFeeBps"],
    ["an unknown structure", { structure: "netted_from_gift" }, "structure"],
    ["an unknown field", { feeCents: 500 }, "_"],
    ["an empty platform name", { platformName: " " }, "platformName"],
  ])("rejects %s", (_label, overrides, field) => {
    expectValidationError(() => lines(overrides as unknown as Partial<GiftLinesInput>), field);
  });

  it("rejects a total that cannot be represented exactly", () => {
    expectValidationError(() => lines({ designatedCents: Number.MAX_SAFE_INTEGER, nonDesignatedCents: 1 }), "designatedCents");
    expectValidationError(() => lines({ structure: "donor_service_fee", designatedCents: Number.MAX_SAFE_INTEGER, donorServiceFeeBps: 10_000 }), "designatedCents");
  });
});

describe("invariants, for every structure", () => {
  const table: Array<{ designatedCents: number; nonDesignatedCents: number; sgoFeeBps: number; donorServiceFeeBps: number }> = [
    { designatedCents: 1, nonDesignatedCents: 0, sgoFeeBps: 0, donorServiceFeeBps: 0 },
    { designatedCents: 1, nonDesignatedCents: 0, sgoFeeBps: 10_000, donorServiceFeeBps: 10_000 },
    { designatedCents: 170_000, nonDesignatedCents: 0, sgoFeeBps: 100, donorServiceFeeBps: 100 },
    { designatedCents: 170_000, nonDesignatedCents: 230_000, sgoFeeBps: 100, donorServiceFeeBps: 290 },
    { designatedCents: 340_000, nonDesignatedCents: 1, sgoFeeBps: 1, donorServiceFeeBps: 1 },
    { designatedCents: 0, nonDesignatedCents: 99, sgoFeeBps: 500, donorServiceFeeBps: 500 },
    { designatedCents: 199_999, nonDesignatedCents: 3, sgoFeeBps: 333, donorServiceFeeBps: 777 },
    { designatedCents: 50_000_000, nonDesignatedCents: 49_999_999, sgoFeeBps: 1000, donorServiceFeeBps: 1000 },
  ];

  function generated(count: number) {
    const random = prng(25);
    const cases = [...table];
    for (let i = 0; i < count; i++) {
      const designatedCents = random() < 0.05 ? 0 : Math.floor(random() * (random() < 0.8 ? 500_000 : 5_000_000_000));
      const nonDesignatedCents = random() < 0.5 ? 0 : Math.floor(random() * 1_000_000);
      if (designatedCents + nonDesignatedCents === 0) continue;
      cases.push({ designatedCents, nonDesignatedCents, sgoFeeBps: Math.floor(random() * 1001), donorServiceFeeBps: Math.floor(random() * 1001) });
    }
    return cases;
  }

  const cases = generated(4000);

  it.each(FEE_STRUCTURES)("%s: over the table and 4,000 generated gifts", (structure) => {
    expect(cases.length).toBeGreaterThan(3500);
    for (const gift of cases) {
      const result = computeGiftLines({ structure, ...gift });
      const where = `${structure} ${JSON.stringify(gift)}`;
      const designatedLines = result.lines.filter((line) => line.kind === "designated_contribution");
      const feeLines = result.lines.filter((line) => line.kind === "donor_service_fee");
      const sumOfLines = result.lines.reduce((sum, line) => sum + line.amountCents, 0);

      // 1. The designated amount is never reduced by any fee.
      expect(designatedLines.reduce((sum, line) => sum + line.amountCents, 0), where).toBe(gift.designatedCents);
      expect(designatedLines.length, where).toBe(gift.designatedCents > 0 ? 1 : 0);

      // 2. Every designated cent, and nothing else, is deposited to the 25F account.
      expect(result.depositedTo25fAccountCents, where).toBe(gift.designatedCents);
      expect(result.sgoGeneralFundsCents, where).toBe(gift.nonDesignatedCents);

      // 3. The donor is charged exactly the lines shown.
      expect(result.chargedToDonorCents, where).toBe(sumOfLines);
      expect(result.chargedToDonorCents, where).toBe(gift.designatedCents + gift.nonDesignatedCents + result.donorServiceFeeCents);

      // 4. Every cent charged goes to the SGO or is the separately shown donor fee.
      expect(result.depositedTo25fAccountCents + result.sgoGeneralFundsCents + result.donorServiceFeeCents, where).toBe(result.chargedToDonorCents);
      expect(result.platformRevenueCents, where).toBe(result.sgoInvoicedFeeCents + result.donorServiceFeeCents);

      // 5. A donor-paid fee is always its own line and is never labeled part of the contribution.
      expect(feeLines.length, where).toBe(result.donorServiceFeeCents > 0 ? 1 : 0);
      for (const feeLine of feeLines) {
        expect(feeLine.amountCents, where).toBe(result.donorServiceFeeCents);
        expect(feeLine.label, where).toContain("not part of your contribution");
        expect(feeLine.label, where).not.toMatch(/qualified contribution|designated|section 25F|gift/i);
      }
      for (const line of result.lines) {
        expect(line.amountCents, where).toBeGreaterThan(0);
        expect(Number.isSafeInteger(line.amountCents), where).toBe(true);
        if (line.kind !== "donor_service_fee") expect(line.label, where).not.toMatch(/fee/i);
      }

      if (structure === "none") {
        // 6. With "none" every fee field is zero, whatever rates are configured.
        expect([result.sgoInvoicedFeeCents, result.donorServiceFeeCents, result.platformRevenueCents, result.appliedFeeBps], where).toEqual([0, 0, 0, 0]);
        expect(result.chargedToDonorCents, where).toBe(gift.designatedCents + gift.nonDesignatedCents);
      }
      if (structure === "sgo_invoiced") {
        expect(result.donorServiceFeeCents, where).toBe(0);
        expect(result.chargedToDonorCents, where).toBe(gift.designatedCents + gift.nonDesignatedCents);
        expect(result.platformRevenueCents, where).toBe(result.sgoInvoicedFeeCents);
        // Within half a cent of the exact percentage.
        expect(Math.abs(result.sgoInvoicedFeeCents * 10_000 - result.feeBaseCents * gift.sgoFeeBps), where).toBeLessThanOrEqual(5000);
      }
      if (structure === "donor_service_fee") {
        expect(result.sgoInvoicedFeeCents, where).toBe(0);
        expect(result.platformRevenueCents, where).toBe(result.donorServiceFeeCents);
        expect(Math.abs(result.donorServiceFeeCents * 10_000 - result.feeBaseCents * gift.donorServiceFeeBps), where).toBeLessThanOrEqual(5000);
      }
    }
  });

  it("the same gift is deposited identically under all three structures", () => {
    for (const gift of cases.slice(0, 500)) {
      const deposits = FEE_STRUCTURES.map((structure) => {
        const result = computeGiftLines({ structure, ...gift });
        return [result.depositedTo25fAccountCents, result.sgoGeneralFundsCents];
      });
      expect(deposits[1]).toEqual(deposits[0]);
      expect(deposits[2]).toEqual(deposits[0]);
    }
  });
});

describe("describeFeeStructure", () => {
  it("describes each structure in words from the registry, with its constraints as data", () => {
    const none = describeFeeStructure("none");
    expect(none).toMatchObject({
      structure: "none",
      isDefault: true,
      title: "No platform fee on gifts",
      feePaidBy: "no_one",
      feePaidFrom: "not_applicable",
      donorPaysMoreThanGift: false,
      designatedAmountReduced: false,
      requiresCounselMemo: false,
      counselMemoRequirement: null,
      copyIds: { title: "fee.none.title", donor: "fee.none.donor", sgo: "fee.none.sgo", counselMemo: null },
      copyVersion: COPY_VERSION,
    });
    expect(none.donorExplanation).toBe(renderCopy("fee.none.donor", { platformName: BRAND.name }));
    expect(none.sgoExplanation).toBe(renderCopy("fee.none.sgo"));

    const invoiced = describeFeeStructure("sgo_invoiced", { platformName: "Synthetic Platform Co" });
    expect(invoiced).toMatchObject({
      isDefault: false,
      feePaidBy: "sgo",
      feePaidFrom: "sgo_operating_funds_outside_25f_account",
      donorPaysMoreThanGift: false,
      designatedAmountReduced: false,
      requiresCounselMemo: true,
      counselMemoRequirement: renderCopy("fee.counsel_memo_required"),
    });
    expect(invoiced.sgoExplanation).toContain("Synthetic Platform Co invoices your organization separately");
    expect(invoiced.sgoExplanation).toContain("operating funds outside that account");

    const donorFee = describeFeeStructure("donor_service_fee");
    expect(donorFee).toMatchObject({
      feePaidBy: "donor",
      feePaidFrom: "separate_donor_charge_on_top_of_gift",
      donorPaysMoreThanGift: true,
      designatedAmountReduced: false,
      requiresCounselMemo: true,
    });
    expect(donorFee.donorExplanation).toContain("you pay it yourself");
  });

  it("no structure takes anything out of the designated amount, and only the default needs no memo", () => {
    expect(DEFAULT_FEE_STRUCTURE.value).toBe("none");
    for (const structure of FEE_STRUCTURES) {
      const description = describeFeeStructure(structure);
      expect(description.designatedAmountReduced).toBe(false);
      expect(description.requiresCounselMemo).toBe(structure !== "none");
      expect(description.requiresCounselMemo).toBe((FEE_STRUCTURES_REQUIRING_COUNSEL_MEMO.value as readonly string[]).includes(structure));
      expect(FEE_STRUCTURE_FACTS[structure].requiresCounselMemo).toBe(description.requiresCounselMemo);
      for (const text of [description.title, description.donorExplanation, description.sgoExplanation]) expect(text).not.toMatch(/[{}]/);
    }
    expect(Object.isFrozen(FEE_STRUCTURE_FACTS)).toBe(true);
    expect(Object.isFrozen(FEE_STRUCTURE_FACTS.sgo_invoiced)).toBe(true);
  });

  it("rejects an unknown structure", () => {
    expectValidationError(() => describeFeeStructure("percentage_of_gift" as FeeStructure));
    expect(isFeeStructure("donor_service_fee")).toBe(true);
    expect(isFeeStructure("percentage_of_gift")).toBe(false);
    expect(isFeeStructure(undefined)).toBe(false);
  });
});

describe("assertFeeStructureAllowed", () => {
  it("always allows no fee", () => {
    expect(() => assertFeeStructureAllowed({ structure: "none", counselMemoRef: null })).not.toThrow();
    expect(() => assertFeeStructureAllowed({ structure: "none", counselMemoRef: undefined })).not.toThrow();
    expect(() => assertFeeStructureAllowed({ structure: "none", counselMemoRef: "" })).not.toThrow();
  });

  it.each(["sgo_invoiced", "donor_service_fee"] as const)("%s requires a recorded counsel memo reference", (structure) => {
    for (const counselMemoRef of [null, undefined, "", "   ", "\n\t"]) {
      const error = expectValidationError(() => assertFeeStructureAllowed({ structure, counselMemoRef }), "counselMemoRef");
      expect(error.message).toBe(renderCopy("fee.counsel_memo_required"));
      expect(error.details).toMatchObject({ structure });
    }
    expectValidationError(() => assertFeeStructureAllowed({ structure, counselMemoRef: 42 as unknown as string }), "counselMemoRef");
    expect(() => assertFeeStructureAllowed({ structure, counselMemoRef: "SYNTHETIC-MEMO-0001" })).not.toThrow();
  });

  it("rejects an unknown structure and a missing argument rather than waving them through", () => {
    expectValidationError(() => assertFeeStructureAllowed({ structure: "free" as FeeStructure, counselMemoRef: "SYNTHETIC-MEMO-0001" }));
    expectValidationError(() => assertFeeStructureAllowed(undefined as unknown as { structure: FeeStructure; counselMemoRef: string }));
  });
});
