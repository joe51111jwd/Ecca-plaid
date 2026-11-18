/**
 * Family uploads: add a document (validated, encrypted, hashed, queued for reading) and take one back before a
 * decision (its bytes are purged; the hash stays as the audit record).
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { DocumentKind, DocumentStatus } from "@/db/schema";
import { now } from "@/lib/clock";
import { decryptJson, sha256Hex } from "@/lib/crypto";
import { conflict, forbidden, invalid, isAppError, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { assertActiveConsent } from "@/server/consents";
import { householdCan } from "@/server/households";
import { enqueue } from "@/server/jobs";
import { purgeObject, putObject, validateUpload } from "@/server/storage";
import type { StoredExtraction } from "./evidence-mapping";
import { assertFamilyEditable, familyAuditActor, laterStage, recordVerificationEvent, requireFamilyAccess, type DocumentRow, type FamilyActor } from "./internal";
import { DOCUMENT_LIMITS } from "./policy";

/** Encryption purpose of `documents.extraction_enc`. */
export const EXTRACTION_PURPOSE = "extraction";
export const DOCUMENT_EXTRACT_JOB = "document.extract";
export const DOCUMENT_KINDS_ACCEPTED: readonly DocumentKind[] = ["award_letter", "tax_return", "irs_transcript", "w2", "pay_stub", "other_income", "unknown"];

/** A document as the family sees it: no extracted values. */
export interface FamilyDocumentView {
  id: string;
  verificationId: string;
  declaredKind: DocumentKind;
  detectedKind: DocumentKind | null;
  memberId: string | null;
  filename: string;
  contentType: string;
  size: number;
  status: DocumentStatus;
  /** Codes only (the messages are written for SGO reviewers). */
  reviewReasonCodes: string[];
  /** Carried over from an earlier verification by a passport reuse (the file itself is not shared again). */
  carriedOver: boolean;
  createdAt: Date;
}

export function toFamilyDocumentView(row: DocumentRow): FamilyDocumentView {
  return {
    id: row.id,
    verificationId: row.verificationId,
    declaredKind: row.declaredKind,
    detectedKind: row.detectedKind,
    memberId: row.memberId,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    status: row.status,
    reviewReasonCodes: row.reviewReasons.map((r) => r.code),
    carriedOver: row.sourceDocumentId !== null,
    createdAt: row.createdAt,
  };
}

/** Decrypts a stored extraction. For services and jobs that already checked access. */
export function readStoredExtraction(row: Pick<DocumentRow, "extractionEnc">): StoredExtraction | null {
  return row.extractionEnc ? decryptJson<StoredExtraction>(row.extractionEnc, EXTRACTION_PURPOSE) : null;
}

export interface AddDocumentInput {
  verificationId: string;
  declaredKind: DocumentKind;
  /** Household member the document is about, when the family says. */
  memberId?: string | null;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface AddDocumentResult {
  document: FamilyDocumentView;
  /** True when the same file (by SHA-256) was already on this verification: nothing new was stored. */
  duplicate: boolean;
}

const addSchema = z.object({
  verificationId: z.string().min(1).max(128),
  declaredKind: z.enum(DOCUMENT_KINDS_ACCEPTED as [DocumentKind, ...DocumentKind[]], { error: "Choose what kind of document this is." }),
  memberId: z.string().min(1).max(128).nullish(),
  filename: z.string().max(1000),
  contentType: z.string().max(255),
});

async function activeDocuments(db: DbOrTx, verificationId: string): Promise<DocumentRow[]> {
  return db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.verificationId, verificationId), isNull(schema.documents.removedAt)))
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
}

/**
 * Stores an upload for a verification and queues it for reading. The file is checked by its bytes
 * (storage.validateUpload), encrypted under its own key, hashed server-side and indexed; the same file uploaded
 * twice to the same verification is recognised by its SHA-256 and not stored again. Any adult of the household
 * may upload; the sharing consent must be active.
 */
