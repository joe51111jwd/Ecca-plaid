import { sha256Hex } from "@/lib/crypto";
import type { EvidenceDocumentInput, EvidenceInput, EvidenceThresholdInput } from "./types";

/**
 * SYNTHETIC sample inputs for tests, demos and seed data.
 *
 * Every person, organization, identifier, file, hash and amount of income in this file is invented. No real
 * family's documents were used. The only real-world figures are the published HUD FY 2026 numbers for the two
 * counties (copied from the installed table `hud-fy2026-tx`), so that the samples show realistic arithmetic.
 */

/** A stable, obviously derived stand-in for a file hash. */
export function syntheticSha256(label: string): string {
  return sha256Hex(`synthetic evidence fixture: ${label}`);
}

const PROVISIONAL_LABEL = {
  copyVersion: "threshold-source-copy.v2",
  badge: "Provisional",
  limitLabel: "Provisional income limit (HUD-derived)",
  sourceLine: "Provisional, HUD-derived limit computed from HUD FY 2026 area median family income (effective May 1, 2026). This is not an IRS-published limit.",
  explanation:
    "This income limit is provisional. It is computed from the HUD FY 2026 area median family income (effective May 1, 2026) and the HUD family-size adjustment, " +
    "using the calculation described in the notice of proposed rulemaking (REG-117199-25): 300 percent of area median gross income multiplied by the family-size multiplier. " +
    "The proposed rules are not final. This is not an IRS-published limit. The IRS has said it anticipates publishing the applicable limits by geographic area and family size in the Internal Revenue Bulletin; " +
    "IRS-published limits replace this provisional figure once they are in use. Table version: hud-fy2026-tx.",
  readingsNote:
    "The proposed rule can be read two ways: 300 percent of HUD's area median income times the family-size multiplier, or six times HUD's Section 8 very-low-income limit for the family size. " +
    "Which one the IRS will use is not yet known. Where the two give different limits, automatic decisions use the lower figure to approve and the higher figure to decline; incomes in between are reviewed by a person.",
} as const;

const READING_LABEL = {
  median_product: "Area median income x family-size multiplier (the worked example in the proposed rule's economic analysis)",
  section8_vli: "6 x HUD's Section 8 very-low-income limit (a reading of the proposed regulation text)",
} as const;

/** Harris County, household of four: both readings give $312,000.00. */
export function syntheticHarrisThreshold(): EvidenceThresholdInput {
  return {
    thresholdCents: 31_200_000,
    statutoryThresholdCents: 31_200_000,
    medianIncomeCents: 10_400_000,
    multiplier: "1.00",
    capPct: 300,
    source: "hud_provisional",
    tableVersion: "hud-fy2026-tx",
    effectiveDate: "2026-05-01",
    method: "hud_median_x_cap_pct_x_family_size_multiplier_v1",
    formula: "300% x $104,000 area median income x 1.00 family-size multiplier (4 persons) = $312,000.00",
    provisional: true,
    label: { ...PROVISIONAL_LABEL },
    readings: [
      {
        id: "median_product",
        label: READING_LABEL.median_product,
        thresholdCents: 31_200_000,
        statutoryThresholdCents: 31_200_000,
        formula: "300% x $104,000 area median income x 1.00 family-size multiplier (4 persons) = $312,000.00",
      },
      {
        id: "section8_vli",
        label: READING_LABEL.section8_vli,
        thresholdCents: 31_200_000,
        statutoryThresholdCents: 31_200_000,
        formula: "6 x $52,000 HUD very-low-income limit (4 persons) = $312,000.00",
      },
    ],
    lowerBoundCents: 31_200_000,
    upperBoundCents: 31_200_000,
    readingsAgree: true,
  };
}

