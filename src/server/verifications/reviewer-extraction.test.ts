import { describe, expect, it } from "vitest";
import type { Extraction } from "@/engine/documents";
import { mapDocument, type RosterMember, type StoredExtraction } from "./evidence-mapping";
import { buildReviewerExtraction, INCOME_MEASURES, parseReviewerExtraction, REVIEWER_EXTRACTION_VERSION } from "./reviewer-extraction";

/* Every person, employer and amount is SYNTHETIC. */
const ROSTER: RosterMember[] = [
  { id: "hm_dana", kind: "adult", firstName: "Dana", lastName: "Sample", relationship: "parent", isOwner: true },
  { id: "hm_riley", kind: "student", firstName: "Riley", lastName: "Sample", relationship: "self", isOwner: false },
];
const AT = new Date("2026-11-18T16:00:00.000Z");
const ctx = (previous: StoredExtraction | null = null) => ({ reviewerId: "usr_REVIEWER", keyedAt: AT, previous, previousExtractedBy: previous ? ("parser" as const) : null });

function mapped(stored: StoredExtraction, declaredKind: "w2" | "award_letter" | "pay_stub" | "tax_return" | "irs_transcript" = "w2") {
  return mapDocument({ id: "doc_1", memberId: null, status: "extracted", declaredKind, detectedKind: stored.detectedKind, extractedBy: "reviewer", stored }, ROSTER);
}

describe("reviewer-keyed extraction", () => {
  it("covers every income measure the reader knows", () => {
    expect(INCOME_MEASURES).toContain("w2_box1_wages");
    expect(INCOME_MEASURES).toContain("wai_1099_amount");
    expect(new Set(INCOME_MEASURES).size).toBe(INCOME_MEASURES.length);
  });

  it("builds W-2 statements the mapping reads as trusted evidence with confidence 1, per statement and tax year", () => {
    const input = parseReviewerExtraction({
      kind: "w2",
      income: {
        taxYear: 2025,
        amounts: [
          { measure: "w2_box1_wages", amountCents: 3_000_000, person: "DANA SAMPLE", payer: "FIXTURE FOODS LLC", statement: 1 },
          { measure: "w2_box1_wages", amountCents: 1_125_000, person: "DANA SAMPLE", payer: "SAMPLE TOOLS INC", statement: 2 },
        ],
      },
    });
    const stored = buildReviewerExtraction(input, ctx());
    expect(stored).toMatchObject({ readerStatus: "extracted", detectedKind: "w2", extractedBy: null, reviewerKeyed: { reviewerId: "usr_REVIEWER", keyedAt: AT.toISOString(), notes: null } });
    expect(stored.extraction?.parserVersion).toBe(REVIEWER_EXTRACTION_VERSION);
    expect(stored.extraction?.fields["w2_1.tax_year"]?.value).toBe(2025);
    expect(stored.extraction?.fields["w2_2.w2_box1_wages_cents"]).toMatchObject({ value: 1_125_000, confidence: 1 });
    const m = mapped(stored);
    expect(m.unread).toBe(false);
    expect(m.evidence).toHaveLength(2);
    expect(m.evidence.map((e) => (e.kind === "w2" ? e.wagesCents : 0)).sort()).toEqual([1_125_000, 3_000_000]);
    expect(m.source).toMatchObject({ extractedBy: "reviewer", extractionConfidence: 1 });
  });

  it("builds an award letter the decision engine can evaluate, with a default subtype per program", () => {
    const stored = buildReviewerExtraction(parseReviewerExtraction({ kind: "award_letter", award: { program: "WIC", letterDate: "2026-10-01", approvalStatus: "approved", recipientName: "DANA SAMPLE" } }), ctx());
    expect(stored.extraction?.subtype).toBe("wic_certification");
    expect(mapped(stored, "award_letter").letter).toMatchObject({ program: "WIC", letterDate: "2026-10-01", matchedMemberId: "hm_dana", extractionConfidence: 1, extractedBy: "reviewer", documentType: "award_letter" });
    const lookAlike = buildReviewerExtraction(parseReviewerExtraction({ kind: "award_letter", award: { program: null, lookAlikeProgram: "MEDICAID", letterDate: "2026-10-01", approvalStatus: "approved", recipientName: null } }), ctx());
    expect(mapped(lookAlike, "award_letter").letter?.program).toBe("MEDICAID");
  });

  it("keeps what the reader had produced, and keeps the original reading when a reviewer corrects twice", () => {
    const parserReading: Extraction = { parserVersion: "documents-parser.synthetic", subtype: "irs_w2", fields: {}, warnings: [], reviewReasons: [], notAcceptable: [], signals: [], award: null, income: null };
    const previous: StoredExtraction = { readerStatus: "needs_review", detectedKind: "w2", extraction: parserReading, extractedBy: "parser", synthetic: true, model: null, pageCount: 1, textSource: "pdf_text" };
    const input = parseReviewerExtraction({ kind: "w2", notes: "  keyed  from the photo ", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 1 }] } });
    const first = buildReviewerExtraction(input, ctx(previous));
    expect(first.replacedExtraction).toEqual(parserReading);
    expect(first.reviewerKeyed?.notes).toBe("keyed from the photo");
    expect(first.synthetic).toBe(true);
    const second = buildReviewerExtraction(input, ctx(first));
    expect(second.replacedExtraction).toEqual(parserReading);
  });

  it("refuses input outside the reader's vocabulary with field paths", () => {
    const fieldsOf = (raw: unknown): Record<string, string> => {
      try {
        parseReviewerExtraction(raw);
        return {};
      } catch (e) {
        return (e as { details: { fields: Record<string, string> } }).details.fields;
      }
    };
    expect(Object.keys(fieldsOf({ kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "f1040_agi", amountCents: 1 }] } }))).toContain("income.amounts.0.measure");
    expect(Object.keys(fieldsOf({ kind: "tax_return", income: { taxYear: 2025, amounts: [{ measure: "f1040_total_income", amountCents: 1, statement: 2 }] } }))).toContain("income.amounts.0.statement");
    expect(Object.keys(fieldsOf({ kind: "award_letter", award: { program: "SNAP", letterDate: "2026-13-01", approvalStatus: "approved", recipientName: null } }))).toContain("award.letterDate");
    expect(Object.keys(fieldsOf({ kind: "award_letter", award: { program: "SNAP", letterDate: null, approvalStatus: "approved", recipientName: "A\u0000B" } }))).toContain("award.recipientName");
    expect(Object.keys(fieldsOf({ kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 10_000_000_000_001 }] } }))).toContain("income.amounts.0.amountCents");
    expect(Object.keys(fieldsOf({ kind: "unknown" }))).toContain("kind");
    expect(Object.keys(fieldsOf({ kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 1 }] }, award: { program: "SNAP", letterDate: null, approvalStatus: "approved", recipientName: null } }))).toContain("award");
  });
});
