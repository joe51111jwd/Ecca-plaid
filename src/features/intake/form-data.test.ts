import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { asksDateOfBirth, isChecked, isUploadKind, localeOf, parseAddressForm, parseCountyForm, parseCustodyForm, parseMemberForm, parseOwnerForm, shownSha, text } from "./form-data";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("basics", () => {
  it("reads text, ignoring files and missing fields", () => {
    const f = form({ a: "x" });
    f.set("file", new Blob(["1"]), "a.pdf");
    expect(text(f, "a")).toBe("x");
    expect(text(f, "file")).toBe("");
    expect(text(f, "missing")).toBe("");
  });

  it("reads the language, defaulting to English for anything unknown", () => {
    expect(localeOf(form({ lang: "es" }))).toBe("es");
    expect(localeOf(form({ lang: "fr" }))).toBe("en");
    expect(localeOf(form({}))).toBe("en");
  });

  it("only accepts a 64-char lowercase hex hash of the words shown", () => {
    expect(shownSha(form({ sha: "a".repeat(64) }))).toBe("a".repeat(64));
    expect(shownSha(form({ sha: "A".repeat(64) }))).toBeNull();
    expect(shownSha(form({ sha: "a".repeat(63) }))).toBeNull();
    expect(shownSha(form({}))).toBeNull();
  });

  it("treats an absent or empty checkbox as not ticked", () => {
    expect(isChecked(form({ agree: "on" }), "agree")).toBe(true);
    expect(isChecked(form({ agree: "" }), "agree")).toBe(false);
    expect(isChecked(form({}), "agree")).toBe(false);
  });

  it("knows the document kinds the family may choose (never 'unknown')", () => {
    expect(isUploadKind("award_letter")).toBe(true);
    expect(isUploadKind("unknown")).toBe(false);
    expect(isUploadKind(null)).toBe(false);
  });
});

describe("parseMemberForm", () => {
  it("accepts a student and drops a date of birth that was not asked for", () => {
    const r = parseMemberForm(form({ kind: "student", relationship: "self", firstName: " Avery ", lastName: "Sample", dob: "2015-01-02" }), "en");
    expect(r).toEqual({ ok: true, data: { kind: "student", relationship: "self", firstName: "Avery", lastName: "Sample" } });
  });

  it("asks a date of birth only for 'someone else' and requires it then", () => {
    expect(asksDateOfBirth("other")).toBe(true);
    expect(asksDateOfBirth("adult")).toBe(false);
    const missing = parseMemberForm(form({ kind: "other", relationship: "unrelated", firstName: "J", lastName: "E" }), "es");
    expect(missing).toEqual({ ok: false, fields: { dob: es.errors.fields.dob } });
    const ok = parseMemberForm(form({ kind: "other", relationship: "unrelated", firstName: "J", lastName: "E", dob: "2001-03-04" }), "en");
    expect(ok.ok && ok.data.dob).toBe("2001-03-04");
  });

  it("keeps a stored date of birth when editing with the date left blank", () => {
    expect(parseMemberForm(form({ kind: "other", relationship: "other", firstName: "J", lastName: "E", hasDob: "1" }), "en").ok).toBe(true);
  });

  it("reports every problem at once, in the family's language", () => {
    const r = parseMemberForm(form({ kind: "admin", relationship: "boss", firstName: " ", lastName: "" }), "es");
    expect(r).toEqual({ ok: false, fields: { kind: es.errors.fields.kind, relationship: es.errors.fields.relationship, firstName: es.errors.fields.firstName, lastName: es.errors.fields.lastName } });
  });
});

describe("parseOwnerForm", () => {
  it("never lets the owner say they are the student", () => {
    expect(parseOwnerForm(form({ relationship: "self", firstName: "D", lastName: "S" }), "en")).toEqual({ ok: false, fields: { relationship: en.errors.fields.relationship } });
    expect(parseOwnerForm(form({ relationship: "parent", firstName: "D", lastName: "S" }), "en")).toEqual({ ok: true, data: { relationship: "parent", firstName: "D", lastName: "S" } });
  });
});

describe("parseAddressForm", () => {
  it("accepts 5 and 9 digit ZIP codes and always sends Texas", () => {
    for (const zip of ["78664", "78664-1234", "786641234"]) {
      const r = parseAddressForm(form({ line1: "1 A St", city: "Round Rock", zip }), "en");
      expect(r.ok && r.data.state).toBe("TX");
    }
  });

  it("turns a blank second line into null", () => {
    const r = parseAddressForm(form({ line1: "1 A St", line2: "  ", city: "X", zip: "78664" }), "en");
    expect(r.ok && r.data.line2).toBeNull();
  });

  it("flags blank and malformed fields", () => {
    expect(parseAddressForm(form({ line1: "", city: "", zip: "7866" }), "en")).toEqual({ ok: false, fields: { line1: en.errors.fields.line1, city: en.errors.fields.city, zip: en.errors.fields.zip } });
    expect(parseAddressForm(form({ line1: "x", city: "y", zip: "78664; drop" }), "en").ok).toBe(false);
  });
});

describe("parseCountyForm", () => {
  it("accepts only Texas county codes", () => {
    expect(parseCountyForm(form({ fips: "48491" }), "en")).toEqual({ ok: true, data: { fips: "48491" } });
    expect(parseCountyForm(form({ fips: "06037" }), "en").ok).toBe(false);
    expect(parseCountyForm(form({ fips: "__other" }), "en").ok).toBe(false);
  });
});

describe("parseCustodyForm", () => {
  it("requires the first question", () => {
    expect(parseCustodyForm(form({}), "en")).toEqual({ ok: false, fields: { lives: en.errors.fields.livesInMultipleHouseholds } });
  });

  it("ignores hidden follow-up answers when the student lives only here (no stale contradiction)", () => {
    expect(parseCustodyForm(form({ lives: "no", months: "3", equal: "yes", higher: "no" }), "en")).toEqual({ ok: true, data: { livesInMultipleHouseholds: false } });
  });

  it("passes 'not sure' on as unknown so a person reviews it, never a guess", () => {
    const r = parseCustodyForm(form({ lives: "unsure", equal: "unsure", higher: "unsure" }), "en");
    expect(r).toEqual({ ok: true, data: { livesInMultipleHouseholds: "unknown", monthsInThisHousehold: null, equalTime: "unknown", thisHouseholdHasHigherIncome: "unknown", notes: null } });
  });

  it("reads months 0 to 12 and refuses anything else", () => {
    const ok = parseCustodyForm(form({ lives: "yes", months: "0" }), "en");
    expect(ok.ok && ok.data.monthsInThisHousehold).toBe(0);
    for (const months of ["13", "-1", "6.5", "abc", "100"]) expect(parseCustodyForm(form({ lives: "yes", months }), "en"), months).toEqual({ ok: false, fields: { months: en.errors.fields.months } });
  });

  it("keeps notes, trimmed", () => {
    const r = parseCustodyForm(form({ lives: "no", notes: "  court order  " }), "en");
    expect(r).toEqual({ ok: true, data: { livesInMultipleHouseholds: false, notes: "court order" } });
  });
});
