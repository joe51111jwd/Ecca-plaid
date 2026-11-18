/**
 * Calendar-date arithmetic on `YYYY-MM-DD` strings.
 *
 * Pure: there is no clock and no time zone here. A date is the calendar date the caller already resolved
 * (application date, letter date, pay date). `Date.UTC` is used only as a day counter.
 */

/** A real calendar date written `YYYY-MM-DD`. */
export type IsoDate = string;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function parse(value: string): CalendarDate | null {
  const m = ISO_DATE_PATTERN.exec(value);
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null;
  return date;
}

function required(value: string): CalendarDate {
  const date = parse(value);
  if (!date) throw new RangeError(`Not a calendar date written YYYY-MM-DD: ${JSON.stringify(value)}`);
  return date;
}

function format(date: CalendarDate): IsoDate {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function dayNumber(date: CalendarDate): number {
  return Math.round(Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY);
}

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30 and 2027-02-29). */
export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === "string" && parse(value) !== null;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Calendar year of a date. */
export function yearOf(date: IsoDate): number {
  return required(date).year;
}

/** December 31 of a year. */
export function lastDayOfYear(year: number): IsoDate {
  return format({ year, month: 12, day: 31 });
}

/** 1 for January 1, 365 or 366 for December 31. */
export function dayOfYear(date: IsoDate): number {
  const d = required(date);
  return dayNumber(d) - dayNumber({ year: d.year, month: 1, day: 1 }) + 1;
}

/**
 * The same day of the month `months` months later (or earlier, for a negative count). When the target month
 * is shorter, the result is its last day: 2028-02-29 minus 12 months is 2027-02-28, and 2026-08-31 plus
 * 6 months is 2027-02-28. This is the usual calendar reading of "N months before" and never lands in the
 * following month.
 */
export function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const d = required(date);
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return format({ year, month, day: Math.min(d.day, daysInMonth(year, month)) });
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const shifted = new Date((dayNumber(required(date)) + days) * MS_PER_DAY);
  return format({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
}

/** The earliest of the given dates. ISO dates order the same way as strings. */
export function earliestDate(first: IsoDate, ...rest: IsoDate[]): IsoDate {
  return rest.reduce((min, d) => (d < min ? d : min), first);
}

const MONTH_NAMES: Record<"en" | "es", readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

/** "2027-03-15" -> "March 15, 2027" (en) or "15 de marzo de 2027" (es). */
export function formatLongDate(date: IsoDate, locale: "en" | "es"): string {
  const d = required(date);
  const month = MONTH_NAMES[locale][d.month - 1];
  return locale === "es" ? `${d.day} de ${month} de ${d.year}` : `${month} ${d.day}, ${d.year}`;
}
