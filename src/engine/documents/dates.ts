/**
 * Strict date parsing for documents.
 *
 * Formats seen in the sources (P0 date rules): `MM/DD/YYYY` (HHSC, HUD), `Month D, YYYY` (SSA),
 * `MM-DD-YYYY` and `Mon. DD, YYYY` / `Mon.DD, YYYY` (IRS transcripts, H4). ISO `YYYY-MM-DD` is accepted.
 *
 * Policy `NUMERIC_DATE_ORDER = "MDY"`: every document this reader accepts is issued by a United States agency
 * or employer, and every verified sample prints month first. A numeric date is therefore read month-first,
 * and anything that does not fit that reading is rejected as ambiguous rather than guessed:
 *  - a two-digit year (`03/04/26`): century and order are both guesses;
 *  - a first component above 12 (`13/02/2026`): day-first writing, not the US form;
 *  - dotted numerics (`03.04.2026`): a European convention, order unknown.
 * Pure: no clock. `Date.UTC` is used only to validate calendar days.
 */
import type { IsoDate } from "./types";

export const NUMERIC_DATE_ORDER = "MDY" as const;

export type DateParseResult =
  | { ok: true; date: IsoDate; format: DateFormat }
  | { ok: false; reason: "ambiguous" | "invalid" | "empty" };

export type DateFormat = "mdy_slash" | "mdy_dash" | "iso" | "month_name";

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
});

const MONTH_NAME = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Years outside this range are rejected as misreads. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): IsoDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(name: string): number | null {
  return MONTHS[name.toLowerCase().replace(/\.$/, "")] ?? null;
}

/** Parses one date written alone (surrounding whitespace allowed). */
export function parseDocumentDate(input: string): DateParseResult {
  const s = input.trim().replace(/\s+/g, " ");
  if (s === "") return { ok: false, reason: "empty" };

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { ok: true, date: d, format: "iso" } : { ok: false, reason: "invalid" };
  }

  m = /^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    if (m[4].length === 2) return { ok: false, reason: "ambiguous" };
    if (a > 12 && b <= 12) return { ok: false, reason: "ambiguous" };
    const d = isoDate(Number(m[4]), a, b);
    return d ? { ok: true, date: d, format: m[2] === "/" ? "mdy_slash" : "mdy_dash" } : { ok: false, reason: "invalid" };
  }

  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(s)) return { ok: false, reason: "ambiguous" };
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d+$/.test(s)) return { ok: false, reason: "invalid" };

  // "September 15, 2026", "Sep. 15, 2026", "Dec.31, 2025", "Apr.15, 2020"
  m = new RegExp(`^${MONTH_NAME}\\.? ?(\\d{1,2}),? (\\d{4})$`, "i").exec(s);
  if (m) {
    const month = monthNumber(m[1]);
    const d = month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
    return d ? { ok: true, date: d, format: "month_name" } : { ok: false, reason: "invalid" };
  }
  // "15 September 2026"
  m = new RegExp(`^(\\d{1,2}) ${MONTH_NAME}\\.?,? (\\d{4})$`, "i").exec(s);
  if (m) {
    const month = monthNumber(m[2]);
    const d = month ? isoDate(Number(m[3]), month, Number(m[1])) : null;
    return d ? { ok: true, date: d, format: "month_name" } : { ok: false, reason: "invalid" };
  }
  return { ok: false, reason: "invalid" };
}

/**
 * Pattern that finds date-looking tokens inside a line, including ambiguous ones (so they can be reported
 * rather than skipped). Form-version stamps such as `06/2026` or `(10/2026)` have no day and never match.
 */
export const DATE_TOKEN_SOURCE =
  `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|${MONTH_NAME}\\.? ?\\d{1,2},? \\d{4}|\\d{1,2} ${MONTH_NAME}\\.?,? \\d{4})`;

export interface FoundDate {
  raw: string;
  index: number;
  result: DateParseResult;
}

/** Every date-looking token in the text, in order, with its parse result. */
export function findDates(text: string): FoundDate[] {
  const re = new RegExp(`(?<![\\d/.-])${DATE_TOKEN_SOURCE}(?![\\d/])`, "gi");
  const out: FoundDate[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ raw: m[0], index: m.index ?? 0, result: parseDocumentDate(m[0]) });
  }
  return out;
}

/** "January 2026" / "Jan. 2026" → `{ year, month }`. Used for SSA "Beginning <Month YYYY>" and "Through". */
export function parseMonthYear(input: string): { year: number; month: number } | null {
  const m = new RegExp(`^${MONTH_NAME}\\.?,? (\\d{4})$`, "i").exec(input.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const month = monthNumber(m[1]);
  const year = Number(m[2]);
  if (!month || year < MIN_YEAR || year > MAX_YEAR) return null;
  return { year, month };
}

/** Whole days from `a` to `b` (positive when b is later). Both must be valid ISO dates. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The same calendar day `months` months earlier, clamped to the month's last day (Mar 31 − 1 → Feb 28/29). */
export function subtractMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return isoDate(year, month, Math.min(d, daysInMonth(year, month))) as IsoDate;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) as IsoDate;
}
