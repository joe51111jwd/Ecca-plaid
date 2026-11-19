import { describe, expect, it } from "vitest";
import { isAppError } from "@/lib/errors";
import { parseCsv } from "@/lib/csv";
import type { ApiVerification } from "@/server/verifications";
import { buildVerificationsCsv, parseCsvColumns, STANDARD_CSV_COLUMNS } from "./csv-export";
import { EXAMPLE_DECIDED_VERIFICATION, EXAMPLE_PENDING_VERIFICATION } from "./examples";

const decided = EXAMPLE_DECIDED_VERIFICATION as unknown as ApiVerification;
const pending = EXAMPLE_PENDING_VERIFICATION as unknown as ApiVerification;

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    return isAppError(e) ? e.code : "thrown";
  }
}

describe("CSV export columns", () => {
  it("defaults to every standard column, named as itself", () => {
    const cols = parseCsvColumns(undefined);
    expect(cols.map((c) => c.header)).toEqual(STANDARD_CSV_COLUMNS);
    expect(parseCsvColumns("  ").map((c) => c.key)).toEqual(STANDARD_CSV_COLUMNS);
  });

  it("renders every standard column from a decided verification", () => {
    const rows = parseCsv(buildVerificationsCsv([decided, pending], parseCsvColumns(undefined)));
    const header = rows[0];
    const row = Object.fromEntries(header.map((h, i) => [h, rows[1][i]]));
    expect(row).toMatchObject({
      id: decided.id,
      status: "eligible",
      method: "direct",
      household_size: "4",
      county_fips: "48999",
      threshold_usd: "100000.00",
      threshold_readings: "median_product=100000.00;section8_vli=105000.00",
      threshold_source: "hud_provisional",
      provisional: "true",
      consent_version: "verification_share.v1",
      passport_reused: "false",
      reasons: "",
    });
    const empty = Object.fromEntries(header.map((h, i) => [h, rows[2][i]]));
    expect(empty).toMatchObject({ county_fips: "", threshold_usd: "", consent_granted_at: "", threshold_readings: "" });
  });

  it("splits labels at the first colon only and trims", () => {
    const cols = parseCsvColumns(" status : Result: final ,id");
    expect(cols.map((c) => [c.key, c.header])).toEqual([
      ["status", "Result: final"],
      ["id", "id"],
    ]);
  });

  it("refuses prototype keys and other unknown names", () => {
    for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty", "metadata", "metadata.", "metadata.a b"]) expect(codeOf(() => parseCsvColumns(bad)), bad).toBe("validation_failed");
  });

  it("reads metadata safely: an inherited name is not a value", () => {
    const cols = parseCsvColumns("metadata.campus,metadata.constructor");
    expect(parseCsv(buildVerificationsCsv([pending], cols, { header: false }))).toEqual([["north", ""]]);
  });

  it("writes CRLF line ends and nothing for an empty headerless export", () => {
    expect(buildVerificationsCsv([pending], parseCsvColumns("id"))).toBe(`id\r\n${pending.id}\r\n`);
    expect(buildVerificationsCsv([], parseCsvColumns("id"), { header: false })).toBe("");
  });
});
