import { z } from "zod";
import { AppError } from "@/lib/errors";
import { AMI_POLICY, EXPECTED_COUNTY_COUNT, MAX_TABULATED_FAMILY_SIZE, METHOD_HUD_DERIVED, METHOD_IRS_PUBLISHED, STATE_FIPS } from "./constants";
import type { AmiCountyRecord, AmiDataset, AmiTable, HudAreaRecord, IrsAreaRecord } from "./types";

/**
 * Validation of dataset files (`data/ami/<version>.json`) and construction of the indexed runtime table.
 *
 * Every table that reaches the engine passes through `buildTable`, whether it was just produced by the
 * ingest or is loaded from the repository, so a hand-edited or truncated file fails here instead of
 * producing a wrong threshold.
 */

export const VERSION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COUNTY_FIPS_PATTERN = /^\d{5}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoCalendarDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Thirteen digits: any dollar amount in a dataset converts to cents without leaving the safe-integer range. */
const MAX_DOLLARS = 9_999_999_999_999;
const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const wholeDollars = z.number().int().positive().max(MAX_DOLLARS);
const nonEmptyText = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), "must not have leading or trailing whitespace");

const sourceFileSchema = z.strictObject({
  name: nonEmptyText,
  sha256: z.string().regex(SHA256_PATTERN, "must be 64 lower-case hex characters"),
  url: z.string().url().nullable(),
});

const countySchema = z.strictObject({
  fips: z.string().regex(COUNTY_FIPS_PATTERN, "must be a 5-digit state + county FIPS code"),
  name: nonEmptyText,
  areaCode: nonEmptyText,
});

const baseShape = {
  schemaVersion: z.literal(1),
  version: z.string().regex(VERSION_PATTERN, "must be lower-case letters, digits and single hyphens"),
  state: z.literal("TX"),
  stateFips: z.string().regex(/^\d{2}$/),
  effectiveDate: z.string().refine(isIsoCalendarDate, "must be a calendar date written YYYY-MM-DD"),
  sourceFile: sourceFileSchema,
  counties: z.array(countySchema).min(1),
};

const hudDatasetSchema = z.strictObject({
  ...baseShape,
  source: z.literal("hud_provisional"),
  method: z.literal(METHOD_HUD_DERIVED),
  fiscalYear: z.number().int().min(2000).max(2999),
  effectiveDateCitation: nonEmptyText,
  multipliers: z.strictObject({
    bySizeBps: z.array(positiveInt).length(MAX_TABULATED_FAMILY_SIZE),
    additionalPersonBps: positiveInt,
    citation: nonEmptyText,
  }),
  areas: z
    .array(
      z.strictObject({
        code: nonEmptyText,
        name: nonEmptyText,
        metro: z.boolean(),
        medianIncomeDollars: wholeDollars,
        hudPublished: z.strictObject({ veryLowIncome4PersonDollars: wholeDollars, lowIncome4PersonDollars: wholeDollars }),
      }),
    )
    .min(1),
});

const irsDatasetSchema = z.strictObject({
  ...baseShape,
  source: z.literal("irs_published"),
  method: z.literal(METHOD_IRS_PUBLISHED),
  citation: nonEmptyText.nullable(),
  contract: z.literal("irs-limitation-csv-v1"),
  areas: z
    .array(
      z.strictObject({
        code: nonEmptyText,
        name: nonEmptyText,
        limitCents: z.array(positiveInt).length(MAX_TABULATED_FAMILY_SIZE),
        additionalPersonCents: positiveInt.nullable(),
        medianIncomeDollars: wholeDollars.nullable(),
      }),
    )
    .min(1),
});

const datasetSchema = z.discriminatedUnion("source", [hudDatasetSchema, irsDatasetSchema]);

function firstUnsorted(values: readonly string[]): string | null {
  for (let i = 1; i < values.length; i++) {
    if (!(values[i - 1] < values[i])) return values[i];
  }
  return null;
}

