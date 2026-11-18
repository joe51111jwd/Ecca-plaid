/**
 * Integration with the REAL AMI engine and the active HUD-derived table: the decision consumes the readings,
 * bounds and agreement flag that `getThreshold` returns, not a hand-built fixture. Household figures are
 * SYNTHETIC; the limits are the HUD FY 2026 ones recorded in docs/reference (sgo-verification-rules.md F34).
 */
import { describe, expect, it } from "vitest";
import { getActiveTable, getThreshold } from "@/engine/ami";
import { decide } from "./decide";
import { explainDecision } from "./explain";
import { applyReviewerResolution } from "./resolution";
import { decisionInput, directEvidence, FAMILY_OF_FOUR, HARRIS, STARR } from "./test-fixtures";
import type { Decision, DecisionInput } from "./types";

const table = getActiveTable();
const dollars = (amount: number): number => Math.round(amount * 100);

/** A family of four with complete, trusted direct evidence totalling `total` dollars, decided against the real table. */
function decideReal(countyFips: string, total: number, sgoPolicy: DecisionInput["sgoPolicy"] = { capPct: 300, reviewBandBps: 0 }): Decision {
  return decide(
    decisionInput({
      sgoPolicy,
      amiTable: table,
      household: { size: 4, countyFips, members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: false } },
      direct: directEvidence(dollars(total) - 4_000_000, 4_000_000),
    }),
  );
}
const codes = (decision: Decision): string[] => decision.reviewReasons.map((reason) => reason.code);