/** Starr County, household of five: the two readings differ ($125,388.00 and $271,200.00). */
export function syntheticStarrThreshold(): EvidenceThresholdInput {
  return {
    thresholdCents: 12_538_800,
    statutoryThresholdCents: 12_538_800,
    medianIncomeCents: 3_870_000,
    multiplier: "1.08",
    capPct: 300,
    source: "hud_provisional",
    tableVersion: "hud-fy2026-tx",
    effectiveDate: "2026-05-01",
    method: "hud_median_x_cap_pct_x_family_size_multiplier_v1",
    formula: "300% x $38,700 area median income x 1.08 family-size multiplier (5 persons) = $125,388.00",
    provisional: true,
    label: { ...PROVISIONAL_LABEL },
    readings: [
      {
        id: "median_product",
        label: READING_LABEL.median_product,
        thresholdCents: 12_538_800,
        statutoryThresholdCents: 12_538_800,
        formula: "300% x $38,700 area median income x 1.08 family-size multiplier (5 persons) = $125,388.00",
      },
      {
        id: "section8_vli",
        label: READING_LABEL.section8_vli,
        thresholdCents: 27_120_000,
        statutoryThresholdCents: 27_120_000,
        formula: "6 x $45,200 HUD very-low-income limit (5 persons) = $271,200.00",
      },
    ],
    lowerBoundCents: 12_538_800,
    upperBoundCents: 27_120_000,
    readingsAgree: false,
  };
}

/**
 * A made-up IRS-published limit, for exercising the non-provisional layout only. The IRS has not published a
 * limitation table; the amount, citation and dates here are placeholders and must never be shown as real.
 */
export function syntheticIrsPublishedThreshold(): EvidenceThresholdInput {
  return {
    thresholdCents: 30_000_000,
    statutoryThresholdCents: 30_000_000,
    medianIncomeCents: null,
    multiplier: null,
    capPct: 300,
    source: "irs_published",
    tableVersion: "synthetic-irs-table",
    effectiveDate: "2027-01-01",
    method: "irs_published_limit_by_family_size_v1",
    formula: "Synthetic published limit for 4 persons = $300,000.00",
    provisional: false,
    label: {
      copyVersion: "threshold-source-copy.synthetic",
      badge: "IRS-published",
      limitLabel: "Income limit (IRS-published)",
      sourceLine: "IRS-published limit (SYNTHETIC CITATION), effective January 1, 2027.",
      explanation: "SYNTHETIC TEXT. This income limit is taken from a limitation table for the household's geographic area and family size. Table version: synthetic-irs-table.",
      readingsNote: null,
    },
    readings: [{ id: "irs_published", label: "IRS-published limit", thresholdCents: 30_000_000, statutoryThresholdCents: 30_000_000, formula: "Synthetic published limit for 4 persons = $300,000.00" }],
    lowerBoundCents: 30_000_000,
    upperBoundCents: 30_000_000,
    readingsAgree: true,
  };
}

const SYNTHETIC_SGO = { id: "org_SYNTHETICsgo0000000001", name: "Synthetic Sample Scholarship Fund (not a real organization)", ein: "00-0000000" } as const;

