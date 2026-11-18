/**
 * The "verification.decide" job: assembles the decision input from everything on file, calls the pure decision
 * engine and persists the outcome with its follow-up work in one transaction.
 *
 *   eligible / ineligible → decided, result expiry, raw-upload purge date, "evidence.generate" queued
 *   needs_review          → review task, stage in_review, verification.needs_review, reviewers emailed
 *   pending               → stage awaiting_family, the family emailed exactly what is missing, in its language
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, getDb, type DbOrTx } from "@/db/client";
import type { VerificationStage, VerificationStatus } from "@/db/schema";
import { decide, explainDecision, type AwardLetterInput, type Decision, type DecisionInput, type UnreadDocument } from "@/engine/decision";
import {
  getIncomeCategory,
  reconcileIncomeEvidence,
  yearOf,
  type IncomeCertification,
  type IncomeDocumentSource,
  type IncomeEvidence,
  type IncomeItemInput,
} from "@/engine/income";
import { addMs, centralDateString, MS, now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { SYSTEM_ACTOR, audit } from "@/server/audit";
import { endOfCentralDay } from "@/server/consents";
import { renderEmail } from "@/server/email";
import { emitEvent } from "@/server/events";
import { getHouseholdSnapshot, type HouseholdSnapshot } from "@/server/households";
import { enqueue } from "@/server/jobs";
import { getRailSummaryForDecision, type RailDecisionSummary } from "@/server/rails";
import { getSgoPolicy } from "@/server/sgos";
import { activeCertificationRows } from "./certifications";
import { familyDecisionEmailFrame } from "./copy";
import { readStoredExtraction } from "./documents";
import { mapDocument, toHouseholdMembers, type MappedDocument, type RosterMember } from "./evidence-mapping";
import { loadVerificationRow, recordVerificationEvent, type DocumentRow, type VerificationRow } from "./internal";
import { queueAndSend } from "./mail";
import { notifySgo } from "./notifications";
import { DECIDE_WAIT, FAMILY_VERIFICATION_PATH } from "./policy";
import { toApiVerification } from "./serialize";
import { decideDedupeKey, VERIFICATION_DECIDE_JOB } from "./submit";

export const EVIDENCE_GENERATE_JOB = "evidence.generate";

/** Purpose under which dates of birth are read to tell adults from minors for the income rules (audited). */
export const AGE_BAND_DOB_PURPOSE = "income_rules_age_band";

const DECIDABLE_STAGES: ReadonlySet<VerificationStage> = new Set(["submitted", "processing"]);

/* -------------------------------------------------------------------------------------------- input */

export interface AssembledDecision {
  input: DecisionInput;
  mapped: MappedDocument[];
  /** Reconciled document-sourced income items, for `income_items`. */
  documentItems: IncomeItemInput[];
}

function certificationsOf(rows: Awaited<ReturnType<typeof activeCertificationRows>>): IncomeCertification[] {
  return rows.map((r) => ({ kind: r.kind, memberId: r.memberId, incomeYear: r.incomeYear, signedBy: r.signedByUserId, signedOn: centralDateString(r.signedAt), copyVersion: r.copyVersion }));
}

/**
 * Everything the engine needs, from the database. Pure assembly apart from the reads; nothing is written.
 * Income from documents and from data connections is reconciled together so a W-2 that arrived both ways is
 * counted once; reviewer-keyed and self-reported lines already in `income_items` are added as they are.
 */
