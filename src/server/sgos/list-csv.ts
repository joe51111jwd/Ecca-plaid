import { parseCsv } from "@/lib/csv";
import type { SgoListEntryStatus, SgoListSource } from "@/db/schema";
import { cleanText, hasControlChars, isIsoDate, listMatchKey, nameKey, normalizeEin } from "./identity";
import { normalizeStateCode, type UsStateCode } from "./states";

/**
 * THE SGO LIST FILE CONTRACT (both sources).
 *
 *   # Lines whose first character is "#" are comments and are ignored, wherever they appear.
 *   state,name,ein,status,listed_from,removed_on
 *   TX,Example Scholarship Fund,12-3456789,listed,2027-01-01,
 *   TX,Another Fund,98-7654321,removed,2027-01-01,2027-03-15
 *
 * - The header names exactly these six columns, each once, in any order. No other columns.
 * - Every data row has exactly six cells. Fields may be quoted (RFC 4180); a field may not contain a line break.
 * - state:       two-letter code of one of the 50 States or DC (case-insensitive).
 * - name:        1–200 characters after trimming, with at least one letter or digit; internal whitespace is collapsed.
 * - ein:         NN-NNNNNNN or nine digits. Optional for provisional_curated, REQUIRED for irs_published (a State
 *                gives the IRS each listed SGO's EIN: docs/reference/acknowledgment-reporting.md, F54).
 * - status:      "listed" or "removed".
 * - listed_from: optional YYYY-MM-DD, the first day the listing is in effect.
 * - removed_on:  YYYY-MM-DD, required when status is "removed" and forbidden otherwise; the removal's effective
 *                date (gifts on or after it are refused). Not before listed_from.
 * - One row per (state, EIN) — or per (state, normalized name) for rows without an EIN.
 *
 * ADAPT HERE WHEN THE IRS PUBLISHES. The real format of the IRS SGO list (CSV, a download, an API or only a web
 * page) is not in any source (docs/reference/acknowledgment-reporting.md, F64; market-and-integration-context.md,
 * fact 21). The IRS says removed SGOs stay visible with their removal date (F66), which this contract carries.
 * When the format is known, map the IRS file onto `ParsedListRow` in this one function (or put a converter
 * in front of it) and keep the fixture test in list-csv.test.ts in step. Nothing else in the module reads files.
 */

export const LIST_CSV_COLUMNS = ["state", "name", "ein", "status", "listed_from", "removed_on"] as const;
type ListColumn = (typeof LIST_CSV_COLUMNS)[number];

/** Upper bounds that keep an import inside one transaction. Treasury plans for 600–700 SGOs nationally (F38). */
export const LIST_CSV_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 20_000, maxNameLength: 200, maxErrorsReported: 50 } as const;

/** POLICY: an IRS-published row must carry an EIN; a provisional row may be keyed by name. */
export const EIN_REQUIRED_FOR: Readonly<Record<SgoListSource, boolean>> = { provisional_curated: false, irs_published: true };

export interface ParsedListRow {
  /** 1-based line number in the file. */
  line: number;
  state: UsStateCode;
  name: string;
  ein: string | null;
  status: SgoListEntryStatus;
  listedFrom: string | null;
  removedOn: string | null;
  /** The row as it appeared in the file, keyed by column. */
  raw: Record<ListColumn, string>;
}

export interface ListCsvError {
  /** 1-based line number; 0 for problems with the file as a whole. */
  line: number;
  message: string;
}

export interface ParsedListFile {
  rows: ParsedListRow[];
  errors: ListCsvError[];
}

function isListColumn(value: string): value is ListColumn {
  return (LIST_CSV_COLUMNS as readonly string[]).includes(value);
}

/**
 * Parses and validates a list file. Never throws for bad content: every problem is returned with its line so
 * a platform admin can fix the file. A file with any error must not be imported.
 */
