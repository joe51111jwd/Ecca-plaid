import { describe, expect, it } from "vitest";
import type { AwardLetterSummary, Extraction, IncomeAmount, IncomeDocumentSummary } from "@/engine/documents";
import { ageOnDate, mapDocument, toHouseholdMembers, type MappableDocument, type RosterMember, type StoredExtraction } from "./evidence-mapping";

/* All people, employers and amounts below are SYNTHETIC. */
const ROSTER: RosterMember[] = [
  { id: "hm_dana", kind: "adult", firstName: "Dana", lastName: "Sample", relationship: "parent", isOwner: true },
  { id: "hm_sam", kind: "adult", firstName: "Sam", lastName: "Sample", relationship: "parent", isOwner: false },
  { id: "hm_riley", kind: "student", firstName: "Riley", lastName: "Sample", relationship: "self", isOwner: false },
];

function extraction(partial: Partial<Extraction>): Extraction {
  return { parserVersion: "synthetic", subtype: "unknown", fields: {}, warnings: [], reviewReasons: [], notAcceptable: [], signals: [], award: null, income: null, ...partial };
}

function income(partial: Partial<IncomeDocumentSummary>): IncomeDocumentSummary {
  return { taxYear: 2025, people: [], amounts: [], selfEmploymentIndicated: false, payPeriod: null, payDate: null, likelyFinalStubOfYear: null, extractionConfidence: 0.95, extractedBy: "parser", ...partial };
}

function amount(measure: IncomeAmount["measure"], amountCents: number, extra: Partial<IncomeAmount> = {}): IncomeAmount {
  return { measure, amountCents, person: null, payer: null, suggestedCategory: null, fieldKey: measure, confidence: 0.95, ...extra };
}

function doc(stored: Partial<StoredExtraction> & { extraction: Extraction | null }, over: Partial<MappableDocument> = {}): MappableDocument {
  return {
    id: "doc_1",
    memberId: null,
    status: "extracted",
    declaredKind: "w2",
    detectedKind: stored.detectedKind ?? "w2",
    extractedBy: "parser",
    stored: { readerStatus: "extracted", detectedKind: "w2", extractedBy: "parser", synthetic: true, model: null, pageCount: 1, textSource: "pdf_text", ...stored },
    ...over,
  };
}

const award = (over: Partial<AwardLetterSummary> = {}): AwardLetterSummary => ({
  program: "SNAP",
  lookAlikeProgram: null,
  letterDate: "2026-10-01",
  approvalStatus: "approved",
  recipientName: "DANA SAMPLE",
  householdMembers: [],
  benefitPeriod: { start: "2026-10-01", end: "2027-03-31" },
  caseNumberMasked: null,
  issuingAgency: "Synthetic Agency",
  extractionConfidence: 0.95,
  extractedBy: "parser",
  ...over,
});

