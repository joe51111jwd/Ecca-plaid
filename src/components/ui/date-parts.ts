/** The three text fields of a DateInput, exactly as typed (digits only). */
export interface DateParts {
  month: string;
  day: string;
  year: string;
}

export const EMPTY_DATE_PARTS: DateParts = { month: "", day: "", year: "" };

export type DatePartsProblem = "incomplete" | "invalid_month" | "invalid_day" | "invalid_year" | "before_min" | "after_max";

export type DatePartsResult = { ok: true; iso: string } | { ok: false; problem: DatePartsProblem; field: keyof DateParts | null };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Keeps ASCII digits only (after folding full-width digits) and truncates to `maxLength`. */
export function digitsOnly(raw: string, maxLength: number): string {
  return raw
    .normalize("NFKC")
    .replace(/[^0-9]/g, "")
    .slice(0, maxLength);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** "2015-03-09" → { month: "3", day: "9", year: "2015" }. Anything that is not a real ISO calendar date → empty parts. */
export function partsFromIso(iso: string | null | undefined): DateParts {
  if (!iso) return { ...EMPTY_DATE_PARTS };
  const m = ISO_DATE.exec(iso);
  if (!m) return { ...EMPTY_DATE_PARTS };
  const parts = { month: String(Number(m[2])), day: String(Number(m[3])), year: m[1] };
  return checkDateParts(parts).ok ? parts : { ...EMPTY_DATE_PARTS };
}

/**
 * Validates the three fields as one calendar date.
 * `min` / `max` are inclusive ISO dates (e.g. max = today for a date of birth). The year must be four digits:
 * two-digit years are rejected rather than guessed.
 */
export function checkDateParts(parts: DateParts, bounds: { min?: string; max?: string } = {}): DatePartsResult {
  const { month, day, year } = parts;
  if (month === "" || day === "" || year === "") {
    const field = month === "" ? "month" : day === "" ? "day" : "year";
    return { ok: false, problem: "incomplete", field };
  }
  if (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12) return { ok: false, problem: "invalid_month", field: "month" };
  if (!/^\d{4}$/.test(year) || Number(year) < 1) return { ok: false, problem: "invalid_year", field: "year" };
  const y = Number(year);
  const mo = Number(month);
  if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > daysInMonth(y, mo)) return { ok: false, problem: "invalid_day", field: "day" };
  const iso = `${year}-${String(mo).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  // Zero-padded ISO dates order correctly as strings.
  if (bounds.min && iso < bounds.min) return { ok: false, problem: "before_min", field: null };
  if (bounds.max && iso > bounds.max) return { ok: false, problem: "after_max", field: null };
  return { ok: true, iso };
}

/** The ISO date for complete, valid parts; otherwise null. */
export function isoFromParts(parts: DateParts, bounds: { min?: string; max?: string } = {}): string | null {
  const result = checkDateParts(parts, bounds);
  return result.ok ? result.iso : null;
}
