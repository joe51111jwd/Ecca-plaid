import { describe, expect, it } from "vitest";
import { categoricalValidUntil, CATEGORICAL_PROGRAM_LABELS, classifyProgram, evaluateAwardLetter, evaluateCategorical, isWithinLetterWindow, type EvaluateLetterContext } from "./categorical";
import { DEFAULT_DECISION_POLICY } from "./policy";
import { awardLetter, FAMILY_OF_FOUR, MARIA, TODAY } from "./test-fixtures";
import { CATEGORICAL_PROGRAMS, LETTER_AMBIGUOUS_CODES, LETTER_DISQUALIFYING_CODES, type AwardLetterInput } from "./types";

const context = (overrides: Partial<EvaluateLetterContext> = {}): EvaluateLetterContext => ({ applicationDate: TODAY, today: TODAY, members: FAMILY_OF_FOUR, policy: DEFAULT_DECISION_POLICY, ...overrides });
const evaluate = (overrides: Partial<AwardLetterInput> = {}, ctx: Partial<EvaluateLetterContext> = {}) => evaluateAwardLetter(awardLetter(overrides), context(ctx));
const codes = (evaluation: ReturnType<typeof evaluate>) => evaluation.defects.map((defect) => defect.code);

describe("classifyProgram", () => {
  it("accepts exactly the five programs of the proposed rule, by id or by the name the rule uses", () => {
    expect(CATEGORICAL_PROGRAMS).toEqual(["SNAP", "TANF", "WIC", "SECTION_8", "SSI"]);
    for (const program of CATEGORICAL_PROGRAMS) expect(classifyProgram(program)).toEqual({ kind: "qualifying", program });
    expect(classifyProgram("snap")).toEqual({ kind: "qualifying", program: "SNAP" });
    expect(classifyProgram("Section 8")).toEqual({ kind: "qualifying", program: "SECTION_8" });
    expect(classifyProgram("section-8 housing")).toEqual({ kind: "qualifying", program: "SECTION_8" });
    expect(classifyProgram("Supplemental Nutrition Assistance Program")).toEqual({ kind: "qualifying", program: "SNAP" });
    expect(classifyProgram("Temporary Assistance for Needy Families")).toEqual({ kind: "qualifying", program: "TANF" });
    expect(classifyProgram("Special Supplemental Nutrition Program for Women, Infants, and Children")).toEqual({ kind: "qualifying", program: "WIC" });
    expect(classifyProgram("Supplemental Security Income")).toEqual({ kind: "qualifying", program: "SSI" });
  });

  it("names the programs families commonly send that are not on the list", () => {
    expect(classifyProgram("Medicaid")).toEqual({ kind: "not_qualifying", code: "program_medicaid_not_listed" });
    expect(classifyProgram("CHIP")).toEqual({ kind: "not_qualifying", code: "program_chip_not_listed" });
    expect(classifyProgram("SSDI")).toEqual({ kind: "not_qualifying", code: "program_ssdi_rsdi_not_listed" });
    expect(classifyProgram("rsdi")).toEqual({ kind: "not_qualifying", code: "program_ssdi_rsdi_not_listed" });
    expect(classifyProgram("school_meals")).toEqual({ kind: "not_qualifying", code: "program_school_meals_not_accepted" });
    expect(classifyProgram("Free or reduced-price lunch")).toEqual({ kind: "not_qualifying", code: "program_school_meals_not_accepted" });
    expect(classifyProgram("OTHER")).toEqual({ kind: "not_qualifying", code: "program_not_listed" });
  });

  it("does not guess at anything else", () => {
    for (const text of ["", "UNKNOWN", "Benefits", "S.N.A.P. maybe", "SSI/SSDI", "hasOwnProperty", "constructor"]) {
      expect(classifyProgram(text), text).toEqual({ kind: "not_recognized" });
    }
  });

  it("labels each program in English and Spanish", () => {
    for (const program of CATEGORICAL_PROGRAMS) {
      expect(CATEGORICAL_PROGRAM_LABELS[program].en.length).toBeGreaterThan(2);
      expect(CATEGORICAL_PROGRAM_LABELS[program].es.length).toBeGreaterThan(2);
    }
  });
});

