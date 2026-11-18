import { describe, expect, it } from "vitest";
import match from "./__fixtures__/census-geocoder-match.json";
import noMatch from "./__fixtures__/census-geocoder-nomatch.json";
import { buildCensusGeocoderUrl, parseCensusGeocoderResponse } from "./geocoder";

// Fixtures are live Census Geocoder responses for a public building (1100 Congress Ave, Austin — the
// Texas Capitol) and a synthetic non-existent address, retrieved 2026-11-18.

describe("parseCensusGeocoderResponse", () => {
  it("parses a real match", () => {
    expect(parseCensusGeocoderResponse(match)).toEqual({
      matched: true,
      countyFips: "48453",
      countyName: "Travis County",
      state: "TX",
      stateFips: "48",
      matchedAddress: "1100 CONGRESS AVE, AUSTIN, TX, 78701",
      tigerLineId: "656281944",
      coordinates: { lon: -97.739754035328, lat: 30.27644199222 },
      matchCount: 1,
    });
  });

  it("accepts the response as a JSON string", () => {
    expect(parseCensusGeocoderResponse(JSON.stringify(match)).countyFips).toBe("48453");
  });

  it("reports no match", () => {
    expect(parseCensusGeocoderResponse(noMatch)).toEqual({ matched: false, matchCount: 0 });
  });

  it("treats malformed or error bodies as no match without throwing", () => {
    for (const body of ["{not json", "", null, undefined, 42, [], {}, { result: {} }, { errors: ["Invalid benchmark in request"], status: "400" }]) {
      expect(parseCensusGeocoderResponse(body)).toMatchObject({ matched: false });
    }
  });

  it("treats a match without a county layer or with a bad GEOID as no match", () => {
    const base = match.result.addressMatches[0]!;
    const noCounty = { result: { addressMatches: [{ ...base, geographies: {} }] } };
    expect(parseCensusGeocoderResponse(noCounty)).toEqual({ matched: false, matchCount: 1 });
    const badGeoid = { result: { addressMatches: [{ ...base, geographies: { Counties: [{ GEOID: "4845" }] } }] } };
    expect(parseCensusGeocoderResponse(badGeoid)).toEqual({ matched: false, matchCount: 1 });
    expect(parseCensusGeocoderResponse({ result: { addressMatches: ["x"] } })).toEqual({ matched: false, matchCount: 1 });
  });

  it("uses the first of several matches and reports the count; derives state FIPS from GEOID when STATE is absent", () => {
    const other = { geographies: { Counties: [{ GEOID: "48201" }] } };
    const r = parseCensusGeocoderResponse({ result: { addressMatches: [other, match.result.addressMatches[0]] } });
    expect(r).toEqual({ matched: true, countyFips: "48201", stateFips: "48", matchCount: 2 });
  });
});

describe("buildCensusGeocoderUrl", () => {
  it("builds an encoded structured-address URL for the Counties layer", () => {
    const url = new URL(buildCensusGeocoderUrl({ line1: "1100 Congress Ave #2", city: "Austin", state: "TX", zip: "78701" }));
    expect(url.origin + url.pathname).toBe("https://geocoding.geo.census.gov/geocoder/geographies/address");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      street: "1100 Congress Ave #2",
      city: "Austin",
      state: "TX",
      zip: "78701",
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      layers: "Counties",
      format: "json",
    });
  });
});
