/**
 * Types for the Texas income engine: the versioned area-median-income datasets in `data/ami/` and the
 * results the engine computes from them.
 */

/** Where a threshold comes from. `hud_provisional` results must be labeled provisional on every surface. */
export type ThresholdSource = "hud_provisional" | "irs_published";

/**
 * How a table turns into a limit.
 *  - `hud_median_x_cap_pct_x_family_size_multiplier_v1`: computed, cap% x area median x HUD family-size multiplier.
 *  - `irs_published_limit_by_family_size_v1`: explicit limits transcribed from the IRS table; nothing is computed
 *    except an SGO's stricter cap and the published per-person increment above eight persons.
 */
export type ThresholdMethod = "hud_median_x_cap_pct_x_family_size_multiplier_v1" | "irs_published_limit_by_family_size_v1";

/** The only state the engine covers today. Adding a state is a data + validation change, not a type cast. */
export type AmiState = "TX";

/* ----------------------------------------------------------------- dataset files */

export interface AmiSourceFile {
  /** File name as published or as transcribed (never a local path). */
  name: string;
  /** SHA-256 of the exact bytes that were ingested, lower-case hex. */
  sha256: string;
  /** Where the file came from; null when a transcription has no URL. */
  url: string | null;
}

/** Family-size adjustments as versioned data (the proposed rule calls its table the "current" HUD multipliers). */
export interface FamilySizeMultipliers {
  /** Multipliers for family sizes 1..8 in basis points (10000 = 1.00). Index 0 is a one-person household. */
  bySizeBps: readonly number[];
  /** Added for each household member above eight, in basis points. */
  additionalPersonBps: number;
  citation: string;
}

export interface AmiCountyRecord {
  /** 5-digit state + county FIPS code, e.g. "48201". */
  fips: string;
  /** County name exactly as published, e.g. "Harris County". */
  name: string;
  areaCode: string;
}

export interface HudAreaRecord {
  /** HUD's area code, an opaque key, e.g. "METRO26420M26420". */
  code: string;
  name: string;
  /** HUD's flag: the area is in a Metropolitan Statistical Area. Metadata only; it plays no part in the limit. */
  metro: boolean;
  /** HUD area median family income (four-person basis), whole dollars, not adjusted for family size. */
  medianIncomeDollars: number;
  /**
   * HUD's own published four-person limits, kept for reference and cross-checks only. They are capped,
   * floored and rounded by HUD and are NOT inputs to the section 25F limit.
   */
  hudPublished: { veryLowIncome4PersonDollars: number; lowIncome4PersonDollars: number };
}

export interface IrsAreaRecord {
  /** Area identifier from the transcription (the HUD area code when the IRS uses HUD areas). */
  code: string;
  /** Area name exactly as printed by the IRS. */
  name: string;
  /** Published limits for family sizes 1..8 in cents. Index 0 is a one-person household. */
  limitCents: readonly number[];
  /** Published increase per household member above eight, in cents; null when the table gives none. */
  additionalPersonCents: number | null;
  /** Area median gross income in whole dollars when the IRS prints it next to the limits; otherwise null. */
  medianIncomeDollars: number | null;
}

interface AmiDatasetBase {
  schemaVersion: 1;
  /** Table version id, also the file name: `data/ami/<version>.json`. */
  version: string;
  state: AmiState;
  stateFips: string;
  /** Date the figures took effect, YYYY-MM-DD. */
  effectiveDate: string;
  sourceFile: AmiSourceFile;
  counties: AmiCountyRecord[];
}

/** Provisional table derived from HUD Section 8 income-limit data. Thresholds are computed, never stored. */
export interface HudDerivedDataset extends AmiDatasetBase {
  source: "hud_provisional";
  method: "hud_median_x_cap_pct_x_family_size_multiplier_v1";
  fiscalYear: number;
  /** Where the effective date is stated (the data file itself does not carry it). */
  effectiveDateCitation: string;
  multipliers: FamilySizeMultipliers;
  areas: HudAreaRecord[];
}

/** Limitation table published by the IRS, transcribed through the CSV contract. Thresholds are explicit. */
export interface IrsPublishedDataset extends AmiDatasetBase {
  source: "irs_published";
  method: "irs_published_limit_by_family_size_v1";
  /** Internal Revenue Bulletin citation, e.g. the notice or revenue procedure number; null when not supplied. */
  citation: string | null;
  /** Version of the CSV contract the transcription followed. */
  contract: "irs-limitation-csv-v1";
  areas: IrsAreaRecord[];
}

export type AmiDataset = HudDerivedDataset | IrsPublishedDataset;

/* ------------------------------------------------------------------ runtime view */

export interface AmiCounty {
  fips: string;
  name: string;
  areaCode: string;
  areaName: string;
}

