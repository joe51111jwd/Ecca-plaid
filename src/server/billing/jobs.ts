import { MS } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { applyInvoicePaymentUpdate, generateMonthlyInvoices } from "./invoicing";

/** Recurring job that bills the previous months' success fees. */
export const INVOICE_GENERATE_JOB = "invoice.generate";
/**
 * The scheduler only knows fixed intervals, so the job runs daily and bills fees accrued before the current
 * calendar month: the first run of each month produces that month's invoices, later runs only retry unsent drafts.
 */
export const INVOICE_GENERATE_EVERY_MS = MS.day;

/** Job handlers owned by this domain. Keys are job type names. */
export const jobHandlers: JobHandlers = {
  /** Enqueued by the payments service after every change to a business invoice's payment state. */
  "invoice.payment_updated": async (payload) => {
    const invoiceId = payload.invoiceId;
    if (typeof invoiceId !== "string" || invoiceId.length === 0) throw new AppError("internal", "invoice.payment_updated needs a string invoiceId");
    await applyInvoicePaymentUpdate(invoiceId);
  },
  [INVOICE_GENERATE_JOB]: async () => {
    const result = await generateMonthlyInvoices();
    // A business without a billing email must not make the whole run fail and retry for everyone; its draft is
    // retried by the next run. The failures are logged for the operators.
    for (const f of result.failures) console.error(`[billing] invoicing failed for business ${f.businessOrgId} (${f.mode})${f.invoiceId ? ` invoice ${f.invoiceId}` : ""}: ${f.message}`);
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [{ type: INVOICE_GENERATE_JOB, everyMs: INVOICE_GENERATE_EVERY_MS }];
