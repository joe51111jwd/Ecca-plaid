/**
 * Geography service: a household's typed address → Texas county → HUD income-limit area, with a record
 * of how the county was determined (households.countyResolution).
 *
 * Order of trust: a Census Geocoder match in Texas, then a ZIP whose ZCTA lies entirely in one Texas
 * county, then the family's own choice from a candidate list. The largest ZIP share is never
 * auto-picked: a wrong county is a wrong income limit.
 *
 * The Census Geocoder needs no API key. Addresses are sent to it only at run time for a household
 * that asked to be verified.
 */
import { z } from "zod";
import { getCounty, listCounties, type AmiCounty } from "@/engine/ami";
import {
  buildCensusGeocoderUrl,
  candidateCountiesForZip,
  normalizeZip,
  parseCensusGeocoderResponse,
  resolveCountyFromZip,
  type CountyCandidate,
  type GeocoderResult,
} from "@/engine/geo";
import type { CountyResolution } from "@/db/schema/verification";
import { AppError, invalid } from "@/lib/errors";

/** Policy: how long one geocoder attempt may take before it is abandoned. */
export const GEOCODER_TIMEOUT_MS = 8_000;
/** Policy: attempts per address (the first try plus one retry on timeout, network error or HTTP 5xx). */
export const GEOCODER_MAX_ATTEMPTS = 2;

export const TEXAS_ONLY_MESSAGE =
  "Right now we can only verify households that live in Texas. Please check the state and ZIP code in your address.";

export interface GeoServiceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type GeocodeFailureReason = "no_match" | "timeout" | "network_error" | "http_error" | "invalid_response";

export type GeocodeOutcome = (GeocoderResult & { matched: true }) | (GeocoderResult & { matched: false; reason: GeocodeFailureReason });

export interface HudAreaRef {
  code: string;
  name: string;
}

export interface ResolvedCounty {
  countyFips: string;
  countyName: string;
  resolution: Extract<CountyResolution, "geocoder" | "zip_unique">;
  hudArea: HudAreaRef;
  /** The address the geocoder matched, when resolution is "geocoder" (kept for the reviewer). */
  matchedAddress?: string;
}

export type SelectionReason = "zip_ambiguous" | "zip_unknown";

export interface NeedsCountySelection {
  needsSelection: true;
  /** ZIP candidates (largest land share first), or all Texas counties alphabetically when the ZIP is unknown. */
  candidates: CountyCandidate[];
  reason: SelectionReason;
  /** Share of the ZIP area outside Texas, basis points (0 when none or unknown). */
  outsideTexasBps: number;
  /** Why the geocoder did not settle it. */
  geocoder: { matched: boolean; reason?: GeocodeFailureReason | "outside_texas" };
}

export type HouseholdCountyResolution = ResolvedCounty | NeedsCountySelection;

export interface ConfirmedCounty {
  countyFips: string;
  countyName: string;
  resolution: Extract<CountyResolution, "self_selected">;
  hudArea: HudAreaRef;
  /** true when the chosen county is one of the ZIP's candidates; false when not; null when the ZIP is unknown. */
  matchesZip: boolean | null;
  zipCandidates: CountyCandidate[];
}

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Enter your street address").max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1, "Enter your city").max(100),
  state: z.string().trim().min(1, "Enter your state").max(40),
  zip: z.string().trim().min(1, "Enter your ZIP code").max(10),
});

export type HouseholdAddressInput = z.input<typeof addressSchema>;

function isTexasState(state: string): boolean {
  const s = state.trim().replace(/\./g, "").toLowerCase();
  return s === "tx" || s === "texas";
}

function hudAreaOf(county: AmiCounty): HudAreaRef {
  return { code: county.areaCode, name: county.areaName };
}

function requireAmiCounty(fips: string): AmiCounty {
  const county = getCounty(fips);
  if (!county) throw new AppError("internal", `County ${fips} is not in the income-limit table`);
  return county;
}

function validateAddress(address: HouseholdAddressInput): { line1: string; city: string; state: string; zip: string } {
  const parsed = addressSchema.safeParse(address);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "address");
      fields[key] ??= issue.message;
    }
    throw invalid("Please check your address.", { fields });
  }
  const zip = normalizeZip(parsed.data.zip);
  if (!zip) throw invalid("Please check your address.", { fields: { zip: "Enter a 5-digit ZIP code" } });
  if (!isTexasState(parsed.data.state)) throw invalid(TEXAS_ONLY_MESSAGE, { fields: { state: TEXAS_ONLY_MESSAGE } });
  return { line1: parsed.data.line1, city: parsed.data.city, state: "TX", zip };
}