describe("the 12-month window", () => {
  it("is inclusive at both ends: the day before fails, the day itself and the reference date pass, the day after the reference date fails", () => {
    expect(isWithinLetterWindow("2026-03-14", "2027-03-15", 12)).toBe(false);
    expect(isWithinLetterWindow("2026-03-15", "2027-03-15", 12)).toBe(true);
    expect(isWithinLetterWindow("2026-03-16", "2027-03-15", 12)).toBe(true);
    expect(isWithinLetterWindow("2027-03-15", "2027-03-15", 12)).toBe(true);
    expect(isWithinLetterWindow("2027-03-16", "2027-03-15", 12)).toBe(false);
  });

  it("handles month ends and leap days by calendar months, never spilling into the next month", () => {
    // 12 months before February 29, 2028 is February 28, 2027 (there is no February 29, 2027).
    expect(isWithinLetterWindow("2027-02-28", "2028-02-29", 12)).toBe(true);
    expect(isWithinLetterWindow("2027-02-27", "2028-02-29", 12)).toBe(false);
    // A letter dated on a leap day is inside the window through February 28 of the next year and outside on March 1.
    expect(isWithinLetterWindow("2028-02-29", "2029-02-28", 12)).toBe(true);
    expect(isWithinLetterWindow("2028-02-29", "2029-03-01", 12)).toBe(false);
    // The day after a leap day.
    expect(isWithinLetterWindow("2028-02-29", "2028-03-01", 12)).toBe(true);
    expect(isWithinLetterWindow("2027-03-01", "2028-03-01", 12)).toBe(true);
    expect(isWithinLetterWindow("2027-02-28", "2028-03-01", 12)).toBe(false);
  });

  it("applies the boundary to letters: day before, on, and after", () => {
    expect(evaluate({ letterDate: "2026-03-14" })).toMatchObject({ outcome: "fail", defects: [{ code: "letter_older_than_12_months", kind: "disqualifying" }] });
    expect(evaluate({ letterDate: "2026-03-15" })).toMatchObject({ outcome: "pass", defects: [], windowEndsOn: "2027-03-15" });
    expect(evaluate({ letterDate: "2026-03-16" })).toMatchObject({ outcome: "pass", windowEndsOn: "2027-03-16" });
    expect(evaluate({ letterDate: TODAY }).outcome).toBe("pass");
  });

  it("applies the boundary to leap-day letters and leap-day decisions", () => {
    const leapLetter = { letterDate: "2028-02-29" };
    expect(evaluate(leapLetter, { applicationDate: "2029-02-28", today: "2029-02-28" })).toMatchObject({ outcome: "pass", windowEndsOn: "2029-02-28" });
    expect(evaluate(leapLetter, { applicationDate: "2029-03-01", today: "2029-03-01" }).outcome).toBe("fail");
    expect(evaluate({ letterDate: "2027-02-28" }, { applicationDate: "2028-02-29", today: "2028-02-29" }).outcome).toBe("pass");
    expect(evaluate({ letterDate: "2027-02-27" }, { applicationDate: "2028-02-29", today: "2028-02-29" }).outcome).toBe("fail");
  });

  it("sends a letter to review when the answer depends on which date the 12 months are counted from", () => {
    // Inside the window on the application date, outside it on the decision date.
    const aged = evaluate({ letterDate: "2026-03-01" }, { applicationDate: "2027-02-20", today: "2027-03-15" });
    expect(aged.outcome).toBe("review");
    expect(codes(aged)).toEqual(["letter_window_depends_on_reference_date"]);
    // Dated after the application and before the decision.
    const later = evaluate({ letterDate: "2027-03-01" }, { applicationDate: "2027-02-20", today: "2027-03-15" });
    expect(codes(later)).toEqual(["letter_window_depends_on_reference_date"]);
    // Outside both windows.
    expect(evaluate({ letterDate: "2026-02-19" }, { applicationDate: "2027-02-20", today: "2027-03-15" }).outcome).toBe("fail");
    // Inside both.
    expect(evaluate({ letterDate: "2026-03-15" }, { applicationDate: "2027-02-20", today: "2027-03-15" }).outcome).toBe("pass");
  });

  it("never passes a letter dated after the decision date", () => {
    const future = evaluate({ letterDate: "2027-03-16" });
    expect(future.outcome).toBe("review");
    expect(codes(future)).toEqual(["letter_dated_in_future"]);
  });

  it("cannot check the window without a date", () => {
    const undated = evaluate({ letterDate: null });
    expect(undated).toMatchObject({ outcome: "review", windowEndsOn: null });
    expect(codes(undated)).toEqual(["letter_date_unreadable"]);
  });
});

