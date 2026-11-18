/**
 * Human review, write side: a reviewer keys or corrects a document's fields, adds or removes an income line,
 * re-runs the engine, resolves the verification, or asks the family for more. Every function needs a signed-in
 * staff member with the reviewer role or above (REVIEW_ACCESS.act), is scoped by organization AND mode, and records
 * a timeline event and an audit entry (codes and ids only: never an extracted value, an amount or a name).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { FamilyRequest } from "@/db/schema";
import { applyReviewerResolution, type Decision, type ReviewerBasis } from "@/engine/decision";
import { getIncomeCategory } from "@/engine/income";
import { centralDateString, now } from "@/lib/clock";
import { encryptJson } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { endOfCentralDay } from "@/server/consents";
import { renderEmail } from "@/server/email";
import { enqueue } from "@/server/jobs";
import { getSgoProfile } from "@/server/sgos";
import { familyRequestEmailCopy } from "./copy";
import { closeOpenReviewTask, decideVerificationJob, decisionColumns, householdOwnerContact, RERUN_REQUESTED_EVENT, requireDecision, scheduleDecidedFollowUps } from "./decide";
import { EXTRACTION_PURPOSE, readStoredExtraction } from "./documents";
import { loadOrgVerification, orgAuditActor, recordVerificationEvent, requireOrgStaff, type OrgActor, type VerificationRow } from "./internal";
import { queueAndSend } from "./mail";
import { FAMILY_REQUEST_LIMITS, FAMILY_VERIFICATION_PATH, MAX_REVIEWER_INCOME_CENTS, REVIEW_ACCESS } from "./policy";
import { loadOrgDocument, type DetailDocument, type DetailIncomeItem } from "./review";
import { buildReviewerExtraction, parseReviewerExtraction, type ReviewerExtractionInput } from "./reviewer-extraction";
import { decideDedupeKey, VERIFICATION_DECIDE_JOB } from "./submit";

/**
 * A reviewer may change the file while it waits on a person (needs_review) or on the family (pending,
 * awaiting_family). Not while the engine is working on it, and never after a decision or once closed.
 */
function assertReviewerEditable(v: VerificationRow): void {
  if (v.status === "canceled" || v.status === "expired") throw conflict(v.status === "canceled" ? "This verification was canceled." : "This verification has expired.", { reason: `verification_${v.status}` });
  if (v.status === "eligible" || v.status === "ineligible") throw conflict("This verification is already decided.", { reason: "verification_decided" });
  if (v.status === "needs_review" || (v.status === "pending" && v.stage === "awaiting_family")) return;
  throw conflict("This verification is not waiting on a reviewer right now.", { reason: "verification_not_in_review", status: v.status, stage: v.stage });
}

async function activeMember(db: DbOrTx, householdId: string | null, memberId: string): Promise<boolean> {
  if (!householdId) return false;
  const [m] = await db
    .select({ id: schema.householdMembers.id })
    .from(schema.householdMembers)
    .where(and(eq(schema.householdMembers.id, memberId), eq(schema.householdMembers.householdId, householdId), isNull(schema.householdMembers.removedAt)))
    .limit(1);
  return m !== undefined;
}

/* ------------------------------------------------------------------------------------ keyed fields */

export interface SaveReviewerExtractionResult {
  documentId: string;
  verificationId: string;
  status: DetailDocument["status"];
  extractedBy: "reviewer";
  reviewedBy: string;
  reviewedAt: Date;
  fieldCount: number;
}

/**
 * A reviewer keys the fields of a document the reader could not read (or corrects a low-confidence reading),
 * validated against the reader's own vocabulary. The document becomes `extracted` with `extracted_by = reviewer`
 * (the engines then trust it), and the reader's earlier extraction is kept inside the encrypted record. Call
 * rerunDecision afterwards to re-evaluate.
 */
