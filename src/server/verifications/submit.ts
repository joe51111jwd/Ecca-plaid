/**
 * The family presses submit: the application date is fixed, the SGO is told, and the decision job is queued.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { centralDateString, now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { conflict, forbidden, invalid } from "@/lib/errors";
import { audit } from "@/server/audit";
import { assertActiveConsent } from "@/server/consents";
import { emitEvent } from "@/server/events";
import { householdCan } from "@/server/households";
import { enqueue } from "@/server/jobs";
import { buildFamilyView, type FamilyVerificationView } from "./family";
import { assertFamilyEditable, familyAuditActor, recordVerificationEvent, requireFamilyAccess, type FamilyActor } from "./internal";
import { toApiVerification } from "./serialize";

export const VERIFICATION_DECIDE_JOB = "verification.decide";

/** Dedupe key of the decide job queued for a submission (also used when a finished extraction re-triggers it). */
export function decideDedupeKey(verificationId: string): string {
  return `${VERIFICATION_DECIDE_JOB}:${verificationId}`;
}

/**
 * Submits a verification for a decision. Requires the active sharing consent, a completed household and at least
 * one piece of evidence (a document still on file, or a data connection whose report is ready). Sets the
 * application date (US Central, on the first submission only: APPLICATION_DATE_POLICY), stage "submitted", emits
 * `verification.submitted` and queues "verification.decide" in the same transaction. Resubmitting after the family
 * was asked for more information is allowed; submitting twice in a row is a no-op.
 */
export async function submit(verificationId: string, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<FamilyVerificationView> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { verification: v, access } = await requireFamilyAccess(tx, verificationId, actor, { forUpdate: true });
    if (!householdCan(access.access, "add_documents")) throw forbidden();
    if (v.status === "pending" && (v.stage === "submitted" || v.stage === "processing")) return buildFamilyView(tx, v);
    assertFamilyEditable(v);
    await assertActiveConsent(v.id, "verification_share", tx);
    if (!v.householdCompletedAt || v.householdSize === null || !v.countyFips || v.custody === null) {
      throw invalid("Finish the household questions before submitting.", { fields: { household: "Not complete." }, reason: "household_incomplete" });
    }

    const [doc] = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.verificationId, v.id), isNull(schema.documents.removedAt)))
      .limit(1);
    const [rail] = doc ? [] : await tx.select({ id: schema.railConnections.id }).from(schema.railConnections).where(and(eq(schema.railConnections.verificationId, v.id), eq(schema.railConnections.status, "ready"))).limit(1);
    if (!doc && !rail) throw conflict("Add a document or connect an account before submitting.", { reason: "no_evidence" });

    const at = now();
    const applicationDate = v.applicationDate ?? centralDateString(at);
    const [updated] = await tx
      .update(schema.verifications)
      .set({ stage: "submitted", applicationDate, incomeYear: Number(applicationDate.slice(0, 4)) - 1, submittedAt: at, updatedAt: at })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    await recordVerificationEvent(tx, v.id, "submitted", { type: "family", id: actor.userId }, { applicationDate, resubmission: v.submittedAt !== null });
    await emitEvent({ orgId: v.orgId, type: "verification.submitted", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: v.mode }, tx);
    await audit({ actor: familyAuditActor(actor), orgId: v.orgId, action: "verification.submit", target: { type: "verification", id: v.id }, metadata: { applicationDate }, request: actor.request }, tx);
    await enqueue(VERIFICATION_DECIDE_JOB, { verificationId: v.id }, { dedupeKey: decideDedupeKey(v.id) }, tx);
    return buildFamilyView(tx, updated);
  });
}
