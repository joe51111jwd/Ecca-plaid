import { describe, expect, it } from "vitest";
import { reconcileIncomeEvidence } from "@/engine/income";
import { decimalToCents, isCalendarDate, isCountableSource, isReviewSource, payStubSources, reportToEvidence, summarizeCoverage } from "./normalize";
import type { NormalizedIncomeReport, NormalizedIncomeSource } from "./types";

// All figures and names are SYNTHETIC.

function source(over: Partial<NormalizedIncomeSource>): NormalizedIncomeSource {
  return {
    type: "w2",
    employerName: "Synthetic Employer",
    grossAnnualCents: 1_000_000,
    taxYear: 2025,
    confidence: "high",
    note: "synthetic",
    medicareWagesCents: null,
    payDate: null,
    payFrequency: null,
    ytdGrossCents: null,
    providerRef: null,
    ...over,
  };
}

function report(sources: NormalizedIncomeSource[], over: Partial<NormalizedIncomeReport> = {}): NormalizedIncomeReport {
  return {
    version: 1,
    provider: "simulated",
    kind: "payroll",
    sandbox: true,
    retrievedAt: "2026-11-18T15:00:00.000Z",
    incomeYear: 2025,
    person: { name: null },
    sources,
    coverage: summarizeCoverage(sources, 2025),
    dataBasis: "payroll_gross",
    recordsSeen: sources.length,
    warnings: [],
    providerResponseSha256: null,
    ...over,
  };
}

describe("decimalToCents", () => {
  it("parses strings exactly and numbers to the nearest cent", () => {
    expect(decimalToCents("45000.00")).toBe(4_500_000);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("-12.5")).toBe(-1250);
    expect(decimalToCents(" 7 ")).toBe(700);
    expect(decimalToCents(1234.56)).toBe(123_456);
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
  });
  it("rejects anything that is not an amount", () => {
    for (const bad of ["", "1,000", "1.234", "abc", "1e5", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) expect(decimalToCents(bad)).toBeNull();
  });
});

describe("countable vs review sources", () => {
  it("counts only W-2s and year-end pay stubs for the income year", () => {
    expect(isCountableSource({ type: "w2", taxYear: 2025 }, 2025)).toBe(true);
    expect(isCountableSource({ type: "final_paystub_ytd", taxYear: 2025 }, 2025)).toBe(true);
    expect(isCountableSource({ type: "w2", taxYear: 2024 }, 2025)).toBe(false);
    expect(isCountableSource({ type: "paystub_projection", taxYear: 2025 }, 2025)).toBe(false);
    expect(isCountableSource({ type: "bank_income_estimate", taxYear: 2025 }, 2025)).toBe(false);
    expect(isReviewSource({ type: "paystub_projection", taxYear: 2025 }, 2025)).toBe(true);
    expect(isReviewSource({ type: "bank_income_estimate", taxYear: 2024 }, 2025)).toBe(false);
  });
  it("summarizes coverage", () => {
    expect(summarizeCoverage([source({})], 2025)).toEqual({ incomeYearCovered: true, partialYear: false });
    expect(summarizeCoverage([source({ type: "paystub_projection" })], 2025)).toEqual({ incomeYearCovered: false, partialYear: true });
    expect(summarizeCoverage([], 2025)).toEqual({ incomeYearCovered: false, partialYear: false });
    expect(summarizeCoverage([], 2025, { partialHint: true })).toEqual({ incomeYearCovered: false, partialYear: true });
  });
});

