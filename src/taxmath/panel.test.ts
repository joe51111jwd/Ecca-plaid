/** Rendering a preview into the panel's words. Synthetic amounts and names. */
import { describe, expect, it } from "vitest";
import { TAXMATH_VERSION } from "./constants";
import { COPY, COPY_VERSION, copySha256, renderCopy } from "./copy";
import { previewCredit } from "./credit";
import { renderCreditPanel } from "./panel";

const asOf = new Date("2027-02-01T18:00:00Z");

describe("renderCreditPanel", () => {
  it("renders a single filer's panel: title, one section, labels, dollar amounts and notes with their sources", () => {
    const preview = previewCredit({ filingStatus: "single", asOf, taxpayers: [{ designatedCents: 200_000 }] });
    const panel = renderCreditPanel(preview);
    expect(panel.title).toBe("Federal tax credit preview");
    expect(panel.status).toBe("preview");
    expect(panel.sections).toEqual([
      {
        key: "individual",
        heading: "Your contribution",
        lines: [
          { id: "designated", copyId: "line.designated", label: "Designated as a section 25F qualified contribution", amountCents: 200_000, amount: "$2,000", role: "amount" },
          { id: "over_cap", copyId: "line.over_cap", label: "Less: amount above the $1,700 limit (no federal credit)", amountCents: 30_000, amount: "$300", role: "subtraction" },
          { id: "estimated_credit", copyId: "line.estimated_credit", label: "Estimated federal credit, before the tax-liability limit", amountCents: 170_000, amount: "$1,700", role: "result" },
        ],
      },
    ]);
    expect(panel.notes.map((note) => note.id)).toEqual(preview.noteIds);
    for (const note of panel.notes) {
      expect(note.text).toBe(COPY[note.id].variables.length === 0 ? renderCopy(note.id as "note.nonrefundable") : note.text);
      expect(note.authority).toBe(COPY[note.id].authority);
      expect(note.citation).toBe(COPY[note.id].citation);
      expect(note.text).not.toMatch(/[{}]/);
    }
    expect(panel.notes[0].text).toMatch(/^This is a preview based only on what you entered\. It is not tax advice/);
    expect(panel).toMatchObject({ locale: "en", taxmathVersion: TAXMATH_VERSION, copyVersion: COPY_VERSION, copyRegistrySha256: copySha256() });
    expect(JSON.parse(JSON.stringify(panel))).toEqual(panel);
  });

  it("renders a joint return with a liability estimate: spouse sections, the joint total and the liability section", () => {
    const preview = previewCredit({
      filingStatus: "married_joint",
      asOf,
      taxYear: 2028,
      taxpayers: [
        { label: "Robin", designatedCents: 170_000 },
        { designatedCents: 123_456 },
      ],
      liability: { estimatedTaxCents: 250_000, otherCreditsCents: 50_000, carryforwards: [{ originYear: 2027, amountCents: 40_000 }] },
    });
    const panel = renderCreditPanel(preview);
    expect(panel.sections.map((section) => [section.key, section.heading])).toEqual([
      ["spouse_1", "Robin"],
      ["spouse_2", "Second spouse"],
      ["joint_total", "Joint return"],
      ["liability", "With the tax estimate you entered"],
    ]);
    expect(panel.sections[1].lines.at(-1)).toMatchObject({ id: "estimated_credit", amount: "$1,234.56" });
    expect(panel.sections[2].lines).toEqual([
      { id: "joint_total_credit", copyId: "line.joint_total_credit", label: "Combined estimated credit on a joint return, before the tax-liability limit", amountCents: 293_456, amount: "$2,934.56", role: "result" },
    ]);
    expect(panel.sections[3].lines.map((line) => [line.id, line.amount])).toEqual([
      ["liability_limit", "$2,000"],
      ["carryforward_available", "$400"],
      ["carryforward_used", "$400"],
      ["current_year_credit_used", "$1,600"],
      ["total_credit_used", "$2,000"],
      ["new_carryforward", "$1,334.56"],
      ["carried_to_next_year", "$1,334.56"],
    ]);
    expect(panel.notes.map((note) => note.id)).toEqual(expect.arrayContaining(["note.joint_each_spouse", "note.joint_combined_limit", "note.liability_estimate_basis"]));
  });

  it("leads with the before-credit-start caveat, date filled in", () => {
    const preview = previewCredit({ filingStatus: "single", asOf: new Date("2026-12-15T18:00:00Z"), taxpayers: [{ designatedCents: 100_000 }] });
    const panel = renderCreditPanel(preview);
    expect(panel.status).toBe("illustration_before_credit_start");
    expect(panel.notes[0]).toMatchObject({
      id: "note.before_credit_start",
      authority: "temporary_reg",
      text: "The federal credit applies only to gifts made on or after January 1, 2027. A gift made before then does not earn the credit, so the figures here only illustrate how the credit would work for a later gift.",
    });
  });

  it("falls back to English where no Spanish text exists yet, and still reports the locale asked for", () => {
    const preview = previewCredit({ filingStatus: "single", asOf, taxpayers: [{ designatedCents: 100_000 }] });
    const english = renderCreditPanel(preview);
    const spanish = renderCreditPanel(preview, { locale: "es" });
    expect(spanish.locale).toBe("es");
    expect(spanish.sections).toEqual(english.sections);
    expect(spanish.notes).toEqual(english.notes);
  });

  it("renders a preview that was stored as JSON and loaded back", () => {
    const preview = previewCredit({ filingStatus: "single", asOf, taxpayers: [{ designatedCents: 170_000, nonDesignatedCents: 10_000, expectedStateCreditCents: 20_000 }] });
    const stored = JSON.parse(JSON.stringify(preview)) as typeof preview;
    expect(renderCreditPanel(stored)).toEqual(renderCreditPanel(preview));
  });
});
