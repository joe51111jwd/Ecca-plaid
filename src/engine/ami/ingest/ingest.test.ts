/**
 * OWNED BY THE FOUNDER (James). These tests guard the numbers every scholarship decision depends on.
 *
 * Do not change an expected number, loosen a validation, or delete a case here without human review by the
 * owner. If a golden number has to change, regenerate it with `python3 -I scripts/ami-golden.py`, review
 * the diff by hand, and commit the golden file together with the reason.
 *
 * All fixtures built in this file are SYNTHETIC (see synthetic-fixtures.ts). The only real data read here
 * is the official HUD workbook in data/hud and the dataset committed from it in data/ami.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { runAmiIngest } from "../../../../scripts/ami-ingest";
import { buildTable, createTableRegistry, describeThresholdSource, getTable, getThreshold, thresholdRow, type AmiTable, type HudDerivedDataset, type IrsPublishedDataset } from "../index";
import { transcriptionMismatches } from "../transcription-check";
import {
  buildHudDataset,
  buildIrsDataset,
  compareIrsTranscriptions,
  diffTables,
  diffToCsv,
  findHudReleaseBySha256,
  formatDiffReport,
  IRS_CSV_COLUMNS,
  KNOWN_HUD_RELEASES,
  listXlsxSheets,
  readXlsxSheet,
  renderIrsCsvTemplate,
  renderRegistryModule,
  serializeActivePointer,
  serializeDataset,
} from "./index";
import {
  buildSyntheticHudWorkbook,
  buildSyntheticXlsx,
  HUD_COLUMN,
  irsRowsToCsv,
  SYNTHETIC_AREA_A,
  SYNTHETIC_AREA_B,
  SYNTHETIC_IRS_INCREMENT_DOLLARS,
  SYNTHETIC_SOURCE_FILE,
  syntheticIrsLimitDollars,
  syntheticIrsRows,
  texasRowIndex,
  workbookParts,
  zipWorkbookParts,
  type IrsCsvRow,
} from "./synthetic-fixtures";
import type { XlsxCell } from "./xlsx";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/[\\/]$/, "");
const HUD_XLSX = join(REPO_ROOT, "data/hud/Section8-FY26.xlsx");
const HUD_DATASET_JSON = join(REPO_ROOT, "data/ami/hud-fy2026-tx.json");
const PINNED_SHA256 = "bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0";
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function problemsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("validation_failed");
    const details = appError.details as { problems?: string[] } | undefined;
    return details?.problems ?? [appError.message];
  }
  throw new Error("expected the ingest to fail, but it succeeded");
}

function hudInput(workbook: Uint8Array) {
  return {
    workbook,
    state: "TX" as const,
    sourceFile: { ...SYNTHETIC_SOURCE_FILE },
    effectiveDate: "2026-05-01",
    effectiveDateCitation: "SYNTHETIC citation",
  };
}

function ingestSyntheticHud(mutate?: (rows: XlsxCell[][], header: string[]) => void) {
  return buildHudDataset(hudInput(buildSyntheticHudWorkbook(mutate)));
}

describe("xlsx reader", () => {
  const rows: XlsxCell[][] = [
    ["fips", "name", "median"],
    ["0100199999", "A & B <County>", 104000],
    ["4820199999", null, 1.5],
    [null, null, null],
    ["x", " padded ", true],
  ];

  it("reads shared-string and inline-string workbooks identically", () => {
    const shared = readXlsxSheet(buildSyntheticXlsx([{ name: "Data", rows }], { strings: "shared" }), "Data");
    const inline = readXlsxSheet(buildSyntheticXlsx([{ name: "Data", rows }], { strings: "inline" }), "Data");
    expect(inline).toEqual(shared);
    expect(shared.map((row) => row.rowNumber)).toEqual([1, 2, 3, 5]);
    expect(shared[1].cells).toEqual(["0100199999", "A & B <County>", 104000]);
    expect(shared[2].cells).toEqual(["4820199999", null, 1.5]);
    expect(shared[3].cells).toEqual(["x", " padded ", true]);
  });

  it("keeps leading zeros of text cells and never turns a FIPS code into a number", () => {
    const [, first] = readXlsxSheet(buildSyntheticXlsx([{ name: "Data", rows }]), "Data");
    expect(first.cells[0]).toBe("0100199999");
    expect(typeof first.cells[0]).toBe("string");
  });

  it("reads cells that carry no cell references", () => {
    const withRefs = readXlsxSheet(buildSyntheticXlsx([{ name: "Data", rows }]), "Data");
    const withoutRefs = readXlsxSheet(buildSyntheticXlsx([{ name: "Data", rows }], { cellRefs: false }), "Data");
    expect(withoutRefs).toEqual(withRefs);
  });

  it("joins rich-text runs, ignores phonetic text, decodes entities and control-character escapes", () => {
    const sharedStrings =
      `<sst xmlns="${MAIN_NS}">` +
      "<si><r><rPr><b/></rPr><t>Hello</t></r><r><t xml:space=\"preserve\"> World</t></r><rPh sb=\"0\" eb=\"1\"><t>IGNORED</t></rPh></si>" +
      "<si><t>Tom &amp; Jerry &lt;TX&gt; &#65;&#x42; &amp;#67;</t></si>" +
      "<si><t>line_x000A_break</t></si>" +
      "<si><t/></si>" +
      "</sst>";
    const sheet =
      `<worksheet xmlns="${MAIN_NS}"><sheetData>` +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="F1" t="str"><f>A1</f><v>formula text</v></c><c r="G1"><v>1.04E5</v></c></row>' +
      "</sheetData></worksheet>";
    const workbook = zipWorkbookParts(workbookParts([{ name: "Data", xml: sheet }], sharedStrings));
    expect(readXlsxSheet(workbook, "Data")).toEqual([{ rowNumber: 1, cells: ["Hello World", "Tom & Jerry <TX> AB &#67;", "line\nbreak", "", null, "formula text", 104000] }]);
  });

  it("reads namespace-prefixed workbook XML", () => {
    const sheet = `<x:worksheet xmlns:x="${MAIN_NS}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>prefixed</x:t></x:is></x:c><x:c r="B1"><x:v>7</x:v></x:c></x:row></x:sheetData></x:worksheet>`;
    expect(readXlsxSheet(zipWorkbookParts(workbookParts([{ name: "Data", xml: sheet }], null)), "Data")).toEqual([{ rowNumber: 1, cells: ["prefixed", 7] }]);
  });

  it("lists sheets and names them when the requested sheet is missing", () => {
    const workbook = buildSyntheticXlsx([
      { name: "First & Second", rows: [["a"]] },
      { name: "Other", rows: [["b"]] },
    ]);
    expect(listXlsxSheets(workbook)).toEqual(["First & Second", "Other"]);
    expect(readXlsxSheet(workbook, "First & Second")).toEqual([{ rowNumber: 1, cells: ["a"] }]);
    expect(() => readXlsxSheet(workbook, "Missing")).toThrow(/no sheet named "Missing" \(sheets: "First & Second", "Other"\)/);
  });

  it("fails loudly on anything it does not understand", () => {
    const sheetWith = (cell: string) => zipWorkbookParts(workbookParts([{ name: "Data", xml: `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1">${cell}</row></sheetData></worksheet>` }], `<sst xmlns="${MAIN_NS}"><si><t>only</t></si></sst>`));

    expect(() => readXlsxSheet(new Uint8Array([1, 2, 3, 4]), "Data")).toThrow(/not a readable \.xlsx workbook/);
    expect(() => readXlsxSheet(zipWorkbookParts({ "hello.txt": "hi" }), "Data")).toThrow(/missing the part _rels\/\.rels/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1" t="e"><v>#N/A</v></c>'), "Data")).toThrow(/Cell A1 contains a spreadsheet error \(#N\/A\)/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1" t="s"><v>5</v></c>'), "Data")).toThrow(/Cell A1 points at shared string "5"/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1" t="s"><v>-1</v></c>'), "Data")).toThrow(/shared string/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1"><v>twelve</v></c>'), "Data")).toThrow(/Cell A1 should be a number but contains "twelve"/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1"><v>0x1A</v></c>'), "Data")).toThrow(/Cell A1 should be a number but contains "0x1A"/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1"><v>Infinity</v></c>'), "Data")).toThrow(/Cell A1 should be a number/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1" t="zz"><v>1</v></c>'), "Data")).toThrow(/unsupported cell type "zz"/);
    expect(() => readXlsxSheet(sheetWith('<c r="1A"><v>1</v></c>'), "Data")).toThrow(/malformed cell reference/);
    expect(() => readXlsxSheet(sheetWith('<c r="ZZZZZZ1"><v>1</v></c>'), "Data")).toThrow(/beyond the last possible column/);
    expect(() => readXlsxSheet(sheetWith('<c r="A1" t="inlineStr"><is><t>&bogus;</t></is></c>'), "Data")).toThrow(/entity that is not allowed/);

    const doctype = workbookParts([{ name: "Data", xml: `<!DOCTYPE worksheet [<!ENTITY a "aaaa">]><worksheet xmlns="${MAIN_NS}"><sheetData/></worksheet>` }], null);
    expect(() => readXlsxSheet(zipWorkbookParts(doctype), "Data")).toThrow(/DOCTYPE/);

    const outOfOrder = `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="2"><c r="A2"><v>1</v></c></row><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`;
    expect(() => readXlsxSheet(zipWorkbookParts(workbookParts([{ name: "Data", xml: outOfOrder }], null)), "Data")).toThrow(/out-of-order or malformed row number/);
  });
});

describe("HUD ingest validation (synthetic workbooks)", () => {
  it("accepts a well-formed workbook: 254 Texas counties, other states ignored, headers matched by name", () => {
    const { dataset, stats } = ingestSyntheticHud();
    expect(dataset.version).toBe("hud-fy2026-tx");
    expect(dataset.source).toBe("hud_provisional");
    expect(dataset.fiscalYear).toBe(2026);
    expect(dataset.counties).toHaveLength(254);
    expect(dataset.areas).toHaveLength(251);
    expect(stats).toMatchObject({ sheetName: "Section8-FY26", fiscalYear: 2026, rowsInSheet: 256, counties: 254, areas: 251, multiCountyAreas: 2 });
    expect(dataset.counties[0]).toEqual({ fips: "48001", name: "Synthetic County 001", areaCode: SYNTHETIC_AREA_A });
    expect(dataset.counties.filter((county) => county.areaCode === SYNTHETIC_AREA_A).map((county) => county.fips)).toEqual(["48001", "48003", "48005"]);
    expect(dataset.counties.filter((county) => county.areaCode === SYNTHETIC_AREA_B).map((county) => county.fips)).toEqual(["48007", "48009"]);
    // The Arkansas row reuses area A's code with a different median; it must not leak into the Texas table.
    expect(dataset.areas.find((area) => area.code === SYNTHETIC_AREA_A)).toEqual({
      code: SYNTHETIC_AREA_A,
      name: "Synthetic Metro Area A, TX",
      metro: true,
      medianIncomeDollars: 90000,
      hudPublished: { veryLowIncome4PersonDollars: 45000, lowIncome4PersonDollars: 72000 },
    });
    expect(dataset.multipliers).toEqual({ bySizeBps: [7000, 8000, 9000, 10000, 10800, 11600, 12400, 13200], additionalPersonBps: 800, citation: expect.stringContaining("REG-117199-25") });
    expect(JSON.stringify(dataset)).not.toMatch(/threshold|limitCents/i);
  });

  it("gives the same dataset for shared-string and inline-string workbooks, with or without cell references", () => {
    const base = serializeDataset(ingestSyntheticHud().dataset);
    expect(serializeDataset(buildHudDataset(hudInput(buildSyntheticHudWorkbook(undefined, { strings: "inline" }))).dataset)).toBe(base);
    expect(serializeDataset(buildHudDataset(hudInput(buildSyntheticHudWorkbook(undefined, { cellRefs: false }))).dataset)).toBe(base);
  });

  it("does not depend on column order or header capitalization", () => {
    const base = serializeDataset(ingestSyntheticHud().dataset);
    const reordered = ingestSyntheticHud((rows, header) => {
      // Move the first column (fips) to the end and change header case.
      header.push(header.shift()!.toUpperCase());
      header[header.indexOf("County_Name")] = "COUNTY_NAME";
      for (const row of rows) row.push(row.shift()!);
    });
    expect(serializeDataset(reordered.dataset)).toBe(base);
  });

  it("fails when a Texas county row is missing", () => {
    const problems = problemsOf(() => ingestSyntheticHud((rows) => rows.splice(texasRowIndex(100), 1)));
    expect(problems).toEqual(["expected exactly 254 Texas counties, found 253 valid, distinct county rows"]);
  });

  it("fails when there is an extra Texas county", () => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        const extra = [...rows[texasRowIndex(253)]];
        extra[HUD_COLUMN.fips] = "4850999999";
        extra[HUD_COLUMN.county] = "509";
        extra[HUD_COLUMN.County_Name] = "Synthetic County 509";
        extra[HUD_COLUMN.county_town_name] = "Synthetic County 509";
        extra[HUD_COLUMN.hud_area_code] = "SYNCNTY48509";
        extra[HUD_COLUMN.hud_area_name] = "Synthetic County 509, TX";
        rows.push(extra);
      }),
    );
    expect(problems).toEqual(["expected exactly 254 Texas counties, found 255 valid, distinct county rows"]);
  });

  it("fails on a duplicated county row, even though the row count is still 254", () => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        rows[texasRowIndex(10)] = [...rows[texasRowIndex(11)]];
      }),
    );
    expect(problems).toEqual(["row 14: county FIPS 48023 already appears on row 13", "expected exactly 254 Texas counties, found 253 valid, distinct county rows"]);
  });

  it("fails on two different FIPS codes that carry the same county name", () => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        rows[texasRowIndex(20)][HUD_COLUMN.County_Name] = "Synthetic County 001";
        rows[texasRowIndex(20)][HUD_COLUMN.county_town_name] = "Synthetic County 001";
      }),
    );
    expect(problems).toEqual(['row 23: county name "Synthetic County 001" already appears on row 3 with a different FIPS code']);
  });

  it.each<[string, XlsxCell, RegExp]>([
    ["missing", null, /row 43 \(Synthetic County 081\): median2026 must be a positive whole number, found empty/],
    ["zero", 0, /median2026 must be a positive whole number, found 0/],
    ["negative", -52000, /median2026 must be a positive whole number, found -52000/],
    ["fractional", 52000.5, /median2026 must be a positive whole number, found 52000.5/],
    ["text", "52,000", /median2026 must be a positive whole number, found "52,000"/],
    ["a boolean", true, /median2026 must be a positive whole number, found true/],
  ])("fails when a county's median is %s", (_label, value, expected) => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        rows[texasRowIndex(40)][HUD_COLUMN.median2026] = value;
      }),
    );
    expect(problems[0]).toMatch(expected);
    expect(problems).toContain("expected exactly 254 Texas counties, found 253 valid, distinct county rows");
  });

  it.each<[string, XlsxCell, RegExp]>([
    ["stored as a number", 4808199999, /fips must be text, found 4808199999/],
    ["too short", "48081", /fips must be 10 digits, found "48081"/],
    ["not digits", "48081ABCDE", /fips must be 10 digits/],
    ["a sub-county row", "4808112345", /is not a whole-county row/],
    ["for a different county", "4808399999", /does not match county code "081"/],
    ["in another state", "4008199999", /does not start with state FIPS 48/],
    ["empty", "", /fips must be text, found empty/],
  ])("fails when a FIPS code is %s", (_label, value, expected) => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        rows[texasRowIndex(40)][HUD_COLUMN.fips] = value;
      }),
    );
    expect(problems[0]).toMatch(expected);
  });

  it("fails when a county has no area code, no area name or no county name", () => {
    for (const column of ["hud_area_code", "hud_area_name", "County_Name"]) {
      const problems = problemsOf(() =>
        ingestSyntheticHud((rows) => {
          rows[texasRowIndex(60)][HUD_COLUMN[column]] = null;
        }),
      );
      expect(problems[0]).toMatch(new RegExp(`row 63.*${column} must be text, found empty`));
    }
    expect(
      problemsOf(() =>
        ingestSyntheticHud((rows) => {
          rows[texasRowIndex(60)][HUD_COLUMN.hud_area_code] = "HAS SPACE";
        }),
      )[0],
    ).toMatch(/hud_area_code must not contain spaces/);
  });

  it("fails when counties of one area disagree about the area's figures", () => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        rows[texasRowIndex(1)][HUD_COLUMN.median2026] = 90100;
        rows[texasRowIndex(2)][HUD_COLUMN.hud_area_name] = "Synthetic Metro Area A (renamed)";
      }),
    );
    expect(problems).toEqual([
      `row 4 (Synthetic County 003): area ${SYNTHETIC_AREA_A} has a different median2026 than on row 3; counties in one area must share one set of figures`,
      `row 5 (Synthetic County 005): area ${SYNTHETIC_AREA_A} has a different hud_area_name than on row 3; counties in one area must share one set of figures`,
    ]);
  });

  it("fails on a bad metro flag, a sub-county town row, and missing HUD reference limits", () => {
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(7)][HUD_COLUMN.metro] = 2)))[0]).toMatch(/metro must be 0 or 1, found 2/);
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(7)][HUD_COLUMN.metro] = "1")))[0]).toMatch(/metro must be 0 or 1, found "1"/);
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(7)][HUD_COLUMN.county_town_name] = "Some town")))[0]).toMatch(/county_town_name "Some town" differs from County_Name/);
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(7)][HUD_COLUMN.l50_4] = null)))[0]).toMatch(/l50_4 must be a positive whole number, found empty/);
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(7)][HUD_COLUMN.l80_4] = "n/a")))[0]).toMatch(/l80_4 must be a positive whole number, found "n\/a"/);
  });

  it("fails when the state columns of a row disagree", () => {
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(9)][HUD_COLUMN.state] = "05")))[0]).toMatch(/row 12.*state must be "48", found "05"/);
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(9)][HUD_COLUMN.stusps] = "AR")))).toEqual([
      'row 12: state FIPS is 48 but stusps is "AR"',
      "expected exactly 254 Texas counties, found 253 valid, distinct county rows",
    ]);
    expect(problemsOf(() => ingestSyntheticHud((rows) => void (rows[texasRowIndex(9)][HUD_COLUMN.state_name] = "Tejas")))[0]).toMatch(/state_name must be "Texas", found "Tejas"/);
  });

  it("reports every problem at once, with worksheet row numbers", () => {
    const problems = problemsOf(() =>
      ingestSyntheticHud((rows) => {
        rows[texasRowIndex(0)][HUD_COLUMN.median2026] = null;
        rows[texasRowIndex(50)][HUD_COLUMN.fips] = "bad";
        rows[texasRowIndex(50)][HUD_COLUMN.metro] = 9;
        rows[texasRowIndex(253)][HUD_COLUMN.hud_area_name] = "";
      }),
    );
    expect(problems).toEqual([
      "row 3 (Synthetic County 001): median2026 must be a positive whole number, found empty",
      'row 53 (Synthetic County 101): fips must be 10 digits, found "bad"',
      "row 53 (Synthetic County 101): metro must be 0 or 1, found 9",
      "row 256 (Synthetic County 507): hud_area_name must be text, found empty",
      "expected exactly 254 Texas counties, found 251 valid, distinct county rows",
    ]);
  });

  it("fails on header problems before reading any data", () => {
    expect(problemsOf(() => ingestSyntheticHud((_rows, header) => void header.splice(header.indexOf("hud_area_code"), 1, "area")))).toEqual(['required column "hud_area_code" is missing']);
    expect(problemsOf(() => ingestSyntheticHud((_rows, header) => void (header[header.indexOf("median2026")] = "median")))).toEqual(['expected exactly one "median<year>" column, found 0']);
    expect(problemsOf(() => ingestSyntheticHud((_rows, header) => void (header[header.indexOf("ELI_1")] = "median2025")))).toEqual(['expected exactly one "median<year>" column, found 2']);
    expect(problemsOf(() => ingestSyntheticHud((_rows, header) => void (header[header.indexOf("ELI_1")] = "FIPS")))).toEqual(['header "fips" appears more than once']);
  });

  it("checks the fiscal year, the sheet, the state, the date and the version it is asked for", () => {
    const workbook = buildSyntheticHudWorkbook();
    expect(() => buildHudDataset({ ...hudInput(workbook), fiscalYear: 2027 })).toThrow(/Expected fiscal year 2027 but the workbook's "median2026" column is for 2026/);
    expect(() => buildHudDataset({ ...hudInput(workbook), sheetName: "Nope" })).toThrow(/no sheet named "Nope"/);
    expect(() => buildHudDataset({ ...hudInput(workbook), state: "CA" as "TX" })).toThrow(/State CA is not supported/);
    expect(() => buildHudDataset({ ...hudInput(workbook), effectiveDate: "2026-02-30" })).toThrow(/Effective date must be a calendar date/);
    expect(() => buildHudDataset({ ...hudInput(workbook), effectiveDateCitation: "  " })).toThrow(/citation for the effective date is required/);
    expect(() => buildHudDataset({ ...hudInput(workbook), version: "irs-2027" })).toThrow(/HUD-derived table version must look like/);
    expect(buildHudDataset({ ...hudInput(workbook), version: "hud-fy2026-tx-rev1", fiscalYear: 2026, sheetName: "Section8-FY26" }).dataset.version).toBe("hud-fy2026-tx-rev1");

    const wrongYearSheet = buildSyntheticHudWorkbook((_rows, header) => void (header[header.indexOf("median2026")] = "median2027"));
    expect(() => buildHudDataset(hudInput(wrongYearSheet))).toThrow(/disagree about the fiscal year/);

    const noDataSheet = buildSyntheticXlsx([{ name: "Other", rows: [["a"]] }]);
    expect(() => buildHudDataset(hudInput(noDataSheet))).toThrow(/Expected exactly one data sheet named "Section8-FY<yy>"/);
    const headerOnly = buildSyntheticXlsx([{ name: "Section8-FY26", rows: [["fips"]] }]);
    expect(() => buildHudDataset(hudInput(headerOnly))).toThrow(/has no data rows/);
  });
});

describe("HUD ingest of the official FY 2026 workbook", () => {
  const bytes = new Uint8Array(readFileSync(HUD_XLSX));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const release = findHudReleaseBySha256(sha256);

  function ingestOfficial() {
    return buildHudDataset({
      workbook: bytes,
      state: "TX",
      sourceFile: { name: "Section8-FY26.xlsx", sha256, url: release!.url },
      effectiveDate: release!.effectiveDate,
      effectiveDateCitation: release!.effectiveDateCitation,
      fiscalYear: release!.fiscalYear,
    });
  }

  // Parsing the 5 MB sheet takes about a second; the tests that only inspect the result share one run.
  let shared: ReturnType<typeof ingestOfficial> | null = null;
  const official = () => (shared ??= ingestOfficial());

  it("is the pinned official file", () => {
    expect(sha256).toBe(PINNED_SHA256);
    expect(release).toEqual(KNOWN_HUD_RELEASES[0]);
    expect(release).toMatchObject({ fiscalYear: 2026, effectiveDate: "2026-05-01", url: "https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx" });
    expect(findHudReleaseBySha256("0".repeat(64))).toBeNull();
  });

  it("is deterministic: two runs give byte-identical JSON, identical to the committed dataset", () => {
    const first = serializeDataset(official().dataset);
    const second = serializeDataset(ingestOfficial().dataset);
    expect(second).toBe(first);
    expect(first).toBe(readFileSync(HUD_DATASET_JSON, "utf8"));
  });

  it("reads 4,764 rows and keeps exactly the 254 Texas counties in 215 areas", () => {
    const { dataset, stats } = official();
    expect(stats).toEqual({ sheetName: "Section8-FY26", fiscalYear: 2026, rowsInSheet: 4764, counties: 254, areas: 215, multiCountyAreas: 16, minMedianDollars: 38700, maxMedianDollars: 144200 });
    expect(dataset.sourceFile).toEqual({ name: "Section8-FY26.xlsx", sha256: PINNED_SHA256, url: "https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx" });
  });

  it("serializes canonically whatever order the records arrive in, and round-trips through JSON", () => {
    const { dataset } = official();
    const canonical = serializeDataset(dataset);
    const shuffled: HudDerivedDataset = { ...dataset, areas: [...dataset.areas].reverse(), counties: [...dataset.counties].reverse() };
    expect(serializeDataset(shuffled)).toBe(canonical);
    expect(JSON.parse(canonical)).toEqual(dataset);
    expect(canonical.endsWith("}\n")).toBe(true);
    expect(canonical).not.toMatch(/\r/);
    // One record per line: a changed county or area is a one-line diff.
    expect(canonical.split("\n").filter((line) => line.startsWith('    {"fips"'))).toHaveLength(254);
    expect(canonical.split("\n").filter((line) => line.startsWith('    {"code"'))).toHaveLength(215);
  });
});

describe("IRS limitation table ingest (synthetic transcription)", () => {
  const hud = getTable("hud-fy2026-tx");
  const referenceCounties = hud.dataset.counties.map((county) => ({ fips: county.fips, name: county.name }));

  function irsInput(csv: string) {
    return {
      csv,
      state: "TX" as const,
      version: "irs-2099",
      effectiveDate: "2099-01-01",
      citation: "SYNTHETIC citation, not a real Internal Revenue Bulletin item",
      sourceFile: { name: "SYNTHETIC-irs-2099.csv", sha256: "1".repeat(64), url: null },
      referenceCounties,
    };
  }

  function ingestRows(mutate?: (rows: IrsCsvRow[]) => void, layout: "area" | "county" = "area", columns: readonly string[] = IRS_CSV_COLUMNS) {
    const rows = syntheticIrsRows(hud, layout);
    mutate?.(rows);
    return buildIrsDataset(irsInput(irsRowsToCsv(rows, columns)));
  }

  const areaIndex = (code: string) => hud.dataset.areas.findIndex((area) => area.code === code);
  const HOUSTON = "METRO26420M26420";

  it("accepts a per-area transcription covering all 254 counties and stores explicit limits", () => {
    const { dataset, stats } = ingestRows();
    expect(stats).toEqual({ rows: 215, counties: 254, areas: 215, areasWithoutIncrement: 0 });
    expect(dataset).toMatchObject({ version: "irs-2099", source: "irs_published", method: "irs_published_limit_by_family_size_v1", contract: "irs-limitation-csv-v1", effectiveDate: "2099-01-01" });
    expect(dataset.counties).toEqual(hud.dataset.counties);
    const houston = dataset.areas.find((area) => area.code === HOUSTON)!;
    const index = areaIndex(HOUSTON);
    expect(houston.limitCents).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((size) => syntheticIrsLimitDollars(index, size) * 100));
    expect(houston.additionalPersonCents).toBe(SYNTHETIC_IRS_INCREMENT_DOLLARS * 100);
    expect(houston.medianIncomeDollars).toBeNull();
    expect(JSON.stringify(dataset)).not.toMatch(/multipliers|bySizeBps/);
  });

  it("gives the same dataset for the per-county layout as for the per-area layout", () => {
    const perArea = ingestRows(undefined, "area");
    const perCounty = ingestRows(undefined, "county");
    expect(perCounty.stats).toEqual({ rows: 254, counties: 254, areas: 215, areasWithoutIncrement: 0 });
    expect(serializeDataset(perCounty.dataset)).toBe(serializeDataset(perArea.dataset));
  });

  it("accepts cents, an optional median, an empty increment, any column order and a byte-order mark", () => {
    const { dataset, stats } = ingestRows((rows) => {
      rows[0].limit_1 = "150000.50";
      rows[0].area_median_gross_income = "98700";
      rows[1].additional_person_increment = "";
    });
    expect(dataset.areas[0].limitCents[0]).toBe(15_000_050);
    expect(dataset.areas[0].medianIncomeDollars).toBe(98700);
    expect(dataset.areas[1].additionalPersonCents).toBeNull();
    expect(stats.areasWithoutIncrement).toBe(1);

    const reversedColumns = [...IRS_CSV_COLUMNS].reverse();
    const reordered = buildIrsDataset(irsInput(`﻿${irsRowsToCsv(syntheticIrsRows(hud, "area"), reversedColumns)}`));
    expect(serializeDataset(reordered.dataset)).toBe(serializeDataset(ingestRows().dataset));
  });

  it("round-trips: after activation the engine returns the explicit IRS numbers, not provisional, source irs_published", () => {
    const serialized = serializeDataset(ingestRows().dataset);
    const registry = createTableRegistry({
      datasets: [JSON.parse(readFileSync(HUD_DATASET_JSON, "utf8")), JSON.parse(serialized)],
      activePointer: JSON.parse(serializeActivePointer("irs-2099")),
    });
    const table = registry.getActiveTable();
    expect(table.version).toBe("irs-2099");
    expect(registry.listTables().map((summary) => [summary.version, summary.active, summary.provisional])).toEqual([
      ["hud-fy2026-tx", false, true],
      ["irs-2099", true, false],
    ]);

    const index = areaIndex(HOUSTON);
    for (let householdSize = 1; householdSize <= 8; householdSize++) {
      const result = getThreshold({ countyFips: "48201", householdSize, table });
      expect(result.thresholdCents).toBe(syntheticIrsLimitDollars(index, householdSize) * 100);
      expect(result.statutoryThresholdCents).toBe(result.thresholdCents);
      expect(result).toMatchObject({
        provisional: false,
        source: "irs_published",
        method: "irs_published_limit_by_family_size_v1",
        tableVersion: "irs-2099",
        effectiveDate: "2099-01-01",
        multiplierBps: null,
        multiplier: null,
        medianIncomeCents: null,
        exact: true,
        county: { fips: "48201", name: "Harris County" },
        area: { code: HOUSTON, name: `SYNTHETIC IRS area ${index + 1}`, metro: null },
      });
    }
    const four = getThreshold({ countyFips: "48201", householdSize: 4, table });
    expect(four.formula).toBe(`$${(syntheticIrsLimitDollars(index, 4)).toLocaleString("en-US")}.00 IRS-published limit for 4 persons`);
    // Explicit numbers, not the HUD-derived arithmetic: the synthetic limit differs from 300% x median.
    expect(four.thresholdCents).not.toBe(getThreshold({ countyFips: "48201", householdSize: 4, table: hud }).thresholdCents);

    // Every county in the area shares the explicit row.
    expect(thresholdRow("48339", { table }).thresholds.map((entry) => entry.thresholdCents)).toEqual(thresholdRow("48201", { table }).thresholds.map((entry) => entry.thresholdCents));

    // Above eight persons: the eight-person limit plus the published increment per additional person.
    const eleven = getThreshold({ countyFips: "48201", householdSize: 11, table });
    expect(eleven.thresholdCents).toBe((syntheticIrsLimitDollars(index, 8) + 3 * SYNTHETIC_IRS_INCREMENT_DOLLARS) * 100);
    expect(eleven.formula).toContain("3 additional x $9,999.00 published per additional person");

    // A stricter SGO cap scales the published limit; 185/300 of this figure is not a whole cent and is floored.
    const capped = getThreshold({ countyFips: "48201", householdSize: 4, capPct: 150, table });
    expect(capped.thresholdCents).toBe((syntheticIrsLimitDollars(index, 4) * 100) / 2);
    expect(capped.statutoryThresholdCents).toBe(syntheticIrsLimitDollars(index, 4) * 100);
    const floored = getThreshold({ countyFips: "48201", householdSize: 4, capPct: 185, table });
    const exactNumerator = BigInt(syntheticIrsLimitDollars(index, 4) * 100) * 185n;
    expect(BigInt(floored.thresholdCents)).toBe(exactNumerator / 300n);
    expect(floored.exact).toBe(exactNumerator % 300n === 0n);

    const description = describeThresholdSource(table);
    expect(description).toMatchObject({ source: "irs_published", provisional: false, badge: "IRS-published", tableVersion: "irs-2099" });
    expect(`${description.sourceLine} ${description.explanation} ${description.familyNote} ${description.limitLabel}`).not.toMatch(/provisional|HUD/i);
    expect(description.sourceLine).toBe("IRS-published limit (SYNTHETIC citation, not a real Internal Revenue Bulletin item), effective January 1, 2099.");
  });

  it("refuses households above eight where the IRS table publishes no increment, with a typed reason", () => {
    const { dataset } = ingestRows((rows) => {
      for (const row of rows) row.additional_person_increment = "";
    });
    const table = buildTable(dataset);
    expect(getThreshold({ countyFips: "48201", householdSize: 8, table }).thresholdCents).toBeGreaterThan(0);
    try {
      getThreshold({ countyFips: "48201", householdSize: 9, table });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("validation_failed");
      expect((error as AppError).details).toMatchObject({ reason: "household_size_not_published" });
      expect((error as AppError).message).toMatch(/gives no limit for a household of 9/);
    }
  });

  it("fails when a county is missing, listed twice, unknown, outside Texas, or paired with the wrong name", () => {
    expect(problemsOf(() => ingestRows((rows) => void rows.splice(areaIndex("NCNTY48427N48427"), 1)))).toEqual(["the table must cover all 254 Texas counties; 1 is missing: 48427 Starr County"]);

    expect(
      problemsOf(() =>
        ingestRows((rows) => {
          const starr = rows[areaIndex("NCNTY48427N48427")];
          rows.push({ ...starr, area_code: "DUPLICATE-AREA" });
        }),
      ),
    ).toEqual([`row 217: county 48427 (Starr County) already appears on row ${areaIndex("NCNTY48427N48427") + 2}`]);

    expect(problemsOf(() => ingestRows((rows) => void (rows[5].county_fips = "48002")))[0]).toMatch(/county_fips 48002 is not a Texas county in the reference list/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[5].county_fips = "06037")))[0]).toMatch(/county_fips 06037 is not a Texas county/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[5].county_fips = "4820")))[0]).toMatch(/county_fips "4820" is not a 5-digit FIPS code/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[5].county_fips = "")))[0]).toMatch(/county_fips is empty/);

    // Swapping two FIPS codes keeps the set of counties complete; only the name check can catch it.
    const swapped = problemsOf(() =>
      ingestRows((rows) => {
        const harris = rows.find((row) => row.county_fips === "48201")!;
        const starr = rows.find((row) => row.county_fips === "48427")!;
        [harris.county_fips, starr.county_fips] = [starr.county_fips, harris.county_fips];
      }, "county"),
    );
    expect(swapped).toEqual([
      expect.stringMatching(/county_name "Harris County" does not match county_fips 48427 \(Starr County\)/),
      expect.stringMatching(/county_name "Starr County" does not match county_fips 48201 \(Harris County\)/),
      expect.stringMatching(/2 are missing: 48201 Harris County, 48427 Starr County/),
    ]);

    const houstonRow = areaIndex(HOUSTON);
    expect(problemsOf(() => ingestRows((rows) => void (rows[houstonRow].county_name = "Harris County")))[0]).toMatch(/county_name lists 1 name for 7 county FIPS codes/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[houstonRow].county_fips = `${rows[houstonRow].county_fips};48201`, rows[houstonRow].county_name = `${rows[houstonRow].county_name};Harris County`)))[0]).toMatch(
      /county_fips lists a county more than once/,
    );
  });

  it.each([
    ["a dollar sign", "$312000"],
    ["thousands separators", "312,000"],
    ["a single decimal", "312000.5"],
    ["three decimals", "312000.500"],
    ["scientific notation", "3.12e5"],
    ["a negative amount", "-312000"],
    ["zero", "0"],
    ["text", "n/a"],
    ["nothing", ""],
    ["an inner space", "312 000"],
  ])("fails on a limit written with %s", (_label, value) => {
    const problems = problemsOf(() => ingestRows((rows) => void (rows[3].limit_4 = value)));
    expect(problems[0]).toMatch(/row 5 .*limit_4 ".*" is not a positive dollar amount written with digits only/);
  });

  it("fails when limits decrease as family size grows", () => {
    const problems = problemsOf(() =>
      ingestRows((rows) => {
        rows[3].limit_5 = String(Number(rows[3].limit_4) - 1);
      }),
    );
    expect(problems[0]).toMatch(/row 5 .*limit_5 is lower than limit_4; limits may not decrease as family size grows/);
  });

  it("fails on a malformed increment, median, area code or area name", () => {
    expect(problemsOf(() => ingestRows((rows) => void (rows[0].additional_person_increment = "eight percent")))[0]).toMatch(/additional_person_increment "eight percent" is not a positive dollar amount/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[0].area_median_gross_income = "104000.00")))[0]).toMatch(/area_median_gross_income "104000.00" is not a positive whole-dollar amount/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[0].area_code = "has space")))[0]).toMatch(/area_code "has space" must be/);
    expect(problemsOf(() => ingestRows((rows) => void (rows[0].area_name = "  ")))[0]).toMatch(/area_name is empty/);
  });

  it("fails when rows of one area disagree (per-county layout)", () => {
    const problems = problemsOf(() =>
      ingestRows((rows) => {
        const montgomery = rows.find((row) => row.county_fips === "48339")!;
        montgomery.limit_4 = String(Number(montgomery.limit_4) + 1);
        const waller = rows.find((row) => row.county_fips === "48473")!;
        waller.area_name = "SYNTHETIC different name";
      }, "county"),
    );
    expect(problems).toEqual([
      expect.stringMatching(/area_code METRO26420M26420 has a different limits than on row \d+; rows of one area must be identical/),
      expect.stringMatching(/area_code METRO26420M26420 has a different area_name than on row \d+/),
    ]);
  });

  it("fails on header problems, ragged rows, and empty files", () => {
    const rows = syntheticIrsRows(hud, "area");
    const withoutIncrement = IRS_CSV_COLUMNS.filter((column) => column !== "additional_person_increment");
    expect(problemsOf(() => buildIrsDataset(irsInput(irsRowsToCsv(rows, withoutIncrement))))).toEqual(['header: required column "additional_person_increment" is missing']);
    expect(problemsOf(() => buildIrsDataset(irsInput(irsRowsToCsv(rows, [...IRS_CSV_COLUMNS, "notes"]))))).toEqual(['header: unexpected column "notes"']);
    expect(problemsOf(() => buildIrsDataset(irsInput(irsRowsToCsv(rows, [...IRS_CSV_COLUMNS, "limit_1"]))))).toEqual(['header: column "limit_1" appears more than once']);
    expect(problemsOf(() => buildIrsDataset(irsInput(irsRowsToCsv(rows, [...IRS_CSV_COLUMNS, "limit_9"]))))).toEqual(['header: unexpected column "limit_9"']);

    const ragged = irsRowsToCsv(rows).replace(/\r\n/, "\r\nONLY,THREE,FIELDS\r\n");
    expect(problemsOf(() => buildIrsDataset(irsInput(ragged)))[0]).toBe("row 2: has 3 fields, expected 14");

    expect(() => buildIrsDataset(irsInput(""))).toThrow(/CSV is empty/);
    expect(() => buildIrsDataset(irsInput(`${IRS_CSV_COLUMNS.join(",")}\r\n`))).toThrow(/has a header but no data rows/);
  });

  it("checks the version, date, citation, state and reference list it is given", () => {
    const csv = irsRowsToCsv(syntheticIrsRows(hud, "area"));
    expect(() => buildIrsDataset({ ...irsInput(csv), version: "hud-fy2027-tx" })).toThrow(/IRS table version must look like "irs-<year>"/);
    expect(() => buildIrsDataset({ ...irsInput(csv), version: "irs-27" })).toThrow(/IRS table version/);
    expect(buildIrsDataset({ ...irsInput(csv), version: "irs-2099-rev1" }).dataset.version).toBe("irs-2099-rev1");
    expect(() => buildIrsDataset({ ...irsInput(csv), effectiveDate: "01/01/2099" })).toThrow(/Effective date must be a calendar date/);
    expect(() => buildIrsDataset({ ...irsInput(csv), citation: "   " })).toThrow(/citation must not be empty/);
    expect(buildIrsDataset({ ...irsInput(csv), citation: null }).dataset.citation).toBeNull();
    expect(() => buildIrsDataset({ ...irsInput(csv), state: "OK" as "TX" })).toThrow(/State OK is not supported/);
    expect(() => buildIrsDataset({ ...irsInput(csv), referenceCounties: referenceCounties.slice(1) })).toThrow(/reference county list must hold exactly 254 Texas counties \(it has 253\)/);
  });

  it("labels an IRS table without a citation generically, and in Spanish", () => {
    const table = buildTable(buildIrsDataset({ ...irsInput(irsRowsToCsv(syntheticIrsRows(hud, "area"))), citation: null }).dataset);
    expect(describeThresholdSource(table).sourceLine).toBe("IRS-published limit (Internal Revenue Bulletin), effective January 1, 2099.");
    expect(describeThresholdSource(table).explanation).toBe(
      "This income limit is taken from the limitation table the IRS published in the Internal Revenue Bulletin, effective January 1, 2099, for the household's geographic area and family size. Table version: irs-2099.",
    );
    const es = describeThresholdSource(buildTable(ingestRows().dataset), "es");
    expect(es).toMatchObject({ locale: "es", badge: "Publicado por el IRS", provisional: false, limitLabel: "Límite de ingresos (publicado por el IRS)" });
    expect(es.sourceLine).toBe("Límite publicado por el IRS (SYNTHETIC citation, not a real Internal Revenue Bulletin item), vigente desde el 1 de enero de 2099.");
    expect(`${es.sourceLine} ${es.explanation} ${es.familyNote}`).not.toMatch(/provisional|HUD/i);
  });

  it("the independent transcription check passes for a faithful table and catches a wrong limit, increment or county", () => {
    const csv = irsRowsToCsv(syntheticIrsRows(hud, "area"));
    const { dataset } = buildIrsDataset(irsInput(csv));
    expect(transcriptionMismatches(buildTable(dataset), csv)).toEqual([]);
    expect(transcriptionMismatches(buildTable(ingestRows(undefined, "county").dataset), csv)).toEqual([]);

    const tamper = (change: (copy: IrsPublishedDataset) => void) => {
      const copy = JSON.parse(JSON.stringify(dataset)) as IrsPublishedDataset;
      change(copy);
      return transcriptionMismatches(buildTable(copy), csv);
    };
    const houston = (copy: IrsPublishedDataset) => copy.areas.find((area) => area.code === HOUSTON)!;
    // One cent off in one cell of a seven-county area: seven mismatches, one per county.
    const offByOneCent = tamper((copy) => void (houston(copy).limitCents = houston(copy).limitCents.map((cents, i) => (i === 3 ? cents + 1 : cents))));
    expect(offByOneCent).toHaveLength(7);
    expect(offByOneCent).toContain(`48201 household of 4: transcription ${syntheticIrsLimitDollars(areaIndex(HOUSTON), 4)}, table ${syntheticIrsLimitDollars(areaIndex(HOUSTON), 4) * 100 + 1} cents`);
    expect(tamper((copy) => void (houston(copy).additionalPersonCents = 1_000_000))).toHaveLength(7);
    expect(tamper((copy) => void (houston(copy).additionalPersonCents = null))).toHaveLength(7);
    // The HUD-derived table is not the synthetic transcription: every one of the 2,032 cells differs.
    expect(transcriptionMismatches(hud, csv).length).toBeGreaterThanOrEqual(2032);
    // A transcription that lost a row no longer covers the table.
    const shortCsv = irsRowsToCsv(syntheticIrsRows(hud, "area").slice(0, -1));
    expect(transcriptionMismatches(buildTable(dataset), shortCsv)).toEqual(["48507: in the table but not in the transcription"]);
  });

  it("double entry: two independent transcriptions must agree on every limit, increment, median, area name and code", () => {
    const first = buildTable(ingestRows().dataset);
    expect(compareIrsTranscriptions(first, buildTable(ingestRows(undefined, "county").dataset))).toEqual([]);

    const second = buildTable(
      ingestRows((rows) => {
        const starr = rows[areaIndex("NCNTY48427N48427")];
        starr.limit_3 = String(Number(starr.limit_3) + 100);
        starr.additional_person_increment = "";
        starr.area_name = "SYNTHETIC renamed";
        starr.area_median_gross_income = "38700";
      }).dataset,
    );
    const starrLimit3 = syntheticIrsLimitDollars(areaIndex("NCNTY48427N48427"), 3);
    expect(compareIrsTranscriptions(first, second)).toEqual([
      `48427 Starr County, household of 3: ${starrLimit3}.00 in irs-2099, ${starrLimit3 + 100}.00 in the second transcription`,
      "48427 Starr County, additional_person_increment: 9999.00 in irs-2099, (empty) in the second transcription",
      "48427 Starr County, area_median_gross_income: (empty) in irs-2099, 38700 in the second transcription",
      `48427 Starr County, area_name: "SYNTHETIC IRS area ${areaIndex("NCNTY48427N48427") + 1}" in irs-2099, "SYNTHETIC renamed" in the second transcription`,
    ]);
    expect(() => compareIrsTranscriptions(hud, first)).toThrow(/Both tables must be IRS-published transcriptions/);
  });

  it("writes a transcription template with the geography filled in and every limit empty, which cannot be ingested as is", () => {
    const perArea = renderIrsCsvTemplate(hud, "area");
    const lines = perArea.trimEnd().split("\r\n");
    expect(lines[0]).toBe(IRS_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(216);
    expect(lines.find((line) => line.startsWith(HOUSTON))).toBe(
      'METRO26420M26420,"Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area",48071;48157;48167;48201;48291;48339;48473,Chambers County;Fort Bend County;Galveston County;Harris County;Liberty County;Montgomery County;Waller County,,,,,,,,,,',
    );
    expect(renderIrsCsvTemplate(hud, "county").trimEnd().split("\r\n")).toHaveLength(255);

    const problems = problemsOf(() => buildIrsDataset(irsInput(perArea)));
    expect(problems.length).toBeGreaterThan(215);
    expect(problems[0]).toMatch(/limit_1 "" is not a positive dollar amount/);
  });
});

describe("activation comparison report", () => {
  const hud = getTable("hud-fy2026-tx");

  function variant(change: (dataset: HudDerivedDataset) => void): AmiTable {
    const dataset = JSON.parse(JSON.stringify(hud.dataset)) as HudDerivedDataset;
    dataset.version = "hud-fy2026-tx-synthetic";
    change(dataset);
    return buildTable(dataset);
  }

  it("reports no change between identical tables", () => {
    const diff = diffTables(hud, hud);
    expect(diff.rows).toHaveLength(2032);
    expect(diff.summary).toMatchObject({ cells: 2032, compared: 2032, changed: 0, unchanged: 2032, increased: 0, decreased: 0, largestIncrease: null, largestDecrease: null, smallestChange: null, countiesChanged: 0, areaChanges: [], areaRenames: [] });
    expect(formatDiffReport(diff, { changedOnly: true })).toContain("No county-and-size cell differs.");
  });

  it("lists every county and size with old limit, new limit and delta, and summarizes the extremes", () => {
    // SYNTHETIC change: Houston area median +$1,000, Starr County median -$700.
    const changed = variant((dataset) => {
      dataset.areas.find((area) => area.code === "METRO26420M26420")!.medianIncomeDollars += 1000;
      dataset.areas.find((area) => area.code === "NCNTY48427N48427")!.medianIncomeDollars -= 700;
    });
    const diff = diffTables(hud, changed);
    expect(diff.oldVersion).toBe("hud-fy2026-tx");
    expect(diff.newVersion).toBe("hud-fy2026-tx-synthetic");
    expect(diff.rows.find((row) => row.fips === "48201" && row.householdSize === 4)).toEqual({ fips: "48201", county: "Harris County", householdSize: 4, oldCents: 31_200_000, newCents: 31_500_000, deltaCents: 300_000 });
    // 7 Houston-area counties and Starr County, 8 sizes each.
    expect(diff.summary).toMatchObject({ cells: 2032, compared: 2032, changed: 64, unchanged: 1968, increased: 56, decreased: 8, countiesChanged: 8 });
    expect(diff.summary.largestIncrease).toMatchObject({ householdSize: 8, deltaCents: 396_000 });
    expect(diff.summary.largestDecrease).toEqual({ fips: "48427", county: "Starr County", householdSize: 8, oldCents: 15_325_200, newCents: 15_048_000, deltaCents: -277_200 });
    expect(diff.summary.smallestChange).toEqual({ fips: "48427", county: "Starr County", householdSize: 1, oldCents: 8_127_000, newCents: 7_980_000, deltaCents: -147_000 });
    expect(diff.summary.largestRelativeChange!.row.fips).toBe("48427");
    expect(diff.summary.largestRelativeChange!.basisPoints).toBe(-180);

    const report = formatDiffReport(diff);
    expect(report).toContain("Threshold comparison at 300%: hud-fy2026-tx -> hud-fy2026-tx-synthetic");
    expect(report).toMatch(/48201 {2}Harris County +4 +\$312,000\.00 +\$315,000\.00 +\+\$3,000\.00/);
    expect(report).toMatch(/48427 {2}Starr County +8 +\$153,252\.00 +\$150,480\.00 +-\$2,772\.00/);
    expect(report).toContain("Largest increase: +$3,960.00 for");
    expect(report).toContain("Largest decrease: -$2,772.00 for Starr County (48427), household of 8: $153,252.00 -> $150,480.00");
    expect(report).toContain("Largest relative change: -1.80% of the old limit");
    expect(report.split("\n").filter((line) => /^48\d{3} /.test(line))).toHaveLength(2032);
    expect(formatDiffReport(diff, { changedOnly: true }).split("\n").filter((line) => /^48\d{3} /.test(line))).toHaveLength(64);

    const csv = diffToCsv(diff).trimEnd().split("\r\n");
    expect(csv).toHaveLength(2033);
    expect(csv[0]).toBe("fips,county,household_size,old_version,old_limit_cents,new_version,new_limit_cents,delta_cents");
    expect(csv).toContain("48427,Starr County,8,hud-fy2026-tx,15325200,hud-fy2026-tx-synthetic,15048000,-277200");
  });

  it("shows new limits with nothing to compare when no table is active yet, and flags area changes", () => {
    const fresh = diffTables(null, hud);
    expect(fresh.oldVersion).toBeNull();
    expect(fresh.summary).toMatchObject({ cells: 2032, compared: 0, changed: 0 });
    expect(fresh.rows[0]).toMatchObject({ oldCents: null, deltaCents: null });
    expect(formatDiffReport(fresh)).toContain("(no active table) -> hud-fy2026-tx");

    // SYNTHETIC change: move Waller County out of the Houston area into an area of its own.
    const moved = variant((dataset) => {
      dataset.areas.push({ code: "SYNTHETIC-WALLER", name: "SYNTHETIC Waller area", metro: false, medianIncomeDollars: 104000, hudPublished: { veryLowIncome4PersonDollars: 52000, lowIncome4PersonDollars: 83200 } });
      dataset.areas.sort((a, b) => (a.code < b.code ? -1 : 1));
      dataset.counties.find((county) => county.fips === "48473")!.areaCode = "SYNTHETIC-WALLER";
    });
    const diff = diffTables(hud, moved);
    expect(diff.summary.changed).toBe(0);
    // Waller moved, and the six counties left behind are now in a different (smaller) area too.
    const houstonBefore = "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area [METRO26420M26420] (7 counties)";
    const houstonAfter = "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area [METRO26420M26420] (6 counties)";
    expect(diff.summary.areaChanges).toEqual([
      { fips: "48071", county: "Chambers County", oldArea: houstonBefore, newArea: houstonAfter },
      { fips: "48157", county: "Fort Bend County", oldArea: houstonBefore, newArea: houstonAfter },
      { fips: "48167", county: "Galveston County", oldArea: houstonBefore, newArea: houstonAfter },
      { fips: "48201", county: "Harris County", oldArea: houstonBefore, newArea: houstonAfter },
      { fips: "48291", county: "Liberty County", oldArea: houstonBefore, newArea: houstonAfter },
      { fips: "48339", county: "Montgomery County", oldArea: houstonBefore, newArea: houstonAfter },
      { fips: "48473", county: "Waller County", oldArea: houstonBefore, newArea: "SYNTHETIC Waller area [SYNTHETIC-WALLER] (1 county)" },
    ]);
    expect(diff.summary.areaRenames).toEqual([]);
    const report = formatDiffReport(diff, { changedOnly: true });
    expect(report).toContain("Counties whose geographic area changed (the area is a different set of counties): 7");
    expect(report).toContain(`48473 Waller County: ${houstonBefore} -> SYNTHETIC Waller area [SYNTHETIC-WALLER] (1 county)`);

    // SYNTHETIC change: same counties, new name and code. Reported separately from a real regrouping.
    const renamed = variant((dataset) => {
      const starr = dataset.areas.find((area) => area.code === "NCNTY48427N48427")!;
      starr.name = "SYNTHETIC renamed Starr area";
    });
    const renameDiff = diffTables(hud, renamed);
    expect(renameDiff.summary.areaChanges).toEqual([]);
    expect(renameDiff.summary.areaRenames).toEqual([
      { fips: "48427", county: "Starr County", oldArea: "Starr County, TX [NCNTY48427N48427] (1 county)", newArea: "SYNTHETIC renamed Starr area [NCNTY48427N48427] (1 county)" },
    ]);
    expect(formatDiffReport(renameDiff, { changedOnly: true })).toContain("Counties whose area kept its counties but was renamed or recoded: 1");
  });
});

describe("generated import list", () => {
  it("imports every installed table and the active pointer in a stable order", () => {
    const source = renderRegistryModule({ versions: ["irs-2099", "hud-fy2026-tx"], hasActivePointer: true, dataImportPath: "../../../data/ami/" });
    expect(source).toContain('import activePointer from "../../../data/ami/active.json";');
    expect(source).toContain('import table0 from "../../../data/ami/hud-fy2026-tx.json";\nimport table1 from "../../../data/ami/irs-2099.json";');
    expect(source).toContain("export const RAW_ACTIVE_POINTER: unknown = activePointer;");
    expect(source).toContain("export const RAW_DATASETS: readonly unknown[] = [table0, table1];");
  });

  it("is in step with data/ami in the repository", () => {
    const committed = readFileSync(join(REPO_ROOT, "src/engine/ami/tables.generated.ts"), "utf8");
    const active = JSON.parse(readFileSync(join(REPO_ROOT, "data/ami/active.json"), "utf8")) as { activeVersion: string };
    expect(committed).toContain(`"../../../data/ami/${active.activeVersion}.json"`);
    expect(committed).toContain('import activePointer from "../../../data/ami/active.json";');
  });

  it("renders a null pointer before the first activation", () => {
    const source = renderRegistryModule({ versions: [], hasActivePointer: false, dataImportPath: "./data" });
    expect(source).not.toContain("import ");
    expect(source).toContain("export const RAW_ACTIVE_POINTER: unknown = null;");
    expect(source).toContain("export const RAW_DATASETS: readonly unknown[] = [];");
  });
});

describe("npm run ami:ingest (command, in a temporary directory)", () => {
  let workDir: string;
  const hud = getTable("hud-fy2026-tx");

  function run(...argv: string[]): { code: number; out: string; err: string } {
    let out = "";
    let err = "";
    const code = runAmiIngest([...argv, "--data-dir", "data", "--registry-file", "generated/tables.generated.ts"], {
      cwd: workDir,
      stdout: (text) => void (out += text),
      stderr: (text) => void (err += text),
    });
    return { code, out, err };
  }

  const dataFile = (name: string) => join(workDir, "data", name);

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "ami-ingest-test-"));
    writeFileSync(join(workDir, "irs.csv"), irsRowsToCsv(syntheticIrsRows(hud, "area")));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("ingests the official HUD workbook, byte-identical to the committed dataset, without activating it", () => {
    const first = run("--source", "hud", "--file", HUD_XLSX, "--state", "TX");
    expect(first.err).toBe("");
    expect(first.code).toBe(0);
    expect(first.out).toContain("Pinned official release: FY 2026, effective 2026-05-01");
    expect(first.out).toContain("Texas: 254 counties in 215 areas (16 areas span more than one county)");
    expect(first.out).toContain("Ingest does not activate: the active table is (none).");
    expect(readFileSync(dataFile("hud-fy2026-tx.json"), "utf8")).toBe(readFileSync(HUD_DATASET_JSON, "utf8"));
    expect(existsSync(dataFile("active.json"))).toBe(false);

    const generated = readFileSync(join(workDir, "generated/tables.generated.ts"), "utf8");
    expect(generated).toContain('import table0 from "../data/hud-fy2026-tx.json";');
    expect(generated).toContain("RAW_ACTIVE_POINTER: unknown = null");

    const again = run("--source", "hud", "--file", HUD_XLSX, "--state", "TX");
    expect(again.code).toBe(0);
    expect(again.out).toContain("is already up to date (byte-identical)");
  });

  it("activates only on request, after printing the comparison", () => {
    const dryRun = run("--activate", "hud-fy2026-tx", "--dry-run", "--changed-only");
    expect(dryRun.code).toBe(0);
    expect(dryRun.out).toContain("Dry run:");
    expect(existsSync(dataFile("active.json"))).toBe(false);

    const activated = run("--activate", "hud-fy2026-tx");
    expect(activated.code).toBe(0);
    expect(activated.out).toMatch(/48201 {2}Harris County +4 +\(none\) +\$312,000\.00/);
    expect(activated.out.indexOf("Threshold comparison")).toBeLessThan(activated.out.indexOf("Activated hud-fy2026-tx"));
    expect(readFileSync(dataFile("active.json"), "utf8")).toBe('{\n  "activeVersion": "hud-fy2026-tx"\n}\n');
    expect(readFileSync(join(workDir, "generated/tables.generated.ts"), "utf8")).toContain('import activePointer from "../data/active.json";');

    expect(run("--list").out).toMatch(/^ACTIVE {2}hud-fy2026-tx {2}hud_provisional \(provisional\) {2}effective 2026-05-01 {2}254 counties, 215 areas/);
    expect(run("--activate", "hud-fy2026-tx").out).toContain("is already the active table; nothing changed");
  });

  it("ingests a synthetic IRS transcription without activating it, then swaps it in with one command", () => {
    const ingested = run("--source", "irs", "--file", "irs.csv", "--version", "irs-2099", "--effective-date", "2099-01-01", "--citation", "SYNTHETIC citation");
    expect(ingested.err).toBe("");
    expect(ingested.code).toBe(0);
    expect(ingested.out).toContain("County list checked against hud-fy2026-tx");
    expect(ingested.out).toContain("215 rows; 254 counties in 215 areas");
    expect(ingested.out).toContain("Ingest does not activate: the active table is hud-fy2026-tx.");
    expect(JSON.parse(readFileSync(dataFile("active.json"), "utf8"))).toEqual({ activeVersion: "hud-fy2026-tx" });
    expect(ingested.out).toContain("Archived the transcription as data/sources/irs-2099.csv");
    expect(readFileSync(dataFile("sources/irs-2099.csv"), "utf8")).toBe(readFileSync(join(workDir, "irs.csv"), "utf8"));
    expect(transcriptionMismatches(buildTable(JSON.parse(readFileSync(dataFile("irs-2099.json"), "utf8"))), readFileSync(dataFile("sources/irs-2099.csv"), "utf8"))).toEqual([]);

    // Double entry: a second person's transcription, in the other layout, must agree before activation.
    writeFileSync(join(workDir, "irs-second.csv"), irsRowsToCsv(syntheticIrsRows(hud, "county")));
    const agreed = run("--verify-transcription", "irs-second.csv", "--against", "irs-2099");
    expect(agreed.err).toBe("");
    expect(agreed.code).toBe(0);
    expect(agreed.out).toContain("The two transcriptions agree: 254 counties x household sizes 1-8");
    const secondRows = syntheticIrsRows(hud, "county");
    secondRows[100].limit_2 = String(Number(secondRows[100].limit_2) + 50);
    writeFileSync(join(workDir, "irs-second-wrong.csv"), irsRowsToCsv(secondRows));
    const disagreed = run("--verify-transcription", "irs-second-wrong.csv", "--against", "irs-2099");
    expect(disagreed.code).toBe(1);
    expect(disagreed.err).toMatch(/The second transcription differs from irs-2099 in 1 place:\n {2}- 48\d{3} .* County, household of 2: \d+\.00 in irs-2099, \d+\.00 in the second transcription/);
    expect(run("--verify-transcription", "irs.csv", "--against", "irs-2099").err).toMatch(/byte-identical to the file irs-2099 was built from/);
    expect(run("--verify-transcription", "irs-second.csv", "--against", "hud-fy2026-tx").err).toMatch(/is not an IRS table/);
    expect(run("--verify-transcription", "irs-second.csv").err).toMatch(/needs --against/);

    const compared = run("--diff", "irs-2099", "--changed-only", "--report", "reports/diff.csv");
    expect(compared.code).toBe(0);
    expect(compared.out).toContain("Threshold comparison at 300%: hud-fy2026-tx -> irs-2099");
    expect(readFileSync(join(workDir, "reports/diff.csv"), "utf8").trimEnd().split("\r\n")).toHaveLength(2033);
    expect(JSON.parse(readFileSync(dataFile("active.json"), "utf8"))).toEqual({ activeVersion: "hud-fy2026-tx" });

    const activated = run("--activate", "irs-2099", "--changed-only");
    expect(activated.code).toBe(0);
    expect(activated.out).toContain("Candidate: irs-2099 (irs_published, effective 2099-01-01, 254 counties, 215 areas)");
    expect(activated.out).toContain("Active:    hud-fy2026-tx (hud_provisional, effective 2026-05-01)");
    expect(activated.out).toContain("Largest increase:");
    expect(activated.out).toContain("Largest decrease:");
    expect(activated.out).toContain("Activated irs-2099:");
    expect(JSON.parse(readFileSync(dataFile("active.json"), "utf8"))).toEqual({ activeVersion: "irs-2099" });

    // What the application would now load: the files in the data directory, through the registry.
    const registry = createTableRegistry({
      datasets: ["hud-fy2026-tx", "irs-2099"].map((version) => JSON.parse(readFileSync(dataFile(`${version}.json`), "utf8"))),
      activePointer: JSON.parse(readFileSync(dataFile("active.json"), "utf8")),
    });
    const result = getThreshold({ countyFips: "48201", householdSize: 4, table: registry.getActiveTable() });
    const houstonIndex = hud.dataset.areas.findIndex((area) => area.code === "METRO26420M26420");
    expect(result).toMatchObject({ thresholdCents: syntheticIrsLimitDollars(houstonIndex, 4) * 100, provisional: false, source: "irs_published", tableVersion: "irs-2099" });

    const generated = readFileSync(join(workDir, "generated/tables.generated.ts"), "utf8");
    expect(generated).toContain('import table0 from "../data/hud-fy2026-tx.json";\nimport table1 from "../data/irs-2099.json";');
  });

  it("refuses to go back from an IRS-published table to a provisional one without an explicit flag", () => {
    const refused = run("--activate", "hud-fy2026-tx");
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/The active table irs-2099 is IRS-published; hud-fy2026-tx is HUD-derived and provisional/);
    expect(JSON.parse(readFileSync(dataFile("active.json"), "utf8"))).toEqual({ activeVersion: "irs-2099" });
    expect(run("--activate", "hud-fy2026-tx", "--allow-provisional-over-irs", "--changed-only").code).toBe(0);
    expect(JSON.parse(readFileSync(dataFile("active.json"), "utf8"))).toEqual({ activeVersion: "hud-fy2026-tx" });
  });

  it("refuses to overwrite an installed table with different contents unless told to", () => {
    const rows = syntheticIrsRows(hud, "area");
    rows[0].limit_8 = String(Number(rows[0].limit_8) + 5);
    writeFileSync(join(workDir, "irs-changed.csv"), irsRowsToCsv(rows));
    const before = readFileSync(dataFile("irs-2099.json"), "utf8");

    const refused = run("--source", "irs", "--file", "irs-changed.csv", "--version", "irs-2099", "--effective-date", "2099-01-01", "--citation", "SYNTHETIC citation");
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/irs-2099\.json already exists with different contents/);
    expect(refused.out).toContain("+$5.00");
    expect(readFileSync(dataFile("irs-2099.json"), "utf8")).toBe(before);

    const replaced = run("--source", "irs", "--file", "irs-changed.csv", "--version", "irs-2099", "--effective-date", "2099-01-01", "--citation", "SYNTHETIC citation", "--replace");
    expect(replaced.code).toBe(0);
    expect(replaced.out).toContain("Replaced data/irs-2099.json");
    expect(readFileSync(dataFile("irs-2099.json"), "utf8")).not.toBe(before);
    expect(readFileSync(dataFile("sources/irs-2099.csv"), "utf8")).toBe(readFileSync(join(workDir, "irs-changed.csv"), "utf8"));

    // A table whose archived transcription is missing or altered cannot be activated.
    const archived = readFileSync(dataFile("sources/irs-2099.csv"), "utf8");
    writeFileSync(dataFile("sources/irs-2099.csv"), `${archived}\r\n`);
    const tampered = run("--activate", "irs-2099", "--changed-only");
    expect(tampered.code).toBe(1);
    expect(tampered.err).toMatch(/sources\/irs-2099\.csv is missing or is not the file irs-2099 was built from/);
    writeFileSync(dataFile("sources/irs-2099.csv"), archived);
    expect(JSON.parse(readFileSync(dataFile("active.json"), "utf8"))).toEqual({ activeVersion: "hud-fy2026-tx" });
  });

  it("fails loudly, with exit code 1 and nothing written, on bad input", () => {
    const rows = syntheticIrsRows(hud, "area");
    rows.pop();
    writeFileSync(join(workDir, "irs-short.csv"), irsRowsToCsv(rows));
    const short = run("--source", "irs", "--file", "irs-short.csv", "--version", "irs-2100", "--effective-date", "2100-01-01");
    expect(short.code).toBe(1);
    expect(short.err).toMatch(/ami:ingest failed: IRS limitation table CSV failed validation with 1 problem:\n {2}- the table must cover all 254 Texas counties; 1 is missing/);
    expect(existsSync(dataFile("irs-2100.json"))).toBe(false);

    writeFileSync(join(workDir, "corrupt.xlsx"), buildSyntheticHudWorkbook((sheetRows) => void sheetRows.splice(texasRowIndex(3), 1)));
    const corrupt = run("--source", "hud", "--file", "corrupt.xlsx", "--state", "TX", "--effective-date", "2026-05-01", "--effective-date-citation", "SYNTHETIC", "--source-url", "https://example.com/synthetic.xlsx", "--version", "hud-fy2026-tx-synthetic");
    expect(corrupt.code).toBe(1);
    expect(corrupt.out).toContain("WARNING: not a pinned release");
    expect(corrupt.err).toMatch(/expected exactly 254 Texas counties, found 253/);
    expect(existsSync(dataFile("hud-fy2026-tx-synthetic.json"))).toBe(false);

    expect(run("--source", "hud", "--file", "corrupt.xlsx", "--state", "TX").err).toMatch(/SHA-256 is not a pinned HUD release/);
    expect(run("--source", "hud", "--file", HUD_XLSX, "--state", "TX", "--effective-date", "2026-04-01").err).toMatch(/pinned FY 2026 release, effective 2026-05-01; --effective-date 2026-04-01 contradicts it/);
    expect(run("--source", "hud", "--file", HUD_XLSX).err).toMatch(/needs --state TX/);
    expect(run("--source", "hud", "--file", "missing.xlsx", "--state", "TX").err).toMatch(/Input file not found/);
    expect(run("--source", "irs", "--file", "irs.csv", "--effective-date", "2099-01-01").err).toMatch(/needs --version irs-<year>/);
    expect(run("--source", "irs", "--file", "irs.csv", "--version", "irs-2099").err).toMatch(/needs --effective-date/);
    expect(run("--source", "census").err).toMatch(/--source must be hud or irs/);
    expect(run("--activate", "irs-1999").err).toMatch(/Table irs-1999 is not installed \(installed: hud-fy2026-tx, irs-2099\)/);
    expect(run("--bogus").code).toBe(1);
    expect(run().err).toMatch(/Give exactly one command/);
    expect(run("--list", "--activate", "irs-2099").err).toMatch(/Give exactly one command/);
  });

  it("requires --data-dir and --registry-file together, so a private data directory can never rewire the application", () => {
    let err = "";
    const code = runAmiIngest(["--list", "--data-dir", "data"], { cwd: workDir, stdout: () => undefined, stderr: (text) => void (err += text) });
    expect(code).toBe(1);
    expect(err).toMatch(/--data-dir and --registry-file must be given together/);
  });

  it("writes a transcription template and never overwrites one", () => {
    const written = run("--irs-template", "template.csv");
    expect(written.code).toBe(0);
    expect(written.out).toContain("215 rows (one per area), geography from hud-fy2026-tx, every limit empty");
    expect(readFileSync(join(workDir, "template.csv"), "utf8")).toBe(renderIrsCsvTemplate(hud, "area"));
    expect(run("--irs-template", "template.csv").err).toMatch(/already exists/);
    expect(run("--irs-template", "template-county.csv", "--layout", "county").out).toContain("254 rows (one per county)");
    expect(run("--irs-template", "x.csv", "--layout", "zip").err).toMatch(/--layout must be area or county/);
  });

  it("never changes the limits of the active table, even with --replace; descriptive fields may be corrected", () => {
    expect(run("--activate", "irs-2099", "--changed-only").code).toBe(0);
    const active = readFileSync(dataFile("irs-2099.json"), "utf8");
    const ingest = (file: string, citation: string, ...extra: string[]) =>
      run("--source", "irs", "--file", file, "--version", "irs-2099", "--effective-date", "2099-01-01", "--citation", citation, ...extra);

    // irs.csv differs from the active table (built from irs-changed.csv) by $5 in one area's eight-person limit.
    const changedLimits = ingest("irs.csv", "SYNTHETIC citation", "--replace");
    expect(changedLimits.code).toBe(1);
    expect(changedLimits.err).toMatch(/irs-2099\.json is the ACTIVE table and this ingest would change its limits\. An active table cannot be replaced/);
    expect(changedLimits.out).toContain("-$5.00");
    expect(readFileSync(dataFile("irs-2099.json"), "utf8")).toBe(active);
    expect(readFileSync(dataFile("sources/irs-2099.csv"), "utf8")).toBe(readFileSync(join(workDir, "irs-changed.csv"), "utf8"));

    // Same limits, corrected citation: refused without --replace, allowed with it.
    const withoutReplace = ingest("irs-changed.csv", "SYNTHETIC corrected citation");
    expect(withoutReplace.code).toBe(1);
    expect(withoutReplace.err).toMatch(/already exists with different contents \(the limits are the same; only descriptive fields differ\)/);
    const corrected = ingest("irs-changed.csv", "SYNTHETIC corrected citation", "--replace");
    expect(corrected.code).toBe(0);
    expect(corrected.out).toContain("Replaced data/irs-2099.json (limits unchanged; only descriptive fields differ).");
    expect(corrected.out).toContain("irs-2099 is the active table.");
    expect(JSON.parse(readFileSync(dataFile("irs-2099.json"), "utf8")).citation).toBe("SYNTHETIC corrected citation");

    // A different HUD workbook can never replace an installed HUD table that is active.
    expect(run("--activate", "hud-fy2026-tx", "--allow-provisional-over-irs", "--changed-only").code).toBe(0);
    writeFileSync(join(workDir, "synthetic.xlsx"), buildSyntheticHudWorkbook());
    const otherWorkbook = run("--source", "hud", "--file", "synthetic.xlsx", "--state", "TX", "--effective-date", "2026-05-01", "--effective-date-citation", "SYNTHETIC", "--source-url", "https://example.com/synthetic.xlsx", "--replace");
    expect(otherWorkbook.code).toBe(1);
    expect(otherWorkbook.err).toMatch(/hud-fy2026-tx\.json is the ACTIVE table and this ingest would change its limits/);
    expect(readFileSync(dataFile("hud-fy2026-tx.json"), "utf8")).toBe(readFileSync(HUD_DATASET_JSON, "utf8"));
  });

  it("refuses a dataset file that was edited by hand into an invalid state", () => {
    const path = dataFile("hud-fy2026-tx.json");
    const original = readFileSync(path, "utf8");
    try {
      writeFileSync(path, original.replace('{"fips":"48507","name":"Zavala County","areaCode":"NCNTY48507N48507"}', '{"fips":"48507","name":"Zavala County","areaCode":"NO-SUCH-AREA"}'));
      const result = run("--list");
      expect(result.code).toBe(1);
      expect(result.err).toMatch(/county 48507 refers to unknown area NO-SUCH-AREA/);
    } finally {
      writeFileSync(path, original);
    }
  });
});

describe("npm run ami:ingest (as a process)", () => {
  const tsx = join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
  const script = join(REPO_ROOT, "scripts/ami-ingest.ts");

  it("lists the tables installed in the repository and exits 0", () => {
    const result = spawnSync(process.execPath, [tsx, script, "--list"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/hud-fy2026-tx {2}hud_provisional \(provisional\) {2}effective 2026-05-01 {2}254 counties, 215 areas {2}source file Section8-FY26\.xlsx/);
  });

  it("exits 1 with a message on a usage error and changes nothing", () => {
    const result = spawnSync(process.execPath, [tsx, script, "--activate", "no-such-table", "--dry-run"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ami:ingest failed: Table no-such-table is not installed/);
  });
});