export async function assembleDecisionInput(
  db: DbOrTx,
  v: VerificationRow,
  ctx: { docs: DocumentRow[]; rails: RailDecisionSummary; snapshot: HouseholdSnapshot; today: string },
): Promise<AssembledDecision> {
  const applicationDate = v.applicationDate ?? ctx.today;
  const incomeYear = yearOf(applicationDate) - 1;
  const roster: RosterMember[] = ctx.snapshot.members.map((m) => ({ id: m.id, kind: m.kind, firstName: m.firstName, lastName: m.lastName, relationship: m.relationship, isOwner: m.isOwner, dob: m.dob ?? null }));
  const mapped = ctx.docs.map((d) =>
    mapDocument({ id: d.id, memberId: d.memberId, status: d.status, declaredKind: d.declaredKind, detectedKind: d.detectedKind, extractedBy: d.extractedBy, stored: readStoredExtraction(d) }, roster),
  );

  const letters: AwardLetterInput[] = mapped.flatMap((m) => (m.letter ? [m.letter] : []));
  const sources: IncomeDocumentSource[] = mapped.flatMap((m) => (m.source ? [m.source] : []));
  const unreadDocuments: UnreadDocument[] = mapped.filter((m) => m.unread).map((m) => ({ documentId: m.documentId, memberId: ctx.docs.find((d) => d.id === m.documentId)?.memberId ?? null }));
  // Evidence for another year is still passed: the reconciler reports it as ignored rather than counting it.
  const evidence: IncomeEvidence[] = [...mapped.flatMap((m) => m.evidence), ...ctx.rails.evidence].filter((e) => (e.kind === "pay_stub" ? true : e.taxYear >= 2000 && e.taxYear <= 2999));
  const reconciled = reconcileIncomeEvidence({ incomeYear, evidence });

  const tableItems = await db
    .select()
    .from(schema.incomeItems)
    .where(and(eq(schema.incomeItems.verificationId, v.id), inArray(schema.incomeItems.source, ["reviewer", "self_reported"])))
    .orderBy(asc(schema.incomeItems.createdAt), asc(schema.incomeItems.id));
  const keyed: IncomeItemInput[] = tableItems.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    category: r.category,
    incomeYear: r.incomeYear,
    annualAmountCents: r.annualAmountCents,
    source: r.source,
    documentId: r.documentId,
    railConnectionId: r.railConnectionId,
    description: r.description,
  }));
  const certifications = certificationsOf(await activeCertificationRows(db, v.id));
  const items = [...reconciled.items, ...keyed];
  const evidenceFlags = [...reconciled.flags, ...ctx.rails.flags];
  const hasDirect = items.length > 0 || certifications.length > 0 || unreadDocuments.length > 0 || evidenceFlags.length > 0 || sources.length > 0;

  const policy = await getSgoPolicy(v.orgId, db);
  const input: DecisionInput = {
    today: ctx.today,
    applicationDate,
    sgoPolicy: { capPct: policy.incomeCapPct, reviewBandBps: policy.reviewBandBps },
    household: {
      size: ctx.snapshot.size,
      countyFips: ctx.snapshot.county?.fips ?? null,
      members: toHouseholdMembers(roster, applicationDate),
      custody: v.custody,
    },
    categorical: letters.length > 0 ? { letters } : null,
    direct: hasDirect ? { incomeYear, items, certifications, sources, evidenceFlags, unreadDocuments } : null,
    railReports: ctx.rails.railReports,
  };
  return { input, mapped, documentItems: reconciled.items.filter((i) => i.source === "document" && i.documentId) };
}

/* ------------------------------------------------------------------------------------------ outcome */

