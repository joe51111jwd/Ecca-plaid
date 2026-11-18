import { describe, expect, it } from "vitest";
import { DONATION_PAYMENT_UPDATED_JOB, INVOICE_PAYMENT_UPDATED_JOB } from "./events";
import { jobHandlers, recurringJobs } from "./jobs";

describe("payments job handlers", () => {
  it("handles only its own job: the two jobs it enqueues for other domains have their handlers there", () => {
    expect(Object.keys(jobHandlers)).toEqual(["payments.sandbox_settle"]);
    expect(DONATION_PAYMENT_UPDATED_JOB).toBe("donation.payment_updated");
    expect(INVOICE_PAYMENT_UPDATED_JOB).toBe("invoice.payment_updated");
    expect(jobHandlers).not.toHaveProperty(DONATION_PAYMENT_UPDATED_JOB);
    expect(jobHandlers).not.toHaveProperty(INVOICE_PAYMENT_UPDATED_JOB);
    expect(recurringJobs).toEqual([]);
  });

  it("rejects a malformed settle payload so the queue records the failure", async () => {
    await expect(jobHandlers["payments.sandbox_settle"]({ paymentId: "pay_x" }, { jobId: "job_x", attempt: 1 })).rejects.toThrow();
  });
});
