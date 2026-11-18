/**
 * Versions, rule-set labels and policy constants of the decision engine.
 *
 * Three kinds of authority stand behind a decision and they are never collapsed into one string
 * (docs/reference/hud-ami-and-annual-income.md, engineering implication 22):
 *  - the statute (the 300 percent cap, the prior calendar year, "not greater than");
 *  - the proposed regulations REG-117199-25, which are NOT final and which SGOs may rely on only as a whole;
 *  - this product's own policy where both are silent. Every such choice is a named constant in this file,
 *    in `RECONCILIATION_POLICY` (src/engine/income/reconcile.ts) or in the coverage rules
 *    (src/engine/income/coverage.ts), so it can be found, questioned and changed in one place.
 */
import { INCOME_RULE_SET } from "@/engine/income";

/** Bump when a rule, a reason code or the shape of `Decision` changes. Stored on every decision. */
export const DECISION_ENGINE_VERSION = "decision-engine.1.0.0";

export const PROPOSED_RULE_ID = "REG-117199-25";

/** The rule set a decision was made under, with its three sources of authority kept apart. */
export const DECISION_RULE_SET = Object.freeze({
  id: "25F-statute+REG-117199-25-proposed-2026-10-02",
  statute: "26 U.S.C. 25F(c)(2)(A) and (d)(1)(F)",
  proposedRegulation: `${PROPOSED_RULE_ID}, 91 FR 62818 (October 2, 2026): proposed Reg. 1.25F-1(a)(4) and 1.25F-3(c)(6). Proposed regulations, not final.`,
  incomeDefinition: INCOME_RULE_SET,
});

/** Regulation paragraphs for the two methods in scope. The proposed regulations are not final. */
export const METHOD_CITATIONS = Object.freeze({
  direct: `Prop. Reg. 1.25F-3(c)(6)(iii)(A), ${PROPOSED_RULE_ID} (proposed regulations, not final)`,
  categorical: `Prop. Reg. 1.25F-3(c)(6)(iii)(B), ${PROPOSED_RULE_ID} (proposed regulations, not final)`,
});

/** Section 25F(c)(2)(A). An SGO may set a lower cap, never a higher one. */
export const STATUTORY_CAP_PCT = 300;

export interface DecisionPolicy {
  version: string;
  /**
   * Categorical method: the documentation must be "dated within the last 12 months" (proposed
   * Reg. 1.25F-3(c)(6)(iii)(B)). The text does not say from which date the 12 months are counted
   * (sgo-verification-rules.md, F48), so the window is tested against BOTH the application date and the
   * decision date: inside both passes, inside only one goes to a person, inside neither fails.
   * The boundary is inclusive: a letter dated exactly 12 calendar months before the reference date is inside.
   * "12 months before" a date that does not exist in the target month is that month's last day
   * (12 months before February 29, 2028 is February 28, 2027).
   */
  awardLetterWindowMonths: number;
  /**
   * A document field read by a parser with confidence below this never supports an automatic decision.
   * Product policy: the sources say nothing about extraction.
   */
  minExtractionConfidence: number;
  /** The award-letter recipient must be matched to a household member with at least this confidence. Product policy. */
  minNameMatchConfidence: number;
  /**
   * False in v1: a document read by a model never supports an automatic decision, whatever confidence the
   * model reports. A person keys or confirms the fields first.
   */
  modelReadDocumentsMayAutoDecide: boolean;
  /**
   * True: a household whose direct-method file holds signed statements and no document or data source at
   * all is sent to a person. Whether income can be verified by certification alone is not addressed by the
   * proposed rule (sgo-verification-rules.md, open question 32).
   */
  certificationsAloneNeedReview: boolean;
}

/**
 * RESULT VALIDITY (product policy). The sources give no validity period (sgo-verification-rules.md, F14 and
 * engineering implications 26 and 27). What follows from the statute is that a determination answers one
 * question, income for one calendar year, and that year changes with the calendar year of the application.
 *  - Direct method: valid through December 31 of the application year.
 *  - Categorical method: valid through the EARLIEST of December 31 of the application year, the last day the
 *    letter is still "dated within the last 12 months" (letter date plus 12 months), and the end of the
 *    benefit period printed on the letter, when one was read.
 * `validUntil` is when the result stops being reusable; it does not promise that eligibility continues.
 */
export const DEFAULT_DECISION_POLICY: Readonly<DecisionPolicy> = Object.freeze({
  version: "decision-policy.v1",
  awardLetterWindowMonths: 12,
  minExtractionConfidence: 0.9,
  minNameMatchConfidence: 0.9,
  modelReadDocumentsMayAutoDecide: false,
  certificationsAloneNeedReview: true,
});

/** Upper limit accepted for an SGO's review band: the whole limit on either side, which sends every direct-method file to a person. */
export const MAX_REVIEW_BAND_BPS = 10_000;
