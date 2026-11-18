import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertIsoDate, formatIsoDateLong, formatMonthDayLong, isIsoDate, startOfDateInTimeZone, zonedDateTime } from "./dates";

function expectValidationError(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe("validation_failed");
}

describe("zonedDateTime", () => {
  it("gives the wall-clock date and time in a zone", () => {
    expect(zonedDateTime(new Date("2027-01-01T05:59:59Z"), "America/Chicago")).toEqual({ year: 2026, month: 12, day: 31, hour: 23, minute: 59, second: 59, isoDate: "2026-12-31" });
    expect(zonedDateTime(new Date("2027-01-01T06:00:00Z"), "America/Chicago")).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 0, second: 0, isoDate: "2027-01-01" });
    expect(zonedDateTime(new Date("2027-07-04T12:00:00Z"), "America/New_York")).toMatchObject({ isoDate: "2027-07-04", hour: 8 });
    expect(zonedDateTime(new Date("2027-07-04T12:00:00Z"), "UTC")).toMatchObject({ isoDate: "2027-07-04", hour: 12 });
    expect(zonedDateTime(new Date("2027-07-04T12:00:00Z"), "Asia/Kolkata")).toMatchObject({ isoDate: "2027-07-04", hour: 17, minute: 30 });
  });

  it("accepts a zone name in any letter case, however many spellings a caller sends", () => {
    const instant = new Date("2027-01-01T06:00:00Z");
    const spellings = Array.from({ length: 300 }, (_unused, i) =>
      Array.from("america/chicago", (char, position) => (((i >> position % 9) & 1) === 1 ? char.toUpperCase() : char)).join(""),
    );
    for (const spelling of spellings) expect(zonedDateTime(instant, spelling).isoDate).toBe("2027-01-01");
    expect(zonedDateTime(instant, "America/Chicago")).toMatchObject({ isoDate: "2027-01-01", hour: 0 });
  });

  it("rejects an unknown or empty zone and an invalid instant", () => {
    expectValidationError(() => zonedDateTime(new Date(), "Nowhere/Land"));
    expectValidationError(() => zonedDateTime(new Date(), ""));
    expectValidationError(() => zonedDateTime(new Date(), "   "));
    expectValidationError(() => zonedDateTime(new Date(Number.NaN), "UTC"));
    expectValidationError(() => zonedDateTime("2027-01-01" as unknown as Date, "UTC"));
  });
});

describe("startOfDateInTimeZone", () => {
  it.each([
    ["2027-01-01", "Pacific/Honolulu", "2027-01-01T10:00:00.000Z"],
    ["2027-01-01", "America/New_York", "2027-01-01T05:00:00.000Z"],
    ["2027-01-01", "America/Chicago", "2027-01-01T06:00:00.000Z"],
    ["2027-07-01", "America/Chicago", "2027-07-01T05:00:00.000Z"],
    ["2027-07-01", "Pacific/Honolulu", "2027-07-01T10:00:00.000Z"],
    ["2027-07-01", "America/Adak", "2027-07-01T09:00:00.000Z"],
    ["2027-01-01", "America/Adak", "2027-01-01T10:00:00.000Z"],
    ["2027-01-01", "UTC", "2027-01-01T00:00:00.000Z"],
    ["2027-01-01", "Pacific/Kiritimati", "2026-12-31T10:00:00.000Z"],
    ["2027-01-01", "Etc/GMT+12", "2027-01-01T12:00:00.000Z"],
    ["2027-01-01", "Asia/Kolkata", "2026-12-31T18:30:00.000Z"],
    // The days on which U.S. daylight-saving time starts and ends in 2027.
    ["2027-03-14", "America/New_York", "2027-03-14T05:00:00.000Z"],
    ["2027-03-15", "America/New_York", "2027-03-15T04:00:00.000Z"],
    ["2027-11-07", "America/New_York", "2027-11-07T04:00:00.000Z"],
    ["2027-11-08", "America/New_York", "2027-11-08T05:00:00.000Z"],
    ["2028-02-29", "America/Denver", "2028-02-29T07:00:00.000Z"],
  ])("%s begins in %s at %s", (isoDate, timeZone, expected) => {
    const start = startOfDateInTimeZone(isoDate, timeZone);
    expect(start.toISOString()).toBe(expected);
    expect(zonedDateTime(start, timeZone)).toMatchObject({ isoDate, hour: 0, minute: 0, second: 0 });
    expect(zonedDateTime(new Date(start.getTime() - 1), timeZone).isoDate < isoDate).toBe(true);
  });

  it("finds the first instant of a date that begins after midnight because of a clock change", () => {
    // In Cairo the clocks went forward at midnight on April 26, 2024, so that date began at 01:00 local time.
    const start = startOfDateInTimeZone("2024-04-26", "Africa/Cairo");
    expect(start.toISOString()).toBe("2024-04-25T22:00:00.000Z");
    expect(zonedDateTime(start, "Africa/Cairo")).toMatchObject({ isoDate: "2024-04-26", hour: 1 });
    expect(zonedDateTime(new Date(start.getTime() - 1), "Africa/Cairo").isoDate).toBe("2024-04-25");
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2027-1-1", "01/01/2027", "2027-02-30", "2027-13-01", "2027-00-10", "0999-01-01", "", "2027-01-01T00:00:00Z"]) {
      expectValidationError(() => startOfDateInTimeZone(bad, "UTC"));
    }
    expectValidationError(() => startOfDateInTimeZone("2027-01-01", "Nowhere/Land"));
  });
});

describe("ISO dates and long formats", () => {
  it("recognizes real calendar dates only", () => {
    expect(isIsoDate("2027-01-01")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2027-04-31")).toBe(false);
    expect(isIsoDate(20270101)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(() => assertIsoDate("2027-01-01", "date")).not.toThrow();
    expectValidationError(() => assertIsoDate("2027-01-32", "date"));
  });

  it("writes dates out in words, in English and Spanish", () => {
    expect(formatIsoDateLong("2027-01-01")).toBe("January 1, 2027");
    expect(formatIsoDateLong("2027-02-15")).toBe("February 15, 2027");
    expect(formatIsoDateLong("2027-12-31")).toBe("December 31, 2027");
    expect(formatIsoDateLong("2027-01-01", "es")).toBe("1 de enero de 2027");
    expect(formatMonthDayLong(1, 31)).toBe("January 31");
    expect(formatMonthDayLong(2, 28)).toBe("February 28");
    expect(formatMonthDayLong(2, 29)).toBe("February 29");
    expect(formatMonthDayLong(1, 31, "es")).toBe("31 de enero");
    expectValidationError(() => formatIsoDateLong("2027-02-30"));
    expectValidationError(() => formatMonthDayLong(2, 30));
    expectValidationError(() => formatMonthDayLong(13, 1));
    expectValidationError(() => formatMonthDayLong(1.5, 1));
  });
});