/** Sample 1: categorical method, eligible, decided by the engine, test mode. */
export function syntheticCategoricalEligibleInput(): EvidenceInput {
  return {
    verificationId: "ver_SYNTHETICcategorical01",
    mode: "test",
    sgo: { ...SYNTHETIC_SGO },
    externalRef: "SYNTHETIC-APP-0001",
    decision: {
      status: "eligible",
      method: "categorical",
      reasons: [{ code: "categorical_approval_current", message: "An award letter dated within the last 12 months shows current SNAP approval for a household member." }],
      decidedAt: "2027-01-12T16:20:31.000Z",
      decidedBy: { type: "engine" },
      applicationDate: "2027-01-11",
      incomeYear: 2026,
      expiresAt: "2027-08-14T05:00:00.000Z",
    },
    household: {
      id: "hh_SYNTHETIChousehold00001",
      size: 4,
      members: [
        { id: "hm_SYNTHETICmember000001", role: "student", firstName: "Sofía", lastName: "Peña", relationship: "Self" },
        { id: "hm_SYNTHETICmember000002", role: "adult", firstName: "María", lastName: "Peña", relationship: "Mother" },
        { id: "hm_SYNTHETICmember000003", role: "adult", firstName: "José", lastName: "Peña", relationship: "Father" },
        { id: "hm_SYNTHETICmember000004", role: "child", firstName: "Lucía", lastName: "Peña", relationship: "Sister" },
      ],
      custody: { livesInMultipleHouseholds: false },
    },
    geography: {
      state: "TX",
      countyFips: "48201",
      countyName: "Harris County",
      areaCode: "METRO26420M26420",
      areaName: "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area",
      zip: "77002",
      countyResolution: "geocoder",
    },
    threshold: syntheticHarrisThreshold(),
    income: null,
    categorical: {
      program: "SNAP",
      letterDate: "2026-08-14",
      approvalStatus: "current",
      issuingAgency: "Synthetic State Benefits Agency",
      namedMemberId: "hm_SYNTHETICmember000002",
      benefitPeriodEnd: "2027-01-31",
      documentId: "doc_SYNTHETICawardletter01",
    },
    documents: [
      {
        id: "doc_SYNTHETICawardletter01",
        kind: "award_letter",
        sha256: syntheticSha256("SNAP award letter"),
        filename: "synthetic-snap-award-letter.pdf",
        sizeBytes: 184_233,
        contentType: "application/pdf",
        uploadedAt: "2027-01-11T18:02:11.000Z",
        extractedBy: "parser",
        memberId: "hm_SYNTHETICmember000002",
        extractedFields: [
          { key: "program", label: "Program", value: "SNAP", confidencePct: 99 },
          { key: "issuing_agency", label: "Issuing agency", value: "Synthetic State Benefits Agency", confidencePct: 97 },
          { key: "letter_date", label: "Letter date", value: "2026-08-14", confidencePct: 98 },
          { key: "approval_status", label: "Approval status", value: "Approved", confidencePct: 96 },
          { key: "certification_period_end", label: "Certification period ends", value: "2027-01-31", confidencePct: 95 },
          { key: "named_individual", label: "Individual named", value: "Household member M.P. (matched to the roster)", confidencePct: 93 },
        ],
      },
    ],
    rails: [],
    consent: {
      id: "con_SYNTHETICconsent000001",
      kind: "verification_share",
      copyVersion: "synthetic-consent-copy.v1",
      copySha256: syntheticSha256("verification_share consent text, Spanish"),
      locale: "es",
      grantedAt: "2027-01-11T17:55:42.000Z",
      grantedBy: "María Peña",
      scope: {
        recipient: SYNTHETIC_SGO.name,
        purpose: "Verify the household income requirement for a scholarship application",
        shared: ["decision", "method", "household size", "area and income limit", "document hashes and fields read"],
        retention: "Raw files are deleted after the retention window the SGO has set; the decision record and hashes are kept",
      },
    },
    reviewTrail: [],
    timeline: [
      { at: "2027-01-11T17:40:03.000Z", event: "Verification created", actor: { type: "api_key", id: "key_SYNTHETICapikey000001" } },
      { at: "2027-01-11T17:52:18.000Z", event: "Family opened the link", actor: { type: "family" } },
      { at: "2027-01-11T17:55:42.000Z", event: "Consent given", actor: { type: "family" }, detail: "Consent text version synthetic-consent-copy.v1, shown in Spanish" },
      { at: "2027-01-11T18:00:29.000Z", event: "Household form completed", actor: { type: "family" }, detail: "4 persons, Harris County" },
      { at: "2027-01-11T18:02:11.000Z", event: "Document uploaded", actor: { type: "family" }, detail: "doc_SYNTHETICawardletter01" },
      { at: "2027-01-11T18:03:40.000Z", event: "Submitted", actor: { type: "family" } },
      { at: "2027-01-12T16:20:28.000Z", event: "Document read", actor: { type: "system" }, detail: "Parser read 6 fields" },
      { at: "2027-01-12T16:20:31.000Z", event: "Decision made", actor: { type: "engine" }, detail: "eligible, categorical method" },
    ],
    generatedAt: "2027-01-12T16:20:35.000Z",
    versions: { engine: "synthetic-decision-engine-1.0.0", taxonomy: "synthetic-income-taxonomy-1", ruleSet: "25F_STATUTE + REG-117199-25_PROPOSED_2026-10-02" },
  };
}

