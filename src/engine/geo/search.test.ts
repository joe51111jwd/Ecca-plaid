import { describe, expect, it } from "vitest";
import { normalizeCountyName, searchCounties } from "./search";

describe("normalizeCountyName", () => {
  it.each([
    ["DeWitt County", "dewitt"],
    ["De Witt", "dewitt"],
    ["de-witt county", "dewitt"],
    ["Mc Lennan", "mclennan"],
    ["McLennan County", "mclennan"],
    ["  LA SALLE  ", "lasalle"],
    ["Bexar Co.", "bexarco"],
    ["Béxar", "bexar"],
    ["county", ""],
    ["Countyline", "countyline"],
  ])("%j → %j", (input, out) => expect(normalizeCountyName(input)).toBe(out));
});

describe("searchCounties", () => {
  const names = (q: string, limit?: number) => searchCounties(q, limit === undefined ? {} : { limit }).map((c) => c.name);

  it("finds DeWitt with or without the space and suffix", () => {
    for (const q of ["De Witt", "DeWitt", "dewitt county", "DE WITT COUNTY"]) expect(names(q)[0], q).toBe("DeWitt County");
  });

  it("finds McLennan and La Salle regardless of spacing", () => {
    expect(names("Mc Lennan")).toEqual(["McLennan County"]);
    expect(names("mclennan")).toEqual(["McLennan County"]);
    expect(names("lasalle")).toEqual(["La Salle County"]);
    expect(names("La Salle County")).toEqual(["La Salle County"]);
  });

  it("is diacritic-insensitive", () => {
    expect(names("Béxar")[0]).toBe("Bexar County");
  });

  it("orders prefix matches alphabetically before substring matches", () => {
    const r = names("har", 50);
    expect(r.slice(0, 4)).toEqual(["Hardeman County", "Hardin County", "Harris County", "Harrison County"]);
    const firstSub = r.findIndex((n) => !normalizeCountyName(n).startsWith("har"));
    expect(firstSub).toBeGreaterThan(0);
    for (const n of r.slice(firstSub)) expect(normalizeCountyName(n).includes("har")).toBe(true);
  });

  it("returns FIPS and respects the limit", () => {
    expect(searchCounties("Harris")[0]).toEqual({ fips: "48201", name: "Harris County" });
    expect(searchCounties("a", { limit: 3 })).toHaveLength(3);
    expect(searchCounties("a", { limit: 0 })).toEqual([]);
    expect(searchCounties("a", { limit: 1.5 })).toEqual([]);
  });

  it("matches an exact Texas FIPS code", () => {
    expect(searchCounties("48201")).toEqual([{ fips: "48201", name: "Harris County" }]);
    expect(searchCounties("06037")).toEqual([]);
  });

  it("returns nothing for empty, punctuation-only, bare 'county' or unknown queries", () => {
    for (const q of ["", "   ", "--", "county", "zzzz"]) expect(searchCounties(q), q).toEqual([]);
  });
});
