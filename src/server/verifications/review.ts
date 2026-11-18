/**
 * Human review, read side: the SGO's review queue, the full detail of one verification for its dashboard page, the
 * raw upload for inline viewing, and assigning a task to a reviewer. Every function is scoped by organization AND
 * mode; sensitive reads are audited. Staff access is checked here (REVIEW_ACCESS), not only by the caller.
 */
import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { CustodyInfo, DocumentKind, DocumentStatus, IncomeSource, Mode, PathPreference, VerificationFlag, VerificationMethod, VerificationStage, VerificationStatus, FamilyRequest } from "@/db/schema";
import { explainDecision, type Decision, type DecisionExplanation } from "@/engine/decision";
import type { AwardLetterSummary, IncomeDocumentSummary, NotAcceptableReason } from "@/engine/documents";
import { incomeCategoryLabel } from "@/engine/income";
import { now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { assertOrgMember } from "@/server/auth";
import { getHouseholdSnapshot } from "@/server/households";
import { getObjectBytes } from "@/server/storage";
import { toCertificationView, type CertificationView } from "./certifications";
import { readStoredExtraction } from "./documents";
import { loadOrgVerification, orgAuditActor, recordVerificationEvent, requireOrgStaff, type DocumentRow, type OrgActor, type VerificationRow } from "./internal";
import { REVIEW_ACCESS, REVIEW_QUEUE_LIMIT_DEFAULT, REVIEW_QUEUE_LIMIT_MAX } from "./policy";
import { toApiVerification, type ApiVerification } from "./serialize";

/* ------------------------------------------------------------------------------------------ queue */

export interface ReviewQueueItem {
  taskId: string;
  verificationId: string;
  externalRef: string | null;
  status: VerificationStatus;
  stage: VerificationStage;
  /** What the reviewer has to settle (engine reason codes and messages; no names). */
  reasons: Array<{ code: string; message: string }>;
  assignedTo: string | null;
  assignedAt: Date | null;
  /** Set while the reviewer is waiting on the family's answer to a request for more information. */
  moreInfoRequestedAt: Date | null;
  waitingOnFamily: boolean;
  createdAt: Date;
  /** How long the task has been open, in milliseconds and whole days. */
  ageMs: number;
  ageDays: number;
}

export interface ReviewQueuePage {
  /** Oldest first. */
  items: ReviewQueueItem[];
  nextCursor: string | null;
}

export interface ListReviewQueueParams {
  mode: Mode;
  /** A user id: only that reviewer's tasks. Null: only unassigned tasks. Omitted: every open task. */
  assignedTo?: string | null;
  /** 1–100, default 25. */
  limit?: number | null;
  cursor?: string | null;
}

const queueSchema = z.strictObject({
  mode: z.enum(["test", "live"]),
  assignedTo: z.string().min(1).max(128).nullish(),
  limit: z.number().int().min(1).max(REVIEW_QUEUE_LIMIT_MAX).nullish(),
  cursor: z.string().max(300).nullish(),
});

function encodeCursor(t: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: t.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    const t = typeof parsed.t === "string" ? new Date(parsed.t) : null;
    if (!t || Number.isNaN(t.getTime()) || typeof parsed.id !== "string" || parsed.id.length === 0 || parsed.id.length > 128) throw new Error("bad cursor");
    return { t, id: parsed.id };
  } catch {
    throw invalid("The cursor is not valid.", { fields: { cursor: "Use nextCursor from the previous page." } });
  }
}

/**
 * Open review tasks of one organization in one mode, oldest first (keyset pagination), with their reasons and age.
 * Tasks waiting on the family's answer stay in the queue, marked `waitingOnFamily`.
 */
