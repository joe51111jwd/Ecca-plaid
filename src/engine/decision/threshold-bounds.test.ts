import { describe, expect, it } from "vitest";
import { getThreshold } from "@/engine/ami";
import { AppError } from "@/lib/errors";
import { HARRIS, STARR, thresholdFixture } from "./test-fixtures";
import { toThresholdBounds, type ThresholdBoundsInput } from "./threshold-bounds";

/** A result as an AMI engine without the readings extension would return it. */
function withoutReadings(input: ThresholdBoundsInput): ThresholdBoundsInput {
  const { readings: _readings, lowerBoundCents: _lower, upperBoundCents: _upper, ...rest } = input;
  return rest;
}

describe("toThresholdBounds", () => {
  it("uses both readings where they differ (Starr County, four persons: $116,100 against $251,100)", () => {
    const bounds = toThresholdBounds(thresholdFixture(STARR));
    expect(bounds.readings.map((reading) => [reading.id, reading.thresholdCents])).toEqual([
      ["median_product", 11_610_000],
      ["section8_vli", 25_110_000],
    ]);
    expect(bounds).toMatchObject({ lowerBoundCents: 11_610_000, upperBoundCents: 25_110_000, readingsAgree: false, statutoryUpperBoundCents: 25_110_000, boundsSource: "ami_readings" });
  });

  it("collapses to one figure where the readings agree (Harris County, four persons: $312,000)", () => {
    const bounds = toThresholdBounds(thresholdFixture(HARRIS));
    expect(bounds).toMatchObject({ lowerBoundCents: 31_200_000, upperBoundCents: 31_200_000, readingsAgree: true, statutoryUpperBoundCents: 31_200_000 });
    expect(bounds.readings).toHaveLength(2);
  });

  it("has one reading and lower = upper for an IRS-published table", () => {
    const bounds = toThresholdBounds(thresholdFixture(STARR, { source: "irs_published" }));
    expect(bounds.readings.map((reading) => reading.id)).toEqual(["irs_published"]);
    expect(bounds).toMatchObject({ lowerBoundCents: 11_610_000, upperBoundCents: 11_610_000, readingsAgree: true });
  });

  it("falls back to a single reading when the result carries none", () => {
    const hud = toThresholdBounds(withoutReadings(thresholdFixture(STARR)));
    expect(hud).toMatchObject({ lowerBoundCents: 11_610_000, upperBoundCents: 11_610_000, readingsAgree: true, statutoryUpperBoundCents: 11_610_000, boundsSource: "single_threshold" });
    expect(hud.readings).toEqual([expect.objectContaining({ id: "median_product", thresholdCents: 11_610_000, statutoryThresholdCents: 11_610_000 })]);
    const irs = toThresholdBounds(withoutReadings(thresholdFixture(HARRIS, { source: "irs_published" })));
    expect(irs.readings[0]).toMatchObject({ id: "irs_published", label: "IRS-published limit" });
    expect(toThresholdBounds({ ...thresholdFixture(HARRIS), readings: null }).boundsSource).toBe("single_threshold");
  });

  it("keeps the readings at the SGO's cap and the ceiling at the statutory 300 percent", () => {
    const bounds = toThresholdBounds(thresholdFixture(STARR, { capPct: 185 }));
    // 185% of $38,700 = $71,595; $251,100 x 185 / 300 = $154,845.
    expect(bounds).toMatchObject({ lowerBoundCents: 7_159_500, upperBoundCents: 15_484_500, statutoryUpperBoundCents: 25_110_000 });
  });

  it("derives a reading's 300-percent figure when the AMI engine does not state it, never above the true figure", () => {
    const fixture = thresholdFixture(STARR, { capPct: 250 });
    const readings = (fixture.readings as Array<Record<string, unknown>>).map(({ statutoryThresholdCents: _dropped, ...reading }) => reading);
    const bounds = toThresholdBounds({ ...fixture, readings });
    expect(bounds.readings.map((reading) => reading.statutoryThresholdCents)).toEqual([11_610_000, 25_110_000]);
    // A cap-level figure that was floored scales back to at most the true 300-percent figure.
    const floored = toThresholdBounds({ ...fixture, capPct: 7, thresholdCents: 233, statutoryThresholdCents: 10_000, readings: [{ id: "median_product", label: "x", thresholdCents: 233, formula: "" }] });
    expect(floored.readings[0].statutoryThresholdCents).toBe(9_986);
    expect(floored.statutoryUpperBoundCents).toBe(10_000);
  });

  it("can only widen the range when the result's own fields disagree", () => {
    const fixture = thresholdFixture(STARR);
    expect(toThresholdBounds({ ...fixture, lowerBoundCents: 11_000_000 }).lowerBoundCents).toBe(11_000_000);
    expect(toThresholdBounds({ ...fixture, lowerBoundCents: 20_000_000 }).lowerBoundCents).toBe(11_610_000);
    expect(toThresholdBounds({ ...fixture, upperBoundCents: 26_000_000 }).upperBoundCents).toBe(26_000_000);
    expect(toThresholdBounds({ ...fixture, thresholdCents: 10_000_000 })).toMatchObject({ lowerBoundCents: 10_000_000, readingsAgree: false });
  });

  it("refuses malformed readings instead of hiding one", () => {
    const fixture = thresholdFixture(STARR);
    const bad: unknown[] = [[], "two", [{ id: "median_product" }], [{ id: "made_up", label: "x", thresholdCents: 1, formula: "" }], [{ id: "median_product", label: "x", thresholdCents: 1.5, formula: "" }]];
    for (const readings of bad) expect(() => toThresholdBounds({ ...fixture, readings }), JSON.stringify(readings)).toThrow(AppError);
    expect(() => toThresholdBounds({ ...fixture, lowerBoundCents: "low" })).toThrow(AppError);
    expect(() => toThresholdBounds({ ...fixture, thresholdCents: -1 })).toThrow(AppError);
  });

  it("accepts whatever the installed AMI engine returns", () => {
    for (const [countyFips, householdSize, capPct] of [["48201", 4, 300], ["48427", 4, 300], ["48427", 9, 185], ["48453", 1, 250]] as const) {
      const result = getThreshold({ countyFips, householdSize, capPct });
      const bounds = toThresholdBounds(result);
      expect(bounds.lowerBoundCents).toBeLessThanOrEqual(result.thresholdCents);
      expect(bounds.upperBoundCents).toBeGreaterThanOrEqual(result.thresholdCents);
      expect(bounds.statutoryUpperBoundCents).toBeGreaterThanOrEqual(result.statutoryThresholdCents);
      expect(bounds.statutoryUpperBoundCents).toBeGreaterThanOrEqual(bounds.upperBoundCents);
      expect(bounds.readingsAgree).toBe(bounds.lowerBoundCents === bounds.upperBoundCents);
    }
    // Both readings give $312,000 for four persons in Harris County whichever version of the AMI engine is installed.
    expect(toThresholdBounds(getThreshold({ countyFips: "48201", householdSize: 4 }))).toMatchObject({ lowerBoundCents: 31_200_000, upperBoundCents: 31_200_000, readingsAgree: true });
  });
});
