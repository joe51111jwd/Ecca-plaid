import { describe, expect, it } from "vitest";
import { formatDateTime, formatFullTimestamp, isDateOnly, toDate } from "./date-format";

/** Intl uses narrow no-break spaces before AM/PM in newer ICU data; compare on normalised spaces. */
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("toDate / isDateOnly", () => {
  it("parses dates, ISO strings and epoch milliseconds", () => {
    expect(toDate("2026-11-18T20:52:00Z")?.toISOString()).toBe("2026-11-18T20:52:00.000Z");
    expect(toDate(new Date("2026-11-18T20:52:00Z"))?.toISOString()).toBe("2026-11-18T20:52:00.000Z");
    expect(toDate(0)?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns null for empty or invalid input", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate("not a date")).toBeNull();
    expect(toDate(new Date(Number.NaN))).toBeNull();
  });

  it("does not hand back the caller's Date instance", () => {
    const original = new Date("2026-11-18T20:52:00Z");
    expect(toDate(original)).not.toBe(original);
  });

  it("recognises only real calendar dates as date-only", () => {
    expect(isDateOnly("2026-05-01")).toBe(true);
    expect(isDateOnly("2024-02-29")).toBe(true);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-13-01")).toBe(false);
    expect(isDateOnly("2026-5-1")).toBe(false);
    expect(isDateOnly("2026-05-01T00:00:00Z")).toBe(false);
    expect(isDateOnly(new Date())).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
});

describe("formatDateTime", () => {
  const instant = "2026-11-18T20:52:09Z"; // 2:52 PM Central (CST, UTC-6)

  it("formats in US Central by default, regardless of the server's zone", () => {
    expect(formatDateTime(instant)).toBe("Nov 18, 2026");
    expect(formatDateTime(instant, "dateLong")).toBe("November 18, 2026");
    expect(formatDateTime(instant, "monthYear")).toBe("November 2026");
    expect(plain(formatDateTime(instant, "time"))).toBe("2:52 PM CST");
    expect(plain(formatDateTime(instant, "dateTime"))).toBe("Nov 18, 2026, 2:52 PM CST");
  });

  it("uses the Central calendar day near midnight UTC", () => {
    // 03:30 UTC on the 19th is still the evening of the 18th in Texas.
    expect(formatDateTime("2026-11-19T03:30:00Z")).toBe("Nov 18, 2026");
    // The credit start date at local midnight.
    expect(formatDateTime("2027-01-01T06:00:00Z", "dateLong")).toBe("January 1, 2027");
    expect(formatDateTime("2027-01-01T05:59:59Z", "dateLong")).toBe("December 31, 2026");
  });

  it("follows daylight saving time", () => {
    expect(plain(formatDateTime("2026-07-04T17:00:00Z", "time"))).toBe("12:00 PM CDT");
  });

  it("honours an explicit time zone", () => {
    expect(plain(formatDateTime(instant, "dateTime", { timeZone: "UTC" }))).toBe("Nov 18, 2026, 8:52 PM UTC");
    expect(formatDateTime("2026-11-19T03:30:00Z", "date", { timeZone: "UTC" })).toBe("Nov 19, 2026");
  });

  it("prints a date-only string as that calendar day in every zone", () => {
    for (const timeZone of ["America/Chicago", "Pacific/Honolulu", "Pacific/Kiritimati", "UTC"]) {
      expect(formatDateTime("2026-05-01", "dateLong", { timeZone })).toBe("May 1, 2026");
      expect(formatDateTime("2026-01-01", "date", { timeZone })).toBe("Jan 1, 2026");
    }
    expect(formatDateTime("2026-05-01", "dateTime")).toBe("May 1, 2026");
    expect(formatDateTime("2026-05-01", "time")).toBe("");
  });

  it("formats in Spanish", () => {
    expect(formatDateTime(instant, "dateLong", { locale: "es" })).toBe("18 de noviembre de 2026");
    expect(formatDateTime("2026-05-01", "monthYear", { locale: "es" })).toBe("mayo de 2026");
  });

  it("returns an empty string for missing or invalid values", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined, "dateTime")).toBe("");
    expect(formatDateTime("", "relative", { now: new Date(instant) })).toBe("");
    expect(formatDateTime("garbage")).toBe("");
    expect(formatDateTime("2026-02-30")).toBe("");
  });

  describe("relative", () => {
    const now = new Date("2026-11-18T21:30:00Z");

    it("counts back and forward from the supplied now", () => {
      expect(formatDateTime("2026-11-18T21:29:30Z", "relative", { now })).toBe("30 seconds ago");
      expect(formatDateTime("2026-11-18T20:52:00Z", "relative", { now })).toBe("38 minutes ago");
      expect(formatDateTime("2026-11-18T18:14:00Z", "relative", { now })).toBe("3 hours ago");
      expect(formatDateTime("2026-11-17T15:31:00Z", "relative", { now })).toBe("yesterday");
      expect(formatDateTime("2026-11-16T19:20:00Z", "relative", { now })).toBe("2 days ago");
      expect(formatDateTime("2026-10-02T14:00:00Z", "relative", { now })).toBe("2 months ago");
      expect(formatDateTime("2024-11-18T21:30:00Z", "relative", { now })).toBe("2 years ago");
      expect(formatDateTime("2026-11-21T21:30:00Z", "relative", { now })).toBe("in 3 days");
      expect(formatDateTime(now, "relative", { now })).toBe("now");
    });

    it("speaks Spanish", () => {
      expect(formatDateTime("2026-11-18T18:14:00Z", "relative", { now, locale: "es" })).toBe("hace 3 horas");
    });

    it("falls back to the plain date when no now is given, instead of reading the clock", () => {
      expect(formatDateTime("2026-11-18T20:52:00Z", "relative")).toBe("Nov 18, 2026");
    });
  });
});

describe("formatFullTimestamp", () => {
  it("is unambiguous: weekday, full date, seconds and zone", () => {
    expect(plain(formatFullTimestamp("2026-11-18T20:52:09Z"))).toBe("Wednesday, November 18, 2026 at 2:52:09 PM CST");
  });

  it("omits the time for date-only values and is empty for invalid ones", () => {
    expect(formatFullTimestamp("2026-05-01")).toBe("Friday, May 1, 2026");
    expect(formatFullTimestamp(null)).toBe("");
    expect(formatFullTimestamp("nope")).toBe("");
  });
});