describe("evaluateAwardLetter", () => {
  it("passes a current approval for each of the five programs, for any household member", () => {
    for (const program of CATEGORICAL_PROGRAMS) {
      expect(evaluate({ program })).toMatchObject({ outcome: "pass", program, defects: [], matchedMemberId: MARIA.id });
    }
    expect(evaluate({ matchedMemberId: "hm_mateo" }).outcome).toBe("pass");
  });

  it.each([
    ["Medicaid", "program_medicaid_not_listed"],
    ["CHIP", "program_chip_not_listed"],
    ["SSDI", "program_ssdi_rsdi_not_listed"],
    ["RSDI", "program_ssdi_rsdi_not_listed"],
    ["SCHOOL_MEALS", "program_school_meals_not_accepted"],
    ["OTHER", "program_not_listed"],
  ])("fails a trusted %s letter with an explicit reason", (program, code) => {
    const evaluation = evaluate({ program });
    expect(evaluation).toMatchObject({ outcome: "fail", program: null, programAsRead: program });
    expect(evaluation.defects).toEqual([expect.objectContaining({ code, kind: "disqualifying" })]);
  });

  it("says that school-wide meal eligibility is not enough, as the proposed rules do", () => {
    expect(evaluate({ program: "SCHOOL_MEALS" }).defects[0].message).toMatch(/entire school.*not adequate/);
  });

  it("sends an unrecognized program to review", () => {
    const evaluation = evaluate({ program: "UNKNOWN" });
    expect(evaluation.outcome).toBe("review");
    expect(codes(evaluation)).toEqual(["program_not_recognized"]);
  });

  it.each([
    ["denied", "letter_shows_denial", "fail"],
    ["terminated", "letter_shows_termination", "fail"],
    ["pending", "letter_shows_pending_application", "fail"],
    ["unclear", "approval_status_unclear", "review"],
  ] as const)("does not pass a letter whose approval status is %s", (approvalStatus, code, outcome) => {
    const evaluation = evaluate({ approvalStatus });
    expect(evaluation.outcome).toBe(outcome);
    expect(codes(evaluation)).toEqual([code]);
  });

  it("does not treat an ended benefit period as current approval, even inside the 12 months", () => {
    const ended = evaluate({ benefitPeriodEnd: "2027-03-14" });
    expect(ended.outcome).toBe("review");
    expect(codes(ended)).toEqual(["benefit_period_ended"]);
    expect(evaluate({ benefitPeriodEnd: TODAY }).outcome).toBe("pass");
    expect(evaluate({ benefitPeriodEnd: "2027-09-30" })).toMatchObject({ outcome: "pass", benefitPeriodEnd: "2027-09-30" });
    // Ended between the application and the decision.
    expect(codes(evaluate({ benefitPeriodEnd: "2027-03-01" }, { applicationDate: "2027-02-20", today: "2027-03-15" }))).toEqual(["benefit_period_ended"]);
  });

  it("requires the recipient to be matched to the roster with confidence", () => {
    expect(codes(evaluate({ matchedMemberId: null }))).toEqual(["recipient_not_matched"]);
    const stranger = evaluate({ matchedMemberId: "hm_not_on_roster" });
    expect(codes(stranger)).toEqual(["recipient_not_matched"]);
    expect(stranger.matchedMemberId).toBeNull();
    expect(codes(evaluate({ nameMatchConfidence: 0.89 }))).toEqual(["recipient_match_low_confidence"]);
    expect(evaluate({ nameMatchConfidence: 0.9 }).outcome).toBe("pass");
  });

  it("never passes a low-confidence read", () => {
    const blurry = evaluate({ extractionConfidence: 0.89 });
    expect(blurry.outcome).toBe("review");
    expect(codes(blurry)).toEqual(["letter_low_extraction_confidence"]);
    expect(evaluate({ extractionConfidence: 0.9 }).outcome).toBe("pass");
    expect(evaluate({ extractionConfidence: 0 }).outcome).toBe("review");
  });

  it("never passes a model read in v1, however confident the model says it is", () => {
    const model = evaluate({ extractedBy: "model", extractionConfidence: 1, nameMatchConfidence: 1 });
    expect(model.outcome).toBe("review");
    expect(codes(model)).toEqual(["letter_read_by_model"]);
    // The switch exists as policy; when a later version turns it on, the confidence floor still applies.
    const permissive = { ...DEFAULT_DECISION_POLICY, modelReadDocumentsMayAutoDecide: true };
    expect(evaluate({ extractedBy: "model", extractionConfidence: 1, nameMatchConfidence: 1 }, { policy: permissive }).outcome).toBe("pass");
    expect(evaluate({ extractedBy: "model", extractionConfidence: 0.5 }, { policy: permissive }).outcome).toBe("review");
  });

  it("does not let an untrusted read settle a letter either way", () => {
    // A blurry or model-read letter that looks like a denial or like Medicaid still goes to a person.
    const blurryDenial = evaluate({ approvalStatus: "denied", extractionConfidence: 0.4 });
    expect(blurryDenial.outcome).toBe("review");
    expect(codes(blurryDenial)).toEqual(["letter_low_extraction_confidence", "letter_shows_denial"]);
    expect(evaluate({ program: "MEDICAID", extractedBy: "model" }).outcome).toBe("review");
    expect(evaluate({ letterDate: "2025-01-01", extractedBy: "model" }).outcome).toBe("review");
  });

  it("trusts the fields a reviewer keyed, and still applies the rule to them", () => {
    const keyed = { extractedBy: "reviewer" as const, extractionConfidence: 0, nameMatchConfidence: 0 };
    expect(evaluate(keyed)).toMatchObject({ outcome: "pass", defects: [] });
    expect(evaluate({ ...keyed, program: "MEDICAID" }).outcome).toBe("fail");
    expect(evaluate({ ...keyed, letterDate: "2026-03-14" }).outcome).toBe("fail");
    expect(evaluate({ ...keyed, matchedMemberId: null }).outcome).toBe("review");
    expect(evaluate({ ...keyed, approvalStatus: "unclear" }).outcome).toBe("review");
  });

  it("fails rather than reviews when a trusted read shows a disqualifying defect next to a doubtful one", () => {
    const evaluation = evaluate({ program: "MEDICAID", matchedMemberId: null });
    expect(evaluation.outcome).toBe("fail");
    expect(codes(evaluation)).toEqual(["program_medicaid_not_listed", "recipient_not_matched"]);
  });

  it("has a message for every defect code, worded as proposed rules where it states the rule", () => {
    const seen = new Map<string, string>();
    const record = (evaluation: ReturnType<typeof evaluate>) => evaluation.defects.forEach((defect) => seen.set(defect.code, defect.message));
    for (const program of ["MEDICAID", "CHIP", "SSDI", "SCHOOL_MEALS", "OTHER", "UNKNOWN"]) record(evaluate({ program }));
    for (const approvalStatus of ["denied", "terminated", "pending", "unclear"] as const) record(evaluate({ approvalStatus }));
    record(evaluate({ letterDate: "2025-01-01" }));
    record(evaluate({ letterDate: null }));
    record(evaluate({ letterDate: "2028-01-01" }));
    record(evaluate({ letterDate: "2026-03-01" }, { applicationDate: "2027-02-20" }));
    record(evaluate({ benefitPeriodEnd: "2027-01-31" }));
    record(evaluate({ matchedMemberId: null }));
    record(evaluate({ nameMatchConfidence: 0.2 }));
    record(evaluate({ extractionConfidence: 0.2 }));
    record(evaluate({ extractedBy: "model" }));
    expect([...seen.keys()].sort()).toEqual([...LETTER_DISQUALIFYING_CODES, ...LETTER_AMBIGUOUS_CODES].sort());
    for (const [code, message] of seen) {
      expect(message.length, code).toBeGreaterThan(20);
      expect(message, code).not.toMatch(/Maria|Synthetic/);
      if (code.startsWith("program_") && code !== "program_not_recognized") expect(message, code).toContain("proposed rules");
    }
  });
});

