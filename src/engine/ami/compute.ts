import { invalid } from "@/lib/errors";
import { BASIS_POINTS, HUD_FAMILY_SIZE_MULTIPLIERS, MAX_TABULATED_FAMILY_SIZE, MIN_CAP_PCT, STATE_NAME, STATUTORY_CAP_PCT } from "./constants";
import { formatExactUsd, formatMultiplier, formatWholeUsd } from "./format";
import type {
  AmiArea,
  AmiCounty,
  AmiCountyRecord,
  AmiTable,
  FamilySizeMultipliers,
  HudAreaRecord,
  IrsAreaRecord,
  ThresholdErrorReason,
  ThresholdResult,
  ThresholdRow,
} from "./types";

/**
 * The section 25F household income limit for a Texas county and household size, computed from an explicit
 * table. This module never reads the registry, so the ingest command can use it on tables that are not
 * installed yet. The public entry points with the active table as the default are in `threshold.ts`.
 *
 * HUD-derived (provisional) tables: the limit is computed as described in the economic analysis of the
 * proposed regulations (REG-117199-25), "the product of 300 percent of the area median gross income and the
 * HUD family-size multiplier":
 *
 *     limit = cap% x area median x multiplier(household size)
 *
 * with the rule's own example: a median of $100,000 gives $270,000 for three persons and $300,000 for four.
 *
 * ARITHMETIC. Everything is integer math in BigInt: cents = medianDollars x capPct x multiplierBps / 10,000.
 * NO ROUNDING IS APPLIED to the product. That is deliberate:
 *  - the proposed rule states the product and shows unrounded examples; it states no rounding step;
 *  - HUD rounds its own published Section 8 limits UP to the nearest $50 (and caps and floors them year over
 *    year), so HUD's `l50` columns are not the area median times a multiplier. That is why this engine
 *    multiplies the median itself and does not reuse `l50 x 6`.
 * At the statutory 300 percent the product is always a whole number of cents for any whole-dollar median,
 * because every multiplier is a whole number of hundredths. HUD publishes its medians in whole hundreds of
 * dollars, so for HUD data the product is a whole number of dollars at 300 percent and a whole number of
 * cents at every whole-percent cap. For other inputs a stricter SGO cap can put the exact product between
 * two cents; it is then floored to the cent and `exact` is false. Flooring cannot change an outcome: income
 * is a whole number of cents and the test is "income <= limit".
 *
 * IRS-published tables: the limit is the published figure for the area and household size. Above eight
 * persons it is the eight-person limit plus the published per-person increment; if the table publishes no
 * increment the engine refuses rather than invent one. A stricter SGO cap scales the published 300-percent
 * limit proportionally (limit x cap / 300), floored to the cent as above.
 *
 * The points on which the sources are silent (flooring, the cap on a published table, the refusal above
 * eight) are listed as `AMI_POLICY` in `constants.ts`. The citations, and the open question whether the IRS
 * will build its table from the raw median or from HUD's adjusted limits, are in
 * `docs/reference/hud-ami-and-annual-income.md` (F29, F30, F38, open question 1).
 */

function fail(field: "countyFips" | "householdSize" | "capPct", reason: ThresholdErrorReason, message: string): never {
  throw invalid(message, { reason, fields: { [field]: message } });
}

function describeValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function assertHouseholdSize(householdSize: unknown): asserts householdSize is number {
  if (typeof householdSize !== "number" || !Number.isSafeInteger(householdSize) || householdSize < 1) {
    fail("householdSize", "invalid_household_size", `Household size must be a whole number of at least 1 (received ${describeValue(householdSize)}).`);
  }
}

function assertCapPct(capPct: unknown): asserts capPct is number {
  if (typeof capPct !== "number" || !Number.isInteger(capPct) || capPct < MIN_CAP_PCT || capPct > STATUTORY_CAP_PCT) {
    fail(
      "capPct",
      "invalid_cap_pct",
      `Income cap must be a whole percent from ${MIN_CAP_PCT} to ${STATUTORY_CAP_PCT} of area median income (received ${describeValue(capPct)}). An SGO may set a stricter cap, never one above ${STATUTORY_CAP_PCT} percent.`,
    );
  }
}

