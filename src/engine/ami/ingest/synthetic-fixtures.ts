/**
 * SYNTHETIC test fixtures for the ingest tests. Nothing in this file is real HUD or IRS data: the county
 * names, area names, medians and limits are invented and say so. Only the shape (column names, FIPS code
 * structure, 254 Texas county codes) mirrors the real files.
 */
import { strToU8, zipSync } from "fflate";
import { toCsv } from "@/lib/csv";
import type { AmiTable } from "../types";
import { IRS_CSV_COLUMNS } from "./irs";
import type { XlsxCell } from "./xlsx";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnLetters(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Zips raw XML parts into workbook bytes. Use it to build deliberately odd or broken workbooks. */
export function zipWorkbookParts(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

export interface SyntheticSheet {
  name: string;
  rows: XlsxCell[][];
}

export interface SyntheticXlsxOptions {
  /** How text cells are stored. Real HUD files use shared strings; other writers use inline strings. */
  strings?: "shared" | "inline";
  /** Write `r="A1"` cell references (default) or leave them out, which the file format also allows. */
  cellRefs?: boolean;
}

/** The standard parts of a workbook around the given worksheet XML documents. */
export function workbookParts(sheets: Array<{ name: string; xml: string }>, sharedStringsXml: string | null): Record<string, string> {
  const parts: Record<string, string> = {
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${DOC_REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN_NS}" xmlns:r="${DOC_REL_NS}"><sheets>` +
      sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("") +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL_NS}">` +
      sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${DOC_REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("") +
      (sharedStringsXml === null ? "" : `<Relationship Id="rIdShared" Type="${DOC_REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`) +
      "</Relationships>",
  };
  sheets.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = sheet.xml;
  });
  if (sharedStringsXml !== null) parts["xl/sharedStrings.xml"] = sharedStringsXml;
  return parts;
}

export function buildSyntheticXlsx(sheets: SyntheticSheet[], options: SyntheticXlsxOptions = {}): Uint8Array {
  const useShared = (options.strings ?? "shared") === "shared";
  const withRefs = options.cellRefs ?? true;
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();

  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows.map((cells, rowIndex) => {
      const cellXml: string[] = [];
      cells.forEach((value, columnIndex) => {
        const ref = withRefs ? ` r="${columnLetters(columnIndex)}${rowIndex + 1}"` : "";
        if (value === null) {
          // Without references a gap cannot be expressed by leaving the cell out, so write an empty cell.
          if (!withRefs) cellXml.push("<c/>");
        } else if (typeof value === "number") cellXml.push(`<c${ref}><v>${value}</v></c>`);
        else if (typeof value === "boolean") cellXml.push(`<c${ref} t="b"><v>${value ? 1 : 0}</v></c>`);
        else if (useShared) {
          let index = sharedIndex.get(value);
          if (index === undefined) {
            index = shared.length;
            shared.push(value);
            sharedIndex.set(value, index);
          }
          cellXml.push(`<c${ref} t="s"><v>${index}</v></c>`);
        } else cellXml.push(`<c${ref} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`);
      });
      return `<row${withRefs ? ` r="${rowIndex + 1}"` : ""}>${cellXml.join("")}</row>`;
    });
    return { name: sheet.name, xml: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN_NS}"><dimension ref="A1:AI1048576"/><sheetData>${rows.join("")}</sheetData></worksheet>` };
  });

  const sharedXml = useShared
    ? `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${MAIN_NS}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join("")}</sst>`
    : null;
  return zipWorkbookParts(workbookParts(sheetXml, sharedXml));
}

/* ------------------------------------------------------------------ synthetic HUD workbook */

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

/** Same header names, order and mixed capitalization as HUD's Section 8 workbook. */
export const SYNTHETIC_HUD_HEADER: string[] = [
  "fips",
  "stusps",
  "state",
  "state_name",
  "hud_area_code",
  "hud_area_name",
  "county",
  "County_Name",
  "county_town_name",
  "metro",
  "median2026",
  ...SIZES.map((n) => `l50_${n}`),
  ...SIZES.map((n) => `ELI_${n}`),
  ...SIZES.map((n) => `l80_${n}`),
];

export const HUD_COLUMN = Object.fromEntries(SYNTHETIC_HUD_HEADER.map((name, index) => [name, index])) as Record<string, number>;

const PERCENTS = [70, 80, 90, 100, 108, 116, 124, 132];

function syntheticHudRow(fipsState: string, postal: string, stateName: string, countyCode: string, countyName: string, areaCode: string, areaName: string, metro: 0 | 1, median: number): XlsxCell[] {
  const l50 = PERCENTS.map((pct) => Math.ceil((median * pct) / 200 / 50) * 50);
  const eli = l50.map((value) => Math.round(value * 0.6));
  const l80 = l50.map((value) => Math.round(value * 1.6));
  return [`${fipsState}${countyCode}99999`, postal, fipsState, stateName, areaCode, areaName, countyCode, countyName, countyName, metro, median, ...l50, ...eli, ...l80];
}