export async function saveReviewerExtraction(orgId: string, documentId: string, fields: ReviewerExtractionInput, actor: OrgActor, dbOrTx?: DbOrTx): Promise<SaveReviewerExtractionResult> {
  const input = parseReviewerExtraction(fields);
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const { document, verification: v } = await loadOrgDocument(tx, orgId, actor.mode, documentId, { forUpdate: true });
    assertReviewerEditable(v);
    if (document.removedAt) throw conflict("This document was taken back by the family.", { reason: "document_removed" });
    if (document.sourceDocumentId) {
      throw new AppError("forbidden", "This document was carried over from an earlier verification; its fields cannot be keyed here. Ask the family for the document instead.", { reason: "carried_over_document" });
    }
    if (input.memberId && !(await activeMember(tx, v.householdId, input.memberId))) throw invalid("Choose a person from the household.", { fields: { memberId: "Not a member of this household." } });

    const at = now();
    const stored = buildReviewerExtraction(input, { reviewerId: actor.id, keyedAt: at, previous: readStoredExtraction(document), previousExtractedBy: document.extractedBy });
    const fieldCount = Object.keys(stored.extraction?.fields ?? {}).length;
    await tx
      .update(schema.documents)
      .set({
        status: "extracted",
        detectedKind: input.kind,
        extractionEnc: encryptJson(stored, EXTRACTION_PURPOSE),
        extractedBy: "reviewer",
        reviewedBy: actor.id,
        reviewedAt: at,
        extractedAt: document.extractedAt ?? at,
        ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
      })
      .where(eq(schema.documents.id, document.id));
    await recordVerificationEvent(tx, v.id, "document.reviewer_keyed", { type: "user", id: actor.id }, { documentId: document.id, kind: input.kind, fieldCount, replaced: document.extractedBy });
    await audit(
      { actor: orgAuditActor(actor), orgId, action: "document.reviewer_extraction", target: { type: "document", id: document.id }, metadata: { verificationId: v.id, kind: input.kind, fieldCount }, request: actor.request },
      tx,
    );
    return { documentId: document.id, verificationId: v.id, status: "extracted", extractedBy: "reviewer", reviewedBy: actor.id, reviewedAt: at, fieldCount };
  });
}

/* ------------------------------------------------------------------------------------- income lines */

export interface ReviewerIncomeItemInput {
  /** Household member the income belongs to; omit for household-level income. */
  memberId?: string | null;
  /** Category key from src/engine/income/categories.ts. */
  category: string;
  annualAmountCents: number;
  /** Defaults to the verification's income year. */
  incomeYear?: number | null;
  /** What the line is, for the record. */
  description: string;
  /** Where the figure comes from (the document, the call, the letter), for the record. */
  basis: string;
  /** The document the figure was read from, when there is one. */
  documentId?: string | null;
}

const lineText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .refine((v) => v.length > 0, "is required")
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "must not contain control characters");

const incomeItemSchema = z.strictObject({
  memberId: z.string().min(1).max(128).nullish(),
  category: z.string().min(1).max(80),
  annualAmountCents: z.number().int({ error: "must be a whole number of cents" }).min(-MAX_REVIEWER_INCOME_CENTS).max(MAX_REVIEWER_INCOME_CENTS),
  incomeYear: z.number().int().min(2000).max(2999).nullish(),
  description: lineText(500),
  basis: lineText(500),
  documentId: z.string().min(1).max(128).nullish(),
});

