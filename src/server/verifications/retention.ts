/**
 * Retention and expiry, run on a schedule. Every run is batched, idempotent and safe to repeat on both databases:
 * rows are selected by plain predicates, each change is made under a row lock, and a row already handled no
 * longer matches.
 *
 *  - "retention.purge": raw uploads whose purge date has passed lose their bytes (storage.purgeObject destroys the
 *    object's key and keeps its SHA-256); the document becomes "purged" and a "document.purged" timeline entry
 *    records the hash that is kept. The decision, the extracted fields and the file hashes stay: "Keep the
 *    decision, extracted fields, and file hashes; delete raw uploads after a window the SGO agrees to." The purge
 *    date is set when a verification is decided or canceled, from the SGO's `rawRetentionDays`. Uploads of a
 *    verification the family stopped working on are purged ABANDONED_UPLOAD_RETENTION_DAYS after it last changed.
 *  - "verification.expire": a family link nobody opened before it expired, and a decided result past its
 *    `expiresAt`, become `expired`, and `verification.expired` is emitted. Evidence is never deleted.
 */
import { and, asc, eq, gt, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { addMs, MS, now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { SYSTEM_ACTOR, audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { purgeObject } from "@/server/storage";
import { loadVerificationRow, recordVerificationEvent, type VerificationRow } from "./internal";
import { ABANDONABLE_STAGES, ABANDONED_UPLOAD_RETENTION_DAYS } from "./policy";
import { toApiVerification } from "./serialize";

export const RETENTION_PURGE_JOB = "retention.purge";
export const VERIFICATION_EXPIRE_JOB = "verification.expire";
/** Rows handled per run; the next scheduled run continues. */
export const RETENTION_BATCH_SIZE = 200;

export interface PurgeRunResult {
  /** Documents whose bytes were deleted in this run. */
  purged: number;
  /** Documents whose deletion failed; the next run retries them. */
  failed: number;
  /** Verifications whose uploads were released because the family stopped before submitting. */
  abandoned: number;
}

/**
 * Releases the uploads of verifications the family stopped working on: still pending in a family stage and
 * untouched for ABANDONED_UPLOAD_RETENTION_DAYS. Their documents stop counting (the family uploads again if it
 * comes back) and get a purge date of now, so the same run deletes the bytes. Rows, hashes and extracted fields stay.
 * "Untouched" means neither the verification row nor its timeline changed in the window.
 */
async function releaseAbandonedUploads(limit: number): Promise<number> {
  const db = await getDb();
  const cutoff = addMs(now(), -ABANDONED_UPLOAD_RETENTION_DAYS * MS.day);
  const v = schema.verifications;
  const d = schema.documents;
  const candidates = await db
    .selectDistinct({ id: v.id, updatedAt: v.updatedAt })
    .from(v)
    .innerJoin(d, eq(d.verificationId, v.id))
    .where(
      and(
        eq(v.status, "pending"),
        inArray(v.stage, [...ABANDONABLE_STAGES]),
        lte(v.updatedAt, cutoff),
        isNull(d.removedAt),
        notExists(db.select({ one: sql`1` }).from(schema.verificationEvents).where(and(eq(schema.verificationEvents.verificationId, v.id), gt(schema.verificationEvents.createdAt, cutoff)))),
      ),
    )
    .orderBy(asc(v.updatedAt), asc(v.id))
    .limit(limit);
  let released = 0;
  for (const { id } of candidates) {
    const done = await db.transaction(async (tx) => {
      const row = await loadVerificationRow(tx, id, { forUpdate: true });
      if (!row || row.status !== "pending" || !ABANDONABLE_STAGES.includes(row.stage) || row.updatedAt.getTime() > cutoff.getTime()) return false;
      // Not every family action touches the verification row (an upload in the same stage does not); the timeline does.
      const [recent] = await tx
        .select({ id: schema.verificationEvents.id })
        .from(schema.verificationEvents)
        .where(and(eq(schema.verificationEvents.verificationId, row.id), gt(schema.verificationEvents.createdAt, cutoff)))
        .limit(1);
      if (recent) return false;
      const at = now();
      const docs = await tx
        .update(d)
        .set({ removedAt: at })
        .where(and(eq(d.verificationId, row.id), isNull(d.removedAt)))
        .returning({ id: d.id, sourceDocumentId: d.sourceDocumentId, purgedAt: d.purgedAt });
      if (docs.length === 0) return false;
      // Only files this verification owns are deleted; a passport reference shares the earlier verification's file.
      const own = docs.filter((x) => x.sourceDocumentId === null && x.purgedAt === null).map((x) => x.id);
      if (own.length > 0) await tx.update(d).set({ purgeAfter: at }).where(inArray(d.id, own));
      await recordVerificationEvent(tx, row.id, "documents.released_abandoned", { type: "system", id: null }, { documents: docs.length, retentionDays: ABANDONED_UPLOAD_RETENTION_DAYS });
      await audit({ actor: SYSTEM_ACTOR, orgId: row.orgId, action: "verification.uploads_abandoned", target: { type: "verification", id: row.id }, metadata: { documents: docs.length, stage: row.stage } }, tx);
      return true;
    });
    if (done) released++;
  }
  return released;
}

/**
 * Purges the bytes of documents past their purge date. A failure on one document does not stop the others.
 * Documents carried over by a passport reuse never purge: they share the earlier verification's file. When the
 * earlier verification purges it, every carried-over copy is marked purged too.
 */
export async function purgeDueUploads(opts: { limit?: number } = {}): Promise<PurgeRunResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const abandoned = await releaseAbandonedUploads(limit);
  const db = await getDb();
  const d = schema.documents;
  const due = await db
    .select({ id: d.id, objectId: d.objectId, verificationId: d.verificationId, sha256: d.sha256 })
    .from(d)
    .where(and(lte(d.purgeAfter, now()), isNull(d.purgedAt), isNull(d.sourceDocumentId)))
    .orderBy(asc(d.purgeAfter), asc(d.id))
    .limit(limit);
  const result: PurgeRunResult = { purged: 0, failed: 0, abandoned };
  for (const doc of due) {
    try {
      await purgeObject(doc.objectId, "retention");
      await db.transaction(async (tx) => {
        const at = now();
        const [marked] = await tx.update(d).set({ purgedAt: at, status: "purged" }).where(and(eq(d.id, doc.id), isNull(d.purgedAt))).returning({ id: d.id });
        if (!marked) return;
        await recordVerificationEvent(tx, doc.verificationId, "document.purged", { type: "system", id: null }, { documentId: doc.id, sha256: doc.sha256, reason: "retention" });
        const copies = await tx.update(d).set({ purgedAt: at, status: "purged" }).where(and(eq(d.sourceDocumentId, doc.id), isNull(d.purgedAt))).returning({ id: d.id, verificationId: d.verificationId });
        for (const c of copies) await recordVerificationEvent(tx, c.verificationId, "document.purged", { type: "system", id: null }, { documentId: c.id, sha256: doc.sha256, reason: "source_retention" });
      });
      result.purged++;
    } catch (e) {
      result.failed++;
      console.error(`[verifications] retention purge of document ${doc.id} failed; the next run retries: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

async function markExpired(tx: DbOrTx, v: VerificationRow, why: "result_expired" | "link_expired"): Promise<void> {
  const [updated] = await tx.update(schema.verifications).set({ status: "expired", updatedAt: now() }).where(eq(schema.verifications.id, v.id)).returning();
  await recordVerificationEvent(tx, v.id, "expired", { type: "system", id: null }, { previousStatus: v.status, reason: why });
  await emitEvent({ orgId: v.orgId, type: "verification.expired", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: v.mode }, tx);
  await audit({ actor: SYSTEM_ACTOR, orgId: v.orgId, action: "verification.expire", target: { type: "verification", id: v.id }, metadata: { previousStatus: v.status, reason: why } }, tx);
}

/**
 * Marks as expired (1) decided results past `expiresAt` and (2) verifications whose family link expired before
 * anyone opened it, and emits `verification.expired` for each. The decision and the evidence are kept. Returns
 * how many verifications expired in this run.
 */
export async function expireDueVerifications(opts: { limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const db = await getDb();
  const v = schema.verifications;
  const at = now();
  const results = await db
    .select({ id: v.id })
    .from(v)
    .where(and(inArray(v.status, ["eligible", "ineligible"]), lte(v.expiresAt, at)))
    .orderBy(asc(v.expiresAt), asc(v.id))
    .limit(limit);
  const links = await db
    .select({ id: v.id })
    .from(v)
    .where(and(eq(v.status, "pending"), eq(v.stage, "created"), isNull(v.householdId), lte(v.familyTokenExpiresAt, at)))
    .orderBy(asc(v.familyTokenExpiresAt), asc(v.id))
    .limit(limit);

  let expired = 0;
  for (const { id } of results) {
    const done = await db.transaction(async (tx) => {
      const row = await loadVerificationRow(tx, id, { forUpdate: true });
      if (!row || (row.status !== "eligible" && row.status !== "ineligible") || !row.expiresAt || row.expiresAt.getTime() > now().getTime()) return false;
      await markExpired(tx, row, "result_expired");
      return true;
    });
    if (done) expired++;
  }
  for (const { id } of links) {
    const done = await db.transaction(async (tx) => {
      const row = await loadVerificationRow(tx, id, { forUpdate: true });
      if (!row || row.status !== "pending" || row.stage !== "created" || row.householdId !== null || row.familyTokenExpiresAt.getTime() > now().getTime()) return false;
      await markExpired(tx, row, "link_expired");
      return true;
    });
    if (done) expired++;
  }
  return expired;
}
