import { z } from "zod";
import { invalid } from "@/lib/errors";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { RAIL_REVOKE_REMOTE_JOB, RAIL_SYNC_JOB, retryRemoteRevoke, syncConnection } from "./service";

const syncPayload = z.object({
  connectionId: z.string().min(1).max(128),
  poll: z.number().int().min(0).max(1000).default(0),
  trigger: z.enum(["inline", "poll", "fallback", "webhook", "job"]).default("job"),
});
const revokePayload = z.object({ connectionId: z.string().min(1).max(128) });

function parse<T>(schema: z.ZodType<T>, payload: Record<string, unknown>, type: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw invalid(`Invalid ${type} payload: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /** Fetch a connection's report and store it (idempotent; re-sync replaces the connection's income items). */
  [RAIL_SYNC_JOB]: async (payload) => {
    const p = parse(syncPayload, payload, RAIL_SYNC_JOB);
    await syncConnection(p.connectionId, { poll: p.poll, trigger: p.trigger });
  },
  /** Retry removing our access at the provider after a revocation; throws (and is retried) until it succeeds. */
  [RAIL_REVOKE_REMOTE_JOB]: async (payload) => {
    const p = parse(revokePayload, payload, RAIL_REVOKE_REMOTE_JOB);
    await retryRemoteRevoke(p.connectionId);
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [];
