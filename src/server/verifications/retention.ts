/**
 * Retention and expiry, run on a schedule.
 *
 *  - "retention.purge": raw uploads whose purge date has passed lose their bytes (storage.purgeObject destroys the
 *    object's key and keeps its SHA-256). The decision, the extracted fields and the file hashes stay: "Keep the
 *    decision, extracted fields, and file hashes; delete raw uploads after a window the SGO agrees to." The purge
 *    date is set when a verification is decided or canceled, from the SGO's `rawRetentionDays`.
 *  - "verification.expire": a decided result past its `expiresAt` becomes `expired` and `verification.expired` is
 *    emitted. The stored decision is kept.
 */
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { SYSTEM_ACTOR, audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { purgeObject } from "@/server/storage";
import { loadVerificationRow, recordVerificationEvent } from "./internal";
import { toApiVerification } from "./serialize";

export const RETENTION_PURGE_JOB = "retention.purge";
export const VERIFICATION_EXPIRE_JOB = "verification.expire";
/** Rows handled per run; the next scheduled run continues. */
export const RETENTION_BATCH_SIZE = 200;

export interface PurgeRunResult {
  purged: number;
  failed: number;
}

/** Purges the bytes of documents past their purge date. A failure on one document does not stop the others. */
export async function purgeDueUploads(opts: { limit?: number } = {}): Promise<PurgeRunResult> {
  const db = await getDb();
  const due = await db
    .select({ id: schema.documents.id, objectId: schema.documents.objectId, verificationId: schema.documents.verificationId })
    .from(schema.documents)
    .where(and(lte(schema.documents.purgeAfter, now()), isNull(schema.documents.purgedAt)))
    .orderBy(asc(schema.documents.purgeAfter), asc(schema.documents.id))
    .limit(opts.limit ?? RETENTION_BATCH_SIZE);
  const result: PurgeRunResult = { purged: 0, failed: 0 };
  for (const doc of due) {
    try {
      await purgeObject(doc.objectId, "retention");
      await db.transaction(async (tx) => {
        await tx.update(schema.documents).set({ purgedAt: now() }).where(and(eq(schema.documents.id, doc.id), isNull(schema.documents.purgedAt)));
        await recordVerificationEvent(tx, doc.verificationId, "document.purged", { type: "system", id: null }, { documentId: doc.id, reason: "retention" });
      });
      result.purged++;
    } catch (e) {
      result.failed++;
      console.error(`[verifications] retention purge of document ${doc.id} failed; the next run retries: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/** Marks decided results past their expiry as expired and emits `verification.expired`. Returns how many. */
export async function expireDueVerifications(opts: { limit?: number } = {}): Promise<number> {
  const db = await getDb();
  const due = await db
    .select({ id: schema.verifications.id })
    .from(schema.verifications)
    .where(and(inArray(schema.verifications.status, ["eligible", "ineligible"]), lte(schema.verifications.expiresAt, now())))
    .orderBy(asc(schema.verifications.expiresAt), asc(schema.verifications.id))
    .limit(opts.limit ?? RETENTION_BATCH_SIZE);
  let expired = 0;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const v = await loadVerificationRow(tx, id, { forUpdate: true });
      if (!v || (v.status !== "eligible" && v.status !== "ineligible") || !v.expiresAt || v.expiresAt.getTime() > now().getTime()) return false;
      const [updated] = await tx.update(schema.verifications).set({ status: "expired", updatedAt: now() }).where(eq(schema.verifications.id, v.id)).returning();
      await recordVerificationEvent(tx, v.id, "expired", { type: "system", id: null }, { previousStatus: v.status });
      await emitEvent({ orgId: v.orgId, type: "verification.expired", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: v.mode }, tx);
      await audit({ actor: SYSTEM_ACTOR, orgId: v.orgId, action: "verification.expire", target: { type: "verification", id: v.id }, metadata: { previousStatus: v.status } }, tx);
      return true;
    });
    if (done) expired++;
  }
  return expired;
}