export async function addDocument(input: AddDocumentInput, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<AddDocumentResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "document")] ??= issue.message;
    throw invalid("The document upload is not valid.", { fields });
  }
  if (!(input.bytes instanceof Uint8Array)) throw invalid("The document upload is not valid.", { fields: { bytes: "Missing file." } });
  const upload = validateUpload({ bytes: input.bytes, contentType: input.contentType, filename: input.filename });
  const sha256 = sha256Hex(input.bytes);
  const data = parsed.data;

  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { verification: v, access } = await requireFamilyAccess(tx, data.verificationId, actor, { forUpdate: true });
    if (!householdCan(access.access, "add_documents")) throw forbidden();
    assertFamilyEditable(v);
    await assertActiveConsent(v.id, "verification_share", tx);

    if (data.memberId) {
      const [member] = await tx
        .select({ id: schema.householdMembers.id })
        .from(schema.householdMembers)
        .where(and(eq(schema.householdMembers.id, data.memberId), eq(schema.householdMembers.householdId, v.householdId!), isNull(schema.householdMembers.removedAt)))
        .limit(1);
      if (!member) throw invalid("Choose a person from the household.", { fields: { memberId: "Not a member of this household." } });
    }

    const active = await activeDocuments(tx, v.id);
    const existing = active.find((d) => d.sha256 === sha256);
    if (existing) return { document: toFamilyDocumentView(existing), duplicate: true };
    if (active.length >= DOCUMENT_LIMITS.maxActiveDocuments) throw conflict(`At most ${DOCUMENT_LIMITS.maxActiveDocuments} documents can be added to one verification.`, { reason: "too_many_documents" });
    const totalBytes = active.reduce((sum, d) => sum + d.size, 0);
    if (totalBytes + upload.size > DOCUMENT_LIMITS.maxTotalBytes) throw conflict("The documents for this verification are too large in total.", { reason: "too_many_bytes" });

    const object = await putObject({ bytes: input.bytes, contentType: upload.contentType, purpose: "upload", filename: upload.filename, orgId: v.orgId, householdId: v.householdId }, tx);
    const [row] = await tx
      .insert(schema.documents)
      .values({
        id: newId("document"),
        verificationId: v.id,
        householdId: v.householdId!,
        declaredKind: data.declaredKind,
        memberId: data.memberId ?? null,
        objectId: object.id,
        sha256: object.sha256,
        filename: upload.filename,
        contentType: upload.contentType,
        size: upload.size,
        status: "uploaded",
        createdAt: now(),
      })
      .returning();
    const stage = laterStage(v.stage, "collecting");
    if (stage !== v.stage) await tx.update(schema.verifications).set({ stage, updatedAt: now() }).where(eq(schema.verifications.id, v.id));
    await recordVerificationEvent(tx, v.id, "document.uploaded", { type: "family", id: actor.userId }, { documentId: row.id, declaredKind: row.declaredKind, sha256: row.sha256, size: row.size });
    await audit(
      { actor: familyAuditActor(actor), orgId: v.orgId, action: "document.upload", target: { type: "document", id: row.id }, metadata: { verificationId: v.id, declaredKind: row.declaredKind, size: row.size, contentType: row.contentType }, request: actor.request },
      tx,
    );
    await enqueue(DOCUMENT_EXTRACT_JOB, { documentId: row.id }, { dedupeKey: `${DOCUMENT_EXTRACT_JOB}:${row.id}` }, tx);
    return { document: toFamilyDocumentView(row), duplicate: false };
  });
}

/** The verification's documents that still count (not taken back), oldest first. */
export async function listDocuments(verificationId: string, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<FamilyDocumentView[]> {
  const db = dbOrTx ?? (await getDb());
  const { verification } = await requireFamilyAccess(db, verificationId, actor);
  return (await activeDocuments(db, verification.id)).map(toFamilyDocumentView);
}

/**
 * Takes a document back before a decision: it stops counting, its extracted fields and income lines are
 * deleted and its bytes are purged (a queued purge job finishes the deletion if the direct purge fails). The
 * row, its SHA-256 and the timeline entry stay. Idempotent.
 */
export async function removeDocument(documentId: string, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<FamilyDocumentView> {
  const db = dbOrTx ?? (await getDb());
  const result = await db.transaction(async (tx) => {
    const [doc] = typeof documentId === "string" && documentId.length > 0 && documentId.length <= 128 ? await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1).for("update") : [];
    if (!doc) throw notFound("Document");
    let access;
    try {
      access = await requireFamilyAccess(tx, doc.verificationId, actor, { forUpdate: true });
    } catch (e) {
      if (isAppError(e) && e.code === "not_found") throw notFound("Document");
      throw e;
    }
    if (doc.removedAt) return { row: doc, purge: false };
    if (!householdCan(access.access.access, "add_documents")) throw forbidden();
    assertFamilyEditable(access.verification);
    const at = now();
    const [row] = await tx
      .update(schema.documents)
      .set({ removedAt: at, removedBy: actor.userId, status: "purged", extractionEnc: null })
      .where(eq(schema.documents.id, doc.id))
      .returning();
    await tx.delete(schema.incomeItems).where(eq(schema.incomeItems.documentId, doc.id));
    await recordVerificationEvent(tx, doc.verificationId, "document.removed", { type: "family", id: actor.userId }, { documentId: doc.id, sha256: doc.sha256 });
    await audit({ actor: familyAuditActor(actor), orgId: access.verification.orgId, action: "document.remove", target: { type: "document", id: doc.id }, metadata: { verificationId: doc.verificationId }, request: actor.request }, tx);
    // A document carried over by a passport reuse shares the earlier verification's file: taking it back here
    // stops it counting, but the file is governed by the earlier verification's retention.
    if (doc.sourceDocumentId) return { row, purge: false };
    await enqueue("storage.purge_object", { objectId: doc.objectId, reason: "family_removed" }, { dedupeKey: `purge:${doc.objectId}` }, tx);
    return { row, purge: true };
  });

  if (result.purge) {
    try {
      await purgeObject(result.row.objectId, "family_removed", { actor: familyAuditActor(actor), request: actor.request ?? null });
      const [purged] = await db.update(schema.documents).set({ purgedAt: now() }).where(eq(schema.documents.id, result.row.id)).returning();
      return toFamilyDocumentView(purged);
    } catch (e) {
      // The queued storage.purge_object job retries the deletion; the document already no longer counts.
      console.error(`[verifications] direct purge of document ${result.row.id} failed; the purge job will retry: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return toFamilyDocumentView(result.row);
}
