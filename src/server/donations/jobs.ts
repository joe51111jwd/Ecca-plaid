import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { DONATION_PAYMENT_UPDATED_JOB, handleDonationPaymentUpdated } from "./payment-updated";

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /** Enqueued by the payments service after every change to a donation payment. Payload `{ paymentId }`. */
  [DONATION_PAYMENT_UPDATED_JOB]: handleDonationPaymentUpdated,
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [];
