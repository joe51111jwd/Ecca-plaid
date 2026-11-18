/**
 * The eligibility decision service for the household income requirement of section 25F: the direct and
 * categorical methods, shared custody, the two readings of the provisional limit, reviewer resolutions and
 * plain-language explanations.
 *
 * Pure: no database, network, file system, environment or clock. The caller passes `today`.
 */
export { decide } from "./decide";
export { applyReviewerResolution, type ResolutionRefusal, type ReviewerResolutionInput } from "./resolution";
export { DECISION_EXPLANATION_COPY_VERSION, explainDecision, type DecisionExplanation, type ExplanationLocale } from "./explain";
export { toThresholdBounds, type ThresholdBounds, type ThresholdBoundsInput, type ThresholdReadingBound, type ThresholdReadingId } from "./threshold-bounds";
export {
  CATEGORICAL_PROGRAM_LABELS,
  categoricalValidUntil,
  classifyProgram,
  evaluateAwardLetter,
  evaluateCategorical,
  isWithinLetterWindow,
  type CategoricalEvaluation,
  type EvaluateLetterContext,
  type ProgramClassification,
} from "./categorical";
export { evaluateCustody, type CustodyEvaluation } from "./custody";
export { classifyAgainstThreshold, evaluateDirect, formatBps, type DirectEvaluation, type EvaluateDirectContext, type IncomeZone } from "./direct";
export {
  DECISION_ENGINE_VERSION,
  DECISION_RULE_SET,
  DEFAULT_DECISION_POLICY,
  MAX_REVIEW_BAND_BPS,
  METHOD_CITATIONS,
  PROPOSED_RULE_ID,
  STATUTORY_CAP_PCT,
  type DecisionPolicy,
} from "./policy";
export {
  CATEGORICAL_PROGRAMS,
  CUSTODY_REVIEW_CODES,
  INFORMATIONAL_REASON_CODES,
  LETTER_AMBIGUOUS_CODES,
  LETTER_DISQUALIFYING_CODES,
  REASON_CODES,
  REVIEW_REASON_CODES,
  type AwardLetterApprovalStatus,
  type AwardLetterInput,
  type CategoricalProgram,
  type CustodyDetermination,
  type CustodyInfo,
  type CustodyOutcome,
  type CustodyReviewCode,
  type DecidedBy,
  type Decision,
  type DecisionHouseholdInput,
  type DecisionInput,
  type DecisionMethod,
  type DecisionReason,
  type DecisionStatus,
  type DecisionThreshold,
  type DirectEvidenceInput,
  type DirectOutcome,
  type EngineOutcome,
  type InjectedThreshold,
  type LetterAmbiguousCode,
  type LetterDefect,
  type LetterDisqualifyingCode,
  type LetterEvaluation,
  type LetterOutcome,
  type MethodBasis,
  type MissingItem,
  type RailReportSummary,
  type ReasonCode,
  type ReviewerBasis,
  type SgoPolicyInput,
  type ThresholdReliedOn,
  type ThresholdTableInfo,
  type UnreadDocument,
} from "./types";
