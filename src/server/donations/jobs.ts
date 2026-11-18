import { ACKNOWLEDGMENT_ANNUAL_JOB, acknowledgmentsPolicy, handleAcknowledgmentAnnual } from "@/server/acknowledgments";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { DONATION_PAYMENT_UPDATED_JOB, handleDonationPaymentUpdated } from "./payment-updated";

/**
 * Job handlers owned by this domain. Keys are job type names. The acknowledgments service is part of Piece 1 and
 * has no registry entry of its own (src/server/jobs/registry.ts lists domains), so its handler is registered here.
 */
export const jobHandlers: JobHandlers = {
  /** Enqueued by the payments service after every change to a donation payment. Payload `{ paymentId }`. */
  [DONATION_PAYMENT_UPDATED_JOB]: handleDonationPaymentUpdated,
  /** Daily: prior-year acknowledgments, SGO worklists and the January 31 / February 28 reminders. */
  [ACKNOWLEDGMENT_ANNUAL_JOB]: handleAcknowledgmentAnnual,
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [{ type: ACKNOWLEDGMENT_ANNUAL_JOB, everyMs: acknowledgmentsPolicy.ANNUAL_JOB_EVERY_MS }];
