/**
 * Normalization of the identifiers the SGO list is matched on: EINs, organization names, calendar dates.
 * Pure functions, shared by the list parser, the profile validators and the directory search.
 */

/** Canonical EIN form, as printed on IRS letters: two digits, a hyphen, seven digits. */
export const EIN_PATTERN = /^\d{2}-\d{7}$/;

/**
 * POLICY: "00" is not among the prefixes the IRS assigns EINs from, so the sandbox list uses it for its fictional
 * organizations. Outside production they are ordinary EINs; in production they are refused
 * wherever an EIN enters the system, so demo data can never be taken for a real organization.
 */
export const SANDBOX_EIN_PREFIX = "00";

/** "12-3456789" or "123456789" (surrounding spaces allowed) → "12-3456789"; anything else → null. */
export function normalizeEin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (EIN_PATTERN.test(v)) return v;
  if (/^\d{9}$/.test(v)) return `${v.slice(0, 2)}-${v.slice(2)}`;
  return null;
}

export function isSandboxEin(ein: string): boolean {
  return ein.startsWith(SANDBOX_EIN_PREFIX);
}

/** Read straight from process.env, like src/server/settings: a cached env() must never relax a production rule. */
export function inProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Case- and diacritic-insensitive comparison key for names: "Niños  de Texas, Inc." → "ninos de texas inc".
 * "&" reads as "and" so "A & B" and "A and B" match.
 */
export function nameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Trims and collapses internal whitespace. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/** True for a real calendar date written YYYY-MM-DD (rejects 2027-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-12-31" → "December 31, 2026" (the date is a calendar date, so no time zone is involved). */
export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The list's upsert identity within (source, state). */
export function listMatchKey(ein: string | null, name: string): string {
  return ein ? `ein:${ein}` : `name:${nameKey(name)}`;
}
