import { describe, expect, it } from "vitest";
import { MONEY_INPUT_MAX_WHOLE_DIGITS, formatMoneyText, parseMoneyText, sanitizeMoneyText } from "./money-format";

describe("sanitizeMoneyText", () => {
  it("keeps digits and one decimal point with at most two decimals", () => {
    expect(sanitizeMoneyText("1700")).toBe("1700");
    expect(sanitizeMoneyText("1700.5")).toBe("1700.5");
    expect(sanitizeMoneyText("1700.505")).toBe("1700.50");
    expect(sanitizeMoneyText("1.2.3")).toBe("1.23");
  });

  it("drops currency symbols, grouping, spaces and letters", () => {
    expect(sanitizeMoneyText("$1,700.00")).toBe("1700.00");
    expect(sanitizeMoneyText(" 1 700 ")).toBe("1700");
    expect(sanitizeMoneyText("abc")).toBe("");
    expect(sanitizeMoneyText("12abc34")).toBe("1234");
    expect(sanitizeMoneyText("USD 25")).toBe("25");
  });

  it("drops signs and exponent letters instead of interpreting them", () => {
    expect(sanitizeMoneyText("-50")).toBe("50");
    expect(sanitizeMoneyText("1e5")).toBe("15");
    expect(sanitizeMoneyText("+1,000")).toBe("1000");
  });

  it("keeps a decimal point that is still being typed", () => {
    expect(sanitizeMoneyText("12.")).toBe("12.");
    expect(sanitizeMoneyText(".")).toBe(".");
    expect(sanitizeMoneyText(".5")).toBe(".5");
  });

  it("strips meaningless leading zeros but keeps a lone zero", () => {
    expect(sanitizeMoneyText("007")).toBe("7");
    expect(sanitizeMoneyText("0")).toBe("0");
    expect(sanitizeMoneyText("000")).toBe("0");
    expect(sanitizeMoneyText("0.50")).toBe("0.50");
    expect(sanitizeMoneyText("00.5")).toBe("0.5");
  });

  it("whole-dollar fields ignore the decimal part instead of gluing the cents on", () => {
    expect(sanitizeMoneyText("12.50", { allowCents: false })).toBe("12");
    expect(sanitizeMoneyText("$1,700.99", { allowCents: false })).toBe("1700");
    expect(sanitizeMoneyText(".99", { allowCents: false })).toBe("");
  });

  it("caps the whole-dollar part so the value stays a safe integer", () => {
    const tooLong = "9".repeat(MONEY_INPUT_MAX_WHOLE_DIGITS + 6);
    expect(sanitizeMoneyText(tooLong)).toBe("9".repeat(MONEY_INPUT_MAX_WHOLE_DIGITS));
    expect(Number.isSafeInteger(parseMoneyText(`${tooLong}.99`))).toBe(true);
  });

  it("folds full-width digits typed on some phone keyboards", () => {
    expect(sanitizeMoneyText("１７００")).toBe("1700");
  });
});

describe("parseMoneyText", () => {
  it("returns integer cents", () => {
    expect(parseMoneyText("1700")).toBe(170_000);
    expect(parseMoneyText("1,700")).toBe(170_000);
    expect(parseMoneyText("$1,700.50")).toBe(170_050);
    expect(parseMoneyText("1700.5")).toBe(170_050);
    expect(parseMoneyText("0.01")).toBe(1);
    expect(parseMoneyText("0")).toBe(0);
  });

  it("treats an unfinished decimal as whole dollars", () => {
    expect(parseMoneyText("12.")).toBe(1_200);
    expect(parseMoneyText(".5")).toBe(50);
    expect(parseMoneyText(".05")).toBe(5);
  });

  it("returns null for empty or non-numeric input, never NaN or 0", () => {
    expect(parseMoneyText("")).toBeNull();
    expect(parseMoneyText("   ")).toBeNull();
    expect(parseMoneyText(".")).toBeNull();
    expect(parseMoneyText("abc")).toBeNull();
    expect(parseMoneyText("$")).toBeNull();
  });

  it("does not suffer float error on amounts that break naive `* 100`", () => {
    // 1.15 * 100 === 114.99999999999999 and 19.99 * 100 === 1998.9999999999998 in IEEE-754.
    expect(parseMoneyText("1.15")).toBe(115);
    expect(parseMoneyText("19.99")).toBe(1_999);
    expect(parseMoneyText("4.35")).toBe(435);
    expect(parseMoneyText("1001.10")).toBe(100_110);
  });

  it("truncates extra decimals rather than rounding up a typed amount", () => {
    expect(parseMoneyText("10.999")).toBe(1_099);
  });
});

describe("formatMoneyText", () => {
  it("groups thousands and shows cents only when there are any", () => {
    expect(formatMoneyText(170_000)).toBe("1,700");
    expect(formatMoneyText(170_050)).toBe("1,700.50");
    expect(formatMoneyText(5)).toBe("0.05");
    expect(formatMoneyText(0)).toBe("0");
    expect(formatMoneyText(31_200_000)).toBe("312,000");
  });

  it("can omit grouping for editing and cents for whole-dollar fields", () => {
    expect(formatMoneyText(170_050, { grouping: false })).toBe("1700.50");
    expect(formatMoneyText(170_050, { allowCents: false })).toBe("1,700");
  });

  it("renders nothing for empty, negative or non-finite values", () => {
    expect(formatMoneyText(null)).toBe("");
    expect(formatMoneyText(undefined)).toBe("");
    expect(formatMoneyText(-100)).toBe("");
    expect(formatMoneyText(Number.NaN)).toBe("");
    expect(formatMoneyText(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("round-trips with parseMoneyText for every cent value in a range", () => {
    for (const cents of [0, 1, 9, 10, 99, 100, 101, 999, 1_000, 169_999, 170_000, 170_001, 99_999_999_999]) {
      expect(parseMoneyText(formatMoneyText(cents))).toBe(cents);
      expect(parseMoneyText(formatMoneyText(cents, { grouping: false }))).toBe(cents);
    }
  });
});
