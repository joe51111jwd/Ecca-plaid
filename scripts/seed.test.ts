/**
 * The demo seed against an in-memory database: every scenario lands in the state it promises, everything goes
 * through the services (audit entries exist), a second run creates nothing, and the credentials file keeps the
 * once-only secrets. All data is SYNTHETIC.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { useTestDb } from "../tests/helpers/db";
import { CREDENTIALS_FILE, DEMO_LOGINS, DEMO_SGOS, HANDOFF_BOOKING_REF, readDemoCredentials, SCENARIOS, seedDemo, type SeedResult } from "./seed";

describe("demo seed", () => {
  useTestDb({ truncate: false });
  const dataDir = mkdtempSync(join(tmpdir(), "passport-seed-test-"));
  let first: SeedResult;

  beforeAll(async () => {
    setTestNow("2026-11-18T16:00:00.000Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    first = await seedDemo({ dataDir, verbose: false, listen: false });
  }, 240_000);

  afterEach(() => undefined);
  afterAll(() => {
    setTestNow(null);
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("puts every verification scenario in the state it is named for", async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.verifications);
    const byRef = new Map(rows.map((r) => [r.externalRef, r]));
    expect(byRef.get(SCENARIOS.snapEligible)).toMatchObject({ status: "eligible", method: "categorical", awardProgram: "SNAP", provisional: true });
    expect(byRef.get(SCENARIOS.w2Eligible)).toMatchObject({ status: "eligible", method: "direct", provisional: true });
    expect(byRef.get(SCENARIOS.betweenReadings)).toMatchObject({ status: "needs_review", countyFips: "48427" });
    expect(byRef.get(SCENARIOS.unreadableScan)).toMatchObject({ status: "needs_review" });
    expect(byRef.get(SCENARIOS.awaitingFamily)).toMatchObject({ status: "pending", stage: "awaiting_family" });
    expect(byRef.get(SCENARIOS.ineligible)).toMatchObject({ status: "ineligible", method: "direct" });
    expect(byRef.get(SCENARIOS.otherSgo)).toMatchObject({ status: "pending" });
    // Ineligible means the evidence shows income over BOTH readings, not missing evidence.
    expect(byRef.get(SCENARIOS.ineligible)!.householdIncomeCents).toBeGreaterThan(24_960_000);
    // The between-readings case is in review because of the two readings, not for another reason.
    expect(JSON.stringify(byRef.get(SCENARIOS.betweenReadings)!.decisionReasons)).toMatch(/read two ways|readings/i);
    // Decided cases have their evidence pack.
    for (const ref of [SCENARIOS.snapEligible, SCENARIOS.w2Eligible, SCENARIOS.ineligible]) {
      expect(byRef.get(ref)!.evidencePdfObjectId, ref).toBeTruthy();
      expect(byRef.get(ref)!.evidenceJsonObjectId, ref).toBeTruthy();
    }
  });

  it("creates the two sandbox SGOs from the provisional list, linked, with one API key and one webhook on the first", async () => {
    const db = await getDb();
    const orgs = await db.select().from(schema.organizations);
    const a = orgs.find((o) => o.name === DEMO_SGOS.primary.name)!;
    const b = orgs.find((o) => o.name === DEMO_SGOS.other.name)!;
    expect(a.type).toBe("sgo");
    expect(b.type).toBe("sgo");
    const profiles = await db.select().from(schema.sgoProfiles);
    expect(profiles.find((p) => p.orgId === a.id)?.listEntryId).toBeTruthy();
    expect(profiles.find((p) => p.orgId === b.id)?.listEntryId).toBeTruthy();
    const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, a.id));
    expect(keys).toHaveLength(1);
    expect(keys[0]!.mode).toBe("test");
    // Only the hash is stored; the secret is in the credentials file.
    expect(keys[0]!.keyHash).not.toContain("ecca_test_");
    expect(first.credentials.apiKey).toMatch(/^ecca_test_/);
    const endpoints = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, a.id));
    expect(endpoints).toHaveLength(1);
    expect(first.credentials.webhookSecret).toMatch(/^whsec_/);
  });

  it("signs in the demo people through the real sign-in flow and makes the admin a platform admin", async () => {
    const db = await getDb();
    const users = await db.select().from(schema.users);
    for (const email of [DEMO_LOGINS.admin, DEMO_LOGINS.sgoOwner, DEMO_LOGINS.sgoReviewer, DEMO_LOGINS.otherSgoOwner, DEMO_LOGINS.campOwner]) {
      expect(users.some((u) => u.email === email), email).toBe(true);
    }
    const sessions = await db.select().from(schema.sessions);
    expect(sessions.length).toBeGreaterThan(5);
    const platform = (await db.select().from(schema.organizations)).find((o) => o.type === "platform")!;
    const admin = users.find((u) => u.email === DEMO_LOGINS.admin)!;
    const memberships = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, platform.id));
    expect(memberships.map((m) => m.userId)).toContain(admin.id);
  });

  it("records two sandbox gifts (single and joint) and a camp booking held while the letter is reviewed", async () => {
    const db = await getDb();
    const donations = await db.select().from(schema.donations);
    expect(donations.length).toBe(3); // one single filer, two spouses on the joint return
    expect(donations.every((d) => d.mode === "test")).toBe(true);
    const handoffs = await db.select().from(schema.handoffs);
    const held = handoffs.find((h) => h.bookingRef === HANDOFF_BOOKING_REF)!;
    expect(held.status).toBe("held");
    expect(held.verificationId).toBe(first.credentials.handoffVerificationId);
    const partnerships = await db.select().from(schema.partnerships);
    expect(partnerships.some((p) => p.status === "active" && p.sgoOrgId === first.credentials.sgoOrgId && p.businessOrgId === first.credentials.campOrgId)).toBe(true);
  });

  it("goes through the services: changes are audited, and no family name or amount leaks into audit metadata", async () => {
    const db = await getDb();
    const actions = new Set((await db.select({ action: schema.auditLogs.action }).from(schema.auditLogs)).map((a) => a.action));
    for (const a of ["sgo.create", "org.member_add", "household.address_update", "verification.rerun"]) expect(actions, a).toContain(a);
    const metadata = JSON.stringify(await db.select({ m: schema.auditLogs.metadata }).from(schema.auditLogs));
    for (const needle of ["Lucia", "Placeholder", "15000000", "FIXTURE FOODS"]) expect(metadata).not.toContain(needle);
  });

  it("is idempotent: a second run creates nothing and keeps the once-only secrets", async () => {
    const db = await getDb();
    const before = (await db.select().from(schema.verifications)).length;
    const second = await seedDemo({ dataDir, verbose: false, listen: false });
    expect(second.created).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(5);
    expect((await db.select().from(schema.verifications)).length).toBe(before);
    expect((await db.select().from(schema.donations)).length).toBe(3);
    // The API key secret is only returned when created; the file keeps the first one.
    expect(second.credentials.apiKey).toBe(first.credentials.apiKey);
    expect(second.credentials.webhookSecret).toBe(first.credentials.webhookSecret);
    const onDisk = readDemoCredentials(dataDir)!;
    expect(onDisk).toEqual(second.credentials);
    expect(JSON.parse(readFileSync(join(dataDir, CREDENTIALS_FILE), "utf8")).verifications).toEqual(first.credentials.verifications);
  }, 240_000);

  it("reports no credentials file for an empty directory", () => {
    const empty = mkdtempSync(join(tmpdir(), "passport-seed-empty-"));
    expect(readDemoCredentials(empty)).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});
