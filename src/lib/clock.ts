/**
 * Single source of "now" for the whole app.
 *
 * Date-sensitive rules (the Jan 1, 2027 credit start, 12-month award-letter window, link expiry,
 * hold windows, retention) must call `now()` instead of `new Date()` so they can be tested.
 *
 * Overrides (never honoured in production):
 *  - tests: `setTestNow(date)` / `setTestNow(null)`
 *  - e2e / demos: env `ECCA_FAKE_NOW=2027-01-15T12:00:00Z`
 */
let testNow: Date | null = null;

export function setTestNow(d: Date | string | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("setTestNow is not allowed in production");
  testNow = d === null ? null : new Date(d);
}

export function now(): Date {
  if (process.env.NODE_ENV !== "production") {
    if (testNow) return new Date(testNow.getTime());
    const fake = process.env.ECCA_FAKE_NOW;
    if (fake) {
      const d = new Date(fake);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

export const MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

/** Calendar-date string (YYYY-MM-DD) in US Central time, the reference zone for Texas deadlines. */
export function centralDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Calendar year in US Central time. */
export function centralYear(d: Date): number {
  return Number(centralDateString(d).slice(0, 4));
}