export async function listReviewQueue(orgId: string, params: ListReviewQueueParams, dbOrTx?: DbOrTx): Promise<ReviewQueuePage> {
  const parsed = queueSchema.safeParse(params);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "query")] ??= issue.message;
    throw invalid("The review queue request is not valid.", { fields });
  }
  const p = parsed.data;
  const limit = p.limit ?? REVIEW_QUEUE_LIMIT_DEFAULT;
  const rt = schema.reviewTasks;
  const v = schema.verifications;
  const where: SQL[] = [eq(rt.orgId, orgId), eq(rt.status, "open"), eq(v.orgId, orgId), eq(v.mode, p.mode)];
  if (p.assignedTo === null) where.push(isNull(rt.assignedTo));
  else if (p.assignedTo !== undefined) where.push(eq(rt.assignedTo, p.assignedTo));
  if (p.cursor) {
    const c = decodeCursor(p.cursor);
    where.push(or(gt(rt.createdAt, c.t), and(eq(rt.createdAt, c.t), gt(rt.id, c.id)))!);
  }
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select({ task: rt, verification: { id: v.id, externalRef: v.externalRef, status: v.status, stage: v.stage } })
    .from(rt)
    .innerJoin(v, eq(v.id, rt.verificationId))
    .where(and(...where))
    .orderBy(asc(rt.createdAt), asc(rt.id))
    .limit(limit + 1);
  const at = now().getTime();
  const items = rows.slice(0, limit).map(({ task, verification }) => {
    const ageMs = Math.max(0, at - task.createdAt.getTime());
    return {
      taskId: task.id,
      verificationId: verification.id,
      externalRef: verification.externalRef,
      status: verification.status,
      stage: verification.stage,
      reasons: task.reasons.map((r) => ({ code: r.code, message: r.message })),
      assignedTo: task.assignedTo,
      assignedAt: task.assignedAt,
      moreInfoRequestedAt: task.moreInfoRequestedAt,
      waitingOnFamily: task.moreInfoRequestedAt !== null || verification.stage === "awaiting_family",
      createdAt: task.createdAt,
      ageMs,
      ageDays: Math.floor(ageMs / 86_400_000),
    } satisfies ReviewQueueItem;
  });
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.taskId) : null };
}

/* ----------------------------------------------------------------------------------------- detail */

export interface DetailExtractedField {
  key: string;
  value: string | number | boolean | null;
  confidence: number;
  page: number | null;
  snippet: string | null;
}

export interface DetailExtraction {
  subtype: string;
  parserVersion: string;
  readerStatus: "extracted" | "needs_review" | "unreadable";
  readBy: "parser" | "model" | "reviewer" | null;
  keyedByReviewer: { reviewerId: string; keyedAt: string; notes: string | null } | null;
  fields: DetailExtractedField[];
  award: AwardLetterSummary | null;
  income: IncomeDocumentSummary | null;
  warnings: string[];
  notAcceptable: NotAcceptableReason[];
  synthetic: boolean;
}

export interface DetailDocument {
  id: string;
  declaredKind: DocumentKind;
  detectedKind: DocumentKind | null;
  memberId: string | null;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  status: DocumentStatus;
  extractedBy: "parser" | "model" | "reviewer" | null;
  extractedAt: Date | null;
  reviewReasons: Array<{ code: string; message: string }>;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  purgeAfter: Date | null;
  purgedAt: Date | null;
  removedAt: Date | null;
  /** Passport reuse: the earlier verification's document this one refers to (its file is not shown here). */
  sourceDocumentId: string | null;
  /** Whether a reviewer can open the raw file now (getDocumentForReview). */
  viewable: boolean;
  extraction: DetailExtraction | null;
  createdAt: Date;
}

