/**
 * Geography engine: what a parent types → a 5-digit Texas county FIPS. Counties → HUD income-limit
 * areas belong to src/engine/ami.
 *
 * Data: data/geo/tx-zcta-county.json, compiled by `tsx scripts/geo-ingest.ts` from the Census Bureau 2020
 * ZCTA-to-county relationship file. ZCTAs APPROXIMATE USPS ZIP codes: PO-box-only ZIPs are absent and
 * boundaries differ, so a ZIP gives a candidate list, never proof of a county. Only a ZCTA lying entirely
 * in one Texas county resolves on its own; anything else is confirmed by the family and recorded as
 * self-selected so a reviewer can see it.
 *
 * Pure: no database, network, file system, environment or clock. The relationship-file parser is exported
 * from "./relationship" for the ingest script and is not re-exported here.
 */
export {
  TEXAS_ZIP3_PREFIXES,
  candidateCountiesForZip,
  isTexasZipCandidate,
  normalizeZip,
  resolveCountyFromZip,
  zctaDataset,
} from "./zip";
export { DEFAULT_COUNTY_SEARCH_LIMIT, normalizeCountyName, searchCounties } from "./search";
export {
  CENSUS_GEOCODER_BASE,
  CENSUS_GEOCODER_BENCHMARK,
  CENSUS_GEOCODER_VINTAGE,
  buildCensusGeocoderUrl,
  parseCensusGeocoderResponse,
  type GeocoderAddressInput,
} from "./geocoder";
export type { CountyCandidate, GeocoderResult, ZctaCountyDataset, ZctaCountyPart, ZipResolution } from "./types";
