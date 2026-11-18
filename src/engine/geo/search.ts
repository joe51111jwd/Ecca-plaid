/**
 * County type-ahead over the AMI county list. Matching ignores case, diacritics, spaces and
 * punctuation and an optional trailing "County", so "De Witt", "dewitt county", "Mc Lennan" and
 * "la salle" all find their county.
 */
import { listCounties, type AmiTable } from "@/engine/ami";
import type { CountyCandidate } from "./types";

export const DEFAULT_COUNTY_SEARCH_LIMIT = 10;

/** Comparable key for a county name or query: lowercase ASCII letters and digits only, without "county". */
export function normalizeCountyName(input: string): string {
  const folded = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/(?:^|\s)county$/, "");
  return folded.replace(/\s+/g, "");
}

/**
 * Counties whose name starts with the query (alphabetical), then counties whose name contains it
 * (alphabetical). A 5-digit Texas FIPS code matches its county exactly. Empty query → [].
 */
export function searchCounties(query: string, options: { limit?: number; table?: AmiTable } = {}): CountyCandidate[] {
  const limit = options.limit ?? DEFAULT_COUNTY_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) return [];
  const counties = listCounties(options.table);
  const trimmed = query.trim();
  if (/^\d{5}$/.test(trimmed)) {
    const hit = counties.find((c) => c.fips === trimmed);
    return hit ? [{ fips: hit.fips, name: hit.name }] : [];
  }
  const q = normalizeCountyName(trimmed);
  if (q === "") return [];
  const ranked: { rank: number; key: string; fips: string; name: string }[] = [];
  for (const c of counties) {
    const key = normalizeCountyName(c.name);
    const rank = key.startsWith(q) ? 0 : key.includes(q) ? 1 : -1;
    if (rank >= 0) ranked.push({ rank, key, fips: c.fips, name: c.name });
  }
  ranked.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ranked.slice(0, limit).map(({ fips, name }) => ({ fips, name }));
}
