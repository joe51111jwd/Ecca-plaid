import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocument, type DocumentKind } from "@/engine/documents";
import { buildReviewerExtraction, INCOME_MEASURES, parseReviewerExtraction } from "@/server/verifications/reviewer-extraction";
import { fieldName, formatFieldValue, INTERNAL_FIELD_KEYS, MEASURE_LABELS, measureFullLabel, presentFields, tidyKey, type StoredField } from "./field-labels";

describe("fieldName", () => {
  it("names W-2 boxes, groups them by statement and keeps the reader's bookkeeping internal", () => {
    expect(fieldName("w2_1.box_1_cents")).toMatchObject({ label: "Wages (box 1)", group: "W-2 statement 1", groupOrder: 1, internal: false });
    expect(fieldName("w2_1.box_2_cents").label).toBe("Federal tax withheld (box 2)");
    expect(fieldName("w2_2.employer_name")).toMatchObject({ label: "Employer", group: "W-2 statement 2", groupOrder: 2 });
    expect(fieldName("w2_1.tax_year").label).toBe("Tax year");
    expect(fieldName("w2_1.box_12a_code").label).toBe("Box 12a code");
    expect(fieldName("w2_1.box_12a_cents").label).toBe("Box 12a amount");
    expect(fieldName("w2_1.box_9_cents").label).toBe("Box 9");
    expect(fieldName("w2_1.copy").internal).toBe(true);
    expect(fieldName("w2_1.control_number_masked").internal).toBe(true);
    expect(fieldName("statement_count")).toMatchObject({ internal: true, group: null });
  });

  it("orders W-2 fields: who and when first, then the boxes in number order", () => {
    const ranks = ["w2_1.tax_year", "w2_1.employer_name", "w2_1.box_1_cents", "w2_1.box_2_cents", "w2_1.box_10_cents", "w2_1.box_12a_code", "w2_1.box_12a_cents", "w2_1.box_12b_code"].map((k) => fieldName(k).rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("names Form 1040 lines, falling back to the line number", () => {
    expect(fieldName("line_1a_cents").label).toBe("Wages from Forms W-2 (line 1a)");
    expect(fieldName("line_11a_cents").label).toBe("Adjusted gross income (line 11a)");
    expect(fieldName("line_99_cents").label).toBe("Line 99");
    expect(fieldName("line_1a_cents").rank).toBeLessThan(fieldName("line_1z_cents").rank);
    expect(fieldName("line_2a_cents").rank).toBeLessThan(fieldName("line_2b_cents").rank);
    expect(fieldName("line_9_cents").rank).toBeLessThan(fieldName("line_11a_cents").rank);
  });

  it("names transcript lines and wage-and-income forms", () => {
    expect(fieldName("item.wages_salaries_tips_etc_cents").label).toBe("Wages, salaries, tips");
    expect(fieldName("item.adjusted_gross_income_per_computer_cents").label).toBe("Adjusted gross income (per computer)");
    expect(fieldName("item.some_new_printed_line_cents").label).toBe("Some new printed line");
    expect(fieldName("form_2.payer")).toMatchObject({ label: "Payer", group: "Form 2 on the transcript", groupOrder: 2 });
    expect(fieldName("form_1.type").label).toBe("Form");
    expect(fieldName("form_1.nonemployee_compensation_cents").label).toBe("Nonemployee compensation");
  });

  it("names reviewer-keyed figures by their measure", () => {
    expect(fieldName("w2_1.w2_box1_wages_cents")).toMatchObject({ label: "Wages (box 1)", group: "W-2 statement 1" });
    expect(fieldName("f1040_agi_1_cents").label).toBe("Adjusted gross income (line 11a)");
    expect(fieldName("paystub_gross_ytd_2_cents").label).toBe("Gross pay year to date (2)");
    expect(fieldName("benefit_period_start").label).toBe("Benefit period start");
  });

  it("names numbered people", () => {
    expect(fieldName("household_member_3").label).toBe("Household member 3");
    expect(fieldName("dependent_2_name").label).toBe("Dependent 2");
  });

  it("falls back to a tidied key, never throws, never returns an empty label", () => {
    expect(fieldName("brand_new_reader_field")).toMatchObject({ label: "Brand new reader field", known: false });
    expect(fieldName("item.some_new_printed_line_cents").known).toBe(false);
    expect(fieldName("w2_1.box_1_cents").known).toBe(true);
    expect(fieldName("employee_ssn_last4_extra").label).toBe("Employee SSN last4 extra");
    for (const odd of ["", "_", "...", "w2_.x", "w2_1.", "form_x.payer", "item.", "__proto__", "constructor", "toString", "x".repeat(500)]) {
      const n = fieldName(odd);
      expect(n.label.length).toBeGreaterThan(0);
    }
    expect(tidyKey("")).toBe("Field");
    expect(tidyKey("hap_amount_cents")).toBe("HAP amount");
  });
});

describe("formatFieldValue", () => {
  it("shows cents as money, only for integer cents fields", () => {
    expect(formatFieldValue("w2_1.box_1_cents", 4_125_000)).toEqual({ kind: "money", cents: 4_125_000 });
    expect(formatFieldValue("line_7a_cents", -1200)).toEqual({ kind: "money", cents: -1200 });
    expect(formatFieldValue("w2_1.box_1_cents", 12.5)).toEqual({ kind: "text", text: "12.5" });
    expect(formatFieldValue("w2_1.box_1_cents", "4125000")).toEqual({ kind: "text", text: "4125000" });
  });

  it("never groups years, counts or codes", () => {
    expect(formatFieldValue("tax_year", 2025)).toEqual({ kind: "text", text: "2025" });
    expect(formatFieldValue("action_code", 6)).toEqual({ kind: "text", text: "6" });
    expect(formatFieldValue("statement_count", Number.NaN)).toEqual({ kind: "text", text: "—" });
  });

  it("shows real ISO dates as dates and months in words; leaves impossible dates as text", () => {
    expect(formatFieldValue("letter_date", "2026-09-15")).toEqual({ kind: "date", iso: "2026-09-15" });
    expect(formatFieldValue("ssi_effective_month", "2026-01")).toEqual({ kind: "text", text: "January 2026" });
    expect(formatFieldValue("letter_date", "2026-02-30")).toEqual({ kind: "text", text: "2026-02-30" });
    expect(formatFieldValue("letter_date", "2024-02-29")).toEqual({ kind: "date", iso: "2024-02-29" });
    expect(formatFieldValue("letter_date", "2025-02-29")).toEqual({ kind: "text", text: "2025-02-29" });
    expect(formatFieldValue("ssi_effective_month", "2026-13")).toEqual({ kind: "text", text: "2026-13" });
  });

  it("reads booleans, blanks and enums in words", () => {
    expect(formatFieldValue("self_employment_indicated", false)).toEqual({ kind: "text", text: "No" });
    expect(formatFieldValue("nonfiler_supported", true)).toEqual({ kind: "text", text: "Yes" });
    expect(formatFieldValue("recipient_name", null)).toEqual({ kind: "missing" });
    expect(formatFieldValue("recipient_name", "   ")).toEqual({ kind: "missing" });
    expect(formatFieldValue("approval_status", "approved")).toEqual({ kind: "text", text: "Approved" });
    expect(formatFieldValue("program", "SECTION_8")).toEqual({ kind: "text", text: "Section 8 housing" });
    expect(formatFieldValue("look_alike_program", "SCHOOL_MEALS")).toEqual({ kind: "text", text: "School meals" });
    expect(formatFieldValue("program", "SOMETHING_NEW")).toEqual({ kind: "text", text: "SOMETHING_NEW" });
    expect(formatFieldValue("filing_status", "married_filing_jointly")).toEqual({ kind: "text", text: "Married filing jointly" });
    expect(formatFieldValue("employer_name", "FIXTURE FOODS LLC")).toEqual({ kind: "text", text: "FIXTURE FOODS LLC" });
  });
});

describe("presentFields", () => {
  const w2: StoredField[] = [
    { key: "w2_1.box_2_cents", value: 210_000, confidence: 0.95 },
    { key: "statement_count", value: 1, confidence: 0.95 },
    { key: "w2_1.copy", value: "B", confidence: 0.95 },
    { key: "w2_1.box_1_cents", value: 4_125_000, confidence: 0.95 },
    { key: "w2_1.tax_year", value: 2025, confidence: 0.95 },
    { key: "w2_1.zz_unknown", value: "x", confidence: 0.95 },
    { key: "w2_1.aa_unknown", value: "y", confidence: 0.95 },
  ];

  it("hides internal fields, orders the rest and keeps unknown fields in stored order at the end", () => {
    const p = presentFields(w2);
    expect(p.primary.map((f) => f.key)).toEqual(["w2_1.tax_year", "w2_1.box_1_cents", "w2_1.box_2_cents", "w2_1.zz_unknown", "w2_1.aa_unknown"]);
    expect(p.internal.map((f) => f.key)).toEqual(["statement_count", "w2_1.copy"]);
    expect(p.grouped).toBe(false);
    expect(p.primary[1]).toMatchObject({ label: "Wages (box 1)", display: { kind: "money", cents: 4_125_000 }, confidence: 0.95 });
  });

  it("never hides an internal field the reader was unsure of", () => {
    const p = presentFields([{ key: "statement_count", value: 2, confidence: 0.5 }]);
    expect(p.primary.map((f) => f.key)).toEqual(["statement_count"]);
    expect(p.internal).toEqual([]);
    expect(presentFields([{ key: "statement_count", value: 2, confidence: 0.5 }], { minConfidence: 0.4 }).internal).toHaveLength(1);
  });

  it("groups several statements, document-level fields first", () => {
    const p = presentFields([
      { key: "w2_2.box_1_cents", value: 600_000, confidence: 1 },
      { key: "w2_1.box_1_cents", value: 4_125_000, confidence: 1 },
      { key: "tax_year", value: 2025, confidence: 1 },
    ]);
    expect(p.grouped).toBe(true);
    expect(p.primary.map((f) => f.key)).toEqual(["tax_year", "w2_1.box_1_cents", "w2_2.box_1_cents"]);
  });

  it("handles an empty list", () => {
    expect(presentFields([])).toEqual({ primary: [], internal: [], grouped: false });
  });
});

describe("measure labels", () => {
  it("cover every measure the reviewer can key, each with a family and a name", () => {
    for (const m of INCOME_MEASURES) {
      expect(MEASURE_LABELS[m].short.length).toBeGreaterThan(0);
      expect(measureFullLabel(m)).toBe(`${MEASURE_LABELS[m].family}: ${MEASURE_LABELS[m].short}`);
    }
    expect(Object.keys(MEASURE_LABELS).sort()).toEqual([...INCOME_MEASURES].sort());
    expect(measureFullLabel("hasOwnProperty")).toBe("Hasownproperty");
  });
});

/** Every field key the reader and the keying form actually produce has a real label (no tidied-key fallback). */
describe("coverage of the keys the reader produces", () => {
  const DIR = resolve(__dirname, "../../../tests/fixtures/synthetic");
  const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as { fixtures: Array<{ file: string; contentType: string; declaredKind: DocumentKind }> };

  it("SYNTHETIC fixtures: every extracted key is named", async () => {
    const unnamed = new Set<string>();
    let seen = 0;
    for (const f of manifest.fixtures) {
      const r = await readDocument({ bytes: new Uint8Array(readFileSync(join(DIR, f.file))), contentType: f.contentType, declaredKind: f.declaredKind });
      for (const key of Object.keys(r.extraction?.fields ?? {})) {
        seen++;
        if (!fieldName(key).known) unnamed.add(key);
      }
    }
    expect(seen).toBeGreaterThan(50);
    expect([...unnamed]).toEqual([]);
  }, 60_000);

  it("reviewer-keyed W-2, pay stub and award letter keys are named", () => {
    const ctx = { reviewerId: "user_synthetic", keyedAt: new Date("2026-11-18T16:00:00Z"), previous: null, previousExtractedBy: null };
    const w2 = buildReviewerExtraction(
      parseReviewerExtraction({ kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 100, statement: 1 }, { measure: "w2_box5_medicare_wages", amountCents: 100, statement: 2 }] } }),
      ctx,
    );
    const stub = buildReviewerExtraction(parseReviewerExtraction({ kind: "pay_stub", income: { taxYear: null, payDate: "2025-12-26", amounts: [{ measure: "paystub_gross_ytd", amountCents: 100 }] } }), ctx);
    const letter = buildReviewerExtraction(
      parseReviewerExtraction({ kind: "award_letter", award: { program: "SNAP", approvalStatus: "approved", letterDate: "2026-09-15", recipientName: "DANA SAMPLE", issuingAgency: "Synthetic agency", benefitPeriod: { start: "2026-09-01", end: "2027-02-28" } } }),
      ctx,
    );
    const keys = [w2, stub, letter].flatMap((s) => Object.keys(s.extraction?.fields ?? {}));
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) expect(fieldName(key).known, key).toBe(true);
  });

  it("every internal key has a real label", () => {
    for (const k of INTERNAL_FIELD_KEYS) expect(fieldName(k).known, k).toBe(true);
  });
});