function uniqueReasons(decision: Decision): Array<{ code: string; message: string }> {
  const seen = new Set<string>();
  const out: Array<{ code: string; message: string }> = [];
  for (const r of [...decision.reviewReasons, ...decision.reasons]) {
    const key = `${r.code}\u0000${r.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: r.code, message: r.message });
  }
  return out;
}

function outcomeOf(decision: Decision): { status: VerificationStatus; stage: VerificationStage } {
  switch (decision.status) {
    case "eligible":
    case "ineligible":
      return { status: decision.status, stage: "decided" };
    case "needs_review":
      return { status: "needs_review", stage: "in_review" };
    case "pending":
      return { status: "pending", stage: "awaiting_family" };
  }
}

export async function householdOwnerContact(db: DbOrTx, householdId: string): Promise<{ email: string; locale: "en" | "es" } | null> {
  const [row] = await db
    .select({ email: schema.users.email, locale: schema.households.locale })
    .from(schema.households)
    .innerJoin(schema.users, eq(schema.users.id, schema.households.ownerUserId))
    .where(eq(schema.households.id, householdId))
    .limit(1);
  return row ?? null;
}

/** Emails the family the plain-language explanation of a decision step (never an income figure, never an award promise). */
export async function emailFamily(db: DbOrTx, v: VerificationRow, decision: Decision, kind: "outcome" | "more_information"): Promise<void> {
  if (!v.householdId) return;
  const contact = await householdOwnerContact(db, v.householdId);
  if (!contact) return;
  const explanation = explainDecision(decision, contact.locale).family;
  const frame = familyDecisionEmailFrame(contact.locale, kind);
  const paragraphs = [...explanation.paragraphs];
  if (explanation.missing.length > 0) paragraphs.push(`${frame.missingHeading}:`, ...explanation.missing.map((m) => `• ${m}`));
  const rendered = renderEmail({ locale: contact.locale, heading: explanation.headline, paragraphs, cta: { label: frame.cta, url: appUrl(FAMILY_VERIFICATION_PATH(v.id)) } });
  await queueAndSend({ to: contact.email, subject: frame.subject, template: kind === "outcome" ? "verification_outcome" : "verification_more_information", html: rendered.html, text: rendered.text, related: { type: "verification", id: v.id } }, db);
}

/** Timeline event of a re-evaluation asked for by a reviewer (rerunDecision). */
export const RERUN_REQUESTED_EVENT = "review.rerun_requested";

/** Who caused this decision run: the family (a submission or a finished extraction) or a reviewer's re-run. */
export type DecideTrigger = "family" | "reviewer";

/**
 * Opens the review task, or updates the open one (a verification never has two). Returns whether the SGO should
 * be told again: always for a new task, and for an existing one unless a reviewer's own re-evaluation sent it
 * back to review (that reviewer is already on it). A family resubmission is announced again.
 */
async function openOrUpdateReviewTask(db: DbOrTx, v: VerificationRow, reasons: Array<{ code: string; message: string }>, trigger: DecideTrigger): Promise<{ taskId: string; created: boolean; announce: boolean }> {
  const rt = schema.reviewTasks;
  const [open] = await db.select().from(rt).where(and(eq(rt.verificationId, v.id), eq(rt.status, "open"))).limit(1);
  if (open) {
    await db.update(rt).set({ reasons, moreInfoRequestedAt: null }).where(eq(rt.id, open.id));
    return { taskId: open.id, created: false, announce: trigger !== "reviewer" };
  }
  const id = newId("reviewTask");
  await db.insert(rt).values({ id, verificationId: v.id, orgId: v.orgId, status: "open", reasons, createdAt: now() });
  return { taskId: id, created: true, announce: true };
}

/** Closes the open review task once the verification is decided (by the engine after a re-evaluation, or canceled). */
export async function closeOpenReviewTask(
  db: DbOrTx,
  verificationId: string,
  close: { resolution: "eligible" | "ineligible" | "canceled"; notes: string | null; resolvedBy: string | null },
): Promise<string | null> {
  const rt = schema.reviewTasks;
  const [task] = await db
    .update(rt)
    .set({ status: "resolved", resolution: close.resolution, resolutionNotes: close.notes, resolvedBy: close.resolvedBy, resolvedAt: now(), moreInfoRequestedAt: null })
    .where(and(eq(rt.verificationId, verificationId), eq(rt.status, "open")))
    .returning({ id: rt.id });
  return task?.id ?? null;
}

/** The columns of `verifications` that mirror a decision (status and stage are the caller's). */
export function decisionColumns(v: VerificationRow, decision: Decision, county: { fips: string | null; name: string | null; hudAreaCode: string | null; hudAreaName: string | null } | null) {
  const threshold = decision.threshold;
  return {
    method: decision.method,
    incomeYear: decision.incomeYear,
    householdSize: decision.householdSize,
    countyFips: county?.fips ?? v.countyFips,
    countyName: threshold?.county.name ?? county?.name ?? v.countyName,
    hudAreaCode: threshold?.area.code ?? county?.hudAreaCode ?? v.hudAreaCode,
    areaName: threshold?.area.name ?? county?.hudAreaName ?? v.areaName,
    medianIncomeCents: threshold?.medianIncomeCents ?? null,
    thresholdCents: threshold ? (threshold.reliedOnLimitCents ?? threshold.thresholdCents) : null,
    thresholdSource: decision.thresholdTable.source,
    thresholdTableVersion: decision.thresholdTable.tableVersion,
    thresholdEffectiveDate: decision.thresholdTable.effectiveDate,
    incomeCapPct: decision.sgoPolicy.capPct,
    householdIncomeCents: decision.householdIncomeCents,
    awardProgram: decision.awardProgram,
    awardLetterDate: decision.awardLetterDate,
    provisional: decision.provisional,
    decision: decision as unknown as Record<string, unknown>,
    decisionReasons: uniqueReasons(decision),
  };
}

/**
 * Follow-up work of a final decision, in the decision's transaction: the raw-upload purge date from the SGO's
 * retention window (only for files this verification owns: a document carried over by a passport reuse shares
 * the earlier verification's file, whose own retention governs it) and the evidence job.
 */
export async function scheduleDecidedFollowUps(db: DbOrTx, v: VerificationRow, decidedAt: Date): Promise<void> {
  const policy = await getSgoPolicy(v.orgId, db);
  await db
    .update(schema.documents)
    .set({ purgeAfter: addMs(decidedAt, policy.rawRetentionDays * MS.day) })
    .where(and(eq(schema.documents.verificationId, v.id), isNull(schema.documents.removedAt), isNull(schema.documents.sourceDocumentId), isNull(schema.documents.purgedAt)));
  await enqueue(EVIDENCE_GENERATE_JOB, { verificationId: v.id }, { dedupeKey: `${EVIDENCE_GENERATE_JOB}:${v.id}` }, db);
}

/* ---------------------------------------------------------------------------------------------- job */

/**
 * Decides a submitted verification. Idempotent and safe to retry: it acts only while the verification is
 * pending in stage "submitted" or "processing", under a row lock. While a document is still being read or a data
 * connection is still syncing it waits (DECIDE_WAIT) and re-queues itself; after the last wait it decides with
 * what is on file (anything unread goes to a person).
 */
export async function decideVerificationJob(verificationId: string, opts: { wait?: number; trigger?: DecideTrigger } = {}): Promise<void> {
  const db = await getDb();
  const wait = opts.wait ?? 0;
  const trigger = opts.trigger ?? "family";
  await db.transaction(async (tx) => {
    const v = await loadVerificationRow(tx, verificationId, { forUpdate: true });
    if (!v || v.status !== "pending" || !DECIDABLE_STAGES.has(v.stage) || !v.householdId) return;

    const docs = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.verificationId, v.id), isNull(schema.documents.removedAt)))
      .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
    const rails = await getRailSummaryForDecision(v.id, tx);
    const reading = docs.filter((d) => d.status === "uploaded" || d.status === "extracting");
    if ((reading.length > 0 || rails.pending) && wait < DECIDE_WAIT.maxWaits) {
      if (v.stage !== "processing") await tx.update(schema.verifications).set({ stage: "processing", updatedAt: now() }).where(eq(schema.verifications.id, v.id));
      if (wait === 0) await recordVerificationEvent(tx, v.id, "decision.waiting", { type: "system", id: null }, { documentsBeingRead: reading.length, railsSyncing: rails.pending });
      await enqueue(VERIFICATION_DECIDE_JOB, { verificationId: v.id, wait: wait + 1, ...(trigger === "reviewer" ? { trigger } : {}) }, { dedupeKey: `${decideDedupeKey(v.id)}:wait:${wait + 1}`, runAt: addMs(now(), DECIDE_WAIT.delayMs) }, tx);
      return;
    }

    const today = centralDateString(now());
    const snapshot = await getHouseholdSnapshot(v.householdId, { includeDob: { purpose: AGE_BAND_DOB_PURPOSE, actor: SYSTEM_ACTOR } }, tx);
    const { input, mapped, documentItems } = await assembleDecisionInput(tx, v, { docs, rails, snapshot, today });
    const decision = decide(input);
    const { status, stage } = outcomeOf(decision);
    const reasons = uniqueReasons(decision);
    const at = now();
    const decided = status === "eligible" || status === "ineligible";

    if (snapshot.size !== v.householdSize || (snapshot.county?.fips ?? null) !== v.countyFips) {
      await recordVerificationEvent(tx, v.id, "household.changed_since_completed", { type: "system", id: null }, { householdSize: snapshot.size, countyFips: snapshot.county?.fips ?? null });
    }

    const county = snapshot.county ? { fips: snapshot.county.fips, name: snapshot.county.name, hudAreaCode: snapshot.county.hudArea?.code ?? null, hudAreaName: snapshot.county.hudArea?.name ?? null } : null;
    const [updated] = await tx
      .update(schema.verifications)
      .set({
        status,
        stage,
        ...decisionColumns(v, decision, county),
        decidedAt: decided ? at : null,
        decidedBy: decided ? "engine" : null,
        expiresAt: decided && decision.validUntil ? endOfCentralDay(decision.validUntil) : null,
        updatedAt: at,
      })
      .where(eq(schema.verifications.id, v.id))
      .returning();

    await replaceDocumentIncomeItems(tx, v.id, documentItems, at);

    await recordVerificationEvent(tx, v.id, "decision.made", { type: "system", id: null }, {
      status,
      method: decision.method,
      reasonCodes: reasons.map((r) => r.code),
      missingCodes: decision.missing.map((m) => m.code),
      engineVersion: decision.engineVersion,
      unreadDocuments: mapped.filter((m) => m.unread).map((m) => m.documentId),
    });
    await audit(
      {
        actor: SYSTEM_ACTOR,
        orgId: v.orgId,
        action: "verification.decide",
        target: { type: "verification", id: v.id },
        metadata: { status, method: decision.method, provisional: decision.provisional, reasonCodes: reasons.map((r) => r.code), engineVersion: decision.engineVersion },
      },
      tx,
    );

    if (decided) {
      const closed = await closeOpenReviewTask(tx, v.id, { resolution: status, notes: "Decided by the engine after re-evaluation with the information on file.", resolvedBy: null });
      if (closed) await recordVerificationEvent(tx, v.id, "review.closed", { type: "system", id: null }, { reviewTaskId: closed, resolution: status });
      await scheduleDecidedFollowUps(tx, updated, at);
    } else if (status === "needs_review") {
      const task = await openOrUpdateReviewTask(tx, updated, reasons, trigger);
      let notified = 0;
      if (task.announce) {
        await emitEvent({ orgId: v.orgId, type: "verification.needs_review", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: v.mode }, tx);
        notified = await notifySgo(tx, updated, "needs_review", { reasonCount: decision.reviewReasons.length });
      }
      await recordVerificationEvent(tx, v.id, task.created ? "review.requested" : "review.updated", { type: "system", id: null }, { reviewTaskId: task.taskId, reviewersNotified: notified });
    } else {
      await emailFamily(tx, updated, decision, "more_information");
    }
  });
}

/**
 * Document-sourced income lines are derived: each decision replaces them with the reconciled lines it used.
 * Lines from data connections belong to the rails service; reviewer and self-reported lines are never touched.
 */
export async function replaceDocumentIncomeItems(db: DbOrTx, verificationId: string, documentItems: IncomeItemInput[], at: Date): Promise<void> {
  await db.delete(schema.incomeItems).where(and(eq(schema.incomeItems.verificationId, verificationId), eq(schema.incomeItems.source, "document")));
  if (documentItems.length === 0) return;
  await db.insert(schema.incomeItems).values(
    documentItems.map((item) => ({
      id: newId("incomeItem"),
      verificationId,
      memberId: item.memberId,
      source: "document" as const,
      category: item.category,
      description: item.description ?? null,
      incomeYear: item.incomeYear,
      annualAmountCents: item.annualAmountCents,
      counted: getIncomeCategory(item.category)?.treatment !== "excluded",
      basis: (item.description ?? "Read from an uploaded document").slice(0, 500),
      documentId: item.documentId ?? null,
      railConnectionId: null,
      createdBy: "engine",
      createdAt: at,
    })),
  );
}

/** Thrown when a stored decision is needed and missing; a programming error, never a family-facing state. */
export function requireDecision(v: VerificationRow): Decision {
  if (!v.decision) throw new AppError("internal", `Verification ${v.id} has no stored decision`);
  return v.decision as unknown as Decision;
}
