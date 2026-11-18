/**
 * SYNTHETIC fixtures for the decision engine tests. No real family, document or employer.
 *
 * The threshold fixtures are built by hand so the tests state the two-reading cases explicitly and do not
 * depend on the AMI engine's data. Their dollar figures are the real HUD FY 2026 ones recorded in
 * docs/reference (sgo-verification-rules.md F34, hud-ami-and-annual-income.md F38 and F39):
 *   Starr County, 4 persons:  median $38,700; reading A (3 x median) $116,100; reading B (6 x very-low-income limit $41,850) $251,100
 *   Harris County, 4 persons: median $104,000; both readings $312,000
 */
import type { HouseholdMemberInput, IncomeCertification, IncomeDocumentSource, IncomeItemInput } from "@/engine/income";
import type { AwardLetterInput, DecisionInput, DirectEvidenceInput, InjectedThreshold } from "./types";

const floorScale = (cents: number, capPct: number): number => Number((BigInt(cents) * BigInt(capPct)) / 300n);

/** A copy of `value` without the named keys. */
export function omit<T extends object, K extends string>(value: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !(keys as string[]).includes(key))) as Omit<T, K>;
}

interface ThresholdFixtureOptions {
  capPct?: number;
  householdSize?: number;
  source?: "hud_provisional" | "irs_published";
}

interface CountyFixture {
  fips: string;
  name: string;
  areaCode: string;
  areaName: string;
  metro: boolean;
  medianCents: number;
  /** Limits at 300 percent for four persons under each reading, in cents. */
  medianProductCents: number;
  section8VliCents: number;
}

export const STARR: CountyFixture = {
  fips: "48427",
  name: "Starr County",
  areaCode: "NCNTY48427N48427",
  areaName: "Starr County, TX",
  metro: false,
  medianCents: 3_870_000,
  medianProductCents: 11_610_000,
  section8VliCents: 25_110_000,
};

export const HARRIS: CountyFixture = {
  fips: "48201",
  name: "Harris County",
  areaCode: "METRO26420M26420",
  areaName: "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area",
  metro: true,
  medianCents: 10_400_000,
  medianProductCents: 31_200_000,
  section8VliCents: 31_200_000,
};

/** A `getThreshold` result for a four-person household, built by hand. HUD-derived tables carry two readings. */
export function thresholdFixture(county: CountyFixture, options: ThresholdFixtureOptions = {}): InjectedThreshold {
  const capPct = options.capPct ?? 300;
  const householdSize = options.householdSize ?? 4;
  const source = options.source ?? "hud_provisional";
  const a = floorScale(county.medianProductCents, capPct);
  const b = floorScale(county.section8VliCents, capPct);
  const common = {
    thresholdCents: a,
    statutoryThresholdCents: county.medianProductCents,
    medianIncomeCents: county.medianCents,
    multiplierBps: 10_000,
    multiplier: "1.00",
    capPct,
    householdSize,
    area: { code: county.areaCode, name: county.areaName, metro: county.metro },
    county: { fips: county.fips, name: county.name },
    formula: `SYNTHETIC FIXTURE: ${capPct}% x area median x 1.00`,
    exact: true,
  };
  if (source === "irs_published") {
    return {
      ...common,
      source,
      tableVersion: "irs-synthetic-fixture",
      effectiveDate: "2027-01-01",
      provisional: false,
      method: "irs_published_limit_by_family_size_v1",
      readings: [{ id: "irs_published", label: "IRS-published limit", thresholdCents: a, statutoryThresholdCents: county.medianProductCents, formula: "SYNTHETIC FIXTURE: published limit" }],
      lowerBoundCents: a,
      upperBoundCents: a,
      readingsAgree: true,
    };
  }
  return {
    ...common,
    source,
    tableVersion: "hud-synthetic-fixture",
    effectiveDate: "2026-05-01",
    provisional: true,
    method: "hud_median_x_cap_pct_x_family_size_multiplier_v1",
    readings: [
      { id: "median_product", label: "3 x area median x family-size multiplier", thresholdCents: a, statutoryThresholdCents: county.medianProductCents, formula: "SYNTHETIC FIXTURE: reading A" },
      { id: "section8_vli", label: "6 x Section 8 very-low-income limit", thresholdCents: b, statutoryThresholdCents: county.section8VliCents, formula: "SYNTHETIC FIXTURE: reading B" },
    ],
    lowerBoundCents: Math.min(a, b),
    upperBoundCents: Math.max(a, b),
    readingsAgree: a === b,
  };
}

