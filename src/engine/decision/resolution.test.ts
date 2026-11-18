import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { decide } from "./decide";
import { applyReviewerResolution, type ReviewerResolutionInput } from "./resolution";
import { METHOD_CITATIONS } from "./policy";
import { awardLetter, DANIEL, decisionInput, directEvidence, FAMILY_OF_FOUR, MARIA, omit, STARR, thresholdFixture, TODAY, wageItem } from "./test-fixtures";
import type { Decision, DecisionInput } from "./types";

const resolution = (overrides: Partial<ReviewerResolutionInput> = {}): ReviewerResolutionInput => ({
  resolution: "eligible",
  reviewerId: "usr_reviewer",
  notes: "Compared the W-2s with the return; the lower figure was a duplicate upload.",
  basis: { method: "direct" },
  resolvedOn: "2027-03-20",
  ...overrides,
});
const inStarr = (overrides: Partial<DecisionInput>): Decision =>
  decide(decisionInput({ household: { size: 4, countyFips: STARR.fips, members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: false } }, threshold: thresholdFixture(STARR, { capPct: overrides.sgoPolicy?.capPct ?? 300 }), ...overrides }));
const refusal = (attempt: () => unknown): { code: string; reason: unknown; message: string } => {
  try {
    attempt();
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, reason: (error.details as { reason?: string } | undefined)?.reason, message: error.message };
    throw error;
  }
  throw new Error("expected the resolution to be refused");
};

/** Between the two readings in Starr County: the engine sends it to a reviewer. */
const betweenReadings = (): Decision => inStarr({ direct: directEvidence(10_000_000, 5_000_000) });
/** A letter only a person can confirm. */
const doubtfulLetter = (): Decision => decide(decisionInput({ categorical: { letters: [awardLetter({ extractedBy: "model" })] } }));

