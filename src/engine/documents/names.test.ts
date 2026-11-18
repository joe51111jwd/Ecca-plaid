import { describe, expect, it } from "vitest";
import { editDistance, matchNameToHousehold, matchPersonName, normalizeFullName } from "./names";

describe("normalizeFullName", () => {
  it.each([
    ["DANA SAMPLE", ["DANA"], ["SAMPLE"]],
    ["Sample, Dana M", ["DANA"], ["SAMPLE"]],
    ["SAMPLE JR, DANA", ["DANA"], ["SAMPLE"]],
    ["José Álvarez-García", ["JOSE"], ["ALVAREZ", "GARCIA"]],
    ["MARIA ELENA DE LA CRUZ", ["MARIA", "ELENA"], ["CRUZ"]],
    ["Robert O'Neil III", ["ROBERT"], ["ONEIL"]],
    ["MARIA ALVAREZ Y GARCIA", ["MARIA", "ALVAREZ"], ["GARCIA"]],
  ])("%s", (printed, given, surnames) => {
    const n = normalizeFullName(printed);
    expect(n.given).toEqual(given);
    expect(n.surnames).toEqual(surnames);
  });
});

describe("matchPersonName", () => {
  it.each([
    ["DANA SAMPLE", { firstName: "Dana", lastName: "Sample" }, "exact"],
    ["Sample, Dana", { firstName: "DANA", lastName: "SAMPLE" }, "exact"],
    ["DANA M SAMPLE", { firstName: "Dana", lastName: "Sample" }, "exact"],
    ["DANA SAMPLE JR", { firstName: "Dana", lastName: "Sample" }, "exact"],
    ["JOSE ALVAREZ GARCIA", { firstName: "José", lastName: "Álvarez García" }, "exact"],
    ["JOSE ALVAREZ-GARCIA", { firstName: "Jose", lastName: "Alvarez Garcia" }, "exact"],
    ["MARIA ALVAREZ GARCIA", { firstName: "Maria", lastName: "Alvarez" }, "strong"],
    ["MARIA ALVAREZ", { firstName: "Maria", lastName: "Alvarez-Garcia" }, "strong"],
    ["MARIA GARCIA", { firstName: "Maria", lastName: "Alvarez Garcia" }, "strong"],
    ["DANA MARIE SAMPLE", { firstName: "Dana", lastName: "Sample" }, "strong"],
    ["JORDAN EXAMPIE", { firstName: "Jordan", lastName: "Example" }, "strong"],
    ["JORDAN EXAMPEL", { firstName: "Jordan", lastName: "Example" }, "none"],
    ["D SAMPLE", { firstName: "Dana", lastName: "Sample" }, "weak"],
    ["DANA SAMP", { firstName: "Dana", lastName: "Sample" }, "weak"],
    ["DANA SAMPLER", { firstName: "Dana", lastName: "Sample" }, "strong"],
    ["DAN SAMPLE", { firstName: "Dana", lastName: "Sample" }, "weak"],
    ["DANA ANN SAMPLE", { firstName: "Dana", middleName: "Beth", lastName: "Sample" }, "weak"],
    ["BOB SAMPLE", { firstName: "Robert", lastName: "Sample" }, "none"],
    ["CASEY PLACEHOLDER", { firstName: "Dana", lastName: "Sample" }, "none"],
    ["DANA PLACEHOLDER", { firstName: "Dana", lastName: "Sample" }, "none"],
    ["RILEY SAMPLE", { firstName: "Dana", lastName: "Sample" }, "none"],
    ["", { firstName: "Dana", lastName: "Sample" }, "none"],
    ["SAMPLE", { firstName: "Dana", lastName: "Sample" }, "none"],
  ] as const)("%j vs %j → %s", (printed, person, grade) => {
    expect(matchPersonName(printed, person).grade).toBe(grade);
  });

  it("orders confidence by grade", () => {
    const c = (p: string) => matchPersonName(p, { firstName: "Dana", lastName: "Sample" }).confidence;
    expect(c("DANA SAMPLE")).toBeGreaterThan(c("DANA MARIE SAMPLE"));
    expect(c("DANA MARIE SAMPLE")).toBeGreaterThan(c("D SAMPLE"));
    expect(c("D SAMPLE")).toBeGreaterThan(c("BOB SAMPLE"));
  });
});

describe("matchNameToHousehold", () => {
  const household = [
    { id: "a", firstName: "Dana", lastName: "Sample" },
    { id: "b", firstName: "Riley", lastName: "Sample" },
    { id: "c", firstName: "Dana", lastName: "Sample" },
  ];
  it("returns the best member and flags ties", () => {
    const r = matchNameToHousehold("RILEY SAMPLE", household);
    expect(r).toMatchObject({ grade: "exact", memberId: "b", ambiguous: false });
    expect(matchNameToHousehold("DANA SAMPLE", household)).toMatchObject({ grade: "exact", ambiguous: true });
    expect(matchNameToHousehold("CASEY PLACEHOLDER", household)).toMatchObject({ grade: "none", memberId: null });
    expect(matchNameToHousehold("DANA SAMPLE", [])).toMatchObject({ grade: "none" });
  });

  it("edit distance", () => {
    expect(editDistance("SAMPLE", "SAMPLE")).toBe(0);
    expect(editDistance("SAMPLE", "SAMPEL", 2)).toBe(2);
    expect(editDistance("A", "ABCDE", 1)).toBe(2);
  });
});
