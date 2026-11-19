/**
 * Test-only fixtures for the handoffs, awards and billing modules. Every organization, person, email address,
 * booking and amount here is SYNTHETIC. Not imported by application code.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { MemberRole, Mode, VerificationStatus } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { newId, newToken } from "@/lib/ids";
import { businessSystemActor, createBusiness, requestPartnership, respondToPartnership, setSuccessFee, updateBusinessProfile } from "@/server/businesses";
import { createSgo, systemActor, updateSgoProfile } from "@/server/sgos";
import type { HandoffSource } from "./create";

export const SYNTHETIC_ORIGIN = "https://camp.synthetic-example.org";

let counter = 0;
function unique(): string {
  counter += 1;
  return `${counter}-${newToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export async function makeUser(email?: string): Promise<string> {
  const db = await getDb();
  const [u] = await db.insert(schema.users).values({ id: newId("user"), email: email ?? `synthetic-${unique()}@example.org` }).returning();
  return u.id;
}

export async function addMember(orgId: string, userId: string, role: MemberRole): Promise<void> {
  const db = await getDb();
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId, role });
}

/** A synthetic SGO that accepts handoffs (unless told otherwise). */
export async function makeSgo(name = "Synthetic Scholarship Fund", opts: { acceptsHandoffs?: boolean } = {}): Promise<string> {
  const { org } = await createSgo({ name: `${name} ${unique()}`, ownerEmail: `sgo-owner-${unique()}@example.org` }, systemActor("handoffs test fixture"));
  if (opts.acceptsHandoffs !== false) await updateSgoProfile(org.id, { acceptsHandoffs: true, displayName: name }, systemActor("handoffs test fixture"));
  return org.id;
}

export interface TestBusinessOptions {
  name?: string;
  allowedOrigins?: string[];
  holdWindowHours?: number;
  fee?: { flatCents: number; bps: number };
  vendorType?: "summer_camp" | "private_school" | "microschool" | "tutoring" | "after_school" | "other";
}

/** A synthetic camp with an allowed origin, a 72-hour hold and (by default) no fee. */
export async function makeBusiness(opts: TestBusinessOptions = {}): Promise<{ orgId: string; publishableKey: string }> {
  const actor = businessSystemActor("handoffs test fixture");
  const { org } = await createBusiness(
    { name: opts.name ?? `Synthetic Summer Camp ${unique()}`, vendorType: opts.vendorType ?? "summer_camp", billingEmail: `billing-${unique()}@synthetic-camp.example`, ownerEmail: `camp-owner-${unique()}@example.org` },
    actor,
  );
  const profile = await updateBusinessProfile(org.id, { allowedOrigins: opts.allowedOrigins ?? [SYNTHETIC_ORIGIN], holdWindowHours: opts.holdWindowHours ?? 72, ...(opts.name ? { displayName: opts.name } : {}) }, actor);
  if (opts.fee) await setSuccessFee(org.id, opts.fee, actor);
  return { orgId: org.id, publishableKey: profile.publishableKey };
}

export async function partner(businessOrgId: string, sgoOrgId: string): Promise<void> {
  const p = await requestPartnership({ businessOrgId, sgoOrgId }, businessSystemActor("handoffs test fixture"));
  await respondToPartnership(sgoOrgId, p.id, "active", businessSystemActor("handoffs test fixture"));
}

/** A secret API key row for an organization (the raw key is irrelevant here: services receive the authenticated id). */
export async function makeApiKey(orgId: string, mode: Mode = "test"): Promise<string> {
  const db = await getDb();
  const id = newId("apiKey");
  await db.insert(schema.apiKeys).values({ id, orgId, name: "synthetic", prefix: `ecca_${mode}_syn`, keyHash: hashToken(newToken()), mode });
  return id;
}

export async function apiSource(businessOrgId: string, mode: Mode = "test"): Promise<Extract<HandoffSource, { kind: "api" }>> {
  return { kind: "api", businessOrgId, mode, apiKeyId: await makeApiKey(businessOrgId, mode) };
}

export function embedSource(publishableKey: string, opts: { origin?: string | null; ip?: string } = {}): Extract<HandoffSource, { kind: "embed" }> {
  return { kind: "embed", publishableKey, origin: opts.origin === undefined ? SYNTHETIC_ORIGIN : opts.origin, ip: opts.ip ?? "203.0.113.7", userAgent: "synthetic-test-agent" };
}

/**
 * Synthetic shortcut: sets a verification's status / progress directly, standing in for the family flow and the
 * decision engine (tested in src/server/verifications). Only the fields the handoff mapping reads are touched.
 */
export async function setVerificationState(
  verificationId: string,
  state: { status?: VerificationStatus; started?: boolean; submitted?: boolean; expiresAt?: Date | null; householdId?: string | null; studentMemberIds?: string[] },
): Promise<void> {
  const db = await getDb();
  const at = new Date("2026-11-18T00:00:00.000Z");
  await db
    .update(schema.verifications)
    .set({
      ...(state.status ? { status: state.status } : {}),
      ...(state.started ? { startedAt: at, stage: "started" as const } : {}),
      ...(state.submitted ? { submittedAt: at, stage: "submitted" as const } : {}),
      ...(state.status === "eligible" || state.status === "ineligible" ? { stage: "decided" as const, decidedAt: at } : {}),
      ...(state.expiresAt !== undefined ? { expiresAt: state.expiresAt } : {}),
      ...(state.householdId !== undefined ? { householdId: state.householdId } : {}),
      ...(state.studentMemberIds !== undefined ? { studentMemberIds: state.studentMemberIds } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.verifications.id, verificationId));
}

/** Synthetic household with one student member, for award tests. */
export async function makeHousehold(): Promise<{ householdId: string; studentId: string; otherHouseholdStudentId: string }> {
  const db = await getDb();
  const owner = await makeUser();
  const householdId = newId("household");
  await db.insert(schema.households).values({ id: householdId, ownerUserId: owner });
  const studentId = newId("member");
  await db.insert(schema.householdMembers).values({ id: studentId, householdId, kind: "student", firstName: "Riley", lastName: "Synthetic" });
  const otherHousehold = newId("household");
  await db.insert(schema.households).values({ id: otherHousehold, ownerUserId: owner });
  const otherHouseholdStudentId = newId("member");
  await db.insert(schema.householdMembers).values({ id: otherHouseholdStudentId, householdId: otherHousehold, kind: "student", firstName: "Sam", lastName: "Synthetic" });
  return { householdId, studentId, otherHouseholdStudentId };
}

export async function eventsOf(orgId: string, type?: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.events).where(eq(schema.events.orgId, orgId));
  return rows.filter((e) => type === undefined || e.type === type).sort((a, b) => (a.id < b.id ? -1 : 1));
}
