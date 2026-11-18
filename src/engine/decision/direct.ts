/**
 * The direct income verification method.
 *
 * Statute (26 U.S.C. 25F(c)(2)(A)): household income for the calendar year before the application must be
 * "not greater than" 300 percent of area median gross income, so income equal to the limit passes.
 * Proposed Reg. 1.25F-3(c)(6)(iii)(A) (REG-117199-25, not final) lists the documents and adds "other
 * relevant data sources".
 *
 * The comparison is between two ranges, never two guesses:
 *   household income  [lowerBound, upperBound]   every reading of the open income questions (income/compute.ts)
 *   the limit         [lowest reading, highest reading], widened by the SGO's review band while provisional
 *
 *   within the limit   only when the UPPER bound of income is at or below the automatic-eligible cut-off
 *   over the limit     only when the LOWER bound of income is above the automatic-ineligible cut-off
 *   anything else      a person decides, and is told which of the two ranges caused it
 *
 * and only when the file can be relied on at all:
 *   - coverage is complete (income/coverage.ts); otherwise the household is asked for what is missing;
 *   - no blocking flag is open: self-employment, documents that disagree, a mid-year pay stub, a document
 *     read by a model or with low confidence, an item with no extraction record behind it, bank deposits
 *     standing in for income, statements with no document at all.
 * "Over the limit" is an affirmative finding. Missing or doubtful evidence never produces it.
 */
import { formatUsd } from "@/lib/money";
import {
  assessCoverage,
  computeHouseholdIncome,
  getIncomeCategory,
  type CoverageAssessment,
  type HouseholdIncomeResult,
  type HouseholdMemberInput,
  type IncomeItemInput,
  type IncomeReviewFlag,
} from "@/engine/income";
import type { DecisionPolicy } from "./policy";
import type { DecisionReason, DecisionThreshold, DirectEvidenceInput, DirectOutcome, MethodBasis, RailReportSummary } from "./types";

export type IncomeZone = "within" | "over" | "between_readings" | "near_threshold";

/** Where one income figure falls against the limit's range. */
export function classifyAgainstThreshold(incomeCents: number, threshold: Pick<DecisionThreshold, "autoEligibleMaxCents" | "autoIneligibleAboveCents" | "lowerBoundCents" | "upperBoundCents" | "readingsAgree">): IncomeZone {
  if (incomeCents <= threshold.autoEligibleMaxCents) return "within";
  if (incomeCents > threshold.autoIneligibleAboveCents) return "over";
  if (!threshold.readingsAgree && incomeCents > threshold.lowerBoundCents && incomeCents <= threshold.upperBoundCents) return "between_readings";
  return "near_threshold";
}

export interface DirectEvaluation {
  outcome: DirectOutcome;
  income: HouseholdIncomeResult | null;
  coverage: CoverageAssessment | null;
  methodBasis: MethodBasis | null;
  /** Explains a `within_limit` or `over_limit` outcome, and notes that do not need a person. */
  reasons: DecisionReason[];
  /** Everything a person has to settle before income can be decided. */
  reviewReasons: DecisionReason[];
  /** Which end of the limit's range decided the comparison. */
  reliedOn: "lower_bound" | "upper_bound" | null;
}

function flagReason(flag: IncomeReviewFlag): DecisionReason {
  return { code: flag.code, message: flag.message, memberIds: [...flag.memberIds], sourceIds: [...flag.sourceIds] };
}

