/**
 * Calendar arithmetic in named time zones, without a clock: every function takes the instant or the date
 * it works on. Uses only `Intl`, so it behaves the same on the server and in the browser.
 */
import { invalid } from "@/lib/errors";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  // An empty or missing zone would silently fall back to the machine's zone, which is never what a tax date means.
  if (typeof timeZone !== "string" || timeZone.trim() === "") throw unknownTimeZone(timeZone);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw unknownTimeZone(timeZone);
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

function unknownTimeZone(timeZone: unknown) {
  return invalid(`Unknown time zone: ${String(timeZone)}`, { fields: { timeZone: "Must be an IANA time zone such as America/Chicago" } });
}

function assertInstant(instant: Date, field: string): void {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw invalid(`${field} must be a valid date and time`, { fields: { [field]: "Must be a valid date and time" } });
  }
}

export interface ZonedDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** The calendar date, YYYY-MM-DD. */
  isoDate: string;
}

/** The wall-clock date and time of an instant in an IANA time zone. */
export function zonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  assertInstant(instant, "instant");
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function assertIsoDate(value: unknown, field: string): asserts value is string {
  if (!isIsoDate(value)) {
    throw invalid(`${field} must be a calendar date in YYYY-MM-DD form`, { fields: { [field]: "Must be a calendar date in YYYY-MM-DD form" } });
  }
}

const SEARCH_WINDOW_MS = 16 * 3_600_000;

/**
 * The first instant at which the calendar date `isoDate` has begun in `timeZone`.
 *
 * Found by bisection over the instants within 16 hours of UTC midnight (zone offsets lie between UTC-12 and
 * UTC+14, so the answer is always inside), which stays correct across daylight-saving changes without
 * assuming a fixed offset.
 */
export function startOfDateInTimeZone(isoDate: string, timeZone: string): Date {
  assertIsoDate(isoDate, "date");
  formatterFor(timeZone);
  const utcMidnight = Date.parse(`${isoDate}T00:00:00Z`);
  let before = utcMidnight - SEARCH_WINDOW_MS; // the date has not begun in any zone
  let reached = utcMidnight + SEARCH_WINDOW_MS; // the date has begun in every zone
  while (reached - before > 1) {
    const middle = before + Math.floor((reached - before) / 2);
    if (zonedDateTime(new Date(middle), timeZone).isoDate >= isoDate) reached = middle;
    else before = middle;
  }
  return new Date(reached);
}

export type DateLocale = "en" | "es";

const LONG_DATE_LOCALE: Readonly<Record<DateLocale, string>> = { en: "en-US", es: "es-US" };

/** "2027-01-01" → "January 1, 2027" (or "1 de enero de 2027"). */
export function formatIsoDateLong(isoDate: string, locale: DateLocale = "en"): string {
  assertIsoDate(isoDate, "date");
  return new Intl.DateTimeFormat(LONG_DATE_LOCALE[locale], { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** "2027-01-31" → "January 31" (or "31 de enero"): a recurring deadline without its year. */
export function formatMonthDayLong(month: number, day: number, locale: DateLocale = "en"): string {
  // 2024 is a leap year, so every real month/day pair (including February 29) formats.
  const date = new Date(Date.UTC(2024, month - 1, day));
  if (!Number.isInteger(month) || !Number.isInteger(day) || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalid("month and day must form a real calendar date", { fields: { day: "Must be a real calendar date" } });
  }
  return new Intl.DateTimeFormat(LONG_DATE_LOCALE[locale], { timeZone: "UTC", month: "long", day: "numeric" }).format(date);
}