/* ------------------------------------------------------------------------------------ household */

export const MARIA: HouseholdMemberInput = { id: "hm_maria", firstName: "Maria", lastName: "Synthetic", kind: "adult", ageBand: "adult", headOrSpouse: true };
export const DANIEL: HouseholdMemberInput = { id: "hm_daniel", firstName: "Daniel", lastName: "Synthetic", kind: "adult", ageBand: "adult", headOrSpouse: true };
export const SOFIA: HouseholdMemberInput = { id: "hm_sofia", firstName: "Sofia", lastName: "Synthetic", kind: "student", ageBand: "minor" };
export const MATEO: HouseholdMemberInput = { id: "hm_mateo", firstName: "Mateo", lastName: "Synthetic", kind: "child", ageBand: "minor" };
export const FAMILY_OF_FOUR: HouseholdMemberInput[] = [MARIA, DANIEL, SOFIA, MATEO];

/** An application in March 2027 looks at calendar year 2026. */
export const TODAY = "2027-03-15";
export const INCOME_YEAR = 2026;

/* ---------------------------------------------------------------------------------------- direct */

export function wageItem(memberId: string, annualAmountCents: number, overrides: Partial<IncomeItemInput> = {}): IncomeItemInput {
  return {
    id: `inc_wages_${memberId}`,
    memberId,
    category: "wages_salary",
    incomeYear: INCOME_YEAR,
    annualAmountCents,
    source: "document",
    documentId: `doc_w2_${memberId}`,
    ...overrides,
  };
}

export function parserSource(documentId: string, overrides: Partial<IncomeDocumentSource> = {}): IncomeDocumentSource {
  return { documentId, kind: "w2", extractedBy: "parser", extractionConfidence: 0.99, ...overrides };
}

export const NO_OTHER_INCOME: IncomeCertification = {
  kind: "no_other_income",
  memberId: null,
  incomeYear: INCOME_YEAR,
  signedBy: "usr_maria",
  signedOn: "2027-03-10",
  copyVersion: "synthetic-certification.v1",
};

/**
 * Complete, trusted direct evidence for the family of four: a parsed Form W-2 for each adult and a signed
 * household statement of no other income. `extraItems` are added with a trusted source each.
 */
export function directEvidence(mariaCents: number, danielCents: number, extraItems: IncomeItemInput[] = [], overrides: Partial<DirectEvidenceInput> = {}): DirectEvidenceInput {
  const items = [wageItem(MARIA.id, mariaCents), wageItem(DANIEL.id, danielCents), ...extraItems];
  return {
    incomeYear: INCOME_YEAR,
    items,
    certifications: [NO_OTHER_INCOME],
    sources: items.filter((item) => item.source === "document" && typeof item.documentId === "string").map((item) => parserSource(item.documentId as string)),
    ...overrides,
  };
}

/* ----------------------------------------------------------------------------------- categorical */

/** A SNAP approval letter for Maria, parsed with high confidence, dated two months before `TODAY`. */
export function awardLetter(overrides: Partial<AwardLetterInput> = {}): AwardLetterInput {
  return {
    documentId: "doc_letter",
    program: "SNAP",
    letterDate: "2027-01-10",
    approvalStatus: "approved",
    recipientName: "Maria Synthetic",
    matchedMemberId: MARIA.id,
    nameMatchConfidence: 0.98,
    extractionConfidence: 0.97,
    extractedBy: "parser",
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------------------- input */

/** A decision input for the family of four in Harris County with nothing on file. Override what the test is about. */
export function decisionInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  const input: DecisionInput = {
    today: TODAY,
    sgoPolicy: { capPct: 300, reviewBandBps: 500 },
    household: { size: 4, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: false } },
    ...overrides,
  };
  if (input.threshold === undefined && input.amiTable === undefined && input.household.countyFips === HARRIS.fips && input.household.size === 4) {
    input.threshold = thresholdFixture(HARRIS, { capPct: input.sgoPolicy.capPct });
  }
  return input;
}