type AttemptResult = { kind: "ok"; json: unknown } | { kind: "retryable"; reason: GeocodeFailureReason } | { kind: "final"; reason: GeocodeFailureReason };

async function attempt(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<AttemptResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (res.status >= 500) return { kind: "retryable", reason: "http_error" };
    if (!res.ok) return { kind: "final", reason: "http_error" };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return timedOut ? { kind: "retryable", reason: "timeout" } : { kind: "final", reason: "invalid_response" };
    }
    return { kind: "ok", json };
  } catch {
    return { kind: "retryable", reason: timedOut ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up an address with the Census Geocoder. Never throws on network or service failure: returns
 * `{ matched: false, reason }`. One retry on timeout, network error or HTTP 5xx.
 */
export async function geocodeAddress(
  address: { line1: string; city: string; state: string; zip: string },
  opts: GeoServiceOptions = {},
): Promise<GeocodeOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? GEOCODER_TIMEOUT_MS;
  const url = buildCensusGeocoderUrl(address);
  let reason: GeocodeFailureReason = "network_error";
  for (let i = 0; i < GEOCODER_MAX_ATTEMPTS; i++) {
    const r = await attempt(url, fetchImpl, timeoutMs);
    if (r.kind === "ok") {
      const parsed = parseCensusGeocoderResponse(r.json);
      if (parsed.matched) return { ...parsed, matched: true };
      const recognised = typeof r.json === "object" && r.json !== null && "result" in r.json;
      return { ...parsed, matched: false, reason: recognised && parsed.matchCount === 0 ? "no_match" : "invalid_response" };
    }
    reason = r.reason;
    if (r.kind === "final") break;
  }
  return { matched: false, reason };
}

function allTexasCounties(): CountyCandidate[] {
  return listCounties()
    .map((c) => ({ fips: c.fips, name: c.name }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Determine a household's county from its address. Throws AppError validation_failed for an incomplete
 * address or one outside Texas (v1 serves Texas households only). Never throws on geocoder failure.
 */
export async function resolveHouseholdCounty(address: HouseholdAddressInput, opts: GeoServiceOptions = {}): Promise<HouseholdCountyResolution> {
  const addr = validateAddress(address);
  const geo = await geocodeAddress(addr, opts);

  let geocoderNote: NeedsCountySelection["geocoder"];
  if (geo.matched && geo.stateFips === "48" && geo.countyFips) {
    const county = requireAmiCounty(geo.countyFips);
    return {
      countyFips: county.fips,
      countyName: county.name,
      resolution: "geocoder",
      hudArea: hudAreaOf(county),
      ...(geo.matchedAddress ? { matchedAddress: geo.matchedAddress } : {}),
    };
  } else if (geo.matched) {
    geocoderNote = { matched: true, reason: "outside_texas" };
  } else {
    geocoderNote = { matched: false, reason: geo.reason };
  }

  const byZip = resolveCountyFromZip(addr.zip);
  if (byZip.kind === "unique") {
    const county = requireAmiCounty(byZip.fips);
    return { countyFips: county.fips, countyName: county.name, resolution: "zip_unique", hudArea: hudAreaOf(county) };
  }
  if (byZip.kind === "ambiguous") {
    return { needsSelection: true, candidates: byZip.candidates, reason: "zip_ambiguous", outsideTexasBps: byZip.outsideTexasBps, geocoder: geocoderNote };
  }
  // The geocoder placed the address outside Texas and the ZIP is not a Texas ZCTA: not a Texas household.
  if (geocoderNote.reason === "outside_texas") throw invalid(TEXAS_ONLY_MESSAGE, { fields: { state: TEXAS_ONLY_MESSAGE } });
  return { needsSelection: true, candidates: allTexasCounties(), reason: "zip_unknown", outsideTexasBps: 0, geocoder: geocoderNote };
}

/**
 * Validate a county the family picked themselves and report whether it agrees with their ZIP, so the UI
 * and the reviewer can flag "county chosen does not match ZIP". Throws validation_failed for a code that
 * is not a Texas county.
 */
export function confirmSelectedCounty(fips: string, zip?: string | null): ConfirmedCounty {
  const code = typeof fips === "string" ? fips.trim() : "";
  const county = /^48\d{3}$/.test(code) ? getCounty(code) : null;
  if (!county) throw invalid("Please choose a Texas county from the list.", { fields: { county: "Choose a Texas county" } });
  const zipCandidates = zip ? candidateCountiesForZip(zip) : [];
  const matchesZip = zipCandidates.length === 0 ? null : zipCandidates.some((c) => c.fips === county.fips);
  return { countyFips: county.fips, countyName: county.name, resolution: "self_selected", hudArea: hudAreaOf(county), matchesZip, zipCandidates };
}
