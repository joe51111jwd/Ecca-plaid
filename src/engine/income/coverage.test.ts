import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assessCoverage, type HouseholdMemberInput, type IncomeCertification, type IncomeDocumentSource, type IncomeItemInput } from "./index";

/* Synthetic household. No real family data. */
const YEAR = 2026;
const maria: HouseholdMemberInput = { id: "hm_maria", firstName: "Maria", ageBand: "adult", headOrSpouse: true };
const daniel: HouseholdMemberInput = { id: "hm_daniel", firstName: "Daniel", ageBand: "adult", headOrSpouse: true };
const sofia: HouseholdMemberInput = { id: "hm_sofia", firstName: "Sofia", kind: "student", ageBand: "minor" };
const MEMBERS = [maria, daniel, sofia];

let seq = 0;
function item(partial: Partial<IncomeItemInput> = {}): IncomeItemInput {
  seq += 1;
  return { id: `inc_${seq}`, memberId: maria.id, category: "wages_salary", incomeYear: YEAR, annualAmountCents: 5_000_000, source: "document", documentId: `doc_${seq}`, ...partial };
}
function certification(partial: Partial<IncomeCertification> = {}): IncomeCertification {
  return { kind: "no_other_income", memberId: null, incomeYear: YEAR, signedBy: "usr_maria", signedOn: "2027-02-01", copyVersion: "income-certification.v1", ...partial };
}
const assess = (items: IncomeItemInput[], certifications: IncomeCertification[] = [], members: HouseholdMemberInput[] = MEMBERS, sources?: IncomeDocumentSource[]) =>
  assessCoverage({ incomeYear: YEAR, members, items, certifications, sources });
const missingCodes = (result: ReturnType<typeof assess>) => result.missing.map((entry) => entry.code);

