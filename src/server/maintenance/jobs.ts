import { MS } from "@/lib/clock";
// Imported from the file, not the domain index: the index pulls in the whole public API and its dependencies.
import { purgeExpiredIdempotencyKeys } from "@/server/api/idempotency";
import { purgeEndedSessions, purgeExpiredMagicLinks } from "@/server/auth";
import { purgeOldEmailBodies } from "@/server/email";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { purgeExpiredRateLimits } from "@/server/ratelimit";

/**
 * Housekeeping for rows that hold no documents but should not pile up: ended sessions, used or expired sign-in
 * links, old API idempotency keys, spent rate-limit counters and the bodies of old emails. Each domain owns its
 * own rule and purge function; this job only calls them on a schedule. Raw uploads have their own job
 * ("retention.purge" in src/server/verifications), and succeeded jobs are removed by the job runner itself.
 */
export const MAINTENANCE_CLEANUP_JOB = "maintenance.cleanup";

export interface CleanupResult {
  sessions: number;
  magicLinks: number;
  idempotencyKeys: number;
  rateLimits: number;
  emailBodies: number;
}

/** Runs every purge once. Safe to run at any time and from several workers: each step is a single delete or update. */
export async function runCleanup(): Promise<CleanupResult> {
  return {
    sessions: await purgeEndedSessions(),
    magicLinks: await purgeExpiredMagicLinks(),
    idempotencyKeys: await purgeExpiredIdempotencyKeys(),
    rateLimits: await purgeExpiredRateLimits(),
    emailBodies: await purgeOldEmailBodies(),
  };
}

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  [MAINTENANCE_CLEANUP_JOB]: async () => {
    const result = await runCleanup();
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    if (total > 0) console.info(`[maintenance] cleanup removed ${JSON.stringify(result)}`);
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [{ type: MAINTENANCE_CLEANUP_JOB, everyMs: MS.hour }];
