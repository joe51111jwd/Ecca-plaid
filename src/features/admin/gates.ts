import type { SgoListSource } from "@/db/schema";
import type { Tone } from "@/components/ui/badge";
import { isCalendarDate } from "./forms";

/**
 * The legal switches at a glance (Overview) — pure, from values the page already loaded. Wording is operator-facing;
 * it never says the IRS list or limitation table exists unless the active source says so.
 */

export type GateKey = "fees" | "live_gifts" | "credit_start" | "sgo_list" | "income_table";

export interface GateSummary {
  key: GateKey;
  title: string;
  /** The state in a few words. */
  value: string;
  tone: Tone;
  /** One or two sentences: what this means right now. */
  detail: string;
  href: string;
}

export interface GateInput {
  /** Today's date in US Central time (YYYY-MM-DD). */
  today: string;
  fees: { active: "none" | "sgo_invoiced" | "donor_service_fee"; counselMemoRef: string | null; title: string };
  liveGiftsEnabled: boolean;
  creditStartDate: string;
  creditStartLocked: boolean;
  listSource: SgoListSource;
  /** Entries of each list source currently marked listed. */
  listedEntries: Record<SgoListSource, number>;
  incomeTable: { version: string; provisional: boolean };
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Error(`Invalid date: ${from} / ${to}`);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function summarizeGates(input: GateInput): GateSummary[] {
  const daysToStart = daysBetween(input.today, input.creditStartDate);
  const creditInEffect = daysToStart <= 0;

  const fees: GateSummary =
    input.fees.active === "none"
      ? { key: "fees", title: "Fee structure", value: "None", tone: "neutral", detail: "No platform fee is taken on any section 25F gift.", href: "/admin/gates#fees" }
      : {
          key: "fees",
          title: "Fee structure",
          value: input.fees.title,
          tone: "warning",
          detail: `Active under counsel memo ${input.fees.counselMemoRef ?? "(missing)"}. The designated amount is never reduced by the fee.`,
          href: "/admin/gates#fees",
        };

  const live: GateSummary = !input.liveGiftsEnabled
    ? { key: "live_gifts", title: "Live gifts", value: "Off", tone: "neutral", detail: "Only sandbox gifts can be made. No real money moves.", href: "/admin/gates#live-gifts" }
    : creditInEffect
      ? { key: "live_gifts", title: "Live gifts", value: "On", tone: "success", detail: "Real-money gifts are accepted for SGOs on the active list.", href: "/admin/gates#live-gifts" }
      : {
          key: "live_gifts",
          title: "Live gifts",
          value: "On (held)",
          tone: "warning",
          detail: `Switched on, but no gift is credit-eligible before ${input.creditStartDate}.`,
          href: "/admin/gates#live-gifts",
        };

  const start: GateSummary = {
    key: "credit_start",
    title: "Credit start date",
    value: input.creditStartDate,
    tone: creditInEffect ? "success" : "info",
    detail:
      (creditInEffect ? "In effect: gifts from this date can earn the credit." : `${daysToStart} day${daysToStart === 1 ? "" : "s"} away. Gifts before it do not earn the credit.`) +
      (input.creditStartLocked ? " Fixed in production." : ""),
    href: "/admin/gates#credit-start",
  };

  const listed = input.listedEntries[input.listSource];
  const list: GateSummary =
    listed === 0
      ? {
          key: "sgo_list",
          title: "SGO list",
          value: input.listSource === "irs_published" ? "IRS-published (empty)" : "Provisional (empty)",
          tone: "danger",
          detail: "The active list has no listed entries, so every gift is refused. Import the list.",
          href: "/admin/sgo-list",
        }
      : input.listSource === "irs_published"
        ? { key: "sgo_list", title: "SGO list", value: "IRS-published", tone: "neutral", detail: `${listed} listed entr${listed === 1 ? "y" : "ies"} on the imported IRS list.`, href: "/admin/sgo-list" }
        : {
            key: "sgo_list",
            title: "SGO list",
            value: "Provisional",
            tone: "caution",
            detail: `${listed} listed entr${listed === 1 ? "y" : "ies"} on the curated provisional list. Shown to donors as provisional.`,
            href: "/admin/sgo-list",
          };

  const table: GateSummary = input.incomeTable.provisional
    ? {
        key: "income_table",
        title: "Income limits",
        value: "HUD-derived",
        tone: "caution",
        detail: `Table ${input.incomeTable.version}. Every decision is labeled provisional; incomes between the two readings go to review.`,
        href: "/admin/income-limits",
      }
    : { key: "income_table", title: "Income limits", value: "IRS-published", tone: "neutral", detail: `Table ${input.incomeTable.version}.`, href: "/admin/income-limits" };

  return [fees, live, start, list, table];
}
