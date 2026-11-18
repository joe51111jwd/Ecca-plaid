/**
 * Test-only fixtures for the verifications module. Every organization, person, email, address and document here
 * is SYNTHETIC.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { addMember, getOrCreateHouseholdForUser, upsertOwnerMember } from "@/server/households";
import { runDueJobs } from "@/server/jobs";
import { createSgo, systemActor } from "@/server/sgos";
import { createVerification, type CreateVerificationInput } from "./create";
import { completeHousehold, recordSharingConsent, startVerification } from "./family";
import type { FamilyActor } from "./internal";

export const TEST_NOW = "2026-11-18T16:00:00.000Z";

/**
 * drizzle-kit (loaded by the in-memory test database to create the schema) adds an enumerable
 * `Array.prototype.random`, and pdfjs refuses to read any PDF while Array.prototype has enumerable extras. Call
 * in a `beforeAll` after `useTestDb()` in tests that read PDFs. The same applies to the embedded dev database
 * (src/db/client.ts loads drizzle-kit/api to sync the schema); reported to the owners of that file.
 */
export function hideEnumerableArrayExtensions(): void {
  for (const key of Object.keys(Array.prototype)) Object.defineProperty(Array.prototype, key, { enumerable: false });
}

export interface TestSgo {
  orgId: string;
  ownerEmail: string;
  reviewerEmail: string;
}

/** An SGO with a profile, its owner and a reviewer. */
export async function makeTestSgo(name = "Synthetic Scholarship Fund", opts: { rawRetentionDays?: number; incomeCapPct?: number } = {}): Promise<TestSgo> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const ownerEmail = `owner-${slug}@example.org`;
  const reviewerEmail = `reviewer-${slug}@example.org`;
  const { org } = await createSgo({ name, ownerEmail }, systemActor("verifications test fixture"));
  const db = await getDb();
  const [reviewer] = await db.insert(schema.users).values({ id: newId("user"), email: reviewerEmail }).returning();
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId: org.id, userId: reviewer.id, role: "reviewer" });
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId: org.id, userId: (await userByEmail("nobody-viewer@example.org")).id, role: "viewer" });
  if (opts.rawRetentionDays !== undefined || opts.incomeCapPct !== undefined) {
    await db
      .update(schema.sgoProfiles)
      .set({ ...(opts.rawRetentionDays !== undefined ? { rawRetentionDays: opts.rawRetentionDays } : {}), ...(opts.incomeCapPct !== undefined ? { incomeCapPct: opts.incomeCapPct } : {}) })
      .where(eq(schema.sgoProfiles.orgId, org.id));
  }
  return { orgId: org.id, ownerEmail, reviewerEmail };
}

export async function userByEmail(email: string, locale: "en" | "es" = "en"): Promise<typeof schema.users.$inferSelect> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return existing;
  const [u] = await db.insert(schema.users).values({ id: newId("user"), email, locale }).returning();
  return u;
}

export interface TestFamily {
  userId: string;
  email: string;
  actor: FamilyActor;
  householdId: string;
  ownerMemberId: string;
  studentId: string;
  otherMemberIds: string[];
}

/**
 * A household owned by `email` in Harris County (48201), with the owner "Dana Sample" and the student
 * "Riley Sample". `extraAdults` adds more adults. The county is written directly (no geocoder in tests).
 */
export async function makeTestFamily(email = "dana@example.com", opts: { extraAdults?: Array<{ firstName: string; lastName: string }>; locale?: "en" | "es"; countyFips?: string; countyName?: string } = {}): Promise<TestFamily> {
  const user = await userByEmail(email, opts.locale ?? "en");
  const actor: FamilyActor = { userId: user.id, request: { ip: "203.0.113.7", userAgent: "vitest" } };
  const { household } = await getOrCreateHouseholdForUser(user.id, { locale: opts.locale ?? "en" });
  const db = await getDb();
  await db
    .update(schema.households)
    .set({ addressLine1: "100 FIXTURE LANE", city: "HOUSTON", state: "TX", zip: "77002", countyFips: opts.countyFips ?? "48201", countyName: opts.countyName ?? "Harris County", countyResolution: "geocoder" })
    .where(eq(schema.households.id, household.id));
  const owner = await upsertOwnerMember(household.id, { firstName: "Dana", lastName: "Sample", relationship: "parent" }, actor);
  const student = await addMember(household.id, { kind: "student", firstName: "Riley", lastName: "Sample", relationship: "self" }, actor);
  const others: string[] = [];
  for (const a of opts.extraAdults ?? []) others.push((await addMember(household.id, { kind: "adult", firstName: a.firstName, lastName: a.lastName, relationship: "parent" }, actor)).id);
  return { userId: user.id, email, actor, householdId: household.id, ownerMemberId: owner.id, studentId: student.id, otherMemberIds: others };
}

export function baseCreate(orgId: string, overrides: Partial<CreateVerificationInput> = {}): CreateVerificationInput {
  return { orgId, mode: "test", applicantEmail: "dana@example.com", externalRef: "SYN-APP-1", createdBy: { type: "api_key", id: "key_SYNTHETIC0000000000000" }, ...overrides };
}

/** Creates a verification and walks the family through start, consent and household (single-household custody). */
export async function startedVerification(sgo: TestSgo, family: TestFamily, overrides: Partial<CreateVerificationInput> = {}) {
  const created = await createVerification(baseCreate(sgo.orgId, overrides));
  await startVerification(created.familyToken, family.userId);
  await recordSharingConsent(created.verification.id, family.actor, { locale: "en" });
  await completeHousehold(created.verification.id, family.actor, { custody: { livesInMultipleHouseholds: false } });
  return created;
}

/** Runs queued jobs until none is due, advancing the clock past waits. Returns how many ran. */
export async function drainJobs(opts: { maxRounds?: number; stepMs?: number } = {}): Promise<number> {
  let total = 0;
  let clock = Date.parse(TEST_NOW);
  for (let round = 0; round < (opts.maxRounds ?? 40); round++) {
    const { ran } = await runDueJobs({ limit: 50 });
    total += ran;
    if (ran === 0) {
      const db = await getDb();
      const queued = await db.select({ runAt: schema.jobs.runAt }).from(schema.jobs).where(eq(schema.jobs.status, "queued"));
      if (queued.length === 0) break;
      clock = Math.max(clock, ...queued.map((q) => q.runAt.getTime())) + 1;
      setTestNow(new Date(clock));
    }
  }
  return total;
}

/** The AppError code (and details) a promise rejects with, or "ok". */
export async function errorOf(p: Promise<unknown> | (() => unknown)): Promise<{ code: string; details?: unknown; message?: string }> {
  try {
    await (typeof p === "function" ? p() : p);
    return { code: "ok" };
  } catch (e) {
    const err = e as { code?: unknown; details?: unknown; message?: string };
    if (typeof err.code === "string") return { code: err.code, details: err.details, message: err.message };
    throw e;
  }
}
