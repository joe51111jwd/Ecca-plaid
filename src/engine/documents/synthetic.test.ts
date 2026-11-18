import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { readDocument } from "./index";
import { generateSyntheticAwardLetter } from "./synthetic";
import type { BenefitProgram } from "./types";

const TODAY = "2026-11-18";
const household = [
  { id: "m1", firstName: "Maria", lastName: "Alvarez" },
  { id: "m2", firstName: "Lucas", lastName: "Alvarez" },
];

describe("generateSyntheticAwardLetter", () => {
  it("mints a SNAP approval for Maria Alvarez dated 30 days ago that reads back exactly", async () => {
    const letterDate = addDays(TODAY, -30);
    const bytes = await generateSyntheticAwardLetter({ program: "SNAP", recipient: "Maria Alvarez", members: ["Lucas Alvarez"], letterDate, periodEnd: "2027-04-30" });
    const r = await readDocument({ bytes, contentType: "application/pdf", declaredKind: "award_letter", referenceDate: TODAY, household });
    expect(r.synthetic).toBe(true);
    expect(r.extraction?.award).toMatchObject({
      program: "SNAP",
      approvalStatus: "approved",
      letterDate,
      recipientName: "MARIA ALVAREZ",
      householdMembers: ["MARIA ALVAREZ", "LUCAS ALVAREZ"],
      benefitPeriod: { start: letterDate, end: "2027-04-30" },
    });
    expect(r.reviewReasons.map((x) => x.code)).toEqual(["layout_unverified"]);
    expect(r.nameChecks?.every((c) => c.match.grade === "exact")).toBe(true);
  });

  it.each<[BenefitProgram, string, string[]]>([
    ["TANF", "tx_hhsc_tf0001", ["layout_unverified"]],
    ["SSI", "ssa_benefit_verification", []],
    ["WIC", "wic_certification", ["layout_unverified", "review_required_by_policy"]],
    ["SECTION_8", "pha_notice", ["layout_unverified", "low_confidence", "review_required_by_policy"]],
  ])("%s → %s", async (program, subtype, reasons) => {
    const letterDate = addDays(TODAY, -10);
    const bytes = await generateSyntheticAwardLetter({ program, recipient: "Maria Alvarez", letterDate, periodEnd: "2027-06-30" });
    const r = await readDocument({ bytes, contentType: "application/pdf", referenceDate: TODAY, household });
    expect(r.classification?.subtype).toBe(subtype);
    expect(r.extraction?.award).toMatchObject({ program, approvalStatus: "approved", letterDate });
    expect(r.reviewReasons.map((x) => x.code).sort()).toEqual(reasons.sort());
  });

  it("can be policy-rejected as synthetic, as production does", async () => {
    const bytes = await generateSyntheticAwardLetter({ program: "SSI", recipient: "Maria Alvarez", letterDate: "2026-11-01" });
    const r = await readDocument({ bytes, contentType: "application/pdf", policy: { syntheticPolicy: "reject" } });
    expect(r.status).toBe("needs_review");
    expect(r.reviewReasons.map((x) => x.code)).toContain("synthetic_fixture");
  });
});
