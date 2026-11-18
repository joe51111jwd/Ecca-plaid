import { parseCsv, toCsv } from "@/lib/csv";
import { invalid } from "@/lib/errors";
import { AMI_POLICY, EXPECTED_COUNTY_COUNT, MAX_TABULATED_FAMILY_SIZE, METHOD_IRS_PUBLISHED, STATE_FIPS, STATE_NAME } from "../constants";
import { buildTable, isIsoCalendarDate } from "../dataset";
import type { AmiSourceFile, AmiState, AmiTable, IrsAreaRecord, IrsPublishedDataset } from "../types";

/**
 * IRS limitation table, CSV contract `irs-limitation-csv-v1`.
 *
 * The IRS has said it anticipates publishing the section 25F limits by geographic area and family size in
 * the Internal Revenue Bulletin. Its layout is not known, so the published table is transcribed into this
 * CSV and the CSV is what gets ingested. The contract is strict on purpose: a transcription that is almost
 * right must fail, because a wrong limit is a wrong scholarship decision.
 *
 * One header row, then one row per geographic area or per county. Every column must be in the header, in
 * any order; only the last two may be left empty in a row:
 *
 *   area_code                    Identifier of the IRS geographic area: letters, digits, ".", "_", ":" and
 *                                "-", at most 64 characters. Use the HUD area code when the IRS area is the
 *                                HUD area; otherwise assign a stable code of your own.
 *   area_name                    The area name exactly as the IRS prints it.
 *   county_fips                  The 5-digit FIPS code of every Texas county the row covers, separated by
 *                                ";". One code for a per-county table; all of an area's counties for a
 *                                per-area table.
 *   county_name                  The county names for those codes, in the same order, separated by ";".
 *                                Checked against the reference county list so a mistyped code cannot pass.
 *   limit_1 ... limit_8          The published limit for family sizes 1 to 8, in dollars: digits only, with
 *                                an optional two-digit cents part ("312000" or "312000.00"). No "$", no
 *                                thousands separators.
 *   additional_person_increment  Dollars added per household member above eight, same format; leave empty
 *                                when the IRS publishes no figure. The engine then refuses households above
 *                                eight for the area instead of inventing a number.
 *   area_median_gross_income     The area median gross income in whole dollars when the IRS prints it next
 *                                to the limits; otherwise empty. Reference only; limits are never computed
 *                                from it.
 *
 * Rules: every Texas county appears exactly once across the file; rows that repeat an `area_code` (the
 * per-county layout of a multi-county area) must carry identical name, limits, increment and median; limits
 * may not decrease as family size grows; no missing or extra columns.
 */
export const IRS_CSV_CONTRACT = "irs-limitation-csv-v1";

const LIMIT_COLUMNS = ["limit_1", "limit_2", "limit_3", "limit_4", "limit_5", "limit_6", "limit_7", "limit_8"] as const;

export const IRS_CSV_COLUMNS = ["area_code", "area_name", "county_fips", "county_name", ...LIMIT_COLUMNS, "additional_person_increment", "area_median_gross_income"] as const;

type IrsCsvColumn = (typeof IRS_CSV_COLUMNS)[number];

/** IRS table versions are `irs-<year>` with an optional suffix for a correction, e.g. `irs-2027` or `irs-2027-rev1`. */
export const IRS_VERSION_PATTERN = /^irs-\d{4}(?:-[a-z0-9]+)*$/;

const AREA_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const DOLLARS_PATTERN = /^(\d{1,13})(?:\.(\d{2}))?$/;
const WHOLE_DOLLARS_PATTERN = /^\d{1,13}$/;
const MAX_REPORTED_PROBLEMS = 40;

export interface IrsIngestInput {
  /** Text of the transcription CSV. */
  csv: string;
  state: AmiState;
  /** Table version id, `irs-<year>`. */
  version: string;
  /** YYYY-MM-DD the published limits take effect. */
  effectiveDate: string;
  /** Internal Revenue Bulletin citation; null when not supplied (the labels then cite the Bulletin generically). */
  citation: string | null;
  sourceFile: AmiSourceFile;
  /** The canonical county list the transcription must cover exactly; taken from an installed HUD-derived table. */
  referenceCounties: ReadonlyArray<{ fips: string; name: string }>;
}

export interface IrsIngestStats {
  rows: number;
  counties: number;
  areas: number;
  areasWithoutIncrement: number;
}

