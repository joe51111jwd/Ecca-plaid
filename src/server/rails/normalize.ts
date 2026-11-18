/**
 * Pure helpers shared by every rail adapter and by the service: turning pay stubs into report sources,
 * the coverage summary, and the step from a stored report to the income engine's evidence.
 *
 * The rule that matters (same as for uploaded documents, src/engine/income/reconcile.ts): only a Form W-2
 * or a pay stub that closes the income year can stand for that year's income. A mid-year pay stub and bank
 * deposits are shown to a reviewer and never counted.
 */
import { classifyPayStub, projectAnnualFromYtd, type IncomeEvidence, type IncomeReviewFlag } from "@/engine/income";
import { formatUsd } from "@/lib/money";
import type { NormalizedIncomeReport, NormalizedIncomeSource, RailConfidence, RailPayFrequency } from "./types";

/** The source types that may become counted income without a person looking at them. */
export function isCountableSource(source: Pick<NormalizedIncomeSource, "type" | "taxYear">, incomeYear: number): boolean {
  return (source.type === "w2" || source.type === "final_paystub_ytd") && source.taxYear === incomeYear;
}

/** Whether a source is about the income year but may not be counted (review material). */
export function isReviewSource(source: Pick<NormalizedIncomeSource, "type" | "taxYear">, incomeYear: number): boolean {
  return (source.type === "paystub_projection" || source.type === "bank_income_estimate") && source.taxYear === incomeYear;
}

export function summarizeCoverage(sources: readonly NormalizedIncomeSource[], incomeYear: number, opts: { partialHint?: boolean } = {}): NormalizedIncomeReport["coverage"] {
  const incomeYearCovered = sources.some((s) => isCountableSource(s, incomeYear));
  const hasReviewOnly = sources.some((s) => isReviewSource(s, incomeYear));
  return { incomeYearCovered, partialYear: !incomeYearCovered && (hasReviewOnly || opts.partialHint === true) };
}

/**
 * Parses a money amount given as a JSON number or a decimal string ("45000.00", "-12.5") into cents
 * without going through binary floating point for strings. Returns null for anything that is not a finite
 * amount with at most two decimals (a number is rounded to the cent).
 */
export function decimalToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const c = Math.round(value * 100);
    return Number.isSafeInteger(c) ? c : null;
  }
  if (typeof value !== "string") return null;
  const m = /^\s*(-)?(\d{1,15})(?:\.(\d{1,2}))?\s*$/.exec(value);
  if (!m) return null;
  const c = Number(m[2]) * 100 + Number(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] ? -c : c;
}

/** A pay stub as an adapter read it, before it is classified. */
export interface RawPayStub {
  employerName: string | null;
  payDate: string;
  payFrequency: RailPayFrequency | null;
  ytdGrossCents: number | null;
  providerRef: string | null;
}

export interface PayStubSources {
  sources: NormalizedIncomeSource[];
  warnings: string[];
}

function employerKey(name: string | null): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Keeps the latest stub of the income year per employer (its year-to-date figure already contains the
 * earlier ones) and classifies it: closes the year → `final_paystub_ytd`; otherwise → `paystub_projection`
 * with a straight-line projection for the reviewer. Stubs from other years and stubs without a
 * year-to-date figure are dropped with a warning.
 */