function crossFieldProblems(dataset: AmiDataset, requireAllCounties: boolean): string[] {
  const problems: string[] = [];
  const expectedStateFips = STATE_FIPS[dataset.state];
  if (dataset.stateFips !== expectedStateFips) problems.push(`stateFips must be ${expectedStateFips} for ${dataset.state}`);

  const areaCodes = new Set<string>();
  for (const area of dataset.areas) {
    if (areaCodes.has(area.code)) problems.push(`area ${area.code} is listed more than once`);
    areaCodes.add(area.code);
  }
  const unsortedArea = firstUnsorted(dataset.areas.map((a) => a.code));
  if (unsortedArea !== null && areaCodes.size === dataset.areas.length) problems.push(`areas must be sorted by code (out of order at ${unsortedArea})`);

  const countyFips = new Set<string>();
  const areasWithCounties = new Set<string>();
  for (const county of dataset.counties) {
    if (countyFips.has(county.fips)) problems.push(`county ${county.fips} is listed more than once`);
    countyFips.add(county.fips);
    if (!county.fips.startsWith(dataset.stateFips)) problems.push(`county ${county.fips} is not in state ${dataset.stateFips}`);
    if (!areaCodes.has(county.areaCode)) problems.push(`county ${county.fips} refers to unknown area ${county.areaCode}`);
    areasWithCounties.add(county.areaCode);
  }
  const unsortedCounty = firstUnsorted(dataset.counties.map((c) => c.fips));
  if (unsortedCounty !== null && countyFips.size === dataset.counties.length) problems.push(`counties must be sorted by FIPS code (out of order at ${unsortedCounty})`);
  for (const code of areaCodes) {
    if (!areasWithCounties.has(code)) problems.push(`area ${code} has no counties`);
  }

  if (requireAllCounties && countyFips.size !== EXPECTED_COUNTY_COUNT[dataset.state]) {
    problems.push(`expected exactly ${EXPECTED_COUNTY_COUNT[dataset.state]} ${dataset.state} counties, found ${countyFips.size}`);
  }

  if (dataset.source === "hud_provisional") {
    const bps = dataset.multipliers.bySizeBps;
    for (let i = 1; i < bps.length; i++) {
      if (!(bps[i] > bps[i - 1])) problems.push(`family-size multipliers must increase with family size (size ${i + 1})`);
    }
  } else if (AMI_POLICY.irsLimitsMustNotDecreaseWithFamilySize) {
    for (const area of dataset.areas) {
      for (let i = 1; i < area.limitCents.length; i++) {
        if (area.limitCents[i] < area.limitCents[i - 1]) problems.push(`area ${area.code}: the limit for ${i + 1} persons is lower than the limit for ${i} persons`);
      }
    }
  }
  return problems;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export interface BuildTableOptions {
  /**
   * Require the full county count for the state (254 for Texas). On by default; turned off only for small
   * synthetic tables in tests.
   */
  requireAllCounties?: boolean;
}

/** Validates a parsed dataset file and returns the indexed table. Throws an `internal` AppError listing every problem. */
export function buildTable(raw: unknown, options: BuildTableOptions = {}): AmiTable {
  const parsed = datasetSchema.safeParse(raw);
  const label = typeof raw === "object" && raw !== null && typeof (raw as { version?: unknown }).version === "string" ? (raw as { version: string }).version : "(unknown version)";
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new AppError("internal", `AMI dataset ${label} is not valid: ${problems.slice(0, 10).join("; ")}`, { problems });
  }
  // `parsed.data` is zod's own copy, so freezing it leaves the caller's object alone and makes the table
  // immutable: no module can change a median or a limit after validation.
  const dataset: AmiDataset = deepFreeze(parsed.data);
  const problems = crossFieldProblems(dataset, options.requireAllCounties ?? true);
  if (problems.length > 0) {
    throw new AppError("internal", `AMI dataset ${dataset.version} is not valid: ${problems.slice(0, 10).join("; ")}`, { problems });
  }

  const countyByFips = new Map<string, AmiCountyRecord>();
  const countyFipsByArea = new Map<string, string[]>();
  for (const county of dataset.counties) {
    countyByFips.set(county.fips, county);
    const list = countyFipsByArea.get(county.areaCode);
    if (list) list.push(county.fips);
    else countyFipsByArea.set(county.areaCode, [county.fips]);
  }
  const areaByCode = new Map<string, HudAreaRecord | IrsAreaRecord>();
  for (const area of dataset.areas) areaByCode.set(area.code, area);

  return {
    version: dataset.version,
    source: dataset.source,
    method: dataset.method,
    state: dataset.state,
    stateFips: dataset.stateFips,
    effectiveDate: dataset.effectiveDate,
    provisional: dataset.source === "hud_provisional",
    dataset,
    countyByFips,
    areaByCode,
    countyFipsByArea,
  };
}

const activePointerSchema = z.strictObject({ activeVersion: z.string().regex(VERSION_PATTERN) });

/** Parses `data/ami/active.json`. */
export function parseActivePointer(raw: unknown): { activeVersion: string } {
  const parsed = activePointerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("internal", 'AMI active pointer is not valid: expected { "activeVersion": "<table version>" }');
  }
  return parsed.data;
}
