/**
 * Policy constants of the evidence pack.
 *
 * None of these values comes from section 25F, the proposed regulations or the temporary regulations: those
 * sources do not say what an SGO's verification file must contain or leave out (docs/reference/
 * sgo-verification-rules.md, F52). They are this product's choices, kept in one place so they can be changed
 * with a version bump and a test run.
 */
export const EVIDENCE_POLICY = Object.freeze({
  /** Version of the data-minimization rule described at the top of types.ts. Bump when the rule changes. */
  dataMinimizationRuleVersion: "evidence-minimization.v1",

  /** What a Social-Security-number-shaped token in free text is replaced with. Not even the last four digits are kept. */
  ssnReplacement: "[number removed]",

  /** Upper bounds that keep one pack a reviewable document. Input beyond them is refused, never silently cut. */
  limits: Object.freeze({
    id: 128,
    shortText: 200,
    name: 100,
    longText: 1000,
    notes: 4000,
    filename: 120,
    members: 40,
    reasons: 50,
    documents: 200,
    rails: 50,
    extractedFieldsPerDocument: 60,
    incomeItems: 500,
    consents: 20,
    reviewEntries: 500,
    timelineEntries: 1000,
    thresholdReadings: 8,
    scopeDepth: 4,
    scopeEntries: 50,
  }),
});

/** SHA-256 of zero bytes. A document, report or consent text with this hash is empty, which is never evidence. */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Citations for the two verification methods. Source: proposed regulations REG-117199-25, proposed
 * section 1.25F-3(c)(6)(iii)(A) and (B) (docs/reference/sgo-verification-rules.md, F40 and F45). The
 * proposed regulations are not final; every sentence that uses these says so.
 */
export const PROPOSED_RULE_ID = "REG-117199-25";
export const METHOD_CITATIONS = Object.freeze({
  direct: `Prop. Reg. 1.25F-3(c)(6)(iii)(A), ${PROPOSED_RULE_ID} (proposed regulations, not final)`,
  categorical: `Prop. Reg. 1.25F-3(c)(6)(iii)(B), ${PROPOSED_RULE_ID} (proposed regulations, not final)`,
});
