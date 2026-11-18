/**
 * Property-style tests: the engine's invariants over a few thousand generated inputs. The generator is a
 * small seeded PRNG, so every run sees the same inputs and a failure can be reproduced from its index.
 * All inputs are synthetic.
 */
import { describe, expect, it } from "vitest";
import { INCOME_CATEGORY_KEYS, type HouseholdMemberInput, type IncomeCertification, type IncomeDocumentSource, type IncomeItemInput, type IncomeReviewFlag } from "@/engine/income";
import { isAppError } from "@/lib/errors";
import { isWithinLetterWindow } from "./categorical";
import { decide } from "./decide";
import { applyReviewerResolution } from "./resolution";
import { DANIEL, HARRIS, INCOME_YEAR, MARIA, SOFIA, STARR, thresholdFixture, TODAY } from "./test-fixtures";
import { CATEGORICAL_PROGRAMS, type AwardLetterInput, type CustodyInfo, type Decision, type DecisionInput, type RailReportSummary } from "./types";

const RUNS = 2500;
const CAPS = [300, 250, 185, 100, 37];

function generator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (bound: number): number => Math.floor(next() * bound);
  const pick = <T>(values: readonly T[]): T => values[int(values.length)];
  const chance = (probability: number): boolean => next() < probability;
  return { int, pick, chance };
}
type Random = ReturnType<typeof generator>;

const EXTRA_MEMBERS: HouseholdMemberInput[] = [
  { id: "hm_mateo", firstName: "Mateo", kind: "child", ageBand: "minor" },
  { id: "hm_student", firstName: "Elena", ageBand: "adult", fullTimeStudent: true },
  { id: "hm_cousin", firstName: "Luis", kind: "other", ageBand: "unknown" },
  { id: "hm_roommate", firstName: "Sam", ageBand: "adult", role: "unrelated" },
  { id: "hm_aide", firstName: "Rosa", ageBand: "adult", role: "live_in_aide" },
  { id: "hm_teen", firstName: "Ana", ageBand: "minor", headOrSpouse: true },
];

const CUSTODY: Array<CustodyInfo | null> = [
  null,
  { livesInMultipleHouseholds: false },
  { livesInMultipleHouseholds: false },
  { livesInMultipleHouseholds: false },
  { livesInMultipleHouseholds: true, monthsInThisHousehold: 8 },
  { livesInMultipleHouseholds: true, monthsInThisHousehold: 5 },
  { livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "yes" },
  { livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "no" },
  { livesInMultipleHouseholds: true },
];

const LETTER_DATES = ["2025-09-01", "2026-03-14", "2026-03-15", "2026-08-20", "2027-01-10", "2027-03-15", "2027-04-01", null];
const BLOCKING_FLAG: IncomeReviewFlag = { code: "income_figures_conflict", severity: "blocking", message: "SYNTHETIC: documents disagree.", itemId: null, memberIds: [], sourceIds: [] };
const BOUNDED_FLAG: IncomeReviewFlag = { code: "wages_from_pay_stub_only", severity: "bounded", message: "SYNTHETIC: pay stub only.", itemId: null, memberIds: [], sourceIds: [] };