export function payStubSources(stubs: readonly RawPayStub[], incomeYear: number, confidence: RailConfidence): PayStubSources {
  const warnings: string[] = [];
  const latest = new Map<string, RawPayStub & { ytdGrossCents: number }>();
  let otherYear = 0;
  for (const stub of stubs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stub.payDate) || Number(stub.payDate.slice(0, 4)) !== incomeYear) {
      otherYear += 1;
      continue;
    }
    if (stub.ytdGrossCents === null || stub.ytdGrossCents < 0) {
      warnings.push(`A ${incomeYear} pay stub dated ${stub.payDate} has no year-to-date gross pay and was not used.`);
      continue;
    }
    const key = employerKey(stub.employerName);
    const current = latest.get(key);
    if (!current || stub.payDate > current.payDate || (stub.payDate === current.payDate && stub.ytdGrossCents > current.ytdGrossCents)) {
      latest.set(key, { ...stub, ytdGrossCents: stub.ytdGrossCents });
    }
  }
  if (otherYear > 0) warnings.push(`${otherYear} pay stub(s) dated outside ${incomeYear} were not used for ${incomeYear} income.`);

  const sources: NormalizedIncomeSource[] = [];
  for (const stub of [...latest.values()].sort((a, b) => employerKey(a.employerName).localeCompare(employerKey(b.employerName)))) {
    const closes = classifyPayStub({ payDate: stub.payDate, payFrequency: stub.payFrequency, markedFinal: false }, incomeYear) === "year_end";
    if (closes) {
      sources.push({
        type: "final_paystub_ytd",
        employerName: stub.employerName,
        grossAnnualCents: stub.ytdGrossCents,
        taxYear: incomeYear,
        confidence,
        note: `Year-to-date gross pay on the last ${incomeYear} pay stub (dated ${stub.payDate}).`,
        medicareWagesCents: null,
        payDate: stub.payDate,
        payFrequency: stub.payFrequency,
        ytdGrossCents: stub.ytdGrossCents,
        providerRef: stub.providerRef,
      });
    } else {
      sources.push({
        type: "paystub_projection",
        employerName: stub.employerName,
        grossAnnualCents: projectAnnualFromYtd(stub.ytdGrossCents, stub.payDate),
        taxYear: incomeYear,
        confidence: "low",
        note: `The latest ${incomeYear} pay stub is dated ${stub.payDate} and shows ${formatUsd(stub.ytdGrossCents)} so far; the annual figure is a straight-line projection for a reviewer and is not counted.`,
        medicareWagesCents: null,
        payDate: stub.payDate,
        payFrequency: stub.payFrequency,
        ytdGrossCents: stub.ytdGrossCents,
        providerRef: stub.providerRef,
      });
    }
  }
  return { sources, warnings };
}

/* ------------------------------------------------------------------- report → income engine */

export interface ReportEvidence {
  /** Ready for `reconcileIncomeEvidence` (W-2s and year-closing pay stubs for the income year only). */
  evidence: IncomeEvidence[];
  /** Review material: projections and bank deposits. Never counted. */
  flags: IncomeReviewFlag[];
}

/**
 * The income engine's view of one stored report. `sourceId` is the rail connection id, so every income
 * item and flag points back at the connection (and through it at the report hash).
 */
export function reportToEvidence(report: NormalizedIncomeReport, ids: { railConnectionId: string; memberId: string }): ReportEvidence {
  const evidence: IncomeEvidence[] = [];
  const flags: IncomeReviewFlag[] = [];
  const { railConnectionId, memberId } = ids;
  for (const source of report.sources) {
    if (source.taxYear !== report.incomeYear) continue;
    if (source.type === "w2") {
      evidence.push({
        kind: "w2",
        sourceId: railConnectionId,
        origin: "rail",
        memberId,
        taxYear: source.taxYear,
        employerName: source.employerName,
        wagesCents: source.grossAnnualCents,
        medicareWagesCents: source.medicareWagesCents,
      });
    } else if (source.type === "final_paystub_ytd" && source.payDate) {
      evidence.push({
        kind: "pay_stub",
        sourceId: railConnectionId,
        origin: "rail",
        memberId,
        employerName: source.employerName,
        payDate: source.payDate,
        payFrequency: source.payFrequency,
        grossYtdCents: source.grossAnnualCents,
        // The adapter classified this stub as closing the year with the engine's own rule (payStubSources),
        // or the provider labelled it final; either way the engine must treat it as year-end.
        markedFinal: true,
      });
    } else if (source.type === "paystub_projection") {
      flags.push({
        code: "pay_stub_projection_only",
        severity: "blocking",
        message:
          `A data connection returned only a pay stub that does not close ${report.incomeYear}` +
          (source.payDate ? ` (dated ${source.payDate}, ${formatUsd(source.ytdGrossCents ?? 0)} so far)` : "") +
          `. A straight-line projection would be ${formatUsd(source.grossAnnualCents)}; it is shown for the reviewer and is not used.`,
        itemId: null,
        memberIds: [memberId],
        sourceIds: [railConnectionId],
      });
    } else if (source.type === "bank_income_estimate") {
      flags.push({
        code: "rail_bank_net_deposits",
        severity: "blocking",
        message: `A bank connection shows ${formatUsd(source.grossAnnualCents)} of ${report.incomeYear} deposits from one income source. Deposits are amounts after taxes and deductions, not household income; a reviewer must establish the income.`,
        itemId: null,
        memberIds: [memberId],
        sourceIds: [railConnectionId],
      });
    }
  }
  return { evidence, flags };
}