export interface IrsIngestResult {
  dataset: IrsPublishedDataset;
  stats: IrsIngestStats;
}

function parseDollarsToCents(value: string): number | null {
  const match = DOLLARS_PATTERN.exec(value);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number(match[2] ?? "0");
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function failValidation(problems: string[]): never {
  const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
  const more = problems.length > shown.length ? ` (and ${problems.length - shown.length} more)` : "";
  throw invalid(`IRS limitation table CSV failed validation with ${problems.length} problem${problems.length === 1 ? "" : "s"}${more}:\n  - ${shown.join("\n  - ")}`, { problems });
}

export function buildIrsDataset(input: IrsIngestInput): IrsIngestResult {
  const state = input.state;
  const stateFips = STATE_FIPS[state];
  const expectedCounties = EXPECTED_COUNTY_COUNT[state];
  if (stateFips === undefined || expectedCounties === undefined) throw invalid(`State ${String(state)} is not supported; the income engine covers Texas (TX) only.`);
  if (!IRS_VERSION_PATTERN.test(input.version)) throw invalid(`An IRS table version must look like "irs-<year>", for example irs-2027 (received "${input.version}").`);
  if (!isIsoCalendarDate(input.effectiveDate)) throw invalid(`Effective date must be a calendar date written YYYY-MM-DD (received "${input.effectiveDate}").`);
  const citation = input.citation === null ? null : input.citation.trim();
  if (citation === "") throw invalid("The citation must not be empty when it is given.");

  const reference = new Map<string, string>();
  for (const county of input.referenceCounties) reference.set(county.fips, county.name);
  if (reference.size !== expectedCounties || input.referenceCounties.length !== expectedCounties) {
    throw invalid(`The reference county list must hold exactly ${expectedCounties} ${STATE_NAME[state]} counties (it has ${reference.size}).`);
  }

  const table = parseCsv(input.csv);
  if (table.length === 0) throw invalid("IRS limitation table CSV is empty.");
  const header = table[0].map((name) => name.trim());
  const headerProblems: string[] = [];
  const position = new Map<string, number>();
  header.forEach((name, index) => {
    if (position.has(name)) headerProblems.push(`column "${name}" appears more than once`);
    position.set(name, index);
  });
  for (const name of IRS_CSV_COLUMNS) if (!position.has(name)) headerProblems.push(`required column "${name}" is missing`);
  for (const name of header) if (!(IRS_CSV_COLUMNS as readonly string[]).includes(name)) headerProblems.push(`unexpected column "${name}"`);
  if (headerProblems.length > 0) failValidation(headerProblems.map((problem) => `header: ${problem}`));
  if (table.length === 1) throw invalid("IRS limitation table CSV has a header but no data rows.");

  const problems: string[] = [];
  const areas = new Map<string, { record: IrsAreaRecord; firstLine: number }>();
  const countyArea = new Map<string, { areaCode: string; line: number }>();

  table.slice(1).forEach((cells, index) => {
    // Line numbers count records (header = 1); a quoted field with a line break makes them differ from file lines.
    const line = index + 2;
    const at = `row ${line}`;
    if (cells.length !== header.length) {
      problems.push(`${at}: has ${cells.length} fields, expected ${header.length}`);
      return;
    }
    const get = (name: IrsCsvColumn): string => cells[position.get(name)!].trim();
    const rowProblems: string[] = [];

    const areaCode = get("area_code");
    if (!AREA_CODE_PATTERN.test(areaCode)) rowProblems.push(`area_code "${areaCode}" must be 1 to 64 letters, digits, ".", "_", ":" or "-"`);
    const areaName = get("area_name");
    if (areaName === "") rowProblems.push("area_name is empty");

    const fipsCodes = get("county_fips")
      .split(";")
      .map((code) => code.trim());
    const names = get("county_name")
      .split(";")
      .map((name) => name.trim());
    if (fipsCodes.length === 1 && fipsCodes[0] === "") rowProblems.push("county_fips is empty");
    else if (names.length !== fipsCodes.length) rowProblems.push(`county_name lists ${names.length} name${names.length === 1 ? "" : "s"} for ${fipsCodes.length} county FIPS code${fipsCodes.length === 1 ? "" : "s"}`);
    else {
      fipsCodes.forEach((fips, i) => {
        if (!/^\d{5}$/.test(fips)) rowProblems.push(`county_fips "${fips}" is not a 5-digit FIPS code`);
        else if (!fips.startsWith(stateFips)) rowProblems.push(`county_fips ${fips} is not a ${STATE_NAME[state]} county`);
        else if (!reference.has(fips)) rowProblems.push(`county_fips ${fips} is not a ${STATE_NAME[state]} county in the reference list`);
        else if (reference.get(fips) !== names[i]) rowProblems.push(`county_name "${names[i]}" does not match county_fips ${fips} (${reference.get(fips)})`);
      });
      if (new Set(fipsCodes).size !== fipsCodes.length) rowProblems.push("county_fips lists a county more than once");
    }

    const limitCents: number[] = [];
    for (const column of LIMIT_COLUMNS) {
      const cents = parseDollarsToCents(get(column));
      if (cents === null) rowProblems.push(`${column} "${get(column)}" is not a positive dollar amount written with digits only (for example 312000 or 312000.00)`);
      else limitCents.push(cents);
    }
    if (AMI_POLICY.irsLimitsMustNotDecreaseWithFamilySize && limitCents.length === MAX_TABULATED_FAMILY_SIZE) {
      for (let size = 2; size <= MAX_TABULATED_FAMILY_SIZE; size++) {
        if (limitCents[size - 1] < limitCents[size - 2]) rowProblems.push(`limit_${size} is lower than limit_${size - 1}; limits may not decrease as family size grows`);
      }
    }

    const incrementText = get("additional_person_increment");
    let additionalPersonCents: number | null = null;
    if (incrementText !== "") {
      additionalPersonCents = parseDollarsToCents(incrementText);
      if (additionalPersonCents === null) rowProblems.push(`additional_person_increment "${incrementText}" is not a positive dollar amount written with digits only`);
    }

    const medianText = get("area_median_gross_income");
    let medianIncomeDollars: number | null = null;
    if (medianText !== "") {
      medianIncomeDollars = WHOLE_DOLLARS_PATTERN.test(medianText) && Number(medianText) > 0 ? Number(medianText) : null;
      if (medianIncomeDollars === null) rowProblems.push(`area_median_gross_income "${medianText}" is not a positive whole-dollar amount written with digits only`);
    }

    if (rowProblems.length > 0) {
      problems.push(...rowProblems.map((problem) => `${at}${areaName ? ` (${areaName})` : ""}: ${problem}`));
      return;
    }

    const record: IrsAreaRecord = { code: areaCode, name: areaName, limitCents, additionalPersonCents, medianIncomeDollars };
    const existing = areas.get(areaCode);
    if (!existing) areas.set(areaCode, { record, firstLine: line });
    else {
      const a = existing.record;
      const differences: string[] = [];
      if (a.name !== record.name) differences.push("area_name");
      if (!sameNumbers(a.limitCents, record.limitCents)) differences.push("limits");
      if (a.additionalPersonCents !== record.additionalPersonCents) differences.push("additional_person_increment");
      if (a.medianIncomeDollars !== record.medianIncomeDollars) differences.push("area_median_gross_income");
      if (differences.length > 0) problems.push(`${at} (${areaName}): area_code ${areaCode} has a different ${differences.join(", ")} than on row ${existing.firstLine}; rows of one area must be identical`);
    }
    for (const fips of fipsCodes) {
      const seen = countyArea.get(fips);
      if (seen) problems.push(`${at}: county ${fips} (${reference.get(fips)}) already appears on row ${seen.line}`);
      else countyArea.set(fips, { areaCode, line });
    }
  });

  const missing = [...reference.keys()].filter((fips) => !countyArea.has(fips)).sort();
  if (missing.length > 0) {
    const shown = missing.slice(0, 12).map((fips) => `${fips} ${reference.get(fips)}`);
    problems.push(
      `the table must cover all ${expectedCounties} ${STATE_NAME[state]} counties; ${missing.length} ${missing.length === 1 ? "is" : "are"} missing: ${shown.join(", ")}${missing.length > shown.length ? ", ..." : ""}`,
    );
  }
  if (problems.length > 0) failValidation(problems);

  const sortedAreas = [...areas.values()].map((entry) => entry.record).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const sortedCounties = [...countyArea.entries()]
    .map(([fips, entry]) => ({ fips, name: reference.get(fips)!, areaCode: entry.areaCode }))
    .sort((a, b) => (a.fips < b.fips ? -1 : a.fips > b.fips ? 1 : 0));

  const dataset: IrsPublishedDataset = {
    schemaVersion: 1,
    version: input.version,
    source: "irs_published",
    method: METHOD_IRS_PUBLISHED,
    state,
    stateFips,
    effectiveDate: input.effectiveDate,
    citation,
    contract: IRS_CSV_CONTRACT,
    sourceFile: { name: input.sourceFile.name, sha256: input.sourceFile.sha256, url: input.sourceFile.url },
    areas: sortedAreas,
    counties: sortedCounties,
  };
  buildTable(dataset);

  return {
    dataset,
    stats: {
      rows: table.length - 1,
      counties: sortedCounties.length,
      areas: sortedAreas.length,
      areasWithoutIncrement: sortedAreas.filter((area) => area.additionalPersonCents === null).length,
    },
  };
}

/**
 * Double-entry check: compares two transcriptions of the same IRS table, county by county. Returns one line
 * per difference (limits for family sizes 1 to 8, the per-person increment, the median, the area name and
 * code); an empty list means the two people read the same numbers.
 */
export function compareIrsTranscriptions(first: AmiTable, second: AmiTable): string[] {
  const differences: string[] = [];
  if (first.dataset.source !== "irs_published" || second.dataset.source !== "irs_published") {
    throw invalid("Both tables must be IRS-published transcriptions.");
  }
  const dollars = (cents: number | null): string => (cents === null ? "(empty)" : (cents / 100).toFixed(2));
  for (const county of first.dataset.counties) {
    const label = `${county.fips} ${county.name}`;
    const other = second.countyByFips.get(county.fips);
    if (!other) {
      differences.push(`${label}: missing from the second transcription`);
      continue;
    }
    const a = first.areaByCode.get(county.areaCode) as IrsAreaRecord;
    const b = second.areaByCode.get(other.areaCode) as IrsAreaRecord;
    for (let size = 1; size <= MAX_TABULATED_FAMILY_SIZE; size++) {
      if (a.limitCents[size - 1] !== b.limitCents[size - 1]) {
        differences.push(`${label}, household of ${size}: ${dollars(a.limitCents[size - 1])} in ${first.version}, ${dollars(b.limitCents[size - 1])} in the second transcription`);
      }
    }
    if (a.additionalPersonCents !== b.additionalPersonCents) {
      differences.push(`${label}, additional_person_increment: ${dollars(a.additionalPersonCents)} in ${first.version}, ${dollars(b.additionalPersonCents)} in the second transcription`);
    }
    if (a.medianIncomeDollars !== b.medianIncomeDollars) {
      differences.push(`${label}, area_median_gross_income: ${a.medianIncomeDollars ?? "(empty)"} in ${first.version}, ${b.medianIncomeDollars ?? "(empty)"} in the second transcription`);
    }
    if (a.name !== b.name) differences.push(`${label}, area_name: "${a.name}" in ${first.version}, "${b.name}" in the second transcription`);
    if (a.code !== b.code) differences.push(`${label}, area_code: ${a.code} in ${first.version}, ${b.code} in the second transcription`);
  }
  for (const county of second.dataset.counties) {
    if (!first.countyByFips.has(county.fips)) differences.push(`${county.fips} ${county.name}: only in the second transcription`);
  }
  return differences;
}

export type IrsTemplateLayout = "area" | "county";

/**
 * A transcription template: the contract's header and one row per area (or per county) with the geography
 * filled in from an installed table and every limit left empty. Limits are never pre-filled, so a provisional
 * number can never be mistaken for a transcribed one.
 */
export function renderIrsCsvTemplate(reference: AmiTable, layout: IrsTemplateLayout): string {
  const blanks = Object.fromEntries([...LIMIT_COLUMNS, "additional_person_increment", "area_median_gross_income"].map((column) => [column, ""]));
  const rows: Array<Record<string, string>> = [];
  if (layout === "area") {
    for (const area of reference.dataset.areas) {
      const fipsCodes = reference.countyFipsByArea.get(area.code) ?? [];
      rows.push({
        area_code: area.code,
        area_name: area.name,
        county_fips: fipsCodes.join(";"),
        county_name: fipsCodes.map((fips) => reference.countyByFips.get(fips)!.name).join(";"),
        ...blanks,
      });
    }
  } else {
    for (const county of reference.dataset.counties) {
      rows.push({ area_code: county.areaCode, area_name: reference.areaByCode.get(county.areaCode)!.name, county_fips: county.fips, county_name: county.name, ...blanks });
    }
  }
  return toCsv([...IRS_CSV_COLUMNS], rows);
}
