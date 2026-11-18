import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { allJobHandlers } from "@/server/jobs/registry";
import { runDueJobs } from "@/server/jobs";
import { confirmSandboxPayment, type ClientPayment } from "@/server/payments";
import { createSgo, importSgoList, linkProfileToListEntry, setIrsPortalRegistered, systemActor } from "@/server/sgos";
import type { CheckoutPatch } from "./form";

/**
 * Helpers for the donations tests. Every organization, person, address and EIN they create is SYNTHETIC test data
 * (EINs use the 00- prefix the IRS does not assign). Not imported by application code.
 */

const SYS = systemActor("donations-test");
const LIST_HEADER = "state,name,ein,status,listed_from,removed_on";

export interface ListedSgo {
  orgId: string;
  slug: string;
  ein: string;
  entryId: string;
  name: string;
}

function syntheticEin(): string {
  const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10)).join("");
  return `00-${digits}`;
}

/** A synthetic Texas SGO on the provisional list, linked by a (system) platform admin, optionally portal-registered. */
export async function createListedSgo(options: { name?: string; portalRegistered?: boolean; listedFrom?: string | null; retrievedAt?: Date } = {}): Promise<ListedSgo> {
  const name = options.name ?? `Synthetic Scholarship Fund ${newId("org").slice(-5)}`;
  const ein = syntheticEin();
  const { org } = await createSgo({ name, ein, state: "TX", ownerEmail: `owner-${newId("user").slice(-8).toLowerCase()}@synthetic.example` }, SYS);
  const row = `TX,${name},${ein},listed,${options.listedFrom ?? ""},`;
  await importSgoList({ source: "provisional_curated", csv: [LIST_HEADER, row].join("\n"), retrievedAt: options.retrievedAt ?? new Date("2026-11-01T12:00:00Z") }, SYS);
  const db = await getDb();
  const [entry] = await db.select().from(schema.sgoListEntries).where(eq(schema.sgoListEntries.ein, ein));
  await linkProfileToListEntry(org.id, entry.id, SYS);
  if (options.portalRegistered) await setIrsPortalRegistered(org.id, true, SYS);
  return { orgId: org.id, slug: org.slug, ein, entryId: entry.id, name };
}

/** Removes the SGO from the provisional list from `removedOn` (YYYY-MM-DD). */
export async function removeFromList(sgo: ListedSgo, removedOn: string, listedFrom = ""): Promise<void> {
  const row = `TX,${sgo.name},${sgo.ein},removed,${listedFrom},${removedOn}`;
  await importSgoList({ source: "provisional_curated", csv: [LIST_HEADER, row].join("\n"), retrievedAt: new Date("2026-11-01T12:00:00Z") }, SYS);
}

/** A complete, valid single-filer form (synthetic person). */
export function singleFilerPatch(overrides: Partial<CheckoutPatch> = {}): CheckoutPatch {
  return {
    giftCents: 170_000,
    filingStatus: "single",
    email: "donor@synthetic.example",
    address: { line1: "100 Synthetic Way", city: "Austin", state: "TX", zip: "78701" },
    contributors: { primary: { firstName: "Avery", lastName: "Synthetic" } },
    attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true },
    donorTimeZone: "America/Chicago",
    ...overrides,
  };
}

/** A complete, valid joint-return form where both (synthetic) spouses give. */
export function jointPatch(overrides: Partial<CheckoutPatch> = {}): CheckoutPatch {
  return {
    giftCents: 340_000,
    filingStatus: "married_joint",
    email: "couple@synthetic.example",
    address: { line1: "200 Synthetic Lane", city: "Houston", state: "TX", zip: "77002" },
    contributors: { primary: { firstName: "Jordan", lastName: "Testperson" }, spouse: { firstName: "Riley", lastName: "Testperson", email: "riley@synthetic.example" } },
    attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true, jointOnBehalfOfBoth: true },
    donorTimeZone: "America/Chicago",
    ...overrides,
  };
}

/** Completes a sandbox payment with a test card (4242... succeeds, 4000000000000002 is declined). */
export async function paySandbox(payment: ClientPayment, cardNumber = "4242424242424242") {
  if (payment.provider !== "sandbox") throw new Error("Expected a sandbox payment");
  return confirmSandboxPayment({ paymentId: payment.paymentId, clientSecret: payment.clientSecret, cardNumber, expiry: "12/30", securityCode: "123" });
}

/** Runs every due job with the app's real handlers until the queue is empty. */
export async function drainJobs(): Promise<void> {
  const handlers = allJobHandlers();
  for (let i = 0; i < 20; i++) {
    const result = await runDueJobs({ handlers, limit: 50 });
    if (result.ran === 0) return;
  }
  throw new Error("The job queue did not drain");
}

/** A synthetic platform admin user. */
export async function createPlatformAdmin(): Promise<string> {
  const db = await getDb();
  const { ensurePlatformOrg } = await import("@/server/auth");
  const org = await ensurePlatformOrg(db);
  const id = newId("user");
  await db.insert(schema.users).values({ id, email: `admin-${id.slice(-6).toLowerCase()}@synthetic.example` });
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId: org.id, userId: id, role: "owner" });
  return id;
}
