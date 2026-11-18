import { describe, expect, it } from "vitest";
import { describeThresholdSource, getActiveTable } from "@/engine/ami";
import { formatUsd } from "@/lib/money";
import { decide } from "./decide";
import { DECISION_EXPLANATION_COPY_VERSION, explainDecision, type DecisionExplanation } from "./explain";
import { applyReviewerResolution } from "./resolution";
import { awardLetter, DANIEL, decisionInput, directEvidence, FAMILY_OF_FOUR, HARRIS, MARIA, STARR, thresholdFixture, TODAY, wageItem } from "./test-fixtures";
import type { Decision } from "./types";

const single = { livesInMultipleHouseholds: false };
const starrHousehold = { size: 4, countyFips: STARR.fips, members: FAMILY_OF_FOUR, custody: single };

const eligibleDirect = decide(decisionInput({ direct: directEvidence(6_123_400, 4_567_800) }));
const eligibleCategorical = decide(decisionInput({ categorical: { letters: [awardLetter({ program: "SECTION_8", letterDate: "2026-06-01" })] } }));
const eligibleCategoricalWithIncome = decide(decisionInput({ categorical: { letters: [awardLetter()] }, direct: directEvidence(3_111_100, 2_222_200) }));
const ineligible = decide(decisionInput({ direct: directEvidence(20_123_400, 15_567_800), categorical: { letters: [awardLetter({ program: "MEDICAID" })] } }));
const pending = decide(decisionInput({ direct: directEvidence(0, 0, [], { items: [wageItem(MARIA.id, 6_123_400)], certifications: [] }), categorical: { letters: [awardLetter({ approvalStatus: "denied" })] } }));
const nothingOnFile = decide(decisionInput({}));
const reviewLetter = decide(decisionInput({ categorical: { letters: [awardLetter({ extractedBy: "model" })] } }));
const reviewCustody = decide(decisionInput({ household: { size: 4, countyFips: HARRIS.fips, members: FAMILY_OF_FOUR, custody: { livesInMultipleHouseholds: true } }, direct: directEvidence(6_123_400, 4_567_800) }));
const betweenReadings = decide(decisionInput({ household: starrHousehold, threshold: thresholdFixture(STARR), direct: directEvidence(10_123_400, 5_567_800) }));
const starrEligible = decide(decisionInput({ household: starrHousehold, threshold: thresholdFixture(STARR), direct: directEvidence(3_123_400, 2_567_800) }));
const irsEligible = decide(decisionInput({ threshold: thresholdFixture(HARRIS, { source: "irs_published" }), direct: directEvidence(6_123_400, 4_567_800) }));
const realTable = decide(decisionInput({ amiTable: getActiveTable(), direct: directEvidence(6_123_400, 4_567_800) }));
const resolvedEligible = applyReviewerResolution(betweenReadings, { resolution: "eligible", reviewerId: "usr_reviewer", notes: "Checked both W-2s against the return.", basis: { method: "direct" }, resolvedOn: "2027-03-20" });
const resolvedIneligible = applyReviewerResolution(betweenReadings, { resolution: "ineligible", reviewerId: "usr_reviewer", notes: "Income is over the lower reading.", basis: { method: "direct" }, resolvedOn: "2027-03-20" });

const ALL: Array<[string, Decision]> = [
  ["eligible, direct", eligibleDirect],
  ["eligible, categorical", eligibleCategorical],
  ["eligible, categorical with income documents", eligibleCategoricalWithIncome],
  ["ineligible", ineligible],
  ["pending", pending],
  ["pending, nothing on file", nothingOnFile],
  ["needs review, letter", reviewLetter],
  ["needs review, custody", reviewCustody],
  ["needs review, between readings", betweenReadings],
  ["eligible where the readings differ", starrEligible],
  ["eligible, IRS-published table", irsEligible],
  ["eligible, installed table", realTable],
  ["resolved eligible", resolvedEligible],
  ["resolved ineligible", resolvedIneligible],
];

