import { z } from "zod";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { deliverEmail } from "./index";

const sendPayload = z.object({
  emailId: z.string().min(1),
  /** Set for messages that carry a sign-in credential (see SendEmailInput.sensitive). */
  redactAfterSend: z.boolean().optional(),
});

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /**
   * Delivers a message recorded with queueEmail(), or retries one whose delivery failed:
   *   enqueue("email.send", { emailId }, { dedupeKey: `email:${emailId}` })
   * Idempotent: a message that was already sent is skipped. A provider failure throws, so the queue retries
   * with backoff; the reason is kept on the `emails` row.
   */
  "email.send": async (payload) => {
    const { emailId, redactAfterSend } = sendPayload.parse(payload);
    await deliverEmail(emailId, { redactAfterSend });
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [];
