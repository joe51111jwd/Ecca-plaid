import { describe, expect, it } from "vitest";
import { addDays, daysBetween, findDates, parseDocumentDate, parseMonthYear, subtractMonths } from "./dates";
import { findMoneyTokens, formatCents, MAX_DOCUMENT_AMOUNT_CENTS, parseMoneyCents } from "./money";
import { containsFullSsn, findFullSsns, maskIdentifier, maskLongNumbers, redactEins, redactSsns, redactText, ssnLast4 } from "./redact";

describe("parseDocumentDate", () => {
  it.each([
    ["09/15/2026", "2026-09-15", "mdy_slash"],
    ["9/5/2026", "2026-09-05", "mdy_slash"],
    ["08-30-2020", "2020-08-30", "mdy_dash"],
    ["2026-11-18", "2026-11-18", "iso"],
    ["September 15, 2026", "2026-09-15", "month_name"],
    ["Sep. 15, 2026", "2026-09-15", "month_name"],
    ["Sept 15 2026", "2026-09-15", "month_name"],
    ["Dec. 31, 2025", "2025-12-31", "month_name"],
    ["Apr.15, 2020", "2020-04-15", "month_name"],
    ["march 4, 2026", "2026-03-04", "month_name"],
    ["15 September 2026", "2026-09-15", "month_name"],
    ["02/29/2024", "2024-02-29", "mdy_slash"],
    ["  10/02/2026  ", "2026-10-02", "mdy_slash"],
  ])("%s → %s", (input, iso, format) => {
    expect(parseDocumentDate(input)).toEqual({ ok: true, date: iso, format });
  });

  it.each([
    ["03/04/26", "ambiguous"],
    ["3-4-26", "ambiguous"],
    ["13/02/2026", "ambiguous"],
    ["31/12/2025", "ambiguous"],
    ["03.04.2026", "ambiguous"],
    ["02/30/2026", "invalid"],
    ["02/29/2025", "invalid"],
    ["13/13/2026", "invalid"],
    ["00/10/2026", "invalid"],
    ["2026-02-30", "invalid"],
    ["06/2026", "invalid"],
    ["Smarch 4, 2026", "invalid"],
    ["September 31, 2026", "invalid"],
    ["01/01/1850", "invalid"],
    ["01/01/2101", "invalid"],
    ["1/2/20266", "invalid"],
    ["", "empty"],
    ["   ", "empty"],
  ])("%s is rejected (%s), never guessed", (input, reason) => {
    expect(parseDocumentDate(input)).toEqual({ ok: false, reason });
  });

  it("finds dates in a line and ignores form-version stamps and phone numbers", () => {
    const found = findDates("Form TF0001 06/2026 Date: 09/15/2026 Call 2-1-1 or 1-877-541-7905 (10/2026) through 02/28/2027");
    expect(found.map((f) => f.raw)).toEqual(["09/15/2026", "02/28/2027"]);
    expect(findDates("Date: 03/04/26")[0].result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("parses month-year and does calendar arithmetic", () => {
    expect(parseMonthYear("January 2026")).toEqual({ year: 2026, month: 1 });
    expect(parseMonthYear("Jan. 2026")).toEqual({ year: 2026, month: 1 });
    expect(parseMonthYear("Continuing")).toBeNull();
    expect(subtractMonths("2026-12-01", 12)).toBe("2025-12-01");
    expect(subtractMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(subtractMonths("2028-03-31", 1)).toBe("2028-02-29");
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(addDays("2025-12-26", 14)).toBe("2026-01-09");
  });
});

describe("parseMoneyCents", () => {
  it.each([
    ["$41,250.00", 4_125_000],
    ["41250.00", 4_125_000],
    ["41,250", 4_125_000],
    ["41250", 4_125_000],
    ["$0.00", 0],
    ["0", 0],
    ["$1,234,567.89", 123_456_789],
    [" $314.50 ", 31_450],
  ])("%s → %d cents", (input, cents) => {
    expect(parseMoneyCents(input)).toBe(cents);
  });

  it.each(["1,23,456", "12.5", "12.505", "1O0.00", "41 250.00", "$", "", "abc", "1,2345.00", ",123", "123,", "$$12.00", "1.2.3", "--5", "+5.00", "∞"])(
    "rejects %j",
    (input) => {
      expect(parseMoneyCents(input)).toBeNull();
    },
  );

  it("negatives only when allowed, in every printed form", () => {
    for (const s of ["-1,234.00", "-$1,234.00", "$-1,234.00", "(1,234.00)", "($1,234.00)"]) {
      expect(parseMoneyCents(s)).toBeNull();
      expect(parseMoneyCents(s, { allowNegative: true })).toBe(-123_400);
    }
    expect(parseMoneyCents("(-5.00)", { allowNegative: true })).toBeNull();
    expect(parseMoneyCents("-0.00", { allowNegative: true })).toBe(0);
  });

  it("caps implausible values instead of losing precision", () => {
    expect(parseMoneyCents("10,000,000,000.00")).toBe(MAX_DOCUMENT_AMOUNT_CENTS);
    expect(parseMoneyCents("10,000,000,000.01")).toBeNull();
    expect(parseMoneyCents("99999999999999999999")).toBeNull();
  });

  it("finds amounts in text and formats cents", () => {
    expect(findMoneyTokens("Gross Pay $1,650.00 $43,000.00.").map((t) => t.cents)).toEqual([165_000, 4_300_000]);
    expect(findMoneyTokens("lines 1z, 2b and SSN-L8025").map((t) => t.raw)).toEqual([]);
    expect(formatCents(4_125_000)).toBe("$41,250.00");
    expect(formatCents(-5)).toBe("-$0.05");
  });
});

describe("SSN redaction", () => {
  it.each([
    ["SSN 000-00-0001 on file", "SSN XXX-XX-0001 on file"],
    ["000 00 0001", "XXX-XX-0001"],
    ["000000001", "XXX-XX-0001"],
    ["ITIN 912-70-1234.", "ITIN XXX-XX-1234."],
    ["Claim Number: 999-99-9992 DI", "Claim Number: XXX-XX-9992 DI"],
    ["two 123-45-6789 and 987-65-4321", "two XXX-XX-6789 and XXX-XX-4321"],
    ["already XXX-XX-0001", "already XXX-XX-0001"],
  ])("%j → %j", (input, out) => {
    expect(redactSsns(input)).toBe(out);
  });

  it("does not touch dates, phone numbers, amounts or longer identifiers", () => {
    const s = "2026-09-15 1-877-541-7905 $41,250.00 9990000001 10/20/2026";
    expect(redactSsns(s)).toBe(s);
  });

  it("masks EINs and long digit runs for snippets", () => {
    expect(redactEins("EIN 00-0000001")).toBe("EIN XX-XXX0001");
    expect(maskLongNumbers("Case Number: 9990000001")).toBe("Case Number: ******0001");
    expect(maskLongNumbers("$41,250.00 and 1234567.89")).toBe("$41,250.00 and 1234567.89");
    expect(redactText("SSN 000-00-0001 case 9990000001 EIN 00-0000002")).toBe("SSN XXX-XX-0001 case ******0001 EIN XX-XXX0002");
  });

  it("detects full SSNs in nested output (deep scan)", () => {
    expect(containsFullSsn("x 000-00-0001 y")).toBe(true);
    expect(containsFullSsn("x XXX-XX-0001 y")).toBe(false);
    expect(containsFullSsn("x XXX-XX-0001 y")).toBe(false); // stateless across calls
    expect(findFullSsns({ a: ["ok", { b: "000000001" }], c: 123456789, "000-00-0002": 1 })).toEqual(["$.a[1].b", "$.<key>"]);
  });

  it("masks identifiers to their last four characters", () => {
    expect(maskIdentifier("9990000001")).toBe("******0001");
    expect(maskIdentifier("SYN-0001")).toBe("***0001");
    expect(maskIdentifier("12")).toBe("**");
    expect(maskIdentifier("--")).toBeNull();
    expect(ssnLast4("XXX-XX-0001")).toBe("0001");
    expect(ssnLast4("no digits")).toBeNull();
  });
});
