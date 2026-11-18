import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { invalid } from "@/lib/errors";

/**
 * Minimal, strict reader for one worksheet of an .xlsx workbook (a zip of XML parts). It exists so the
 * ingest has no spreadsheet dependency and so every assumption about the file is visible here.
 *
 * Supported: shared strings (plain and rich text), inline strings, formula strings, numbers and booleans;
 * cells with or without `r` references; namespace-prefixed parts. Anything it does not understand
 * (error cells, unknown cell types, DTDs) is an error, never a silently skipped cell.
 */

export type XlsxCell = string | number | boolean | null;

export interface XlsxRow {
  /** 1-based row number in the worksheet. */
  rowNumber: number;
  /** Dense cell values from column A; missing cells are null. */
  cells: XlsxCell[];
}

/** Zip-bomb guard: no single workbook part may inflate beyond this. The FY 2026 HUD sheet is about 5 MB. */
const MAX_PART_BYTES = 256 * 1024 * 1024;
/** Excel's column limit (XFD). A larger column index means a corrupt or hostile cell reference. */
const MAX_COLUMNS = 16_384;

const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const ARRAY_TAGS = new Set(["Relationship", "sheet", "row", "c", "si", "r"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: true,
  ignoreDeclaration: true,
  // Entities are decoded by decodeXmlText below, in one pass, so "&amp;#65;" stays "&#65;".
  processEntities: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type XmlNode = Record<string, unknown>;

function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function child(node: unknown, name: string): unknown {
  return isNode(node) ? node[name] : undefined;
}

function children(node: unknown, name: string): unknown[] {
  const value = child(node, name);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(raw: string): string {
  return raw.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (match, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (named !== undefined) {
      const replacement = NAMED_ENTITIES[named];
      if (replacement === undefined) throw invalid(`Workbook XML uses an entity that is not allowed: ${match}`);
      return replacement;
    }
    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    if (!(codePoint > 0 && codePoint <= 0x10ffff)) throw invalid(`Workbook XML has an invalid character reference: ${match}`);
    return String.fromCodePoint(codePoint);
  });
}

/** SpreadsheetML escapes control characters in strings as _xHHHH_ (and a literal "_x" prefix as _x005F_). */
function decodeOoxmlEscapes(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Text content of an element that may have been parsed as a bare string or as an object with attributes. */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return decodeXmlText(node);
  if (isNode(node)) return textOf(node["#text"]);
  return "";
}

function attr(node: unknown, name: string): string | undefined {
  const value = child(node, `@_${name}`);
  return typeof value === "string" ? decodeXmlText(value) : undefined;
}

/** A string item (`<si>` or `<is>`): plain `<t>` text plus rich-text runs `<r><t>`. Phonetic runs (`<rPh>`) are ignored. */
function stringItemText(item: unknown): string {
  const runs = children(item, "r").map((run) => textOf(child(run, "t")));
  return decodeOoxmlEscapes(textOf(child(item, "t")) + runs.join(""));
}

function parseXmlPart(parts: Record<string, Uint8Array>, path: string): XmlNode {
  const bytes = parts[path];
  if (!bytes) throw invalid(`Workbook is missing the part ${path}; it is not a valid .xlsx file.`);
  const xml = strFromU8(bytes);
  if (/<!DOCTYPE/i.test(xml)) throw invalid(`Workbook part ${path} contains a DOCTYPE declaration, which .xlsx files never use.`);
  try {
    return parser.parse(xml) as XmlNode;
  } catch (error) {
    throw invalid(`Workbook part ${path} is not well-formed XML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unzipParts(workbook: Uint8Array, wanted: ReadonlySet<string>): Record<string, Uint8Array> {
  try {
    return unzipSync(workbook, {
      filter: (file) => {
        if (!wanted.has(file.name)) return false;
        if (file.originalSize > MAX_PART_BYTES) throw invalid(`Workbook part ${file.name} is larger than the ${MAX_PART_BYTES}-byte limit.`);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") throw error;
    throw invalid(`File is not a readable .xlsx workbook (zip archive): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolvePartPath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = basePart.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

function relsPathFor(part: string): string {
  const segments = part.split("/");
  const file = segments.pop()!;
  return [...segments, "_rels", `${file}.rels`].join("/");
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function readRelationships(parts: Record<string, Uint8Array>, relsPath: string): Relationship[] {
  const root = child(parseXmlPart(parts, relsPath), "Relationships");
  return children(root, "Relationship").map((rel) => ({ id: attr(rel, "Id") ?? "", type: attr(rel, "Type") ?? "", target: attr(rel, "Target") ?? "" }));
}

interface WorkbookIndex {
  sheets: Array<{ name: string; path: string }>;
  sharedStringsPath: string | null;
}

const ROOT_RELS = "_rels/.rels";

function readWorkbookIndex(workbook: Uint8Array): WorkbookIndex {
  const rootParts = unzipParts(workbook, new Set([ROOT_RELS]));
  const officeDocument = readRelationships(rootParts, ROOT_RELS).find((rel) => rel.type.endsWith("/officeDocument"));
  if (!officeDocument) throw invalid("Workbook has no main document relationship; it is not a valid .xlsx file.");
  const workbookPath = resolvePartPath("", officeDocument.target);
  const workbookRelsPath = relsPathFor(workbookPath);

  const parts = unzipParts(workbook, new Set([workbookPath, workbookRelsPath]));
  const relationships = readRelationships(parts, workbookRelsPath);
  const byId = new Map(relationships.map((rel) => [rel.id, rel]));
  const sheetNodes = children(child(child(parseXmlPart(parts, workbookPath), "workbook"), "sheets"), "sheet");
  const sheets = sheetNodes.map((sheet) => {
    const name = attr(sheet, "name") ?? "";
    const rel = byId.get(attr(sheet, "id") ?? "");
    if (!rel) throw invalid(`Workbook sheet "${name}" has no worksheet part.`);
    return { name, path: resolvePartPath(workbookPath, rel.target) };
  });
  const sharedStrings = relationships.find((rel) => rel.type.endsWith("/sharedStrings"));
  return { sheets, sharedStringsPath: sharedStrings ? resolvePartPath(workbookPath, sharedStrings.target) : null };
}

/** Sheet names in workbook order. */
export function listXlsxSheets(workbook: Uint8Array): string[] {
  return readWorkbookIndex(workbook).sheets.map((sheet) => sheet.name);
}

function columnIndex(reference: string): number {
  const match = /^([A-Z]+)\d+$/.exec(reference);
  if (!match) throw invalid(`Worksheet has a malformed cell reference: "${reference}".`);
  let index = 0;
  for (const letter of match[1]) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
    if (index > MAX_COLUMNS) throw invalid(`Worksheet cell reference "${reference}" is beyond the last possible column.`);
  }
  return index - 1;
}

function cellValue(cell: unknown, reference: string, sharedStrings: readonly string[]): XlsxCell {
  const type = attr(cell, "t") ?? "n";
  const rawValue = child(cell, "v");
  switch (type) {
    case "s": {
      const text = textOf(rawValue).trim();
      const index = /^\d+$/.test(text) ? Number(text) : Number.NaN;
      if (!Number.isInteger(index) || index >= sharedStrings.length) throw invalid(`Cell ${reference} points at shared string "${text}", which does not exist.`);
      return sharedStrings[index];
    }
    case "inlineStr":
      return stringItemText(child(cell, "is"));
    case "str":
    case "d":
      return decodeOoxmlEscapes(textOf(rawValue));
    case "b":
      return textOf(rawValue).trim() === "1";
    case "n": {
      const text = textOf(rawValue).trim();
      if (text === "") return null;
      // Decimal notation only: Number() alone would also accept hexadecimal and "Infinity".
      const value = DECIMAL_NUMBER.test(text) ? Number(text) : Number.NaN;
      if (!Number.isFinite(value)) throw invalid(`Cell ${reference} should be a number but contains "${text}".`);
      return value;
    }
    case "e":
      throw invalid(`Cell ${reference} contains a spreadsheet error (${textOf(rawValue) || "unknown"}).`);
    default:
      throw invalid(`Cell ${reference} has an unsupported cell type "${type}".`);
  }
}

/**
 * Reads every non-empty row of the named worksheet. Rows keep their worksheet row numbers so validation
 * messages can point at the exact line of the published file.
 */
export function readXlsxSheet(workbook: Uint8Array, sheetName: string): XlsxRow[] {
  const index = readWorkbookIndex(workbook);
  const sheet = index.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    throw invalid(`Workbook has no sheet named "${sheetName}" (sheets: ${index.sheets.map((s) => `"${s.name}"`).join(", ") || "none"}).`);
  }
  const wanted = new Set([sheet.path]);
  if (index.sharedStringsPath) wanted.add(index.sharedStringsPath);
  const parts = unzipParts(workbook, wanted);

  const sharedStrings = index.sharedStringsPath ? children(child(parseXmlPart(parts, index.sharedStringsPath), "sst"), "si").map(stringItemText) : [];

  const rows: XlsxRow[] = [];
  let previousRowNumber = 0;
  for (const row of children(child(child(parseXmlPart(parts, sheet.path), "worksheet"), "sheetData"), "row")) {
    const rowAttr = attr(row, "r");
    const rowNumber = rowAttr === undefined ? previousRowNumber + 1 : Number(rowAttr);
    if (!Number.isInteger(rowNumber) || rowNumber <= previousRowNumber) throw invalid(`Worksheet "${sheetName}" has an out-of-order or malformed row number "${rowAttr}".`);
    previousRowNumber = rowNumber;

    const cells: XlsxCell[] = [];
    let nextColumn = 0;
    for (const cell of children(row, "c")) {
      const cellRef = attr(cell, "r");
      const column = cellRef === undefined ? nextColumn : columnIndex(cellRef);
      if (column >= MAX_COLUMNS) throw invalid(`Worksheet "${sheetName}" row ${rowNumber} has more columns than a worksheet can hold.`);
      const value = cellValue(cell, cellRef ?? `row ${rowNumber}, column ${column + 1}`, sharedStrings);
      while (cells.length < column) cells.push(null);
      cells[column] = value;
      nextColumn = column + 1;
    }
    if (cells.some((value) => value !== null && value !== "")) rows.push({ rowNumber, cells });
  }
  return rows;
}
