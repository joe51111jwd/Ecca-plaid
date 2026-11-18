import { toCsv } from "@/lib/csv";
import { isAppError } from "@/lib/errors";
import { MAX_TABULATED_FAMILY_SIZE, STATUTORY_CAP_PCT } from "../constants";
import { formatExactUsd } from "../format";
import { computeThreshold } from "../compute";
import type { AmiTable } from "../types";

/**
 * Comparison of two threshold tables at the statutory 300 percent, per county and household size 1 to 8.
 * Printed before a table is activated so a person reviews exactly which limits change, and by how much.
 */

export interface ThresholdDiffRow {
  fips: string;
  county: string;
  householdSize: number;
  /** Limit in the table being replaced; null when that table has no such county. */
  oldCents: number | null;
  /** Limit in the candidate table; null when it has no such county. */
  newCents: number | null;
  /** new - old; null when either side is missing. */
  deltaCents: number | null;
}

export interface AreaChange {
  fips: string;
  county: string;
  oldArea: string;
  newArea: string;
}

export interface ThresholdDiff {
  oldVersion: string | null;
  newVersion: string;
  rows: ThresholdDiffRow[];
  summary: {
    cells: number;
    compared: number;
    changed: number;
    unchanged: number;
    increased: number;
    decreased: number;
    /** Most positive delta; null when nothing increased. */
    largestIncrease: ThresholdDiffRow | null;
    /** Most negative delta; null when nothing decreased. */
    largestDecrease: ThresholdDiffRow | null;
    /** Smallest non-zero change by absolute value; null when nothing changed. */
    smallestChange: ThresholdDiffRow | null;
    /** Largest relative change in basis points of the old limit (signed), with its row. */
    largestRelativeChange: { row: ThresholdDiffRow; basisPoints: number } | null;
    countiesChanged: number;
    countiesOnlyInOld: string[];
    countiesOnlyInNew: string[];
    /** Counties whose area is now made up of a different set of counties (the geography itself changed). */
    areaChanges: AreaChange[];
    /** Counties whose area holds the same counties as before but carries a different name or code. */
    areaRenames: AreaChange[];
  };
}

function limitOrNull(table: AmiTable | null, fips: string, householdSize: number): number | null {
  if (!table || !table.countyByFips.has(fips)) return null;
  try {
    return computeThreshold(table, { countyFips: fips, householdSize, capPct: STATUTORY_CAP_PCT }).thresholdCents;
  } catch (error) {
    if (isAppError(error)) return null;
    throw error;
  }
}

export function diffTables(oldTable: AmiTable | null, newTable: AmiTable): ThresholdDiff {
  const fipsCodes = [...new Set([...(oldTable ? oldTable.countyByFips.keys() : []), ...newTable.countyByFips.keys()])].sort();
  const rows: ThresholdDiffRow[] = [];
  const areaChanges: AreaChange[] = [];
  const areaRenames: AreaChange[] = [];
  const countiesOnlyInOld: string[] = [];
  const countiesOnlyInNew: string[] = [];
  const changedCounties = new Set<string>();

  for (const fips of fipsCodes) {
    const oldCounty = oldTable?.countyByFips.get(fips);
    const newCounty = newTable.countyByFips.get(fips);
    const county = (newCounty ?? oldCounty)!.name;
    if (oldTable && !oldCounty) countiesOnlyInNew.push(fips);
    if (!newCounty) countiesOnlyInOld.push(fips);
    if (oldTable && oldCounty && newCounty) {
      const oldArea = oldTable.areaByCode.get(oldCounty.areaCode)!;
      const newArea = newTable.areaByCode.get(newCounty.areaCode)!;
      const oldMembers = oldTable.countyFipsByArea.get(oldArea.code) ?? [];
      const newMembers = newTable.countyFipsByArea.get(newArea.code) ?? [];
      const describe = (area: { name: string; code: string }, members: readonly string[]): string =>
        `${area.name} [${area.code}] (${members.length} ${members.length === 1 ? "county" : "counties"})`;
      const change = { fips, county, oldArea: describe(oldArea, oldMembers), newArea: describe(newArea, newMembers) };
      if (oldMembers.join(",") !== newMembers.join(",")) areaChanges.push(change);
      else if (oldArea.code !== newArea.code || oldArea.name !== newArea.name) areaRenames.push(change);
    }
    for (let householdSize = 1; householdSize <= MAX_TABULATED_FAMILY_SIZE; householdSize++) {
      const oldCents = limitOrNull(oldTable, fips, householdSize);
      const newCents = limitOrNull(newTable, fips, householdSize);
      const deltaCents = oldCents === null || newCents === null ? null : newCents - oldCents;
      if (deltaCents !== null && deltaCents !== 0) changedCounties.add(fips);
      rows.push({ fips, county, householdSize, oldCents, newCents, deltaCents });
    }
  }

  let largestIncrease: ThresholdDiffRow | null = null;
  let largestDecrease: ThresholdDiffRow | null = null;
  let smallestChange: ThresholdDiffRow | null = null;
  let largestRelativeChange: { row: ThresholdDiffRow; basisPoints: number } | null = null;
  let compared = 0;
  let changed = 0;
  let increased = 0;
  let decreased = 0;
  for (const row of rows) {
    if (row.deltaCents === null) continue;
    compared += 1;
    if (row.deltaCents === 0) continue;
    changed += 1;
    if (row.deltaCents > 0) {
      increased += 1;
      if (!largestIncrease || row.deltaCents > largestIncrease.deltaCents!) largestIncrease = row;
    } else {
      decreased += 1;
      if (!largestDecrease || row.deltaCents < largestDecrease.deltaCents!) largestDecrease = row;
    }
    if (!smallestChange || Math.abs(row.deltaCents) < Math.abs(smallestChange.deltaCents!)) smallestChange = row;
    // Signed change in basis points of the old limit, truncated toward zero; BigInt keeps the product exact.
    const basisPoints = Number((BigInt(row.deltaCents) * 10_000n) / BigInt(row.oldCents!));
    if (!largestRelativeChange || Math.abs(basisPoints) > Math.abs(largestRelativeChange.basisPoints)) largestRelativeChange = { row, basisPoints };
  }

  return {
    oldVersion: oldTable ? oldTable.version : null,
    newVersion: newTable.version,
    rows,
    summary: {
      cells: rows.length,
      compared,
      changed,
      unchanged: compared - changed,
      increased,
      decreased,
      largestIncrease,
      largestDecrease,
      smallestChange,
      largestRelativeChange,
      countiesChanged: changedCounties.size,
      countiesOnlyInOld,
      countiesOnlyInNew,
      areaChanges,
      areaRenames,
    },
  };
}

