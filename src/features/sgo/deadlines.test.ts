import { describe, expect, it } from "vitest";
import { currentReportingYear, daysUntil, deadlineOf, pickTaxYear, reportingDeadlines, taxYearOptions } from "./deadlines";

describe("deadlines", () => {
  it("counts whole calendar days, across month and leap-year boundaries", () => {
    expect(daysUntil("2027-01-31", "2027-01-31")).toBe(0);
    expect(daysUntil("2026-11-18", "2027-01-31")).toBe(74);
    expect(daysUntil("2028-02-28", "2028-03-01")).toBe(2); // 2028 is a leap year
    expect(daysUntil("2027-02-01", "2027-01-31")).toBe(-1);
  });

  it("refuses dates that do not exist or are not YYYY-MM-DD", () => {
    expect(() => daysUntil("2027-02-30", "2027-03-01")).toThrow(RangeError);
    expect(() => daysUntil("2027-1-5", "2027-03-01")).toThrow(RangeError);
    expect(() => daysUntil("", "2027-03-01")).toThrow(RangeError);
  });

  it("labels the state of a deadline", () => {
    expect(deadlineOf("2026-11-18", "2027-01-31", 45)).toMatchObject({ state: "upcoming", daysLeft: 74, label: "74 days left" });
    expect(deadlineOf("2027-01-30", "2027-01-31", 45)).toMatchObject({ state: "approaching", label: "1 day left" });
    expect(deadlineOf("2027-01-31", "2027-01-31", 45)).toMatchObject({ state: "due_today", label: "Due today" });
    expect(deadlineOf("2027-02-03", "2027-01-31", 45)).toMatchObject({ state: "overdue", label: "3 days overdue" });
    expect(deadlineOf("2027-02-01", "2027-01-31", 45).label).toBe("1 day overdue");
  });

  it("takes the due dates from taxmath: January 31 and February 28 of the following year", () => {
    const d = reportingDeadlines("2027-01-10", 2026);
    expect(d.acknowledgment.dueDate).toBe("2027-01-31");
    expect(d.report.dueDate).toBe("2027-02-28");
    expect(d.taxYear).toBe(2026);
  });

  it("reporting year is last year's until last year's report deadline has passed", () => {
    expect(currentReportingYear("2026-11-18")).toBe(2026);
    expect(currentReportingYear("2027-01-15")).toBe(2026);
    expect(currentReportingYear("2027-02-28")).toBe(2026);
    expect(currentReportingYear("2027-03-01")).toBe(2027);
    expect(() => currentReportingYear("not-a-date")).toThrow(RangeError);
  });

  it("offers tax years newest first and only accepts listed years from the query string", () => {
    expect(taxYearOptions("2027-03-01", 2026)).toEqual([2027, 2026]);
    expect(taxYearOptions("2025-03-01", 2026)).toEqual([2026]);
    expect(pickTaxYear("2026", [2027, 2026], 2027)).toBe(2026);
    expect(pickTaxYear("1999", [2027, 2026], 2027)).toBe(2027);
    expect(pickTaxYear("2026; drop table", [2027, 2026], 2027)).toBe(2027);
    expect(pickTaxYear(undefined, [2027], 2027)).toBe(2027);
  });
});
