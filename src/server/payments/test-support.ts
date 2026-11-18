import { getDb, schema } from "@/db/client";
import type { CheckoutStatus, Mode } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { newId, newToken } from "@/lib/ids";
import { runDueJobs } from "@/server/jobs";
import type { JobHandlers } from "@/server/jobs/types";
import { jobHandlers } from "./jobs";

/** Helpers shared by the payments tests. Everything they create is synthetic. Not imported by application code. */

export async function createTestSgo(options: { name?: string; paymentsAccountId?: string | null } = {}): Promise<string> {
  const db = await getDb();
  const id = newId("org");
  const name = options.name ?? "Synthetic Scholarship Fund";
  await db.insert(schema.organizations).values({ id, type: "sgo", name, slug: `synthetic-sgo-${id.toLowerCase()}` });
  await db.insert(schema.sgoProfiles).values({ orgId: id, displayName: name, paymentsAccountId: options.paymentsAccountId ?? null });
  return id;
}

export async function createTestBusiness(options: { name?: string; billingEmail?: string | null; paymentsCustomerId?: string | null } = {}): Promise<string> {
  const db = await getDb();
  const id = newId("org");
  const name = options.name ?? "Synthetic Summer Camp";
  await db.insert(schema.organizations).values({ id, type: "business", name, slug: `synthetic-camp-${id.toLowerCase()}` });
  await db.insert(schema.businessProfiles).values({
    orgId: id,
    displayName: name,
    billingEmail: options.billingEmail === undefined ? "billing@synthetic-camp.example" : options.billingEmail,
    paymentsCustomerId: options.paymentsCustomerId ?? null,
    publishableKey: `pk_synthetic_${newToken(6)}`,
  });
  return id;
}

export async function createTestCheckout(orgId: string, options: { mode?: Mode; status?: CheckoutStatus } = {}): Promise<string> {
  const db = await getDb();
  const id = newId("checkout");
  await db.insert(schema.checkoutSessions).values({ id, orgId, mode: options.mode ?? "test", status: options.status ?? "open", tokenHash: hashToken(newToken()) });
  return id;
}

/** Job payloads recorded by `recordingHandlers`, by job type. */
export type RecordedJobs = Record<string, Array<Record<string, unknown>>>;

/**
 * This domain's own handlers plus recorders for the two jobs it hands to other domains, so a test can run
 * the queue and see exactly what the donations and billing domains would have been told.
 */
export function recordingHandlers(): { handlers: JobHandlers; recorded: RecordedJobs } {
  const recorded: RecordedJobs = { "donation.payment_updated": [], "invoice.payment_updated": [], "email.send": [] };
  const handlers: JobHandlers = { ...jobHandlers };
  for (const type of Object.keys(recorded)) {
    handlers[type] = async (payload) => {
      recorded[type].push(payload);
    };
  }
  return { handlers, recorded };
}

/** Runs every job that is due at the current (test) time. */
export async function runQueue(handlers: JobHandlers): Promise<void> {
  for (;;) {
    const result = await runDueJobs({ handlers, limit: 50 });
    if (result.ran === 0) return;
  }
}
