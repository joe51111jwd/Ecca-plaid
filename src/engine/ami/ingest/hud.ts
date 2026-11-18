import { invalid } from "@/lib/errors";
import { EXPECTED_COUNTY_COUNT, HUD_FAMILY_SIZE_MULTIPLIERS, METHOD_HUD_DERIVED, STATE_FIPS, STATE_NAME } from "../constants";
import { buildTable, isIsoCalendarDate, VERSION_PATTERN } from "../dataset";
import type { AmiSourceFile, AmiState, HudAreaRecord, HudDerivedDataset } from "../types";
import { listXlsxSheets, readXlsxSheet, type XlsxCell, type XlsxRow } from "./xlsx";

/**
 * Turns HUD's Section 8 income-limit workbook into the provisional dataset for one state.
 *
 * What is taken from HUD: the county-to-area mapping, the area names, the metro flag, the area median family
 * income (`median<year>`, four-person basis, not adjusted for family size) and, for reference only, HUD's
 * own published four-person very-low (50%) and low (80%) limits, and HUD's very-low-income limits for family
 * sizes 1 to 8 (`l50_1`..`l50_8`). The latter are the input of the `section8_vli` reading of the limit
 * (6 x HUD's very-low-income limit; see `compute.ts`); they are capped, floored and rounded up to $50 by HUD
 * and are never inputs to the `median_product` reading (the area median times a multiplier).
 *
 * Validation is all-or-nothing. Any problem in the state's rows fails the ingest with every problem listed.
 */

export interface HudIngestInput {
  /** Bytes of the official workbook. */
  workbook: Uint8Array;
  state: AmiState;
  sourceFile: AmiSourceFile;
  /** YYYY-MM-DD; comes from the pinned release facts, not from the workbook. */
  effectiveDate: string;
  effectiveDateCitation: string;
  /** When given, must equal the year in the workbook's `median<year>` column. */
  fiscalYear?: number;
  /** Worksheet to read; defaults to the single sheet named `Section8-FY<yy>`. */
  sheetName?: string;
  /** Table version id; defaults to `hud-fy<year>-<state>`. */
  version?: string;
}

export interface HudIngestStats {
  sheetName: string;
  fiscalYear: number;
  rowsInSheet: number;
  counties: number;
  areas: number;
  multiCountyAreas: number;
  minMedianDollars: number;
  maxMedianDollars: number;
}

export interface HudIngestResult {
  dataset: HudDerivedDataset;
  stats: HudIngestStats;
}

const MAX_REPORTED_PROBLEMS = 40;

function failValidation(what: string, problems: string[]): never {
  const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
  const more = problems.length > shown.length ? ` (and ${problems.length - shown.length} more)` : "";
  throw invalid(`${what} failed validation with ${problems.length} problem${problems.length === 1 ? "" : "s"}${more}:\n  - ${shown.join("\n  - ")}`, { problems });
}

function pickSheet(workbook: Uint8Array, requested: string | undefined): string {
  const sheets = listXlsxSheets(workbook);
  if (requested !== undefined) {
    if (!sheets.includes(requested)) throw invalid(`Workbook has no sheet named "${requested}" (sheets: ${sheets.map((s) => `"${s}"`).join(", ") || "none"}).`);
    return requested;
  }
  const candidates = sheets.filter((name) => /^Section8-FY\d{2}$/.test(name));
  if (candidates.length !== 1) {
    throw invalid(`Expected exactly one data sheet named "Section8-FY<yy>" in the workbook, found ${candidates.length} (sheets: ${sheets.map((s) => `"${s}"`).join(", ") || "none"}). Pass --sheet to choose one.`);
  }
  return candidates[0];
}

const VLI_COLUMNS = ["l50_1", "l50_2", "l50_3", "l50_4", "l50_5", "l50_6", "l50_7", "l50_8"] as const;
const REQUIRED_COLUMNS = ["fips", "stusps", "state", "state_name", "hud_area_code", "hud_area_name", "county", "county_name", "county_town_name", "metro", ...VLI_COLUMNS, "l80_4"] as const;
type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

interface ColumnMap {
  columns: Record<RequiredColumn, number>;
  median: number;
  medianHeader: string;
  fiscalYear: number;
}