describe("assessCoverage", () => {
  it("is complete when every adult is documented and the household certified no other income", () => {
    const result = assess([item(), item({ memberId: daniel.id })], [certification()]);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.otherIncome).toBe("certified_none");
    expect(result.members.map((entry) => [entry.memberId, entry.required, entry.status])).toEqual([
      [maria.id, true, "documented"],
      [daniel.id, true, "documented"],
      [sofia.id, false, "not_required"],
    ]);
    expect(result.members[2].notRequiredReason).toBe("under_18");
    expect([result.requiredMemberCount, result.documentedMemberCount, result.certifiedZeroIncomeMemberCount]).toEqual([2, 2, 0]);
    expect(result.flags).toEqual([]);
  });

  it("says precisely what is missing for an undocumented adult, in English and Spanish", () => {
    const result = assess([item()], [certification()]);
    expect(result.complete).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ code: "member_income_evidence", memberId: daniel.id, incomeYear: YEAR, accepts: ["income_document", "zero_income_certification"] });
    expect(result.missing[0].message.en).toBe(
      "Proof of 2026 income for Daniel (a 2026 tax return, IRS transcript, Form W-2 or year-end pay stub), or a signed statement that Daniel had no income in 2026.",
    );
    expect(result.missing[0].message.es).toBe(
      "Comprobante de los ingresos de 2026 de Daniel (una declaración de impuestos de 2026, una transcripción del IRS, un Formulario W-2 o un talón de pago de fin de año), o una declaración firmada de que Daniel no tuvo ingresos en 2026.",
    );
  });

  it("accepts a signed zero-income statement for an adult with no income", () => {
    const result = assess([item()], [certification(), certification({ kind: "zero_income", memberId: daniel.id })]);
    expect(result.complete).toBe(true);
    expect(result.members[1].status).toBe("certified_zero_income");
    expect([result.documentedMemberCount, result.certifiedZeroIncomeMemberCount]).toEqual([1, 1]);
  });

  it("lets a joint tax return document both spouses", () => {
    const result = assess([item({ alsoCoversMemberIds: [daniel.id] })], [certification()]);
    expect(result.complete).toBe(true);
    expect(result.members[1]).toMatchObject({ status: "documented" });
    expect(result.members[1].documentedByItemIds).toEqual(result.members[0].documentedByItemIds);
  });

  it("accepts rail data and reviewer-keyed items as documentation", () => {
    const result = assess([item({ source: "rail", documentId: null, railConnectionId: "rail_1" }), item({ memberId: daniel.id, source: "reviewer", documentId: null })], [certification()]);
    expect(result.complete).toBe(true);
  });

  it("does not treat the household's own statement of wages as proof", () => {
    const result = assess([item(), item({ memberId: daniel.id, source: "self_reported", documentId: null })], [certification()]);
    expect(result.complete).toBe(false);
    // Daniel is asked for proof of income once, not once for the adult and once for the listed amount.
    expect(missingCodes(result)).toEqual(["member_income_evidence"]);
    expect(result.members[1].status).toBe("missing");
  });

  it("does not treat a document item without a document, or a rail item without a connection, as proof", () => {
    const result = assess([item({ documentId: null }), item({ memberId: daniel.id, source: "rail", documentId: null })], [certification()]);
    expect(missingCodes(result)).toEqual(["member_income_evidence", "member_income_evidence"]);
  });

  it("asks for proof of other income the household listed without a document", () => {
    const result = assess([item(), item({ memberId: daniel.id }), item({ id: "inc_cs", category: "child_support_received", annualAmountCents: 600_000, source: "self_reported", documentId: null })], [certification()]);
    expect(result.complete).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ code: "declared_income_evidence", itemId: "inc_cs", memberId: maria.id });
    expect(result.missing[0].message.en).toBe("Proof of income you listed for 2026: Child support received (Maria).");
    expect(result.missing[0].message.es).toBe("Comprobante de un ingreso que usted indicó para 2026: Manutención de menores recibida (Maria).");
  });

  it("does not ask for proof of a listed amount that cannot count", () => {
    const result = assess([item(), item({ memberId: daniel.id }), item({ category: "snap", source: "self_reported", documentId: null })], [certification()]);
    expect(result.complete).toBe(true);
  });

  it("does not count a document about a non-cash benefit as proof of an adult's income", () => {
    const result = assess([item(), item({ memberId: daniel.id, category: "snap" })], [certification()]);
    expect(result.members[1].status).toBe("missing");
  });

  describe("other income: evidence or a certification that there is none", () => {
    const documented = [item(), item({ memberId: daniel.id })];

    it("is missing when there is neither, and says so in plain language", () => {
      const result = assess(documented);
      expect(result.otherIncome).toBe("missing");
      expect(result.complete).toBe(false);
      expect(result.missing[0]).toMatchObject({ code: "other_income_evidence_or_certification", memberId: null, accepts: ["other_income_evidence", "no_other_income_certification"] });
      expect(result.missing[0].message.en).toContain("child support or alimony");
      expect(result.missing[0].message.es).toContain("manutención de menores o pensión alimenticia");
    });

    it("is met by a certification from each adult instead of one for the household", () => {
      expect(assess(documented, [certification({ memberId: maria.id })]).otherIncome).toBe("missing");
      expect(assess(documented, [certification({ memberId: maria.id }), certification({ memberId: daniel.id })]).otherIncome).toBe("certified_none");
    });

    it("is met by a document of other income behind an item", () => {
      const childSupport = item({ category: "child_support_received", annualAmountCents: 600_000, documentId: "doc_cs" });
      const sources: IncomeDocumentSource[] = [{ documentId: "doc_cs", kind: "other_income", extractedBy: "parser", extractionConfidence: 0.98 }];
      const result = assess([...documented, childSupport], [], MEMBERS, sources);
      expect(result.otherIncome).toBe("evidence_provided");
      expect(result.complete).toBe(true);
      // Without the document's kind the engine cannot tell, and asks for the certification.
      expect(assess([...documented, childSupport]).otherIncome).toBe("missing");
      // Interest shown on a tax return is income reflected on the listed documents, not evidence of other income.
      const interest = item({ category: "interest_dividends", documentId: "doc_return" });
      expect(assess([...documented, interest], [], MEMBERS, [{ documentId: "doc_return", kind: "tax_return", extractedBy: "parser", extractionConfidence: 0.99 }]).otherIncome).toBe("missing");
    });

    it("ignores a certification signed for a different year", () => {
      expect(assess(documented, [certification({ incomeYear: 2025 })]).otherIncome).toBe("missing");
    });
  });

  describe("who has to be covered", () => {
    it("requires a head of household or spouse under 18", () => {
      const teen: HouseholdMemberInput = { id: "hm_teen", firstName: "Ana", ageBand: "minor", headOrSpouse: true };
      const result = assess([], [certification()], [teen, sofia]);
      expect(result.members[0]).toMatchObject({ required: true, status: "missing" });
      expect(result.missing[0].message.en).toContain("for Ana");
    });

    it("asks whether a member is 18 or older instead of assuming", () => {
      const cousin: HouseholdMemberInput = { id: "hm_cousin", firstName: "Luis", kind: "other", ageBand: "unknown" };
      const result = assess([item()], [certification()], [maria, cousin]);
      expect(result.complete).toBe(false);
      expect(result.members[1]).toMatchObject({ required: false, status: "age_unknown" });
      expect(result.missing[0]).toMatchObject({ code: "member_age_band", memberId: cousin.id, accepts: ["household_details"] });
      expect(result.missing[0].message).toEqual({ en: "Whether Luis is 18 or older.", es: "Si Luis tiene 18 años o más." });
    });

    it("does not require a foster member or live-in aide, whose income is excluded", () => {
      const aide: HouseholdMemberInput = { id: "hm_aide", firstName: "Rosa", ageBand: "adult", role: "live_in_aide" };
      const foster: HouseholdMemberInput = { id: "hm_foster", firstName: "Leo", ageBand: "unknown", role: "foster" };
      const result = assess([item()], [certification()], [maria, aide, foster]);
      expect(result.complete).toBe(true);
      expect(result.members.slice(1).map((entry) => [entry.status, entry.notRequiredReason])).toEqual([
        ["not_required", "income_excluded_role"],
        ["not_required", "income_excluded_role"],
      ]);
    });

    it("requires an unrelated adult who lives in the home", () => {
      const roommate: HouseholdMemberInput = { id: "hm_roommate", firstName: "Sam", ageBand: "adult", role: "unrelated" };
      const result = assess([item()], [certification()], [maria, roommate]);
      expect(result.missing[0]).toMatchObject({ code: "member_income_evidence", memberId: roommate.id });
    });

    it("asks for the adults when the roster has none", () => {
      const result = assess([], [certification()], [sofia]);
      expect(result.complete).toBe(false);
      expect(missingCodes(result)).toEqual(["household_adult"]);
      expect(result.requiredMemberCount).toBe(0);
      expect(assess([], [], []).missing.map((entry) => entry.code)).toEqual(["household_adult", "other_income_evidence_or_certification"]);
    });

    it("uses neutral wording when a first name is blank", () => {
      const result = assess([], [certification()], [{ ...daniel, firstName: "  " }]);
      expect(result.missing[0].message.en).toContain("for a household member");
      expect(result.missing[0].message.es).toContain("de un miembro del hogar");
    });
  });

  it("ignores income items for other years", () => {
    const result = assess([item({ incomeYear: 2025 }), item({ memberId: daniel.id })], [certification()]);
    expect(result.members[0].status).toBe("missing");
    expect(result.missing[0].message.en).toContain("Proof of 2026 income for Maria");
  });

  it("flags a zero-income statement that the recorded income contradicts", () => {
    const result = assess([item(), item({ memberId: daniel.id, documentId: "doc_w2_daniel" })], [certification(), certification({ kind: "zero_income", memberId: daniel.id })]);
    expect(result.members[1].status).toBe("documented");
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ code: "zero_income_certification_contradicted", severity: "blocking", memberIds: [daniel.id], sourceIds: ["doc_w2_daniel"] });
    expect(result.flags[0].message).not.toContain("Daniel");
    // A zero-dollar record is not a contradiction.
    expect(assess([item(), item({ memberId: daniel.id, annualAmountCents: 0 })], [certification(), certification({ kind: "zero_income", memberId: daniel.id })]).flags).toEqual([]);
  });

  it("lists missing items in roster order with the household-level item last", () => {
    const result = assess([], []);
    expect(result.missing.map((entry) => [entry.code, entry.memberId])).toEqual([
      ["member_income_evidence", maria.id],
      ["member_income_evidence", daniel.id],
      ["other_income_evidence_or_certification", null],
    ]);
  });

  it("is deterministic", () => {
    const items = [item(), item({ memberId: daniel.id, source: "self_reported", documentId: null })];
    expect(assess(items, [certification()])).toEqual(assess(items, [certification()]));
  });

  it("rejects malformed input", () => {
    const bad: Array<() => unknown> = [
      () => assess([], [certification({ kind: "zero_income", memberId: null })]),
      () => assess([], [certification({ signedOn: "2027-02-30" })]),
      () => assess([], [certification({ copyVersion: "" })]),
      () => assess([], [], MEMBERS, [{ documentId: "doc_1", kind: "other_income", extractedBy: "parser", extractionConfidence: 1.5 }]),
      () => assessCoverage({ incomeYear: 26, members: MEMBERS, items: [], certifications: [] }),
    ];
    for (const run of bad) expect(run).toThrow(AppError);
  });
});
