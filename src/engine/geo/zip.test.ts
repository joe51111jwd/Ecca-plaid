import { describe, expect, it } from "vitest";
import { getCounty, listCounties } from "@/engine/ami";
import { candidateCountiesForZip, isTexasZipCandidate, normalizeZip, resolveCountyFromZip, zctaDataset } from "./zip";

describe("normalizeZip", () => {
  it.each([
    ["78701", "78701"],
    [" 78701 ", "78701"],
    ["78701-1234", "78701"],
    ["787011234", "78701"],
    ["00501", "00501"],
  ])("accepts %j", (input, out) => expect(normalizeZip(input)).toBe(out));

  it.each(["", "7870", "787012", "78701-12", "78701 1234", "7870a", "78701-", "١٢٣٤٥", "78701\n0000"])("rejects %j", (input) => {
    expect(normalizeZip(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeZip(null)).toBeNull();
    expect(normalizeZip(undefined)).toBeNull();
    expect(normalizeZip(78701 as unknown as string)).toBeNull();
  });
});

describe("compiled Census ZCTA dataset", () => {
  const ds = zctaDataset();

  it("records its source", () => {
    expect(ds.source.url).toBe("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt");
    expect(ds.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("only references counties in the AMI county list, and covers all 254", () => {
    const amiFips = new Set(listCounties().map((c) => c.fips));
    const used = new Set<string>();
    for (const [zcta, parts] of Object.entries(ds.zctas)) {
      for (const p of parts) {
        expect(amiFips.has(p.fips), `${zcta} → ${p.fips}`).toBe(true);
        used.add(p.fips);
      }
    }
    expect(used.size).toBe(254);
  });

  it("sorts parts by share descending with no duplicate counties, and shares never exceed the whole", () => {
    for (const [zcta, parts] of Object.entries(ds.zctas)) {
      const shares = parts.map((p) => p.landShare);
      expect([...shares].sort((a, b) => b - a), zcta).toEqual(shares);
      expect(new Set(parts.map((p) => p.fips)).size, zcta).toBe(parts.length);
      const total = shares.reduce((a, b) => a + b, 0) + (ds.crossState[zcta] ?? 0);
      expect(Math.abs(total - 10000), zcta).toBeLessThanOrEqual(parts.length + 1);
    }
  });
});

describe("resolveCountyFromZip (real Census data)", () => {
  it("77002 (downtown Houston) lies entirely in Harris County", () => {
    expect(resolveCountyFromZip("77002")).toEqual({ kind: "unique", fips: "48201" });
    expect(candidateCountiesForZip("77002-1234")).toEqual([{ fips: "48201", name: "Harris County", landShareBps: 10000 }]);
  });

  it("78701 (downtown Austin) lies entirely in Travis County", () => {
    expect(resolveCountyFromZip("78701")).toEqual({ kind: "unique", fips: "48453" });
  });

  it("75007 (Carrollton) spans Denton, Dallas and Collin: ambiguous, never auto-picked", () => {
    const r = resolveCountyFromZip("75007");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates.map((c) => c.fips)).toEqual(["48121", "48113", "48085"]);
    expect(r.candidates.map((c) => c.name)).toEqual(["Denton County", "Dallas County", "Collin County"]);
    expect(r.candidates[0]!.landShareBps).toBeGreaterThan(5000);
    expect(r.outsideTexasBps).toBe(0);
  });

  it("a ZCTA with one Texas county but land in another state is ambiguous", () => {
    // 88430 is mostly in New Mexico; its Texas part is in one county.
    const r = resolveCountyFromZip("88430");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates).toHaveLength(1);
    expect(r.outsideTexasBps).toBeGreaterThan(5000);
  });

  it("non-Texas, malformed and PO-box-style ZIPs are unknown", () => {
    expect(resolveCountyFromZip("10001")).toEqual({ kind: "unknown" });
    expect(resolveCountyFromZip("abc")).toEqual({ kind: "unknown" });
    expect(resolveCountyFromZip("")).toEqual({ kind: "unknown" });
    expect(candidateCountiesForZip("10001")).toEqual([]);
    expect(candidateCountiesForZip("nope")).toEqual([]);
  });

  it("names come from the AMI county list", () => {
    for (const c of candidateCountiesForZip("75007")) expect(c.name).toBe(getCounty(c.fips)!.name);
  });
});

describe("isTexasZipCandidate", () => {
  it("is true for Texas ZCTAs and Texas USPS prefixes", () => {
    expect(isTexasZipCandidate("77002")).toBe(true);
    expect(isTexasZipCandidate("73301")).toBe(true);
    expect(isTexasZipCandidate("88510")).toBe(true);
    expect(isTexasZipCandidate("73949")).toBe(true);
  });
  it("is false for other states and malformed input", () => {
    expect(isTexasZipCandidate("10001")).toBe(false);
    expect(isTexasZipCandidate("74999")).toBe(false);
    expect(isTexasZipCandidate("80000")).toBe(false);
    expect(isTexasZipCandidate("7700")).toBe(false);
  });
});
