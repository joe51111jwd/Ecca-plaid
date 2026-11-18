import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { SANDBOX_SETTLE_JOB, settleSandboxPayment } from "./sandbox";

/**
 * Job handlers owned by this domain. Keys are job type names.
 *
 * The jobs this domain ENQUEUES for others — "donation.payment_updated" { paymentId } and
 * "invoice.payment_updated" { invoiceId } — are handled by the donations and billing domains.
 */
export const jobHandlers: JobHandlers = {
  /**
   * Completes a sandbox payment that was left "processing" by one of the asynchronous test numbers:
   *   enqueue("payments.sandbox_settle", { paymentId, attemptId, outcome, chargedAt }, { runAt })
   * Idempotent: a payment that has already settled, or that was canceled or retried meanwhile, is left alone.
   */
  [SANDBOX_SETTLE_JOB]: async (payload) => {
    await settleSandboxPayment(payload);
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [];
