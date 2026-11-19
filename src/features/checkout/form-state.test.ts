import { describe, expect, it } from "vitest";
import { errorFor, FIELD_ORDER, fieldId, isEmptyPatch, mergePatch, orderedErrors, patchAt, patchPaths, textValue, withoutPaths } from "./form-state";

describe("mergePatch", () => {
  it("merges nested objects field by field so consecutive keystrokes in different fields land in one save", () => {
    const merged = mergePatch({ address: { line1: "100 Synthetic Way" } }, { address: { city: "Austin" } });
    expect(merged).toEqual({ address: { line1: "100 Synthetic Way", city: "Austin" } });
  });

  it("lets a later value win, including null (which clears) over an object and an object over null", () => {
    expect(mergePatch({ giftCents: 100 }, { giftCents: 200 })).toEqual({ giftCents: 200 });
    expect(mergePatch({ liability: { estimatedTaxCents: 1 } }, { liability: null })).toEqual({ liability: null });
    expect(mergePatch({ liability: null }, { liability: { estimatedTaxCents: 2 } })).toEqual({ liability: { estimatedTaxCents: 2 } });
  });

  it("keeps both spouses' changes and does not mutate its inputs", () => {
    const a = { contributors: { primary: { giftCents: 100 } } };
    const b = { contributors: { spouse: { giftCents: null } } };
    const merged = mergePatch(a, b);
    expect(merged).toEqual({ contributors: { primary: { giftCents: 100 }, spouse: { giftCents: null } } });
    expect(a).toEqual({ contributors: { primary: { giftCents: 100 } } });
    expect(b).toEqual({ contributors: { spouse: { giftCents: null } } });
  });

  it("treats false and 0 as values, not as absence", () => {
    expect(mergePatch({ designationConfirmed: true }, { designationConfirmed: false })).toEqual({ designationConfirmed: false });
    expect(mergePatch({ giftCents: 5 }, { giftCents: 0 })).toEqual({ giftCents: 0 });
  });
});

describe("patch paths", () => {
  it("lists every touched path, parents included", () => {
    expect(patchPaths({ giftCents: 1, address: { city: "Austin" }, contributors: { spouse: { giftCents: null } } }).sort()).toEqual(
      ["address", "address.city", "contributors", "contributors.spouse", "contributors.spouse.giftCents", "giftCents"].sort(),
    );
    expect(patchPaths({})).toEqual([]);
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ a: null })).toBe(false);
  });

  it("builds a nested patch from a dotted path and round-trips through patchPaths", () => {
    expect(patchAt("address.city", "Austin")).toEqual({ address: { city: "Austin" } });
    expect(patchAt("giftCents", null)).toEqual({ giftCents: null });
    expect(patchPaths(patchAt("contributors.primary.firstName", "Avery"))).toContain("contributors.primary.firstName");
  });
});

describe("textValue", () => {
  it("trims and turns empty text into null (clear)", () => {
    expect(textValue("  Avery ")).toBe("Avery");
    expect(textValue("   ")).toBeNull();
    expect(textValue("")).toBeNull();
  });
});

describe("errors", () => {
  const visibility = (overrides: Partial<Parameters<typeof errorFor>[1]> = {}) => ({
    blocking: { giftCents: "Enter the amount of your gift.", email: "Enter your email address." },
    rejected: {},
    touched: new Set<string>(),
    showAll: false,
    ...overrides,
  });

  it("hides a missing value until the field was touched or the donor tried to continue", () => {
    expect(errorFor("giftCents", visibility())).toBeNull();
    expect(errorFor("giftCents", visibility({ touched: new Set(["giftCents"]) }))).toBe("Enter the amount of your gift.");
    expect(errorFor("email", visibility({ showAll: true }))).toBe("Enter your email address.");
  });

  it("shows a rejection of typed input at once, ahead of a missing-value message", () => {
    expect(errorFor("giftCents", visibility({ rejected: { giftCents: "The amount is too large." } }))).toBe("The amount is too large.");
  });

  it("drops the rejections of fields a save just accepted", () => {
    expect(withoutPaths({ "address.zip": "bad", email: "bad" }, ["address", "address.zip"])).toEqual({ email: "bad" });
  });

  it("orders problems as the form shows its fields, with non-field problems first", () => {
    const ordered = orderedErrors({ "address.zip": "z", session: "s", giftCents: "g", "attestations.noEarmark": "n", zzz: "x" });
    expect(ordered.map((e) => e.path)).toEqual(["session", "zzz", "giftCents", "address.zip", "attestations.noEarmark"]);
  });

  it("lists every field once", () => {
    expect(new Set(FIELD_ORDER).size).toBe(FIELD_ORDER.length);
  });

  it("makes DOM-safe ids", () => {
    expect(fieldId("contributors.primary.firstName")).toBe("give-contributors-primary-firstName");
    expect(fieldId("a b<c>")).toBe("give-a-b-c-");
  });
});