/** Texas county codes are the odd numbers 001 to 507: 254 codes. */
export const TEXAS_COUNTY_CODES: string[] = Array.from({ length: 254 }, (_, index) => String(2 * index + 1).padStart(3, "0"));

export const SYNTHETIC_AREA_A = "SYNMETRO0000001A";
export const SYNTHETIC_AREA_B = "SYNMETRO0000002B";

/**
 * Data rows of a synthetic Section 8 sheet: 254 invented Texas counties (three in synthetic metro area A,
 * two in area B, the rest in single-county areas) surrounded by rows for other states, one of which reuses
 * area A's code with a different median the way a cross-state HUD area would share a code.
 */
export function syntheticHudDataRows(): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  rows.push(syntheticHudRow("01", "AL", "Alabama", "001", "Synthetic Alabama County", "SYNCNTY01001", "Synthetic Alabama County, AL", 0, 61000));
  TEXAS_COUNTY_CODES.forEach((code, index) => {
    const name = `Synthetic County ${code}`;
    if (index < 3) rows.push(syntheticHudRow("48", "TX", "Texas", code, name, SYNTHETIC_AREA_A, "Synthetic Metro Area A, TX", 1, 90000));
    else if (index < 5) rows.push(syntheticHudRow("48", "TX", "Texas", code, name, SYNTHETIC_AREA_B, "Synthetic Metro Area B, TX", 1, 75000));
    else rows.push(syntheticHudRow("48", "TX", "Texas", code, name, `SYNCNTY48${code}`, `${name}, TX`, 0, 40000 + index * 100));
  });
  rows.push(syntheticHudRow("05", "AR", "Arkansas", "091", "Synthetic Arkansas County", SYNTHETIC_AREA_A, "Synthetic Metro Area A, TX", 1, 12300));
  return rows;
}

/** Index into `syntheticHudDataRows()` of the row for the n-th Texas county (0-based). */
export function texasRowIndex(n: number): number {
  return n + 1;
}

export function buildSyntheticHudWorkbook(mutate?: (rows: XlsxCell[][], header: string[]) => void, options: SyntheticXlsxOptions = {}): Uint8Array {
  const header = [...SYNTHETIC_HUD_HEADER];
  const rows = syntheticHudDataRows();
  mutate?.(rows, header);
  return buildSyntheticXlsx(
    [
      { name: "Section8-FY26", rows: [header, ...rows] },
      { name: "Field_Descriptions", rows: [["Field", "Description"], ["fips", "SYNTHETIC description"]] },
    ],
    options,
  );
}

export const SYNTHETIC_SOURCE_FILE = {
  name: "SYNTHETIC-Section8.xlsx",
  sha256: "0".repeat(64),
  url: null,
} as const;

/* ------------------------------------------------------------------ synthetic IRS transcription */

export type IrsCsvRow = Record<(typeof IRS_CSV_COLUMNS)[number], string>;

/** Invented limit for a synthetic IRS table: depends on the area's position and the family size, nothing else. */
export function syntheticIrsLimitDollars(areaIndex: number, size: number): number {
  return 200_000 + 137 * areaIndex + 10_001 * (size - 1);
}

export const SYNTHETIC_IRS_INCREMENT_DOLLARS = 9_999;

/**
 * Rows of a synthetic IRS transcription that reuses the geography of an installed table. `area` layout: one
 * row per area listing all of its counties. `county` layout: one row per county.
 */
export function syntheticIrsRows(reference: AmiTable, layout: "area" | "county"): IrsCsvRow[] {
  const rows: IrsCsvRow[] = [];
  reference.dataset.areas.forEach((area, areaIndex) => {
    const limits = Object.fromEntries(SIZES.map((size) => [`limit_${size}`, String(syntheticIrsLimitDollars(areaIndex, size))]));
    const fipsCodes = reference.countyFipsByArea.get(area.code) ?? [];
    const base = {
      area_code: area.code,
      area_name: `SYNTHETIC IRS area ${areaIndex + 1}`,
      ...limits,
      additional_person_increment: String(SYNTHETIC_IRS_INCREMENT_DOLLARS),
      area_median_gross_income: "",
    };
    if (layout === "area") {
      rows.push({ ...base, county_fips: fipsCodes.join(";"), county_name: fipsCodes.map((fips) => reference.countyByFips.get(fips)!.name).join(";") } as IrsCsvRow);
    } else {
      for (const fips of fipsCodes) rows.push({ ...base, county_fips: fips, county_name: reference.countyByFips.get(fips)!.name } as IrsCsvRow);
    }
  });
  return rows;
}

export function irsRowsToCsv(rows: IrsCsvRow[], columns: readonly string[] = IRS_CSV_COLUMNS): string {
  return toCsv([...columns], rows);
}
