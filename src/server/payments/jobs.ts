import type { JobHandlers, RecurringJob } from "@/server/jobs/types";

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [];
