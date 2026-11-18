import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { centralDateString, now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { invalid } from "@/lib/errors";
import { queueEmail, renderEmail } from "@/server/email";
import { enqueue } from "@/server/jobs";
import { getSgoProfile, systemActor } from "@/server/sgos";
import { acknowledgmentDueDate, formatIsoDateLong, irsContributionReportDueDate } from "@/taxmath";
import { authorizeStaff } from "./access";
import { issueInTx, type IssueResult } from "./issue";
import { fill, NOTICE_COPY } from "./letter-copy";
import { ACKNOWLEDGMENT_NOTICE_LEVELS, ANNUAL_JOB_BATCH, ANNUAL_JOB_MODES, IRS_REPORT_NOTICE_LEVELS, SGO_DASHBOARD_PATH } from "./policy";
import { computeWorklist, type Worklist } from "./worklist";

/**
 * The recurring "acknowledgment.annual" job (docs/architecture.md "Jobs"). Each run, per mode:
 *
 *  1. Builds or refreshes the PRIOR calendar year's acknowledgment for every donor who gave that year, from
 *     January 1 on (the year must be over before element (B), the calendar-year total, is final): a donor whose
 *     latest version is issued and unchanged is skipped; everyone else is built and issued when nothing is missing,
 *     or stored as blocked with the reasons. Pending refresh requests for older years, and for the current year
 *     where a version was already issued, are processed too, so a later change always supersedes what was issued.
 *  2. Sends each SGO its worklist (missing donor numbers, missing EIN, paper-required donors, ...) when the
 *     acknowledgment window opens, then escalating reminders as January 31 approaches and an overdue notice after
 *     it while work is outstanding; from February 1 the same for the February 28 IRS contribution report.
 *
 * Dates come from now() in the deadline time zone. Issued acknowledgments emit acknowledgment.issued (issue.ts).
 * Idempotent: re-running a day changes nothing (unchanged versions are not re-issued; each notice level is
 * recorded once per SGO, mode, year and kind).
 */

export const ACKNOWLEDGMENT_ANNUAL_JOB = "acknowledgment.annual";

const { donations, acknowledgments, acknowledgmentRefreshes, acknowledgmentNotices, irsReports, memberships, users } = schema;

const payloadSchema = z.strictObject({
  mode: z.enum(["test", "live"]).optional(),
  /** Continuation: resume after this candidate key ("orgId|taxYear|donorId"). */
  after: z.string().min(1).max(400).optional(),
});

export interface AnnualRunSummary {
  mode: Mode;
  today: string;
  priorYear: number;
  processed: number;
  outcomes: Record<IssueResult["outcome"], number>;
  failed: number;
  /** A continuation job was enqueued for the remaining candidates (notices wait for the last batch). */
  continued: boolean;
  notices: Array<{ orgId: string; kind: "acknowledgments" | "irs_report"; level: NoticeLevel; recipients: number }>;
}

type NoticeLevel = "opening" | "reminder" | "urgent" | "final" | "overdue";
const LEVEL_RANK: Record<NoticeLevel, number> = { opening: 0, reminder: 1, urgent: 2, final: 3, overdue: 4 };

interface Candidate {
  key: string;
  orgId: string;
  donorId: string;
  taxYear: number;
}

const keyOf = (orgId: string, taxYear: number, donorId: string) => `${orgId}|${taxYear}|${donorId}`;

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative once `to` has passed. */
export function daysBetween(from: string, to: string): number {
  const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/**
 * The notice level due today, or null. Opening is sent once the window opens; reminder, urgent and final as the
 * deadline nears (only the most escalated level that applies, and only while work is outstanding); overdue once
 * after the deadline if work is still outstanding. A level is never sent when it or a higher one was already sent.
 */
export function noticeLevelFor(input: {
  today: string;
  windowStart: string;
  dueDate: string;
  outstanding: boolean;
  sent: ReadonlySet<NoticeLevel>;
  levels: ReadonlyArray<{ level: "reminder" | "urgent" | "final"; daysLeft: number }>;
}): NoticeLevel | null {
  if (input.today < input.windowStart) return null;
  const daysLeft = daysBetween(input.today, input.dueDate);
  let level: NoticeLevel = "opening";
  if (daysLeft < 0) level = "overdue";
  else for (const l of [...input.levels].sort((a, b) => b.daysLeft - a.daysLeft)) if (daysLeft <= l.daysLeft) level = l.level;
  if (level !== "opening" && !input.outstanding) return null;
  for (const s of input.sent) if (LEVEL_RANK[s] >= LEVEL_RANK[level]) return null;
  return level;
}

/** Donor/SGO/year combinations the run must build, in key order. */
async function listCandidates(db: DbOrTx, mode: Mode, priorYear: number, currentYear: number): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  const gave = await db
    .selectDistinct({ orgId: donations.orgId, donorId: donations.donorId })
    .from(donations)
    .where(and(eq(donations.mode, mode), eq(donations.taxYear, priorYear), inArray(donations.status, ["succeeded", "refunded"])));
  const versions = await db
    .select({ orgId: acknowledgments.orgId, donorId: acknowledgments.donorId, status: acknowledgments.status })
    .from(acknowledgments)
    .where(and(eq(acknowledgments.mode, mode), eq(acknowledgments.taxYear, priorYear)))
    .orderBy(desc(acknowledgments.version));
  const latest = new Map<string, string>();
  for (const v of versions) if (!latest.has(`${v.orgId}|${v.donorId}`)) latest.set(`${v.orgId}|${v.donorId}`, v.status);
  const pending = await db
    .select({ orgId: acknowledgmentRefreshes.orgId, donorId: acknowledgmentRefreshes.donorId, taxYear: acknowledgmentRefreshes.taxYear })
    .from(acknowledgmentRefreshes)
    .where(and(eq(acknowledgmentRefreshes.mode, mode), isNull(acknowledgmentRefreshes.resolvedAt), lt(acknowledgmentRefreshes.taxYear, currentYear + 1)));
  const pendingKeys = new Set(pending.map((p) => keyOf(p.orgId, p.taxYear, p.donorId)));

  for (const g of gave) {
    const key = keyOf(g.orgId, priorYear, g.donorId);
    if (latest.get(`${g.orgId}|${g.donorId}`) === "issued" && !pendingKeys.has(key)) continue;
    out.set(key, { key, orgId: g.orgId, donorId: g.donorId, taxYear: priorYear });
  }
  const currentYearPending = pending.filter((p) => p.taxYear === currentYear);
  const issuedThisYear = currentYearPending.length
    ? await db
        .selectDistinct({ orgId: acknowledgments.orgId, donorId: acknowledgments.donorId })
        .from(acknowledgments)
        .where(and(eq(acknowledgments.mode, mode), eq(acknowledgments.taxYear, currentYear), inArray(acknowledgments.status, ["issued", "superseded"])))
    : [];
  const issuedKeys = new Set(issuedThisYear.map((i) => `${i.orgId}|${i.donorId}`));
  for (const p of pending) {
    // Current-year requests wait for year end unless a version is already out (then it must be kept current).
    if (p.taxYear === currentYear && !issuedKeys.has(`${p.orgId}|${p.donorId}`)) continue;
    const key = keyOf(p.orgId, p.taxYear, p.donorId);
    if (!out.has(key)) out.set(key, { key, orgId: p.orgId, donorId: p.donorId, taxYear: p.taxYear });
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** SGO staff who receive the notices: owners and admins, else the SGO's support address. */
async function noticeRecipients(db: DbOrTx, orgId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.role, ["owner", "admin"])));
  const emails = [...new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean))].sort();
  if (emails.length > 0) return emails;
  const { profile } = await getSgoProfile(orgId, db);
  return profile.supportEmail ? [profile.supportEmail.trim().toLowerCase()] : [];
}

