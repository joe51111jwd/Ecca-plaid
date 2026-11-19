import { AppError } from "@/lib/errors";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { applyVerificationOutcome, expireDueHolds, syncDueProgress } from "./lifecycle";
import { EXPIRE_HOLDS_EVERY_MS, SYNC_PROGRESS_EVERY_MS } from "./policy";

export const HANDOFF_VERIFICATION_UPDATED = "handoff.verification_updated";
export const HANDOFF_EXPIRE_HOLDS = "handoff.expire_holds";
export const HANDOFF_SYNC_PROGRESS = "handoff.sync_progress";

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /** Queued by the verifications service after a decision: { handoffId, verificationId }. Idempotent. */
  [HANDOFF_VERIFICATION_UPDATED]: async (payload) => {
    const { handoffId, verificationId } = payload;
    if (typeof handoffId !== "string" || handoffId.length === 0 || typeof verificationId !== "string" || verificationId.length === 0) {
      throw new AppError("internal", `${HANDOFF_VERIFICATION_UPDATED} needs string handoffId and verificationId`);
    }
    await applyVerificationOutcome({ handoffId, verificationId });
  },
  [HANDOFF_EXPIRE_HOLDS]: async () => {
    await expireDueHolds();
  },
  [HANDOFF_SYNC_PROGRESS]: async () => {
    await syncDueProgress();
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [
  { type: HANDOFF_EXPIRE_HOLDS, everyMs: EXPIRE_HOLDS_EVERY_MS },
  { type: HANDOFF_SYNC_PROGRESS, everyMs: SYNC_PROGRESS_EVERY_MS },
];
