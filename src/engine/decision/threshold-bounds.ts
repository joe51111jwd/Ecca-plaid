/**
 * The limit as a range, not a point.
 *
 * While the threshold table is HUD-derived the proposed regulation can be read two ways, and the readings
 * give different limits in 143 of 254 Texas counties (docs/reference/sgo-verification-rules.md, F34):
 *   - `median_product`: 300% x HUD area median family income x family-size multiplier, the worked example
 *     in the economic analysis;
 *   - `section8_vli`:   6 x HUD's Section 8 very-low-income limit for the family size, following the
 *     regulation text ("the income limit determined ... in accordance with section 8").
 * Which one the IRS table will follow is not in the sources. The decision engine therefore decides
 * automatically only where every reading agrees: within the limit means at or below the LOWEST reading,
 * over the limit means above the HIGHEST, and anything between goes to a person with both figures shown.
 *
 * This module is the one place that turns a `getThreshold` result into that range. It reads the readings
 * the AMI engine returns and, for a result that carries none, falls back to a single reading equal to
 * `thresholdCents` (always the case for an IRS-published table, where lower = upper).
 */
import { z } from "zod";
import type { ThresholdResult } from "@/engine/ami";
import { invalid } from "@/lib/errors";
import { STATUTORY_CAP_PCT } from "./policy";

export type ThresholdReadingId = "median_product" | "section8_vli" | "irs_published";

export interface ThresholdReadingBound {
  id: ThresholdReadingId;
  /** Plain-English name of the reading. */
  label: string;
  /** The limit under this reading at the SGO's cap, in cents. */
  thresholdCents: number;
  /** The limit under this reading at the statutory 300 percent, in cents. */
  statutoryThresholdCents: number;
  /** The arithmetic with the actual numbers. */
  formula: string;
}

export interface ThresholdBounds {
  /** Every reading of the limit at the SGO's cap, at least one. */
  readings: ThresholdReadingBound[];
  /** The lowest reading. Income at or below it is within the limit under every reading. */
  lowerBoundCents: number;
  /** The highest reading. Income above it is over the limit under every reading. */
  upperBoundCents: number;
  readingsAgree: boolean;
  /** The highest reading at the statutory 300 percent: the ceiling no reviewer may approve above. */
  statutoryUpperBoundCents: number;
  /** `ami_readings`: the AMI engine supplied the readings. `single_threshold`: it supplied one limit and nothing else. */
  boundsSource: "ami_readings" | "single_threshold";
}

/**
 * What `toThresholdBounds` reads from a `getThreshold` result. The reading fields are typed `unknown` and
 * checked at run time, so any version of the AMI engine's result type is accepted here.
 */
export type ThresholdBoundsInput = Pick<ThresholdResult, "thresholdCents" | "statutoryThresholdCents" | "capPct" | "source" | "formula"> & {
  readings?: unknown;
  lowerBoundCents?: unknown;
  upperBoundCents?: unknown;
};

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const readingsSchema = z
  .array(
    z.object({
      id: z.enum(["median_product", "section8_vli", "irs_published"]),
      label: z.string().min(1),
      thresholdCents: cents,
      statutoryThresholdCents: cents.optional(),
      formula: z.string(),
    }),
  )
  .min(1)
  .max(8);

const FALLBACK_LABEL: Record<"hud_provisional" | "irs_published", { id: ThresholdReadingId; label: string }> = {
  hud_provisional: { id: "median_product", label: "Area median income x cap x family-size multiplier (economic analysis of the proposed regulations)" },
  irs_published: { id: "irs_published", label: "IRS-published limit" },
};

/**
 * A reading's limit at 300 percent from its limit at the SGO's cap, when the AMI engine does not state it.
 * Rounded up, which never exceeds the true 300-percent figure: the cap-level figure was floored from it.
 */
function scaleToStatutory(thresholdCents: number, capPct: number): number {
  const numerator = BigInt(thresholdCents) * BigInt(STATUTORY_CAP_PCT);
  const divisor = BigInt(capPct);
  return Number((numerator + divisor - 1n) / divisor);
}

/**
 * The readings and bounds of a `getThreshold` result.
 *
 * Uses the result's `readings` when present; otherwise one reading equal to `thresholdCents`. The bounds are
 * the widest the result supports: every reading, `thresholdCents` itself and any `lowerBoundCents` /
 * `upperBoundCents` the result states are taken into account, so a disagreement between those fields can
 * only widen the range a person has to look at, never narrow it.
 *
 * Throws a `validation_failed` AppError when the result carries readings that are malformed: silently
 * falling back to one reading would hide the second one.
 */
export function toThresholdBounds(result: ThresholdBoundsInput): ThresholdBounds {
  const base = z.object({ thresholdCents: cents, statutoryThresholdCents: cents, capPct: z.number().int().min(1).max(STATUTORY_CAP_PCT) }).safeParse(result);
  if (!base.success) throw invalid("Threshold result is malformed: thresholdCents, statutoryThresholdCents and capPct are required");
  const { thresholdCents, statutoryThresholdCents, capPct } = base.data;

  if (result.readings === undefined || result.readings === null) {
    const fallback = FALLBACK_LABEL[result.source];
    return {
      readings: [{ ...fallback, thresholdCents, statutoryThresholdCents, formula: result.formula }],
      lowerBoundCents: thresholdCents,
      upperBoundCents: thresholdCents,
      readingsAgree: true,
      statutoryUpperBoundCents: statutoryThresholdCents,
      boundsSource: "single_threshold",
    };
  }

  const parsed = readingsSchema.safeParse(result.readings);
  if (!parsed.success) {
    throw invalid(`Threshold result carries malformed readings: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const stated = [result.lowerBoundCents, result.upperBoundCents].filter((value) => value !== undefined && value !== null);
  const statedBounds = z.array(cents).safeParse(stated);
  if (!statedBounds.success) throw invalid("Threshold result carries malformed bounds: lowerBoundCents and upperBoundCents must be whole cents");

  const readings: ThresholdReadingBound[] = parsed.data.map((reading) => ({
    id: reading.id,
    label: reading.label,
    thresholdCents: reading.thresholdCents,
    statutoryThresholdCents: reading.statutoryThresholdCents ?? scaleToStatutory(reading.thresholdCents, capPct),
    formula: reading.formula,
  }));
  const all = [thresholdCents, ...readings.map((reading) => reading.thresholdCents), ...statedBounds.data];
  const lowerBoundCents = Math.min(...all);
  const upperBoundCents = Math.max(...all);
  return {
    readings,
    lowerBoundCents,
    upperBoundCents,
    readingsAgree: lowerBoundCents === upperBoundCents,
    statutoryUpperBoundCents: Math.max(statutoryThresholdCents, ...readings.map((reading) => reading.statutoryThresholdCents)),
    boundsSource: "ami_readings",
  };
}
