import { z } from "zod";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { attemptDelivery, RETRY_SWEEP_EVERY_MS, sweepDueDeliveries, WEBHOOK_DELIVER_JOB, WEBHOOK_RETRY_JOB } from "./deliver";

const deliverPayload = z.object({ deliveryId: z.string().min(1), attempt: z.number().int().min(1) });

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /**
   * One delivery attempt. A receiver that fails or times out does not fail the job: the attempt is
   * recorded and the next one scheduled. The job itself only fails (and is retried by the queue) when
   * our own side breaks, e.g. the database is unreachable.
   */
  [WEBHOOK_DELIVER_JOB]: async (payload) => {
    const { deliveryId, attempt } = deliverPayload.parse(payload);
    await attemptDelivery(deliveryId, attempt);
  },
  /** Safety net: puts due deliveries that lost their job back in the queue. */
  [WEBHOOK_RETRY_JOB]: async () => {
    await sweepDueDeliveries();
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [{ type: WEBHOOK_RETRY_JOB, everyMs: RETRY_SWEEP_EVERY_MS }];
