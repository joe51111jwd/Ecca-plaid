/**
 * OWNED BY THE FOUNDER (James). The Texas income-limit suite: every Texas county, household sizes 1 to 8.
 *
 * A wrong threshold is a wrong scholarship decision. Do not change an expected number, loosen an
 * assertion, or delete a case in this file without human review by the owner; an automated or agent change
 * to these numbers must never be merged unreviewed.
 *
 * The golden file (__golden__/hud-fy2026-tx-thresholds.csv) is written by scripts/ami-golden.py, an
 * independent Python implementation that reads the official HUD workbook itself and shares no code with the
 * engine. If a golden number has to change, re-run `python3 -I scripts/ami-golden.py`, review the diff of
 * the golden file by hand, and commit it together with the reason. Never edit the golden file by hand and
 * never regenerate it from the TypeScript engine.
 *
 * The hand-checkable anchors below can be verified with a calculator: limit = 3 x median x multiplier,
 * multipliers 0.70 0.80 0.90 1.00 1.08 1.16 1.24 1.32 for one to eight persons, +0.08 per person above eight.
 * The second reading (`section8_vli`) is 6 x HUD's published very-low-income limit l50_n; the golden file
 * carries it too (columns vli_dollars, vli_basis, section8_vli_cents, readings_agree). The disagreement counts
 * asserted below (143 / 120 / 23 at four persons, 97 nonmetro counties at $41,850, 55 cells off HUD's method)
 * reproduce docs/reference/sgo-verification-rules.md F34 and docs/reference/hud-ami-and-annual-income.md F17-F18.
 * These limits are HUD-derived and PROVISIONAL; they are not IRS-published limits.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsvRecords } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import {
  AMI_POLICY,
  buildTable,
  countiesInArea,
  createTableRegistry,
  describeReadings,
  describeThresholdSource,
  EXPECTED_COUNTY_COUNT,
  familySizeMultiplierBps,
  getActiveTable,
  getArea,
  getCounty,
  getTable,
  getThreshold,
  HUD_FAMILY_SIZE_MULTIPLIERS,
  isIsoCalendarDate,
  listCounties,
  listTables,
  STATUTORY_CAP_PCT,
  THRESHOLD_COPY_VERSION,
  thresholdReadingLabel,
  thresholdRow,
  thresholdSourceName,
  type AmiTable,
  type GetThresholdInput,
  type HudDerivedDataset,
  type ThresholdSource,
} from "./index";
import { transcriptionMismatches } from "./transcription-check";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GOLDEN_FILE = join(HERE, "__golden__/hud-fy2026-tx-thresholds.csv");
const HUD_VERSION = "hud-fy2026-tx";

/**
 * Tripwire. Activating another table (for example the IRS table when it is published) must be a reviewed
 * change to these two constants in the same commit as data/ami/active.json. Nothing else in this file needs
 * to change for a swap-in. See docs/runbooks/irs-table-swap-in.md.
 */
const EXPECTED_ACTIVE_VERSION = "hud-fy2026-tx";
const EXPECTED_ACTIVE_SOURCE = "hud_provisional" as ThresholdSource;

const hud = getTable(HUD_VERSION);
if (hud.dataset.source !== "hud_provisional") throw new Error(`${HUD_VERSION} must be a HUD-derived table`);
const hudDataset: HudDerivedDataset = hud.dataset;
const SIZES_1_TO_8 = [1, 2, 3, 4, 5, 6, 7, 8];

interface GoldenRow {
  fips: string;
  county: string;
  areaCode: string;
  metro: boolean;
  medianDollars: number;
  size: number;
  /** Reading A, `median_product`. */
  thresholdCents: number;
  vliDollars: number;
  vliBasis: "published" | "extended";
  /** Reading B, `section8_vli`. */
  section8VliCents: number;
  readingsAgree: boolean;
}

const goldenRows: GoldenRow[] = parseCsvRecords(readFileSync(GOLDEN_FILE, "utf8")).map((record) => ({
  fips: record.fips,
  county: record.county,
  areaCode: record.area_code,
  metro: record.metro === "1",
  medianDollars: Number(record.median),
  size: Number(record.size),
  thresholdCents: Number(record.threshold_cents),
  vliDollars: Number(record.vli_dollars),
  vliBasis: record.vli_basis as GoldenRow["vliBasis"],
  section8VliCents: Number(record.section8_vli_cents),
  readingsAgree: record.readings_agree === "1",
}));

const goldenByCounty = new Map<string, GoldenRow[]>();
for (const row of goldenRows) {
  const list = goldenByCounty.get(row.fips);
  if (list) list.push(row);
  else goldenByCounty.set(row.fips, [row]);
}

function limit(countyFips: string, householdSize: number, capPct?: number, table: AmiTable = hud): number {
  return getThreshold({ countyFips, householdSize, capPct, table }).thresholdCents;
}

function expectInvalid(run: () => unknown, reason: string, field: string): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("validation_failed");
    expect(appError.status).toBe(422);
    const details = appError.details as { reason: string; fields: Record<string, string> };
    expect(details.reason).toBe(reason);
    expect(details.fields[field]).toBe(appError.message);
    return appError;
  }
  throw new Error("expected a validation_failed AppError, but nothing was thrown");
}

/** SYNTHETIC one-county table, used only to reproduce the proposed rule's own worked example. */
function syntheticTable(medianIncomeDollars: number): AmiTable {
  const dataset: HudDerivedDataset = {
    schemaVersion: 1,
    version: "hud-synthetic-example",
    source: "hud_provisional",
    method: "hud_median_x_cap_pct_x_family_size_multiplier_v1",
    state: "TX",
    stateFips: "48",
    fiscalYear: 2026,
    effectiveDate: "2026-05-01",
    effectiveDateCitation: "SYNTHETIC",
    sourceFile: { name: "SYNTHETIC.xlsx", sha256: "0".repeat(64), url: null },
    multipliers: { bySizeBps: [...HUD_FAMILY_SIZE_MULTIPLIERS.bySizeBps], additionalPersonBps: HUD_FAMILY_SIZE_MULTIPLIERS.additionalPersonBps, citation: "SYNTHETIC" },
    areas: [{ code: "SYNTHETIC-AREA", name: "SYNTHETIC area", metro: true, medianIncomeDollars, hudPublished: { veryLowIncome4PersonDollars: 1, lowIncome4PersonDollars: 1, veryLowIncomeBySizeDollars: [1, 1, 1, 1, 1, 1, 1, 1] } }],
    counties: [{ fips: "48999", name: "SYNTHETIC County", areaCode: "SYNTHETIC-AREA" }],
  };
  return buildTable(dataset, { requireAllCounties: false });
}