function toDetailIncomeItem(r: typeof schema.incomeItems.$inferSelect, label: string): DetailIncomeItem {
  return {
    id: r.id,
    memberId: r.memberId,
    source: r.source,
    category: r.category,
    categoryLabel: label,
    description: r.description,
    incomeYear: r.incomeYear,
    annualAmountCents: r.annualAmountCents,
    counted: r.counted,
    basis: r.basis,
    documentId: r.documentId,
    railConnectionId: r.railConnectionId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

/**
 * A reviewer adds one line of household income (for example a figure read from a document the reader could not
 * read). Counted unless its category is excluded from household income. Call rerunDecision afterwards.
 */
export async function addReviewerIncomeItem(orgId: string, verificationId: string, input: ReviewerIncomeItemInput, actor: OrgActor, dbOrTx?: DbOrTx): Promise<DetailIncomeItem> {
  const parsed = incomeItemSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "item")] ??= issue.message;
    throw invalid("The income line is not valid.", { fields });
  }
  const data = parsed.data;
  const category = getIncomeCategory(data.category);
  if (!category) throw invalid("Choose a known income category.", { fields: { category: "Unknown category." } });
  if (data.annualAmountCents < 0 && !category.allowsNegative) throw invalid("This kind of income cannot be negative.", { fields: { annualAmountCents: "Must be zero or more for this category." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const v = await loadOrgVerification(tx, orgId, actor.mode, verificationId, { forUpdate: true });
    assertReviewerEditable(v);
    const incomeYear = data.incomeYear ?? v.incomeYear;
    if (incomeYear === null || incomeYear === undefined) throw invalid("Say which year the income is for.", { fields: { incomeYear: "Required until the family submits." } });
    if (data.memberId && !(await activeMember(tx, v.householdId, data.memberId))) throw invalid("Choose a person from the household.", { fields: { memberId: "Not a member of this household." } });
    if (data.documentId) {
      const [doc] = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(eq(schema.documents.id, data.documentId), eq(schema.documents.verificationId, v.id), isNull(schema.documents.removedAt)))
        .limit(1);
      if (!doc) throw invalid("Choose a document of this verification.", { fields: { documentId: "Not a document of this verification." } });
    }
    const [row] = await tx
      .insert(schema.incomeItems)
      .values({
        id: newId("incomeItem"),
        verificationId: v.id,
        memberId: data.memberId ?? null,
        source: "reviewer",
        category: category.key,
        description: data.description,
        incomeYear,
        annualAmountCents: data.annualAmountCents,
        counted: category.treatment !== "excluded",
        basis: data.basis,
        documentId: data.documentId ?? null,
        railConnectionId: null,
        createdBy: actor.id,
        createdAt: now(),
      })
      .returning();
    await recordVerificationEvent(tx, v.id, "income.reviewer_added", { type: "user", id: actor.id }, { incomeItemId: row.id, category: row.category, documentId: row.documentId });
    await audit({ actor: orgAuditActor(actor), orgId, action: "income_item.add", target: { type: "income_item", id: row.id }, metadata: { verificationId: v.id, category: row.category }, request: actor.request }, tx);
    return toDetailIncomeItem(row, category.label.en);
  });
}

/** Removes a line a reviewer added. Lines read from documents or data connections are not removable here. */
export async function removeReviewerIncomeItem(orgId: string, itemId: string, actor: OrgActor, dbOrTx?: DbOrTx): Promise<DetailIncomeItem> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const [item] = typeof itemId === "string" && itemId.length > 0 && itemId.length <= 128 ? await tx.select().from(schema.incomeItems).where(eq(schema.incomeItems.id, itemId)).limit(1) : [];
    if (!item) throw notFound("Income line");
    let v: VerificationRow;
    try {
      v = await loadOrgVerification(tx, orgId, actor.mode, item.verificationId, { forUpdate: true });
    } catch (e) {
      if (e instanceof AppError && e.code === "not_found") throw notFound("Income line");
      throw e;
    }
    assertReviewerEditable(v);
    if (item.source !== "reviewer") throw conflict("Only lines a reviewer added can be removed. Correct the document's fields instead.", { reason: "not_reviewer_line" });
    await tx.delete(schema.incomeItems).where(eq(schema.incomeItems.id, item.id));
    await recordVerificationEvent(tx, v.id, "income.reviewer_removed", { type: "user", id: actor.id }, { incomeItemId: item.id, category: item.category });
    await audit({ actor: orgAuditActor(actor), orgId, action: "income_item.remove", target: { type: "income_item", id: item.id }, metadata: { verificationId: v.id, category: item.category }, request: actor.request }, tx);
    return toDetailIncomeItem(item, getIncomeCategory(item.category)?.label.en ?? item.category);
  });
}

/* ------------------------------------------------------------------------------------------- re-run */

/**
 * Runs the engine again with everything on file, including what reviewers keyed. The open review task stays
 * linked and is updated (or closed, when the engine can now decide on its own). The decision runs right away;
 * the queued job is the safety net if this process stops in between. Returns the verification afterwards.
 */
