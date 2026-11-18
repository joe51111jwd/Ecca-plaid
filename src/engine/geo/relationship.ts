/**
 * Parser for the Census Bureau 2020 ZCTA-to-county relationship file
 * (tab20_zcta520_county20_natl.txt, pipe-delimited, one row per ZCTA × county part).
 *
 * Pure: takes the file text, returns the compiled Texas dataset. File and network I/O live in
 * scripts/geo-ingest.ts.
 */
import type { ZctaCountyDataset, ZctaCountyPart } from "./types";

export const CENSUS_ZCTA_COUNTY_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";

export const TEXAS_STATE_FIPS = "48";

const BPS = 10_000;

const REQUIRED_COLUMNS = ["GEOID_ZCTA5_20", "AREALAND_ZCTA5_20", "GEOID_COUNTY_20", "AREALAND_PART"] as const;

export class RelationshipParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipParseError";
  }
}

interface ZctaAccumulator {
  zctaLand: number;
  texasParts: Map<string, number>;
  outsideLand: number;
}

function parseNonNegativeInt(value: string, column: string, lineNo: number): number {
  if (!/^\d+$/.test(value)) throw new RelationshipParseError(`Line ${lineNo}: ${column} is not a non-negative integer: "${value}"`);
  return Number(value);
}

/**
 * Build the Texas ZCTA → county dataset.
 *
 * Policy (documented in the data README comment of src/engine/geo/index.ts):
 *  - Rows without a ZCTA (county land in no ZCTA) are skipped.
 *  - County parts with zero land area (water only) are dropped: nobody can live there.
 *  - Only ZCTAs with at least one Texas county part are kept. Land outside Texas is summed into
 *    `crossState` so such a ZCTA is never treated as lying entirely in one Texas county.
 *  - landShare = round(part land / ZCTA land × 10000). A sliver can round to 0 and stays a candidate.
 */
export function parseZctaCountyRelationship(text: string, source: ZctaCountyDataset["source"]): ZctaCountyDataset {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0]?.split("|") ?? [];
  const col: Record<(typeof REQUIRED_COLUMNS)[number], number> = {
    GEOID_ZCTA5_20: -1,
    AREALAND_ZCTA5_20: -1,
    GEOID_COUNTY_20: -1,
    AREALAND_PART: -1,
  };
  for (const name of REQUIRED_COLUMNS) {
    const idx = header.indexOf(name);
    if (idx < 0) throw new RelationshipParseError(`Header is missing column ${name}`);
    col[name] = idx;
  }

  const acc = new Map<string, ZctaAccumulator>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const cells = line.split("|");
    if (cells.length !== header.length) throw new RelationshipParseError(`Line ${i + 1}: expected ${header.length} fields, got ${cells.length}`);
    const zcta = cells[col.GEOID_ZCTA5_20]!;
    if (zcta === "") continue;
    if (!/^\d{5}$/.test(zcta)) throw new RelationshipParseError(`Line ${i + 1}: bad ZCTA "${zcta}"`);
    const county = cells[col.GEOID_COUNTY_20]!;
    if (!/^\d{5}$/.test(county)) throw new RelationshipParseError(`Line ${i + 1}: bad county GEOID "${county}"`);
    const zctaLand = parseNonNegativeInt(cells[col.AREALAND_ZCTA5_20]!, "AREALAND_ZCTA5_20", i + 1);
    const partLand = parseNonNegativeInt(cells[col.AREALAND_PART]!, "AREALAND_PART", i + 1);

    let a = acc.get(zcta);
    if (!a) {
      a = { zctaLand, texasParts: new Map(), outsideLand: 0 };
      acc.set(zcta, a);
    } else if (a.zctaLand !== zctaLand) {
      throw new RelationshipParseError(`Line ${i + 1}: ZCTA ${zcta} has inconsistent AREALAND_ZCTA5_20`);
    }
    if (partLand === 0) continue;
    if (county.startsWith(TEXAS_STATE_FIPS)) {
      if (a.texasParts.has(county)) throw new RelationshipParseError(`Line ${i + 1}: duplicate row for ZCTA ${zcta} county ${county}`);
      a.texasParts.set(county, partLand);
    } else {
      a.outsideLand += partLand;
    }
  }

  const zctas: Record<string, ZctaCountyPart[]> = {};
  const crossState: Record<string, number> = {};
  for (const zcta of [...acc.keys()].sort()) {
    const a = acc.get(zcta)!;
    if (a.texasParts.size === 0) continue;
    if (a.zctaLand === 0) throw new RelationshipParseError(`ZCTA ${zcta} has land parts but zero total land area`);
    zctas[zcta] = [...a.texasParts.entries()]
      .map(([fips, land]) => ({ fips, landShare: Math.round((land * BPS) / a.zctaLand), land }))
      .sort((x, y) => y.land - x.land || (x.fips < y.fips ? -1 : 1))
      .map(({ fips, landShare }) => ({ fips, landShare }));
    if (a.outsideLand > 0) crossState[zcta] = Math.round((a.outsideLand * BPS) / a.zctaLand);
  }
  return { source, zctas, crossState };
}

/**
 * Deterministic JSON text for the dataset: one ZCTA per line so diffs between releases stay readable.
 * Keys are sorted; output ends with a newline.
 */
export function serializeZctaCountyDataset(ds: ZctaCountyDataset): string {
  const src = JSON.stringify({ url: ds.source.url, retrievedAt: ds.source.retrievedAt, sha256: ds.source.sha256 });
  const zctaLines = Object.keys(ds.zctas)
    .sort()
    .map((z) => `    ${JSON.stringify(z)}: ${JSON.stringify(ds.zctas[z]!.map((p) => ({ fips: p.fips, landShare: p.landShare })))}`);
  const crossLines = Object.keys(ds.crossState)
    .sort()
    .map((z) => `    ${JSON.stringify(z)}: ${ds.crossState[z]}`);
  const block = (rows: string[]) => (rows.length === 0 ? "{}" : `{\n${rows.join(",\n")}\n  }`);
  return `{\n  "source": ${src},\n  "zctas": ${block(zctaLines)},\n  "crossState": ${block(crossLines)}\n}\n`;
}
