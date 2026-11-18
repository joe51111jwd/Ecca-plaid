/**
 * Types for the geography engine: what a parent types (ZIP, address) → a 5-digit Texas county FIPS.
 *
 * About ZIP codes: the dataset is the Census Bureau's ZIP Code Tabulation Areas (ZCTAs), which
 * APPROXIMATE USPS ZIP codes. PO-box-only and single-building ZIPs have no ZCTA, and ZCTA boundaries do
 * not follow USPS delivery routes exactly. A ZIP match is therefore a candidate list, never proof of a
 * county.
 */

/** One county part of a ZCTA in the compiled dataset. */
export interface ZctaCountyPart {
  /** 5-digit county FIPS (state "48" + county). */
  fips: string;
  /** Share of the ZCTA's total land area (all states) that lies in this county, in basis points (0..10000). */
  landShare: number;
}

/** Shape of `data/geo/tx-zcta-county.json`, written by `scripts/geo-ingest.ts`. */
export interface ZctaCountyDataset {
  source: {
    url: string;
    /** ISO date (YYYY-MM-DD) the relationship file was downloaded, as passed to the ingest. */
    retrievedAt: string;
    /** sha256 (hex) of the downloaded relationship file. */
    sha256: string;
  };
  /** ZCTA → its Texas county parts, by land share descending, then FIPS ascending. */
  zctas: Record<string, ZctaCountyPart[]>;
  /**
   * ZCTAs that also cover land outside Texas → the share of their land outside Texas, in basis points.
   * Such a ZCTA is never "unique": the family may live in the other state.
   */
  crossState: Record<string, number>;
}

/** A candidate county for a ZIP, with its name from the AMI county list. */
export interface CountyCandidate {
  fips: string;
  name: string;
  /** Share of the ZCTA's land in this county, basis points. Absent when the candidate did not come from a ZIP. */
  landShareBps?: number;
}

export type ZipResolution =
  /** The ZCTA lies entirely in one Texas county (no other county part, no land outside Texas). */
  | { kind: "unique"; fips: string }
  /** More than one possible county (or partly outside Texas): the family must choose. */
  | { kind: "ambiguous"; candidates: CountyCandidate[]; outsideTexasBps: number }
  /** Not a 5-digit ZIP, or no Texas ZCTA has this code (PO-box ZIP, non-Texas ZIP, typo). */
  | { kind: "unknown" };

/** Normalized result of a Census Geocoder `geographies/onelineaddress` or `geographies/address` response. */
export interface GeocoderResult {
  matched: boolean;
  /** 5-digit county FIPS of the first match. */
  countyFips?: string;
  /** County name as the Census returns it, e.g. "Travis County". */
  countyName?: string;
  /** 2-letter state abbreviation from the matched address, e.g. "TX". */
  state?: string;
  /** 2-digit state FIPS of the matched county, e.g. "48". */
  stateFips?: string;
  matchedAddress?: string;
  tigerLineId?: string;
  coordinates?: { lon: number; lat: number };
  /** How many address matches the geocoder returned; >1 means the match was not exact. */
  matchCount?: number;
}
