/**
 * The "document.extract" job: bytes → the document reader → an encrypted extraction on the document row.
 *
 * Scans and photos go to the model reader only when one is configured (ANTHROPIC_API_KEY); otherwise they stay in
 * human review with reason "no_text_layer". Extracted values are never logged: the row holds them encrypted
 * (purpose "extraction"), the timeline and audit log hold only statuses and reason codes.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { DocumentStatus } from "@/db/schema";
import { centralDateString, now } from "@/lib/clock";
import { encryptJson } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { SYSTEM_ACTOR, audit } from "@/server/audit";
import { readUploadedDocument, type ReadUploadedDocumentOptions } from "@/server/documents";
import { getHouseholdSnapshot } from "@/server/households";
import { enqueue } from "@/server/jobs";
import { getObjectBytes } from "@/server/storage";
import { EXTRACTION_PURPOSE } from "./documents";
import type { StoredExtraction } from "./evidence-mapping";
import { loadVerificationRow, recordVerificationEvent } from "./internal";
import { CLOSED_STATUSES } from "./policy";
import { decideDedupeKey, VERIFICATION_DECIDE_JOB } from "./submit";

const READABLE: readonly DocumentStatus[] = ["uploaded", "extracting"];

/** Options for tests (an injected model client). Production passes none. */
export interface ExtractOptions {
  reader?: ReadUploadedDocumentOptions;
}

/** Reads one document. Idempotent: a document already read, taken back, or on a closed verification is left alone. */
export async function extractDocumentJob(documentId: string, opts: ExtractOptions = {}): Promise<void> {
  const db = await getDb();
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1);
  if (!doc || doc.removedAt || !READABLE.includes(doc.status)) return;
  const verification = await loadVerificationRow(db, doc.verificationId);
  if (!verification || CLOSED_STATUSES.has(verification.status)) return;

  await db.update(schema.documents).set({ status: "extracting" }).where(and(eq(schema.documents.id, doc.id), inArray(schema.documents.status, READABLE), isNull(schema.documents.removedAt)));

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(doc.objectId, { orgId: verification.orgId });
  } catch (e) {
    // Bytes deleted in the meantime: nothing to read, a person decides.
    if (isAppError(e) && (e.code === "gone" || e.code === "not_found")) {
      await finish(doc.id, verification.id, verification.orgId, "needs_review", null, [{ code: "unreadable_file", message: "The file is no longer stored and could not be read." }], null);
      return;
    }
    throw e;
  }

  const snapshot = await getHouseholdSnapshot(doc.householdId, {}, db);
  const reading = await readUploadedDocument(
    {
      bytes,
      contentType: doc.contentType,
      declaredKind: doc.declaredKind,
      referenceDate: verification.applicationDate ?? centralDateString(now()),
      household: snapshot.members.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName })),
    },
    opts.reader,
  );

  const stored: StoredExtraction = {
    readerStatus: reading.status,
    detectedKind: reading.detectedKind,
    extraction: reading.extraction,
    extractedBy: reading.extractedBy,
    synthetic: reading.synthetic,
    model: reading.model,
    pageCount: reading.pageCount,
    textSource: reading.textSource,
  };
  // Not-acceptable findings (a denial, a program not on the list) are kept with the review reasons so the
  // reviewer sees them on the document; the decision engine draws its own conclusions from the extraction.
  const reasons = [...reading.reviewReasons, ...reading.notAcceptable].map((r) => ({ code: r.code, message: r.message }));
  const status: DocumentStatus = reading.status === "extracted" ? "extracted" : "needs_review";
  await finish(doc.id, verification.id, verification.orgId, status, stored, reasons, reading.extractedBy);
}

async function finish(
  documentId: string,
  verificationId: string,
  orgId: string,
  status: DocumentStatus,
  stored: StoredExtraction | null,
  reasons: Array<{ code: string; message: string }>,
  extractedBy: "parser" | "model" | null,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.documents)
      .set({
        status,
        detectedKind: stored?.detectedKind ?? null,
        extractionEnc: stored ? encryptJson(stored, EXTRACTION_PURPOSE) : null,
        extractedBy,
        reviewReasons: reasons,
        extractedAt: now(),
      })
      .where(and(eq(schema.documents.id, documentId), eq(schema.documents.status, "extracting"), isNull(schema.documents.removedAt)))
      .returning({ id: schema.documents.id });
    if (!updated) return;
    await recordVerificationEvent(tx, verificationId, "document.extracted", { type: "system", id: null }, {
      documentId,
      status,
      detectedKind: stored?.detectedKind ?? null,
      extractedBy,
      reasonCodes: reasons.map((r) => r.code),
    });
    await audit({ actor: SYSTEM_ACTOR, orgId, action: "document.extract", target: { type: "document", id: documentId }, metadata: { status, extractedBy, reasonCodes: reasons.map((r) => r.code) } }, tx);
    const v = await loadVerificationRow(tx, verificationId);
    if (v && v.status === "pending" && (v.stage === "submitted" || v.stage === "processing")) {
      await enqueue(VERIFICATION_DECIDE_JOB, { verificationId }, { dedupeKey: decideDedupeKey(verificationId) }, tx);
    }
  });
}