function randomInput(random: Random, capPct: number): DecisionInput {
  const { int, pick, chance } = random;
  // Half of the cases are mostly clean files, so decided outcomes are well represented; the rest are noisy.
  const noise = chance(0.5) ? 0.12 : 1;
  const bad = (probability: number): boolean => chance(probability * noise);
  const county = pick([HARRIS, HARRIS, STARR]);
  const source = chance(0.2) ? "irs_published" : "hud_provisional";
  const members = [MARIA, ...(chance(0.85) ? [DANIEL] : []), SOFIA, ...EXTRA_MEMBERS.filter(() => bad(0.2))];
  const size = bad(0.05) ? null : bad(0.05) ? members.length + 1 : members.length;
  const countyFips = bad(0.05) ? null : county.fips;
  const applicationDate = bad(0.5) ? pick(["2027-01-02", "2027-03-01", "2026-12-28"]) : undefined;
  const custody = bad(0.6) ? pick(CUSTODY) : { livesInMultipleHouseholds: false };

  const letters: AwardLetterInput[] = Array.from({ length: pick([0, 0, 0, 1, 1, 2]) }, (_, index) => ({
    documentId: `doc_letter_${index}`,
    program: bad(0.4) ? pick(["MEDICAID", "SCHOOL_MEALS", "UNKNOWN", "OTHER"]) : pick(CATEGORICAL_PROGRAMS),
    letterDate: bad(0.6) ? pick(LETTER_DATES) : pick(["2026-08-20", "2027-01-10", "2026-03-15"]),
    approvalStatus: bad(0.5) ? pick(["denied", "terminated", "pending", "unclear"] as const) : "approved",
    recipientName: "Synthetic Recipient",
    matchedMemberId: bad(0.15) ? pick(["hm_nobody", null]) : pick(members).id,
    nameMatchConfidence: bad(0.25) ? 0.6 : pick([1, 0.95, 0.9]),
    extractionConfidence: bad(0.4) ? pick([0.89, 0.4]) : pick([1, 0.95, 0.9]),
    extractedBy: bad(0.25) ? "model" : pick(["parser", "parser", "reviewer"] as const),
    benefitPeriodEnd: bad(0.2) ? "2027-02-01" : pick([undefined, null, "2027-12-31"]),
    documentType: bad(0.1) ? "other" : pick([undefined, "award_letter"] as const),
  }));

  let direct: DecisionInput["direct"];
  const railReports: RailReportSummary[] = [];
  if (chance(0.75)) {
    const items: IncomeItemInput[] = [];
    const sources: IncomeDocumentSource[] = [];
    const certifications: IncomeCertification[] = [];
    const certify = (kind: IncomeCertification["kind"], memberId: string | null): void =>
      void certifications.push({ kind, memberId, incomeYear: bad(0.05) ? 2025 : INCOME_YEAR, signedBy: "usr_maria", signedOn: "2027-03-01", copyVersion: "synthetic.v1" });
    const add = (memberId: string | null, category: string, amount: number): void => {
      const id = `inc_${items.length}`;
      const kind = bad(0.15) ? "self_reported" : pick(["document", "document", "document", "rail", "reviewer"] as const);
      const spread = bad(0.15) ? int(4_000_000) : 0;
      const base: IncomeItemInput = { id, memberId, category, incomeYear: bad(0.07) ? 2025 : INCOME_YEAR, annualAmountCents: amount, lowCents: amount - Math.min(amount, spread), highCents: amount + spread, source: kind };
      if (kind === "document") {
        const documentId = `doc_${id}`;
        items.push({ ...base, documentId });
        if (!bad(0.08)) {
          sources.push({
            documentId,
            kind: pick(["w2", "tax_return", "pay_stub", "irs_transcript", "other_income"] as const),
            extractedBy: bad(0.2) ? "model" : pick(["parser", "parser", "reviewer"] as const),
            extractionConfidence: bad(0.25) ? 0.5 : pick([1, 0.97, 0.9]),
          });
        }
      } else if (kind === "rail") {
        const railConnectionId = `rail_${id}`;
        items.push({ ...base, railConnectionId });
        if (!bad(0.1)) railReports.push({ railConnectionId, provider: "simulated", kind: "payroll", dataBasis: bad(0.25) ? "bank_net_deposits" : "payroll_gross", retrievedOn: "2027-03-10" });
      } else {
        items.push(base);
      }
    };
    for (const member of members) {
      if (member.ageBand !== "minor" && !bad(0.15)) add(member.id, "wages_salary", pick([0, 2_000_000, 6_000_000, 11_000_000, 14_000_000, 20_000_000, 31_200_000, 40_000_000]) + int(100_000));
      else if (chance(0.3)) certify("zero_income", member.id);
      if (bad(0.15)) add(member.id, pick(INCOME_CATEGORY_KEYS.filter((key) => !["self_employment_net", "gig_contractor_daylabor_seasonal", "rental_income_net"].includes(key))), int(5_000_000));
    }
    if (bad(0.1)) add(MARIA.id, "self_employment_net", int(8_000_000));
    if (bad(0.05)) add("hm_ghost", "wages_salary", int(8_000_000));
    if (bad(0.05)) add(null, "made_up_category", int(8_000_000));
    if (!bad(0.15)) certify("no_other_income", null);
    const evidenceFlags = [...(bad(0.08) ? [BLOCKING_FLAG] : []), ...(bad(0.08) ? [BOUNDED_FLAG] : [])];
    const unreadDocuments = bad(0.08) ? [{ documentId: "doc_unreadable", memberId: pick([MARIA.id, null]) }] : undefined;
    direct = { incomeYear: bad(0.05) ? 2025 : INCOME_YEAR, items, certifications, sources, evidenceFlags, unreadDocuments };
  }

  return {
    today: TODAY,
    applicationDate,
    sgoPolicy: { capPct, reviewBandBps: pick([0, 250, 500, 1000]) },
    household: { size, countyFips, members, custody },
    categorical: letters.length > 0 ? { letters } : undefined,
    direct,
    railReports,
    threshold: thresholdFixture(county, { capPct, householdSize: size ?? 4, source }),
  };
}