describe("payStubSources", () => {
  it("keeps the latest stub per employer and classifies a year-closing stub as final", () => {
    const out = payStubSources(
      [
        { employerName: "Synthetic A", payDate: "2025-06-13", payFrequency: "biweekly", ytdGrossCents: 2_000_000, providerRef: "1" },
        { employerName: "Synthetic A", payDate: "2025-12-26", payFrequency: "biweekly", ytdGrossCents: 4_400_000, providerRef: "2" },
      ],
      2025,
      "high",
    );
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ type: "final_paystub_ytd", grossAnnualCents: 4_400_000, payDate: "2025-12-26", providerRef: "2" });
  });

  it("turns a mid-year stub into a projection that is never counted", () => {
    const out = payStubSources([{ employerName: "Synthetic A", payDate: "2025-06-13", payFrequency: "biweekly", ytdGrossCents: 1_650_000, providerRef: null }], 2025, "high");
    expect(out.sources[0]!.type).toBe("paystub_projection");
    expect(out.sources[0]!.confidence).toBe("low");
    expect(out.sources[0]!.grossAnnualCents).toBeGreaterThan(1_650_000);
    expect(isCountableSource(out.sources[0]!, 2025)).toBe(false);
  });

  it("without a frequency only a stub dated December 25 or later closes the year", () => {
    const early = payStubSources([{ employerName: "X", payDate: "2025-12-20", payFrequency: null, ytdGrossCents: 100, providerRef: null }], 2025, "high");
    const late = payStubSources([{ employerName: "X", payDate: "2025-12-26", payFrequency: null, ytdGrossCents: 100, providerRef: null }], 2025, "high");
    expect(early.sources[0]!.type).toBe("paystub_projection");
    expect(late.sources[0]!.type).toBe("final_paystub_ytd");
  });

  it("drops stubs from other years and stubs without a year-to-date figure, with warnings", () => {
    const out = payStubSources(
      [
        { employerName: "X", payDate: "2026-01-16", payFrequency: "biweekly", ytdGrossCents: 100, providerRef: null },
        { employerName: "Y", payDate: "2025-12-31", payFrequency: "monthly", ytdGrossCents: null, providerRef: null },
        { employerName: "Z", payDate: "not-a-date", payFrequency: "monthly", ytdGrossCents: 5, providerRef: null },
      ],
      2025,
      "high",
    );
    expect(out.sources).toEqual([]);
    expect(out.warnings.join(" ")).toMatch(/no year-to-date/);
    expect(out.warnings.join(" ")).toMatch(/2 pay stub\(s\) dated outside 2025/);
  });
});

describe("reportToEvidence", () => {
  const ids = { railConnectionId: "rail_1", memberId: "hm_1" };

  it("passes W-2s and final stubs for the income year to the engine with origin rail", () => {
    const { evidence, flags } = reportToEvidence(
      report([
        source({ medicareWagesCents: 1_100_000 }),
        source({ type: "final_paystub_ytd", payDate: "2025-12-26", payFrequency: "biweekly", grossAnnualCents: 1_100_000 }),
        source({ taxYear: 2024 }),
      ]),
      ids,
    );
    expect(flags).toEqual([]);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({ kind: "w2", origin: "rail", sourceId: "rail_1", memberId: "hm_1", wagesCents: 1_000_000, medicareWagesCents: 1_100_000 });
    expect(evidence[1]).toMatchObject({ kind: "pay_stub", origin: "rail", markedFinal: true, grossYtdCents: 1_100_000 });

    // The engine never adds the W-2 and the pay stub for the same job together.
    const reconciled = reconcileIncomeEvidence({ incomeYear: 2025, evidence });
    expect(reconciled.items).toHaveLength(1);
    expect(reconciled.items[0]).toMatchObject({ category: "wages_salary", annualAmountCents: 1_000_000, source: "rail", railConnectionId: "rail_1" });
  });

  it("turns projections and bank deposits into blocking review flags, never evidence", () => {
    const { evidence, flags } = reportToEvidence(
      report([
        source({ type: "paystub_projection", payDate: "2025-06-13", ytdGrossCents: 1_650_000, grossAnnualCents: 3_600_000 }),
        source({ type: "bank_income_estimate", grossAnnualCents: 3_000_000 }),
      ]),
      ids,
    );
    expect(evidence).toEqual([]);
    expect(flags.map((f) => [f.code, f.severity])).toEqual([
      ["pay_stub_projection_only", "blocking"],
      ["rail_bank_net_deposits", "blocking"],
    ]);
    expect(flags.every((f) => f.sourceIds[0] === "rail_1" && f.memberIds[0] === "hm_1")).toBe(true);
  });

  it("never treats a stub with an impossible date as closing the year", () => {
    expect(isCalendarDate("2025-12-26")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    for (const bad of ["2025-13-01", "2025-12-32", "2025-02-29", "2025-00-10", "2025-12-26T00:00:00Z", "0050-01-01"]) expect(isCalendarDate(bad)).toBe(false);
    const out = payStubSources(
      [
        { employerName: "Synthetic Employer", payDate: "2025-06-13", payFrequency: "biweekly", ytdGrossCents: 1_000_000, providerRef: null },
        // Sorts after every real 2025 date and would roll into 2026 when a pay period is added.
        { employerName: "Synthetic Employer", payDate: "2025-99-99", payFrequency: "biweekly", ytdGrossCents: 1_000_000, providerRef: null },
      ],
      2025,
      "high",
    );
    expect(out.sources.map((s) => [s.type, s.payDate])).toEqual([["paystub_projection", "2025-06-13"]]);
  });
});