describe("golden file", () => {
  it("covers all 254 Texas counties for household sizes 1 through 8: 2,032 cases", () => {
    expect(goldenByCounty.size).toBe(254);
    const core = goldenRows.filter((row) => row.size <= 8);
    expect(core).toHaveLength(254 * 8);
    for (const [fips, rows] of goldenByCounty) {
      expect(rows.slice(0, 8).map((row) => row.size), fips).toEqual(SIZES_1_TO_8);
    }
    expect(new Set(goldenRows.map((row) => `${row.fips}:${row.size}`)).size).toBe(goldenRows.length);
  });

  it("covers household sizes 9 through 12 for a sample of counties", () => {
    const large = goldenRows.filter((row) => row.size > 8);
    const sample = [...new Set(large.map((row) => row.fips))];
    expect(sample).toEqual(["48015", "48029", "48037", "48113", "48141", "48173", "48201", "48215", "48225", "48301", "48427", "48439", "48453"]);
    expect(large).toHaveLength(sample.length * 4);
    for (const fips of sample) {
      expect(goldenByCounty.get(fips)!.map((row) => row.size)).toEqual([...SIZES_1_TO_8, 9, 10, 11, 12]);
    }
  });

  it("lists exactly the Texas county FIPS codes: the odd numbers 48001 to 48507 (Census county list)", () => {
    const expected = Array.from({ length: 254 }, (_, index) => `48${String(2 * index + 1).padStart(3, "0")}`);
    expect([...goldenByCounty.keys()]).toEqual(expected);
    expect(listCounties(hud).map((county) => county.fips)).toEqual(expected);
  });

  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  it.runIf(python.status === 0)("is exactly what scripts/ami-golden.py computes from the official workbook", () => {
    const check = spawnSync("python3", ["-I", join(REPO_ROOT, "scripts/ami-golden.py"), "--check"], { encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
    expect(check.stdout).toMatch(/is up to date \(2084 rows\)/);
  });
});

describe("every Texas county x household sizes 1-8 matches the independent golden numbers", () => {
  const cases = [...goldenByCounty.entries()].map(([fips, rows]) => ({ fips, county: rows[0].county, rows }));

  it.each(cases)("$fips $county", ({ fips, rows }) => {
    for (const golden of rows) {
      const result = getThreshold({ countyFips: fips, householdSize: golden.size, table: hud });
      const at = `${fips} size ${golden.size}`;
      expect(result.thresholdCents, at).toBe(golden.thresholdCents);
      expect(result.statutoryThresholdCents, at).toBe(golden.thresholdCents);
      expect(result.county, at).toEqual({ fips, name: golden.county });
      expect(result.area.code, at).toBe(golden.areaCode);
      expect(result.medianIncomeCents, at).toBe(golden.medianDollars * 100);
      expect(result.exact, at).toBe(true);
      expect(result.householdSize, at).toBe(golden.size);
      expect(result.readings.map((reading) => reading.id), at).toEqual(["median_product", "section8_vli"]);
      expect(result.readings[0].thresholdCents, at).toBe(golden.thresholdCents);
      expect(result.readings[1].thresholdCents, at).toBe(golden.section8VliCents);
      expect(result.readings[1].statutoryThresholdCents, at).toBe(golden.section8VliCents);
      expect(result.readings[1].formula.includes("extended by HUD's method"), at).toBe(golden.vliBasis === "extended");
      expect(result.readingsAgree, at).toBe(golden.readingsAgree);
      expect(result.lowerBoundCents, at).toBe(Math.min(golden.thresholdCents, golden.section8VliCents));
      expect(result.upperBoundCents, at).toBe(Math.max(golden.thresholdCents, golden.section8VliCents));
    }
    // The 1-8 row helper must agree with the single lookups.
    expect(thresholdRow(fips, { table: hud }).thresholds.map((entry) => entry.thresholdCents)).toEqual(rows.slice(0, 8).map((row) => row.thresholdCents));
  });

  it("the active table gives the same numbers while it is the HUD FY 2026 table", () => {
    if (getActiveTable().version !== HUD_VERSION) return;
    for (const golden of goldenRows) {
      expect(getThreshold({ countyFips: golden.fips, householdSize: golden.size }).thresholdCents).toBe(golden.thresholdCents);
    }
  });
});

describe("hand-checkable anchors", () => {
  it("Harris County (Houston-The Woodlands-Sugar Land HUD Metro FMR Area, median $104,000)", () => {
    expect(limit("48201", 4)).toBe(31_200_000); // 3 x 104,000 x 1.00 = $312,000.00
    expect(limit("48201", 3)).toBe(28_080_000); // 3 x 104,000 x 0.90 = $280,800.00
    expect(limit("48201", 1)).toBe(21_840_000); // 3 x 104,000 x 0.70 = $218,400.00
    expect(limit("48201", 8)).toBe(41_184_000); // 3 x 104,000 x 1.32 = $411,840.00
    expect(SIZES_1_TO_8.map((size) => limit("48201", size))).toEqual([21_840_000, 24_960_000, 28_080_000, 31_200_000, 33_696_000, 36_192_000, 38_688_000, 41_184_000]);

    expect(getThreshold({ countyFips: "48201", householdSize: 4, table: hud })).toEqual({
      thresholdCents: 31_200_000,
      statutoryThresholdCents: 31_200_000,
      medianIncomeCents: 10_400_000,
      multiplierBps: 10_000,
      multiplier: "1.00",
      capPct: 300,
      householdSize: 4,
      area: { code: "METRO26420M26420", name: "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area", metro: true },
      county: { fips: "48201", name: "Harris County" },
      source: "hud_provisional",
      tableVersion: "hud-fy2026-tx",
      effectiveDate: "2026-05-01",
      provisional: true,
      method: "hud_median_x_cap_pct_x_family_size_multiplier_v1",
      formula: "300% x $104,000 area median income x 1.00 family-size multiplier (4 persons) = $312,000.00",
      exact: true,
      readings: [
        {
          id: "median_product",
          label: "Area median income x family-size multiplier (the worked example in the proposed rule's economic analysis)",
          thresholdCents: 31_200_000,
          statutoryThresholdCents: 31_200_000,
          formula: "300% x $104,000 area median income x 1.00 family-size multiplier (4 persons) = $312,000.00",
        },
        {
          id: "section8_vli",
          label: "6 x HUD's Section 8 very-low-income limit (a reading of the proposed regulation text)",
          thresholdCents: 31_200_000,
          statutoryThresholdCents: 31_200_000,
          formula: "6 x $52,000 HUD very-low-income limit (4 persons) = $312,000.00",
        },
      ],
      lowerBoundCents: 31_200_000,
      upperBoundCents: 31_200_000,
      readingsAgree: true,
    });
  });

  it("the proposed rule's own example: median $100,000 gives $270,000 for three persons and $300,000 for four", () => {
    const example = syntheticTable(100_000);
    expect(limit("48999", 3, undefined, example)).toBe(27_000_000);
    expect(limit("48999", 4, undefined, example)).toBe(30_000_000);
    expect(getThreshold({ countyFips: "48999", householdSize: 3, table: example }).formula).toBe("300% x $100,000 area median income x 0.90 family-size multiplier (3 persons) = $270,000.00");
    expect(SIZES_1_TO_8.map((size) => limit("48999", size, undefined, example))).toEqual([21_000_000, 24_000_000, 27_000_000, 30_000_000, 32_400_000, 34_800_000, 37_200_000, 39_600_000]);
  });

  it("other large and extreme counties", () => {
    expect(limit("48453", 4)).toBe(40_320_000); // Travis, median 134,400: x3 = $403,200
    expect(limit("48453", 5)).toBe(43_545_600); // x 1.08 = $435,456
    expect(limit("48113", 1)).toBe(25_431_000); // Dallas, median 121,100: x3 x 0.70 = $254,310
    expect(limit("48113", 8)).toBe(47_955_600); // x3 x 1.32 = $479,556
    expect(limit("48439", 4)).toBe(33_090_000); // Tarrant, median 110,300
    expect(limit("48029", 4)).toBe(30_180_000); // Bexar, median 100,600
    expect(limit("48141", 4)).toBe(22_020_000); // El Paso, median 73,400
    expect(limit("48215", 4)).toBe(19_200_000); // Hidalgo, median 64,000
    expect(limit("48427", 4)).toBe(11_610_000); // Starr, lowest median 38,700
    expect(limit("48427", 8)).toBe(15_325_200); // x3 x 1.32 = $153,252
    expect(limit("48173", 4)).toBe(43_260_000); // Glasscock, highest median 144,200
    expect(limit("48037", 4)).toBe(23_490_000); // Bowie (Texarkana), median 78,300
  });
});

describe("structure of the Texas table", () => {
  const counties = listCounties(hud);
  const areaCodes = [...new Set(counties.map((county) => county.areaCode))];

  it("has 254 counties in 215 income-limit areas, and every county resolves to an area", () => {
    expect(EXPECTED_COUNTY_COUNT.TX).toBe(254);
    expect(counties).toHaveLength(254);
    expect(areaCodes).toHaveLength(215);
    expect(hudDataset.areas).toHaveLength(215);
    for (const county of counties) {
      const area = getArea(county.areaCode, hud);
      expect(area, county.fips).not.toBeNull();
      expect(area!.name).toBe(county.areaName);
      expect(area!.countyFips).toContain(county.fips);
      expect(getCounty(county.fips, hud)).toEqual(county);
    }
    expect(new Set(counties.map((county) => county.name)).size).toBe(254);
    expect(counties.every((county) => county.name.endsWith(" County"))).toBe(true);
  });

  it("thresholds are positive whole dollars and strictly increase with household size, 1 through 12", () => {
    for (const county of counties) {
      let previous = 0;
      for (let size = 1; size <= 12; size++) {
        const cents = limit(county.fips, size);
        expect(cents, `${county.fips} size ${size}`).toBeGreaterThan(previous);
        expect(cents % 100, `${county.fips} size ${size}`).toBe(0);
        previous = cents;
      }
    }
  });

  it("counties in one area share one median and one set of thresholds", () => {
    const multiCounty = areaCodes.filter((code) => countiesInArea(code, hud).length > 1);
    expect(multiCounty).toHaveLength(16);
    expect(multiCounty.reduce((total, code) => total + countiesInArea(code, hud).length, 0)).toBe(55);
    for (const code of multiCounty) {
      const members = countiesInArea(code, hud);
      const first = thresholdRow(members[0].fips, { table: hud });
      for (const member of members) {
        const row = thresholdRow(member.fips, { table: hud });
        expect(row.area.code).toBe(code);
        expect(row.medianIncomeCents).toBe(first.medianIncomeCents);
        expect(row.thresholds).toEqual(first.thresholds);
      }
    }
  });

  it("groups the big metro areas as HUD does", () => {
    const names = (code: string) => countiesInArea(code, hud).map((county) => county.name.replace(" County", ""));
    expect(names("METRO26420M26420")).toEqual(["Chambers", "Fort Bend", "Galveston", "Harris", "Liberty", "Montgomery", "Waller"]);
    expect(names("METRO19100M19100")).toEqual(["Collin", "Dallas", "Denton", "Ellis", "Hunt", "Kaufman", "Rockwall"]);
    expect(names("METRO19100MM2800")).toEqual(["Johnson", "Parker", "Tarrant"]);
    expect(names("METRO12420M12420")).toEqual(["Bastrop", "Caldwell", "Hays", "Travis", "Williamson"]);
    expect(names("METRO41700M41700")).toEqual(["Bandera", "Bexar", "Comal", "Guadalupe", "Wilson"]);
    expect(getArea("METRO19100M19100", hud)).toMatchObject({ name: "Dallas, TX HUD Metro FMR Area", metro: true, medianIncomeCents: 12_110_000 });
  });

  it("does not give a county the median of a metro it is merely near or named like", () => {
    // In the Houston MSA but with their own HUD areas and medians.
    expect(getThreshold({ countyFips: "48039", householdSize: 4, table: hud })).toMatchObject({ area: { code: "METRO26420MM1145", name: "Brazoria County, TX HUD Metro FMR Area" }, medianIncomeCents: 12_600_000, thresholdCents: 37_800_000 });
    expect(getThreshold({ countyFips: "48407", householdSize: 4, table: hud })).toMatchObject({ area: { name: "San Jacinto County, TX HUD Metro FMR Area" }, medianIncomeCents: 8_050_000 });
    // Austin County is not the city of Austin (Travis County).
    expect(getThreshold({ countyFips: "48015", householdSize: 4, table: hud })).toMatchObject({ county: { name: "Austin County" }, area: { name: "Austin County, TX HUD Metro FMR Area" }, medianIncomeCents: 10_400_000 });
    expect(getThreshold({ countyFips: "48453", householdSize: 4, table: hud })).toMatchObject({ county: { name: "Travis County" }, area: { name: "Austin-Round Rock-San Marcos, TX MSA" }, medianIncomeCents: 13_440_000 });
    // Houston County is not the city of Houston (Harris County); Tyler County is not the city of Tyler (Smith County).
    expect(getThreshold({ countyFips: "48225", householdSize: 4, table: hud })).toMatchObject({ county: { name: "Houston County" }, area: { metro: false }, medianIncomeCents: 8_110_000 });
    expect(getThreshold({ countyFips: "48457", householdSize: 4, table: hud })).toMatchObject({ county: { name: "Tyler County" }, medianIncomeCents: 7_440_000 });
    expect(getThreshold({ countyFips: "48423", householdSize: 4, table: hud })).toMatchObject({ county: { name: "Smith County" }, area: { name: "Tyler, TX MSA" }, medianIncomeCents: 9_730_000 });
  });

  it("keeps only the Texas county of the cross-state Texarkana area", () => {
    const bowie = getCounty("48037", hud)!;
    expect(bowie.areaName).toBe("Texarkana, TX-Texarkana, AR HUD Metro FMR Area");
    expect(countiesInArea(bowie.areaCode, hud).map((county) => county.fips)).toEqual(["48037"]);
  });

  it("matches HUD's own description of the data: metro split, median range, medians in whole hundreds", () => {
    const metroCounties = counties.filter((county) => getArea(county.areaCode, hud)!.metro === true);
    expect(metroCounties).toHaveLength(86);
    expect(counties.length - metroCounties.length).toBe(168);
    expect(hudDataset.areas.filter((area) => area.metro)).toHaveLength(47);

    const medians = hudDataset.areas.map((area) => area.medianIncomeDollars);
    expect(Math.min(...medians)).toBe(38_700);
    expect(Math.max(...medians)).toBe(144_200);
    expect(getArea(getCounty("48427", hud)!.areaCode, hud)!.medianIncomeCents).toBe(3_870_000);
    expect(getArea(getCounty("48173", hud)!.areaCode, hud)!.medianIncomeCents).toBe(14_420_000);
    expect(medians.every((median) => median % 100 === 0)).toBe(true);
    expect(new Set(counties.map((county) => getArea(county.areaCode, hud)!.medianIncomeCents)).size).toBe(174);
  });

  it("keeps HUD's published limits out of thresholdCents (they feed only the section8_vli reading)", () => {
    const houston = getArea("METRO26420M26420", hud)!;
    expect(houston.hudPublished).toEqual({
      veryLowIncome4PersonCents: 5_200_000,
      lowIncome4PersonCents: 8_320_000,
      veryLowIncomeBySizeCents: [3_640_000, 4_160_000, 4_680_000, 5_200_000, 5_620_000, 6_035_000, 6_450_000, 6_865_000],
    });
    // Where HUD's 50% limit is exactly half the median, 6 x l50 happens to equal the 300% limit...
    expect(6 * houston.hudPublished!.veryLowIncome4PersonCents).toBe(limit("48201", 4));
    // ...but HUD floors, caps and rounds its limits, so in Starr County 6 x l50 would be $251,100, not $116,100.
    const starr = getArea(getCounty("48427", hud)!.areaCode, hud)!;
    expect(starr.hudPublished!.veryLowIncome4PersonCents).toBe(4_185_000);
    expect(limit("48427", 4)).toBe(11_610_000);
    expect(6 * starr.hudPublished!.veryLowIncome4PersonCents).not.toBe(limit("48427", 4));
    expect(JSON.stringify(hudDataset)).not.toMatch(/threshold|limitCents/i);
  });

  it("at 50% and 80% of median reproduces HUD's own published Harris County limits (an independent cross-check)", () => {
    // HUD publishes l50 = 36,400 / 52,000 and l80_4 = 83,200 for Harris County, where no cap, floor or rounding bites.
    expect(limit("48201", 1, 50)).toBe(3_640_000);
    expect(limit("48201", 4, 50)).toBe(5_200_000);
    expect(limit("48201", 4, 80)).toBe(8_320_000);
  });
});

describe("two readings of the proposed rule (provisional HUD-derived table)", () => {
  const fourPerson = goldenRows.filter((row) => row.size === 4);

  it("the golden file's Reading B is 6 x HUD's published l50_n for sizes 1-8, read independently from the workbook", () => {
    for (const row of goldenRows.filter((r) => r.size <= 8)) {
      const area = getArea(row.areaCode, hud)!;
      expect(row.vliBasis, `${row.fips} size ${row.size}`).toBe("published");
      expect(area.hudPublished!.veryLowIncomeBySizeCents[row.size - 1], `${row.fips} size ${row.size}`).toBe(row.vliDollars * 100);
      expect(row.section8VliCents).toBe(row.vliDollars * 600);
    }
  });

  it("the four-person readings differ in 143 of 254 counties: Reading B higher in 120, lower in 23 (reference F34)", () => {
    expect(fourPerson).toHaveLength(254);
    const results = fourPerson.map((row) => getThreshold({ countyFips: row.fips, householdSize: 4, table: hud }));
    const differ = results.filter((r) => !r.readingsAgree);
    expect(differ).toHaveLength(143);
    expect(differ.filter((r) => r.readings[1].thresholdCents > r.readings[0].thresholdCents)).toHaveLength(120);
    expect(differ.filter((r) => r.readings[1].thresholdCents < r.readings[0].thresholdCents)).toHaveLength(23);
    expect(fourPerson.filter((row) => !row.readingsAgree)).toHaveLength(143);
  });

  it("anchors: Starr County $116,100 vs $251,100 at four persons (the largest gap); Harris $312,000 under both", () => {
    const starr = getThreshold({ countyFips: "48427", householdSize: 4, table: hud });
    expect(starr.thresholdCents).toBe(11_610_000);
    expect(starr.readings[1].thresholdCents).toBe(25_110_000);
    expect(starr.readings[1].formula).toBe("6 x $41,850 HUD very-low-income limit (4 persons) = $251,100.00");
    expect([starr.lowerBoundCents, starr.upperBoundCents, starr.readingsAgree]).toEqual([11_610_000, 25_110_000, false]);
    const gaps = fourPerson.map((row) => Math.abs(row.section8VliCents - row.thresholdCents));
    expect(Math.max(...gaps)).toBe(13_500_000);
    expect(fourPerson[gaps.indexOf(Math.max(...gaps))].fips).toBe("48427");

    const harris = getThreshold({ countyFips: "48201", householdSize: 4, table: hud });
    expect([harris.thresholdCents, harris.readings[1].thresholdCents, harris.lowerBoundCents, harris.upperBoundCents, harris.readingsAgree]).toEqual([
      31_200_000, 31_200_000, 31_200_000, 31_200_000, true,
    ]);
    // Other sizes differ by a few hundred dollars because HUD rounds each l50_n up to $50: 6 x 56,200 vs 3 x 104,000 x 1.08.
    const harris5 = getThreshold({ countyFips: "48201", householdSize: 5, table: hud });
    expect([harris5.readings[0].thresholdCents, harris5.readings[1].thresholdCents, harris5.readingsAgree]).toEqual([33_696_000, 33_720_000, false]);
  });

  it("97 of the 168 nonmetropolitan counties share the $41,850 four-person very-low-income limit (half the $83,700 state nonmetro median)", () => {
    const nonmetro = listCounties(hud).filter((county) => getArea(county.areaCode, hud)!.metro === false);
    expect(nonmetro).toHaveLength(168);
    const at41850 = nonmetro.filter((county) => getArea(county.areaCode, hud)!.hudPublished!.veryLowIncome4PersonCents === 4_185_000);
    expect(at41850).toHaveLength(97);
    for (const county of at41850) expect(getThreshold({ countyFips: county.fips, householdSize: 4, table: hud }).readings[1].thresholdCents).toBe(25_110_000);
    expect(fourPerson.filter((row) => !row.metro && row.vliDollars === 41_850)).toHaveLength(97);
  });

  it("lower <= upper, both bounds are readings, and thresholdCents stays Reading A, for every county, size 1-12 and several caps", () => {
    for (const county of listCounties(hud)) {
      for (const size of [...SIZES_1_TO_8, 9, 12]) {
        for (const capPct of [300, 250, 185, 100, 1]) {
          const r = getThreshold({ countyFips: county.fips, householdSize: size, capPct, table: hud });
          const limits = r.readings.map((reading) => reading.thresholdCents);
          expect(r.lowerBoundCents).toBeLessThanOrEqual(r.upperBoundCents);
          expect(r.lowerBoundCents).toBe(Math.min(...limits));
          expect(r.upperBoundCents).toBe(Math.max(...limits));
          expect(r.thresholdCents).toBe(r.readings[0].thresholdCents);
          expect(r.readingsAgree).toBe(limits[0] === limits[1]);
        }
      }
    }
  });

  it("scales both readings by the cap: Reading B at cap c is l50_n x 6 x c / 300, exact to the cent", () => {
    const starr250 = getThreshold({ countyFips: "48427", householdSize: 4, capPct: 250, table: hud });
    expect(starr250.readings[0].thresholdCents).toBe(9_675_000); // 2.5 x 38,700
    expect(starr250.readings[1].thresholdCents).toBe(20_925_000); // 41,850 x 6 x 250 / 300 = 209,250
    expect(starr250.readings[1].statutoryThresholdCents).toBe(25_110_000);
    expect(starr250.readings[1].formula).toBe(
      "6 x $41,850 HUD very-low-income limit (4 persons) x 250/300 = $209,250.00 (stricter cap; the limit at the statutory 300% is $251,100.00)",
    );
    const starr185 = getThreshold({ countyFips: "48427", householdSize: 4, capPct: 185, table: hud });
    expect(starr185.readings[1].thresholdCents).toBe(15_484_500); // 41,850 x 6 x 1.85/3 = 154,845
    expect([starr185.lowerBoundCents, starr185.upperBoundCents]).toEqual([7_159_500, 15_484_500]);
    for (const golden of goldenRows) {
      for (const capPct of [1, 7, 185, 250, 299]) {
        const r = getThreshold({ countyFips: golden.fips, householdSize: golden.size, capPct, table: hud });
        expect(r.readings[1].thresholdCents).toBe(golden.vliDollars * 2 * capPct);
      }
    }
  });

  it("above eight persons extends HUD's l50 by HUD's method (four-person limit x multiplier, rounded up to $50) and says so", () => {
    const harris9 = getThreshold({ countyFips: "48201", householdSize: 9, table: hud });
    expect(harris9.readings[1].thresholdCents).toBe(43_680_000); // 52,000 x 1.40 = 72,800 (already a multiple of $50) x 6
    expect(harris9.readings[1].formula).toBe(
      "6 x $72,800 HUD very-low-income limit (9 persons, extended by HUD's method: $52,000 four-person limit x 1.40, rounded up to the nearest $50) = $436,800.00",
    );
    const starr9 = getThreshold({ countyFips: "48427", householdSize: 9, table: hud });
    expect(starr9.readings[1].thresholdCents).toBe(35_160_000); // 41,850 x 1.40 = 58,590 -> 58,600 x 6 = 351,600
    const harris10 = getThreshold({ countyFips: "48201", householdSize: 10, table: hud });
    expect(harris10.readings[1].thresholdCents).toBe(46_200_000); // 52,000 x 1.48 = 76,960 -> 77,000 x 6
    expect(harris10.readingsAgree).toBe(false);
    for (const size of SIZES_1_TO_8) expect(getThreshold({ countyFips: "48201", householdSize: size, table: hud }).readings[1].formula).not.toMatch(/extended/);
    // Very large households stay exact integers.
    const huge = getThreshold({ countyFips: "48201", householdSize: 1_000_000, table: hud });
    expect(Number.isSafeInteger(huge.readings[1].thresholdCents)).toBe(true);
    expect(huge.lowerBoundCents).toBeLessThanOrEqual(huge.upperBoundCents);
  });

  it("HUD's published l50_n (n != 4) follows HUD's own method from l50_4 except in 55 cells of 21 counties, each by $50; the published figure is used", () => {
    const pct = [70, 80, 90, 100, 108, 116, 124, 132];
    const deviations: Array<{ fips: string; size: number; delta: number }> = [];
    for (const county of listCounties(hud)) {
      const vli = getArea(county.areaCode, hud)!.hudPublished!.veryLowIncomeBySizeCents.map((cents) => cents / 100);
      for (const size of SIZES_1_TO_8) {
        if (size === 4) continue;
        const byMethod = Math.ceil((vli[3] * pct[size - 1]) / 100 / 50) * 50;
        if (byMethod !== vli[size - 1]) deviations.push({ fips: county.fips, size, delta: vli[size - 1] - byMethod });
        expect(getThreshold({ countyFips: county.fips, householdSize: size, table: hud }).readings[1].statutoryThresholdCents).toBe(vli[size - 1] * 600);
      }
    }
    expect(deviations).toHaveLength(55);
    expect(new Set(deviations.map((d) => d.fips)).size).toBe(21);
    expect(deviations.filter((d) => d.delta === -50)).toHaveLength(48);
    expect(deviations.filter((d) => d.delta === 50)).toHaveLength(7);
    expect(getArea(getCounty("48201", hud)!.areaCode, hud)!.hudPublished!.veryLowIncomeBySizeCents).toEqual(
      [36_400, 41_600, 46_800, 52_000, 56_200, 60_350, 64_500, 68_650].map((dollars) => dollars * 100),
    );
  });

  it("thresholdRow carries the readings for sizes 1-8", () => {
    const row = thresholdRow("48427", { table: hud, capPct: 250 });
    expect(row.thresholds.map((t) => t.readings.map((reading) => reading.id))).toEqual(SIZES_1_TO_8.map(() => ["median_product", "section8_vli"]));
    for (const entry of row.thresholds) {
      const single = getThreshold({ countyFips: "48427", householdSize: entry.householdSize, capPct: 250, table: hud });
      expect(entry).toMatchObject({ readings: single.readings, lowerBoundCents: single.lowerBoundCents, upperBoundCents: single.upperBoundCents, readingsAgree: single.readingsAgree });
    }
  });

  it("describeReadings gives the exact sentences for differing and agreeing readings", () => {
    const starr = describeReadings(getThreshold({ countyFips: "48427", householdSize: 4, table: hud }));
    expect(starr.status).toBe("differ");
    expect(starr.copyVersion).toBe(THRESHOLD_COPY_VERSION);
    expect(starr.summary).toBe(
      "Provisional. Two readings of the proposed rule give different limits for this county and household size: $116,100.00 and $251,100.00. " +
        "Automatic decisions use the lower figure to approve and the higher figure to decline; incomes in between are reviewed by a person.",
    );
    expect(starr.readingLines).toEqual([
      "Area median income x family-size multiplier (the worked example in the proposed rule's economic analysis): 300% x $38,700 area median income x 1.00 family-size multiplier (4 persons) = $116,100.00",
      "6 x HUD's Section 8 very-low-income limit (a reading of the proposed regulation text): 6 x $41,850 HUD very-low-income limit (4 persons) = $251,100.00",
    ]);
    const harris = describeReadings(getThreshold({ countyFips: "48201", householdSize: 4, table: hud }));
    expect(harris.status).toBe("agree");
    expect(harris.summary).toBe("Provisional. Both readings of the proposed rule give the same limit for this county and household size: $312,000.00.");
    const es = describeReadings(getThreshold({ countyFips: "48427", householdSize: 4, table: hud }), "es");
    expect(es.summary).toContain("$116,100.00 y $251,100.00");
    expect(es.summary).toMatch(/^Provisional\./);
  });

  it("no reading label or sentence implies the IRS has adopted a provisional reading", () => {
    const texts = [
      thresholdReadingLabel("median_product"),
      thresholdReadingLabel("section8_vli"),
      thresholdReadingLabel("median_product", "es"),
      thresholdReadingLabel("section8_vli", "es"),
      describeThresholdSource(hud).readingsNote!,
      describeReadings(getThreshold({ countyFips: "48427", householdSize: 4, table: hud })).summary,
    ].join(" ");
    expect(texts).not.toMatch(/IRS (formula|method|rule|limit)|official|approved by|adopted|endorse/i);
    expect(texts).not.toMatch(/IRS-published/);
  });
});

describe("households larger than eight", () => {
  it("adds 0.08 to the multiplier for each member above eight", () => {
    expect(SIZES_1_TO_8.map((size) => familySizeMultiplierBps(size))).toEqual([7000, 8000, 9000, 10000, 10800, 11600, 12400, 13200]);
    expect(familySizeMultiplierBps(9)).toBe(14_000);
    expect(familySizeMultiplierBps(10)).toBe(14_800);
    expect(familySizeMultiplierBps(12)).toBe(16_400);
    expect(familySizeMultiplierBps(20)).toBe(22_800);
    expect(HUD_FAMILY_SIZE_MULTIPLIERS).toEqual({ bySizeBps: [7000, 8000, 9000, 10000, 10800, 11600, 12400, 13200], additionalPersonBps: 800, citation: expect.stringContaining("Table 1") });
    expect(Object.isFrozen(HUD_FAMILY_SIZE_MULTIPLIERS)).toBe(true);
    expect(Object.isFrozen(HUD_FAMILY_SIZE_MULTIPLIERS.bySizeBps)).toBe(true);
  });

  it("computes the limit from that multiplier", () => {
    expect(limit("48201", 9)).toBe(43_680_000); // 3 x 104,000 x 1.40 = $436,800
    expect(limit("48201", 10)).toBe(46_176_000); // x 1.48
    expect(limit("48201", 12)).toBe(51_168_000); // x 1.64
    expect(limit("48201", 100)).toBe(270_816_000); // 1.32 + 92 x 0.08 = 8.68
    const nine = getThreshold({ countyFips: "48201", householdSize: 9, table: hud });
    expect(nine).toMatchObject({ multiplierBps: 14_000, multiplier: "1.40", householdSize: 9 });
    expect(nine.formula).toBe("300% x $104,000 area median income x 1.40 family-size multiplier (9 persons: 1.32 for 8 persons + 0.08 x 1 additional) = $436,800.00");
    // Each additional person adds exactly 8% of the four-person limit.
    for (let size = 9; size <= 15; size++) {
      expect(limit("48453", size) - limit("48453", size - 1)).toBe((limit("48453", 4) * 8) / 100);
    }
  });

  it("uses the multiplier table stored in the dataset, not a constant", () => {
    const dataset = JSON.parse(JSON.stringify(syntheticTable(100_000).dataset)) as HudDerivedDataset;
    dataset.multipliers.bySizeBps = [7000, 8000, 9000, 10000, 10800, 11600, 12400, 13_500]; // SYNTHETIC change
    dataset.multipliers.additionalPersonBps = 1_000;
    const table = buildTable(dataset, { requireAllCounties: false });
    expect(limit("48999", 8, undefined, table)).toBe(40_500_000);
    expect(limit("48999", 9, undefined, table)).toBe(43_500_000);
  });
});

describe("SGO stricter caps", () => {
  it("scales the limit by the cap percentage and keeps reporting the statutory limit", () => {
    expect(limit("48201", 4, 250)).toBe(26_000_000); // 2.5 x 104,000 = $260,000
    expect(limit("48201", 4, 185)).toBe(19_240_000); // 1.85 x 104,000 = $192,400
    expect(limit("48201", 5, 185)).toBe(20_779_200); // 1.85 x 104,000 x 1.08 = $207,792
    expect(limit("48201", 4, 100)).toBe(10_400_000); // the median itself
    expect(limit("48201", 4, 1)).toBe(104_000);
    expect(limit("48201", 4, 300)).toBe(limit("48201", 4));
    expect(STATUTORY_CAP_PCT).toBe(300);

    const capped = getThreshold({ countyFips: "48201", householdSize: 5, capPct: 185, table: hud });
    expect(capped).toMatchObject({ capPct: 185, thresholdCents: 20_779_200, statutoryThresholdCents: 33_696_000, multiplierBps: 10_800, exact: true, provisional: true });
    expect(capped.formula).toBe("185% x $104,000 area median income x 1.08 family-size multiplier (5 persons) = $207,792.00 (stricter cap; the limit at the statutory 300% is $336,960.00)");
    expect(thresholdRow("48201", { capPct: 250, table: hud })).toMatchObject({ capPct: 250, thresholds: expect.arrayContaining([expect.objectContaining({ householdSize: 4, thresholdCents: 26_000_000, statutoryThresholdCents: 31_200_000, multiplierBps: 10_000, lowerBoundCents: 26_000_000, upperBoundCents: 26_000_000, readingsAgree: true })]) });
  });

  it("is exact for every county, size and whole-percent cap, and never exceeds the statutory limit", () => {
    for (const county of listCounties(hud)) {
      for (const capPct of [1, 50, 80, 185, 200, 250, 299]) {
        for (const size of [1, 4, 5, 8, 11]) {
          const result = getThreshold({ countyFips: county.fips, householdSize: size, capPct, table: hud });
          expect(result.exact).toBe(true);
          expect(BigInt(result.thresholdCents) * 300n).toBe(BigInt(result.statutoryThresholdCents) * BigInt(capPct));
          expect(result.thresholdCents).toBeLessThan(result.statutoryThresholdCents);
        }
      }
    }
  });

  it("keeps the reviewed defaults for the points the sources do not settle", () => {
    // Changing any of these changes decisions or what the ingest accepts. Review with the founder first.
    expect(AMI_POLICY).toEqual({
      subCentRounding: "floor",
      capOnPublishedLimit: "proportional",
      aboveEightWithoutPublishedIncrement: "refuse",
      irsLimitsMustNotDecreaseWithFamilySize: true,
      section8VliAboveEight: "four_person_x_multiplier_round_up_50",
    });
    expect(Object.isFrozen(AMI_POLICY)).toBe(true);
  });

  it("floors to the cent, and says so, when the exact product is not a whole number of cents", () => {
    // SYNTHETIC median chosen so that 185% x median x 1.08 falls between two cents.
    const table = syntheticTable(33_333);
    const result = getThreshold({ countyFips: "48999", householdSize: 5, capPct: 185, table });
    const numerator = 33_333n * 185n * 10_800n;
    expect(numerator % 10_000n).not.toBe(0n);
    expect(BigInt(result.thresholdCents)).toBe(numerator / 10_000n);
    expect(result.thresholdCents).toBe(6_659_933);
    expect(result.exact).toBe(false);
    expect(result.formula).toContain("(rounded down to the cent; stricter cap; the limit at the statutory 300% is $107,998.92)");
    // At the statutory 300% the product is always a whole number of cents, whatever the median.
    expect(getThreshold({ countyFips: "48999", householdSize: 5, table }).exact).toBe(true);
  });

  it.each([301, 1000, 0, -1, -300, 299.5, 300.0001, Number.NaN, Number.POSITIVE_INFINITY, "300", "250%", true, {}])("rejects cap %j", (capPct) => {
    const error = expectInvalid(() => getThreshold({ countyFips: "48201", householdSize: 4, capPct: capPct as number, table: hud }), "invalid_cap_pct", "capPct");
    expect(error.message).toMatch(/whole percent from 1 to 300/);
    expect(() => thresholdRow("48201", { capPct: capPct as number, table: hud })).toThrow(AppError);
  });

  it("treats a missing cap as the statutory 300%", () => {
    expect(getThreshold({ countyFips: "48201", householdSize: 4, capPct: undefined, table: hud }).capPct).toBe(300);
    expect(getThreshold({ countyFips: "48201", householdSize: 4, capPct: null as unknown as undefined, table: hud }).capPct).toBe(300);
  });
});

describe("invalid input", () => {
  it.each([0, -1, -4, 1.5, 3.999, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, "4", "", null, undefined, true, [4], {}])("rejects household size %j", (householdSize) => {
    const error = expectInvalid(() => getThreshold({ countyFips: "48201", householdSize: householdSize as number, table: hud }), "invalid_household_size", "householdSize");
    expect(error.message).toMatch(/Household size must be a whole number of at least 1/);
    expect(() => familySizeMultiplierBps(householdSize as number)).toThrow(AppError);
  });

  it("rejects a household size so large that the limit cannot be represented", () => {
    expectInvalid(() => getThreshold({ countyFips: "48201", householdSize: 9_000_000_000_000_000, table: hud }), "invalid_household_size", "householdSize");
    expect(limit("48201", 1_000_000)).toBe(2_496_021_216_000); // multiplier 80,000.68 x $312,000
  });

  it.each(["4820", "482011", "48-01", " 48201", "48201 ", "", "4820A", "four8", "４８２０１", "4.8e4", 48201, null, undefined, ["48201"], {}])("rejects malformed county FIPS %j", (countyFips) => {
    const error = expectInvalid(() => getThreshold({ countyFips: countyFips as string, householdSize: 4, table: hud }), "malformed_county_fips", "countyFips");
    expect(error.message).toMatch(/County FIPS code must be five digits/);
  });

  it.each(["06037", "40001", "05091", "22017", "35013", "00000", "99999", "47201"])("rejects non-Texas county FIPS %s", (countyFips) => {
    const error = expectInvalid(() => getThreshold({ countyFips, householdSize: 4, table: hud }), "county_outside_state", "countyFips");
    expect(error.message).toBe(`County FIPS code ${countyFips} is not a Texas county. Table hud-fy2026-tx covers Texas only.`);
  });

  it.each(["48000", "48002", "48200", "48202", "48508", "48509", "48999"])("rejects unknown Texas county FIPS %s", (countyFips) => {
    const error = expectInvalid(() => getThreshold({ countyFips, householdSize: 4, table: hud }), "unknown_county", "countyFips");
    expect(error.message).toBe(`County FIPS code ${countyFips} is not a Texas county in table hud-fy2026-tx.`);
    expect(() => thresholdRow(countyFips, { table: hud })).toThrow(AppError);
  });

  it("lookups return null or an empty list instead of throwing", () => {
    for (const bad of ["48002", "06037", "", "Harris County", 48201 as unknown as string, null as unknown as string]) {
      expect(getCounty(bad, hud)).toBeNull();
      expect(getArea(bad, hud)).toBeNull();
      expect(countiesInArea(bad, hud)).toEqual([]);
    }
    expect(getCounty("48201", hud)).toEqual({ fips: "48201", name: "Harris County", areaCode: "METRO26420M26420", areaName: "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area" });
  });

  it("does not let a caller change the table, through a returned value or through the table itself", () => {
    const area = getArea("METRO26420M26420", hud)!;
    area.countyFips.push("48999");
    area.medianIncomeCents = 1;
    expect(getArea("METRO26420M26420", hud)!.countyFips).toHaveLength(7);

    expect(Object.isFrozen(hudDataset)).toBe(true);
    expect(Object.isFrozen(hudDataset.areas)).toBe(true);
    expect(Object.isFrozen(hudDataset.multipliers.bySizeBps)).toBe(true);
    const houston = hudDataset.areas.find((candidate) => candidate.code === "METRO26420M26420")!;
    expect(() => {
      houston.medianIncomeDollars = 1;
    }).toThrow(TypeError);
    expect(() => {
      (hudDataset.multipliers.bySizeBps as number[])[3] = 1;
    }).toThrow(TypeError);
    expect(limit("48201", 4)).toBe(31_200_000);

    // Building a table does not freeze or alter the object it was given.
    const raw = JSON.parse(JSON.stringify(hudDataset)) as HudDerivedDataset;
    buildTable(raw);
    expect(Object.isFrozen(raw)).toBe(false);
  });
});

describe("table registry", () => {
  it(`the active table is ${EXPECTED_ACTIVE_VERSION} (${EXPECTED_ACTIVE_SOURCE})`, () => {
    const active = getActiveTable();
    expect(active.version).toBe(EXPECTED_ACTIVE_VERSION);
    expect(active.source).toBe(EXPECTED_ACTIVE_SOURCE);
    expect(active.provisional).toBe(EXPECTED_ACTIVE_SOURCE === "hud_provisional");
    expect(active).toBe(getTable(EXPECTED_ACTIVE_VERSION));
    expect(active).toMatchObject({ state: "TX", stateFips: "48" });

    // Calls without a table use the active one.
    const explicit = getThreshold({ countyFips: "48201", householdSize: 4, table: active });
    expect(getThreshold({ countyFips: "48201", householdSize: 4 })).toEqual(explicit);
    expect(explicit).toMatchObject({ tableVersion: EXPECTED_ACTIVE_VERSION, source: EXPECTED_ACTIVE_SOURCE, provisional: active.provisional, effectiveDate: active.effectiveDate });
    expect(thresholdRow("48201")).toEqual(thresholdRow("48201", { table: active }));
    expect(listCounties()).toEqual(listCounties(active));
    expect(listCounties()).toHaveLength(254);
    expect(getCounty("48201")).toEqual(getCounty("48201", active));
    expect(getCounty("48201")!.name).toBe("Harris County");
    const areaCode = getCounty("48201")!.areaCode;
    expect(getArea(areaCode)).toEqual(getArea(areaCode, active));
    expect(countiesInArea(areaCode)).toEqual(countiesInArea(areaCode, active));
  });

  it("while the active table is HUD-derived, results are provisional and Harris County is $312,000 for four", () => {
    if (EXPECTED_ACTIVE_SOURCE !== "hud_provisional") return;
    expect(getThreshold({ countyFips: "48201", householdSize: 4 })).toMatchObject({ provisional: true, source: "hud_provisional", thresholdCents: 31_200_000, effectiveDate: "2026-05-01" });
    expect(describeThresholdSource(getActiveTable()).badge).toBe("Provisional");
  });

  it("the active table carries two readings while provisional and exactly one once IRS-published (swap-in check)", () => {
    const active = getActiveTable();
    const expectedIds = active.provisional ? ["median_product", "section8_vli"] : ["irs_published"];
    expect(describeThresholdSource(active).readingIds).toEqual(expectedIds);
    expect(describeThresholdSource(active).readingsNote === null).toBe(!active.provisional);
    for (const county of listCounties(active)) {
      for (const entry of thresholdRow(county.fips).thresholds) {
        expect(entry.readings.map((reading) => reading.id), `${county.fips} size ${entry.householdSize}`).toEqual(expectedIds);
        if (!active.provisional) {
          expect([entry.lowerBoundCents, entry.upperBoundCents, entry.readingsAgree]).toEqual([entry.thresholdCents, entry.thresholdCents, true]);
        }
      }
    }
  });

  it("lists installed tables and flags exactly one as active", () => {
    const tables = listTables();
    expect(tables).toContainEqual({ version: "hud-fy2026-tx", source: "hud_provisional", method: "hud_median_x_cap_pct_x_family_size_multiplier_v1", state: "TX", effectiveDate: "2026-05-01", provisional: true, active: EXPECTED_ACTIVE_VERSION === "hud-fy2026-tx", countyCount: 254, areaCount: 215 });
    expect(tables.filter((table) => table.active)).toHaveLength(1);
    expect(() => getTable("no-such-table")).toThrow(/AMI table no-such-table is not installed/);
    try {
      getTable("no-such-table");
    } catch (error) {
      expect((error as AppError).code).toBe("not_found");
    }
  });

  it("every installed table covers all 254 Texas counties with limits that never fall as the household grows", () => {
    for (const summary of listTables()) {
      const table = getTable(summary.version);
      expect(summary.countyCount, summary.version).toBe(254);
      expect(table.provisional).toBe(table.source === "hud_provisional");
      for (const county of listCounties(table)) {
        const cents = thresholdRow(county.fips, { table }).thresholds.map((entry) => entry.thresholdCents);
        expect(cents).toHaveLength(8);
        expect(cents[0]).toBeGreaterThan(0);
        for (let i = 1; i < cents.length; i++) expect(cents[i], `${summary.version} ${county.fips}`).toBeGreaterThanOrEqual(cents[i - 1]);
      }
      const description = describeThresholdSource(table);
      expect(description.provisional).toBe(table.provisional);
      expect(description.badge).toBe(table.provisional ? "Provisional" : "IRS-published");
    }
  });

  it("refuses an active pointer that names a missing table, duplicate versions, and malformed pointers", () => {
    const raw = hudDataset;
    expect(() => createTableRegistry({ datasets: [raw], activePointer: { activeVersion: "irs-2027" } })).toThrow(/names table irs-2027, which is not installed \(installed: hud-fy2026-tx\)/);
    expect(() => createTableRegistry({ datasets: [raw, raw], activePointer: { activeVersion: "hud-fy2026-tx" } })).toThrow(/installed more than once/);
    expect(() => createTableRegistry({ datasets: [raw], activePointer: { active: "hud-fy2026-tx" } })).toThrow(/active pointer is not valid/);
    expect(() => createTableRegistry({ datasets: [raw], activePointer: { activeVersion: "hud-fy2026-tx", extra: 1 } })).toThrow(/active pointer is not valid/);
    expect(() => createTableRegistry({ datasets: [raw], activePointer: "hud-fy2026-tx" })).toThrow(/active pointer is not valid/);

    const noActive = createTableRegistry({ datasets: [raw], activePointer: null });
    expect(noActive.listTables()).toEqual([expect.objectContaining({ version: "hud-fy2026-tx", active: false })]);
    expect(noActive.getTable("hud-fy2026-tx").version).toBe("hud-fy2026-tx");
    expect(() => noActive.getActiveTable()).toThrow(/No AMI table is active/);
  });
});

describe("IRS-published tables are exactly their archived transcriptions", () => {
  const irsTables = listTables().filter((table) => table.source === "irs_published");
  const archive = (version: string) => join(REPO_ROOT, "data/ami/sources", `${version}.csv`);

  it("an IRS table is installed exactly when the tripwire says the active source is IRS-published, or is waiting for activation", () => {
    if (EXPECTED_ACTIVE_SOURCE === "irs_published") expect(irsTables.map((table) => table.version)).toContain(EXPECTED_ACTIVE_VERSION);
    for (const table of irsTables) expect(existsSync(archive(table.version)), `${archive(table.version)} must be committed`).toBe(true);
  });

  it.each(irsTables)("$version: every county x household sizes 1-8 equals the transcription, byte-for-byte the ingested file", ({ version }) => {
    const table = getTable(version);
    const bytes = readFileSync(archive(version));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(table.dataset.sourceFile.sha256);
    expect(transcriptionMismatches(table, bytes.toString("utf8"))).toEqual([]);
  });
});

describe("dataset validation", () => {
  const clone = () => JSON.parse(JSON.stringify(hudDataset)) as HudDerivedDataset & Record<string, unknown>;

  function problems(mutate: (dataset: ReturnType<typeof clone>) => void): string {
    const dataset = clone();
    mutate(dataset);
    try {
      buildTable(dataset);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("internal");
      return (error as AppError).message;
    }
    throw new Error("expected buildTable to reject the dataset");
  }

  it("accepts the committed dataset unchanged", () => {
    expect(buildTable(clone()).countyByFips.size).toBe(254);
  });

  it("rejects a table that does not have exactly 254 Texas counties", () => {
    expect(
      problems((dataset) => {
        const removed = dataset.counties.pop()!;
        dataset.areas = dataset.areas.filter((area) => area.code !== removed.areaCode);
      }),
    ).toMatch(/expected exactly 254 TX counties, found 253/);
  });

  it("rejects thresholds or any other unexpected field stored in a HUD-derived dataset", () => {
    expect(problems((dataset) => void (dataset.thresholds = { "48201": [1] }))).toMatch(/Unrecognized key/i);
    expect(problems((dataset) => void ((dataset.areas[0] as unknown as Record<string, unknown>).limitCents = [1, 2, 3, 4, 5, 6, 7, 8]))).toMatch(/Unrecognized key/i);
  });

  it("rejects broken references, duplicates, wrong order and out-of-state counties", () => {
    expect(problems((dataset) => void (dataset.counties[0].areaCode = "NOPE"))).toMatch(/county 48001 refers to unknown area NOPE/);
    expect(problems((dataset) => void (dataset.counties[1] = { ...dataset.counties[0] }))).toMatch(/county 48001 is listed more than once/);
    expect(problems((dataset) => void dataset.counties.reverse())).toMatch(/counties must be sorted by FIPS code/);
    expect(problems((dataset) => void dataset.areas.reverse())).toMatch(/areas must be sorted by code/);
    expect(problems((dataset) => void (dataset.areas[1] = { ...dataset.areas[0] }))).toMatch(/is listed more than once/);
    expect(problems((dataset) => void (dataset.counties[0].fips = "06037"))).toMatch(/county 06037 is not in state 48/);
    expect(problems((dataset) => void (dataset.counties[0].fips = "4801"))).toMatch(/5-digit state \+ county FIPS code/);
    expect(problems((dataset) => void (dataset.stateFips = "06"))).toMatch(/stateFips must be 48 for TX/);
  });

  it("rejects bad medians, multipliers, dates, hashes, versions and sources", () => {
    expect(problems((dataset) => void (dataset.areas[0].medianIncomeDollars = 0))).toMatch(/medianIncomeDollars/);
    expect(problems((dataset) => void (dataset.areas[0].medianIncomeDollars = 92100.5))).toMatch(/medianIncomeDollars/);
    expect(problems((dataset) => void (dataset.areas[0].medianIncomeDollars = "92100" as unknown as number))).toMatch(/medianIncomeDollars/);
    expect(problems((dataset) => void (dataset.multipliers.bySizeBps = [7000, 8000, 9000, 10000, 10800, 11600, 12400]))).toMatch(/multipliers\.bySizeBps/);
    expect(problems((dataset) => void (dataset.multipliers.bySizeBps = [7000, 8000, 9000, 10000, 10800, 11600, 12400, 12400]))).toMatch(/multipliers must increase with family size \(size 8\)/);
    expect(problems((dataset) => void (dataset.multipliers.additionalPersonBps = 0))).toMatch(/additionalPersonBps/);
    expect(problems((dataset) => void (dataset.effectiveDate = "2026-13-01"))).toMatch(/effectiveDate/);
    expect(problems((dataset) => void (dataset.sourceFile.sha256 = "ABC"))).toMatch(/sha256/);
    expect(problems((dataset) => void (dataset.version = "HUD FY2026"))).toMatch(/version/);
    expect(problems((dataset) => void ((dataset as { source: string }).source = "census"))).toMatch(/source/);
    expect(problems((dataset) => void ((dataset as { schemaVersion: number }).schemaVersion = 2))).toMatch(/schemaVersion/);
    expect(() => buildTable(null)).toThrow(/AMI dataset \(unknown version\) is not valid/);
  });

  it("rejects missing, short, inconsistent or decreasing very-low-income limits in a HUD-derived dataset", () => {
    type Mutable = { hudPublished: { veryLowIncomeBySizeDollars?: number[]; veryLowIncome4PersonDollars: number } };
    const area0 = (dataset: ReturnType<typeof clone>) => dataset.areas[0] as unknown as Mutable;
    expect(problems((dataset) => void delete area0(dataset).hudPublished.veryLowIncomeBySizeDollars)).toMatch(/veryLowIncomeBySizeDollars/);
    expect(problems((dataset) => void area0(dataset).hudPublished.veryLowIncomeBySizeDollars!.pop())).toMatch(/veryLowIncomeBySizeDollars/);
    expect(problems((dataset) => void (area0(dataset).hudPublished.veryLowIncomeBySizeDollars![0] = 0))).toMatch(/veryLowIncomeBySizeDollars/);
    expect(problems((dataset) => void (area0(dataset).hudPublished.veryLowIncomeBySizeDollars![2] = 32250.5))).toMatch(/veryLowIncomeBySizeDollars/);
    expect(problems((dataset) => void (area0(dataset).hudPublished.veryLowIncomeBySizeDollars![3] += 50))).toMatch(/four-person very-low-income limit .* differs from veryLowIncome4PersonDollars/);
    expect(problems((dataset) => void (area0(dataset).hudPublished.veryLowIncomeBySizeDollars![7] = 1))).toMatch(/very-low-income limit for 8 persons is lower than for 7 persons/);
  });

  it("validates calendar dates", () => {
    expect(isIsoCalendarDate("2026-05-01")).toBe(true);
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-29", "2026-02-30", "2026-00-10", "2026-13-01", "2026-5-1", "05/01/2026", "2026-05-01T00:00:00Z", ""]) {
      expect(isIsoCalendarDate(bad), bad).toBe(false);
    }
  });
});

describe("source labels", () => {
  const en = describeThresholdSource(hud);
  const es = describeThresholdSource(hud, "es");
  const allEnglish = [en.badge, en.limitLabel, en.sourceLine, en.explanation, en.familyNote, en.readingsNote].join(" ");
  const allSpanish = [es.badge, es.limitLabel, es.sourceLine, es.explanation, es.familyNote, es.readingsNote].join(" ");

  it("labels the HUD-derived table provisional, with its source, effective date and table version", () => {
    expect(en).toEqual({
      copyVersion: THRESHOLD_COPY_VERSION,
      locale: "en",
      source: "hud_provisional",
      provisional: true,
      tableVersion: "hud-fy2026-tx",
      effectiveDate: "2026-05-01",
      badge: "Provisional",
      limitLabel: "Provisional income limit (HUD-derived)",
      sourceLine: "Provisional, HUD-derived limit computed from HUD FY 2026 area median family income (effective May 1, 2026). This is not an IRS-published limit.",
      explanation:
        "This income limit is provisional. It is computed from the HUD FY 2026 area median family income (effective May 1, 2026) and the HUD family-size adjustment, " +
        "using the calculation described in the notice of proposed rulemaking (REG-117199-25): 300 percent of area median gross income multiplied by the family-size multiplier. " +
        "The proposed rules are not final. This is not an IRS-published limit. The IRS has said it anticipates publishing the applicable limits by geographic area and family size in the Internal Revenue Bulletin; " +
        "IRS-published limits replace this provisional figure once they are in use. Table version: hud-fy2026-tx.",
      familyNote:
        "This income limit is provisional. It is based on the median income HUD publishes for your area and on your household size. " +
        "The IRS has said it expects to publish official limits; when those are in use, they replace this number.",
      readingIds: ["median_product", "section8_vli"],
      readingsNote:
        "The proposed rule can be read two ways: 300 percent of HUD's area median income times the family-size multiplier, " +
        "or six times HUD's Section 8 very-low-income limit for the family size. Which one the IRS will use is not yet known. " +
        "Where the two give different limits, automatic decisions use the lower figure to approve and the higher figure to decline; " +
        "incomes in between are reviewed by a person.",
    });
    expect(THRESHOLD_COPY_VERSION).toBe("threshold-source-copy.v2");
  });

  it("never says or implies that the IRS table has been published", () => {
    for (const sentence of [en.sourceLine, en.explanation, en.familyNote, en.limitLabel]) {
      expect(sentence).toMatch(/provisional/i);
    }
    // Every mention of an IRS-published limit is a denial or a statement about the future.
    expect(allEnglish).not.toMatch(/\b(has|have|was|were) published\b/i);
    expect(allEnglish).not.toMatch(/the IRS published|published by the IRS|IRS table\b|official limit\b(?!s)/i);
    expect(allEnglish.match(/IRS-published/g)).toHaveLength(3);
    expect(allEnglish).toContain("This is not an IRS-published limit.");
    expect(allEnglish).toContain("anticipates publishing");
    expect(allEnglish).toContain("proposed rules are not final");
  });

  it("gives the same message in Spanish for family screens", () => {
    expect(es).toMatchObject({ locale: "es", provisional: true, badge: "Provisional", limitLabel: "Límite de ingresos provisional (derivado de HUD)" });
    expect(es.sourceLine).toBe(
      "Límite provisional derivado de HUD, calculado con el ingreso familiar medio del área del año fiscal 2026 de HUD (vigente desde el 1 de mayo de 2026). No es un límite publicado por el IRS.",
    );
    expect(es.familyNote).toBe(
      "Este límite de ingresos es provisional. Se basa en el ingreso medio que HUD publica para su área y en el tamaño de su hogar. El IRS ha indicado que prevé publicar límites oficiales; cuando estén en uso, reemplazarán esta cifra.",
    );
    expect(es.explanation).toContain("Las reglas propuestas no son definitivas. No es un límite publicado por el IRS.");
    expect(allSpanish).not.toMatch(/el IRS publicó|ha publicado|fue publicad/i);
  });

  it("names the two sources for the threshold_source field", () => {
    expect(thresholdSourceName("hud_provisional")).toBe("HUD-derived (provisional)");
    expect(thresholdSourceName("irs_published")).toBe("IRS-published");
    expect(thresholdSourceName("hud_provisional", "es")).toBe("Derivado de HUD (provisional)");
    expect(thresholdSourceName("irs_published", "es")).toBe("Publicado por el IRS");
  });
});

describe("the engine is pure", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "__golden__" ? [] : sourceFiles(path);
      return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "synthetic-fixtures.ts" ? [path] : [];
    });
  }
  const files = sourceFiles(HERE);

  it("has no file system, network, environment, clock or randomness in any engine or ingest module", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
    const forbidden = [/from "node:/, /\brequire\(/, /\bprocess\./, /Date\.now\(/, /new Date\(\s*\)/, /\bfetch\(/, /Math\.random\(/, /XMLHttpRequest/, /from "next/, /from "@\/(server|db|app)/];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false);
    }
  });

  it("imports only src/lib, its own modules, the dataset files and the three parsing libraries", () => {
    const allowed = /^(\.{1,2}\/|@\/lib\/|zod$|fflate$|fast-xml-parser$)/;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)";/gm)) {
        expect(allowed.test(match[1]), `${file} imports ${match[1]}`).toBe(true);
      }
    }
  });

  it("gives the same answer for the same input, and the input is not modified", () => {
    const input: GetThresholdInput = { countyFips: "48201", householdSize: 6, capPct: 250, table: hud };
    const snapshot = JSON.stringify({ ...input, table: undefined });
    const first = getThreshold(input);
    const second = getThreshold(input);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(JSON.stringify({ ...input, table: undefined })).toBe(snapshot);
  });
});
