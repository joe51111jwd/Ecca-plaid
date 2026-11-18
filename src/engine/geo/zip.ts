/**
 * ZIP → candidate Texas counties, from the compiled Census ZCTA relationship dataset.
 *
 * A ZCTA approximates a USPS ZIP code (PO-box-only ZIPs are absent, boundaries differ), so a ZIP is
 * only ever a candidate list. "unique" is returned only when the ZCTA lies entirely in one Texas
 * county; the largest share is never auto-picked, because a wrong county is a wrong income limit.
 */
import { z } from "zod";
import { getCounty, type AmiTable } from "@/engine/ami";
import { AppError } from "@/lib/errors";
import rawDataset from "../../../data/geo/tx-zcta-county.json";
import type { CountyCandidate, ZctaCountyDataset, ZipResolution } from "./types";

const datasetSchema = z.object({
  source: z.object({ url: z.url(), retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  zctas: z.record(
    z.string().regex(/^\d{5}$/),
    z.array(z.object({ fips: z.string().regex(/^48\d{3}$/), landShare: z.number().int().min(0).max(10_000) })).min(1),
  ),
  crossState: z.record(z.string().regex(/^\d{5}$/), z.number().int().min(0).max(10_000)),
});

let cached: ZctaCountyDataset | null = null;

/** The compiled dataset, validated on first use. */
export function zctaDataset(): ZctaCountyDataset {
  cached ??= datasetSchema.parse(rawDataset);
  return cached;
}

/**
 * USPS three-digit ZIP prefixes assigned to Texas (750–799, 733, 885). Policy constant used only to
 * phrase messages ("looks like a Texas ZIP we could not place" vs "not a Texas ZIP"); it never
 * decides a county.
 */
export const TEXAS_ZIP3_PREFIXES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 50 }, (_, i) => String(750 + i)),
  "733",
  "885",
]);

/** Accepts "78701", " 78701 ", "78701-1234", "787011234". Returns the 5-digit ZIP or null. */
export function normalizeZip(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const m = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(input);
  return m ? m[1]! : null;
}

/** True when the ZIP is a Texas ZCTA or carries a Texas USPS prefix. Not proof of Texas residence. */
export function isTexasZipCandidate(zip: string): boolean {
  const z5 = normalizeZip(zip);
  if (!z5) return false;
  return z5 in zctaDataset().zctas || TEXAS_ZIP3_PREFIXES.has(z5.slice(0, 3));
}

/** Texas counties a ZIP's ZCTA overlaps, largest land share first. Empty when unknown. */
export function candidateCountiesForZip(zip: string, table?: AmiTable): CountyCandidate[] {
  const z5 = normalizeZip(zip);
  if (!z5) return [];
  const parts = zctaDataset().zctas[z5];
  if (!parts) return [];
  return parts.map((p) => {
    const county = getCounty(p.fips, table);
    // The dataset test asserts every FIPS is in the AMI list; reaching this means a stale table.
    if (!county) throw new AppError("internal", `County ${p.fips} from the ZCTA dataset is not in the AMI county list`);
    return { fips: p.fips, name: county.name, landShareBps: p.landShare };
  });
}

export function resolveCountyFromZip(zip: string, table?: AmiTable): ZipResolution {
  const z5 = normalizeZip(zip);
  if (!z5) return { kind: "unknown" };
  const candidates = candidateCountiesForZip(z5, table);
  if (candidates.length === 0) return { kind: "unknown" };
  const outsideTexasBps = zctaDataset().crossState[z5] ?? 0;
  if (candidates.length === 1 && outsideTexasBps === 0) return { kind: "unique", fips: candidates[0]!.fips };
  return { kind: "ambiguous", candidates, outsideTexasBps };
}