function toSafeNumber(value: bigint, field: "householdSize"): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(field, "invalid_household_size", "Household size is too large to compute an income limit.");
  }
  return Number(value);
}

/**
 * HUD family-size multiplier in basis points (10000 = 1.00): 0.70, 0.80, 0.90, 1.00, 1.08, 1.16, 1.24, 1.32
 * for one to eight persons, plus 0.08 for each member above eight (nine persons = 1.40).
 */
export function familySizeMultiplierBps(householdSize: number, multipliers: FamilySizeMultipliers = HUD_FAMILY_SIZE_MULTIPLIERS): number {
  assertHouseholdSize(householdSize);
  if (householdSize <= MAX_TABULATED_FAMILY_SIZE) return multipliers.bySizeBps[householdSize - 1];
  const extraPersons = BigInt(householdSize - MAX_TABULATED_FAMILY_SIZE);
  const bps = BigInt(multipliers.bySizeBps[MAX_TABULATED_FAMILY_SIZE - 1]) + extraPersons * BigInt(multipliers.additionalPersonBps);
  return toSafeNumber(bps, "householdSize");
}

function resolveCounty(table: AmiTable, countyFips: unknown): AmiCountyRecord {
  if (typeof countyFips !== "string" || !/^\d{5}$/.test(countyFips)) {
    fail("countyFips", "malformed_county_fips", `County FIPS code must be five digits (state + county), for example 48201 (received ${describeValue(countyFips)}).`);
  }
  const stateName = STATE_NAME[table.state];
  if (!countyFips.startsWith(table.stateFips)) {
    fail("countyFips", "county_outside_state", `County FIPS code ${countyFips} is not a ${stateName} county. Table ${table.version} covers ${stateName} only.`);
  }
  const county = table.countyByFips.get(countyFips);
  if (!county) {
    fail("countyFips", "unknown_county", `County FIPS code ${countyFips} is not a ${stateName} county in table ${table.version}.`);
  }
  return county;
}

function requireArea(table: AmiTable, code: string): HudAreaRecord | IrsAreaRecord {
  const area = table.areaByCode.get(code);
  // buildTable guarantees every county's area exists; this guards a table object built some other way.
  if (!area) throw new Error(`AMI table ${table.version}: area ${code} is missing`);
  return area;
}

interface Computed {
  thresholdCents: bigint;
  statutoryCents: bigint;
  exact: boolean;
  multiplierBps: number | null;
  medianIncomeDollars: number | null;
  formula: string;
}

function persons(n: number): string {
  return n === 1 ? "1 person" : `${n} persons`;
}

function capNote(capPct: number, statutoryCents: bigint, exact: boolean): string {
  const notes: string[] = [];
  if (!exact) notes.push("rounded down to the cent");
  if (capPct !== STATUTORY_CAP_PCT) {
    notes.push(`stricter cap; the limit at the statutory ${STATUTORY_CAP_PCT}% is ${formatExactUsd(toSafeNumber(statutoryCents, "householdSize"))}`);
  }
  return notes.length > 0 ? ` (${notes.join("; ")})` : "";
}