describe("toHouseholdMembers", () => {
  it("bands ages from a date of birth on the reference date, else by kind; the owner is head of household", () => {
    const out = toHouseholdMembers(
      [
        ...ROSTER,
        { id: "hm_teen", kind: "student", firstName: "Teen", lastName: "Sample", relationship: "sibling", isOwner: false, dob: "2008-11-19" },
        { id: "hm_turns18", kind: "child", firstName: "Eighteen", lastName: "Sample", relationship: "sibling", isOwner: false, dob: "2008-11-18" },
        { id: "hm_other", kind: "other", firstName: "Lodger", lastName: "Example", relationship: "unrelated", isOwner: false },
      ],
      "2026-11-18",
    );
    expect(out.map((m) => [m.id, m.ageBand, m.headOrSpouse, m.role])).toEqual([
      ["hm_dana", "adult", true, "family"],
      ["hm_sam", "adult", false, "family"],
      ["hm_riley", "minor", false, "family"],
      ["hm_teen", "minor", false, "family"],
      ["hm_turns18", "adult", false, "family"],
      ["hm_other", "unknown", false, "unrelated"],
    ]);
  });

  it("ageOnDate handles birthdays and leap days", () => {
    expect(ageOnDate("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageOnDate("2008-02-29", "2026-03-01")).toBe(18);
    expect(ageOnDate("2000-12-31", "2018-12-30")).toBe(17);
  });
});

describe("mapDocument: award letters", () => {
  it("maps a clean letter and matches the recipient to the roster", () => {
    const m = mapDocument(doc({ detectedKind: "award_letter", extraction: extraction({ subtype: "tx_hhsc_tf0001", award: award() }) }, { declaredKind: "award_letter", detectedKind: "award_letter" }), ROSTER);
    expect(m.letter).toMatchObject({ documentId: "doc_1", program: "SNAP", matchedMemberId: "hm_dana", extractionConfidence: 0.95, benefitPeriodEnd: "2027-03-31", documentType: "award_letter" });
    expect(m.letter!.nameMatchConfidence).toBeGreaterThan(0.9);
  });

  it("a letter the reader sent to review contributes confidence 0; a reviewer-keyed one is trusted", () => {
    const stored = { detectedKind: "award_letter" as const, readerStatus: "needs_review" as const, extraction: extraction({ award: award() }) };
    expect(mapDocument(doc(stored, { status: "needs_review", declaredKind: "award_letter" }), ROSTER).letter!.extractionConfidence).toBe(0);
    expect(mapDocument(doc(stored, { status: "needs_review", declaredKind: "award_letter", extractedBy: "reviewer" }), ROSTER).letter).toMatchObject({ extractionConfidence: 0.95, extractedBy: "reviewer" });
  });

  it("maps look-alike programs to names the engine refuses, and unknown ones to UNKNOWN", () => {
    const map = (over: Partial<AwardLetterSummary>) => mapDocument(doc({ detectedKind: "award_letter", extraction: extraction({ award: award(over) }) }, { declaredKind: "award_letter" }), ROSTER).letter!.program;
    expect(map({ program: null, lookAlikeProgram: "MEDICAID" })).toBe("MEDICAID");
    expect(map({ program: null, lookAlikeProgram: "SOCIAL_SECURITY_RETIREMENT_SURVIVORS" })).toBe("RSDI");
    expect(map({ program: null, lookAlikeProgram: "SCHOOL_MEALS" })).toBe("SCHOOL_MEALS");
    expect(map({ program: null, lookAlikeProgram: "PUBLIC_HOUSING" })).toBe("OTHER");
    expect(map({ program: null, lookAlikeProgram: null })).toBe("UNKNOWN");
  });

  it("an unreadable letter becomes an unrecognized letter (a person decides); ambiguous or unknown names are not matched", () => {
    const unreadable = mapDocument(doc({ detectedKind: "unknown", readerStatus: "unreadable", extraction: null }, { declaredKind: "award_letter", detectedKind: "unknown", status: "needs_review" }), ROSTER);
    expect(unreadable.letter).toMatchObject({ program: "UNKNOWN", letterDate: null, approvalStatus: "unclear", extractionConfidence: 0 });
    const stranger = mapDocument(doc({ detectedKind: "award_letter", extraction: extraction({ award: award({ recipientName: "CASEY PLACEHOLDER" }) }) }, { declaredKind: "award_letter" }), ROSTER);
    expect(stranger.letter).toMatchObject({ matchedMemberId: null, nameMatchConfidence: 0 });
    const twins = mapDocument(doc({ detectedKind: "award_letter", extraction: extraction({ award: award({ recipientName: "SAM SAMPLE" }) }) }, { declaredKind: "award_letter" }), [...ROSTER, { ...ROSTER[1]!, id: "hm_sam2" }]);
    expect(twins.letter!.matchedMemberId).toBeNull();
  });

  it("a benefit card is documentation other than a letter", () => {
    const m = mapDocument(doc({ detectedKind: "award_letter", extraction: extraction({ subtype: "benefit_card", award: award() }) }, { declaredKind: "award_letter" }), ROSTER);
    expect(m.letter!.documentType).toBe("other");
  });
});

describe("mapDocument: income documents", () => {
  it("one W-2 statement per employer, attributed by the printed name over the family's tag", () => {
    const ex = extraction({
      subtype: "irs_w2",
      fields: { "w2_1.tax_year": { value: 2025, confidence: 0.95, page: 1, snippet: null }, "w2_2.tax_year": { value: 2025, confidence: 0.95, page: 1, snippet: null } },
      income: income({
        amounts: [
          amount("w2_box1_wages", 4_125_000, { fieldKey: "w2_1.box_1_cents", person: "DANA SAMPLE", payer: "FIXTURE FOODS LLC" }),
          amount("w2_box5_medicare_wages", 4_300_000, { fieldKey: "w2_1.box_5_cents", person: "DANA SAMPLE" }),
          amount("w2_box1_wages", 1_000_000, { fieldKey: "w2_2.box_1_cents", person: "SAM SAMPLE", payer: "SAMPLE STAFFING LLC" }),
        ],
      }),
    });
    const m = mapDocument(doc({ extraction: ex }, { memberId: "hm_dana" }), ROSTER);
    expect(m.unread).toBe(false);
    expect(m.evidence).toEqual([
      { kind: "w2", sourceId: "doc_1", origin: "document", memberId: "hm_dana", taxYear: 2025, employerName: "FIXTURE FOODS LLC", wagesCents: 4_125_000, medicareWagesCents: 4_300_000 },
      { kind: "w2", sourceId: "doc_1", origin: "document", memberId: "hm_sam", taxYear: 2025, employerName: "SAMPLE STAFFING LLC", wagesCents: 1_000_000, medicareWagesCents: null },
    ]);
    expect(m.source).toEqual({ documentId: "doc_1", kind: "w2", extractedBy: "parser", extractionConfidence: 0.95 });
  });

  it("a W-2 that cannot be attributed is unread for that statement; nothing is guessed", () => {
    const ex = extraction({ subtype: "irs_w2", income: income({ amounts: [amount("w2_box1_wages", 100, { fieldKey: "w2_1.box_1_cents", person: "CASEY PLACEHOLDER" })] }) });
    const m = mapDocument(doc({ extraction: ex }), ROSTER);
    expect(m.evidence).toEqual([]);
    expect(m.unread).toBe(true);
    // With the family's tag, the statement is attributed to the tagged member.
    expect(mapDocument(doc({ extraction: ex }, { memberId: "hm_sam" }), ROSTER).evidence[0]).toMatchObject({ memberId: "hm_sam" });
  });

  it("an untrusted income document is evidence with confidence 0 (the engine routes it to a person)", () => {
    const ex = extraction({ subtype: "irs_w2", income: income({ amounts: [amount("w2_box1_wages", 100, { fieldKey: "w2_1.box_1_cents", person: "DANA SAMPLE" })] }) });
    const m = mapDocument(doc({ extraction: ex, readerStatus: "needs_review" }, { status: "needs_review" }), ROSTER);
    expect(m.source?.extractionConfidence).toBe(0);
  });

  it("pay stubs need a pay date and a member; nothing is projected", () => {
    const ex = extraction({ subtype: "pay_stub", income: income({ payDate: "2025-12-31", people: [{ name: "DANA SAMPLE", role: "employee", masked: false, ssnLast4: null }], amounts: [amount("paystub_gross_ytd", 5_000_000, { person: "DANA SAMPLE", payer: "FIXTURE FOODS LLC" })] }) });
    const m = mapDocument(doc({ detectedKind: "pay_stub", extraction: ex }, { declaredKind: "pay_stub" }), ROSTER);
    expect(m.evidence).toEqual([{ kind: "pay_stub", sourceId: "doc_1", origin: "document", memberId: "hm_dana", employerName: "FIXTURE FOODS LLC", payDate: "2025-12-31", payFrequency: null, grossYtdCents: 5_000_000, markedFinal: false }]);
    const noDate = extraction({ subtype: "pay_stub", income: income({ payDate: null }) });
    expect(mapDocument(doc({ detectedKind: "pay_stub", extraction: noDate }, { declaredKind: "pay_stub", memberId: "hm_dana" }), ROSTER).unread).toBe(true);
  });

  it("a Form 1040 lists other income only when line 9 proves every line was read", () => {
    const people = [
      { name: "DANA SAMPLE", role: "filer" as const, masked: false, ssnLast4: null },
      { name: "SAM SAMPLE", role: "spouse" as const, masked: false, ssnLast4: null },
      { name: "RILEY SAMPLE", role: "dependent" as const, masked: false, ssnLast4: null },
    ];
    const f1040 = (amounts: IncomeAmount[]) => mapDocument(doc({ detectedKind: "tax_return", extraction: extraction({ subtype: "form_1040", income: income({ people, amounts }) }) }, { declaredKind: "tax_return" }), ROSTER).evidence[0];

    const consistent = f1040([amount("f1040_wages_line_1z", 5_000_000), amount("f1040_taxable_interest", 10_000), amount("f1040_social_security_total", 200_000), amount("f1040_social_security_taxable", 50_000), amount("f1040_total_income", 5_060_000)]);
    expect(consistent).toMatchObject({ kind: "tax_record", form: "filed_return", memberIds: ["hm_dana", "hm_sam"], wagesCents: 5_000_000, otherIncome: { status: "itemized", lines: [{ line: "taxable_interest", amountCents: 10_000 }, { line: "social_security_benefits", amountCents: 200_000 }] } });
    expect(f1040([amount("f1040_wages_line_1z", 5_000_000), amount("f1040_total_income", 5_000_000)])).toMatchObject({ otherIncome: { status: "none" } });
    expect(f1040([amount("f1040_wages_line_1z", 5_000_000), amount("f1040_total_income", 5_900_000)])).toMatchObject({ otherIncome: { status: "not_read" } });
    expect(f1040([amount("f1040_wages_line_1z", 5_000_000)])).toMatchObject({ otherIncome: { status: "not_read" } });
    expect(f1040([amount("f1040_wages_line_1z", 5_000_000), amount("f1040_pensions_taxable", 1), amount("f1040_total_income", 5_000_001)])).toMatchObject({ otherIncome: { status: "not_read" } });
    expect(f1040([amount("f1040_wages_line_1a", 4_000_000), amount("f1040_total_income", 4_000_000)])).toMatchObject({ wagesCents: 4_000_000 });
    expect(f1040([amount("f1040_total_income", 1)])).toMatchObject({ wagesCents: null, otherIncome: { status: "not_read" } });
  });

  it("IRS transcripts: return transcripts check total income, wage and income transcripts sum W-2s, other IRS records are unread", () => {
    const tr = (subtype: Extraction["subtype"], amounts: IncomeAmount[]) =>
      mapDocument(doc({ detectedKind: "irs_transcript", extraction: extraction({ subtype, income: income({ amounts }) }) }, { declaredKind: "irs_transcript", memberId: "hm_dana" }), ROSTER);
    expect(tr("irs_tax_return_transcript", [amount("transcript_wages", 3_000_000), amount("transcript_unemployment", 100_000), amount("transcript_total_income", 3_100_000)]).evidence[0]).toMatchObject({
      form: "irs_return_transcript",
      memberIds: ["hm_dana"],
      otherIncome: { status: "itemized", lines: [{ line: "unemployment_compensation", amountCents: 100_000 }] },
    });
    expect(tr("irs_tax_return_transcript", [amount("transcript_wages", 3_000_000), amount("transcript_ira_total", 5), amount("transcript_total_income", 3_000_000)]).evidence[0]).toMatchObject({ otherIncome: { status: "not_read" } });
    expect(tr("irs_wage_income_transcript", [amount("wai_w2_wages", 1_000_000), amount("wai_w2_wages", 2_000_000)]).evidence[0]).toMatchObject({ form: "irs_wage_income_transcript", wagesCents: 3_000_000, otherIncome: { status: "none" } });
    expect(tr("irs_wage_income_transcript", [amount("wai_w2_wages", 1), amount("wai_1099_amount", 2)]).evidence[0]).toMatchObject({ otherIncome: { status: "not_read" } });
    expect(tr("irs_verification_of_nonfiling", []).unread).toBe(true);
    expect(tr("irs_account_transcript", []).unread).toBe(true);
  });

  it("other-income and unknown documents, and documents with nothing read, are unread", () => {
    expect(mapDocument(doc({ detectedKind: "other_income", extraction: extraction({ income: income({}) }) }, { declaredKind: "other_income" }), ROSTER)).toMatchObject({ unread: true, evidence: [], letter: null });
    expect(mapDocument(doc({ detectedKind: "unknown", extraction: null }, { declaredKind: "unknown", detectedKind: null }), ROSTER)).toMatchObject({ unread: true });
    expect(mapDocument({ ...doc({ extraction: null }), stored: null, status: "extracting" }, ROSTER)).toMatchObject({ unread: true, kind: "w2" });
  });
});
