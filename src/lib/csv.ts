/** Minimal RFC 4180 CSV writer/reader (no dependency). */

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralize spreadsheet formula injection in exported user-supplied text.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown> | unknown[]>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    const vals = Array.isArray(r) ? r : headers.map((h) => (r as Record<string, unknown>)[h]);
    lines.push(vals.map(csvEscape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parses CSV with a header row into objects keyed by trimmed header names. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
