import { describe, expect, it, vi } from "vitest";
import match from "@/engine/geo/__fixtures__/census-geocoder-match.json";
import noMatch from "@/engine/geo/__fixtures__/census-geocoder-nomatch.json";
import { isAppError } from "@/lib/errors";
import { TEXAS_ONLY_MESSAGE, confirmSelectedCounty, geocodeAddress, resolveHouseholdCounty } from "./index";

// All addresses below are public buildings or synthetic. No personal address is used.

const CAPITOL = { line1: "1100 Congress Ave", city: "Austin", state: "TX", zip: "78701" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A Census-shaped match placing the address in the given county. */
function matchIn(geoid: string, state = "TX") {
  const base = match.result.addressMatches[0]!;
  return {
    result: {
      addressMatches: [{ ...base, addressComponents: { ...base.addressComponents, state }, geographies: { Counties: [{ GEOID: geoid, STATE: geoid.slice(0, 2), NAME: "Synthetic County" }] } }],
    },
  };
}

function fetchSequence(...steps: Array<Response | Error | "hang">) {
  const calls: string[] = [];
  const impl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if (step === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step.clone());
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

async function expectInvalid(p: Promise<unknown> | (() => unknown), field?: string) {
  let err: unknown;
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    err = e;
  }
  expect(isAppError(err)).toBe(true);
  if (!isAppError(err)) return;
  expect(err.code).toBe("validation_failed");
  if (field) expect((err.details as { fields: Record<string, string> }).fields[field]).toBeTruthy();
  return err;
}

describe("geocodeAddress", () => {
  it("returns the parsed match and calls the structured endpoint", async () => {
    const f = fetchSequence(jsonResponse(match));
    const r = await geocodeAddress(CAPITOL, { fetchImpl: f.impl });
    expect(r).toMatchObject({ matched: true, countyFips: "48453", stateFips: "48" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain("/geocoder/geographies/address?");
  });

  it("reports no_match without retrying", async () => {
    const f = fetchSequence(jsonResponse(noMatch));
    expect(await geocodeAddress(CAPITOL, { fetchImpl: f.impl })).toEqual({ matched: false, matchCount: 0, reason: "no_match" });
    expect(f.calls).toHaveLength(1);
  });

  it("retries once on a network error, then succeeds", async () => {
    const f = fetchSequence(new TypeError("fetch failed"), jsonResponse(match));
    expect((await geocodeAddress(CAPITOL, { fetchImpl: f.impl })).matched).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it("gives up after one retry and never throws", async () => {
    const f = fetchSequence(new TypeError("fetch failed"));
    expect(await geocodeAddress(CAPITOL, { fetchImpl: f.impl })).toEqual({ matched: false, reason: "network_error" });
    expect(f.calls).toHaveLength(2);
  });

  it("times out each attempt", async () => {
    const f = fetchSequence("hang");
    expect(await geocodeAddress(CAPITOL, { fetchImpl: f.impl, timeoutMs: 10 })).toEqual({ matched: false, reason: "timeout" });
    expect(f.calls).toHaveLength(2);
  });

  it("retries HTTP 5xx but not 4xx", async () => {
    const five = fetchSequence(jsonResponse({}, 503));
    expect(await geocodeAddress(CAPITOL, { fetchImpl: five.impl })).toEqual({ matched: false, reason: "http_error" });
    expect(five.calls).toHaveLength(2);
    const four = fetchSequence(jsonResponse({ errors: ["bad"], status: "400" }, 400));
    expect(await geocodeAddress(CAPITOL, { fetchImpl: four.impl })).toEqual({ matched: false, reason: "http_error" });
    expect(four.calls).toHaveLength(1);
  });

  it("reports invalid_response for non-JSON or unrecognised bodies", async () => {
    const html = fetchSequence(new Response("<html>maintenance</html>", { status: 200 }));
    expect(await geocodeAddress(CAPITOL, { fetchImpl: html.impl })).toEqual({ matched: false, reason: "invalid_response" });
    const odd = fetchSequence(jsonResponse({ hello: "world" }));
    expect(await geocodeAddress(CAPITOL, { fetchImpl: odd.impl })).toEqual({ matched: false, reason: "invalid_response" });
  });
});

describe("resolveHouseholdCounty", () => {
  it("uses a Texas geocoder match", async () => {
    const f = fetchSequence(jsonResponse(match));
    const r = await resolveHouseholdCounty(CAPITOL, { fetchImpl: f.impl });
    expect(r).toEqual({
      countyFips: "48453",
      countyName: "Travis County",
      resolution: "geocoder",
      hudArea: { code: expect.any(String), name: expect.stringContaining("Austin") },
      matchedAddress: "1100 CONGRESS AVE, AUSTIN, TX, 78701",
    });
  });

  it("geocoder wins over an ambiguous ZIP", async () => {
    const f = fetchSequence(jsonResponse(matchIn("48113")));
    const r = await resolveHouseholdCounty({ line1: "1 Synthetic Way", city: "Carrollton", state: "Texas", zip: "75007" }, { fetchImpl: f.impl });
    expect(r).toMatchObject({ countyFips: "48113", countyName: "Dallas County", resolution: "geocoder" });
  });

  it("falls back to a unique ZIP when the geocoder has no match", async () => {
    const f = fetchSequence(jsonResponse(noMatch));
    const r = await resolveHouseholdCounty({ line1: "1 Synthetic Way", city: "Houston", state: "tx", zip: "77002-0000" }, { fetchImpl: f.impl });
    expect(r).toMatchObject({ countyFips: "48201", countyName: "Harris County", resolution: "zip_unique", hudArea: { name: expect.stringContaining("Houston") } });
    expect(r).not.toHaveProperty("matchedAddress");
  });

  it("falls back to a unique ZIP when the geocoder times out", async () => {
    const f = fetchSequence("hang");
    const r = await resolveHouseholdCounty({ ...CAPITOL, line1: "1 Synthetic Way" }, { fetchImpl: f.impl, timeoutMs: 5 });
    expect(r).toMatchObject({ countyFips: "48453", resolution: "zip_unique" });
  });

  it("asks the family to choose among ZIP candidates when the ZIP spans counties", async () => {
    const f = fetchSequence(new TypeError("fetch failed"));
    const r = await resolveHouseholdCounty({ line1: "1 Synthetic Way", city: "Carrollton", state: "TX", zip: "75007" }, { fetchImpl: f.impl });
    expect(r).toMatchObject({ needsSelection: true, reason: "zip_ambiguous", outsideTexasBps: 0, geocoder: { matched: false, reason: "network_error" } });
    if (!("needsSelection" in r)) return;
    expect(r.candidates.map((c) => c.fips)).toEqual(["48121", "48113", "48085"]);
  });

  it("offers all 254 counties alphabetically when the ZIP is not a Texas ZCTA", async () => {
    const f = fetchSequence(jsonResponse(noMatch));
    const r = await resolveHouseholdCounty({ line1: "PO Box 1", city: "Austin", state: "TX", zip: "73301" }, { fetchImpl: f.impl });
    expect(r).toMatchObject({ needsSelection: true, reason: "zip_unknown", geocoder: { matched: false, reason: "no_match" } });
    if (!("needsSelection" in r)) return;
    expect(r.candidates).toHaveLength(254);
    expect(r.candidates[0]!.name).toBe("Anderson County");
    const sorted = [...r.candidates].sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(r.candidates).toEqual(sorted);
  });

  it("an out-of-state geocoder match with a Texas ZCTA falls back to the ZIP", async () => {
    const f = fetchSequence(jsonResponse(matchIn("35025", "NM")));
    const r = await resolveHouseholdCounty({ line1: "1 Synthetic Way", city: "Houston", state: "TX", zip: "77002" }, { fetchImpl: f.impl });
    expect(r).toMatchObject({ countyFips: "48201", resolution: "zip_unique" });
  });

  it("rejects an address the geocoder places outside Texas with a non-Texas ZIP", async () => {
    const f = fetchSequence(jsonResponse(matchIn("36061", "NY")));
    const err = await expectInvalid(resolveHouseholdCounty({ line1: "1 Synthetic Way", city: "New York", state: "TX", zip: "10001" }, { fetchImpl: f.impl }), "state");
    expect(err?.message).toBe(TEXAS_ONLY_MESSAGE);
  });

  it("rejects a non-Texas state before calling the geocoder", async () => {
    const f = fetchSequence(jsonResponse(match));
    await expectInvalid(resolveHouseholdCounty({ ...CAPITOL, state: "OK" }, { fetchImpl: f.impl }), "state");
    expect(f.calls).toHaveLength(0);
  });

  it("rejects incomplete addresses and bad ZIPs with field messages", async () => {
    const f = fetchSequence(jsonResponse(match));
    await expectInvalid(resolveHouseholdCounty({ ...CAPITOL, line1: "  " }, { fetchImpl: f.impl }), "line1");
    await expectInvalid(resolveHouseholdCounty({ ...CAPITOL, city: "" }, { fetchImpl: f.impl }), "city");
    await expectInvalid(resolveHouseholdCounty({ ...CAPITOL, zip: "7870" }, { fetchImpl: f.impl }), "zip");
    await expectInvalid(resolveHouseholdCounty({ ...CAPITOL, zip: "" }, { fetchImpl: f.impl }), "zip");
    expect(f.calls).toHaveLength(0);
  });
});

describe("confirmSelectedCounty", () => {
  it("accepts a candidate county and reports it matches the ZIP", () => {
    const r = confirmSelectedCounty("48113", "75007");
    expect(r).toMatchObject({ countyFips: "48113", countyName: "Dallas County", resolution: "self_selected", matchesZip: true });
    expect(r.zipCandidates).toHaveLength(3);
    expect(r.hudArea.name).toContain("Dallas");
  });

  it("flags a county that does not match the ZIP", () => {
    expect(confirmSelectedCounty("48201", "75007").matchesZip).toBe(false);
  });

  it("returns null consistency when the ZIP is unknown or absent", () => {
    expect(confirmSelectedCounty("48201", "73301")).toMatchObject({ matchesZip: null, zipCandidates: [] });
    expect(confirmSelectedCounty("48201").matchesZip).toBeNull();
    expect(confirmSelectedCounty(" 48201 ", null).countyFips).toBe("48201");
  });

  it("rejects codes that are not Texas counties", async () => {
    for (const bad of ["06037", "48000", "48999", "4820", "", "Harris"]) await expectInvalid(() => confirmSelectedCounty(bad, "77002"), "county");
  });
});
