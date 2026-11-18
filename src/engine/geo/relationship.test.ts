import { describe, expect, it } from "vitest";
import { RelationshipParseError, parseZctaCountyRelationship, serializeZctaCountyDataset } from "./relationship";

// SYNTHETIC relationship file: real column layout, invented ZCTAs/areas. Not Census data.
const HEADER =
  "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_COUNTY_20|GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|AREAWATER_COUNTY_20|MTFCC_COUNTY_20|CLASSFP_COUNTY_20|FUNCSTAT_COUNTY_20|AREALAND_PART|AREAWATER_PART";

function row(zcta: string, zctaLand: number, county: string, partLand: number): string {
  return `1|${zcta}|ZCTA5 ${zcta}|${zctaLand}|0|G6350|B5|S|2|${county}|Synthetic County|1|0|G4020|H1|A|${partLand}|0`;
}

const SOURCE = { url: "https://example.test/synthetic.txt", retrievedAt: "2026-11-18", sha256: "0".repeat(64) };

describe("parseZctaCountyRelationship (synthetic file)", () => {
  const text = [
    "﻿" + HEADER,
    "||||||||9|01003|Synthetic County|1|0|G4020|H1|A|500|0", // county land in no ZCTA
    row("99901", 1000, "48001", 1000), // unique
    row("99902", 1000, "48003", 250),
    row("99902", 1000, "48005", 750), // multi, out of order
    row("99903", 1000, "48007", 900),
    row("99903", 1000, "35001", 100), // crosses into another state
    row("99904", 1000, "01001", 1000), // not Texas at all
    row("99905", 3, "48009", 1),
    row("99905", 3, "48011", 2), // rounding
    row("99906", 1000, "48013", 1000),
    row("99906", 1000, "48015", 0), // water-only part
    row("99907", 100000, "48017", 99996),
    row("99907", 100000, "48019", 4), // sliver rounds to 0 bps
    "",
  ].join("\r\n");
  const ds = parseZctaCountyRelationship(text, SOURCE);

  it("keeps only ZCTAs with Texas land, sorted by share descending", () => {
    expect(Object.keys(ds.zctas)).toEqual(["99901", "99902", "99903", "99905", "99906", "99907"]);
    expect(ds.zctas["99901"]).toEqual([{ fips: "48001", landShare: 10000 }]);
    expect(ds.zctas["99902"]).toEqual([
      { fips: "48005", landShare: 7500 },
      { fips: "48003", landShare: 2500 },
    ]);
    expect(ds.zctas["99905"]).toEqual([
      { fips: "48011", landShare: 6667 },
      { fips: "48009", landShare: 3333 },
    ]);
  });

  it("records land outside Texas and drops water-only parts", () => {
    expect(ds.zctas["99903"]).toEqual([{ fips: "48007", landShare: 9000 }]);
    expect(ds.crossState).toEqual({ "99903": 1000 });
    expect(ds.zctas["99906"]).toEqual([{ fips: "48013", landShare: 10000 }]);
  });

  it("keeps slivers that round to 0 bps as candidates", () => {
    expect(ds.zctas["99907"]).toEqual([
      { fips: "48017", landShare: 10000 },
      { fips: "48019", landShare: 0 },
    ]);
  });

  it("serializes deterministically and round-trips through JSON", () => {
    const a = serializeZctaCountyDataset(ds);
    expect(serializeZctaCountyDataset(parseZctaCountyRelationship(text, SOURCE))).toBe(a);
    expect(JSON.parse(a)).toEqual(ds);
    expect(a.endsWith("}\n")).toBe(true);
  });

  it("serializes an empty dataset as valid JSON", () => {
    const empty = parseZctaCountyRelationship(HEADER, SOURCE);
    expect(JSON.parse(serializeZctaCountyDataset(empty))).toEqual({ source: SOURCE, zctas: {}, crossState: {} });
  });

  it("rejects malformed input", () => {
    expect(() => parseZctaCountyRelationship("A|B|C\n1|2|3", SOURCE)).toThrow(RelationshipParseError);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n1|2|3`, SOURCE)).toThrow(/expected 18 fields/);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n${row("9990", 10, "48001", 10)}`, SOURCE)).toThrow(/bad ZCTA/);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n${row("99901", 10, "4800", 10)}`, SOURCE)).toThrow(/bad county/);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n${row("99901", 10, "48001", -1)}`, SOURCE)).toThrow(/non-negative integer/);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n${row("99901", 10, "48001", 5)}\n${row("99901", 10, "48001", 5)}`, SOURCE)).toThrow(/duplicate/);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n${row("99901", 10, "48001", 5)}\n${row("99901", 11, "48003", 5)}`, SOURCE)).toThrow(/inconsistent/);
    expect(() => parseZctaCountyRelationship(`${HEADER}\n${row("99901", 0, "48001", 5)}`, SOURCE)).toThrow(/zero total land/);
  });
});
