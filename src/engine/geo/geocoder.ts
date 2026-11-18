/**
 * Pure half of the Census Geocoder adapter: request URL building and response parsing.
 * The network call lives in src/server/geo.
 *
 * Response shape (verified against a live call, saved in __fixtures__/census-geocoder-match.json):
 *   { result: { input: {...}, addressMatches: [ { matchedAddress, coordinates: { x: lon, y: lat },
 *     tigerLine: { tigerLineId, side }, addressComponents: { state, zip, ... },
 *     geographies: { Counties: [ { GEOID, STATE, COUNTY, NAME, BASENAME, ... } ], ... } } ] } }
 * Errors come back as { errors: string[], status: "400" }.
 */
import { z } from "zod";
import type { GeocoderResult } from "./types";

export const CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder/geographies";
export const CENSUS_GEOCODER_BENCHMARK = "Public_AR_Current";
export const CENSUS_GEOCODER_VINTAGE = "Current_Current";

export interface GeocoderAddressInput {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

/** URL for the structured `geographies/address` endpoint, limited to the Counties layer. */
export function buildCensusGeocoderUrl(address: GeocoderAddressInput): string {
  const params = new URLSearchParams({
    street: address.line1,
    city: address.city,
    state: address.state,
    zip: address.zip,
    benchmark: CENSUS_GEOCODER_BENCHMARK,
    vintage: CENSUS_GEOCODER_VINTAGE,
    layers: "Counties",
    format: "json",
  });
  return `${CENSUS_GEOCODER_BASE}/address?${params.toString()}`;
}

const countySchema = z.object({
  GEOID: z.string().regex(/^\d{5}$/),
  STATE: z.string().regex(/^\d{2}$/).optional(),
  NAME: z.string().optional(),
  BASENAME: z.string().optional(),
});

const matchSchema = z.object({
  matchedAddress: z.string().optional(),
  coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
  tigerLine: z.object({ tigerLineId: z.union([z.string(), z.number()]).optional() }).optional(),
  addressComponents: z.object({ state: z.string().optional() }).optional(),
  geographies: z.record(z.string(), z.array(z.unknown())).optional(),
});

const responseSchema = z.object({
  result: z.object({ addressMatches: z.array(z.unknown()) }),
});

/**
 * Normalize a geocoder response. Never throws: anything unrecognisable (an `errors` body, malformed
 * JSON object, a match without a county) is `{ matched: false }`. Uses the first match, as the Census
 * orders them; `matchCount` lets callers see when there were several.
 */
export function parseCensusGeocoderResponse(json: unknown): GeocoderResult {
  let body = json;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      return { matched: false };
    }
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { matched: false };
  const matches = parsed.data.result.addressMatches;
  if (matches.length === 0) return { matched: false, matchCount: 0 };
  const first = matchSchema.safeParse(matches[0]);
  if (!first.success) return { matched: false, matchCount: matches.length };
  const m = first.data;
  const county = countySchema.safeParse(m.geographies?.["Counties"]?.[0]);
  if (!county.success) return { matched: false, matchCount: matches.length };
  const c = county.data;
  const stateFips = c.STATE ?? c.GEOID.slice(0, 2);
  const tigerLineId = m.tigerLine?.tigerLineId;
  return {
    matched: true,
    countyFips: c.GEOID,
    ...(c.NAME ?? c.BASENAME ? { countyName: (c.NAME ?? c.BASENAME)! } : {}),
    ...(m.addressComponents?.state ? { state: m.addressComponents.state.toUpperCase() } : {}),
    stateFips,
    ...(m.matchedAddress ? { matchedAddress: m.matchedAddress } : {}),
    ...(tigerLineId !== undefined ? { tigerLineId: String(tigerLineId) } : {}),
    ...(m.coordinates ? { coordinates: { lon: m.coordinates.x, lat: m.coordinates.y } } : {}),
    matchCount: matches.length,
  };
}
