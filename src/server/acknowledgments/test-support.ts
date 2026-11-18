import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Mode } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createSgo, setIrsPortalRegistered, systemActor } from "@/server/sgos";

/**
 * Helpers for the acknowledgments tests. Every organization, person, address, EIN and donor number they create is
 * SYNTHETIC test data (EINs use the 00- prefix the IRS does not assign; live-looking donor numbers are labeled
 * SYN). Gifts are written straight into the ledger as the donations service would leave them after the charge, so
 * live-mode records can be tested without a live processor. Not imported by application code.
 */

export const SYS = systemActor("acknowledgments-test");

export interface TestSgo {
  orgId: string;
  ein: string | null;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
}

function syntheticEin(): string {
  return `00-${Array.from({ length: 7 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

export async function createTestSgo(options: { name?: string; ein?: string | null; portalRegistered?: boolean } = {}): Promise<TestSgo> {
  const name = options.name ?? `Synthetic Scholarship Fund ${newId("org").slice(-5)}`;
  const ein = options.ein === undefined ? syntheticEin() : options.ein;
  const ownerEmail = `owner-${newId("user").slice(-8).toLowerCase()}@synthetic.example`;
  const { org } = await createSgo({ name, ein, city: "Austin", state: "TX", ownerEmail }, SYS);
  if (options.portalRegistered) await setIrsPortalRegistered(org.id, true, SYS);
  const db = await getDb();
  const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, org.id));
  return { orgId: org.id, ein, name, ownerUserId: m.userId, ownerEmail };
}

/** A user with the given role in the SGO. */
export async function createStaff(orgId: string, role: "owner" | "admin" | "reviewer" | "viewer"): Promise<string> {
  const db = await getDb();
  const id = newId("user");
  await db.insert(schema.users).values({ id, email: `${role}-${id.slice(-6).toLowerCase()}@synthetic.example` });
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId: id, role });
  return id;
}

export interface DonorOverrides {
  firstName?: string;
  lastName?: string;
  email?: string;
  userId?: string | null;
  addressLine1?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export async function insertDonor(o: DonorOverrides = {}): Promise<string> {
  const db = await getDb();
  const id = newId("donor");
  await db.insert(schema.donors).values({
    id,
    userId: o.userId ?? null,
    email: o.email ?? `donor-${id.slice(-6).toLowerCase()}@synthetic.example`,
    firstName: o.firstName ?? "Avery",
    lastName: o.lastName ?? "Synthetic",
    addressLine1: o.addressLine1 ?? "100 Synthetic Way",
    city: o.city ?? "Austin",
    state: o.state ?? "TX",
    zip: o.zip ?? "78701",
  });
  return id;
}

export interface GiftInput {
  orgId: string;
  donorId: string;
  mode?: Mode;
  designatedCents?: number;
  nonDesignatedCents?: number;
  status?: "succeeded" | "refunded" | "pending" | "failed";
  contributedAt?: Date;
  taxYear?: number;
  goods?: { valueCents: number; description: string | null };
}

/** One designated gift as the donations service records it once the charge is made. */
export async function insertGift(g: GiftInput): Promise<string> {
  const db = await getDb();
  const mode = g.mode ?? "test";
  const checkoutId = newId("checkout");
  const contributedAt = g.contributedAt ?? new Date("2027-03-10T16:00:00.000Z");
  await db.insert(schema.checkoutSessions).values({ id: checkoutId, orgId: g.orgId, mode, status: "completed", tokenHash: `synthetic-${checkoutId}`, expiresAt: new Date("2030-01-01T00:00:00Z") });
  const id = newId("donation");
  await db.insert(schema.donations).values({
    id,
    orgId: g.orgId,
    mode,
    checkoutSessionId: checkoutId,
    donorId: g.donorId,
    filingStatus: "single",
    designatedAmountCents: g.designatedCents ?? 170_000,
    nonDesignatedAmountCents: g.nonDesignatedCents ?? 0,
    designated25f: true,
    designatedAt: contributedAt,
    designationCopyVersion: "synthetic",
    designationCopyId: "designation.statement",
    designationText: "Synthetic designation text.",
    designationTemplateSha256: "0".repeat(64),
    designationTextSha256: "0".repeat(64),
    noEarmarkConfirmed: true,
    individualConfirmed: true,
    usCitizenOrResidentConfirmed: true,
    notInExchangeConfirmed: true,
    stateAllocation: "TX",
    donorTimeZone: "America/Chicago",
    status: g.status ?? "succeeded",
    contributedAt: g.status === "pending" || g.status === "failed" ? null : contributedAt,
    taxYear: g.status === "pending" || g.status === "failed" ? null : (g.taxYear ?? 2027),
    goodsOrServicesProvided: g.goods !== undefined,
    goodsOrServicesValueCents: g.goods?.valueCents ?? 0,
    goodsOrServicesDescription: g.goods?.description ?? null,
    refundedAt: g.status === "refunded" ? contributedAt : null,
  });
  return id;
}

/** An active e-delivery consent of the donor with the SGO (synthetic words). */
export async function insertConsent(orgId: string, donorId: string, email: string, mode: Mode = "test", grantedAt = new Date("2027-03-10T16:00:00.000Z")): Promise<string> {
  const db = await getDb();
  const id = newId("consent");
  await db.insert(schema.donorDeliveryConsents).values({ id, donorId, orgId, mode, email, copyId: "consent.e_delivery", copyVersion: "synthetic", templateSha256: "0".repeat(64), textSha256: "0".repeat(64), text: "Synthetic consent text.", grantedAt });
  return id;
}

/**
 * drizzle-kit (loaded by the in-memory test database) adds an enumerable Array.prototype.random, and pdf.js refuses
 * to parse while Array.prototype has enumerable extras. Call in a beforeAll after useTestDb() in tests reading PDFs.
 */
export function hideEnumerableArrayExtensions(): void {
  for (const key of Object.keys(Array.prototype)) Object.defineProperty(Array.prototype, key, { enumerable: false });
}
