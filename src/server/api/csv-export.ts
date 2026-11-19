/**
 * The generic verification CSV export (GET /api/v1/verifications/export.csv).
 *
 * No vendor publishes an import format for eligibility results (docs/reference/market-and-integration-context.md,
 * facts 28, 35, 36, 42: NOT PUBLIC), so instead of guessing one, the export is column-mappable: `?columns=` picks,
 * orders and renames columns (`external_ref:ApplicantID,status:Result`) so the file matches whatever another system
 * imports. Every cell goes through csvEscape (src/lib/csv), which neutralizes spreadsheet formula injection.
 */
import { csvEscape } from "@/lib/csv";
import { invalid } from "@/lib/errors";
import type { ApiVerification } from "@/server/verifications";
import { CSV_HEADER_LABEL_MAX } from "./policy";

type Cell = string | number | boolean | null;

export interface CsvColumnDefinition {
  description: string;
  value: (v: ApiVerification) => Cell;
}

/** Standard columns, in their default order. Documented on /docs/csv-export (generated from this object). */
export const VERIFICATION_CSV_COLUMNS = {
  id: { description: "Verification id (ver_…).", value: (v) => v.id },
  external_ref: { description: "Your own applicant or application id, as sent on create.", value: (v) => v.external_ref },
  status: { description: "pending, eligible, ineligible, needs_review, expired or canceled.", value: (v) => v.status },
  stage: { description: "Progress detail while pending (created … decided).", value: (v) => v.stage },
  method: { description: "direct or categorical, once decided.", value: (v) => v.method },
  household_size: { description: "Household size used for the limit.", value: (v) => v.household_size },
  county_fips: { description: "5-digit county FIPS code.", value: (v) => v.area?.county_fips ?? null },
  county_name: { description: "County name.", value: (v) => v.area?.county_name ?? null },
  hud_area_code: { description: "HUD income-limit area code.", value: (v) => v.area?.hud_area_code ?? null },
  hud_area_name: { description: "HUD income-limit area name.", value: (v) => v.area?.hud_area_name ?? null },
  threshold_usd: { description: "The income limit the decision relied on (dollars, 2 decimals).", value: (v) => v.threshold_usd },
  threshold_readings: { description: 'Every reading of the provisional limit as "id=usd" pairs joined with ";".', value: (v) => v.threshold_readings.map((r) => `${r.id}=${r.usd}`).join(";") || null },
  threshold_source: { description: "hud_provisional or irs_published.", value: (v) => v.threshold_source },
  threshold_table_version: { description: "Version of the limit table.", value: (v) => v.threshold_table_version },
  threshold_effective_date: { description: "Effective date of the limit table (YYYY-MM-DD).", value: (v) => v.threshold_effective_date },
  provisional: { description: "true while the limit is HUD-derived and provisional.", value: (v) => v.provisional },
  income_year: { description: "Income year (direct method).", value: (v) => v.income_year },
  award_program: { description: "Benefit program (categorical method).", value: (v) => v.award_program },
  award_letter_date: { description: "Date of the award letter (categorical method).", value: (v) => v.award_letter_date },
  reasons: { description: 'Reason codes joined with ";".', value: (v) => v.reasons.map((r) => r.code).join(";") || null },
  consent_version: { description: "Version of the sharing consent the family gave.", value: (v) => v.consent?.version ?? null },
  consent_granted_at: { description: "When the family consented (ISO 8601).", value: (v) => v.consent?.granted_at ?? null },
  expires_at: { description: "When a decided result stops being reusable (empty until decided).", value: (v) => v.expires_at },
  decided_at: { description: "When the decision was made.", value: (v) => v.decided_at },
  decided_by: { description: "engine or reviewer.", value: (v) => v.decided_by },
  passport_reused: { description: "true when the result was reused from an earlier verification.", value: (v) => v.passport !== null },
  evidence_pack_url: { description: "API URL of the evidence PDF (needs your API key).", value: (v) => v.evidence_pack_url },
  evidence_json_url: { description: "API URL of the signed evidence JSON (needs your API key).", value: (v) => v.evidence_json_url },
  mode: { description: "test or live.", value: (v) => v.mode },
  created_at: { description: "When the verification was created.", value: (v) => v.created_at },
} satisfies Record<string, CsvColumnDefinition>;

export type StandardCsvColumn = keyof typeof VERIFICATION_CSV_COLUMNS;
export const STANDARD_CSV_COLUMNS = Object.keys(VERIFICATION_CSV_COLUMNS) as StandardCsvColumn[];

/** `metadata.<key>` columns read one metadata value. */
export const METADATA_COLUMN_PATTERN = /^metadata\.([A-Za-z0-9_.-]{1,40})$/;
export const MAX_CSV_COLUMNS = 100;

export interface CsvColumn {
  /** The column name as requested (`status`, `metadata.campus`). */
  key: string;
  /** Header text written to the file. */
  header: string;
  value: (v: ApiVerification) => Cell;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Parses `?columns=`: comma-separated names, each optionally followed by `:Header label`. Without it, every standard
 * column with its own name as the header.
 */
export function parseCsvColumns(spec: string | undefined): CsvColumn[] {
  if (spec === undefined || spec.trim() === "") {
    return STANDARD_CSV_COLUMNS.map((key) => ({ key, header: key, value: VERIFICATION_CSV_COLUMNS[key].value }));
  }
  const parts = spec.split(",");
  if (parts.length > MAX_CSV_COLUMNS) throw invalid(`Ask for at most ${MAX_CSV_COLUMNS} columns.`, { fields: { columns: `At most ${MAX_CSV_COLUMNS} columns.` } });
  const out: CsvColumn[] = [];
  for (const part of parts) {
    const colon = part.indexOf(":");
    const key = (colon >= 0 ? part.slice(0, colon) : part).trim();
    const label = colon >= 0 ? part.slice(colon + 1).trim() : key;
    if (key === "") throw invalid("A column name is empty.", { fields: { columns: "Remove the empty entry (two commas in a row, or a trailing comma)." } });
    if (label === "" || label.length > CSV_HEADER_LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) {
      throw invalid(`The header label for "${key}" must be 1 to ${CSV_HEADER_LABEL_MAX} characters without control characters.`, { fields: { columns: `Check the label of "${key}".` } });
    }
    if (hasOwn(VERIFICATION_CSV_COLUMNS, key)) {
      out.push({ key, header: label, value: VERIFICATION_CSV_COLUMNS[key as StandardCsvColumn].value });
      continue;
    }
    const meta = METADATA_COLUMN_PATTERN.exec(key);
    if (meta) {
      const metaKey = meta[1];
      out.push({ key, header: label, value: (v) => (hasOwn(v.metadata, metaKey) ? v.metadata[metaKey] : null) });
      continue;
    }
    throw invalid(`Unknown column "${key}".`, { fields: { columns: `Unknown column "${key}". Use one of the documented columns or metadata.<key>.` } });
  }
  return out;
}

function line(cells: Cell[]): string {
  return cells.map((c) => csvEscape(c === null ? "" : typeof c === "boolean" ? (c ? "true" : "false") : c)).join(",");
}

/** RFC 4180 CSV (CRLF line ends) of the given verifications in the chosen columns. */
export function buildVerificationsCsv(rows: readonly ApiVerification[], columns: readonly CsvColumn[], opts: { header?: boolean } = {}): string {
  const lines: string[] = [];
  if (opts.header !== false) lines.push(line(columns.map((c) => c.header)));
  for (const row of rows) lines.push(line(columns.map((c) => c.value(row))));
  return lines.length === 0 ? "" : `${lines.join("\r\n")}\r\n`;
}
