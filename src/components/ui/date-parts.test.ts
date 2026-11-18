import { describe, expect, it } from "vitest";
import { checkDateParts, daysInMonth, digitsOnly, isoFromParts, partsFromIso } from "./date-parts";

describe("digitsOnly", () => {
  it("keeps ASCII digits and truncates", () => {
    expect(digitsOnly("03", 2)).toBe("03");
    expect(digitsOnly("3/", 2)).toBe("3");
    expect(digitsOnly("2015abc", 4)).toBe("2015");
    expect(digitsOnly("20155", 4)).toBe("2015");
    expect(digitsOnly("-1", 2)).toBe("1");
    expect(digitsOnly("１２", 2)).toBe("12");
  });
});

describe("daysInMonth", () => {
  it("knows month lengths and leap years, including century rules", () => {
    expect(daysInMonth(2015, 1)).toBe(31);
    expect(daysInMonth(2015, 4)).toBe(30);
    expect(daysInMonth(2015, 2)).toBe(28);
    expect(daysInMonth(2016, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe("checkDateParts", () => {
  it("accepts a real date and zero-pads the ISO form", () => {
    expect(checkDateParts({ month: "3", day: "9", year: "2015" })).toEqual({ ok: true, iso: "2015-03-09" });
    expect(checkDateParts({ month: "03", day: "09", year: "2015" })).toEqual({ ok: true, iso: "2015-03-09" });
    expect(checkDateParts({ month: "12", day: "31", year: "1999" })).toEqual({ ok: true, iso: "1999-12-31" });
  });

  it("reports the first missing field as incomplete", () => {
    expect(checkDateParts({ month: "", day: "", year: "" })).toEqual({ ok: false, problem: "incomplete", field: "month" });
    expect(checkDateParts({ month: "3", day: "", year: "2015" })).toEqual({ ok: false, problem: "incomplete", field: "day" });
    expect(checkDateParts({ month: "3", day: "9", year: "" })).toEqual({ ok: false, problem: "incomplete", field: "year" });
  });

  it("rejects impossible months and days", () => {
    expect(checkDateParts({ month: "13", day: "1", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_month", field: "month" });
    expect(checkDateParts({ month: "0", day: "1", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_month" });
    expect(checkDateParts({ month: "00", day: "1", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_month" });
    expect(checkDateParts({ month: "4", day: "31", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_day", field: "day" });
    expect(checkDateParts({ month: "1", day: "0", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_day" });
    expect(checkDateParts({ month: "1", day: "32", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_day" });
  });

  it("applies leap-year rules to February 29", () => {
    expect(checkDateParts({ month: "2", day: "29", year: "2016" })).toEqual({ ok: true, iso: "2016-02-29" });
    expect(checkDateParts({ month: "2", day: "29", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_day" });
    expect(checkDateParts({ month: "2", day: "29", year: "1900" })).toMatchObject({ ok: false, problem: "invalid_day" });
    expect(checkDateParts({ month: "2", day: "29", year: "2000" })).toEqual({ ok: true, iso: "2000-02-29" });
  });

  it("refuses to guess a two-digit year", () => {
    expect(checkDateParts({ month: "3", day: "9", year: "15" })).toMatchObject({ ok: false, problem: "invalid_year", field: "year" });
    expect(checkDateParts({ month: "3", day: "9", year: "015" })).toMatchObject({ ok: false, problem: "invalid_year" });
    expect(checkDateParts({ month: "3", day: "9", year: "0000" })).toMatchObject({ ok: false, problem: "invalid_year" });
  });

  it("rejects non-digit text that could not come from the component but could come from a caller", () => {
    expect(checkDateParts({ month: "3a", day: "9", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_month" });
    expect(checkDateParts({ month: "3", day: "9.", year: "2015" })).toMatchObject({ ok: false, problem: "invalid_day" });
    expect(checkDateParts({ month: "3", day: "9", year: "20x5" })).toMatchObject({ ok: false, problem: "invalid_year" });
  });

  it("enforces inclusive min and max bounds", () => {
    const bounds = { min: "2008-01-01", max: "2026-11-18" };
    expect(checkDateParts({ month: "1", day: "1", year: "2008" }, bounds)).toEqual({ ok: true, iso: "2008-01-01" });
    expect(checkDateParts({ month: "11", day: "18", year: "2026" }, bounds)).toEqual({ ok: true, iso: "2026-11-18" });
    expect(checkDateParts({ month: "12", day: "31", year: "2007" }, bounds)).toEqual({ ok: false, problem: "before_min", field: null });
    expect(checkDateParts({ month: "11", day: "19", year: "2026" }, bounds)).toEqual({ ok: false, problem: "after_max", field: null });
  });
});

describe("isoFromParts / partsFromIso", () => {
  it("round-trips real dates", () => {
    for (const iso of ["2015-03-09", "2000-02-29", "1999-12-31", "2026-01-01"]) {
      expect(isoFromParts(partsFromIso(iso))).toBe(iso);
    }
  });

  it("returns null for anything that is not a complete, real date", () => {
    expect(isoFromParts({ month: "2", day: "30", year: "2015" })).toBeNull();
    expect(isoFromParts({ month: "", day: "", year: "" })).toBeNull();
  });

  it("gives empty parts for missing or malformed ISO input", () => {
    const blank = { month: "", day: "", year: "" };
    expect(partsFromIso(null)).toEqual(blank);
    expect(partsFromIso(undefined)).toEqual(blank);
    expect(partsFromIso("")).toEqual(blank);
    expect(partsFromIso("03/09/2015")).toEqual(blank);
    expect(partsFromIso("2015-02-30")).toEqual(blank);
    expect(partsFromIso("2015-13-01")).toEqual(blank);
    expect(partsFromIso("2015-03-09T00:00:00Z")).toEqual(blank);
  });

  it("returns a fresh object each time", () => {
    const a = partsFromIso(null);
    a.month = "5";
    expect(partsFromIso(null).month).toBe("");
  });
});
