import type { AmiState, FamilySizeMultipliers, ThresholdMethod } from "./types";

/** Section 25F(c)(2)(A): household income may not be greater than 300 percent of area median gross income. */
export const STATUTORY_CAP_PCT = 300;

/** An SGO may set a stricter (lower) cap; nothing may exceed the statutory cap. */
export const MIN_CAP_PCT = 1;

export const BASIS_POINTS = 10_000;

/** Largest family size that has its own published multiplier or limit. Larger households use the per-person rule. */
export const MAX_TABULATED_FAMILY_SIZE = 8;

export const METHOD_HUD_DERIVED = "hud_median_x_cap_pct_x_family_size_multiplier_v1" as const satisfies ThresholdMethod;
export const METHOD_IRS_PUBLISHED = "irs_published_limit_by_family_size_v1" as const satisfies ThresholdMethod;

export const PROPOSED_RULE_ID = "REG-117199-25";

/**
 * HUD family-size multipliers: 0.70, 0.80, 0.90, 1.00, 1.08, 1.16, 1.24, 1.32 for one to eight persons and
 * +0.08 for each member above eight.
 *
 * Sources: Table 1 ("Current HUD Family Size Multipliers") and its note in the economic analysis of the
 * proposed regulations (REG-117199-25), which cites HUD's "Methodology for Determining FY 2026 Section 8
 * Income Limits" ("Number of Persons in Family and Percentage Adjustments": 70%, 80%, 90%, Base, 108%, 116%,
 * 124%, 132%; "For each person over eight-persons, the four-person income limit should be multiplied by an
 * additional 8 percent").
 *
 * The ingest copies this table into every HUD-derived dataset, and the engine computes from the copy in the
 * dataset, so a table built under one set of multipliers keeps them if this constant ever changes.
 */
export const HUD_FAMILY_SIZE_MULTIPLIERS: Readonly<FamilySizeMultipliers> = Object.freeze({
  bySizeBps: Object.freeze([7000, 8000, 9000, 10000, 10800, 11600, 12400, 13200]),
  additionalPersonBps: 800,
  citation:
    "Proposed regulations REG-117199-25, economic analysis, Table 1 (Current HUD Family Size Multipliers) and note; HUD, Methodology for Determining FY 2026 Section 8 Income Limits, Family Size Adjustments.",
});

/**
 * Number of counties a complete state table must contain. Texas: 254 (Texas Department of State Health
 * Services county list; the Census Bureau county file lists the same 254, FIPS 48001 to 48507, odd numbers).
 */
export const EXPECTED_COUNTY_COUNT: Readonly<Record<AmiState, number>> = Object.freeze({ TX: 254 });

export const STATE_FIPS: Readonly<Record<AmiState, string>> = Object.freeze({ TX: "48" });

export const STATE_NAME: Readonly<Record<AmiState, string>> = Object.freeze({ TX: "Texas" });

/**
 * Decisions this module makes where the statute, the proposed regulations (REG-117199-25) and HUD's
 * methodology are silent. Each is a deliberate default, named here so it can be found, questioned and
 * changed in one place. The three string values name the one behaviour that is implemented (in
 * `compute.ts`); the boolean is read by the validation.
 */
export const AMI_POLICY = Object.freeze({
  /**
   * A limit whose exact value is not a whole number of cents is rounded down to the cent. It cannot change
   * an outcome (income is in whole cents and the test is "income <= limit") and is only reachable with an
   * SGO cap below 300 percent on inputs that are not whole hundreds of dollars.
   */
  subCentRounding: "floor",
  /**
   * An IRS-published table lists the 300-percent limit only. An SGO's stricter cap scales that published
   * limit in proportion: limit x cap / 300.
   */
  capOnPublishedLimit: "proportional",
  /**
   * A household above eight persons, on an IRS table that prints no per-person amount, is refused with
   * reason `household_size_not_published` and belongs in manual review. The +0.08 multiplier rule of the
   * HUD-derived table is not carried over to a published table on this module's own authority.
   */
  aboveEightWithoutPublishedIncrement: "refuse",
  /**
   * An IRS table whose limit falls as family size grows is rejected as a transcription error. Set to false
   * only if the IRS really publishes such a table.
   */
  irsLimitsMustNotDecreaseWithFamilySize: true,
  /**
   * The `section8_vli` reading needs HUD's very-low-income limit for the family size, and HUD publishes
   * `l50_1`..`l50_8` only. Above eight persons the engine applies HUD's documented method: "For each person
   * over eight-persons, the four-person income limit should be multiplied by an additional 8 percent. [...]
   * HUD rounds income limits up to the nearest $50." (HUD, Methodology for Determining FY 2026 Section 8
   * Income Limits, lines 249-252; docs/reference/sgo-verification-rules.md F35). HUD also lets local agencies
   * use the unrounded figure for nine or more persons (same document, lines 252-253); this module rounds up,
   * and the reading's formula says "extended by HUD's method".
   */
  section8VliAboveEight: "four_person_x_multiplier_round_up_50",
} as const);

/** Factor between HUD's 50% very-low-income limit and a 300% limit under the `section8_vli` reading. */
export const SECTION8_VLI_FACTOR = 6;

/** HUD rounds its income limits up to this many dollars (methodology, lines 249-252). */
export const HUD_LIMIT_ROUNDING_DOLLARS = 50;

/** Version of the wording returned by `describeThresholdSource`. Bump when any sentence changes. */
export const THRESHOLD_COPY_VERSION = "threshold-source-copy.v2";
