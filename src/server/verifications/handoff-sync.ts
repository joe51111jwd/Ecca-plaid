import type { DbOrTx } from "@/db/client";
import { enqueue } from "@/server/jobs";

/** Job owned by the handoffs domain: re-reads the linked verification and moves the camp's handoff along. */
export const HANDOFF_VERIFICATION_UPDATED_JOB = "handoff.verification_updated";

/**
 * Tells a linked camp handoff that the family made progress (submitted, or the case went to a person), so the camp
 * portal shows "Spot held" at once instead of waiting for the recurring progress sync. Call inside the transaction
 * that changes the verification. One queued job per verification is enough: the job reads the current state when
 * it runs, so a second call while one is still queued is a no-op. Decisions queue their own job (evidence.ts).
 */
export async function notifyHandoffOfProgress(tx: DbOrTx, verification: { id: string; handoffId: string | null }): Promise<void> {
  if (!verification.handoffId) return;
  await enqueue(HANDOFF_VERIFICATION_UPDATED_JOB, { handoffId: verification.handoffId, verificationId: verification.id }, { dedupeKey: `${HANDOFF_VERIFICATION_UPDATED_JOB}:${verification.id}:progress` }, tx);
}