const blockingFlags = (decision: Decision): IncomeReviewFlag[] => [...(decision.income?.reviewFlags ?? []), ...(decision.coverage?.flags ?? [])].filter((flag) => flag.severity === "blocking");

describe("decision engine invariants over generated inputs", () => {
  const random = generator(20261118);
  const cases = Array.from({ length: RUNS }, () => {
    const capPct = random.pick(CAPS);
    const input = randomInput(random, capPct);
    return { input, decision: decide(input) };
  });

  it("exercises every status and both methods", () => {
    const tally = new Map<string, number>();
    for (const { decision } of cases) tally.set(`${decision.status}/${decision.method ?? "-"}`, (tally.get(`${decision.status}/${decision.method ?? "-"}`) ?? 0) + 1);
    for (const key of ["eligible/direct", "eligible/categorical", "ineligible/direct", "needs_review/-", "pending/-"]) {
      expect(tally.get(key) ?? 0, key).toBeGreaterThan(20);
    }
    expect([...tally.keys()].sort()).toEqual(["eligible/categorical", "eligible/direct", "ineligible/direct", "needs_review/-", "pending/-"]);
  });

  it("is never eligible with an unresolved review reason or anything missing", () => {
    for (const [index, { decision }] of cases.entries()) {
      if (decision.status !== "eligible") continue;
      expect(decision.reviewReasons, `case ${index}`).toEqual([]);
      expect(decision.missing, `case ${index}`).toEqual([]);
      expect(["this_household_longest", "this_household_equal_time_higher_income", "single_household"], `case ${index}`).toContain(decision.custody.outcome);
      expect(decision.threshold, `case ${index}`).not.toBeNull();
    }
  });

  it("is never ineligible without complete coverage and income strictly greater than the limit under every reading", () => {
    for (const [index, { decision }] of cases.entries()) {
      if (decision.status !== "ineligible") continue;
      expect(decision.method, `case ${index}`).toBe("direct");
      expect(decision.coverage?.complete, `case ${index}`).toBe(true);
      expect(decision.income!.lowerBoundCents, `case ${index}`).toBeGreaterThan(decision.threshold!.upperBoundCents);
      expect(decision.income!.lowerBoundCents, `case ${index}`).toBeGreaterThan(decision.threshold!.autoIneligibleAboveCents);
      expect(blockingFlags(decision), `case ${index}`).toEqual([]);
      expect(decision.reviewReasons, `case ${index}`).toEqual([]);
      expect(decision.letters.filter((letter) => letter.outcome !== "fail"), `case ${index}`).toEqual([]);
    }
  });

  it("is eligible on the direct method only with complete, trusted evidence at or below the lowest reading", () => {
    for (const [index, { input, decision }] of cases.entries()) {
      if (decision.status !== "eligible" || decision.method !== "direct") continue;
      expect(decision.coverage?.complete, `case ${index}`).toBe(true);
      expect(decision.coverage!.documentedMemberCount, `case ${index}`).toBeGreaterThan(0);
      expect(decision.income!.upperBoundCents, `case ${index}`).toBeLessThanOrEqual(decision.threshold!.lowerBoundCents);
      expect(blockingFlags(decision), `case ${index}`).toEqual([]);
      expect(input.direct!.evidenceFlags?.filter((flag) => flag.severity === "blocking") ?? [], `case ${index}`).toEqual([]);
      expect(input.direct!.unreadDocuments ?? [], `case ${index}`).toEqual([]);
      const sources = new Map((input.direct!.sources ?? []).map((source) => [source.documentId, source]));
      const reports = new Map((input.railReports ?? []).map((report) => [report.railConnectionId, report]));
      for (const item of input.direct!.items.filter((candidate) => candidate.incomeYear === decision.incomeYear)) {
        if (item.source === "document") {
          const source = sources.get(item.documentId as string);
          expect(source, `case ${index} item ${item.id}`).toBeDefined();
          expect(source!.extractedBy, `case ${index} item ${item.id}`).not.toBe("model");
          if (source!.extractedBy === "parser") expect(source!.extractionConfidence, `case ${index} item ${item.id}`).toBeGreaterThanOrEqual(0.9);
        }
        if (item.source === "rail") expect(reports.get(item.railConnectionId as string)?.dataBasis, `case ${index} item ${item.id}`).toBe("payroll_gross");
      }
    }
  });

  it("is eligible on the categorical method only on a trusted, current, in-window letter for one of the five programs", () => {
    for (const [index, { input, decision }] of cases.entries()) {
      if (decision.status !== "eligible" || decision.method !== "categorical") continue;
      const letter = input.categorical!.letters.find((candidate) => candidate.documentId === decision.awardLetterDocumentId)!;
      expect(letter, `case ${index}`).toBeDefined();
      expect(CATEGORICAL_PROGRAMS, `case ${index}`).toContain(letter.program);
      expect(decision.awardProgram, `case ${index}`).toBe(letter.program);
      expect(letter.approvalStatus, `case ${index}`).toBe("approved");
      expect(letter.extractedBy, `case ${index}`).not.toBe("model");
      if (letter.extractedBy === "parser") {
        expect(letter.extractionConfidence, `case ${index}`).toBeGreaterThanOrEqual(0.9);
        expect(letter.nameMatchConfidence, `case ${index}`).toBeGreaterThanOrEqual(0.9);
      }
      expect(input.household.members.map((member) => member.id), `case ${index}`).toContain(letter.matchedMemberId);
      expect(isWithinLetterWindow(letter.letterDate!, decision.applicationDate, 12), `case ${index}`).toBe(true);
      expect(isWithinLetterWindow(letter.letterDate!, decision.decidedOn, 12), `case ${index}`).toBe(true);
      if (letter.benefitPeriodEnd) expect(letter.benefitPeriodEnd >= decision.decidedOn, `case ${index}`).toBe(true);
      expect(letter.documentType ?? "award_letter", `case ${index}`).toBe("award_letter");
      // Income documents on file never show income above the lowest reading next to a categorical yes.
      if (decision.income) expect(decision.income.upperBoundCents, `case ${index}`).toBeLessThanOrEqual(decision.threshold!.lowerBoundCents);
    }
  });

  it("keeps status, missing and review reasons consistent, and decided results complete", () => {
    for (const [index, { decision }] of cases.entries()) {
      expect(decision.status === "pending", `case ${index}`).toBe(decision.missing.length > 0);
      expect(decision.status === "needs_review", `case ${index}`).toBe(decision.missing.length === 0 && decision.reviewReasons.length > 0);
      const decided = decision.status === "eligible" || decision.status === "ineligible";
      expect(decision.method !== null, `case ${index}`).toBe(decided);
      expect(decision.validUntil !== null, `case ${index}`).toBe(decided);
      expect(decision.methodCitation !== null, `case ${index}`).toBe(decided);
      if (decided) {
        expect(decision.validUntil! >= decision.decidedOn, `case ${index}`).toBe(true);
        expect(decision.validUntil! <= "2027-12-31", `case ${index}`).toBe(true);
        expect(decision.methodBasis, `case ${index}`).not.toBeNull();
      }
      expect(decision.incomeYear, `case ${index}`).toBe(Number(decision.applicationDate.slice(0, 4)) - 1);
      expect(decision.decidedBy, `case ${index}`).toEqual({ type: "engine" });
    }
  });

  it("always carries the threshold source, version and effective date, and is provisional exactly when the table is HUD-derived", () => {
    for (const [index, { input, decision }] of cases.entries()) {
      expect(decision.thresholdTable.source, `case ${index}`).toBe(input.threshold!.source);
      expect(decision.thresholdTable.tableVersion.length, `case ${index}`).toBeGreaterThan(0);
      expect(decision.thresholdTable.effectiveDate, `case ${index}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(decision.provisional, `case ${index}`).toBe(decision.thresholdTable.source === "hud_provisional");
      expect(decision.thresholdTable.provisional, `case ${index}`).toBe(decision.provisional);
      if (decision.threshold) {
        expect([decision.threshold.source, decision.threshold.tableVersion, decision.threshold.effectiveDate], `case ${index}`).toEqual([
          decision.thresholdTable.source,
          decision.thresholdTable.tableVersion,
          decision.thresholdTable.effectiveDate,
        ]);
        expect(decision.threshold.readings.length, `case ${index}`).toBeGreaterThan(0);
        expect(decision.threshold.reviewBand.applied, `case ${index}`).toBe(decision.provisional && input.sgoPolicy.reviewBandBps > 0);
      } else {
        expect(decision.status === "eligible" || decision.status === "ineligible", `case ${index}`).toBe(false);
      }
    }
  });

  it("is deterministic for identical input and returns plain data", () => {
    for (const [index, { input, decision }] of cases.entries()) {
      if (index % 5 !== 0) continue;
      expect(decide(structuredClone(input)), `case ${index}`).toEqual(decision);
      expect(JSON.parse(JSON.stringify(decision)), `case ${index}`).toEqual(decision);
    }
  });

  it("never names a household member in a reason", () => {
    for (const [index, { decision }] of cases.entries()) {
      for (const reason of [...decision.reasons, ...decision.reviewReasons]) {
        expect(reason.message, `case ${index} ${reason.code}`).not.toMatch(/Maria|Daniel|Sofia|Mateo|Elena|Luis|Sam\b|Rosa|Ana\b/);
      }
    }
  });

  it("never turns ineligible into eligible when the SGO's cap is lowered, and never loses a yes when it is raised", () => {
    let ineligibleSeen = 0;
    let eligibleSeen = 0;
    for (let run = 0; run < 600; run++) {
      // The same household and evidence at every cap: re-seed the generator for each cap.
      const seed = 1000 + run;
      const decisions = CAPS.map((capPct) => decide(randomInput(generator(seed), capPct)));
      for (let higher = 0; higher < CAPS.length; higher++) {
        for (let lower = higher + 1; lower < CAPS.length; lower++) {
          if (decisions[higher].status === "ineligible") {
            ineligibleSeen += 1;
            expect(decisions[lower].status, `seed ${seed}: ${CAPS[higher]}% -> ${CAPS[lower]}%`).not.toBe("eligible");
            expect(decisions[lower].status, `seed ${seed}: ${CAPS[higher]}% -> ${CAPS[lower]}%`).toBe("ineligible");
          }
          if (decisions[lower].status === "eligible") {
            eligibleSeen += 1;
            expect(decisions[higher].status, `seed ${seed}: ${CAPS[lower]}% -> ${CAPS[higher]}%`).toBe("eligible");
          }
        }
      }
    }
    expect(ineligibleSeen).toBeGreaterThan(50);
    expect(eligibleSeen).toBeGreaterThan(50);
  });

  it("never lets a reviewer approve above the statutory limit, or resolve anything that is not in review", () => {
    let resolved = 0;
    let refused = 0;
    for (const [index, { decision }] of cases.entries()) {
      for (const basis of [{ method: "direct" as const }, ...decision.letters.map((letter) => ({ method: "categorical" as const, documentId: letter.documentId }))]) {
        let outcome: Decision | null = null;
        try {
          outcome = applyReviewerResolution(decision, { resolution: "eligible", reviewerId: "usr_reviewer", notes: "SYNTHETIC: checked.", basis, resolvedOn: TODAY });
        } catch (error) {
          expect(isAppError(error), `case ${index}`).toBe(true);
          refused += 1;
          continue;
        }
        resolved += 1;
        expect(decision.status, `case ${index}`).toBe("needs_review");
        expect(outcome.status, `case ${index}`).toBe("eligible");
        expect(outcome.reviewReasons, `case ${index}`).toEqual([]);
        expect(outcome.engineOutcome!.reviewReasons, `case ${index}`).toEqual(decision.reviewReasons);
        if (outcome.householdIncomeCents !== null) {
          expect(outcome.householdIncomeCents, `case ${index}`).toBeLessThanOrEqual(outcome.threshold!.statutoryUpperBoundCents);
        }
        if (basis.method === "categorical") expect(CATEGORICAL_PROGRAMS, `case ${index}`).toContain(outcome.awardProgram);
      }
    }
    expect(resolved).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });
});