function yesNo(v: boolean): string {
  return v ? NOTICE_COPY.yes : NOTICE_COPY.no;
}

interface NoticeInput {
  orgId: string;
  mode: Mode;
  taxYear: number;
  kind: "acknowledgments" | "irs_report";
  level: NoticeLevel;
  dueDate: string;
  daysLeft: number;
  details: Array<{ label: string; value: string }>;
  summary: Record<string, unknown>;
}

/** Records the notice level (once) and queues one email per recipient, in one transaction. Returns the recipients, or null if already sent. */
async function sendNotice(input: NoticeInput): Promise<number | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const at = now();
    const [row] = await tx
      .insert(acknowledgmentNotices)
      .values({ orgId: input.orgId, mode: input.mode, taxYear: input.taxYear, kind: input.kind, level: input.level, sentAt: at, emailIds: [], summary: input.summary })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    const copy = NOTICE_COPY[input.kind][input.level];
    const vars = { year: input.taxYear, dueDate: formatIsoDateLong(input.dueDate), daysLeft: Math.max(input.daysLeft, 0) };
    const subject = `${input.mode === "test" ? NOTICE_COPY.sandboxPrefix : ""}${fill(copy.subject, vars)}`;
    const paragraphs = [fill(copy.lead, vars), ...(input.mode === "test" ? [NOTICE_COPY.sandboxNote] : [])];
    const { html, text } = renderEmail({ heading: fill(copy.subject, vars), preheader: fill(copy.lead, vars), paragraphs, details: input.details, cta: { label: NOTICE_COPY.cta, url: appUrl(SGO_DASHBOARD_PATH) } });
    const recipients = await noticeRecipients(tx, input.orgId);
    const emailIds: string[] = [];
    for (const to of recipients) {
      const email = await queueEmail({ to, subject, template: `acknowledgment_notice_${input.kind}`, html, text, related: { type: "organization", id: input.orgId } }, tx);
      await enqueue("email.send", { emailId: email.id }, { dedupeKey: `email:${email.id}` }, tx);
      emailIds.push(email.id);
    }
    await tx
      .update(acknowledgmentNotices)
      .set({ emailIds })
      .where(and(eq(acknowledgmentNotices.orgId, input.orgId), eq(acknowledgmentNotices.mode, input.mode), eq(acknowledgmentNotices.taxYear, input.taxYear), eq(acknowledgmentNotices.kind, input.kind), eq(acknowledgmentNotices.level, input.level)));
    return recipients.length;
  });
}

