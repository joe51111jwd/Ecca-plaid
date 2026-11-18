/**
 * Test-only fixtures for the verifications module. Every organization, person, email, address and document here
 * is SYNTHETIC.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { generateSyntheticDocument } from "@/engine/documents/synthetic";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { addMember, getOrCreateHouseholdForUser, upsertOwnerMember } from "@/server/households";
import { runDueJobs } from "@/server/jobs";
import { createSgo, systemActor } from "@/server/sgos";
import { createVerification, type CreateVerificationInput } from "./create";
import { completeHousehold, recordSharingConsent, startVerification } from "./family";
import type { FamilyActor, OrgActor } from "./internal";

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

/** A signed-in staff member of the SGO with the given role, as the dashboard would pass it. */
export async function makeStaff(orgId: string, role: MemberRole, email: string, mode: "test" | "live" = "test"): Promise<OrgActor & { type: "user" }> {
  const user = await userByEmail(email);
  const db = await getDb();
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId: user.id, role });
  return { type: "user", id: user.id, mode, request: { ip: "198.51.100.9", userAgent: "vitest-staff" } };
}

/** The reviewer makeTestSgo created, as an OrgActor. */
export async function reviewerOf(sgo: TestSgo, mode: "test" | "live" = "test"): Promise<OrgActor & { type: "user" }> {
  const user = await userByEmail(sgo.reviewerEmail);
  return { type: "user", id: user.id, mode, request: { ip: "198.51.100.10", userAgent: "vitest-reviewer" } };
}

/** SYNTHETIC: a Form W-2 for a synthetic person (default the owner "Dana Sample"). */
export async function syntheticW2(opts: { box1Cents?: number; taxYear?: number; first?: string; last?: string; control?: string } = {}): Promise<Uint8Array> {
  const box1Cents = opts.box1Cents ?? 4_125_000;
  return generateSyntheticDocument("w2", {
    statements: [
      {
        taxYear: opts.taxYear ?? 2025,
        copy: "B",
        employeeSsn: "000-00-0001",
        employerEin: "00-0000001",
        employerName: "FIXTURE FOODS LLC",
        employerAddress: { street: "500 SAMPLE PARKWAY", cityStateZip: "HOUSTON TX 77002" },
        controlNumber: opts.control ?? "SYN-W2-0001",
        employeeFirst: opts.first ?? "DANA",
        employeeLast: opts.last ?? "SAMPLE",
        box1Cents,
        box2Cents: 210_000,
        box3Cents: Math.min(box1Cents, 17_610_000),
        box4Cents: Math.round(Math.min(box1Cents, 17_610_000) * 0.062),
        box5Cents: box1Cents,
        box6Cents: Math.round(box1Cents * 0.0145),
      },
    ],
  });
}

/** SYNTHETIC: a Texas HHSC SNAP approval notice naming the synthetic owner (its layout is unverified, so it goes to review). */
export async function syntheticSnapLetter(noticeDate = "2026-10-20"): Promise<Uint8Array> {
  return generateSyntheticDocument("tf0001", {
    noticeDate,
    caseNumber: "9990000001",
    addressee: "DANA SAMPLE",
    sections: [{ heading: "SNAP Food Benefits", tables: [{ status: "gets", subject: "SNAP food benefits", rows: [{ name: "DANA SAMPLE", edg: "990000011", program: "SNAP", start: noticeDate, end: "2027-03-31" }] }] }],
  });
}

/** A file from tests/fixtures/synthetic (every one is SYNTHETIC and labeled so). */
export function syntheticFixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", "synthetic", file)));
}

/** Every job type of this module and its services, minus the one another module handles. */
export async function deadJobs() {
  const db = await getDb();
  return (await db.select().from(schema.jobs).where(eq(schema.jobs.status, "dead"))).filter((j) => j.type !== "handoff.verification_updated");
}

/**
 * Audit metadata and timeline data must never carry extracted values, amounts or names. Returns the offending
 * rows (empty when clean). `needles` are the synthetic values used in the test.
 */
export async function leakedValues(needles: readonly string[]): Promise<string[]> {
  const db = await getDb();
  const audits = await db.select({ action: schema.auditLogs.action, metadata: schema.auditLogs.metadata }).from(schema.auditLogs);
  const events = await db.select({ type: schema.verificationEvents.type, data: schema.verificationEvents.data }).from(schema.verificationEvents);
  const out: string[] = [];
  for (const a of audits) {
    const text = JSON.stringify(a.metadata ?? {});
    for (const n of needles) if (text.toLowerCase().includes(n.toLowerCase())) out.push(`audit ${a.action}: ${n}`);
  }
  for (const e of events) {
    const text = JSON.stringify(e.data ?? {});
    for (const n of needles) if (text.toLowerCase().includes(n.toLowerCase())) out.push(`event ${e.type}: ${n}`);
  }
  return out;
}
