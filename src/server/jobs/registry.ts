import type { JobHandlers, RecurringJob } from "./types";
import * as billing from "@/server/billing/jobs";
import * as donations from "@/server/donations/jobs";
import * as email from "@/server/email/jobs";
import * as handoffs from "@/server/handoffs/jobs";
import * as maintenance from "@/server/maintenance/jobs";
import * as payments from "@/server/payments/jobs";
import * as rails from "@/server/rails/jobs";
import * as storage from "@/server/storage/jobs";
import * as verifications from "@/server/verifications/jobs";
import * as webhooks from "@/server/webhooks/jobs";

/**
 * All job handlers in the app. Each domain owns its `jobs.ts`; add handlers there, not here.
 * (This file changes only when a new domain is added.)
 */
const domains = [billing, donations, email, handoffs, maintenance, payments, rails, storage, verifications, webhooks];

export function allJobHandlers(): JobHandlers {
  const out: JobHandlers = {};
  for (const d of domains) {
    for (const [type, handler] of Object.entries(d.jobHandlers)) {
      if (out[type]) throw new Error(`Duplicate job handler for "${type}"`);
      out[type] = handler;
    }
  }
  return out;
}

export function allRecurringJobs(): RecurringJob[] {
  return domains.flatMap((d) => d.recurringJobs);
}
