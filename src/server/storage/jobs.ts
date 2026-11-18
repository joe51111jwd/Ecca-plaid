import { z } from "zod";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { purgeObject } from "./index";

const purgeObjectPayload = z.object({
  objectId: z.string().min(1),
  /** Why the bytes are being deleted, e.g. "retention", "user_request", "verification_canceled". */
  reason: z.string().trim().min(1).max(200),
});

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /**
   * Deletes one object's bytes (the index row and its hash stay). Lets any domain schedule a deletion:
   *   enqueue("storage.purge_object", { objectId, reason: "retention" }, { runAt, dedupeKey: `purge:${objectId}` })
   * Idempotent: purging an already purged object is a no-op, so retries are safe.
   */
  "storage.purge_object": async (payload) => {
    const { objectId, reason } = purgeObjectPayload.parse(payload);
    await purgeObject(objectId, reason);
  },
};

/** Scheduled work owned by this domain. (Retention schedules belong to the domains that own the documents.) */
export const recurringJobs: RecurringJob[] = [];
