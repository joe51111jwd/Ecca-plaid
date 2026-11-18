import { describe, expect, it } from "vitest";
import { applyOtpBackspace, applyOtpClear, applyOtpText, extractOtpDigits, isOtpComplete, otpDigitsFrom, otpValue } from "./otp-logic";

const empty = () => ["", "", "", "", "", ""];

describe("extractOtpDigits", () => {
  it("pulls digits out of pasted text in any common shape", () => {
    expect(extractOtpDigits("482913", 6)).toBe("482913");
    expect(extractOtpDigits("482 913", 6)).toBe("482913");
    expect(extractOtpDigits("482-913", 6)).toBe("482913");
    expect(extractOtpDigits(" 482913\n", 6)).toBe("482913");
    expect(extractOtpDigits("Your code is 482913.", 6)).toBe("482913");
  });

  it("truncates to the code length and ignores text without digits", () => {
    expect(extractOtpDigits("4829137777", 6)).toBe("482913");
    expect(extractOtpDigits("no digits here", 6)).toBe("");
    expect(extractOtpDigits("", 6)).toBe("");
    expect(extractOtpDigits("123", 0)).toBe("");
    expect(extractOtpDigits("123", -2)).toBe("");
  });

  it("folds full-width digits and rejects other numeral-looking characters", () => {
    expect(extractOtpDigits("４８２９１３", 6)).toBe("482913");
    expect(extractOtpDigits("ⅠⅡⅢ", 6)).toBe("");
    expect(extractOtpDigits("1.2e3", 6)).toBe("123");
  });
});

describe("otpDigitsFrom / otpValue / isOtpComplete", () => {
  it("builds the boxes from a full, partial or missing value", () => {
    expect(otpDigitsFrom("482913", 6)).toEqual(["4", "8", "2", "9", "1", "3"]);
    expect(otpDigitsFrom("48", 6)).toEqual(["4", "8", "", "", "", ""]);
    expect(otpDigitsFrom(null, 6)).toEqual(empty());
    expect(otpDigitsFrom(undefined, 4)).toEqual(["", "", "", ""]);
    expect(otpDigitsFrom("12ab34", 6)).toEqual(["1", "2", "3", "4", "", ""]);
  });

  it("joins and reports completeness", () => {
    expect(otpValue(["4", "8", "", "9", "", ""])).toBe("489");
    expect(isOtpComplete(["4", "8", "2", "9", "1", "3"])).toBe(true);
    expect(isOtpComplete(["4", "8", "2", "9", "1", ""])).toBe(false);
    expect(isOtpComplete([])).toBe(false);
  });
});

describe("applyOtpText", () => {
  it("typing one digit fills the box and advances", () => {
    expect(applyOtpText(empty(), 0, "4")).toEqual({ digits: ["4", "", "", "", "", ""], focusIndex: 1 });
    expect(applyOtpText(["4", "", "", "", "", ""], 1, "8")).toEqual({ digits: ["4", "8", "", "", "", ""], focusIndex: 2 });
  });

  it("typing in the last box keeps focus there", () => {
    expect(applyOtpText(["4", "8", "2", "9", "1", ""], 5, "3")).toEqual({ digits: ["4", "8", "2", "9", "1", "3"], focusIndex: 5 });
  });

  it("typing over a filled box replaces it", () => {
    expect(applyOtpText(["4", "8", "2", "", "", ""], 1, "7").digits).toEqual(["4", "7", "2", "", "", ""]);
  });

  it("ignores input with no digits and leaves focus where it was", () => {
    const before = ["4", "8", "", "", "", ""];
    expect(applyOtpText(before, 2, "x")).toEqual({ digits: before, focusIndex: 2 });
    expect(applyOtpText(before, 2, " ")).toEqual({ digits: before, focusIndex: 2 });
    expect(applyOtpText(before, 2, "")).toEqual({ digits: before, focusIndex: 2 });
  });

  it("pasting the full code fills every box, from any box", () => {
    const full = ["4", "8", "2", "9", "1", "3"];
    expect(applyOtpText(empty(), 0, "482913")).toEqual({ digits: full, focusIndex: 5 });
    expect(applyOtpText(empty(), 3, "482 913")).toEqual({ digits: full, focusIndex: 5 });
    expect(applyOtpText(["1", "1", "1", "1", "1", "1"], 5, "482-913")).toEqual({ digits: full, focusIndex: 5 });
  });

  it("pasting more digits than boxes uses the first six", () => {
    expect(applyOtpText(empty(), 0, "48291399").digits).toEqual(["4", "8", "2", "9", "1", "3"]);
  });

  it("pasting a partial code fills from the focused box and stops at the end", () => {
    expect(applyOtpText(empty(), 0, "482")).toEqual({ digits: ["4", "8", "2", "", "", ""], focusIndex: 3 });
    expect(applyOtpText(["4", "8", "", "", "", ""], 2, "29")).toEqual({ digits: ["4", "8", "2", "9", "", ""], focusIndex: 4 });
    // Three digits pasted into box 5 of 6: only two fit.
    expect(applyOtpText(empty(), 4, "913")).toEqual({ digits: ["", "", "", "", "9", "1"], focusIndex: 5 });
  });

  it("clamps an out-of-range index instead of writing outside the boxes", () => {
    expect(applyOtpText(empty(), 99, "7").digits).toEqual(["", "", "", "", "", "7"]);
    expect(applyOtpText(empty(), -3, "7").digits).toEqual(["7", "", "", "", "", ""]);
  });

  it("does not mutate its input", () => {
    const before = empty();
    applyOtpText(before, 0, "482913");
    expect(before).toEqual(empty());
  });

  it("works for other code lengths", () => {
    expect(applyOtpText(["", "", "", ""], 0, "1234")).toEqual({ digits: ["1", "2", "3", "4"], focusIndex: 3 });
  });
});

describe("applyOtpBackspace", () => {
  it("clears the current box when it has a digit and stays", () => {
    expect(applyOtpBackspace(["4", "8", "2", "", "", ""], 2)).toEqual({ digits: ["4", "8", "", "", "", ""], focusIndex: 2 });
  });

  it("on an empty box, clears the previous one and moves back", () => {
    expect(applyOtpBackspace(["4", "8", "", "", "", ""], 2)).toEqual({ digits: ["4", "", "", "", "", ""], focusIndex: 1 });
  });

  it("does nothing at the first empty box", () => {
    expect(applyOtpBackspace(empty(), 0)).toEqual({ digits: empty(), focusIndex: 0 });
  });

  it("holding Backspace from the end empties the whole code", () => {
    let state = { digits: ["4", "8", "2", "9", "1", "3"], focusIndex: 5 };
    for (let i = 0; i < 12; i++) state = applyOtpBackspace(state.digits, state.focusIndex);
    expect(state).toEqual({ digits: empty(), focusIndex: 0 });
  });
});

describe("applyOtpClear", () => {
  it("empties one box and keeps focus on it", () => {
    expect(applyOtpClear(["4", "8", "2", "", "", ""], 1)).toEqual({ digits: ["4", "", "2", "", "", ""], focusIndex: 1 });
    expect(applyOtpClear(empty(), 9)).toEqual({ digits: empty(), focusIndex: 5 });
  });
});
