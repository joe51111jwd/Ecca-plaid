import { parseCsvRecords } from "@/lib/csv";
import { computeThreshold } from "./compute";
import { MAX_TABULATED_FAMILY_SIZE } from "./constants";
import type { AmiTable } from "./types";

/**
 * Independent re-read of an IRS transcription CSV against an installed table, for the test suite.
 *
 * It deliberately does not use the ingest: it reads the CSV with its own few lines and its own arithmetic
 * and asks the engine for every county and household size 1 to 8, so a defect in the ingest cannot hide
 * behind itself. Returns one line per mismatch; an empty list means the table is the transcription.
 */
export function transcriptionMismatches(table: AmiTable, csvText: string): string[] {
  const mismatches: string[] = [];
  const seen = new Set<string>();

  const toCents = (text: string): bigint | null => {
    const match = /^(\d+)(?:\.(\d{2}))?$/.exec(text.trim());
    return match ? BigInt(match[1]) * 100n + BigInt(match[2] ?? "0") : null;
  };

  for (const record of parseCsvRecords(csvText)) {
    const fipsCodes = (record.county_fips ?? "").split(";").map((code) => code.trim());
    for (const fips of fipsCodes) {
      if (seen.has(fips)) mismatches.push(`${fips}: listed more than once in the transcription`);
      seen.add(fips);
      for (let size = 1; size <= MAX_TABULATED_FAMILY_SIZE; size++) {
        const expected = toCents(record[`limit_${size}`] ?? "");
        let actual: bigint | null = null;
        try {
          actual = BigInt(computeThreshold(table, { countyFips: fips, householdSize: size }).thresholdCents);
        } catch {
          actual = null;
        }
        if (expected === null || actual === null || expected !== actual) {
          mismatches.push(`${fips} household of ${size}: transcription ${record[`limit_${size}`] ?? "(missing)"}, table ${actual === null ? "(no limit)" : `${actual} cents`}`);
        }
      }
      const increment = (record.additional_person_increment ?? "").trim();
      if (increment !== "") {
        const expected = toCents(record[`limit_${MAX_TABULATED_FAMILY_SIZE}`] ?? "");
        const step = toCents(increment);
        let actual: bigint | null = null;
        try {
          actual = BigInt(computeThreshold(table, { countyFips: fips, householdSize: MAX_TABULATED_FAMILY_SIZE + 3 }).thresholdCents);
        } catch {
          actual = null;
        }
        if (expected === null || step === null || actual === null || expected + 3n * step !== actual) {
          mismatches.push(`${fips} household of ${MAX_TABULATED_FAMILY_SIZE + 3}: transcription increment ${increment}, table ${actual === null ? "(no limit)" : `${actual} cents`}`);
        }
      }
    }
  }
  for (const fips of table.countyByFips.keys()) {
    if (!seen.has(fips)) mismatches.push(`${fips}: in the table but not in the transcription`);
  }
  return mismatches;
}
