import { describe, expect, it } from "vitest";
import type { VerificationRow } from "./internal";
import { centsToUsd, toApiVerification } from "./serialize";
import { renderCertification } from "./copy";

/** A SYNTHETIC verification row with everything a decided row carries. */
function row(over: Partial<VerificationRow> = {}): VerificationRow {
  const at = new Date("2026-11-18T16:00:00.000Z");
  return {
    id: "ver_SYNTHETIC000000000000001",
    orgId: "org_SYNTHETIC",
    mode: "test",
    status: "eligible",
    stage: "decided",
    method: "direct",
    pathPreference: "upload",
    externalRef: "SYN-1",
    applicantEmail: "dana@example.com",
    applicantName: "Dana Sample",
    studentFirstName: "Riley",
    studentLastName: "Sample",
    metadata: { cohort: "2027" },
    returnUrl: "https://sgo.example.org/done",
    createdByType: "api_key",
    createdById: "key_1",
    familyTokenHash: "a".repeat(64),
    familyTokenExpiresAt: at,
    locale: "en",
    startedAt: at,
    startedByUserId: "usr_1",
    flags: [],
    householdId: "hh_1",
    consentId: "con_1",
    consentVersion: "verification_share.v1",
    consentGrantedAt: at,
    householdCompletedAt: at,
    handoffId: null,
    passportSourceId: null,
    passportSourceDecidedAt: null,
    evidenceCopiedFromId: null,
    passportSourceRecordSha256: null,
    familyRequest: null,
    studentMemberIds: ["hm_riley"],
    custody: { livesInMultipleHouseholds: false },
    applicationDate: "2026-11-18",
    incomeYear: 2025,
    householdSize: 2,
    countyFips: "48427",
    countyName: "Starr County",
    hudAreaCode: "NCNTY48427N48427",
    areaName: "Starr County, TX",
    medianIncomeCents: 3_870_000,
    thresholdCents: 9_288_000,
    thresholdSource: "hud_provisional",
    thresholdTableVersion: "hud-fy2026-tx",
    thresholdEffectiveDate: "2026-05-01",
    incomeCapPct: 300,
    householdIncomeCents: 4_125_000,
    awardProgram: null,
    awardLetterDate: null,
    provisional: true,
    decision: { threshold: { readings: [{ id: "median_product", thresholdCents: 9_288_000 }, { id: "section8_vli", thresholdCents: 20_088_000 }, { id: "broken" }] } },
    decisionReasons: [{ code: "direct_income_within_limit", message: "Household income is within the limit." }],
    decidedAt: at,
    decidedBy: "engine",
    expiresAt: new Date("2027-01-01T06:00:00.000Z"),
    evidencePdfObjectId: "obj_pdf",
    evidenceJsonObjectId: "obj_json",
    submittedAt: at,
    canceledAt: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

describe("centsToUsd", () => {
  it("formats integer cents as a dollar decimal string without floating point", () => {
    expect(centsToUsd(0)).toBe("0.00");
    expect(centsToUsd(5)).toBe("0.05");
    expect(centsToUsd(31_200_000)).toBe("312000.00");
    expect(centsToUsd(12_538_801)).toBe("125388.01");
    expect(centsToUsd(-150)).toBe("-1.50");
    expect(centsToUsd(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(() => centsToUsd(1.5)).toThrow();
  });
});

describe("toApiVerification", () => {
  it("returns the public shape with every reading and evidence URL, and nothing personal", () => {
    const api = toApiVerification(row(), { baseUrl: "https://app.example.org/" });
    expect(api).toEqual({
      id: "ver_SYNTHETIC000000000000001",
      object: "verification",
      mode: "test",
      status: "eligible",
      stage: "decided",
      method: "direct",
      household_size: 2,
      area: { county_fips: "48427", county_name: "Starr County", hud_area_code: "NCNTY48427N48427", hud_area_name: "Starr County, TX" },
      threshold_usd: "92880.00",
      threshold_readings: [
        { id: "median_product", usd: "92880.00" },
        { id: "section8_vli", usd: "200880.00" },
      ],
      threshold_source: "hud_provisional",
      threshold_table_version: "hud-fy2026-tx",
      threshold_effective_date: "2026-05-01",
      provisional: true,
      income_year: 2025,
      award_program: null,
      award_letter_date: null,
      reasons: [{ code: "direct_income_within_limit", message: "Household income is within the limit." }],
      evidence_pack_url: "https://app.example.org/api/v1/verifications/ver_SYNTHETIC000000000000001/evidence.pdf",
      evidence_json_url: "https://app.example.org/api/v1/verifications/ver_SYNTHETIC000000000000001/evidence.json",
      consent: { version: "verification_share.v1", granted_at: "2026-11-18T16:00:00.000Z" },
      expires_at: "2027-01-01T06:00:00.000Z",
      decided_at: "2026-11-18T16:00:00.000Z",
      decided_by: "engine",
      passport: null,
      external_ref: "SYN-1",
      metadata: { cohort: "2027" },
      created_at: "2026-11-18T16:00:00.000Z",
    });
    const json = JSON.stringify(api);
    for (const secret of ["dana@example.com", "Dana", "Riley", "4125000", "41250", "hh_1", "a".repeat(64), "https://sgo.example.org/done"]) expect(json).not.toContain(secret);
  });

  it("an undecided row has nulls, a reviewer decision says reviewer, a passport reuse says so", () => {
    const pending = toApiVerification(
      row({ status: "pending", stage: "created", method: null, decision: null, decidedAt: null, decidedBy: null, thresholdCents: null, countyFips: null, consentVersion: null, consentGrantedAt: null, evidencePdfObjectId: null, evidenceJsonObjectId: null, expiresAt: null }),
      { baseUrl: "https://app.example.org" },
    );
    expect(pending).toMatchObject({ method: null, area: null, threshold_usd: null, threshold_readings: [], consent: null, decided_by: null, evidence_pack_url: null, expires_at: null });
    expect(toApiVerification(row({ decidedBy: "usr_reviewer" }), { baseUrl: "https://x.example" }).decided_by).toBe("reviewer");
    const reused = toApiVerification(row({ passportSourceId: "ver_src", passportSourceDecidedAt: new Date("2026-09-01T12:00:00.000Z") }), { baseUrl: "https://x.example" });
    expect(reused.passport).toEqual({ reused: true, source_decided_at: "2026-09-01T12:00:00.000Z" });
  });
});

describe("renderCertification", () => {
  const vars = { signerName: "Dana  Sample", memberName: "Sam Sample", incomeYear: 2025, organizationName: "Synthetic Fund" };

  it("renders versioned words deterministically, in English and Spanish, with a stable hash", () => {
    const a = renderCertification("zero_income", "en", vars);
    const b = renderCertification("zero_income", "en", { ...vars });
    expect(a.sha256).toBe(b.sha256);
    expect(a.version).toBe("income_certification.v1");
    expect(a.text).toContain("Dana Sample");
    expect(a.text).toContain("no income of any kind in 2025");
    expect(a.text).toContain("under the proposed rules");
    expect(a.vars).toEqual({ signerName: "Dana Sample", memberName: "Sam Sample", incomeYear: 2025, organizationName: "Synthetic Fund" });
    const es = renderCertification("zero_income", "es", vars);
    expect(es.text).toContain("no tuvo ingresos de ningún tipo en 2025");
    expect(es.sha256).not.toBe(a.sha256);
    // Re-rendering from the stored vars reproduces the hash.
    expect(renderCertification("zero_income", "en", a.vars as never, { version: a.version }).sha256).toBe(a.sha256);
  });

  it("household-wide no-other-income needs no member; zero income always does; bad input is refused", () => {
    const household = renderCertification("no_other_income", "en", { signerName: "Dana Sample", incomeYear: 2025, organizationName: "Synthetic Fund" });
    expect(household.text).toContain("no one who lives with the student");
    expect(() => renderCertification("zero_income", "en", { signerName: "Dana Sample", incomeYear: 2025, organizationName: "Synthetic Fund" })).toThrow();
    expect(() => renderCertification("zero_income", "en", { ...vars, incomeYear: 25 })).toThrow();
    expect(() => renderCertification("zero_income", "en", { ...vars, signerName: "   " })).toThrow();
    expect(() => renderCertification("zero_income", "fr" as never, vars)).toThrow();
    expect(() => renderCertification("zero_income", "en", vars, { version: "income_certification.v0" })).toThrow();
    expect(renderCertification("zero_income", "en", { ...vars, memberName: "Sam\nSample" }).text).toContain("Sam Sample");
  });
});