const familyText = (explanation: DecisionExplanation): string => [explanation.family.headline, ...explanation.family.paragraphs, ...explanation.family.missing].join("\n");
const sgoText = (explanation: DecisionExplanation): string => [explanation.sgo.headline, ...explanation.sgo.paragraphs].join("\n");
const amounts = (text: string): string[] => text.match(/\$[\d,]+(\.\d{2})?/g) ?? [];

describe("explainDecision", () => {
  it("returns both audiences in both languages with a copy version", () => {
    for (const [name, decision] of ALL) {
      for (const locale of ["en", "es"] as const) {
        const explanation = explainDecision(decision, locale);
        expect(explanation.locale).toBe(locale);
        expect(explanation.copyVersion).toBe(DECISION_EXPLANATION_COPY_VERSION);
        expect(explanation.family.headline.length, name).toBeGreaterThan(5);
        expect(explanation.family.paragraphs.length, name).toBeGreaterThan(0);
        expect(explanation.sgo.headline.length, name).toBeGreaterThan(5);
        expect(explanation.sgo.paragraphs.length, name).toBeGreaterThan(1);
        for (const paragraph of [...explanation.family.paragraphs, ...explanation.sgo.paragraphs]) {
          expect(paragraph.trim(), name).toBe(paragraph);
          expect(paragraph, name).not.toMatch(/undefined|null|NaN|\[object/);
          expect(paragraph.length, name).toBeLessThan(700);
        }
      }
      expect(explainDecision(decision, "en")).toEqual(explainDecision(decision, "en"));
    }
  });

  describe("for the family", () => {
    it("never shows an income figure: only the limit, and only when it is a single figure", () => {
      for (const [name, decision] of ALL) {
        for (const locale of ["en", "es"] as const) {
          const text = familyText(explainDecision(decision, locale));
          const allowed = decision.threshold?.readingsAgree && (decision.status === "eligible" || decision.status === "ineligible") ? [formatUsd(decision.threshold.lowerBoundCents)] : [];
          for (const amount of amounts(text)) expect(allowed, `${name} (${locale}): ${amount}`).toContain(amount);
          // Belt and braces: none of the figures on file appears in any form.
          for (const line of decision.income ? [...decision.income.counted, ...decision.income.excluded, ...decision.income.needsReview] : []) {
            expect(text, `${name} (${locale})`).not.toContain(formatUsd(line.amountCents));
          }
          if (decision.householdIncomeCents !== null) expect(text, `${name} (${locale})`).not.toContain(formatUsd(decision.householdIncomeCents));
        }
      }
    });

    it("shows no dollar figure at all when the readings of the limit differ", () => {
      for (const decision of [betweenReadings, starrEligible, resolvedEligible, resolvedIneligible]) {
        expect(amounts(familyText(explainDecision(decision, "en")))).toEqual([]);
        expect(amounts(familyText(explainDecision(decision, "es")))).toEqual([]);
      }
    });

    it("says that meeting the income requirement is not an award", () => {
      for (const decision of [eligibleDirect, eligibleCategorical, starrEligible, resolvedEligible]) {
        expect(familyText(explainDecision(decision, "en"))).toContain("It is not a scholarship award: the scholarship organization decides awards separately.");
        expect(familyText(explainDecision(decision, "es"))).toContain("No es la adjudicación de una beca");
      }
      for (const [name, decision] of ALL) {
        const text = familyText(explainDecision(decision, "en"));
        expect(text, name).not.toMatch(/eligible for a scholarship|you will receive|approved for a scholarship|guarantee/i);
      }
    });

    it("explains an eligible result by its method and says how long it can be used", () => {
      const direct = explainDecision(eligibleDirect, "en").family;
      expect(direct.headline).toBe("Your household meets the income requirement");
      expect(direct.paragraphs[0]).toBe("The documents you shared show that your household's 2026 income is within the income limit for a household of 4 in Harris County.");
      expect(direct.paragraphs[1]).toBe("The provisional limit for a household of 4 in Harris County is $312,000.");
      expect(direct.paragraphs).toContain("This result can be used until December 31, 2027.");

      const categorical = explainDecision(eligibleCategorical, "en").family;
      expect(categorical.paragraphs[0]).toBe("We confirmed this with the Section 8 housing approval letter dated June 1, 2026.");
      expect(categorical.paragraphs).toContain("This result can be used until June 1, 2027.");
      const categoricalEs = explainDecision(eligibleCategorical, "es").family;
      expect(categoricalEs.paragraphs[0]).toBe("Lo confirmamos con la carta de aprobación de vivienda de la Sección 8 con fecha del 1 de junio de 2026.");
      expect(categoricalEs.paragraphs).toContain("Este resultado puede usarse hasta el 1 de junio de 2027.");
    });

    it("explains an ineligible result, including a letter that could not be used, and how to ask for another look", () => {
      const family = explainDecision(ineligible, "en").family;
      expect(family.headline).toBe("Your household's income is above the limit");
      expect(family.paragraphs[0]).toBe("The documents you shared show that your household's 2026 income is above the income limit for a household of 4 in Harris County.");
      expect(family.paragraphs).toContain("The letter you uploaded is for Medicaid. Under the proposed rules, only a letter for SNAP, TANF, WIC, Section 8 housing or SSI can be used this way.");
      expect(family.paragraphs.join(" ")).toContain("ask for another look");
      expect(explainDecision(ineligible, "es").family.paragraphs.join(" ")).toContain("Según las reglas propuestas");
    });

    it("lists exactly what is still needed, in the household's language", () => {
      const en = explainDecision(pending, "en").family;
      expect(en.headline).toBe("We need a little more information");
      expect(en.missing).toEqual(pending.missing.map((item) => item.message.en));
      expect(en.missing[0]).toContain("Proof of 2026 income for Daniel");
      expect(en.paragraphs).toContain("The letter you uploaded shows a denial, not an approval.");
      const es = explainDecision(pending, "es").family;
      expect(es.missing).toEqual(pending.missing.map((item) => item.message.es));
      expect(es.missing[0]).toContain("Comprobante de los ingresos de 2026 de Daniel");
      expect(es.paragraphs).toContain("La carta que subió muestra una denegación, no una aprobación.");
      expect(explainDecision(nothingOnFile, "es").family.missing[0]).toContain("SNAP, TANF, WIC, vivienda de la Sección 8 o SSI");
      // Nothing is listed as missing once nothing is.
      for (const decision of [eligibleDirect, reviewLetter, ineligible]) expect(explainDecision(decision, "en").family.missing).toEqual([]);
    });

    it("tells a household in review that a person is looking, without the reviewer's reasons", () => {
      const letter = explainDecision(reviewLetter, "en").family;
      expect(letter.headline).toBe("Your information is being reviewed");
      expect(letter.paragraphs).toContain("They will look at the approval letter you uploaded.");
      expect(letter.paragraphs.join(" ")).not.toMatch(/model|confidence/i);
      const custody = explainDecision(reviewCustody, "en").family;
      expect(custody.paragraphs).toContain("They will look at your answers about where the student lived during 2026.");
      expect(explainDecision(reviewCustody, "es").family.paragraphs).toContain("Revisarán sus respuestas sobre dónde vivió el estudiante durante 2026.");
      const readings = explainDecision(betweenReadings, "en").family;
      expect(readings.paragraphs.join(" ")).not.toMatch(/reading|Section 8 very-low/i);
    });

    it("says when a reviewer made the decision", () => {
      expect(explainDecision(resolvedEligible, "en").family.paragraphs[0]).toBe(
        "A reviewer at the scholarship organization looked at your information and confirmed that your household meets the income requirement.",
      );
      expect(explainDecision(resolvedIneligible, "es").family.paragraphs[0]).toContain("Una persona de la organización de becas revisó su información");
      // The reviewer's notes are for the SGO, not for the family screen.
      expect(familyText(explainDecision(resolvedEligible, "en"))).not.toContain("Checked both W-2s");
    });

    it("is written in the requested language", () => {
      for (const [name, decision] of ALL) {
        const es = explainDecision(decision, "es").family;
        const en = explainDecision(decision, "en").family;
        expect(es.headline, name).not.toBe(en.headline);
        for (const paragraph of es.paragraphs) expect(paragraph, name).not.toMatch(/\b(the|your|household|income limit)\b/);
        for (const paragraph of en.paragraphs) expect(paragraph, name).not.toMatch(/\b(hogar|ingresos|límite)\b/);
      }
    });
  });

  describe("the provisional note", () => {
    it("is on every explanation while the limit is HUD-derived, for both audiences, whatever the status", () => {
      for (const [name, decision] of ALL.filter(([, candidate]) => candidate.provisional)) {
        for (const locale of ["en", "es"] as const) {
          const explanation = explainDecision(decision, locale);
          expect(explanation.family.paragraphs.at(-1), `${name} (${locale})`).toMatch(/provisional/);
          expect(explanation.sgo.paragraphs.at(-1), `${name} (${locale})`).toMatch(/provisional/i);
        }
        expect(explainDecision(decision, "en").sgo.paragraphs.at(-1), name).toMatch(/not an IRS-published limit/);
        expect(explainDecision(decision, "es").sgo.paragraphs.at(-1), name).toMatch(/no es un límite publicado por el IRS/i);
        // Nothing presents the HUD-derived figure as the IRS's.
        expect(familyText(explainDecision(decision, "en")), name).not.toMatch(/IRS limit|limit published by the IRS/);
      }
      expect(ALL.filter(([, candidate]) => candidate.provisional).length).toBeGreaterThan(10);
    });

    it("uses the AMI engine's own wording when the table is installed", () => {
      const table = getActiveTable();
      for (const locale of ["en", "es"] as const) {
        const description = describeThresholdSource(table, locale);
        const explanation = explainDecision(realTable, locale);
        expect(explanation.sgo.paragraphs.at(-1)).toBe(description.sourceLine);
        if (table.provisional) expect(explanation.family.paragraphs.at(-1)).toBe(description.familyNote);
      }
    });

    it("is absent for the family, and replaced by the IRS source line for the SGO, once the table is IRS-published", () => {
      for (const locale of ["en", "es"] as const) {
        const explanation = explainDecision(irsEligible, locale);
        expect(familyText(explanation)).not.toMatch(/provisional/i);
        expect(sgoText(explanation)).not.toMatch(/provisional/i);
      }
      expect(explainDecision(irsEligible, "en").sgo.paragraphs.at(-1)).toBe("The limit is from the IRS-published table (table irs-synthetic-fixture, effective January 1, 2027).");
      expect(explainDecision(irsEligible, "en").family.paragraphs[1]).toBe("The limit for a household of 4 in Harris County is $312,000.");
    });
  });

  describe("for the SGO", () => {
    it("states the status, the method with its citation, and that the rules are proposed", () => {
      const direct = explainDecision(eligibleDirect, "en").sgo;
      expect(direct.headline).toBe("Eligible: direct method");
      expect(direct.paragraphs[0]).toContain("Prop. Reg. 1.25F-3(c)(6)(iii)(A)");
      expect(direct.paragraphs[0]).toContain("proposed regulations, not final");
      const categorical = explainDecision(eligibleCategorical, "en").sgo;
      expect(categorical.headline).toBe("Eligible: categorical method");
      expect(categorical.paragraphs[0]).toContain("Prop. Reg. 1.25F-3(c)(6)(iii)(B)");
      expect(categorical.paragraphs[0]).toContain("currently approved for Section 8 housing");
      expect(explainDecision(ineligible, "en").sgo.headline).toBe("Ineligible: direct method");
      expect(explainDecision(ineligible, "es").sgo.headline).toBe("No elegible: método directo");
      expect(explainDecision(pending, "en").sgo.headline).toBe("Pending: waiting on the household");
      expect(explainDecision(reviewLetter, "es").sgo.headline).toBe("Requiere revisión");
    });

    it("shows the household, the limit, the review band, the recorded income and the coverage", () => {
      const text = sgoText(explainDecision(eligibleDirect, "en"));
      expect(text).toContain("Household of 4 in Harris County (Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area). Income year 2026; application dated March 15, 2027.");
      expect(text).toContain("Limit at the SGO's cap of 300%: $312,000.");
      expect(text).toContain("income from $296,400 to $327,600 goes to a reviewer (review band of 5%)");
      expect(text).toContain("Recorded household income for 2026: $106,912.");
      expect(text).toContain("Coverage: 2 of 2 adults with documented income; other income: certified as none.");
      expect(text).toContain("The result can be reused through December 31, 2027.");
      expect(text).toContain("is not an award");
    });

    it("shows both readings where they differ", () => {
      const text = sgoText(explainDecision(betweenReadings, "en"));
      expect(text).toContain("The proposed rules can be read two ways");
      expect(text).toContain("$116,100");
      expect(text).toContain("$251,100");
      expect(text).toContain("It is not known which reading, if either, the IRS-published limits will follow");
      const es = sgoText(explainDecision(betweenReadings, "es"));
      expect(es).toContain("Las reglas propuestas pueden leerse de dos maneras");
      expect(es).toContain("$116,100");
      expect(es).toContain("$251,100");
    });

    it("lists what a reviewer has to settle and why the decision is what it is", () => {
      const review = explainDecision(betweenReadings, "en").sgo;
      expect(review.paragraphs[0]).toBe("This verification needs a reviewer: one point has to be settled before the income requirement can be decided. Nothing has been decided.");
      expect(review.reviewPoints).toEqual(betweenReadings.reviewReasons.map((reason) => reason.message));
      expect(review.reasons).toEqual(betweenReadings.reasons.map((reason) => reason.message));
      const waiting = explainDecision(pending, "en").sgo;
      expect(waiting.paragraphs[0]).toBe(`This verification is waiting on the household for ${pending.missing.length} items. Nothing has been decided.`);
      expect(waiting.reasons).toContain("The document shows a denial, not a current approval.");
    });

    it("does not repeat income detail for a categorical decision", () => {
      const text = sgoText(explainDecision(eligibleCategoricalWithIncome, "en"));
      expect(text).not.toContain("Recorded household income");
      expect(text).not.toContain("$53,333");
    });

    it("records who resolved a review, on what basis and why", () => {
      const sgo = explainDecision(resolvedEligible, "en").sgo;
      expect(sgo.headline).toBe("Eligible: direct method");
      expect(sgo.paragraphs[0]).toBe(
        "Resolved by a reviewer (usr_reviewer) on March 20, 2027 as eligible, relying on the direct method (Prop. Reg. 1.25F-3(c)(6)(iii)(A), REG-117199-25 (proposed regulations, not final)). Reviewer notes: Checked both W-2s against the return.",
      );
      expect(sgo.reviewPoints).toEqual([]);
      expect(explainDecision(resolvedIneligible, "es").sgo.paragraphs[0]).toContain("como no elegible");
    });

    it("never names a household member", () => {
      for (const [name, decision] of ALL) {
        for (const locale of ["en", "es"] as const) {
          const sgo = explainDecision(decision, locale).sgo;
          expect([sgo.headline, ...sgo.paragraphs, ...sgo.reasons, ...sgo.reviewPoints].join("\n"), `${name} (${locale})`).not.toMatch(new RegExp(`${MARIA.firstName}|${DANIEL.firstName}|Sofia|Mateo|Synthetic`));
        }
      }
    });
  });

  it("explains a decision with no limit on record", () => {
    const noCounty = decide({ today: TODAY, sgoPolicy: { capPct: 300, reviewBandBps: 500 }, household: { size: 4, countyFips: null, members: FAMILY_OF_FOUR, custody: single }, categorical: { letters: [awardLetter()] } });
    const explanation = explainDecision(noCounty, "en");
    expect(explanation.family.missing).toEqual(["The county where the household lives. Check the home address."]);
    expect(sgoText(explanation)).toContain("No income limit is on record yet.");
    expect(explainDecision(noCounty, "es").family.missing).toEqual(["El condado donde vive el hogar. Revise la dirección de la vivienda."]);
  });
});