export interface DetailIncomeItem {
  id: string;
  memberId: string | null;
  source: IncomeSource;
  category: string;
  categoryLabel: string;
  description: string | null;
  incomeYear: number;
  annualAmountCents: number;
  counted: boolean;
  basis: string | null;
  documentId: string | null;
  railConnectionId: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface DetailRailConnection {
  id: string;
  provider: string;
  kind: string;
  status: string;
  memberId: string | null;
  reportSha256: string | null;
  failureReason: string | null;
  consentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetailConsent {
  id: string;
  kind: string;
  copyVersion: string;
  copySha256: string;
  locale: string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  active: boolean;
}

export interface DetailReviewTask {
  id: string;
  status: "open" | "resolved";
  reasons: Array<{ code: string; message: string }>;
  assignedTo: string | null;
  assignedAt: Date | null;
  moreInfoRequestedAt: Date | null;
  resolution: string | null;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface DetailTimelineEntry {
  id: string;
  type: string;
  actorType: string;
  actorId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

/** Everything the SGO dashboard's detail page shows for one verification. For signed-in staff only. */
export interface VerificationDetail {
  verification: {
    id: string;
    orgId: string;
    mode: Mode;
    status: VerificationStatus;
    stage: VerificationStage;
    method: VerificationMethod | null;
    pathPreference: PathPreference | null;
    externalRef: string | null;
    applicantName: string | null;
    applicantEmail: string | null;
    studentFirstName: string | null;
    studentLastName: string | null;
    metadata: Record<string, string>;
    flags: VerificationFlag[];
    familyRequest: FamilyRequest | null;
    handoffId: string | null;
    applicationDate: string | null;
    incomeYear: number | null;
    provisional: boolean;
    createdAt: Date;
    startedAt: Date | null;
    submittedAt: Date | null;
    decidedAt: Date | null;
    decidedBy: string | null;
    expiresAt: Date | null;
    canceledAt: Date | null;
    hasEvidence: boolean;
    passport: { sourceVerificationId: string; sourceDecidedAt: Date | null; sourceRecordSha256: string | null } | null;
    evidenceCopiedFromId: string | null;
  };
  /** The same object the API returns. */
  api: ApiVerification;
  /** Names and roles; never dates of birth. Null until the family has opened the link. */
  household: {
    id: string;
    size: number | null;
    countyFips: string | null;
    countyName: string | null;
    hudAreaCode: string | null;
    hudAreaName: string | null;
    completedAt: Date | null;
    studentMemberIds: string[];
    members: Array<{ id: string; kind: string; firstName: string; lastName: string; relationship: string | null; isOwner: boolean }>;
    /** The live roster or county no longer matches what was snapshotted for this verification. */
    changedSinceCompleted: boolean;
  } | null;
  custody: { answers: CustodyInfo | null; outcome: string | null };
  consents: DetailConsent[];
  documents: DetailDocument[];
  certifications: CertificationView[];
  incomeItems: DetailIncomeItem[];
  railConnections: DetailRailConnection[];
  /** The engine's (or the reviewer's) full decision, with both threshold readings, and its SGO-facing explanation. */
  decision: Decision | null;
  explanation: DecisionExplanation["sgo"] | null;
  reviewTasks: DetailReviewTask[];
  timeline: DetailTimelineEntry[];
}

function toDetailExtraction(doc: DocumentRow): DetailExtraction | null {
  const stored = readStoredExtraction(doc);
  if (!stored?.extraction) return null;
  const e = stored.extraction;
  return {
    subtype: e.subtype,
    parserVersion: e.parserVersion,
    readerStatus: stored.readerStatus,
    readBy: stored.reviewerKeyed ? "reviewer" : stored.extractedBy,
    keyedByReviewer: stored.reviewerKeyed ? { reviewerId: stored.reviewerKeyed.reviewerId, keyedAt: stored.reviewerKeyed.keyedAt, notes: stored.reviewerKeyed.notes } : null,
    fields: Object.entries(e.fields).map(([key, f]) => ({ key, value: f.value, confidence: f.confidence, page: f.page, snippet: f.snippet })),
    award: e.award,
    income: e.income,
    warnings: e.warnings,
    notAcceptable: e.notAcceptable,
    synthetic: stored.synthetic,
  };
}

async function loadDocuments(db: DbOrTx, verificationId: string): Promise<DocumentRow[]> {
  return db.select().from(schema.documents).where(eq(schema.documents.verificationId, verificationId)).orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
}

/**
 * The detail page of one verification: SGO-provided facts, the household (names and roles only), consents,
 * documents with their decrypted extracted fields, confidences and review reasons, income lines, data
 * connections (summary only), custody answers, the decision with both threshold readings, review tasks and the
 * timeline. Any staff member (REVIEW_ACCESS.detail); audited as `verification.detail_read`.
 */
export async function getVerificationDetail(orgId: string, id: string, actor: OrgActor, dbOrTx?: DbOrTx): Promise<VerificationDetail> {
  const db = dbOrTx ?? (await getDb());
  await requireOrgStaff(db, orgId, actor, REVIEW_ACCESS.detail);
  const v = await loadOrgVerification(db, orgId, actor.mode, id);

  const [docs, certRows, itemRows, railRows, consentRows, taskRows, eventRows] = await Promise.all([
    loadDocuments(db, v.id),
    db.select().from(schema.verificationCertifications).where(eq(schema.verificationCertifications.verificationId, v.id)).orderBy(asc(schema.verificationCertifications.signedAt)),
    db.select().from(schema.incomeItems).where(eq(schema.incomeItems.verificationId, v.id)).orderBy(asc(schema.incomeItems.createdAt), asc(schema.incomeItems.id)),
    db.select().from(schema.railConnections).where(eq(schema.railConnections.verificationId, v.id)).orderBy(asc(schema.railConnections.createdAt), asc(schema.railConnections.id)),
    db.select().from(schema.consents).where(eq(schema.consents.verificationId, v.id)).orderBy(asc(schema.consents.grantedAt), asc(schema.consents.id)),
    db.select().from(schema.reviewTasks).where(and(eq(schema.reviewTasks.verificationId, v.id), eq(schema.reviewTasks.orgId, orgId))).orderBy(asc(schema.reviewTasks.createdAt)),
    db.select().from(schema.verificationEvents).where(eq(schema.verificationEvents.verificationId, v.id)).orderBy(asc(schema.verificationEvents.createdAt), asc(schema.verificationEvents.id)),
  ]);
  const objectIds = [...new Set(docs.map((d) => d.objectId))];
  const objects = objectIds.length > 0 ? await db.select({ id: schema.objects.id, deletedAt: schema.objects.deletedAt }).from(schema.objects).where(inArray(schema.objects.id, objectIds)) : [];
  const deleted = new Set(objects.filter((o) => o.deletedAt).map((o) => o.id));

  let household: VerificationDetail["household"] = null;
  if (v.householdId) {
    const snapshot = await getHouseholdSnapshot(v.householdId, {}, db);
    household = {
      id: v.householdId,
      size: v.householdSize,
      countyFips: v.countyFips,
      countyName: v.countyName,
      hudAreaCode: v.hudAreaCode,
      hudAreaName: v.areaName,
      completedAt: v.householdCompletedAt,
      studentMemberIds: [...v.studentMemberIds],
      members: snapshot.members.map((m) => ({ id: m.id, kind: m.kind, firstName: m.firstName, lastName: m.lastName, relationship: m.relationship, isOwner: m.isOwner })),
      changedSinceCompleted: v.householdCompletedAt !== null && (snapshot.size !== v.householdSize || (snapshot.county?.fips ?? null) !== v.countyFips),
    };
  }

  const decision = (v.decision as unknown as Decision | null) ?? null;
  const at = now().getTime();
  const detail: VerificationDetail = {
    verification: {
      id: v.id,
      orgId: v.orgId,
      mode: v.mode,
      status: v.status,
      stage: v.stage,
      method: v.method,
      pathPreference: v.pathPreference,
      externalRef: v.externalRef,
      applicantName: v.applicantName,
      applicantEmail: v.applicantEmail,
      studentFirstName: v.studentFirstName,
      studentLastName: v.studentLastName,
      metadata: { ...v.metadata },
      flags: [...v.flags],
      familyRequest: v.familyRequest,
      handoffId: v.handoffId,
      applicationDate: v.applicationDate,
      incomeYear: v.incomeYear,
      provisional: v.provisional,
      createdAt: v.createdAt,
      startedAt: v.startedAt,
      submittedAt: v.submittedAt,
      decidedAt: v.decidedAt,
      decidedBy: v.decidedBy,
      expiresAt: v.expiresAt,
      canceledAt: v.canceledAt,
      hasEvidence: v.evidencePdfObjectId !== null && v.evidenceJsonObjectId !== null,
      passport: v.passportSourceId ? { sourceVerificationId: v.passportSourceId, sourceDecidedAt: v.passportSourceDecidedAt, sourceRecordSha256: v.passportSourceRecordSha256 } : null,
      evidenceCopiedFromId: v.evidenceCopiedFromId,
    },
    api: toApiVerification(v, { baseUrl: appUrl() }),
    household,
    custody: { answers: v.custody, outcome: decision?.custody.outcome ?? null },
    consents: consentRows.map((c) => ({
      id: c.id,
      kind: c.kind,
      copyVersion: c.copyVersion,
      copySha256: c.copySha256,
      locale: c.locale,
      grantedAt: c.grantedAt,
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt,
      active: c.revokedAt === null && (c.expiresAt === null || c.expiresAt.getTime() > at),
    })),
    documents: docs.map((d) => ({
      id: d.id,
      declaredKind: d.declaredKind,
      detectedKind: d.detectedKind,
      memberId: d.memberId,
      filename: d.filename,
      contentType: d.contentType,
      size: d.size,
      sha256: d.sha256,
      status: d.status,
      extractedBy: d.extractedBy,
      extractedAt: d.extractedAt,
      reviewReasons: d.reviewReasons.map((r) => ({ code: r.code, message: r.message })),
      reviewedBy: d.reviewedBy,
      reviewedAt: d.reviewedAt,
      purgeAfter: d.purgeAfter,
      purgedAt: d.purgedAt,
      removedAt: d.removedAt,
      sourceDocumentId: d.sourceDocumentId,
      viewable: d.sourceDocumentId === null && d.removedAt === null && d.purgedAt === null && !deleted.has(d.objectId),
      extraction: toDetailExtraction(d),
      createdAt: d.createdAt,
    })),
    certifications: certRows.map(toCertificationView),
    incomeItems: itemRows.map((r) => ({
      id: r.id,
      memberId: r.memberId,
      source: r.source,
      category: r.category,
      categoryLabel: incomeCategoryLabel(r.category),
      description: r.description,
      incomeYear: r.incomeYear,
      annualAmountCents: r.annualAmountCents,
      counted: r.counted,
      basis: r.basis,
      documentId: r.documentId,
      railConnectionId: r.railConnectionId,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    })),
    railConnections: railRows.map((r) => ({
      id: r.id,
      provider: r.provider,
      kind: r.kind,
      status: r.status,
      memberId: r.memberId,
      reportSha256: r.reportSha256,
      failureReason: r.failureReason,
      consentId: r.consentId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    decision,
    explanation: decision ? explainDecision(decision, "en").sgo : null,
    reviewTasks: taskRows.map((t) => ({
      id: t.id,
      status: t.status,
      reasons: t.reasons.map((r) => ({ code: r.code, message: r.message })),
      assignedTo: t.assignedTo,
      assignedAt: t.assignedAt,
      moreInfoRequestedAt: t.moreInfoRequestedAt,
      resolution: t.resolution,
      resolutionNotes: t.resolutionNotes,
      resolvedBy: t.resolvedBy,
      resolvedAt: t.resolvedAt,
      createdAt: t.createdAt,
    })),
    timeline: eventRows.map((e) => ({ id: e.id, type: e.type, actorType: e.actorType, actorId: e.actorId, data: e.data, createdAt: e.createdAt })),
  };
  await audit(
    { actor: orgAuditActor(actor), orgId, action: "verification.detail_read", target: { type: "verification", id: v.id }, metadata: { mode: v.mode, documents: docs.length, incomeItems: itemRows.length }, request: actor.request },
    db,
  );
  return detail;
}

/* ------------------------------------------------------------------------------------ raw document */

export interface DocumentForReview {
  documentId: string;
  verificationId: string;
  bytes: Buffer;
  contentType: string;
  filename: string;
  sha256: string;
}

/** A document of the organization's verification in the actor's mode; not_found otherwise. */
export async function loadOrgDocument(db: DbOrTx, orgId: string, mode: Mode, documentId: string, opts: { forUpdate?: boolean } = {}): Promise<{ document: DocumentRow; verification: VerificationRow }> {
  if (typeof documentId !== "string" || documentId.length === 0 || documentId.length > 128) throw notFound("Document");
  const q = db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1);
  const [document] = opts.forUpdate ? await q.for("update") : await q;
  if (!document) throw notFound("Document");
  try {
    const verification = await loadOrgVerification(db, orgId, mode, document.verificationId, opts);
    return { document, verification };
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") throw notFound("Document");
    throw e;
  }
}

/**
 * The raw upload, for inline viewing by a reviewer (REVIEW_ACCESS.viewDocument). Audited as `document.view`
 * before the bytes are returned. Gone once taken back or purged. A document carried over by a passport reuse is
 * refused: its file was shared with the earlier organization, never re-shared.
 */
export async function getDocumentForReview(orgId: string, documentId: string, actor: OrgActor, dbOrTx?: DbOrTx): Promise<DocumentForReview> {
  const db = dbOrTx ?? (await getDb());
  await requireOrgStaff(db, orgId, actor, REVIEW_ACCESS.viewDocument);
  const { document, verification } = await loadOrgDocument(db, orgId, actor.mode, documentId);
  if (document.sourceDocumentId) {
    throw new AppError("forbidden", "This document was carried over from an earlier verification; its file is not shared again.", { reason: "carried_over_document" });
  }
  if (document.removedAt || document.purgedAt) throw new AppError("gone", "This file has been deleted. Its fingerprint and the fields read from it are kept.");
  const bytes = await getObjectBytes(document.objectId, { orgId });
  await audit(
    {
      actor: orgAuditActor(actor),
      orgId,
      action: "document.view",
      target: { type: "document", id: document.id },
      metadata: { verificationId: verification.id, sha256: document.sha256, contentType: document.contentType },
      request: actor.request,
    },
    db,
  );
  return { documentId: document.id, verificationId: verification.id, bytes, contentType: document.contentType, filename: document.filename, sha256: document.sha256 };
}

/* ---------------------------------------------------------------------------------------- assign */

/**
 * Assigns the open review task to a reviewer of the organization, or unassigns it (`assigneeUserId` null).
 * Reviewers and above (REVIEW_ACCESS.act); the assignee must also be a reviewer or above.
 */
export async function assignReview(orgId: string, verificationId: string, assigneeUserId: string | null, actor: OrgActor, dbOrTx?: DbOrTx): Promise<DetailReviewTask> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const v = await loadOrgVerification(tx, orgId, actor.mode, verificationId, { forUpdate: true });
    if (assigneeUserId !== null) {
      const [assignee] = typeof assigneeUserId === "string" && assigneeUserId.length > 0 && assigneeUserId.length <= 128 ? await tx.select().from(schema.users).where(eq(schema.users.id, assigneeUserId)).limit(1) : [];
      const ok = assignee ? await assertOrgMember(assignee, orgId, REVIEW_ACCESS.act, tx).then(() => true, () => false) : false;
      if (!ok) throw invalid("Choose a reviewer of this organization.", { fields: { assignee: "Not a reviewer of this organization." } });
    }
    const rt = schema.reviewTasks;
    const [task] = await tx
      .update(rt)
      .set({ assignedTo: assigneeUserId, assignedAt: assigneeUserId ? now() : null })
      .where(and(eq(rt.verificationId, v.id), eq(rt.orgId, orgId), eq(rt.status, "open")))
      .returning();
    if (!task) throw conflict("This verification has no open review task.", { reason: "no_open_review_task" });
    await recordVerificationEvent(tx, v.id, assigneeUserId ? "review.assigned" : "review.unassigned", { type: "user", id: actor.id }, { reviewTaskId: task.id, assignedTo: assigneeUserId });
    await audit({ actor: orgAuditActor(actor), orgId, action: "review.assign", target: { type: "review_task", id: task.id }, metadata: { verificationId: v.id, assignedTo: assigneeUserId }, request: actor.request }, tx);
    return {
      id: task.id,
      status: task.status,
      reasons: task.reasons,
      assignedTo: task.assignedTo,
      assignedAt: task.assignedAt,
      moreInfoRequestedAt: task.moreInfoRequestedAt,
      resolution: task.resolution,
      resolutionNotes: task.resolutionNotes,
      resolvedBy: task.resolvedBy,
      resolvedAt: task.resolvedAt,
      createdAt: task.createdAt,
    };
  });
}