async function sentLevels(db: DbOrTx, orgId: string, mode: Mode, taxYear: number, kind: "acknowledgments" | "irs_report"): Promise<Set<NoticeLevel>> {
  const rows = await db
    .select({ level: acknowledgmentNotices.level })
    .from(acknowledgmentNotices)
    .where(and(eq(acknowledgmentNotices.orgId, orgId), eq(acknowledgmentNotices.mode, mode), eq(acknowledgmentNotices.taxYear, taxYear), eq(acknowledgmentNotices.kind, kind)));
  return new Set(rows.map((r) => r.level));
}

/**
 * Report status for the February reminders. Live: outstanding until a version is recorded as submitted in the IRS
 * SGO portal. Test: test reports are never filed, so outstanding until one has been generated.
 */
async function reportStatus(db: DbOrTx, orgId: string, mode: Mode, taxYear: number): Promise<{ generated: boolean; submitted: boolean }> {
  const rows = await db
    .select({ submittedOn: irsReports.submittedOn })
    .from(irsReports)
    .where(and(eq(irsReports.orgId, orgId), eq(irsReports.mode, mode), eq(irsReports.taxYear, taxYear)));
  return { generated: rows.length > 0, submitted: rows.some((r) => r.submittedOn !== null) };
}

function acknowledgmentDetails(w: Worklist): Array<{ label: string; value: string }> {
  const c = NOTICE_COPY.counts;
  const y = { year: w.taxYear };
  const rows = [
    { label: fill(c.donors, y), value: String(w.counts.donors) },
    { label: c.issued, value: String(w.counts.upToDate) },
    { label: c.readyToIssue, value: String(w.counts.readyToIssue) },
    { label: c.missingDonorNumber, value: String(w.counts.missingDonorNumber) },
    { label: c.paperToMail, value: String(w.counts.paperToMail) },
    { label: c.needsReview, value: String(w.counts.needsReview) },
    { label: c.sgoEinMissing, value: yesNo(Boolean(w.sgo.ein)) },
  ];
  if (w.mode === "live") rows.push({ label: c.portalRegistration, value: yesNo(w.sgo.portalRegistered) });
  return rows;
}