/** How far each document and rail report behind the in-year items can be trusted. One flag per source. */
function trustFlags(items: IncomeItemInput[], evidence: DirectEvidenceInput, railReports: RailReportSummary[], policy: DecisionPolicy): IncomeReviewFlag[] {
  const flags: IncomeReviewFlag[] = [];
  const sources = new Map((evidence.sources ?? []).map((source) => [source.documentId, source]));
  const rails = new Map(railReports.map((report) => [report.railConnectionId, report]));
  const seen = new Set<string>();
  const push = (code: IncomeReviewFlag["code"], message: string, item: IncomeItemInput, sourceId: string | null): void => {
    const key = `${code}:${sourceId ?? item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({ code, severity: "blocking", message, itemId: item.id, memberIds: item.memberId === null ? [] : [item.memberId], sourceIds: sourceId === null ? [] : [sourceId] });
  };

  for (const item of items) {
    if (item.source === "document") {
      const source = typeof item.documentId === "string" ? sources.get(item.documentId) : undefined;
      if (!source) {
        push("evidence_source_unknown", "An income item is recorded as coming from a document, but there is no record of how that document was read. It cannot support an automatic decision.", item, item.documentId ?? null);
      } else if (source.extractedBy === "model" && !policy.modelReadDocumentsMayAutoDecide) {
        push("document_read_by_model", "An income document was read by a model. A model-read document does not support an automatic decision; a reviewer must confirm the figures.", item, source.documentId);
      } else if (source.extractedBy !== "reviewer" && source.extractionConfidence < policy.minExtractionConfidence) {
        push("document_low_confidence", "An income document was read with low confidence. A reviewer must confirm the figures.", item, source.documentId);
      }
    } else if (item.source === "rail") {
      const report = typeof item.railConnectionId === "string" ? rails.get(item.railConnectionId) : undefined;
      if (!report) {
        push("evidence_source_unknown", "An income item is recorded as coming from a data connection, but there is no report for that connection. It cannot support an automatic decision.", item, item.railConnectionId ?? null);
      } else if (report.dataBasis === "bank_net_deposits") {
        push("rail_bank_net_deposits", "Income rests on bank deposits, which are amounts after taxes and deductions and are not household income. A reviewer must establish the income.", item, report.railConnectionId);
      }
    }
  }
  return flags;
}

function methodBasisOf(items: IncomeItemInput[]): MethodBasis | null {
  const evidenced = items.filter((item) => item.source !== "self_reported" && getIncomeCategory(item.category)?.treatment !== "excluded");
  const written = evidenced.some((item) => item.source === "document" || item.source === "reviewer");
  const data = evidenced.some((item) => item.source === "rail");
  if (written && data) return "written_documentation_and_other_relevant_data_sources";
  if (data) return "other_relevant_data_sources";
  return written ? "written_documentation" : null;
}

export interface EvaluateDirectContext {
  /** The calendar year before the application date. */
  incomeYear: number;
  members: HouseholdMemberInput[];
  /** Null when the household's county or size is missing or not in the table. */
  threshold: DecisionThreshold | null;
  railReports: RailReportSummary[];
  policy: DecisionPolicy;
}

/** Evaluates the direct evidence on file. Never throws for what the evidence says; input was validated by the caller. */
export function evaluateDirect(evidence: DirectEvidenceInput | null | undefined, context: EvaluateDirectContext): DirectEvaluation {
  const { incomeYear, members, threshold, railReports, policy } = context;
  const certifications = evidence?.certifications ?? [];
  if (!evidence || (evidence.items.length === 0 && certifications.length === 0)) {
    return { outcome: "none", income: null, coverage: null, methodBasis: null, reasons: [], reviewReasons: [], reliedOn: null };
  }

  const income = computeHouseholdIncome({ incomeYear, members, items: evidence.items });
  const coverage = assessCoverage({ incomeYear, members, items: evidence.items, certifications, sources: evidence.sources });
  const inYear = evidence.items.filter((item) => item.incomeYear === incomeYear);
  const methodBasis = methodBasisOf(inYear);

  const reasons: DecisionReason[] = [];
  if (evidence.incomeYear !== incomeYear) {
    reasons.push({
      code: "direct_evidence_wrong_year",
      message: `The income evidence was assembled for ${evidence.incomeYear}. The income year for this application is ${incomeYear}, the calendar year before the application date, so only items for ${incomeYear} are used.`,
      memberIds: [],
      sourceIds: [],
    });
  }

  const flags = [...income.reviewFlags, ...coverage.flags, ...(evidence.evidenceFlags ?? []), ...trustFlags(inYear, evidence, railReports, policy)];
  const blocking = flags.filter((flag) => flag.severity === "blocking");
  const bounded = flags.filter((flag) => flag.severity === "bounded");
  const reviewReasons = blocking.map(flagReason);

  if (coverage.complete && coverage.documentedMemberCount === 0 && policy.certificationsAloneNeedReview) {
    reviewReasons.push({
      code: "no_documentary_evidence",
      message:
        "The file holds signed statements of no income and no document or data source. Whether income can be verified by certification alone is not addressed by the proposed rules, so a reviewer must decide.",
      memberIds: [],
      sourceIds: [],
    });
  }

  const result = (outcome: DirectOutcome, reliedOn: DirectEvaluation["reliedOn"] = null): DirectEvaluation => ({ outcome, income, coverage, methodBasis, reasons, reviewReasons, reliedOn });

  if (!coverage.complete) return result("incomplete");
  if (!threshold) return result("not_evaluated");

  const low = classifyAgainstThreshold(income.lowerBoundCents, threshold);
  const high = classifyAgainstThreshold(income.upperBoundCents, threshold);
  const readingsText = threshold.readings.map((reading) => `${reading.label}: ${formatUsd(reading.thresholdCents)}`).join("; ");

  if (low !== high) {
    reviewReasons.push({
      code: "income_range_spans_limit",
      message:
        `Household income for ${incomeYear} is between ${formatUsd(income.lowerBoundCents)} and ${formatUsd(income.upperBoundCents)} depending on points the sources leave open, ` +
        `and the limit (${formatUsd(threshold.lowerBoundCents)}${threshold.readingsAgree ? "" : ` to ${formatUsd(threshold.upperBoundCents)}`}) falls inside or too close to that range to decide automatically.`,
      memberIds: [],
      sourceIds: [],
    });
    reviewReasons.push(...bounded.map(flagReason));
  }
  if (low === "between_readings" || high === "between_readings") {
    reviewReasons.push({
      code: "between_provisional_readings",
      message:
        `The limit is provisional and the proposed rules can be read two ways, which give different limits for this county and household size (${readingsText}). ` +
        "Household income is at or below one and above the other. Which reading the IRS will publish is not known, so a reviewer must decide.",
      memberIds: [],
      sourceIds: [],
    });
  }
  if (low === "near_threshold" || high === "near_threshold") {
    reviewReasons.push({
      code: "near_provisional_threshold",
      message:
        `Household income is within ${formatBps(threshold.reviewBand.bps)} of the provisional limit (${readingsText}). ` +
        "The limit is HUD-derived and the IRS-published limit may differ, so the SGO's review band sends this to a reviewer.",
      memberIds: [],
      sourceIds: [],
    });
  }
  if (reviewReasons.length > 0) return result("needs_review");

  if (bounded.length > 0) {
    reasons.push({
      code: "income_ambiguity_does_not_change_result",
      message:
        `Some income on file is treated differently under different readings of the rules, so household income is between ${formatUsd(income.lowerBoundCents)} and ${formatUsd(income.upperBoundCents)}. ` +
        "The whole range is on the same side of the limit, so the open points do not change the result.",
      memberIds: [],
      sourceIds: unique(bounded.flatMap((flag) => flag.sourceIds)),
    });
  }
  const limitsText = threshold.readingsAgree ? formatUsd(threshold.lowerBoundCents) : `${formatUsd(threshold.lowerBoundCents)} to ${formatUsd(threshold.upperBoundCents)} (${readingsText})`;
  if (low === "within") {
    reasons.push({
      code: "direct_income_within_limit",
      message: `Household income for ${incomeYear} of ${formatUsd(income.totalCountedCents)} is not greater than the limit of ${limitsText} for a household of ${threshold.householdSize} in ${threshold.county.name}${threshold.readingsAgree ? "" : ", under every reading"}.`,
      memberIds: [],
      sourceIds: [],
    });
    return result("within_limit", "lower_bound");
  }
  reasons.push({
    code: "direct_income_over_limit",
    message: `Household income for ${incomeYear} of ${formatUsd(income.totalCountedCents)} is greater than the limit of ${limitsText} for a household of ${threshold.householdSize} in ${threshold.county.name}${threshold.readingsAgree ? "" : ", under every reading"}. Every adult's income is documented.`,
    memberIds: [],
    sourceIds: [],
  });
  return result("over_limit", "upper_bound");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** 500 -> "5%", 250 -> "2.5%". */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${String(fraction).padStart(2, "0").replace(/0+$/, "")}%`;
}