function computeHudDerived(area: HudAreaRecord, multipliers: FamilySizeMultipliers, householdSize: number, capPct: number): Computed {
  const multiplierBps = familySizeMultiplierBps(householdSize, multipliers);
  // dollars x 100 (cents) x capPct / 100 x bps / 10,000  ==  dollars x capPct x bps / 10,000
  const base = BigInt(area.medianIncomeDollars) * BigInt(multiplierBps);
  const numerator = base * BigInt(capPct);
  const divisor = BigInt(BASIS_POINTS);
  const thresholdCents = numerator / divisor;
  const exact = numerator % divisor === 0n;
  const statutoryCents = (base * BigInt(STATUTORY_CAP_PCT)) / divisor;

  const extra = householdSize - MAX_TABULATED_FAMILY_SIZE;
  const multiplierDetail =
    extra > 0
      ? `${persons(householdSize)}: ${formatMultiplier(multipliers.bySizeBps[MAX_TABULATED_FAMILY_SIZE - 1])} for ${MAX_TABULATED_FAMILY_SIZE} persons + ${formatMultiplier(multipliers.additionalPersonBps)} x ${extra} additional`
      : persons(householdSize);
  const formula =
    `${capPct}% x ${formatWholeUsd(area.medianIncomeDollars)} area median income x ${formatMultiplier(multiplierBps)} family-size multiplier (${multiplierDetail})` +
    ` = ${formatExactUsd(toSafeNumber(thresholdCents, "householdSize"))}${capNote(capPct, statutoryCents, exact)}`;

  return { thresholdCents, statutoryCents, exact, multiplierBps, medianIncomeDollars: area.medianIncomeDollars, formula };
}

function computeIrsPublished(area: IrsAreaRecord, householdSize: number, capPct: number): Computed {
  const extra = householdSize - MAX_TABULATED_FAMILY_SIZE;
  let statutoryCents: bigint;
  let published: string;
  if (extra <= 0) {
    statutoryCents = BigInt(area.limitCents[householdSize - 1]);
    published = `${formatExactUsd(area.limitCents[householdSize - 1])} IRS-published limit for ${persons(householdSize)}`;
  } else {
    if (area.additionalPersonCents === null) {
      fail(
        "householdSize",
        "household_size_not_published",
        `The IRS-published table gives no limit for a household of ${householdSize} in ${area.name}: it lists family sizes 1 to ${MAX_TABULATED_FAMILY_SIZE} and no amount for additional persons. This household needs manual review.`,
      );
    }
    const eightPersonCents = area.limitCents[MAX_TABULATED_FAMILY_SIZE - 1];
    statutoryCents = BigInt(eightPersonCents) + BigInt(extra) * BigInt(area.additionalPersonCents);
    published = `${formatExactUsd(eightPersonCents)} IRS-published limit for ${MAX_TABULATED_FAMILY_SIZE} persons + ${extra} additional x ${formatExactUsd(area.additionalPersonCents)} published per additional person`;
  }

  const numerator = statutoryCents * BigInt(capPct);
  const divisor = BigInt(STATUTORY_CAP_PCT);
  const thresholdCents = numerator / divisor;
  const exact = numerator % divisor === 0n;
  const result = formatExactUsd(toSafeNumber(thresholdCents, "householdSize"));

  let formula: string;
  if (capPct === STATUTORY_CAP_PCT) {
    formula = extra > 0 ? `${published} = ${result}` : published;
  } else {
    formula = `${capPct}/${STATUTORY_CAP_PCT} x (${published}) = ${result}${capNote(capPct, statutoryCents, exact)}`;
  }
  return { thresholdCents, statutoryCents, exact, multiplierBps: null, medianIncomeDollars: area.medianIncomeDollars, formula };
}

function compute(table: AmiTable, area: HudAreaRecord | IrsAreaRecord, householdSize: number, capPct: number): Computed {
  if (table.dataset.source === "hud_provisional") {
    return computeHudDerived(area as HudAreaRecord, table.dataset.multipliers, householdSize, capPct);
  }
  return computeIrsPublished(area as IrsAreaRecord, householdSize, capPct);
}

function areaMetro(area: HudAreaRecord | IrsAreaRecord): boolean | null {
  return "metro" in area ? area.metro : null;
}

/** Input of `computeThreshold`; the public `getThreshold` adds an optional `table`. */
export interface ComputeThresholdInput {
  countyFips: string;
  householdSize: number;
  capPct?: number;
}

/**
 * The household income limit for a county and household size in one table, with everything a decision
 * record needs: the area, the median, the multiplier, the source, table version, effective date and the
 * arithmetic.
 *
 * Throws a `validation_failed` AppError (with `details.reason` and `details.fields`) for a malformed,
 * non-Texas or unknown county FIPS code, a household size that is not a whole number >= 1, a cap that is
 * not a whole percent from 1 to 300, and a household above eight persons on an IRS table that publishes no
 * per-person increment (`details.reason === "household_size_not_published"`; send it to review).
 */