/**
 * Sample 2: direct method, routed to review because a pay stub could not be read, resolved eligible by a
 * reviewer. Live mode. The two readings of the limit differ; income is below the lower one.
 */
export function syntheticDirectReviewedInput(): EvidenceInput {
  return {
    verificationId: "ver_SYNTHETICdirect0000001",
    mode: "live",
    sgo: { ...SYNTHETIC_SGO },
    externalRef: "SYNTHETIC-APP-0002",
    decision: {
      status: "eligible",
      method: "direct",
      reasons: [
        { code: "document_low_confidence", message: "A pay stub photo could not be read with enough confidence and was sent to a reviewer." },
        { code: "review_resolved_eligible", message: "A reviewer keyed the pay stub fields and confirmed that counted income is within the limit." },
      ],
      decidedAt: "2027-02-03T15:12:44.000Z",
      decidedBy: {
        type: "reviewer",
        reviewerId: "usr_SYNTHETICreviewer00001",
        reviewerName: "Riley Example (synthetic reviewer)",
        notes:
          "Pay stub photo is legible. Keyed year-to-date gross pay from the stub dated December 31, 2026. Employer name matches the payroll connection for the same adult. " +
          "Child support statement is on file; the family certified there is no other income.",
      },
      applicationDate: "2027-01-29",
      incomeYear: 2026,
      expiresAt: "2028-01-01T06:00:00.000Z",
    },
    household: {
      id: "hh_SYNTHETIChousehold00002",
      size: 5,
      members: [
        { id: "hm_SYNTHETICmember000011", role: "student", firstName: "Mateo", lastName: "Garza", relationship: "Self" },
        { id: "hm_SYNTHETICmember000012", role: "student", firstName: "Elena", lastName: "Garza", relationship: "Sister" },
        { id: "hm_SYNTHETICmember000013", role: "adult", firstName: "Ana", lastName: "Garza", relationship: "Mother" },
        { id: "hm_SYNTHETICmember000014", role: "adult", firstName: "Rubén", lastName: "Treviño", relationship: "Stepfather" },
        { id: "hm_SYNTHETICmember000015", role: "other", firstName: "Dolores", lastName: "Garza", relationship: "Grandmother" },
      ],
      custody: { livesInMultipleHouseholds: false },
    },
    geography: {
      state: "TX",
      countyFips: "48427",
      countyName: "Starr County",
      areaCode: "NCNTY48427N48427",
      areaName: "Starr County, TX",
      zip: "78582",
      countyResolution: "geocoder",
    },
    threshold: syntheticStarrThreshold(),
    income: {
      year: 2026,
      totalCountedCents: 8_425_037,
      items: [
        {
          id: "inc_SYNTHETICincome0000001",
          category: "wages",
          categoryLabel: "Wages and salaries",
          description: "Form W-2, box 1",
          memberId: "hm_SYNTHETICmember000013",
          annualAmountCents: 5_231_000,
          counted: true,
          basis: "Cash wages for the income year",
          source: "document",
          documentId: "doc_SYNTHETICw200000000001",
        },
        {
          id: "inc_SYNTHETICincome0000002",
          category: "wages",
          categoryLabel: "Wages and salaries",
          description: "Year-to-date gross pay on the final 2026 pay stub, keyed by a reviewer",
          memberId: "hm_SYNTHETICmember000014",
          annualAmountCents: 2_894_037,
          counted: true,
          basis: "Cash wages for the income year",
          source: "reviewer",
          documentId: "doc_SYNTHETICpaystub000001",
        },
        {
          id: "inc_SYNTHETICincome0000003",
          category: "child_support",
          categoryLabel: "Child support received",
          description: "Twelve monthly payments shown on the payment statement",
          memberId: "hm_SYNTHETICmember000013",
          annualAmountCents: 300_000,
          counted: true,
          basis: "Counted whether or not it is taxable",
          source: "document",
          documentId: "doc_SYNTHETICsupport000001",
        },
        {
          id: "inc_SYNTHETICincome0000004",
          category: "housing_assistance_non_cash",
          categoryLabel: "Housing assistance (non-cash)",
          description: "Housing assistance paid to the landlord",
          memberId: null,
          annualAmountCents: 720_000,
          counted: false,
          basis: "Non-cash item; not counted under the proposed rules",
          source: "self_reported",
        },
      ],
    },
    categorical: null,
    documents: [
      {
        id: "doc_SYNTHETICw200000000001",
        kind: "w2",
        sha256: syntheticSha256("Form W-2"),
        filename: "synthetic-w2-2026.pdf",
        sizeBytes: 96_412,
        contentType: "application/pdf",
        uploadedAt: "2027-01-29T20:14:02.000Z",
        extractedBy: "parser",
        memberId: "hm_SYNTHETICmember000013",
        extractedFields: [
          { key: "tax_year", label: "Tax year", value: "2026", confidencePct: 99 },
          { key: "employer_name", label: "Employer", value: "Synthetic Grocery Co.", confidencePct: 98 },
          { key: "wages_box_1", label: "Wages, tips, other compensation (box 1)", amountCents: 5_231_000, confidencePct: 99 },
        ],
      },
      {
        id: "doc_SYNTHETICpaystub000001",
        kind: "pay_stub",
        sha256: syntheticSha256("pay stub photo"),
        filename: "synthetic-pay-stub-photo.jpg",
        sizeBytes: 2_318_554,
        contentType: "image/jpeg",
        uploadedAt: "2027-01-29T20:16:47.000Z",
        extractedBy: "reviewer",
        memberId: "hm_SYNTHETICmember000014",
        purgedAt: "2027-03-05T09:00:00.000Z",
        extractedFields: [
          { key: "pay_date", label: "Pay date", value: "2026-12-31" },
          { key: "employer_name", label: "Employer", value: "Synthetic Ranch Supply LLC" },
          { key: "gross_pay_ytd", label: "Gross pay, year to date", amountCents: 2_894_037 },
        ],
      },
      {
        id: "doc_SYNTHETICsupport000001",
        kind: "other_income",
        sha256: syntheticSha256("child support payment statement"),
        filename: "synthetic-child-support-statement.pdf",
        sizeBytes: 58_120,
        contentType: "application/pdf",
        uploadedAt: "2027-01-29T20:18:30.000Z",
        extractedBy: "parser",
        memberId: "hm_SYNTHETICmember000013",
        extractedFields: [
          { key: "period", label: "Period covered", value: "January to December 2026", confidencePct: 94 },
          { key: "total_received", label: "Total received", amountCents: 300_000, confidencePct: 92 },
        ],
      },
    ],
    rails: [
      {
        id: "rail_SYNTHETICpayroll000001",
        provider: "simulated",
        kind: "payroll",
        reportSha256: syntheticSha256("payroll report"),
        connectedAt: "2027-01-29T20:21:09.000Z",
        retrievedAt: "2027-01-29T20:21:40.000Z",
        memberId: "hm_SYNTHETICmember000014",
        consentId: "con_SYNTHETICconsent000003",
      },
    ],
    consent: {
      id: "con_SYNTHETICconsent000002",
      kind: "verification_share",
      copyVersion: "synthetic-consent-copy.v1",
      copySha256: syntheticSha256("verification_share consent text, English"),
      locale: "en",
      grantedAt: "2027-01-29T20:05:51.000Z",
      grantedBy: "Ana Garza",
      scope: {
        recipient: SYNTHETIC_SGO.name,
        purpose: "Verify the household income requirement for a scholarship application",
        shared: ["decision", "method", "household size", "area and income limit", "income by category", "document hashes and fields read"],
        retention: "Raw files are deleted after the retention window the SGO has set; the decision record and hashes are kept",
      },
    },
    additionalConsents: [
      {
        id: "con_SYNTHETICconsent000003",
        kind: "rail_connect",
        copyVersion: "synthetic-rail-consent-copy.v1",
        copySha256: syntheticSha256("rail_connect consent text, English"),
        locale: "en",
        grantedAt: "2027-01-29T20:20:33.000Z",
        grantedBy: "Rubén Treviño",
        scope: { source: "Payroll data connection (simulated provider)", purpose: "Retrieve 2026 pay records for this verification only" },
      },
    ],
    reviewTrail: [
      {
        at: "2027-01-30T08:02:10.000Z",
        actor: { type: "engine" },
        action: "Sent to review",
        notes: "document_low_confidence: pay stub photo could not be read with enough confidence",
      },
      {
        at: "2027-02-03T15:09:02.000Z",
        actor: { type: "reviewer", id: "usr_SYNTHETICreviewer00001", name: "Riley Example (synthetic reviewer)" },
        action: "Keyed fields from the pay stub",
        notes: "Pay date, employer and year-to-date gross pay",
      },
      {
        at: "2027-02-03T15:12:44.000Z",
        actor: { type: "reviewer", id: "usr_SYNTHETICreviewer00001", name: "Riley Example (synthetic reviewer)" },
        action: "Resolved: eligible",
        notes: "Counted income is within the limit under both readings",
      },
    ],
    timeline: [
      { at: "2027-01-29T19:58:00.000Z", event: "Verification created", actor: { type: "user", id: "usr_SYNTHETICstaff00000001", name: "Jordan Example (synthetic staff)" } },
      { at: "2027-01-29T20:03:12.000Z", event: "Family opened the link", actor: { type: "family" } },
      { at: "2027-01-29T20:05:51.000Z", event: "Consent given", actor: { type: "family" } },
      { at: "2027-01-29T20:12:40.000Z", event: "Household form completed", actor: { type: "family" }, detail: "5 persons, Starr County" },
      { at: "2027-01-29T20:18:30.000Z", event: "Documents uploaded", actor: { type: "family" }, detail: "3 files" },
      { at: "2027-01-29T20:21:40.000Z", event: "Payroll report retrieved", actor: { type: "system" }, detail: "rail_SYNTHETICpayroll000001" },
      { at: "2027-01-29T20:24:05.000Z", event: "Submitted", actor: { type: "family" } },
      { at: "2027-01-30T08:02:10.000Z", event: "Sent to review", actor: { type: "engine" } },
      { at: "2027-02-03T15:12:44.000Z", event: "Decision made", actor: { type: "reviewer", id: "usr_SYNTHETICreviewer00001", name: "Riley Example (synthetic reviewer)" }, detail: "eligible, direct method" },
      { at: "2027-03-05T09:00:00.000Z", event: "Raw file deleted under the retention policy", actor: { type: "system" }, detail: "doc_SYNTHETICpaystub000001; hash retained" },
      { at: "2027-03-05T09:00:04.000Z", event: "Evidence pack regenerated", actor: { type: "system" } },
    ],
    generatedAt: "2027-03-05T09:00:04.000Z",
    versions: { engine: "synthetic-decision-engine-1.0.0", taxonomy: "synthetic-income-taxonomy-1", ruleSet: "25F_STATUTE + REG-117199-25_PROPOSED_2026-10-02" },
  };
}

/** `count` synthetic documents, for pagination tests. */
export function syntheticDocuments(count: number): EvidenceDocumentInput[] {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(3, "0");
    return {
      id: `doc_SYNTHETICbulkfile00${n}`,
      kind: index % 2 === 0 ? ("pay_stub" as const) : ("w2" as const),
      sha256: syntheticSha256(`bulk document ${n}`),
      filename: `synthetic-document-${n}.pdf`,
      sizeBytes: 50_000 + index * 137,
      contentType: "application/pdf",
      uploadedAt: `2027-01-29T20:${String(10 + (index % 40)).padStart(2, "0")}:00.000Z`,
      extractedBy: "parser" as const,
      extractedFields: [
        { key: "employer_name", label: "Employer", value: `Synthetic Employer ${n}`, confidencePct: 97 },
        { key: "gross_pay", label: "Gross pay", amountCents: 100_000 + index, confidencePct: 96 },
      ],
    };
  });
}