describe("applyReviewerResolution", () => {
  it("records an eligible resolution on the direct method and keeps the engine's own outcome", () => {
    const decision = betweenReadings();
    expect(decision.status).toBe("needs_review");
    const resolved = applyReviewerResolution(decision, resolution());
    expect(resolved).toMatchObject({
      status: "eligible",
      method: "direct",
      methodBasis: "written_documentation",
      methodCitation: METHOD_CITATIONS.direct,
      reviewReasons: [],
      missing: [],
      validUntil: "2027-12-31",
      householdIncomeCents: 15_000_000,
      decidedOn: TODAY,
      decidedBy: { type: "reviewer", reviewerId: "usr_reviewer", resolvedOn: "2027-03-20", basis: { method: "direct" }, notes: "Compared the W-2s with the return; the lower figure was a duplicate upload." },
      awardProgram: null,
    });
    expect(resolved.engineOutcome).toEqual({
      status: "needs_review",
      method: null,
      reasons: decision.reasons,
      reviewReasons: decision.reviewReasons,
      missing: [],
      validUntil: null,
      decidedOn: TODAY,
    });
    expect(resolved.engineOutcome!.reviewReasons.map((reason) => reason.code)).toEqual(["between_provisional_readings"]);
    expect(resolved.reasons.at(-1)).toMatchObject({ code: "reviewer_resolved" });
    expect(resolved.reasons.slice(0, -1)).toEqual(decision.reasons);
    // The limit, the income and the evidence are untouched; the result is still provisional. The decision now
    // records the figure the resolution rests on: $150,000 is within the higher reading only.
    expect(decision.threshold).toMatchObject({ reliedOn: "none", reliedOnLimitCents: null });
    expect(resolved.threshold).toEqual({ ...decision.threshold, reliedOn: "upper_bound", reliedOnLimitCents: 25_110_000 });
    expect(resolved.income).toEqual(decision.income);
    expect(resolved.provisional).toBe(true);
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
  });

  it("does not modify the decision it is given", () => {
    const decision = betweenReadings();
    const snapshot = structuredClone(decision);
    applyReviewerResolution(decision, resolution());
    expect(decision).toEqual(snapshot);
  });

  it("records an eligible resolution on the categorical method with the letter it rests on", () => {
    const resolved = applyReviewerResolution(doubtfulLetter(), resolution({ basis: { method: "categorical", documentId: "doc_letter" }, notes: "  Read the letter: SNAP approval for the mother, dated January 10.  " }));
    expect(resolved).toMatchObject({
      status: "eligible",
      method: "categorical",
      methodBasis: "categorical_documentation",
      methodCitation: METHOD_CITATIONS.categorical,
      awardProgram: "SNAP",
      awardLetterDate: "2027-01-10",
      awardLetterDocumentId: "doc_letter",
      validUntil: "2027-12-31",
      decidedBy: { type: "reviewer", notes: "Read the letter: SNAP approval for the mother, dated January 10." },
    });
    expect(resolved.reasons.at(-1)).toMatchObject({ code: "reviewer_resolved", sourceIds: ["doc_letter"] });
    // No income comparison was relied on.
    expect(resolved.threshold).toMatchObject({ reliedOn: "none", reliedOnLimitCents: null });
    // The validity follows the letter, as it does for the engine.
    const shorter = decide(decisionInput({ categorical: { letters: [awardLetter({ extractedBy: "model", letterDate: "2026-06-01" })] } }));
    expect(applyReviewerResolution(shorter, resolution({ basis: { method: "categorical", documentId: "doc_letter" } })).validUntil).toBe("2027-06-01");
  });

  it("records an ineligible resolution when the evidence shows income over the limit", () => {
    // Over the lower reading, under the higher one: the engine cannot say, a reviewer can.
    const resolved = applyReviewerResolution(betweenReadings(), resolution({ resolution: "ineligible" }));
    expect(resolved).toMatchObject({ status: "ineligible", method: "direct", validUntil: "2027-12-31", reviewReasons: [] });
    // Over the lower reading only, so that is the figure the resolution rests on.
    expect(resolved.threshold).toMatchObject({ reliedOn: "lower_bound", reliedOnLimitCents: 11_610_000 });
    // Self-employment over the limit.
    const selfEmployed = decide(
      decisionInput({ direct: directEvidence(20_000_000, 15_000_000, [{ id: "se", memberId: MARIA.id, category: "self_employment_net", incomeYear: 2026, annualAmountCents: 5_000_000, source: "document", documentId: "doc_se" }]) }),
    );
    expect(applyReviewerResolution(selfEmployed, resolution({ resolution: "ineligible" })).status).toBe("ineligible");
  });

  describe("requires notes", () => {
    it.each(["", "   ", "\n\t"])("refuses %j", (notes) => {
      const result = refusal(() => applyReviewerResolution(betweenReadings(), resolution({ notes })));
      expect(result.code).toBe("validation_failed");
      expect(result.message).toContain("notes are required");
    });

    it("refuses missing notes and an anonymous reviewer", () => {
      expect(refusal(() => applyReviewerResolution(betweenReadings(), omit(resolution(), "notes") as ReviewerResolutionInput)).code).toBe("validation_failed");
      expect(refusal(() => applyReviewerResolution(betweenReadings(), resolution({ reviewerId: "" }))).code).toBe("validation_failed");
    });
  });

  describe("never approves above the statutory 300% limit on the recorded income", () => {
    it("refuses when the recorded income is above the limit under every reading", () => {
      // A household that is in review only because of self-employment, with income far above the limit.
      const decision = decide(
        decisionInput({ direct: directEvidence(20_000_000, 15_000_000, [{ id: "se", memberId: MARIA.id, category: "self_employment_net", incomeYear: 2026, annualAmountCents: 1_000_000, source: "document", documentId: "doc_se" }]) }),
      );
      expect(decision.status).toBe("needs_review");
      const result = refusal(() => applyReviewerResolution(decision, resolution()));
      expect(result).toMatchObject({ code: "conflict", reason: "income_above_statutory_limit" });
      expect(result.message).toContain("$360,000");
      expect(result.message).toContain("$312,000");
    });

    it("measures against the highest reading: one cent above it is refused, the limit itself is not", () => {
      const noBand = { capPct: 300, reviewBandBps: 0 };
      const flagged = (total: number) =>
        inStarr({ sgoPolicy: noBand, direct: directEvidence(total - 4_000_000, 4_000_000, [], { evidenceFlags: [{ code: "income_figures_conflict", severity: "blocking", message: "SYNTHETIC conflict.", itemId: null, memberIds: [], sourceIds: [] }] }) });
      expect(applyReviewerResolution(flagged(25_110_000), resolution()).status).toBe("eligible");
      expect(refusal(() => applyReviewerResolution(flagged(25_110_001), resolution())).reason).toBe("income_above_statutory_limit");
    });

    it("uses the statutory 300%, not the SGO's stricter cap", () => {
      // Harris at 185%: the SGO's limit is $192,400, the statutory limit is $312,000.
      const atCap = (total: number) =>
        decide(decisionInput({ sgoPolicy: { capPct: 185, reviewBandBps: 0 }, direct: directEvidence(total - 4_000_000, 4_000_000, [{ id: "se", memberId: MARIA.id, category: "self_employment_net", incomeYear: 2026, annualAmountCents: 0, source: "document", documentId: "doc_se" }]) }));
      const overCapUnderStatute = atCap(25_000_000);
      expect(overCapUnderStatute.threshold).toMatchObject({ upperBoundCents: 19_240_000, statutoryUpperBoundCents: 31_200_000 });
      const approved = applyReviewerResolution(overCapUnderStatute, resolution());
      expect(approved.status).toBe("eligible");
      // Above the SGO's cap and within the statutory 300%: the decision says it rests on the statutory limit.
      expect(approved.threshold).toMatchObject({ reliedOn: "statutory_limit", reliedOnLimitCents: 31_200_000 });
      expect(refusal(() => applyReviewerResolution(atCap(31_200_001), resolution())).reason).toBe("income_above_statutory_limit");
    });

    it("applies to a categorical resolution too: a letter does not override income recorded above the statutory limit", () => {
      const conflict = decide(decisionInput({ categorical: { letters: [awardLetter()] }, direct: directEvidence(20_000_000, 15_000_000) }));
      expect(conflict.status).toBe("needs_review");
      expect(refusal(() => applyReviewerResolution(conflict, resolution({ basis: { method: "categorical", documentId: "doc_letter" } }))).reason).toBe("income_above_statutory_limit");
      // Below the statutory limit the reviewer may settle the conflict either way.
      const mild = decide(decisionInput({ sgoPolicy: { capPct: 185, reviewBandBps: 0 }, categorical: { letters: [awardLetter()] }, direct: directEvidence(15_000_000, 10_000_000) }));
      expect(mild.reviewReasons.map((reason) => reason.code)).toEqual(["categorical_direct_conflict"]);
      expect(applyReviewerResolution(mild, resolution({ basis: { method: "categorical", documentId: "doc_letter" } })).status).toBe("eligible");
      expect(applyReviewerResolution(mild, resolution({ resolution: "ineligible" })).status).toBe("ineligible");
    });

    it("refuses when income is recorded but there is no limit to compare it with", () => {
      const noLimit = decide({
        today: TODAY,
        sgoPolicy: { capPct: 300, reviewBandBps: 500 },
        household: { size: 4, countyFips: "06037", members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: false } },
        direct: directEvidence(6_000_000, 4_500_000),
      });
      expect(noLimit).toMatchObject({ status: "needs_review", threshold: null });
      expect(refusal(() => applyReviewerResolution(noLimit, resolution())).reason).toBe("no_income_limit_on_record");
    });
  });

  it("only resolves a verification that is in review", () => {
    const eligible = decide(decisionInput({ direct: directEvidence(6_000_000, 4_500_000) }));
    const ineligible = decide(decisionInput({ direct: directEvidence(20_000_000, 15_000_000) }));
    const pending = decide(decisionInput({ direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 6_000_000)] }) }));
    for (const decision of [eligible, ineligible, pending]) {
      expect(refusal(() => applyReviewerResolution(decision, resolution()))).toMatchObject({ code: "conflict", reason: "not_in_review" });
      expect(refusal(() => applyReviewerResolution(decision, resolution({ resolution: "ineligible" })))).toMatchObject({ code: "conflict", reason: "not_in_review" });
    }
    // A resolved decision is decided: it cannot be resolved again.
    const resolved = applyReviewerResolution(betweenReadings(), resolution());
    expect(refusal(() => applyReviewerResolution(resolved, resolution({ resolution: "ineligible" }))).reason).toBe("not_in_review");
  });

  it("does not let a reviewer call a household ineligible without income over the limit", () => {
    // In review because of custody; income is far below the limit.
    const custody = decide(decisionInput({ household: { size: 4, countyFips: "48201", members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: true } }, direct: directEvidence(6_000_000, 4_500_000) }));
    expect(refusal(() => applyReviewerResolution(custody, resolution({ resolution: "ineligible" })))).toMatchObject({ code: "conflict", reason: "income_not_over_limit" });
    expect(applyReviewerResolution(custody, resolution()).status).toBe("eligible");
    // No income on record at all.
    expect(refusal(() => applyReviewerResolution(doubtfulLetter(), resolution({ resolution: "ineligible" }))).reason).toBe("no_income_on_record");
    // "Ineligible" cannot rest on the categorical method.
    const result = refusal(() => applyReviewerResolution(doubtfulLetter(), resolution({ resolution: "ineligible", basis: { method: "categorical", documentId: "doc_letter" } })));
    expect(result.code).toBe("validation_failed");
  });

  it("does not let a reviewer approve on the direct method with no income on record", () => {
    expect(refusal(() => applyReviewerResolution(doubtfulLetter(), resolution()))).toMatchObject({ code: "conflict", reason: "no_income_on_record" });
  });

  it("does not let a reviewer widen the categorical rule", () => {
    const categorical = (documentId = "doc_letter") => resolution({ basis: { method: "categorical", documentId } });
    // A model-read Medicaid letter is in review; it still is not one of the five programs.
    const medicaid = decide(decisionInput({ categorical: { letters: [awardLetter({ program: "MEDICAID", extractedBy: "model" })] } }));
    expect(medicaid.status).toBe("needs_review");
    expect(refusal(() => applyReviewerResolution(medicaid, categorical()))).toMatchObject({ code: "conflict", reason: "letter_cannot_support_categorical" });
    // A letter with no date, a denial, a letter that is too old, a program that was not recognized.
    for (const overrides of [{ letterDate: null }, { approvalStatus: "denied" as const, extractionConfidence: 0.3 }, { letterDate: "2025-01-01", extractedBy: "model" as const }, { program: "UNKNOWN" }]) {
      const decision = decide(decisionInput({ categorical: { letters: [awardLetter(overrides)] } }));
      expect(decision.status).toBe("needs_review");
      expect(refusal(() => applyReviewerResolution(decision, categorical())).reason).toBe("letter_cannot_support_categorical");
    }
    // A letter that is not on the file.
    expect(refusal(() => applyReviewerResolution(doubtfulLetter(), categorical("doc_other"))).reason).toBe("letter_not_on_record");
    // What a reviewer can settle: the recipient, a low-confidence read, an unclear status, the reference date.
    for (const overrides of [{ matchedMemberId: null }, { extractionConfidence: 0.3 }, { approvalStatus: "unclear" as const }, { benefitPeriodEnd: "2027-02-28" }, { documentType: "other" as const }]) {
      const decision = decide(decisionInput({ categorical: { letters: [awardLetter(overrides)] } }));
      expect(applyReviewerResolution(decision, categorical()).status).toBe("eligible");
    }
  });

  it("validates the rest of its input", () => {
    const decision = betweenReadings();
    const bad: Array<Partial<ReviewerResolutionInput> | Record<string, unknown>> = [
      { resolvedOn: "2027-03-14" }, // before the engine sent it to review
      { resolvedOn: "20 March 2027" },
      { resolution: "approved" },
      { basis: { method: "safe_harbor" } },
      { basis: { method: "categorical" } },
      { extra: true },
    ];
    for (const overrides of bad) {
      expect(refusal(() => applyReviewerResolution(decision, { ...resolution(), ...overrides } as ReviewerResolutionInput)).code, JSON.stringify(overrides)).toBe("validation_failed");
    }
  });

  it("names the method basis from the evidence the reviewer relied on", () => {
    const flag = { code: "income_figures_conflict" as const, severity: "blocking" as const, message: "SYNTHETIC conflict.", itemId: null, memberIds: [], sourceIds: [] };
    const railItems = [wageItem(MARIA.id, 6_000_000, { source: "rail", documentId: null, railConnectionId: "rail_maria" }), wageItem(DANIEL.id, 4_500_000, { source: "rail", documentId: null, railConnectionId: "rail_maria" })];
    const railReports = [{ railConnectionId: "rail_maria", provider: "simulated", kind: "payroll" as const, dataBasis: "payroll_gross" as const, retrievedOn: "2027-03-12" }];
    const railOnly = decide(decisionInput({ direct: { ...directEvidence(0, 0), items: railItems, sources: [], evidenceFlags: [flag] }, railReports }));
    expect(applyReviewerResolution(railOnly, resolution()).methodBasis).toBe("other_relevant_data_sources");
    const mixed = decide(decisionInput({ direct: { ...directEvidence(0, 4_500_000), items: [railItems[0], wageItem(DANIEL.id, 4_500_000)], evidenceFlags: [flag] }, railReports }));
    expect(applyReviewerResolution(mixed, resolution()).methodBasis).toBe("written_documentation_and_other_relevant_data_sources");
  });
});
