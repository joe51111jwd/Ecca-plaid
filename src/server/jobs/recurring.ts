import { now } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { enqueueOnce, RECURRING_KEY_PREFIX } from "./index";
import type { RecurringJob } from "./types";

/** Shortest period a recurring job may declare. Anything shorter than a scheduler pass is meaningless. */
export const MIN_RECURRING_INTERVAL_MS = 1000;

export interface ScheduleResult {
  /** Jobs created by this call. */
  scheduled: number;
  /** Definitions whose job for the current period already existed. */
  alreadyScheduled: number;
  /** Types skipped because their definition is unusable (also logged). */
  invalid: string[];
}

/** Periods are counted from the Unix epoch, so every instance agrees on the index without coordination. */
export function recurringPeriodIndex(everyMs: number, at: Date): number {
  return Math.floor(at.getTime() / everyMs);
}

export function recurringDedupeKey(type: string, everyMs: number, at: Date): string {
  return `${RECURRING_KEY_PREFIX}${type}:${recurringPeriodIndex(everyMs, at)}`;
}

function isUsable(job: RecurringJob): boolean {
  return typeof job.type === "string" && job.type.length > 0 && Number.isFinite(job.everyMs) && job.everyMs >= MIN_RECURRING_INTERVAL_MS;
}

/**
 * Makes sure every recurring job has its job for the current period. Safe to call from any number of
 * web instances and workers at any frequency: the period's dedupe key admits one job, whatever its
 * status, so a period is never scheduled twice. The job is due immediately, i.e. it runs at the first
 * scheduler pass of each period.
 */
export async function scheduleRecurring(opts: { recurring?: RecurringJob[] } = {}): Promise<ScheduleResult> {
  const recurring = opts.recurring ?? (await import("./registry")).allRecurringJobs();
  const at = now();
  const result: ScheduleResult = { scheduled: 0, alreadyScheduled: 0, invalid: [] };
  for (const job of recurring) {
    // One bad definition must not stop the others from being scheduled.
    if (!isUsable(job)) {
      result.invalid.push(String(job.type));
      console.error(`[jobs] recurring job "${String(job.type)}" is ignored: everyMs must be a number of at least ${MIN_RECURRING_INTERVAL_MS} ms`);
      continue;
    }
    try {
      const res = await enqueueOnce(job.type, job.payload ?? {}, { dedupeKey: recurringDedupeKey(job.type, job.everyMs, at), runAt: at });
      if (res.enqueued) result.scheduled++;
      else result.alreadyScheduled++;
    } catch (e) {
      // A definition the queue rejects (bad type name, unserializable payload) is skipped like any other
      // unusable one; database trouble is the caller's to see.
      if (!isAppError(e) || e.code !== "validation_failed") throw e;
      result.invalid.push(job.type);
      console.error(`[jobs] recurring job "${job.type}" is ignored: ${e.message}`);
    }
  }
  return result;
}