/** Headers are matched by name, case-insensitively (HUD mixes `County_Name`, `ELI_1`, `hud_area_name`), never by position. */
function mapColumns(header: XlsxRow, sheetName: string): ColumnMap {
  const problems: string[] = [];
  const positions = new Map<string, number>();
  header.cells.forEach((cell, index) => {
    if (cell === null || cell === "") return;
    if (typeof cell !== "string") {
      problems.push(`header cell in column ${index + 1} is not text`);
      return;
    }
    const name = cell.trim().toLowerCase();
    if (positions.has(name)) problems.push(`header "${name}" appears more than once`);
    positions.set(name, index);
  });

  const columns = {} as Record<RequiredColumn, number>;
  for (const name of REQUIRED_COLUMNS) {
    const position = positions.get(name);
    if (position === undefined) problems.push(`required column "${name}" is missing`);
    else columns[name] = position;
  }

  const medianHeaders = [...positions.keys()].filter((name) => /^median\d{4}$/.test(name));
  if (medianHeaders.length !== 1) problems.push(`expected exactly one "median<year>" column, found ${medianHeaders.length}`);
  if (problems.length > 0) failValidation(`Header row of sheet "${sheetName}"`, problems);

  const medianHeader = medianHeaders[0];
  return { columns, median: positions.get(medianHeader)!, medianHeader, fiscalYear: Number(medianHeader.slice("median".length)) };
}

function describeCell(value: XlsxCell | undefined): string {
  if (value === null || value === undefined || value === "") return "empty";
  return typeof value === "string" ? `"${value}"` : String(value);
}

interface ParsedRow {
  rowNumber: number;
  fips5: string;
  countyName: string;
  areaCode: string;
  areaName: string;
  metro: boolean;
  median: number;
  l50_4: number;
  l80_4: number;
  /** `l50_1`..`l50_8`, whole dollars. */
  l50: number[];
}

