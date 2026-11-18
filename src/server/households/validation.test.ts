import { describe, expect, it } from "vitest";
import { isAppError } from "@/lib/errors";
import { ageOn, checkDateOfBirth, checkPersonName, MAX_NAME_LENGTH, parseMemberInput, parseMemberPatch, validateCustodyInfo, type CustodyFlagCode } from "./validation";

// All names below are synthetic examples of name shapes, not real people.
const TODAY = "2026-11-18";

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    if (isAppError(e) && e.code === "validation_failed") return (e.details as { fields: Record<string, string> }).fields;
    throw e;
  }
  throw new Error("expected validation_failed");
}

describe("checkPersonName", () => {
  it.each([
    ["María-José O'Connor Peña", "María-José O'Connor Peña"],
    ["  Ana   Lucía  ", "Ana Lucía"],
    ["D’Angelo", "D'Angelo"],
    ["Jean - Paul", "Jean-Paul"],
    ["de la Garza Villarreal", "de la Garza Villarreal"],
    ["Nguyễn", "Nguyễn"],
    ["Zoë", "Zoë"],
    ["José", "José"], // decomposed accent is normalized to NFC
    ["李", "李"],
    ["X", "X"],
  ])("accepts %j", (raw, expected) => {
    expect(checkPersonName(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [""],
    ["   "],
    ["J0hn"],
    ["Ann!"],
    ["-Ann"],
    ["Ann-"],
    ["O''Brien"],
    ["Ann--Marie"],
    ["Robert'); DROP TABLE users;--"],
    ["<script>"],
    ["Ann\u0000Marie"],
    ["Jr."],
    ["x".repeat(MAX_NAME_LENGTH + 1)],
  ])("rejects %j", (raw) => {
    expect(checkPersonName(raw).ok).toBe(false);
  });

  it("counts length in characters, not UTF-16 units", () => {
    expect(checkPersonName("é".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(checkPersonName("Ĳ".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(checkPersonName("\u{10400}".repeat(MAX_NAME_LENGTH)).ok).toBe(true); // 2 UTF-16 units per letter
    expect(checkPersonName("\u{10400}".repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(checkPersonName(42).ok).toBe(false);
    expect(checkPersonName(null).ok).toBe(false);
  });
});

describe("checkDateOfBirth", () => {
  it.each([
    ["2015-02-28", true],
    ["2016-02-29", true],
    [TODAY, true],
    ["2015-02-29", false], // not a leap year
    ["2015-13-01", false],
    ["2015-00-10", false],
    ["2015-04-31", false],
    ["2026-11-19", false], // tomorrow
    ["2099-01-01", false],
    ["1905-11-18", false], // 121 years
    ["1905-11-19", true], // 120 years and 364 days
    ["15-02-2015", false],
    ["2015/02/28", false],
    ["2015-2-8", false],
    ["", false],
  ] as const)("%s → %s", (dob, ok) => {
    expect(checkDateOfBirth(dob, TODAY).ok).toBe(ok);
  });

  it("ageOn counts whole years and birthdays", () => {
    expect(ageOn("2008-11-18", TODAY)).toBe(18);
    expect(ageOn("2008-11-19", TODAY)).toBe(17);
    expect(ageOn("2012-02-29", "2026-02-28")).toBe(13);
    expect(ageOn("2012-02-29", "2026-03-01")).toBe(14);
  });
});

describe("parseMemberInput", () => {
  const base = { kind: "student", firstName: "María-José", lastName: "O'Connor Peña", relationship: "self" } as const;

  it("normalizes and accepts a valid member", () => {
    expect(parseMemberInput({ ...base, firstName: " María-José ", dob: "2015-06-01" }, TODAY)).toEqual({ ...base, dob: "2015-06-01" });
    expect(parseMemberInput({ ...base, dob: "" }, TODAY).dob).toBeNull();
    expect(parseMemberInput(base, TODAY).dob).toBeNull();
  });

  it.each([
    [{ kind: "pet" }, "kind"],
    [{ kind: undefined }, "kind"],
    [{ relationship: "cousin" }, "relationship"],
    [{ relationship: undefined }, "relationship"],
    [{ firstName: "" }, "firstName"],
    [{ lastName: "R2-D2" }, "lastName"],
    [{ dob: "2030-01-01" }, "dob"],
    [{ dob: "2015-02-30" }, "dob"],
    [{ isOwner: true }, "isOwner"],
    [{ userId: "usr_x" }, "userId"],
  ])("rejects %j on field %s", (patch, field) => {
    expect(fieldsOf(() => parseMemberInput({ ...base, ...patch }, TODAY))).toHaveProperty(field);
  });

  it("an adult with a date of birth must be 18 or older", () => {
    const adult = { kind: "adult", firstName: "Ana", lastName: "Peña", relationship: "parent" } as const;
    expect(fieldsOf(() => parseMemberInput({ ...adult, dob: "2008-11-19" }, TODAY))).toHaveProperty("kind");
    expect(parseMemberInput({ ...adult, dob: "2008-11-18" }, TODAY).dob).toBe("2008-11-18");
    expect(parseMemberInput({ ...adult, kind: "other", dob: "2010-01-01" }, TODAY).kind).toBe("other");
  });
});

describe("parseMemberPatch", () => {
  it("keeps only the fields given, with null clearing the date of birth", () => {
    expect(parseMemberPatch({ firstName: "Zoë" }, TODAY, { kind: "child", dob: null })).toEqual({ firstName: "Zoë" });
    expect(parseMemberPatch({ dob: null }, TODAY, { kind: "child", dob: "2015-01-01" })).toEqual({ dob: null });
    expect(parseMemberPatch({}, TODAY, { kind: "child", dob: null })).toEqual({});
  });

  it("checks the adult age rule against the member as it will be", () => {
    expect(fieldsOf(() => parseMemberPatch({ kind: "adult" }, TODAY, { kind: "child", dob: "2012-01-01" }))).toHaveProperty("kind");
    expect(fieldsOf(() => parseMemberPatch({ dob: "2012-01-01" }, TODAY, { kind: "adult", dob: null }))).toHaveProperty("kind");
    expect(parseMemberPatch({ kind: "adult", dob: null }, TODAY, { kind: "child", dob: "2012-01-01" })).toEqual({ kind: "adult", dob: null });
  });

  it("rejects unknown fields", () => {
    expect(fieldsOf(() => parseMemberPatch({ removedAt: "now" }, TODAY, { kind: "child", dob: null }))).toHaveProperty("removedAt");
  });
});

describe("validateCustodyInfo", () => {
  const codes = (input: unknown) => validateCustodyInfo(input).flags.map((f) => f.code).sort();

  it("a student who lives only here needs no review", () => {
    const r = validateCustodyInfo({ livesInMultipleHouseholds: false, notes: "  " });
    expect(r).toEqual({ custody: { livesInMultipleHouseholds: false }, flags: [], needsReview: false, suggestedRelevantHousehold: "this" });
  });

  type Row = [string, Record<string, unknown>, CustodyFlagCode[], "this" | "other" | "undetermined"];
  const rows: Row[] = [
    ["majority here", { livesInMultipleHouseholds: true, monthsInThisHousehold: 8, equalTime: false }, ["shared_custody"], "this"],
    ["majority here, equal-time unanswered", { livesInMultipleHouseholds: true, monthsInThisHousehold: 9 }, ["shared_custody"], "this"],
    ["half here, not equal (three homes, 6/3/3)", { livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: false }, ["shared_custody"], "this"],
    ["less than half here, not equal", { livesInMultipleHouseholds: true, monthsInThisHousehold: 5, equalTime: false }, ["longest_household_unclear", "shared_custody"], "undetermined"],
    ["equal time, this household higher income", { livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: true, thisHouseholdHasHigherIncome: "yes" }, ["shared_custody"], "this"],
    ["equal time, other household higher income", { livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: true, thisHouseholdHasHigherIncome: "no" }, ["other_household_higher_income", "shared_custody"], "other"],
    ["equal time, income unknown", { livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: true, thisHouseholdHasHigherIncome: "unknown" }, ["higher_income_unknown", "shared_custody"], "undetermined"],
    ["equal time, income unanswered", { livesInMultipleHouseholds: true, monthsInThisHousehold: 4, equalTime: true }, ["higher_income_unknown", "shared_custody"], "undetermined"],
    ["equal time three ways", { livesInMultipleHouseholds: true, monthsInThisHousehold: 4, equalTime: true, thisHouseholdHasHigherIncome: "yes" }, ["shared_custody"], "this"],
    ["equal time but 5 months", { livesInMultipleHouseholds: true, monthsInThisHousehold: 5, equalTime: true, thisHouseholdHasHigherIncome: "yes" }, ["equal_time_months_mismatch", "shared_custody"], "undetermined"],
    ["equal time but 8 months", { livesInMultipleHouseholds: true, monthsInThisHousehold: 8, equalTime: true, thisHouseholdHasHigherIncome: "yes" }, ["equal_time_months_mismatch", "shared_custody"], "this"],
    ["months unknown", { livesInMultipleHouseholds: true, monthsInThisHousehold: null }, ["equal_time_unknown", "months_unknown", "shared_custody"], "undetermined"],
    ["half, equal-time unknown", { livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: "unknown" }, ["equal_time_unknown", "shared_custody"], "undetermined"],
    ["zero months here", { livesInMultipleHouseholds: true, monthsInThisHousehold: 0, equalTime: false }, ["shared_custody", "student_not_resident"], "other"],
    ["12 months but multiple homes", { livesInMultipleHouseholds: true, monthsInThisHousehold: 12, equalTime: false }, ["months_inconsistent", "shared_custody"], "undetermined"],
    ["unknown whether multiple homes", { livesInMultipleHouseholds: "unknown" }, ["custody_unknown", "equal_time_unknown", "months_unknown", "shared_custody"], "undetermined"],
  ];

  it.each(rows)("%s", (_name, input, expected, suggestion) => {
    const r = validateCustodyInfo(input);
    expect(r.flags.map((f) => f.code).sort()).toEqual([...expected].sort());
    expect(r.needsReview).toBe(true);
    expect(r.suggestedRelevantHousehold).toBe(suggestion);
    for (const f of r.flags) expect(f.message.length).toBeGreaterThan(10);
  });

  it("every multiple-household answer is flagged for review (never guessed)", () => {
    for (const m of [0, 1, 6, 7, 11, 12]) expect(codes({ livesInMultipleHouseholds: true, monthsInThisHousehold: m, equalTime: false })).toContain("shared_custody");
  });

  it("normalizes into the stored CustodyInfo shape", () => {
    expect(validateCustodyInfo({ livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: true, notes: " Week on,\n week off " }).custody).toEqual({
      livesInMultipleHouseholds: true,
      monthsInThisHousehold: 6,
      equalTime: true,
      thisHouseholdHasHigherIncome: "unknown",
      notes: "Week on, week off",
    });
    expect(validateCustodyInfo({ livesInMultipleHouseholds: "unknown" }).custody).toEqual({ livesInMultipleHouseholds: true, monthsInThisHousehold: null });
    expect(validateCustodyInfo({ livesInMultipleHouseholds: true, notes: "x".repeat(5000) }).custody.notes).toHaveLength(1000);
  });

  it.each([
    [{ livesInMultipleHouseholds: true, monthsInThisHousehold: 13 }, "monthsInThisHousehold"],
    [{ livesInMultipleHouseholds: true, monthsInThisHousehold: -1 }, "monthsInThisHousehold"],
    [{ livesInMultipleHouseholds: true, monthsInThisHousehold: 6.5 }, "monthsInThisHousehold"],
    [{ livesInMultipleHouseholds: "maybe" }, "livesInMultipleHouseholds"],
    [{}, "livesInMultipleHouseholds"],
    [{ livesInMultipleHouseholds: true, thisHouseholdHasHigherIncome: "sometimes" }, "thisHouseholdHasHigherIncome"],
    [{ livesInMultipleHouseholds: false, otherParentName: "x" }, "otherParentName"],
  ])("rejects malformed input %j", (input, field) => {
    expect(fieldsOf(() => validateCustodyInfo(input))).toHaveProperty(field);
  });
});
