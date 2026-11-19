import { thresholdReadingLabel, thresholdSourceName } from "@/engine/ami";
import type { Decision, ThresholdReliedOn } from "@/engine/decision";
import { formatDateTime } from "@/components/ui/date-format";
import { formatUsd } from "@/lib/money";

/**
 * The limit a verification was measured against, in the dashboard's words. Pure: it reads the stored decision
 * (which records every reading, the bounds and the figure relied on) and never recomputes a threshold.
 *
 * Copy rules (docs/architecture.md): a HUD-derived limit is always called provisional and never "the IRS limit";
 * while the table is HUD-derived both readings are shown and neither is presented as the IRS's choice.
 */

export interface ReadingLine {
  id: string;
  /** The reading's plain-English name from the AMI engine's copy. */
  name: string;
  cents: number;
  /** The arithmetic with the actual numbers. */
  formula: string;
  /** This is the figure the result rested on. */
  reliedOn: boolean;
}

export interface LimitSummary {
  provisional: boolean;
  /** "HUD-derived (provisional)" or "IRS-published". */
  sourceName: string;
  /** "the provisional limit" / "the IRS-published limit": safe wording for sentences. */
  limitNoun: string;
  tableVersion: string;
  effectiveDate: string;
  areaName: string;
  countyName: string;
  householdSize: number;
  capPct: number;
  readings: ReadingLine[];
  readingsAgree: boolean;
  lowerCents: number;
  upperCents: number;
  reliedOn: ThresholdReliedOn;
  reliedOnCents: number | null;
  /** One sentence on which figure the result rested on and why. */
  reliedOnSentence: string;
  /** Present while the SGO's own cap is below 300 percent. */
  capNote: string | null;
}

export interface DecisionSummary {
  limit: LimitSummary | null;
  /** Recorded household income for the income year; null without direct evidence. */
  incomeCents: number | null;
  incomeYear: number;
  /** "Decided by the engine" / "Decided by a reviewer on 2026-11-18". */
  decidedByLine: string;
  /** The reviewer's notes, when a reviewer resolved it. */
  reviewerNotes: string | null;
  /**
   * The result in one sentence when it rests on an income comparison ("Household income for 2025 of $41,250 is at
   * or below the provisional limit relied on, $249,600."), read under the status headline; null otherwise (categorical method, not
   * decided), where the page leads with the engine's own explanation instead.
   */
  outcome: string | null;
}

function usd(cents: number): string {
  return formatUsd(cents, { cents: true });
}

export function reliedOnSentence(reliedOn: ThresholdReliedOn, cents: number | null, provisional: boolean, readingsAgree: boolean): string {
  const figure = cents === null ? "" : ` (${usd(cents)})`;
  switch (reliedOn) {
    case "single_limit":
      return provisional && readingsAgree
        ? `Both readings of the proposed rule give the same figure${figure}, so the result rests on that one provisional limit.`
        : provisional
          ? `The result rests on the provisional limit${figure}.`
          : `The result rests on the IRS-published limit${figure}.`;
    case "lower_bound":
      return `The result rests on the lower reading${figure}: household income is at or below the lowest figure, so it is within the limit under every reading.`;
    case "upper_bound":
      return `The result rests on the higher reading${figure}: household income is above the highest figure, so it is over the limit under every reading.`;
    case "statutory_limit":
      return `A reviewer resolved this above the organization's own cap, relying on the highest reading at the statutory 300 percent${figure}.`;
    case "none":
      return "No income comparison decided this result.";
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One sentence for a decided result that rests on comparing recorded income with a limit; null for anything else. */
export function outcomeSentence(decision: Pick<Decision, "status" | "incomeYear" | "householdIncomeCents" | "threshold">): string | null {
  const t = decision.threshold;
  const income = decision.householdIncomeCents;
  if (!t || income === null || t.reliedOnLimitCents === null) return null;
  const noun = t.provisional ? "the provisional limit" : "the IRS-published limit";
  const figures = `household income for ${decision.incomeYear} of ${formatUsd(income)}`;
  const limit = formatUsd(t.reliedOnLimitCents);
  if (decision.status === "eligible" && (t.reliedOn === "single_limit" || t.reliedOn === "lower_bound" || t.reliedOn === "statutory_limit")) {
    return `${capital(figures)} is at or below ${noun} relied on, ${limit}.`;
  }
  if (decision.status === "ineligible" && (t.reliedOn === "single_limit" || t.reliedOn === "upper_bound")) {
    return `${capital(figures)} is above ${noun} relied on, ${limit}.`;
  }
  return null;
}

/** The stored decision's limit and outcome in plain words; null parts where the decision has none yet. */
export function summarizeDecision(decision: Decision | null): DecisionSummary | null {
  if (!decision) return null;
  const t = decision.threshold;
  let limit: LimitSummary | null = null;
  if (t) {
    const provisional = t.provisional;
    limit = {
      provisional,
      sourceName: thresholdSourceName(t.source),
      limitNoun: provisional ? "the provisional limit" : "the IRS-published limit",
      tableVersion: t.tableVersion,
      effectiveDate: t.effectiveDate,
      areaName: t.area.name,
      countyName: t.county.name,
      householdSize: t.householdSize,
      capPct: t.capPct,
      readings: t.readings.map((r) => ({
        id: r.id,
        name: thresholdReadingLabel(r.id),
        cents: r.thresholdCents,
        formula: r.formula,
        reliedOn:
          (t.reliedOn === "lower_bound" && r.thresholdCents === t.lowerBoundCents) ||
          (t.reliedOn === "upper_bound" && r.thresholdCents === t.upperBoundCents) ||
          (t.reliedOn === "single_limit" && t.readingsAgree),
      })),
      readingsAgree: t.readingsAgree,
      lowerCents: t.lowerBoundCents,
      upperCents: t.upperBoundCents,
      reliedOn: t.reliedOn,
      reliedOnCents: t.reliedOnLimitCents,
      reliedOnSentence: reliedOnSentence(t.reliedOn, t.reliedOnLimitCents, provisional, t.readingsAgree),
      capNote: t.capPct < 300 ? `Your organization's policy caps eligibility at ${t.capPct} percent of area median income; the figures above are at that cap.` : null,
    };
  }
  const by = decision.decidedBy;
  return {
    limit,
    incomeCents: decision.householdIncomeCents,
    incomeYear: decision.incomeYear,
    decidedByLine: decision.status === "eligible" || decision.status === "ineligible" ? (by.type === "reviewer" ? `Decided by a reviewer on ${formatDateTime(by.resolvedOn)}` : `Decided automatically on ${formatDateTime(decision.decidedOn)}`) : "Not decided yet",
    reviewerNotes: by.type === "reviewer" ? by.notes : null,
    outcome: outcomeSentence(decision),
  };
}
