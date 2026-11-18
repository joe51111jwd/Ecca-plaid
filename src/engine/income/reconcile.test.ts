import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  classifyPayStub,
  computeHouseholdIncome,
  projectAnnualFromYtd,
  reconcileIncomeEvidence,
  RECONCILIATION_POLICY,
  TAX_RECORD_LINE_KEYS,
  TAX_RECORD_LINES,
  WAGE_SOURCE_PRECEDENCE,
  getIncomeCategory,
  type IncomeEvidence,
  type PayStubEvidence,
  type TaxRecordEvidence,
  type W2Evidence,
} from "./index";

/* Synthetic evidence. No real documents, employers or people. */
const YEAR = 2026;
const A = "hm_a";
const B = "hm_b";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${++seq}`;
const w2 = (partial: Partial<W2Evidence> = {}): W2Evidence => ({
  kind: "w2",
  sourceId: nextId("doc_w2"),
  origin: "document",
  memberId: A,
  taxYear: YEAR,
  employerName: "Synthetic Employer One",
  wagesCents: 5_200_000,
  medicareWagesCents: 5_460_000,
  ...partial,
});
const stub = (partial: Partial<PayStubEvidence> = {}): PayStubEvidence => ({
  kind: "pay_stub",
  sourceId: nextId("doc_stub"),
  origin: "document",
  memberId: A,
  employerName: "Synthetic Employer One",
  payDate: "2026-12-31",
  payFrequency: "biweekly",
  grossYtdCents: 5_720_000,
  markedFinal: false,
  ...partial,
});
const record = (partial: Partial<TaxRecordEvidence> = {}): TaxRecordEvidence => ({
  kind: "tax_record",
  sourceId: nextId("doc_tax"),
  origin: "document",
  form: "filed_return",
  memberIds: [A],
  taxYear: YEAR,
  wagesCents: 5_200_000,
  otherIncome: { status: "none" },
  ...partial,
});
const reconcile = (evidence: IncomeEvidence[]) => reconcileIncomeEvidence({ incomeYear: YEAR, evidence });
const flagCodes = (result: ReturnType<typeof reconcile>) => result.flags.map((flag) => `${flag.code}:${flag.severity}`);

describe("classifyPayStub", () => {
  const classify = (payDate: string, payFrequency: PayStubEvidence["payFrequency"], markedFinal = false) => classifyPayStub({ payDate, payFrequency, markedFinal }, YEAR);

  it("treats a stub as year-end only when no regular pay date can follow it in the year", () => {
    expect(classify("2026-12-25", "weekly")).toBe("year_end");
    expect(classify("2026-12-24", "weekly")).toBe("mid_year");
    expect(classify("2026-12-18", "biweekly")).toBe("year_end");
    expect(classify("2026-12-17", "biweekly")).toBe("mid_year");
    expect(classify("2026-12-16", "semimonthly")).toBe("year_end");
    expect(classify("2026-12-15", "semimonthly")).toBe("mid_year");
    expect(classify("2026-12-01", "monthly")).toBe("year_end");
    expect(classify("2026-11-30", "monthly")).toBe("mid_year");
  });

  it("assumes the shortest regular pay period when the frequency is not on the stub", () => {
    expect(classify("2026-12-25", null)).toBe("year_end");
    expect(classify("2026-12-18", null)).toBe("mid_year");
    expect(RECONCILIATION_POLICY.defaultPayPeriodDays).toBe(7);
  });

  it("accepts a stub marked final at any point in the year, and never a stub from another year", () => {
    expect(classify("2026-06-12", "biweekly", true)).toBe("year_end");
    expect(classify("2026-06-12", "biweekly")).toBe("mid_year");
    // A January stub's year-to-date figure belongs to the new year, even for work done in December.
    expect(classify("2027-01-02", "weekly")).toBe("other_year");
    expect(classify("2027-01-02", "weekly", true)).toBe("other_year");
    expect(classify("2025-12-31", "weekly", true)).toBe("other_year");
  });
});

describe("projectAnnualFromYtd", () => {
  it("projects by calendar days, flooring to the cent", () => {
    expect(projectAnnualFromYtd(3_000_000, "2026-12-31")).toBe(3_000_000);
    expect(projectAnnualFromYtd(1_820_000, "2026-07-01")).toBe(Math.floor((1_820_000 * 365) / 182));
    // Leap year: 366 days.
    expect(projectAnnualFromYtd(100_000, "2028-01-01")).toBe(36_600_000);
  });
});

describe("reconcileIncomeEvidence: wages are counted once", () => {
  it("builds one wage item from Forms W-2 alone, with box 5 as the upper figure", () => {
    const one = w2();
    const result = reconcile([one]);
    expect(result.items).toEqual([
      {
        id: "wages:hm_a",
        memberId: A,
        category: "wages_salary",
        incomeYear: YEAR,
        annualAmountCents: 5_200_000,
        lowCents: 5_200_000,
        highCents: 5_460_000,
        source: "document",
        documentId: one.sourceId,
        railConnectionId: null,
        description: "Wages per Forms W-2 (box 1)",
      },
    ]);
    expect(result.flags).toEqual([]);
    expect(result.wages[0]).toMatchObject({ tier: "w2", governingSourceIds: [one.sourceId], corroboratingSourceIds: [], conflict: false });
  });

  it("sums the W-2s of two employers and never uses a box 5 that is below box 1", () => {
    const result = reconcile([w2({ wagesCents: 3_000_000, medicareWagesCents: 3_100_000 }), w2({ employerName: "Synthetic Employer Two", wagesCents: 1_500_000, medicareWagesCents: null })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 4_500_000, lowCents: 4_500_000, highCents: 4_600_000 });
    expect(reconcile([w2({ wagesCents: 3_000_000, medicareWagesCents: 2_900_000 })]).items[0]).toMatchObject({ lowCents: 3_000_000, highCents: 3_000_000 });
  });

  it("counts a W-2 that arrives twice (an upload and a payroll rail) once", () => {
    const uploaded = w2({ sourceId: "doc_w2_upload", medicareWagesCents: null });
    const fromRail = w2({ sourceId: "rail_payroll", origin: "rail", employerName: "SYNTHETIC EMPLOYER ONE" });
    const result = reconcile([fromRail, uploaded]);
    expect(result.items).toHaveLength(1);
    // Box 5 from the copy that carries it is kept.
    expect(result.items[0]).toMatchObject({ annualAmountCents: 5_200_000, lowCents: 5_200_000, highCents: 5_460_000, documentId: "doc_w2_upload" });
    expect(result.flags).toEqual([]);
    expect(result.ignored).toEqual([{ sourceId: "rail_payroll", kind: "w2", reason: "duplicate", detail: expect.stringContaining("counted once") }]);
    // The same upload three times.
    expect(reconcile([w2(), w2(), w2()]).items[0].annualAmountCents).toBe(5_200_000);
  });

  it("keeps two W-2s apart when the employer or the amount differs", () => {
    // Two jobs that happened to pay the same.
    expect(reconcile([w2(), w2({ employerName: "Synthetic Employer Two" })]).items[0].annualAmountCents).toBe(10_400_000);
    // Two forms from one employer with different amounts.
    expect(reconcile([w2(), w2({ wagesCents: 300_000, medicareWagesCents: null })]).items[0].annualAmountCents).toBe(5_500_000);
    // Two people.
    expect(reconcile([w2(), w2({ memberId: B })]).items).toHaveLength(2);
  });

  it("flags two W-2s with the same amount when only one names its employer: one form or two", () => {
    const result = reconcile([w2({ medicareWagesCents: null }), w2({ employerName: null, medicareWagesCents: null })]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 10_400_000, lowCents: 5_200_000, highCents: 10_400_000 });
    expect(flagCodes(result)).toEqual(["income_figures_conflict:blocking"]);
    expect(result.flags[0].message).toContain("may be the same wages counted twice");
    expect(result.ignored).toEqual([]);
    // Neither names an employer: the same person, year and amount is treated as one form.
    expect(reconcile([w2({ employerName: null }), w2({ employerName: null })]).items[0].annualAmountCents).toBe(5_200_000);
  });

  it("does not double count a W-2, a filed return and an IRS transcript for the same wages", () => {
    const transcript = record({ form: "irs_return_transcript", wagesCents: 5_200_000 });
    const filed = record({ wagesCents: 5_200_049 }); // cents the transcript rounds away
    const form = w2();
    const result = reconcile([form, filed, transcript]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 5_200_000, documentId: transcript.sourceId, description: "Wages per IRS tax return transcript" });
    // The lower figure is never silently chosen: both the filed figure and box 5 raise the upper bound.
    expect(result.items[0].lowCents).toBe(5_200_000);
    expect(result.items[0].highCents).toBe(5_200_049 + (5_460_000 - 5_200_000));
    expect(result.flags).toEqual([]);
    expect(result.wages[0]).toMatchObject({ tier: "irs_return_transcript", conflict: false });
    expect([...result.wages[0].corroboratingSourceIds].sort()).toEqual([filed.sourceId, form.sourceId].sort());
    expect(computeHouseholdIncome({ incomeYear: YEAR, members: [{ id: A, firstName: "A", ageBand: "adult" }], items: result.items }).totalCountedCents).toBe(5_200_000);
  });

  it("follows the documented precedence", () => {
    expect([...WAGE_SOURCE_PRECEDENCE]).toEqual(["irs_return_transcript", "irs_wage_income_transcript", "filed_return", "w2", "pay_stub"]);
    const wageTranscript = record({ form: "irs_wage_income_transcript" });
    expect(reconcile([record(), wageTranscript, w2()]).wages[0]).toMatchObject({ tier: "irs_wage_income_transcript", governingSourceIds: [wageTranscript.sourceId] });
    expect(reconcile([w2(), record()]).wages[0].tier).toBe("filed_return");
    expect(reconcile([stub(), w2()]).wages[0].tier).toBe("w2");
    expect(reconcile([stub()]).wages[0].tier).toBe("pay_stub");
  });

  it("lets a return govern when the W-2s on file are fewer than the return totals", () => {
    const filed = record({ wagesCents: 8_000_000 });
    const result = reconcile([filed, w2({ wagesCents: 5_200_000, medicareWagesCents: 5_200_000 })]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 8_000_000, lowCents: 8_000_000, highCents: 8_000_000, documentId: filed.sourceId });
    expect(result.flags).toEqual([]);
  });

  it("flags W-2s that total more than the return, and keeps the higher figure in the upper bound", () => {
    const result = reconcile([record({ wagesCents: 5_000_000 }), w2({ wagesCents: 6_000_000, medicareWagesCents: null })]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 5_000_000, lowCents: 5_000_000, highCents: 6_000_000 });
    expect(flagCodes(result)).toEqual(["income_figures_conflict:blocking"]);
    expect(result.flags[0].message).toContain("Forms W-2 total $60,000, more than the $50,000 on the tax return as filed");
    expect(result.flags[0].itemId).toBe("wages:hm_a");
    expect(result.wages[0].conflict).toBe(true);
  });

  it("flags a filed return that disagrees with its IRS transcript", () => {
    const result = reconcile([record({ form: "irs_return_transcript", wagesCents: 7_000_000 }), record({ wagesCents: 5_500_000 })]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 7_000_000, lowCents: 5_500_000, highCents: 7_000_000 });
    expect(flagCodes(result)).toEqual(["income_figures_conflict:blocking"]);
    expect(result.flags[0].message).toMatch(/IRS tax return transcript \$70,000 against tax return as filed \$55,000/);
  });

  it("treats a difference within the matching tolerance as the same figure, still keeping the higher one", () => {
    const tolerance = RECONCILIATION_POLICY.sameFigureToleranceCents;
    const within = reconcile([record({ form: "irs_return_transcript", wagesCents: 5_000_000 }), record({ wagesCents: 5_000_000 + tolerance })]);
    expect(within.flags).toEqual([]);
    expect(within.items[0]).toMatchObject({ lowCents: 5_000_000, highCents: 5_000_000 + tolerance });
    const beyond = reconcile([record({ form: "irs_return_transcript", wagesCents: 5_000_000 }), record({ wagesCents: 5_000_000 + tolerance + 1 })]);
    expect(flagCodes(beyond)).toEqual(["income_figures_conflict:blocking"]);
  });
});

describe("reconcileIncomeEvidence: joint returns cover two adults", () => {
  it("builds one item for both spouses and does not add their W-2s on top", () => {
    const joint = record({ memberIds: [A, B], wagesCents: 11_000_000 });
    const result = reconcile([joint, w2({ wagesCents: 6_000_000, medicareWagesCents: 6_000_000 }), w2({ memberId: B, wagesCents: 5_000_000, medicareWagesCents: 5_400_000 })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "wages:hm_a+hm_b",
      memberId: A,
      alsoCoversMemberIds: [B],
      annualAmountCents: 11_000_000,
      lowCents: 11_000_000,
      highCents: 11_400_000,
      documentId: joint.sourceId,
      description: "Wages per joint tax return as filed",
    });
    expect(result.flags).toEqual([]);
    expect(result.wages[0].memberIds).toEqual([A, B]);
  });

  it("accepts a joint return when only one spouse's W-2 is on file", () => {
    const result = reconcile([record({ memberIds: [B, A], wagesCents: 11_000_000 }), w2({ wagesCents: 6_000_000, medicareWagesCents: null })]);
    expect(result.items[0]).toMatchObject({ memberId: A, alsoCoversMemberIds: [B], annualAmountCents: 11_000_000, highCents: 11_000_000 });
    expect(result.flags).toEqual([]);
  });

  it("flags W-2s that add up to more than the joint return", () => {
    const result = reconcile([record({ memberIds: [A, B], wagesCents: 9_000_000 }), w2({ wagesCents: 6_000_000, medicareWagesCents: null }), w2({ memberId: B, wagesCents: 5_000_000, medicareWagesCents: null })]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 9_000_000, lowCents: 9_000_000, highCents: 11_000_000 });
    expect(flagCodes(result)).toEqual(["income_figures_conflict:blocking"]);
  });

  it("compares each spouse's own IRS wage transcript with the joint return", () => {
    const joint = record({ memberIds: [A, B], form: "irs_return_transcript", wagesCents: 11_000_000 });
    const agree = reconcile([joint, record({ form: "irs_wage_income_transcript", wagesCents: 6_000_000 }), record({ form: "irs_wage_income_transcript", memberIds: [B], wagesCents: 5_000_000 })]);
    expect(agree.flags).toEqual([]);
    expect(agree.items).toHaveLength(1);
    const disagree = reconcile([joint, record({ form: "irs_wage_income_transcript", wagesCents: 6_000_000 }), record({ form: "irs_wage_income_transcript", memberIds: [B], wagesCents: 4_000_000 })]);
    expect(flagCodes(disagree)).toEqual(["income_figures_conflict:blocking"]);
    expect(disagree.items[0]).toMatchObject({ annualAmountCents: 11_000_000, lowCents: 10_000_000, highCents: 11_000_000 });
  });

  it("uses year-end gross pay of both spouses as the upper figure when no W-2 is on file", () => {
    const result = reconcile([record({ memberIds: [A, B], wagesCents: 10_000_000 }), stub({ grossYtdCents: 6_300_000 }), stub({ memberId: B, employerName: "Synthetic Employer Two", grossYtdCents: 4_500_000 })]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 10_000_000, lowCents: 10_000_000, highCents: 10_800_000 });
  });

  it("keeps two people who file separately apart", () => {
    const result = reconcile([record({ wagesCents: 4_000_000 }), record({ memberIds: [B], wagesCents: 3_000_000 })]);
    expect(result.items.map((entry) => [entry.id, entry.annualAmountCents, entry.alsoCoversMemberIds])).toEqual([
      ["wages:hm_a", 4_000_000, undefined],
      ["wages:hm_b", 3_000_000, undefined],
    ]);
  });

  it("falls back to each spouse's W-2s, with a flag, when the joint return's wages line was not read", () => {
    const joint = record({ memberIds: [A, B], wagesCents: null });
    const result = reconcile([joint, w2({ wagesCents: 6_000_000, medicareWagesCents: null }), w2({ memberId: B, wagesCents: 5_000_000, medicareWagesCents: null })]);
    expect(result.items.map((entry) => [entry.id, entry.annualAmountCents])).toEqual([
      ["wages:hm_a", 6_000_000],
      ["wages:hm_b", 5_000_000],
    ]);
    expect(flagCodes(result)).toEqual(["tax_record_incompletely_read:blocking"]);
    expect(result.flags[0].sourceIds).toEqual([joint.sourceId]);
  });

  it("flags tax records that pair household members inconsistently", () => {
    const result = reconcile([record({ memberIds: [A, B] }), record({ memberIds: [B, "hm_c"] })]);
    expect(flagCodes(result)).toContain("tax_records_overlap:blocking");
  });
});

describe("reconcileIncomeEvidence: pay stubs", () => {
  it("lets a year-end stub stand for the year, as an upper figure only", () => {
    const final = stub();
    const result = reconcile([stub({ payDate: "2026-06-19", grossYtdCents: 2_600_000 }), final]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 5_720_000, lowCents: 0, highCents: 5_720_000, documentId: final.sourceId, description: "Year-to-date gross pay per pay stub" });
    expect(flagCodes(result)).toEqual(["wages_from_pay_stub_only:bounded"]);
  });

  it("never decides on a mid-year stub: it is a projection for a reviewer", () => {
    const june = stub({ payDate: "2026-06-19", grossYtdCents: 2_600_000 });
    const result = reconcile([june]);
    expect(result.items[0]).toMatchObject({ annualAmountCents: 2_600_000, lowCents: 0, highCents: 2_600_000 });
    expect(flagCodes(result)).toEqual(["wages_from_pay_stub_only:bounded", "pay_stub_projection_only:blocking"]);
    const projection = result.flags[1];
    expect(projection.sourceIds).toEqual([june.sourceId]);
    expect(projection.message).toContain("2026-06-19");
    expect(projection.message).toContain("$26,000");
    expect(projection.message).toContain("is not used");
    // Nothing was annualized into the item.
    expect(result.items[0].annualAmountCents).toBe(2_600_000);
  });

  it("adds the latest stub of each employer and flags the one that does not close the year", () => {
    const result = reconcile([stub({ grossYtdCents: 3_000_000 }), stub({ employerName: "Synthetic Employer Two", payDate: "2026-08-14", grossYtdCents: 1_200_000 })]);
    expect(result.items[0].annualAmountCents).toBe(4_200_000);
    expect(flagCodes(result)).toEqual(["wages_from_pay_stub_only:bounded", "pay_stub_projection_only:blocking"]);
  });

  it("treats a stub marked final for a job that ended mid-year as closing that job", () => {
    const result = reconcile([stub({ payDate: "2026-05-29", grossYtdCents: 1_900_000, markedFinal: true })]);
    expect(flagCodes(result)).toEqual(["wages_from_pay_stub_only:bounded"]);
  });

  it("uses a stub only to raise the upper figure once a W-2 is on file, and ignores a mid-year stub then", () => {
    const withFinal = reconcile([w2({ medicareWagesCents: 5_300_000 }), stub({ grossYtdCents: 5_720_000 })]);
    expect(withFinal.items[0]).toMatchObject({ annualAmountCents: 5_200_000, lowCents: 5_200_000, highCents: 5_720_000 });
    expect(withFinal.flags).toEqual([]);
    const withMidYear = reconcile([w2({ medicareWagesCents: 5_300_000 }), stub({ payDate: "2026-06-19", grossYtdCents: 9_900_000 })]);
    expect(withMidYear.items[0].highCents).toBe(5_300_000);
    expect(withMidYear.flags).toEqual([]);
  });

  it("ignores stubs from another year and stubs without a year-to-date figure, and says so", () => {
    const january = stub({ payDate: "2027-01-08" });
    const unread = stub({ grossYtdCents: null });
    const result = reconcile([january, unread]);
    expect(result.items).toEqual([]);
    expect(result.ignored).toEqual([
      { sourceId: january.sourceId, kind: "pay_stub", reason: "different_year", detail: "Pay date 2027-01-08 is not in 2026." },
      { sourceId: unread.sourceId, kind: "pay_stub", reason: "no_year_to_date_figure", detail: "Year-to-date gross pay was not read from the pay stub." },
    ]);
  });
});

describe("reconcileIncomeEvidence: other income on tax records", () => {
  it("turns each line into an item of the right category", () => {
    const filed = record({
      otherIncome: {
        status: "itemized",
        lines: [
          { line: "taxable_interest", amountCents: 40_000 },
          { line: "tax_exempt_interest", amountCents: 10_000 },
          { line: "social_security_benefits", amountCents: 1_800_000 },
          { line: "unemployment_compensation", amountCents: 520_000 },
          { line: "alimony_received", amountCents: 1_200_000 },
          { line: "pensions_annuities", amountCents: 900_000 },
        ],
      },
    });
    const result = reconcile([filed]);
    expect(result.items.map((entry) => [entry.id, entry.category, entry.annualAmountCents])).toEqual([
      ["wages:hm_a", "wages_salary", 5_200_000],
      ["taxable_interest:hm_a", "interest_dividends", 40_000],
      ["tax_exempt_interest:hm_a", "interest_dividends", 10_000],
      ["pensions_annuities:hm_a", "pension_annuity", 900_000],
      ["social_security_benefits:hm_a", "social_security", 1_800_000],
      ["unemployment_compensation:hm_a", "unemployment", 520_000],
      ["alimony_received:hm_a", "alimony_received", 1_200_000],
    ]);
    expect(result.items.every((entry) => entry.documentId === filed.sourceId)).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it("sends self-employment income on a return to review through the income computation", () => {
    const result = reconcile([record({ wagesCents: 0, otherIncome: { status: "itemized", lines: [{ line: "business_income", amountCents: 4_300_000 }] } })]);
    const business = result.items.find((entry) => entry.category === "self_employment_net")!;
    expect(business).toMatchObject({ annualAmountCents: 4_300_000, description: "Business income or loss per tax return as filed" });
    const income = computeHouseholdIncome({ incomeYear: YEAR, members: [{ id: A, firstName: "A", ageBand: "adult" }], items: result.items });
    expect(income.reviewFlags.map((flag) => [flag.code, flag.severity])).toEqual([["self_employment_income", "blocking"]]);
  });

  it("passes a business loss through without offsetting anything", () => {
    const result = reconcile([record({ otherIncome: { status: "itemized", lines: [{ line: "farm_income", amountCents: -800_000 }] } })]);
    expect(result.items[1]).toMatchObject({ category: "self_employment_net", annualAmountCents: -800_000 });
    const income = computeHouseholdIncome({ incomeYear: YEAR, members: [{ id: A, firstName: "A", ageBand: "adult" }], items: result.items });
    expect(income.totalCountedCents).toBe(5_200_000);
  });

  it("does not assume the other lines are empty when they were not read", () => {
    const filed = record({ otherIncome: { status: "not_read" } });
    const result = reconcile([filed]);
    expect(result.items).toHaveLength(1);
    expect(flagCodes(result)).toEqual(["tax_record_incompletely_read:blocking"]);
    expect(result.flags[0].message).toContain("income lines other than wages");
  });

  it("reads the other lines from the IRS transcript when the filed return's were not read", () => {
    const result = reconcile([
      record({ otherIncome: { status: "not_read" } }),
      record({ form: "irs_return_transcript", otherIncome: { status: "itemized", lines: [{ line: "ordinary_dividends", amountCents: 75_000 }] } }),
    ]);
    expect(result.flags).toEqual([]);
    expect(result.items.map((entry) => entry.category)).toEqual(["wages_salary", "interest_dividends"]);
  });

  it("does not add a wage and income transcript's lines to those of a return for the same person", () => {
    const lines = { status: "itemized" as const, lines: [{ line: "taxable_interest" as const, amountCents: 40_000 }] };
    const result = reconcile([record({ memberIds: [A, B], otherIncome: lines }), record({ form: "irs_wage_income_transcript", wagesCents: 5_200_000, otherIncome: lines })]);
    expect(result.items.filter((entry) => entry.category === "interest_dividends")).toHaveLength(1);
    // With no return on file the transcript's own lines are used.
    const alone = reconcile([record({ form: "irs_wage_income_transcript", otherIncome: lines })]);
    expect(alone.items.map((entry) => entry.id)).toEqual(["wages:hm_a", "taxable_interest:hm_a"]);
  });

  it("flags tax records that disagree on a line and keeps the higher figure", () => {
    const result = reconcile([
      record({ form: "irs_return_transcript", otherIncome: { status: "itemized", lines: [{ line: "unemployment_compensation", amountCents: 900_000 }] } }),
      record({ otherIncome: { status: "itemized", lines: [{ line: "unemployment_compensation", amountCents: 300_000 }] } }),
    ]);
    const unemployment = result.items.find((entry) => entry.category === "unemployment")!;
    expect(unemployment).toMatchObject({ annualAmountCents: 900_000, lowCents: 300_000, highCents: 900_000 });
    expect(flagCodes(result)).toEqual(["income_figures_conflict:blocking"]);
    // A line one record lists and the other omits is a disagreement too.
    const omitted = reconcile([record({ form: "irs_return_transcript" }), record({ otherIncome: { status: "itemized", lines: [{ line: "alimony_received", amountCents: 600_000 }] } })]);
    expect(omitted.items.find((entry) => entry.category === "alimony_received")).toMatchObject({ annualAmountCents: 0, lowCents: 0, highCents: 600_000 });
    expect(flagCodes(omitted)).toEqual(["income_figures_conflict:blocking"]);
  });

  it("puts lines the sources do not settle in the upper bound only", () => {
    const result = reconcile([
      record({
        otherIncome: {
          status: "itemized",
          lines: [
            { line: "ira_distributions", amountCents: 2_000_000 },
            { line: "capital_gain", amountCents: 1_000_000 },
            { line: "other_income", amountCents: 300_000 },
          ],
        },
      }),
    ]);
    const income = computeHouseholdIncome({ incomeYear: YEAR, members: [{ id: A, firstName: "A", ageBand: "adult" }], items: result.items });
    expect(income.lowerBoundCents).toBe(5_200_000);
    expect(income.upperBoundCents).toBe(5_200_000 + 2_000_000 + 1_000_000 + 300_000);
    expect(income.reviewFlags.every((flag) => flag.severity === "bounded")).toBe(true);
  });

  it("drops a capital loss and blocks on a combined Schedule E style figure", () => {
    const result = reconcile([
      record({
        otherIncome: {
          status: "itemized",
          lines: [
            { line: "capital_gain", amountCents: -300_000 },
            { line: "rental_royalty_partnership_income", amountCents: 1_400_000 },
          ],
        },
      }),
    ]);
    expect(result.items.map((entry) => entry.category)).toEqual(["wages_salary", "rental_income_net"]);
    expect(flagCodes(result)).toEqual(["schedule_e_income_needs_review:blocking"]);
  });

  it("maps every tax-record line to a category that exists", () => {
    for (const key of TAX_RECORD_LINE_KEYS) expect(getIncomeCategory(TAX_RECORD_LINES[key].category), key).not.toBeNull();
    for (const key of TAX_RECORD_LINE_KEYS.filter((k) => TAX_RECORD_LINES[k].allowsLoss)) {
      expect(getIncomeCategory(TAX_RECORD_LINES[key].category)!.allowsNegative, key).toBe(true);
    }
  });
});

describe("reconcileIncomeEvidence: general", () => {
  it("ignores documents for another tax year and reports them", () => {
    const old = w2({ taxYear: 2025 });
    const oldReturn = record({ taxYear: 2025 });
    const result = reconcile([old, oldReturn]);
    expect(result.items).toEqual([]);
    expect(result.ignored.map((entry) => [entry.sourceId, entry.reason])).toEqual([
      [old.sourceId, "different_year"],
      [oldReturn.sourceId, "different_year"],
    ]);
  });

  it("marks items from a data rail as rail items", () => {
    const result = reconcile([w2({ origin: "rail", sourceId: "rail_1" }), stub({ origin: "rail", sourceId: "rail_1" })]);
    expect(result.items[0]).toMatchObject({ source: "rail", railConnectionId: "rail_1", documentId: null });
  });

  it("returns nothing for no evidence and is deterministic regardless of input order", () => {
    expect(reconcile([])).toEqual({ incomeYear: YEAR, items: [], flags: [], wages: [], ignored: [] });
    const evidence: IncomeEvidence[] = [
      w2({ memberId: B, sourceId: "doc_1" }),
      record({ memberIds: [A, B], sourceId: "doc_2", wagesCents: 11_000_000 }),
      w2({ sourceId: "doc_3" }),
      stub({ memberId: "hm_c", sourceId: "doc_4" }),
    ];
    const forward = reconcile(evidence);
    const backward = reconcile([...evidence].reverse());
    expect(backward.items).toEqual(forward.items);
    expect(backward.wages.map((finding) => ({ ...finding, corroboratingSourceIds: [...finding.corroboratingSourceIds].sort() }))).toEqual(
      forward.wages.map((finding) => ({ ...finding, corroboratingSourceIds: [...finding.corroboratingSourceIds].sort() })),
    );
  });

  it("produces items the income computation accepts", () => {
    const result = reconcile([
      record({ memberIds: [A, B], otherIncome: { status: "itemized", lines: [{ line: "business_income", amountCents: -100_000 }] } }),
      w2(),
      stub({ memberId: "hm_c", payDate: "2026-03-06" }),
    ]);
    const members = [A, B, "hm_c"].map((id) => ({ id, firstName: id, ageBand: "adult" as const }));
    expect(() => computeHouseholdIncome({ incomeYear: YEAR, members, items: result.items })).not.toThrow();
  });

  it("rejects malformed evidence", () => {
    const bad: IncomeEvidence[][] = [
      [w2({ wagesCents: -1 })],
      [w2({ wagesCents: 10.5 })],
      [stub({ payDate: "2026-02-30" })],
      [record({ memberIds: [] })],
      [record({ memberIds: [A, A] })],
      [record({ memberIds: [A, B, "hm_c"] })],
      [record({ otherIncome: { status: "itemized", lines: [{ line: "taxable_interest", amountCents: -5 }] } })],
      [{ ...w2(), extra: true } as unknown as IncomeEvidence],
    ];
    for (const evidence of bad) expect(() => reconcile(evidence)).toThrow(AppError);
  });
});
