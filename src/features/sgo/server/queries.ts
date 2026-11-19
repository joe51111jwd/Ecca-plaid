import { centralDateString, now } from "@/lib/clock";
import { acknowledgmentWorklist, buildAcknowledgment, buildLetter, listIrsReports, type AcknowledgmentBuild, type LetterContent, type Worklist } from "@/server/acknowledgments";
import { audit } from "@/server/audit";
import { listPartnershipsForSgo } from "@/server/businesses";
import { listMembers, type MemberSummary } from "@/server/orgs";
import { onboardingChecklist, type OnboardingChecklist } from "@/server/sgos";
import { listReviewQueue, listVerifications, statusCounts, type StatusCounts, type VerificationRow } from "@/server/verifications";
import { currentReportingYear, reportingDeadlines, type ReportingDeadlines } from "../deadlines";
import { attentionItems, type AttentionItem } from "../home";
import type { SgoActor } from "../types";

/**
 * Composite reads for dashboard pages: several service calls a page needs together. Every call passes the actor's
 * own organization and mode; reads of donor records name the reader for the audit log.
 */

export const readerOf = (a: SgoActor) => ({ actor: { type: "user" as const, id: a.userId }, request: a.request });

/** Today's date in US Central time, the reference zone for the deadlines. */
export function today(): string {
  return centralDateString(now());
}

export interface ShellCounts {
  reviewCount: number;
  partnerRequests: number;
}

/** The sidebar badges: verifications that need review (this mode) and camp/school requests waiting for an answer. */
export async function loadShellCounts(actor: SgoActor): Promise<ShellCounts> {
  const [counts, pending] = await Promise.all([statusCounts(actor.orgId, actor.mode), listPartnershipsForSgo(actor.orgId, { status: "pending" })]);
  return { reviewCount: counts.needs_review, partnerRequests: pending.length };
}

export interface HomeData {
  counts: StatusCounts;
  checklist: OnboardingChecklist;
  reportingYear: number;
  deadlines: ReportingDeadlines;
  worklist: Pick<Worklist, "counts" | "byAction" | "acknowledgmentDueDate" | "reportDueDate"> | null;
  reportSubmitted: boolean;
  attention: AttentionItem[];
  recent: VerificationRow[];
  reviews: { open: number; waitingOnFamily: number; oldestAgeDays: number | null };
}

export async function loadHome(actor: SgoActor, on: string = today()): Promise<HomeData> {
  const reportingYear = currentReportingYear(on);
  const deadlines = reportingDeadlines(on, reportingYear);
  const reader = readerOf(actor);
  const [counts, checklist, queue, worklist, reports, recent] = await Promise.all([
    statusCounts(actor.orgId, actor.mode),
    onboardingChecklist(actor.orgId),
    listReviewQueue(actor.orgId, { mode: actor.mode, limit: 100 }),
    acknowledgmentWorklist(actor.orgId, { mode: actor.mode, taxYear: reportingYear, limit: 1 }, reader),
    listIrsReports(actor.orgId, { mode: actor.mode, taxYear: reportingYear }, reader),
    listVerifications(actor.orgId, { mode: actor.mode, limit: 5 }),
  ]);
  const reviews = {
    open: queue.items.length,
    waitingOnFamily: queue.items.filter((i) => i.waitingOnFamily).length,
    oldestAgeDays: queue.items.find((i) => !i.waitingOnFamily)?.ageDays ?? null,
  };
  const reportSubmitted = reports.some((r) => r.submittedOn !== null);
  const remaining = checklist.items.filter((i) => !i.done).length;
  return {
    counts,
    checklist,
    reportingYear,
    deadlines,
    worklist: { counts: worklist.counts, byAction: worklist.byAction, acknowledgmentDueDate: worklist.acknowledgmentDueDate, reportDueDate: worklist.reportDueDate },
    reportSubmitted,
    attention: attentionItems({
      mode: actor.mode,
      reviews,
      acknowledgments: { taxYear: reportingYear, donors: worklist.counts.donors, byAction: worklist.byAction, outstanding: worklist.counts.outstanding },
      deadlines: { acknowledgment: deadlines.acknowledgment, report: deadlines.report },
      reportSubmitted,
      onboarding: { remaining, total: checklist.items.length },
    }),
    recent: recent.items,
    reviews,
  };
}

/** The organization's team: names for timelines and the reviewer picker. */
export async function loadTeam(actor: SgoActor): Promise<MemberSummary[]> {
  return listMembers(actor.orgId, { userId: actor.userId, request: actor.request });
}

/** user id → display name (name, else email), for timelines and assignments. */
export function teamNames(team: readonly MemberSummary[]): Map<string, string> {
  return new Map(team.map((m) => [m.user.id, m.user.name?.trim() || m.user.email]));
}

export interface AcknowledgmentPreview {
  build: AcknowledgmentBuild;
  /** The letter as it would be issued now; null while the acknowledgment is blocked or not required. */
  letter: LetterContent | null;
}

/**
 * What issuing the acknowledgment would produce right now, without issuing it: the build (with its blockers) and,
 * when it is ready, the letter. A read of donor records, so it is audited as `acknowledgment.preview`.
 */
export async function loadAcknowledgmentPreview(actor: SgoActor, donorId: string, taxYear: number, nextVersion: number): Promise<AcknowledgmentPreview> {
  const build = await buildAcknowledgment(actor.orgId, donorId, taxYear, { mode: actor.mode });
  await audit({ actor: { type: "user", id: actor.userId }, orgId: actor.orgId, action: "acknowledgment.preview", target: { type: "donor", id: donorId }, metadata: { taxYear, mode: actor.mode, status: build.status }, request: actor.request });
  const letter =
    build.status === "ready" && build.snapshot
      ? buildLetter({
          acknowledgmentId: "preview",
          mode: actor.mode,
          taxYear,
          version: nextVersion,
          issuedAt: now(),
          snapshot: build.snapshot,
          totalDesignatedCents: build.totalDesignatedCents,
          totalNonDesignatedCents: build.totalNonDesignatedCents,
          goodsOrServices: build.goodsOrServices,
          previous: null,
        })
      : null;
  return { build, letter };
}