export interface AmiArea {
  code: string;
  name: string;
  /** Null when the table does not say (IRS tables). */
  metro: boolean | null;
  /** Area median (four-person basis) in cents; null when an IRS table does not print it. */
  medianIncomeCents: number | null;
  /** FIPS codes of the counties in this area, ascending. */
  countyFips: string[];
  /** HUD's own published four-person limits in cents (reference only); null for IRS tables. */
  hudPublished: { veryLowIncome4PersonCents: number; lowIncome4PersonCents: number } | null;
}

/** A validated, indexed table. Obtain one from the registry (`getActiveTable`, `getTable`) or `buildTable`. */
export interface AmiTable {
  readonly version: string;
  readonly source: ThresholdSource;
  readonly method: ThresholdMethod;
  readonly state: AmiState;
  readonly stateFips: string;
  readonly effectiveDate: string;
  /** True while the table is HUD-derived. Mirrors `source === "hud_provisional"`. */
  readonly provisional: boolean;
  readonly dataset: AmiDataset;
  readonly countyByFips: ReadonlyMap<string, AmiCountyRecord>;
  readonly areaByCode: ReadonlyMap<string, HudAreaRecord | IrsAreaRecord>;
  readonly countyFipsByArea: ReadonlyMap<string, readonly string[]>;
}

export interface AmiTableSummary {
  version: string;
  source: ThresholdSource;
  method: ThresholdMethod;
  state: AmiState;
  effectiveDate: string;
  provisional: boolean;
  active: boolean;
  countyCount: number;
  areaCount: number;
}

/* ----------------------------------------------------------------------- results */

export interface GetThresholdInput {
  /** 5-digit county FIPS code, e.g. "48201". Resolve addresses and ZIP codes to a county before calling. */
  countyFips: string;
  /** Number of persons in the household, including the student. Integer >= 1. */
  householdSize: number;
  /** Percent of area median the limit is set at. Integer 1..300; omitted (or null) means the statutory 300. */
  capPct?: number;
  /** Table to use; defaults to the active table. */
  table?: AmiTable;
}

/**
 * `details.reason` of the `validation_failed` AppError thrown by `getThreshold` and `thresholdRow`.
 * `household_size_not_published` is not bad input: the IRS table in use prints no limit for that household
 * size, so the case belongs in manual review.
 */
export type ThresholdErrorReason =
  | "malformed_county_fips"
  | "county_outside_state"
  | "unknown_county"
  | "invalid_household_size"
  | "invalid_cap_pct"
  | "household_size_not_published";

export interface ThresholdResult {
  /** The limit at `capPct`, in cents. A household passes when its income is less than or equal to this. */
  thresholdCents: number;
  /** The limit at the statutory 300 percent, in cents. Equal to `thresholdCents` when `capPct` is 300. */
  statutoryThresholdCents: number;
  /** Area median (four-person basis) in cents; null when an IRS table does not print it. */
  medianIncomeCents: number | null;
  /** Family-size multiplier in basis points (10000 = 1.00); null for explicit IRS tables. */
  multiplierBps: number | null;
  /** The same multiplier as a decimal string ("1.08"), for evidence records that must not carry floats. */
  multiplier: string | null;
  capPct: number;
  householdSize: number;
  area: { code: string; name: string; metro: boolean | null };
  county: { fips: string; name: string };
  source: ThresholdSource;
  tableVersion: string;
  effectiveDate: string;
  provisional: boolean;
  method: ThresholdMethod;
  /** The arithmetic in words and numbers, ready to print. */
  formula: string;
  /**
   * False only when the exact product was not a whole number of cents and was floored (see `threshold.ts`).
   * Always true for HUD-derived tables at the statutory 300 percent.
   */
  exact: boolean;
}

export interface ThresholdRow {
  county: { fips: string; name: string };
  area: { code: string; name: string; metro: boolean | null };
  medianIncomeCents: number | null;
  capPct: number;
  source: ThresholdSource;
  tableVersion: string;
  effectiveDate: string;
  provisional: boolean;
  method: ThresholdMethod;
  /** One entry per household size 1..8, in order. */
  thresholds: Array<{ householdSize: number; thresholdCents: number; statutoryThresholdCents: number; multiplierBps: number | null }>;
}

export type ThresholdCopyLocale = "en" | "es";

/** The wording every surface shows next to a threshold. Do not paraphrase these strings in components. */
export interface ThresholdSourceDescription {
  copyVersion: string;
  locale: ThresholdCopyLocale;
  source: ThresholdSource;
  provisional: boolean;
  tableVersion: string;
  effectiveDate: string;
  /** Short status chip: "Provisional" or "IRS-published". */
  badge: string;
  /** Field label for the number itself. */
  limitLabel: string;
  /** One line naming the source and effective date (API descriptions, dashboard rows, PDF tables). */
  sourceLine: string;
  /** Full explanation of where the number comes from (PDF, detail pages). */
  explanation: string;
  /** Plain-language sentence for family-facing screens. */
  familyNote: string;
}