export function parseSgoListCsv(csv: string, source: SgoListSource): ParsedListFile {
  const errors: ListCsvError[] = [];
  const rows: ParsedListRow[] = [];
  if (Buffer.byteLength(csv, "utf8") > LIST_CSV_LIMITS.maxBytes) {
    return { rows, errors: [{ line: 0, message: `The file is larger than ${LIST_CSV_LIMITS.maxBytes / (1024 * 1024)} MB.` }] };
  }

  const lines = csv.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  let header: ListColumn[] | null = null;
  const seenKeys = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const text = lines[i];
    if (text.trim() === "" || text.trimStart().startsWith("#")) continue;
    if ((text.match(/"/g)?.length ?? 0) % 2 !== 0) {
      errors.push({ line: lineNo, message: "Unbalanced quotes (a field may not contain a line break)." });
      if (!header) break;
      continue;
    }
    const cells = (parseCsv(text)[0] ?? []).map((c) => c.trim());

    if (!header) {
      const names = cells.map((c) => c.toLowerCase());
      const problems: string[] = [];
      const unknown = names.filter((n) => !isListColumn(n));
      if (unknown.length > 0) problems.push(`unknown column(s) ${unknown.map((u) => `"${u}"`).join(", ")}`);
      const missing = LIST_CSV_COLUMNS.filter((c) => !names.includes(c));
      if (missing.length > 0) problems.push(`missing column(s) ${missing.join(", ")}`);
      const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
      if (dupes.length > 0) problems.push(`repeated column(s) ${[...new Set(dupes)].join(", ")}`);
      if (problems.length > 0) {
        errors.push({ line: lineNo, message: `The header must be exactly: ${LIST_CSV_COLUMNS.join(",")} (${problems.join("; ")}).` });
        break;
      }
      header = names as ListColumn[];
      continue;
    }

    if (rows.length + errors.length >= LIST_CSV_LIMITS.maxRows) {
      errors.push({ line: lineNo, message: `The file has more than ${LIST_CSV_LIMITS.maxRows} rows.` });
      break;
    }
    if (cells.length !== header.length) {
      errors.push({ line: lineNo, message: `Expected ${header.length} fields, found ${cells.length}.` });
      continue;
    }
    const raw = Object.fromEntries(header.map((col, idx) => [col, cells[idx]])) as Record<ListColumn, string>;
    const row = validateRow(raw, lineNo, source, errors);
    if (!row) continue;

    const key = `${row.state}|${listMatchKey(row.ein, row.name)}`;
    const first = seenKeys.get(key);
    if (first !== undefined) {
      errors.push({ line: lineNo, message: `Duplicate of line ${first} (same state and ${row.ein ? "EIN" : "name"}).` });
      continue;
    }
    seenKeys.set(key, lineNo);
    rows.push(row);
  }

  if (!header && errors.length === 0) errors.push({ line: 0, message: `The file has no header row (${LIST_CSV_COLUMNS.join(",")}).` });
  return { rows, errors };
}

function validateRow(raw: Record<ListColumn, string>, line: number, source: SgoListSource, errors: ListCsvError[]): ParsedListRow | null {
  const before = errors.length;
  const fail = (message: string) => errors.push({ line, message });

  const state = normalizeStateCode(raw.state);
  if (!state) fail(`state "${raw.state}" is not a two-letter code of a US State or DC.`);

  const name = cleanText(raw.name);
  if (name.length === 0) fail("name is empty.");
  else if (name.length > LIST_CSV_LIMITS.maxNameLength) fail(`name is longer than ${LIST_CSV_LIMITS.maxNameLength} characters.`);
  else if (hasControlChars(raw.name.replace(/\t/g, " "))) fail("name contains control characters.");
  // A name-keyed row is matched on its letters and digits; a name with none would collide with every other such name.
  else if (nameKey(name) === "") fail("name has no letters or digits.");

  let ein: string | null = null;
  if (raw.ein !== "") {
    ein = normalizeEin(raw.ein);
    if (!ein) fail(`ein "${raw.ein}" is not in the form NN-NNNNNNN.`);
  } else if (EIN_REQUIRED_FOR[source]) {
    fail("ein is required on the IRS-published list.");
  }

  const statusText = raw.status.toLowerCase();
  const status: SgoListEntryStatus | null = statusText === "listed" || statusText === "removed" ? statusText : null;
  if (!status) fail(`status "${raw.status}" must be "listed" or "removed".`);

  const listedFrom = raw.listed_from === "" ? null : raw.listed_from;
  if (listedFrom !== null && !isIsoDate(listedFrom)) fail(`listed_from "${listedFrom}" is not a date in the form YYYY-MM-DD.`);
  const removedOn = raw.removed_on === "" ? null : raw.removed_on;
  if (removedOn !== null && !isIsoDate(removedOn)) fail(`removed_on "${removedOn}" is not a date in the form YYYY-MM-DD.`);

  if (status === "removed" && removedOn === null) fail("removed_on is required when status is removed.");
  if (status === "listed" && removedOn !== null) fail('removed_on must be empty when status is "listed".');
  if (listedFrom && removedOn && isIsoDate(listedFrom) && isIsoDate(removedOn) && removedOn < listedFrom) fail("removed_on is before listed_from.");

  if (errors.length > before || !state || !status) return null;
  return { line, state, name, ein, status, listedFrom, removedOn, raw };
}