function money(cents: number | null): string {
  return cents === null ? "(none)" : formatExactUsd(cents);
}

function signedMoney(cents: number | null): string {
  if (cents === null) return "(n/a)";
  if (cents === 0) return "0";
  return `${cents > 0 ? "+" : "-"}${formatExactUsd(Math.abs(cents))}`;
}

function describeRow(row: ThresholdDiffRow): string {
  return `${signedMoney(row.deltaCents)} for ${row.county} (${row.fips}), household of ${row.householdSize}: ${money(row.oldCents)} -> ${money(row.newCents)}`;
}

export interface FormatDiffOptions {
  /** List only the county-and-size cells whose limit differs. The summary always covers every cell. */
  changedOnly?: boolean;
}

/** Plain-text report: one line per county and household size (old limit, new limit, delta), then the summary. */
export function formatDiffReport(diff: ThresholdDiff, options: FormatDiffOptions = {}): string {
  const s = diff.summary;
  const lines: string[] = [];
  lines.push(`Threshold comparison at ${STATUTORY_CAP_PCT}%: ${diff.oldVersion ?? "(no active table)"} -> ${diff.newVersion}`);
  lines.push("");

  const listed = options.changedOnly ? diff.rows.filter((row) => row.deltaCents !== 0) : diff.rows;
  if (listed.length > 0) {
    const header = ["FIPS", "County", "Size", "Old limit", "New limit", "Delta"];
    const body = listed.map((row) => [row.fips, row.county, String(row.householdSize), money(row.oldCents), money(row.newCents), signedMoney(row.deltaCents)]);
    const widths = header.map((title, column) => Math.max(title.length, ...body.map((cells) => cells[column].length)));
    const render = (cells: string[]): string => cells.map((value, column) => (column <= 1 ? value.padEnd(widths[column]) : value.padStart(widths[column]))).join("  ");
    lines.push(render(header), widths.map((width) => "-".repeat(width)).join("  "), ...body.map(render), "");
  } else if (options.changedOnly) {
    lines.push("No county-and-size cell differs.", "");
  }

  lines.push("Summary");
  lines.push(`  Cells (county x household size 1-${MAX_TABULATED_FAMILY_SIZE}): ${s.cells}; compared: ${s.compared}; changed: ${s.changed}; unchanged: ${s.unchanged}`);
  lines.push(`  Increased: ${s.increased}; decreased: ${s.decreased}; counties with any change: ${s.countiesChanged}`);
  lines.push(`  Largest increase: ${s.largestIncrease ? describeRow(s.largestIncrease) : "none"}`);
  lines.push(`  Largest decrease: ${s.largestDecrease ? describeRow(s.largestDecrease) : "none"}`);
  lines.push(`  Smallest non-zero change: ${s.smallestChange ? describeRow(s.smallestChange) : "none"}`);
  if (s.largestRelativeChange) {
    const bp = s.largestRelativeChange.basisPoints;
    lines.push(`  Largest relative change: ${bp > 0 ? "+" : "-"}${(Math.abs(bp) / 100).toFixed(2)}% of the old limit, ${describeRow(s.largestRelativeChange.row)}`);
  }
  if (s.countiesOnlyInOld.length > 0) lines.push(`  Counties missing from ${diff.newVersion}: ${s.countiesOnlyInOld.join(", ")}`);
  if (s.countiesOnlyInNew.length > 0) lines.push(`  Counties not in ${diff.oldVersion}: ${s.countiesOnlyInNew.join(", ")}`);
  lines.push(`  Counties whose geographic area changed (the area is a different set of counties): ${s.areaChanges.length}`);
  for (const change of s.areaChanges) lines.push(`    ${change.fips} ${change.county}: ${change.oldArea} -> ${change.newArea}`);
  lines.push(`  Counties whose area kept its counties but was renamed or recoded: ${s.areaRenames.length}`);
  for (const change of s.areaRenames.slice(0, 5)) lines.push(`    ${change.fips} ${change.county}: ${change.oldArea} -> ${change.newArea}`);
  if (s.areaRenames.length > 5) lines.push(`    ... and ${s.areaRenames.length - 5} more`);
  return `${lines.join("\n")}\n`;
}

/** The same comparison as CSV, for a spreadsheet review. Amounts are integer cents. */
export function diffToCsv(diff: ThresholdDiff): string {
  return toCsv(
    ["fips", "county", "household_size", "old_version", "old_limit_cents", "new_version", "new_limit_cents", "delta_cents"],
    diff.rows.map((row) => [row.fips, row.county, row.householdSize, diff.oldVersion ?? "", row.oldCents ?? "", diff.newVersion, row.newCents ?? "", row.deltaCents ?? ""]),
  );
}