describe("categoricalValidUntil", () => {
  it("is the earliest of December 31 of the application year, the end of the 12-month window and the benefit period end", () => {
    expect(categoricalValidUntil({ windowEndsOn: "2028-01-10", benefitPeriodEnd: null }, "2027-03-15")).toBe("2027-12-31");
    expect(categoricalValidUntil({ windowEndsOn: "2027-06-01", benefitPeriodEnd: null }, "2027-03-15")).toBe("2027-06-01");
    expect(categoricalValidUntil({ windowEndsOn: "2027-06-01", benefitPeriodEnd: "2027-04-30" }, "2027-03-15")).toBe("2027-04-30");
    expect(categoricalValidUntil({ windowEndsOn: "2028-02-28", benefitPeriodEnd: "2028-06-30" }, "2027-03-15")).toBe("2027-12-31");
  });

  it("keeps the letter inside its window on the last valid day", () => {
    for (const letterDate of ["2026-03-15", "2026-08-31", "2028-02-29", "2027-02-28", "2026-12-31"]) {
      const evaluation = evaluate({ letterDate }, { applicationDate: letterDate, today: letterDate });
      expect(isWithinLetterWindow(letterDate, evaluation.windowEndsOn!, 12), letterDate).toBe(true);
    }
  });
});

describe("evaluateCategorical", () => {
  it("reports none, pass, review and fail", () => {
    expect(evaluateCategorical([], context())).toEqual({ outcome: "none", letters: [], best: null });
    expect(evaluateCategorical([awardLetter()], context()).outcome).toBe("pass");
    expect(evaluateCategorical([awardLetter({ extractedBy: "model" })], context())).toMatchObject({ outcome: "review", best: null });
    expect(evaluateCategorical([awardLetter({ program: "MEDICAID" })], context())).toMatchObject({ outcome: "fail", best: null });
  });

  it("passes on one good letter among bad ones, and reviews when the only hope needs a person", () => {
    const good = awardLetter({ documentId: "doc_good" });
    const medicaid = awardLetter({ documentId: "doc_medicaid", program: "MEDICAID" });
    const blurry = awardLetter({ documentId: "doc_blurry", extractionConfidence: 0.3 });
    expect(evaluateCategorical([medicaid, blurry, good], context())).toMatchObject({ outcome: "pass", best: { documentId: "doc_good" } });
    expect(evaluateCategorical([medicaid, blurry], context()).outcome).toBe("review");
  });

  it("rests on the passing letter that stays valid longest, with a stable tie-break", () => {
    const older = awardLetter({ documentId: "doc_b", letterDate: "2026-05-01", program: "WIC" });
    const newer = awardLetter({ documentId: "doc_c", letterDate: "2026-11-01", program: "SSI" });
    const twin = awardLetter({ documentId: "doc_a", letterDate: "2026-11-01", program: "TANF" });
    expect(evaluateCategorical([older, newer], context()).best).toMatchObject({ documentId: "doc_c", program: "SSI" });
    expect(evaluateCategorical([newer, twin, older], context()).best!.documentId).toBe("doc_a");
    expect(evaluateCategorical([older, twin, newer], context()).best!.documentId).toBe("doc_a");
    // A newer letter whose benefit period ends sooner is not the better basis.
    const shortLived = awardLetter({ documentId: "doc_short", letterDate: "2027-02-01", benefitPeriodEnd: "2027-03-31" });
    expect(evaluateCategorical([shortLived, older], context()).best!.documentId).toBe("doc_b");
  });
});