async function sendNoticesForMode(mode: Mode, today: string, priorYear: number, summary: AnnualRunSummary): Promise<void> {
  const db = await getDb();
  const orgRows = await db
    .selectDistinct({ orgId: donations.orgId })
    .from(donations)
    .where(and(eq(donations.mode, mode), eq(donations.taxYear, priorYear), inArray(donations.status, ["succeeded", "refunded"])));
  const ackDue = acknowledgmentDueDate(priorYear);
  const reportDue = irsContributionReportDueDate(priorYear);
  const yearStart = `${priorYear + 1}-01-01`;
  const reportWindow = `${priorYear + 1}-02-01`;
  for (const { orgId } of orgRows.sort((a, b) => a.orgId.localeCompare(b.orgId))) {
    const worklist = await computeWorklist(db, orgId, mode, priorYear);
    if (worklist.counts.donors === 0) continue;

    const ackLevel = noticeLevelFor({ today, windowStart: yearStart, dueDate: ackDue, outstanding: worklist.counts.outstanding > 0, sent: await sentLevels(db, orgId, mode, priorYear, "acknowledgments"), levels: ACKNOWLEDGMENT_NOTICE_LEVELS });
    if (ackLevel) {
      const recipients = await sendNotice({ orgId, mode, taxYear: priorYear, kind: "acknowledgments", level: ackLevel, dueDate: ackDue, daysLeft: daysBetween(today, ackDue), details: acknowledgmentDetails(worklist), summary: { ...worklist.counts, byAction: worklist.byAction } });
      if (recipients !== null) summary.notices.push({ orgId, kind: "acknowledgments", level: ackLevel, recipients });
    }

    const report = await reportStatus(db, orgId, mode, priorYear);
    const outstanding = mode === "live" ? !report.submitted : !report.generated;
    const reportLevel = noticeLevelFor({ today, windowStart: reportWindow, dueDate: reportDue, outstanding, sent: await sentLevels(db, orgId, mode, priorYear, "irs_report"), levels: IRS_REPORT_NOTICE_LEVELS });
    if (reportLevel) {
      const c = NOTICE_COPY.counts;
      const details = [
        { label: fill(c.donors, { year: priorYear }), value: String(worklist.counts.donors) },
        { label: c.issued, value: String(worklist.counts.upToDate) },
        { label: c.reportGenerated, value: yesNo(report.generated) },
        ...(mode === "live" ? [{ label: c.reportSubmitted, value: yesNo(report.submitted) }] : []),
      ];
      const recipients = await sendNotice({ orgId, mode, taxYear: priorYear, kind: "irs_report", level: reportLevel, dueDate: reportDue, daysLeft: daysBetween(today, reportDue), details, summary: { ...report, donors: worklist.counts.donors, upToDate: worklist.counts.upToDate } });
      if (recipients !== null) summary.notices.push({ orgId, kind: "irs_report", level: reportLevel, recipients });
    }
  }
}

/** One run for one mode, from `after` (continuations). Exported for tests and operators. */
export async function runAcknowledgmentAnnual(mode: Mode, after: string | null = null): Promise<AnnualRunSummary> {
  const today = centralDateString(now());
  const currentYear = Number(today.slice(0, 4));
  const priorYear = currentYear - 1;
  const summary: AnnualRunSummary = { mode, today, priorYear, processed: 0, outcomes: { issued: 0, unchanged: 0, blocked: 0, not_required: 0 }, failed: 0, continued: false, notices: [] };
  const db = await getDb();
  const all = await listCandidates(db, mode, priorYear, currentYear);
  const remaining = after ? all.filter((c) => c.key > after) : all;
  const batch = remaining.slice(0, ANNUAL_JOB_BATCH);
  const failures: string[] = [];
  const actor = systemActor(ACKNOWLEDGMENT_ANNUAL_JOB);
  for (const c of batch) {
    try {
      const result = await db.transaction(async (tx) => issueInTx(tx, c.orgId, { donorId: c.donorId, taxYear: c.taxYear, mode }, await authorizeStaff(tx, actor, c.orgId)));
      summary.outcomes[result.outcome] += 1;
    } catch (e) {
      // One donor's failure must not hold up the others; the job fails at the end so the queue retries it.
      failures.push(`${c.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
    summary.processed += 1;
  }
  summary.failed = failures.length;
  if (remaining.length > batch.length) {
    const last = batch[batch.length - 1].key;
    await enqueue(ACKNOWLEDGMENT_ANNUAL_JOB, { mode, after: last }, { dedupeKey: `${ACKNOWLEDGMENT_ANNUAL_JOB}:continue:${mode}:${today}:${last}` });
    summary.continued = true;
  } else {
    await sendNoticesForMode(mode, today, priorYear, summary);
  }
  if (failures.length > 0) throw new Error(`acknowledgment.annual (${mode}): ${failures.length} donor(s) failed: ${failures.slice(0, 5).join("; ")}`);
  return summary;
}

/** Job handler. The recurring run (empty payload) covers every mode; a continuation names its mode and position. */
export async function handleAcknowledgmentAnnual(payload: Record<string, unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(payload ?? {});
  if (!parsed.success) throw invalid("Invalid acknowledgment.annual payload");
  const modes: readonly Mode[] = parsed.data.mode ? [parsed.data.mode] : ANNUAL_JOB_MODES;
  const errors: string[] = [];
  for (const mode of modes) {
    try {
      await runAcknowledgmentAnnual(mode, parsed.data.mode ? (parsed.data.after ?? null) : null);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length > 0) throw new Error(errors.join(" | "));
}
