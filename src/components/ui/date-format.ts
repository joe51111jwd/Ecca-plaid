export type DateTimeFormat = "date" | "dateLong" | "dateTime" | "time" | "monthYear" | "relative";

export interface DateTimeOptions {
  /** IANA zone. Default US Central — the reference zone for Texas deadlines — so server and browser render the same text. */
  timeZone?: string;
  locale?: "en" | "es";
  /** Required for `relative`: the current time, from `now()` in src/lib/clock. */
  now?: Date;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCALE_TAG = { en: "en-US", es: "es-US" } as const;
export const DEFAULT_TIME_ZONE = "America/Chicago";

/** Parses a Date, epoch milliseconds or ISO string. Returns null for anything that is not a real instant. */
export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True for a calendar date with no time ("2026-05-01"): it names a day, not an instant, and must never shift across zones. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

const RELATIVE_STEPS: Array<[limitSeconds: number, unit: Intl.RelativeTimeFormatUnit, seconds: number]> = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86_400, "hour", 3600],
  [604_800, "day", 86_400],
  [2_629_800, "week", 604_800],
  [31_557_600, "month", 2_629_800],
  [Infinity, "year", 31_557_600],
];

/**
 * One consistent way to print dates.
 *   date      "Nov 18, 2026"          dateLong  "November 18, 2026"
 *   dateTime  "Nov 18, 2026, 2:05 PM CST"       time  "2:05 PM CST"
 *   monthYear "November 2026"         relative  "3 hours ago" (needs opts.now)
 * Date-only strings (YYYY-MM-DD) are printed as that calendar day in every zone. Invalid input → "".
 */
export function formatDateTime(value: Date | string | number | null | undefined, format: DateTimeFormat = "date", opts: DateTimeOptions = {}): string {
  const locale = LOCALE_TAG[opts.locale ?? "en"];
  const dateOnly = isDateOnly(value);
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : toDate(value);
  if (!date) return "";
  const timeZone = dateOnly ? "UTC" : (opts.timeZone ?? DEFAULT_TIME_ZONE);

  switch (format) {
    case "date":
      return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "numeric" }).format(date);
    case "dateLong":
      return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "long", day: "numeric" }).format(date);
    case "monthYear":
      return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "long" }).format(date);
    case "time":
      // A date-only value has no time of day.
      if (dateOnly) return "";
      return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
    case "dateTime":
      if (dateOnly) return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "numeric" }).format(date);
      return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
    case "relative": {
      if (!opts.now) return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "short", day: "numeric" }).format(date);
      const diffSeconds = (date.getTime() - opts.now.getTime()) / 1000;
      const abs = Math.abs(diffSeconds);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      for (const [limit, unit, seconds] of RELATIVE_STEPS) {
        if (abs < limit) return rtf.format(Math.round(diffSeconds / seconds), unit);
      }
      return "";
    }
  }
}

/** The unambiguous full timestamp used for the `title` tooltip: "Wednesday, November 18, 2026 at 2:05:09 PM CST". */
export function formatFullTimestamp(value: Date | string | number | null | undefined, opts: DateTimeOptions = {}): string {
  const locale = LOCALE_TAG[opts.locale ?? "en"];
  if (isDateOnly(value)) {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00Z`));
  }
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: opts.timeZone ?? DEFAULT_TIME_ZONE, dateStyle: "full", timeStyle: "long" }).format(date);
}
