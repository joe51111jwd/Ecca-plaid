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
 * Latin letters that Unicode decomposition (NFKD) leaves whole, folded to the ASCII a reader would type.
 * Without this "Straße" and "Søren" would lose those letters and never match "strasse" / "soren".
 */
const LATIN_FOLDS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  ł: "l",
  Ł: "l",
  þ: "th",
  Þ: "th",
  ı: "i",
};
const LATIN_FOLD_RE = new RegExp(`[${Object.keys(LATIN_FOLDS).join("")}]`, "g");

/**
 * Case- and diacritic-insensitive comparison key for names: "Niños  de Texas, Inc." → "ninos de texas inc".
 * "&" reads as "and" so "A & B" and "A and B" match. Letters and digits of every script are kept, so names
 * written in other scripts keep distinct keys; a name with no letters or digits at all has the empty key.
 */
export function nameKey(value: string): string {
  return value
    .replace(LATIN_FOLD_RE, (c) => LATIN_FOLDS[c] ?? c)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Trims and collapses internal whitespace. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Identifiers that reach a query (organization ids, list entry ids, slugs) are short ASCII tokens. Anything else is
 * refused before the database sees it: Postgres rejects text containing NUL with an error, not an empty result.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

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