export async function rerunDecision(orgId: string, id: string, actor: OrgActor, dbOrTx?: DbOrTx): Promise<VerificationRow> {
  const db = dbOrTx ?? (await getDb());
  const v = await db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const row = await loadOrgVerification(tx, orgId, actor.mode, id, { forUpdate: true });
    assertReviewerEditable(row);
    if (!row.householdId || !row.householdCompletedAt || !row.applicationDate) throw conflict("The family has not submitted this verification yet.", { reason: "not_submitted" });
    const [updated] = await tx.update(schema.verifications).set({ status: "pending", stage: "submitted", updatedAt: now() }).where(eq(schema.verifications.id, row.id)).returning();
    await recordVerificationEvent(tx, row.id, RERUN_REQUESTED_EVENT, { type: "user", id: actor.id }, { previousStatus: row.status, previousStage: row.stage });
    await audit({ actor: orgAuditActor(actor), orgId, action: "verification.rerun", target: { type: "verification", id: row.id }, metadata: { previousStatus: row.status }, request: actor.request }, tx);
    await enqueue(VERIFICATION_DECIDE_JOB, { verificationId: row.id, trigger: "reviewer" }, { dedupeKey: decideDedupeKey(row.id) }, tx);
    return updated;
  });
  if (!dbOrTx) {
    try {
      await decideVerificationJob(v.id, { trigger: "reviewer" });
    } catch (e) {
      console.error(`[verifications] inline re-evaluation of ${v.id} failed; the queued decide job retries: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return loadOrgVerification(db, orgId, actor.mode, v.id);
}

/* ------------------------------------------------------------------------------------------ resolve */

export interface ResolveReviewInput {
  resolution: "eligible" | "ineligible";
  /** Why: what was checked. Required; it goes into the evidence pack. */
  notes: string;
  /** The listed method relied on; a categorical resolution names the award letter. */
  basis: ReviewerBasis;
}

/**
 * A reviewer decides a verification that needs review, through the engine's applyReviewerResolution: notes are
 * mandatory, "eligible" is refused above the statutory limit under every reading, "ineligible" needs income
 * shown over the limit, and a categorical resolution must rest on a letter of a listed program. The verification
 * is then decided by the reviewer (decided_by = their user id), the task is closed, and the same evidence and
 * `verification.decided` path as an engine decision follows.
 */
export async function resolveReview(orgId: string, id: string, input: ResolveReviewInput, actor: OrgActor, dbOrTx?: DbOrTx): Promise<VerificationRow> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const v = await loadOrgVerification(tx, orgId, actor.mode, id, { forUpdate: true });
    if (v.status !== "needs_review") {
      if (v.status === "eligible" || v.status === "ineligible") throw conflict("This verification is already decided.", { reason: "verification_decided" });
      if (v.status === "canceled" || v.status === "expired") throw conflict("This verification is closed.", { reason: `verification_${v.status}` });
      throw conflict("Only a verification that needs review can be resolved.", { reason: "not_in_review" });
    }
    const at = now();
    const resolved: Decision = applyReviewerResolution(requireDecision(v), {
      resolution: input?.resolution,
      reviewerId: actor.id,
      notes: typeof input?.notes === "string" ? input.notes : "",
      basis: input?.basis,
      resolvedOn: centralDateString(at),
    });
    const status = resolved.status === "ineligible" ? "ineligible" : "eligible";
    const [updated] = await tx
      .update(schema.verifications)
      .set({
        status,
        stage: "decided",
        ...decisionColumns(v, resolved, null),
        decidedAt: at,
        decidedBy: actor.id,
        expiresAt: resolved.validUntil ? endOfCentralDay(resolved.validUntil) : null,
        familyRequest: null,
        updatedAt: at,
      })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    const notes = resolved.decidedBy.type === "reviewer" ? resolved.decidedBy.notes : "";
    const taskId = await closeOpenReviewTask(tx, v.id, { resolution: status, notes, resolvedBy: actor.id });
    await recordVerificationEvent(tx, v.id, "review.resolved", { type: "user", id: actor.id }, { reviewTaskId: taskId, resolution: status, method: resolved.method });
    await audit(
      { actor: orgAuditActor(actor), orgId, action: "review.resolve", target: { type: "verification", id: v.id }, metadata: { resolution: status, method: resolved.method, reviewTaskId: taskId }, request: actor.request },
      tx,
    );
    await scheduleDecidedFollowUps(tx, updated, at);
    return updated;
  });
}

/* ---------------------------------------------------------------------------------- ask for more */

export interface RequestMoreInfoInput {
  /** Written by the reviewer for the family; shown and emailed as written. */
  message: string;
  /** One short line per thing asked for. */
  items: string[];
}

const requestSchema = z.strictObject({
  message: lineText(FAMILY_REQUEST_LIMITS.maxMessageLength),
  items: z.array(lineText(FAMILY_REQUEST_LIMITS.maxItemLength)).min(1, "List at least one thing to send.").max(FAMILY_REQUEST_LIMITS.maxItems),
});

/**
 * A reviewer asks the family for more: the verification goes back to the family (pending, awaiting_family) with
 * the request on its screens, the family is emailed in its language, and the review task stays open and linked.
 * When the family adds what was asked and submits again, the decide job runs again and updates that task.
 */
export async function requestMoreInfo(orgId: string, id: string, input: RequestMoreInfoInput, actor: OrgActor, dbOrTx?: DbOrTx): Promise<VerificationRow> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "request")] ??= issue.message;
    throw invalid("The request is not valid.", { fields });
  }
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await requireOrgStaff(tx, orgId, actor, REVIEW_ACCESS.act);
    const v = await loadOrgVerification(tx, orgId, actor.mode, id, { forUpdate: true });
    assertReviewerEditable(v);
    if (!v.householdId) throw conflict("The family has not opened the link yet.", { reason: "not_started" });
    const at = now();
    const request: FamilyRequest = { message: parsed.data.message, items: parsed.data.items, requestedAt: at.toISOString(), requestedBy: actor.id };
    const [updated] = await tx.update(schema.verifications).set({ status: "pending", stage: "awaiting_family", familyRequest: request, updatedAt: at }).where(eq(schema.verifications.id, v.id)).returning();
    const rt = schema.reviewTasks;
    const [task] = await tx.select({ id: rt.id }).from(rt).where(and(eq(rt.verificationId, v.id), eq(rt.status, "open"))).limit(1);
    let taskId = task?.id ?? null;
    if (taskId) {
      await tx.update(rt).set({ moreInfoRequestedAt: at }).where(eq(rt.id, taskId));
    } else {
      // A reviewer can ask on a file the engine sent back to the family; the task then tracks the request.
      taskId = newId("reviewTask");
      await tx.insert(rt).values({ id: taskId, verificationId: v.id, orgId, status: "open", reasons: v.decisionReasons, moreInfoRequestedAt: at, createdAt: at });
    }
    await recordVerificationEvent(tx, v.id, "review.more_info_requested", { type: "user", id: actor.id }, { reviewTaskId: taskId, items: parsed.data.items.length });
    await audit({ actor: orgAuditActor(actor), orgId, action: "review.request_more_info", target: { type: "verification", id: v.id }, metadata: { reviewTaskId: taskId, items: parsed.data.items.length }, request: actor.request }, tx);

    const contact = await householdOwnerContact(tx, v.householdId);
    if (contact) {
      const sgo = await getSgoProfile(orgId, tx);
      const copy = familyRequestEmailCopy(contact.locale, sgo.profile.displayName || sgo.org.name);
      const rendered = renderEmail({
        locale: contact.locale,
        heading: copy.heading,
        paragraphs: [copy.intro, request.message, `${copy.itemsHeading}:`, ...request.items.map((i) => `• ${i}`)],
        cta: { label: copy.cta, url: appUrl(FAMILY_VERIFICATION_PATH(v.id)) },
      });
      await queueAndSend({ to: contact.email, subject: copy.subject, template: "verification_more_information_request", html: rendered.html, text: rendered.text, related: { type: "verification", id: v.id } }, tx);
    }
    return updated;
  });
}
