import type { Mode } from "@/db/schema";
import type { Deadline } from "./deadlines";
import { REVIEW_WAITING_LONG_DAYS } from "./policy";

/**
 * "Needs your attention" on the dashboard home. Pure: the page loads the counts through the services and this
 * turns them into a short, ordered list (most urgent first). Nothing here decides anything about a verification or
 * an acknowledgment; it only points at the screen where the work is done.
 */

export interface AttentionInput {
  mode: Mode;
  /** Open review tasks and the age in whole days of the oldest one. */
  reviews: { open: number; waitingOnFamily: number; oldestAgeDays: number | null };
  /** The acknowledgment worklist for the reporting year (counts over every donor). */
  acknowledgments: {
    taxYear: number;
    donors: number;
    byAction: Readonly<Record<"add_sgo_ein" | "register_portal" | "enter_donor_number" | "generate_sandbox_number" | "review" | "issue" | "mail_paper" | "none", number>>;
    outstanding: number;
  } | null;
  deadlines: { acknowledgment: Deadline; report: Deadline };
  /** A report version for the reporting year is recorded as entered in the IRS portal. */
  reportSubmitted: boolean;
  onboarding: { remaining: number; total: number };
}

export interface AttentionItem {
  key: string;
  tone: "danger" | "warning" | "info";
  title: string;
  body: string;
  href: string;
  actionLabel: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { reviews, acknowledgments: ack, deadlines } = input;

  const actionable = reviews.open - reviews.waitingOnFamily;
  if (actionable > 0) {
    const oldest = reviews.oldestAgeDays;
    const late = oldest !== null && oldest >= REVIEW_WAITING_LONG_DAYS;
    items.push({
      key: "reviews",
      tone: late ? "danger" : "warning",
      title: `${plural(actionable, "verification needs", "verifications need")} a reviewer`,
      body: oldest === null ? "Open the review queue to decide them." : oldest === 0 ? "The oldest arrived today. Families are waiting on these decisions." : `The oldest has waited ${plural(oldest, "day", "days")}. Families are waiting on these decisions.`,
      href: "/sgo/review",
      actionLabel: "Open the review queue",
    });
  }

  if (ack && ack.donors > 0) {
    const year = ack.taxYear;
    if (ack.byAction.add_sgo_ein > 0) {
      items.push({
        key: "ack_ein",
        tone: "danger",
        title: `${plural(ack.byAction.add_sgo_ein, "acknowledgment is", "acknowledgments are")} blocked: your EIN is missing`,
        body: "Every acknowledgment must show your organization's EIN. Add it in Settings.",
        href: "/sgo/settings",
        actionLabel: "Add your EIN",
      });
    }
    if (ack.byAction.register_portal > 0) {
      items.push({
        key: "ack_portal",
        tone: "danger",
        title: `${plural(ack.byAction.register_portal, "acknowledgment is", "acknowledgments are")} blocked until you register in the IRS SGO portal`,
        body: "Unique donor numbers are created in the IRS SGO portal, so none can exist before you register there.",
        href: `/sgo/acknowledgments?year=${year}`,
        actionLabel: "See the worklist",
      });
    }
    const numbers = ack.byAction.enter_donor_number + ack.byAction.generate_sandbox_number;
    if (numbers > 0) {
      items.push({
        key: "ack_numbers",
        tone: "warning",
        title: `${plural(numbers, "donor needs", "donors need")} a unique donor number`,
        body:
          input.mode === "test"
            ? "In test mode you can generate sandbox numbers. They are labeled not valid for filing."
            : "Enter or import the numbers you created in the IRS SGO portal. They are never invented here.",
        href: `/sgo/acknowledgments?year=${year}`,
        actionLabel: "Add donor numbers",
      });
    }
    if (ack.byAction.review > 0) {
      items.push({
        key: "ack_review",
        tone: "warning",
        title: `${plural(ack.byAction.review, "acknowledgment needs", "acknowledgments need")} a person to look`,
        body: "Something other than a missing number is blocking them, such as an incomplete address or a refund.",
        href: `/sgo/acknowledgments?year=${year}&action=review`,
        actionLabel: "Review them",
      });
    }
    if (ack.byAction.issue > 0) {
      items.push({
        key: "ack_issue",
        tone: "info",
        title: `${plural(ack.byAction.issue, "acknowledgment is", "acknowledgments are")} ready to issue`,
        body: `Gifts made in ${year}.`,
        href: `/sgo/acknowledgments?year=${year}&action=issue`,
        actionLabel: "Issue acknowledgments",
      });
    }
    if (ack.byAction.mail_paper > 0) {
      items.push({
        key: "ack_paper",
        tone: "warning",
        title: `${plural(ack.byAction.mail_paper, "paper acknowledgment", "paper acknowledgments")} to mail`,
        body: "These donors did not consent to electronic delivery. Print, mail, then record the mailing.",
        href: `/sgo/acknowledgments?year=${year}&action=mail_paper`,
        actionLabel: "See paper mailings",
      });
    }
    const ackDue = deadlines.acknowledgment;
    if (ack.outstanding > 0 && ackDue.state !== "upcoming") {
      items.push({
        key: "deadline_ack",
        tone: ackDue.state === "approaching" ? "warning" : "danger",
        title: `Acknowledgments for ${year} are due ${ackDue.dueDate} (${ackDue.label.toLowerCase()})`,
        body: `${plural(ack.outstanding, "donor still needs", "donors still need")} an acknowledgment.`,
        href: `/sgo/acknowledgments?year=${year}`,
        actionLabel: "Open acknowledgments",
      });
    }
    const reportDue = deadlines.report;
    if (!input.reportSubmitted && reportDue.state !== "upcoming") {
      items.push({
        key: "deadline_report",
        tone: reportDue.state === "approaching" ? "warning" : "danger",
        title: `The IRS report for ${year} is due ${reportDue.dueDate} (${reportDue.label.toLowerCase()})`,
        body: "Generate the report, fix its issues and record when you entered it in the IRS SGO portal.",
        href: `/sgo/irs-report?year=${year}`,
        actionLabel: "Open the IRS report",
      });
    }
  }

  if (input.onboarding.remaining > 0) {
    items.push({
      key: "onboarding",
      tone: "info",
      title: `${plural(input.onboarding.remaining, "setup step", "setup steps")} left`,
      body: "See the checklist below.",
      href: "/sgo#setup",
      actionLabel: "See the checklist",
    });
  }

  const rank = { danger: 0, warning: 1, info: 2 } as const;
  return items.map((item, index) => ({ item, index })).sort((a, b) => rank[a.item.tone] - rank[b.item.tone] || a.index - b.index).map(({ item }) => item);
}
