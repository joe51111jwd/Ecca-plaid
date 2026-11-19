import { acknowledgmentDueDate, irsContributionReportDueDate } from "@/taxmath";
import { DEADLINE_APPROACHING_DAYS } from "./policy";

/**
 * The January 31 acknowledgment and February 28 IRS-report countdowns. Pure: "today" is a US Central calendar date
 * (YYYY-MM-DD) the caller reads from the clock; the due dates come from src/taxmath, the one owner of those rules.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDay(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Date.UTC rolls 2026-02-31 over to March; refuse dates that do not exist.
  if (new Date(ms).toISOString().slice(0, 10) !== iso) throw new RangeError(`Not a calendar date: ${iso}`);
  return ms / 86_400_000;
}

/** Whole calendar days from `today` until `due`: 0 on the day, negative once it has passed. */
export function daysUntil(today: string, due: string): number {
  return utcDay(due) - utcDay(today);
}

export type DeadlineState = "upcoming" | "approaching" | "due_today" | "overdue";

export interface Deadline {
  /** YYYY-MM-DD. */
  dueDate: string;
  daysLeft: number;
  state: DeadlineState;
  /** "21 days left", "Due today", "3 days overdue". */
  label: string;
}

export function deadlineOf(today: string, dueDate: string, approachingDays: number = DEADLINE_APPROACHING_DAYS): Deadline {
  const daysLeft = daysUntil(today, dueDate);
  const state: DeadlineState = daysLeft < 0 ? "overdue" : daysLeft === 0 ? "due_today" : daysLeft <= approachingDays ? "approaching" : "upcoming";
  const plural = (n: number) => (n === 1 ? "day" : "days");
  const label = daysLeft < 0 ? `${-daysLeft} ${plural(-daysLeft)} overdue` : daysLeft === 0 ? "Due today" : `${daysLeft} ${plural(daysLeft)} left`;
  return { dueDate, daysLeft, state, label };
}

export interface ReportingDeadlines {
  /** The calendar year of the gifts the deadlines are for. */
  taxYear: number;
  acknowledgment: Deadline;
  report: Deadline;
}

/** Both deadlines for the gifts of `taxYear`, as seen on `today`. */
export function reportingDeadlines(today: string, taxYear: number): ReportingDeadlines {
  return { taxYear, acknowledgment: deadlineOf(today, acknowledgmentDueDate(taxYear)), report: deadlineOf(today, irsContributionReportDueDate(taxYear)) };
}

/**
 * The calendar year whose acknowledgments and report are due next: last year's gifts until last year's report
 * deadline has passed, then this year's.
 */
export function currentReportingYear(today: string): number {
  const year = Number(today.slice(0, 4));
  utcDay(today);
  return daysUntil(today, irsContributionReportDueDate(year - 1)) >= 0 ? year - 1 : year;
}

/** Tax years offered in pickers: the current calendar year back to `first`, newest first. */
export function taxYearOptions(today: string, first: number): number[] {
  const last = Math.max(first, Number(today.slice(0, 4)));
  const out: number[] = [];
  for (let y = last; y >= first; y--) out.push(y);
  return out;
}

/** A tax year from a query string, or `fallback` when it is missing or not one of `allowed`. */
export function pickTaxYear(raw: string | undefined, allowed: readonly number[], fallback: number): number {
  if (raw && /^\d{4}$/.test(raw)) {
    const y = Number(raw);
    if (allowed.includes(y)) return y;
  }
  return fallback;
}