describe("decide with the real AMI engine", () => {
  it("runs against the active HUD-derived table", () => {
    expect(table).toMatchObject({ source: "hud_provisional", provisional: true });
  });

  it("carries the AMI engine's own readings and bounds onto the decision", () => {
    const real = getThreshold({ countyFips: STARR.fips, householdSize: 4, table });
    const decision = decideReal(STARR.fips, 50_000);
    expect(decision.threshold).toMatchObject({
      boundsSource: "ami_readings",
      readings: real.readings,
      lowerBoundCents: real.lowerBoundCents,
      upperBoundCents: real.upperBoundCents,
      readingsAgree: real.readingsAgree,
      source: "hud_provisional",
      tableVersion: table.version,
      effectiveDate: table.effectiveDate,
      provisional: true,
    });
  });

  describe("Starr County (48427), household of 4: reading A $116,100, reading B $251,100", () => {
    it("is eligible at or below the lower reading, relying on it", () => {
      const decision = decideReal(STARR.fips, 116_100);
      expect(decision).toMatchObject({ status: "eligible", method: "direct", householdIncomeCents: 11_610_000, provisional: true });
      expect(decision.threshold).toMatchObject({ readingsAgree: false, lowerBoundCents: 11_610_000, upperBoundCents: 25_110_000, reliedOn: "lower_bound", reliedOnLimitCents: 11_610_000 });
      expect(decision.threshold!.readings.map((reading) => [reading.id, reading.thresholdCents])).toEqual([
        ["median_product", 11_610_000],
        ["section8_vli", 25_110_000],
      ]);
    });

    it("goes to review between the readings, with both figures carried on the decision", () => {
      for (const total of [116_100.01, 180_000, 251_100]) {
        const decision = decideReal(STARR.fips, total);
        expect(decision.status, String(total)).toBe("needs_review");
        expect(codes(decision), String(total)).toEqual(["between_provisional_readings"]);
        expect(decision.reviewReasons[0].message).toContain("$116,100");
        expect(decision.reviewReasons[0].message).toContain("$251,100");
        expect(decision.threshold).toMatchObject({ lowerBoundCents: 11_610_000, upperBoundCents: 25_110_000, readingsAgree: false, reliedOn: "none", reliedOnLimitCents: null });
        expect(decision.threshold!.readings.map((reading) => reading.thresholdCents)).toEqual([11_610_000, 25_110_000]);
        // The SGO screen shows both readings.
        const sgo = explainDecision(decision, "en").sgo.paragraphs.join(" ");
        expect(sgo).toContain("$116,100");
        expect(sgo).toContain("$251,100");
      }
    });

    it("is ineligible above the higher reading with complete coverage, relying on it", () => {
      const decision = decideReal(STARR.fips, 251_100.01);
      expect(decision).toMatchObject({ status: "ineligible", method: "direct", householdIncomeCents: 25_110_001 });
      expect(decision.coverage).toMatchObject({ complete: true });
      expect(decision.threshold).toMatchObject({ reliedOn: "upper_bound", reliedOnLimitCents: 25_110_000 });
      expect(explainDecision(decision, "en").sgo.paragraphs).toContain("The income comparison rested on the higher reading of the limit, $251,100.");
    });

    it("widens both ends by the SGO's review band while the table is provisional", () => {
      // 5% of $116,100 = $5,805; 5% of $251,100 = $12,555.
      const band = { capPct: 300, reviewBandBps: 500 };
      expect(decideReal(STARR.fips, 110_294.99, band).status).toBe("eligible");
      expect(codes(decideReal(STARR.fips, 110_295, band))).toEqual(["near_provisional_threshold"]);
      expect(codes(decideReal(STARR.fips, 263_655, band))).toEqual(["near_provisional_threshold"]);
      expect(decideReal(STARR.fips, 263_655.01, band).status).toBe("ineligible");
    });

    it("lets a reviewer settle the gap and records which reading the resolution rests on", () => {
      const resolved = applyReviewerResolution(decideReal(STARR.fips, 180_000), {
        resolution: "eligible",
        reviewerId: "usr_reviewer",
        notes: "SYNTHETIC: approved under reading B pending the IRS table.",
        basis: { method: "direct" },
        resolvedOn: "2027-03-20",
      });
      expect(resolved.threshold).toMatchObject({ reliedOn: "upper_bound", reliedOnLimitCents: 25_110_000 });
    });
  });

  describe("Harris County (48201), household of 4: both readings give $312,000", () => {
    it("treats the agreeing readings as a single limit", () => {
      const within = decideReal(HARRIS.fips, 312_000);
      expect(within.status).toBe("eligible");
      expect(within.threshold).toMatchObject({ readingsAgree: true, lowerBoundCents: 31_200_000, upperBoundCents: 31_200_000, reliedOn: "single_limit", reliedOnLimitCents: 31_200_000 });
      expect(within.threshold!.readings.map((reading) => [reading.id, reading.thresholdCents])).toEqual([
        ["median_product", 31_200_000],
        ["section8_vli", 31_200_000],
      ]);
      const over = decideReal(HARRIS.fips, 312_000.01);
      expect(over.status).toBe("ineligible");
      expect(over.threshold).toMatchObject({ reliedOn: "single_limit", reliedOnLimitCents: 31_200_000 });
    });
  });

  describe("an SGO cap of 185% scales both readings", () => {
    const cap = { capPct: 185, reviewBandBps: 0 };

    it("Starr County: $71,595 and $154,845, with the statutory ceiling still at $251,100", () => {
      const at = decideReal(STARR.fips, 71_595, cap);
      expect(at.status).toBe("eligible");
      expect(at.threshold).toMatchObject({ capPct: 185, lowerBoundCents: 7_159_500, upperBoundCents: 15_484_500, statutoryUpperBoundCents: 25_110_000, reliedOn: "lower_bound", reliedOnLimitCents: 7_159_500 });
      expect(at.threshold!.readings.map((reading) => [reading.thresholdCents, reading.statutoryThresholdCents])).toEqual([
        [7_159_500, 11_610_000],
        [15_484_500, 25_110_000],
      ]);
      expect(codes(decideReal(STARR.fips, 71_595.01, cap))).toEqual(["between_provisional_readings"]);
      expect(codes(decideReal(STARR.fips, 154_845, cap))).toEqual(["between_provisional_readings"]);
      const over = decideReal(STARR.fips, 154_845.01, cap);
      expect(over.status).toBe("ineligible");
      expect(over.threshold).toMatchObject({ reliedOn: "upper_bound", reliedOnLimitCents: 15_484_500 });
      expect(over.reasons.map((reason) => reason.code)).toContain("sgo_stricter_cap_applied");
    });

    it("Harris County: both readings at $192,400", () => {
      expect(decideReal(HARRIS.fips, 192_400, cap).threshold).toMatchObject({ lowerBoundCents: 19_240_000, upperBoundCents: 19_240_000, readingsAgree: true, statutoryUpperBoundCents: 31_200_000 });
      expect(decideReal(HARRIS.fips, 192_400, cap).status).toBe("eligible");
      expect(decideReal(HARRIS.fips, 192_400.01, cap).status).toBe("ineligible");
    });
  });
});