export function computeThreshold(table: AmiTable, input: ComputeThresholdInput): ThresholdResult {
  const capPct = input.capPct ?? STATUTORY_CAP_PCT;
  assertHouseholdSize(input.householdSize);
  assertCapPct(capPct);
  const county = resolveCounty(table, input.countyFips);
  const area = requireArea(table, county.areaCode);
  const computed = compute(table, area, input.householdSize, capPct);

  return {
    thresholdCents: toSafeNumber(computed.thresholdCents, "householdSize"),
    statutoryThresholdCents: toSafeNumber(computed.statutoryCents, "householdSize"),
    medianIncomeCents: computed.medianIncomeDollars === null ? null : computed.medianIncomeDollars * 100,
    multiplierBps: computed.multiplierBps,
    multiplier: computed.multiplierBps === null ? null : formatMultiplier(computed.multiplierBps),
    capPct,
    householdSize: input.householdSize,
    area: { code: area.code, name: area.name, metro: areaMetro(area) },
    county: { fips: county.fips, name: county.name },
    source: table.source,
    tableVersion: table.version,
    effectiveDate: table.effectiveDate,
    provisional: table.provisional,
    method: table.method,
    formula: computed.formula,
    exact: computed.exact,
  };
}

/** The limits for household sizes 1 through 8 in one county. */
export function computeThresholdRow(table: AmiTable, countyFips: string, capPct: number = STATUTORY_CAP_PCT): ThresholdRow {
  const results: ThresholdResult[] = [];
  for (let householdSize = 1; householdSize <= MAX_TABULATED_FAMILY_SIZE; householdSize++) {
    results.push(computeThreshold(table, { countyFips, householdSize, capPct }));
  }
  const first = results[0];
  return {
    county: first.county,
    area: first.area,
    medianIncomeCents: first.medianIncomeCents,
    capPct,
    source: first.source,
    tableVersion: first.tableVersion,
    effectiveDate: first.effectiveDate,
    provisional: first.provisional,
    method: first.method,
    thresholds: results.map((r) => ({
      householdSize: r.householdSize,
      thresholdCents: r.thresholdCents,
      statutoryThresholdCents: r.statutoryThresholdCents,
      multiplierBps: r.multiplierBps,
    })),
  };
}

function toCounty(table: AmiTable, record: AmiCountyRecord): AmiCounty {
  return { fips: record.fips, name: record.name, areaCode: record.areaCode, areaName: requireArea(table, record.areaCode).name };
}

export function tableCounties(table: AmiTable): AmiCounty[] {
  return table.dataset.counties.map((record) => toCounty(table, record));
}

export function tableCounty(table: AmiTable, countyFips: string): AmiCounty | null {
  const record = typeof countyFips === "string" ? table.countyByFips.get(countyFips) : undefined;
  return record ? toCounty(table, record) : null;
}

export function tableArea(table: AmiTable, areaCode: string): AmiArea | null {
  const area = typeof areaCode === "string" ? table.areaByCode.get(areaCode) : undefined;
  if (!area) return null;
  return {
    code: area.code,
    name: area.name,
    metro: areaMetro(area),
    medianIncomeCents: area.medianIncomeDollars === null ? null : area.medianIncomeDollars * 100,
    countyFips: [...(table.countyFipsByArea.get(area.code) ?? [])],
    hudPublished:
      "hudPublished" in area
        ? {
            veryLowIncome4PersonCents: area.hudPublished.veryLowIncome4PersonDollars * 100,
            lowIncome4PersonCents: area.hudPublished.lowIncome4PersonDollars * 100,
          }
        : null,
  };
}

export function tableCountiesInArea(table: AmiTable, areaCode: string): AmiCounty[] {
  const fipsCodes = typeof areaCode === "string" ? (table.countyFipsByArea.get(areaCode) ?? []) : [];
  return fipsCodes.map((fips) => toCounty(table, table.countyByFips.get(fips)!));
}
