import { computeThreshold, computeThresholdRow, tableArea, tableCounties, tableCountiesInArea, tableCounty } from "./compute";
import { getActiveTable } from "./registry";
import type { AmiArea, AmiCounty, AmiTable, GetThresholdInput, ThresholdResult, ThresholdRow } from "./types";

/**
 * Public entry points of the income engine. Each uses the active table unless the caller passes one (to
 * re-derive an old decision under the table it was made with, or to test a table before activating it).
 * The arithmetic and its documentation are in `compute.ts`.
 */

/**
 * The household income limit for a county and household size. A household passes when its income is less
 * than or equal to `thresholdCents`.
 *
 * Throws a `validation_failed` AppError (with `details.reason` and `details.fields`) for a malformed,
 * non-Texas or unknown county FIPS code, a household size that is not a whole number >= 1, a cap that is
 * not a whole percent from 1 to 300, and a household above eight persons on an IRS table that publishes no
 * per-person increment (`details.reason === "household_size_not_published"`; send it to review).
 */
export function getThreshold(input: GetThresholdInput): ThresholdResult {
  return computeThreshold(input.table ?? getActiveTable(), input);
}

/** The limits for household sizes 1 through 8 in one county, e.g. to show a family or a reviewer the whole row. */
export function thresholdRow(countyFips: string, options: { capPct?: number; table?: AmiTable } = {}): ThresholdRow {
  return computeThresholdRow(options.table ?? getActiveTable(), countyFips, options.capPct);
}

/** Every county in the table, ascending by FIPS code. */
export function listCounties(table: AmiTable = getActiveTable()): AmiCounty[] {
  return tableCounties(table);
}

/** A county by 5-digit FIPS code, or null when the code is not a county in the table. Never throws. */
export function getCounty(countyFips: string, table: AmiTable = getActiveTable()): AmiCounty | null {
  return tableCounty(table, countyFips);
}

/** An income-limit area by code, or null when the table has no such area. Never throws. */
export function getArea(areaCode: string, table: AmiTable = getActiveTable()): AmiArea | null {
  return tableArea(table, areaCode);
}

/** The counties that share one income-limit area (and therefore one set of limits), ascending by FIPS code. Empty for an unknown area. */
export function countiesInArea(areaCode: string, table: AmiTable = getActiveTable()): AmiCounty[] {
  return tableCountiesInArea(table, areaCode);
}