export function buildHudDataset(input: HudIngestInput): HudIngestResult {
  const state = input.state;
  const stateFips = STATE_FIPS[state];
  const expectedCounties = EXPECTED_COUNTY_COUNT[state];
  if (stateFips === undefined || expectedCounties === undefined) throw invalid(`State ${String(state)} is not supported; the income engine covers Texas (TX) only.`);
  if (!isIsoCalendarDate(input.effectiveDate)) throw invalid(`Effective date must be a calendar date written YYYY-MM-DD (received "${input.effectiveDate}").`);
  if (input.effectiveDateCitation.trim() === "") throw invalid("A citation for the effective date is required.");

  const sheetName = pickSheet(input.workbook, input.sheetName);
  const rows = readXlsxSheet(input.workbook, sheetName);
  if (rows.length < 2) throw invalid(`Sheet "${sheetName}" has no data rows.`);
  const map = mapColumns(rows[0], sheetName);

  const sheetYear = /^Section8-FY(\d{2})$/.exec(sheetName);
  if (sheetYear && 2000 + Number(sheetYear[1]) !== map.fiscalYear) {
    throw invalid(`Sheet "${sheetName}" and its "${map.medianHeader}" column disagree about the fiscal year.`);
  }
  if (input.fiscalYear !== undefined && input.fiscalYear !== map.fiscalYear) {
    throw invalid(`Expected fiscal year ${input.fiscalYear} but the workbook's "${map.medianHeader}" column is for ${map.fiscalYear}.`);
  }

  const version = input.version ?? `hud-fy${map.fiscalYear}-${state.toLowerCase()}`;
  if (!VERSION_PATTERN.test(version) || !version.startsWith("hud-")) {
    throw invalid(`A HUD-derived table version must look like "hud-fy${map.fiscalYear}-${state.toLowerCase()}" (received "${version}").`);
  }

  const problems: string[] = [];
  const parsed: ParsedRow[] = [];
  const col = map.columns;

  for (const row of rows.slice(1)) {
    const cell = (index: number): XlsxCell => row.cells[index] ?? null;
    const text = (index: number): string | null => {
      const value = cell(index);
      return typeof value === "string" ? value.trim() : null;
    };
    const at = `row ${row.rowNumber}`;

    const stusps = text(col.stusps);
    const stateCode = text(col.state);
    if (stusps !== state) {
      // A row that carries this state's FIPS prefix under another postal code is a corrupt row, not another state's row.
      if (stateCode === stateFips) problems.push(`${at}: state FIPS is ${stateFips} but stusps is ${describeCell(cell(col.stusps))}`);
      continue;
    }

    const rowProblems: string[] = [];
    const expectText = (name: RequiredColumn, label: string): string => {
      const value = text(col[name]);
      if (value === null || value === "") {
        rowProblems.push(`${label} must be text, found ${describeCell(cell(col[name]))}`);
        return "";
      }
      return value;
    };
    const expectPositiveInteger = (index: number, label: string): number => {
      const value = cell(index);
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        rowProblems.push(`${label} must be a positive whole number, found ${describeCell(value)}`);
        return 0;
      }
      return value;
    };

    if (stateCode !== stateFips) rowProblems.push(`state must be "${stateFips}", found ${describeCell(cell(col.state))}`);
    const stateName = expectText("state_name", "state_name");
    if (stateName !== "" && stateName !== STATE_NAME[state]) rowProblems.push(`state_name must be "${STATE_NAME[state]}", found "${stateName}"`);

    const fips = expectText("fips", "fips");
    const county = expectText("county", "county");
    if (county !== "" && !/^\d{3}$/.test(county)) rowProblems.push(`county must be a 3-digit county FIPS code, found "${county}"`);
    if (fips !== "") {
      if (!/^\d{10}$/.test(fips)) rowProblems.push(`fips must be 10 digits, found "${fips}"`);
      else if (!fips.startsWith(stateFips)) rowProblems.push(`fips "${fips}" does not start with state FIPS ${stateFips}`);
      else if (fips.slice(5) !== "99999") rowProblems.push(`fips "${fips}" is not a whole-county row (expected the suffix 99999)`);
      else if (county !== "" && fips.slice(2, 5) !== county) rowProblems.push(`fips "${fips}" does not match county code "${county}"`);
    }

    const countyName = expectText("county_name", "County_Name");
    const townName = expectText("county_town_name", "county_town_name");
    if (countyName !== "" && townName !== "" && countyName !== townName) {
      rowProblems.push(`county_town_name "${townName}" differs from County_Name "${countyName}" (sub-county rows are not expected in ${STATE_NAME[state]})`);
    }

    const areaCode = expectText("hud_area_code", "hud_area_code");
    if (areaCode !== "" && !/^\S+$/.test(areaCode)) rowProblems.push(`hud_area_code must not contain spaces, found "${areaCode}"`);
    const areaName = expectText("hud_area_name", "hud_area_name");

    const metro = cell(col.metro);
    if (metro !== 0 && metro !== 1) rowProblems.push(`metro must be 0 or 1, found ${describeCell(metro)}`);

    const median = expectPositiveInteger(map.median, map.medianHeader);
    const l50 = VLI_COLUMNS.map((name) => expectPositiveInteger(col[name], name));
    const l50_4 = l50[3];
    const l80_4 = expectPositiveInteger(col.l80_4, "l80_4");
    for (let i = 1; i < l50.length; i++) {
      if (l50[i] > 0 && l50[i - 1] > 0 && l50[i] < l50[i - 1]) rowProblems.push(`${VLI_COLUMNS[i]} (${l50[i]}) is lower than ${VLI_COLUMNS[i - 1]} (${l50[i - 1]}); very-low-income limits must not decrease with family size`);
    }

    if (rowProblems.length > 0) {
      problems.push(...rowProblems.map((problem) => `${at}${countyName ? ` (${countyName})` : ""}: ${problem}`));
      continue;
    }
    parsed.push({ rowNumber: row.rowNumber, fips5: fips.slice(0, 5), countyName, areaCode, areaName, metro: metro === 1, median, l50_4, l80_4, l50 });
  }

  const byFips = new Map<string, ParsedRow>();
  const byName = new Map<string, ParsedRow>();
  for (const row of parsed) {
    const sameFips = byFips.get(row.fips5);
    if (sameFips) problems.push(`row ${row.rowNumber}: county FIPS ${row.fips5} already appears on row ${sameFips.rowNumber}`);
    else byFips.set(row.fips5, row);
    const sameName = byName.get(row.countyName);
    if (sameName && sameName.fips5 !== row.fips5) problems.push(`row ${row.rowNumber}: county name "${row.countyName}" already appears on row ${sameName.rowNumber} with a different FIPS code`);
    else byName.set(row.countyName, row);
  }

  const areas = new Map<string, { record: HudAreaRecord; firstRow: number; counties: number }>();
  for (const row of byFips.values()) {
    const record: HudAreaRecord = {
      code: row.areaCode,
      name: row.areaName,
      metro: row.metro,
      medianIncomeDollars: row.median,
      hudPublished: { veryLowIncome4PersonDollars: row.l50_4, lowIncome4PersonDollars: row.l80_4, veryLowIncomeBySizeDollars: row.l50 },
    };
    const existing = areas.get(row.areaCode);
    if (!existing) {
      areas.set(row.areaCode, { record, firstRow: row.rowNumber, counties: 1 });
      continue;
    }
    existing.counties += 1;
    const a = existing.record;
    const differences: string[] = [];
    if (a.name !== record.name) differences.push("hud_area_name");
    if (a.metro !== record.metro) differences.push("metro");
    if (a.medianIncomeDollars !== record.medianIncomeDollars) differences.push(map.medianHeader);
    VLI_COLUMNS.forEach((name, i) => {
      if (a.hudPublished.veryLowIncomeBySizeDollars[i] !== record.hudPublished.veryLowIncomeBySizeDollars[i]) differences.push(name);
    });
    if (a.hudPublished.lowIncome4PersonDollars !== record.hudPublished.lowIncome4PersonDollars) differences.push("l80_4");
    if (differences.length > 0) {
      problems.push(`row ${row.rowNumber} (${row.countyName}): area ${row.areaCode} has a different ${differences.join(", ")} than on row ${existing.firstRow}; counties in one area must share one set of figures`);
    }
  }

  if (byFips.size !== expectedCounties) {
    problems.push(`expected exactly ${expectedCounties} ${STATE_NAME[state]} counties, found ${byFips.size} valid, distinct county row${byFips.size === 1 ? "" : "s"}`);
  }
  if (problems.length > 0) failValidation(`HUD income-limit data for ${STATE_NAME[state]} (sheet "${sheetName}")`, problems);

  const sortedAreas = [...areas.values()].map((entry) => entry.record).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const sortedCounties = [...byFips.values()]
    .map((row) => ({ fips: row.fips5, name: row.countyName, areaCode: row.areaCode }))
    .sort((a, b) => (a.fips < b.fips ? -1 : a.fips > b.fips ? 1 : 0));

  const dataset: HudDerivedDataset = {
    schemaVersion: 1,
    version,
    source: "hud_provisional",
    method: METHOD_HUD_DERIVED,
    state,
    stateFips,
    fiscalYear: map.fiscalYear,
    effectiveDate: input.effectiveDate,
    effectiveDateCitation: input.effectiveDateCitation.trim(),
    sourceFile: { name: input.sourceFile.name, sha256: input.sourceFile.sha256, url: input.sourceFile.url },
    multipliers: {
      bySizeBps: [...HUD_FAMILY_SIZE_MULTIPLIERS.bySizeBps],
      additionalPersonBps: HUD_FAMILY_SIZE_MULTIPLIERS.additionalPersonBps,
      citation: HUD_FAMILY_SIZE_MULTIPLIERS.citation,
    },
    areas: sortedAreas,
    counties: sortedCounties,
  };
  // The same validation every table goes through when the application loads it.
  buildTable(dataset);

  const medians = sortedAreas.map((area) => area.medianIncomeDollars);
  return {
    dataset,
    stats: {
      sheetName,
      fiscalYear: map.fiscalYear,
      rowsInSheet: rows.length - 1,
      counties: sortedCounties.length,
      areas: sortedAreas.length,
      multiCountyAreas: [...areas.values()].filter((entry) => entry.counties > 1).length,
      minMedianDollars: Math.min(...medians),
      maxMedianDollars: Math.max(...medians),
    },
  };
}
