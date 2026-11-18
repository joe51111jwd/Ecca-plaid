/** Contracts for the background job queue (implementation: src/server/jobs/index.ts). */

export interface JobContext {
  jobId: string;
  /** 1-based attempt number. */
  attempt: number;
}

/** Throw to fail the attempt (it is retried with backoff until maxAttempts). Handlers must be idempotent. */
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

export interface EnqueueOptions {
  runAt?: Date;
  /** At most one queued/running job with this key; enqueueing again is a no-op. */
  dedupeKey?: string;
  maxAttempts?: number;
}

/** Work that should run on a schedule; the runner enqueues one job per period (deduped by type + period). */
export interface RecurringJob {
  type: string;
  everyMs: number;
  payload?: Record<string, unknown>;
}
