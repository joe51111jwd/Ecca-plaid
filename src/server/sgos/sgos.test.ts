import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { ensurePlatformOrg, type User } from "@/server/auth";
import { setSetting } from "@/server/settings";
import { useTestDb } from "../../../tests/helpers/db";
import {
  assertGiftAllowed,
  createSgo,
  getListStatus,
  getPublicSgo,
  getSgoPolicy,
  getSgoProfile,
  importSandboxProvisionalList,
  importSgoList,
  linkProfileToListEntry,
  listSgoListEntries,
  onboardingChecklist,
  searchSgos,
  setDashboardOnly,
  setIrsPortalRegistered,
  setPaymentsAccount,
  systemActor,
  updateSgoPolicy,
  updateSgoProfile,
  type SgoActor,
} from "./index";

/* All organizations, EINs and people below are synthetic test data. */

const HEADER = "state,name,ein,status,listed_from,removed_on";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const SYS = systemActor("test");
const RETRIEVED = new Date("2026-11-18T14:00:00Z");

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

describe("sgos", () => {
  useTestDb();
  let admin: User;
  let owner: User;
  let stranger: User;
  let adminActor: SgoActor;
  let ownerActor: SgoActor;

  async function user(email: string): Promise<User> {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
    return u;
  }

  async function member(orgId: string, role: MemberRole): Promise<User> {
    const u = await user(`${role}-${newId("user").slice(-6).toLowerCase()}@example.test`);
    const db = await getDb();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId: u.id, role });
    return u;
  }

  async function importProvisional(...rows: string[]) {
    return importSgoList({ source: "provisional_curated", csv: csv(...rows), retrievedAt: RETRIEVED }, SYS);
  }

  async function entryId(source: "provisional_curated" | "irs_published", ein: string): Promise<string> {
    const db = await getDb();
    const rows = await db.select().from(schema.sgoListEntries).where(eq(schema.sgoListEntries.ein, ein));
    const e = rows.find((r) => r.source === source);
    if (!e) throw new Error(`no ${source} entry for ${ein}`);
    return e.id;
  }

  /** A listed SGO accepting gifts: profile with EIN, provisional entry, platform link. */
  async function listedSgo(name: string, ein: string, opts: { ownerEmail?: string } = {}) {
    const { org, profile } = await createSgo({ name, ein, ownerEmail: opts.ownerEmail ?? `owner+${ein}@example.test` }, SYS);
    return { org, profile, entryId: ein };
  }

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    const platform = await ensurePlatformOrg();
    admin = await user("platform-admin@example.test");
    const db = await getDb();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId: platform.id, userId: admin.id, role: "owner" });
    owner = await user("owner@example.test");
    stranger = await user("stranger@example.test");
    adminActor = { userId: admin.id };
    ownerActor = { userId: owner.id };
  });
  afterEach(() => setTestNow(null));

  /* ------------------------------------------------------------------------------------ profiles */

  describe("createSgo", () => {
    it("creates the organization, profile and owner membership, and audits it", async () => {
      const { org, profile } = await createSgo({ name: "Synthetic Scholarship Fund", ein: "001234567", city: " Austin ", ownerEmail: "Owner@Example.test" }, ownerActor);
      expect(org).toMatchObject({ type: "sgo", name: "Synthetic Scholarship Fund", status: "active" });
      expect(profile).toMatchObject({ orgId: org.id, displayName: "Synthetic Scholarship Fund", ein: "00-1234567", city: "Austin", state: "TX", listEntryId: null, incomeCapPct: 300 });
      const db = await getDb();
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, org.id));
      expect(m).toMatchObject({ userId: owner.id, role: "owner" });
      const { items } = await listAuditLogs({ orgId: org.id });
      expect(items.map((i) => i.action).sort()).toEqual(["org.create", "sgo.create"]);
    });

    it("lets a platform admin create an SGO for a new owner address", async () => {
      const { org } = await createSgo({ name: "Synthetic Admin-Made Fund", ownerEmail: "new-owner@example.test" }, adminActor);
      const db = await getDb();
      const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "new-owner@example.test"));
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, org.id));
      expect(m.userId).toBe(u.id);
    });

    it("refuses self-serve signup for someone else, and unknown actors", async () => {
      expect(await codeOf(createSgo({ name: "Synthetic Fund", ownerEmail: "someone-else@example.test" }, ownerActor))).toBe("forbidden");
      expect(await codeOf(createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, { userId: "usr_missing" }))).toBe("forbidden");
    });

    it("validates input and rejects duplicate EINs", async () => {
      expect(await codeOf(createSgo({ name: "  ", ownerEmail: "owner@example.test" }, ownerActor))).toBe("validation_failed");
      expect(await codeOf(createSgo({ name: "Synthetic", ein: "12-34567", ownerEmail: "owner@example.test" }, ownerActor))).toBe("validation_failed");
      expect(await codeOf(createSgo({ name: "Synthetic", state: "ZZ", ownerEmail: "owner@example.test" }, ownerActor))).toBe("validation_failed");
      expect(await codeOf(createSgo({ name: "Synthetic", ownerEmail: "not-an-email" }, SYS))).toBe("validation_failed");
      await createSgo({ name: "Synthetic One", ein: "00-1111111", ownerEmail: "owner@example.test" }, ownerActor);
      expect(await codeOf(createSgo({ name: "Synthetic Two", ein: "001111111", ownerEmail: "owner@example.test" }, ownerActor))).toBe("conflict");
    });
  });

  describe("updateSgoProfile", () => {
    it("validates EIN, website and support email strictly", async () => {
      const { org } = await createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, ownerActor);
      const bad = async (patch: Record<string, unknown>) => (await errorOf(updateSgoProfile(org.id, patch, ownerActor))).details as { fields: Record<string, string> };
      expect((await bad({ ein: "123-456789" })).fields.ein).toBe("Enter the EIN as NN-NNNNNNN.");
      expect((await bad({ website: "javascript:alert(1)" })).fields.website).toBeDefined();
      expect((await bad({ website: "https://user:pw@example.org" })).fields.website).toBeDefined();
      expect((await bad({ website: "https://localhost" })).fields.website).toBeDefined();
      expect((await bad({ logoUrl: "http://example.org/logo.png" })).fields.logoUrl).toBeDefined();
      expect((await bad({ supportEmail: "nope" })).fields.supportEmail).toBeDefined();
      expect(await codeOf(updateSgoProfile(org.id, { incomeCapPct: 100 } as never, ownerActor))).toBe("validation_failed");
      expect(await codeOf(updateSgoProfile(org.id, { listEntryId: "sle_x" } as never, ownerActor))).toBe("validation_failed");
      expect(await codeOf(updateSgoProfile(org.id, {}, ownerActor))).toBe("validation_failed");

      const updated = await updateSgoProfile(org.id, { ein: "001234567", website: "example.org/give", supportEmail: "Help@Example.org", legalName: "", description: " Synthetic. " }, ownerActor);
      expect(updated).toMatchObject({ ein: "00-1234567", website: "https://example.org/give", supportEmail: "help@example.org", legalName: null, description: "Synthetic." });
      const { items } = await listAuditLogs({ orgId: org.id, action: "sgo.profile_update" });
      expect(items).toHaveLength(1);
      expect(Object.keys((items[0].metadata as { changes: Record<string, unknown> }).changes).sort()).toEqual(["description", "ein", "supportEmail", "website"]);
    });

    it("enforces roles and tenancy", async () => {
      const { org } = await createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, ownerActor);
      const other = await createSgo({ name: "Synthetic Other", ownerEmail: "other@example.test" }, SYS);
      const reviewer = await member(org.id, "reviewer");
      const orgAdmin = await member(org.id, "admin");
      expect(await codeOf(updateSgoProfile(org.id, { city: "Waco" }, { userId: reviewer.id }))).toBe("forbidden");
      expect(await codeOf(updateSgoProfile(org.id, { city: "Waco" }, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(updateSgoProfile(other.org.id, { city: "Waco" }, ownerActor))).toBe("forbidden");
      // A stranger cannot tell a missing organization from a foreign one.
      expect(await codeOf(updateSgoProfile("org_missing", { city: "Waco" }, ownerActor))).toBe("forbidden");
      expect(await codeOf(updateSgoProfile("org_missing", { city: "Waco" }, adminActor))).toBe("not_found");
      expect(await codeOf(updateSgoProfile(org.id, { city: "Waco" }, { userId: orgAdmin.id }))).toBe("ok");
      expect(await codeOf(updateSgoProfile(org.id, { city: "Tyler" }, adminActor))).toBe("ok");
    });

    it("refuses another SGO's EIN", async () => {
      await createSgo({ name: "Synthetic One", ein: "00-1111111", ownerEmail: "a@example.test" }, SYS);
      const { org } = await createSgo({ name: "Synthetic Two", ownerEmail: "owner@example.test" }, ownerActor);
      expect(await codeOf(updateSgoProfile(org.id, { ein: "00-1111111" }, ownerActor))).toBe("conflict");
    });

    it("locks the State and a list-verified EIN while linked", async () => {
      await importProvisional("TX,Synthetic Fund,00-1234567,listed,,");
      const { org } = await createSgo({ name: "Synthetic Fund", ein: "00-1234567", ownerEmail: "owner@example.test" }, ownerActor);
      await linkProfileToListEntry(org.id, await entryId("provisional_curated", "00-1234567"), adminActor);
      expect(await codeOf(updateSgoProfile(org.id, { ein: "00-7654321" }, ownerActor))).toBe("conflict");
      expect(await codeOf(updateSgoProfile(org.id, { state: "OK" }, ownerActor))).toBe("conflict");
      expect(await codeOf(updateSgoProfile(org.id, { city: "Austin", ein: "00-1234567" }, ownerActor))).toBe("ok");
    });
  });

  describe("policy", () => {
    it("accepts the statutory cap and stricter ones, and refuses 301%", async () => {
      const { org } = await createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, ownerActor);
      expect(await getSgoPolicy(org.id)).toEqual({ orgId: org.id, incomeCapPct: 300, reviewBandBps: 500, rawRetentionDays: 30 });
      const e = await errorOf(updateSgoPolicy(org.id, { incomeCapPct: 301 }, ownerActor));
      expect(e.code).toBe("validation_failed");
      expect((e.details as { fields: Record<string, string> }).fields.incomeCapPct).toContain("300%");
      for (const bad of [{ incomeCapPct: 0 }, { incomeCapPct: 250.5 }, { reviewBandBps: -1 }, { reviewBandBps: 2001 }, { rawRetentionDays: 0 }, { rawRetentionDays: 366 }, { incomeCapPct: "250" }]) {
        expect(await codeOf(updateSgoPolicy(org.id, bad as never, ownerActor))).toBe("validation_failed");
      }
      expect(await updateSgoPolicy(org.id, { incomeCapPct: 250, reviewBandBps: 0 }, ownerActor)).toEqual({ orgId: org.id, incomeCapPct: 250, reviewBandBps: 0, rawRetentionDays: 30 });
      expect(await updateSgoPolicy(org.id, { incomeCapPct: 1, rawRetentionDays: 365, reviewBandBps: 2000 }, ownerActor)).toMatchObject({ incomeCapPct: 1, rawRetentionDays: 365, reviewBandBps: 2000 });
      expect(await getSgoPolicy(org.id)).toMatchObject({ incomeCapPct: 1 });
      const { items } = await listAuditLogs({ orgId: org.id, action: "sgo.policy_update" });
      expect(items).toHaveLength(2);
      expect(items[1].metadata).toMatchObject({ from: { incomeCapPct: 300 }, to: { incomeCapPct: 250 } });
    });

    it("lets only owners/admins change policy", async () => {
      const { org } = await createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, ownerActor);
      const viewer = await member(org.id, "viewer");
      expect(await codeOf(updateSgoPolicy(org.id, { incomeCapPct: 200 }, { userId: viewer.id }))).toBe("forbidden");
      expect(await codeOf(getSgoPolicy("org_missing"))).toBe("not_found");
    });
  });

  describe("onboarding switches", () => {
    it("records IRS portal registration, payments account and dashboard-only with audits and permissions", async () => {
      const { org } = await createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, ownerActor);
      const reg = await setIrsPortalRegistered(org.id, true, ownerActor);
      expect(reg.irsPortalRegistered).toBe(true);
      expect(reg.irsPortalRegisteredAt?.toISOString()).toBe("2026-11-18T15:00:00.000Z");
      expect((await setIrsPortalRegistered(org.id, false, ownerActor)).irsPortalRegisteredAt).toBeNull();

      expect(await codeOf(setPaymentsAccount(org.id, "acct_Synthetic123", ownerActor))).toBe("forbidden");
      expect(await codeOf(setPaymentsAccount(org.id, "not-an-account", adminActor))).toBe("validation_failed");
      expect((await setPaymentsAccount(org.id, "acct_Synthetic123", adminActor)).paymentsAccountId).toBe("acct_Synthetic123");
      expect((await setPaymentsAccount(org.id, null, SYS)).paymentsAccountId).toBeNull();

      expect((await setDashboardOnly(org.id, true, ownerActor)).dashboardOnly).toBe(true);
      expect(await codeOf(setDashboardOnly(org.id, true, { userId: stranger.id }))).toBe("forbidden");

      const actions = (await listAuditLogs({ orgId: org.id })).items.map((i) => i.action);
      expect(actions.filter((a) => a === "sgo.irs_portal_registration")).toHaveLength(2);
      expect(actions.filter((a) => a === "sgo.payments_account_update")).toHaveLength(2);
      expect(actions.filter((a) => a === "sgo.integration_update")).toHaveLength(1);
    });

    it("builds the checklist in order with plain reasons", async () => {
      const { org } = await createSgo({ name: "Synthetic Fund", ownerEmail: "owner@example.test" }, ownerActor);
      let c = await onboardingChecklist(org.id);
      expect(c.items.map((i) => i.key)).toEqual(["ein", "list", "irs_portal", "payments", "integration", "team"]);
      expect(c.items.every((i) => !i.done)).toBe(true);
      expect(c.items.find((i) => i.key === "list")).toMatchObject({ blocked: true, reason: "Add your EIN first: we check the provisional list by EIN." });
      expect(c.complete).toBe(false);

      await updateSgoProfile(org.id, { ein: "00-1234567" }, ownerActor);
      await importProvisional("TX,Synthetic Fund,00-1234567,listed,,");
      await linkProfileToListEntry(org.id, await entryId("provisional_curated", "00-1234567"), adminActor);
      await setIrsPortalRegistered(org.id, true, ownerActor);
      await setPaymentsAccount(org.id, "acct_Synthetic123", adminActor);
      const db = await getDb();
      await db.insert(schema.webhookEndpoints).values({ id: newId("webhookEndpoint"), orgId: org.id, url: "https://hooks.example.test/x", secretEnc: "synthetic" });
      await member(org.id, "reviewer");
      c = await onboardingChecklist(org.id);
      expect(c.items.map((i) => [i.key, i.done])).toEqual([
        ["ein", true],
        ["list", true],
        ["irs_portal", true],
        ["payments", true],
        ["integration", true],
        ["team", true],
      ]);
      expect(c.complete).toBe(true);
      expect(c.items[1].reason).toBe("On the provisional list — the IRS SGO list has not been published.");
    });
  });

  /* -------------------------------------------------------------------------------------- the list */

  describe("importSgoList", () => {
    it("is platform-only and audited", async () => {
      expect(await codeOf(importSgoList({ source: "provisional_curated", csv: csv("TX,A,00-1000001,listed,,"), retrievedAt: RETRIEVED }, ownerActor))).toBe("forbidden");
      const report = await importSgoList({ source: "provisional_curated", csv: csv("TX,A,00-1000001,listed,,"), retrievedAt: RETRIEVED, sourceUrl: "https://example.test/list.csv" }, adminActor);
      expect(report).toMatchObject({ added: 1, updated: 0, removed: 0, unchanged: 0, rowCount: 1 });
      const { items } = await listAuditLogs({ action: "sgo_list.import" });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ actorType: "user", actorId: admin.id, targetId: "provisional_curated" });
      expect(items[0].metadata).toMatchObject({ added: 1, sha256: report.sha256, sourceUrl: "https://example.test/list.csv" });
    });

    it("is idempotent and reports added / updated / removed / not in file", async () => {
      const rows = ["TX,Synthetic A,00-1000001,listed,2026-11-01,", "TX,Synthetic B,00-1000002,listed,2026-11-01,", "TX,Synthetic Name Only,,listed,,"];
      expect(await importProvisional(...rows)).toMatchObject({ added: 3, updated: 0, removed: 0, unchanged: 0, notInFile: 0 });
      setTestNow("2026-11-19T15:00:00Z");
      const again = await importSgoList({ source: "provisional_curated", csv: csv(...rows), retrievedAt: new Date("2026-11-19T14:00:00Z") }, SYS);
      expect(again).toMatchObject({ added: 0, updated: 0, removed: 0, unchanged: 3 });
      const db = await getDb();
      const all = await db.select().from(schema.sgoListEntries);
      expect(all).toHaveLength(3);
      expect(all.every((e) => e.sourceRetrievedAt?.toISOString() === "2026-11-19T14:00:00.000Z")).toBe(true);

      const third = await importProvisional(
        "TX,Synthetic A renamed,00-1000001,listed,2026-11-01,",
        "TX,Synthetic B,00-1000002,removed,2026-11-01,2026-12-01",
        "TX,Synthetic C,00-1000003,listed,,",
      );
      expect(third).toMatchObject({ added: 1, updated: 1, removed: 1, unchanged: 0, notInFile: 1 });
      // Absent entries are reported, never silently removed.
      const nameOnly = (await db.select().from(schema.sgoListEntries)).find((e) => e.name === "Synthetic Name Only");
      expect(nameOnly?.status).toBe("listed");
      expect(third.ids.notInFile).toEqual([nameOnly!.id]);
    });

    it("upgrades a name-keyed entry when the list later gives its EIN", async () => {
      await importProvisional("TX,Synthetic Niños Fund,,listed,,");
      const db = await getDb();
      const [before] = await db.select().from(schema.sgoListEntries);
      const r = await importProvisional("TX,Synthetic Ninos Fund,00-1000009,listed,,");
      expect(r).toMatchObject({ added: 0, updated: 1 });
      const after = await db.select().from(schema.sgoListEntries);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: before.id, ein: "00-1000009", matchKey: "ein:00-1000009" });
    });

    it("keeps sources apart: the same EIN may be on both lists", async () => {
      await importProvisional("TX,Synthetic A,00-1000001,listed,,");
      const r = await importSgoList({ source: "irs_published", csv: csv("TX,Synthetic A,00-1000001,listed,,"), retrievedAt: RETRIEVED }, SYS);
      expect(r.added).toBe(1);
      const db = await getDb();
      expect(await db.select().from(schema.sgoListEntries)).toHaveLength(2);
    });

    it("is all-or-nothing on bad files and validates its inputs", async () => {
      const e = await errorOf(importProvisional("TX,Good,00-1000001,listed,,", "TX,Bad,12-34,listed,,"));
      expect(e.code).toBe("validation_failed");
      expect((e.details as { errors: Array<{ line: number }> }).errors).toEqual([{ line: 3, message: 'ein "12-34" is not in the form NN-NNNNNNN.' }]);
      const db = await getDb();
      expect(await db.select().from(schema.sgoListEntries)).toHaveLength(0);
      expect(await codeOf(importSgoList({ source: "irs_published", csv: csv("TX,No Ein,,listed,,"), retrievedAt: RETRIEVED }, SYS))).toBe("validation_failed");
      expect(await codeOf(importSgoList({ source: "provisional_curated", csv: HEADER, retrievedAt: RETRIEVED }, SYS))).toBe("validation_failed");
      expect(await codeOf(importSgoList({ source: "provisional_curated", csv: csv("TX,A,00-1000001,listed,,"), retrievedAt: new Date("2026-11-19T15:00:00Z") }, SYS))).toBe("validation_failed");
      expect(await codeOf(importSgoList({ source: "bogus" as never, csv: csv("TX,A,00-1000001,listed,,"), retrievedAt: RETRIEVED }, SYS))).toBe("validation_failed");
      expect(await codeOf(importSgoList({ source: "provisional_curated", csv: csv("TX,A,00-1000001,listed,,"), retrievedAt: RETRIEVED, sourceUrl: "ftp://x" }, SYS))).toBe("validation_failed");
    });

    it("refuses sandbox EINs and the sandbox file in production", async () => {
      const prev = process.env.NODE_ENV;
      try {
        (process.env as Record<string, string>).NODE_ENV = "production";
        expect(await codeOf(importSgoList({ source: "provisional_curated", csv: csv("TX,Demo,00-1000001,listed,,"), retrievedAt: RETRIEVED }, SYS))).toBe("validation_failed");
        expect(await codeOf(importSandboxProvisionalList(SYS))).toBe("forbidden");
      } finally {
        (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
      }
    });

    it("imports the sandbox file, with one removed demo organization", async () => {
      const r = await importSandboxProvisionalList();
      expect(r.added).toBeGreaterThanOrEqual(4);
      const entries = await listSgoListEntries({ source: "provisional_curated", status: "removed" }, adminActor);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toMatch(/^Demo: .*sandbox/);
      expect(await codeOf(listSgoListEntries({}, ownerActor))).toBe("forbidden");
      expect((await listSgoListEntries({ query: "lone star" }, adminActor)).map((e) => e.name)).toEqual(["Demo: Lone Star Scholarship Fund (sandbox)"]);
    });
  });

  describe("linkProfileToListEntry", () => {
    it("requires a platform admin, matching EIN and State, and one SGO per entry", async () => {
      await importProvisional("TX,Synthetic A,00-1000001,listed,,", "OK,Synthetic OK,00-1000002,listed,,", "TX,Synthetic No Ein,,listed,,");
      const { org } = await createSgo({ name: "Synthetic A", ein: "00-1000001", ownerEmail: "owner@example.test" }, ownerActor);
      const idA = await entryId("provisional_curated", "00-1000001");
      expect(await codeOf(linkProfileToListEntry(org.id, idA, ownerActor))).toBe("forbidden");

      const mismatch = await createSgo({ name: "Synthetic Impostor", ein: "00-9999999", ownerEmail: "imp@example.test" }, SYS);
      const e = await errorOf(linkProfileToListEntry(mismatch.org.id, idA, adminActor));
      expect(e.code).toBe("conflict");
      expect(e.message).toContain("does not match");

      expect(await codeOf(linkProfileToListEntry(org.id, await entryId("provisional_curated", "00-1000002"), adminActor))).toBe("conflict");
      expect(await codeOf(linkProfileToListEntry(org.id, "sle_missing", adminActor))).toBe("not_found");

      const linked = await linkProfileToListEntry(org.id, idA, adminActor);
      expect(linked.listEntryId).toBe(idA);
      const noEin = await createSgo({ name: "Synthetic Late", ownerEmail: "late@example.test" }, SYS);
      expect(await codeOf(linkProfileToListEntry(noEin.org.id, idA, adminActor))).toBe("conflict");

      const { items } = await listAuditLogs({ orgId: org.id, action: "sgo_list.link" });
      expect(items).toHaveLength(1);

      const unlinked = await linkProfileToListEntry(org.id, null, adminActor);
      expect(unlinked.listEntryId).toBeNull();
      expect((await listAuditLogs({ orgId: org.id, action: "sgo_list.unlink" })).items).toHaveLength(1);
    });

    it("lets a profile without an EIN adopt the entry's EIN", async () => {
      await importProvisional("TX,Synthetic A,00-1000001,listed,,");
      const { org } = await createSgo({ name: "Synthetic A", ownerEmail: "owner@example.test" }, ownerActor);
      const p = await linkProfileToListEntry(org.id, await entryId("provisional_curated", "00-1000001"), adminActor);
      expect(p.ein).toBe("00-1000001");
    });
  });

  describe("list status, source switching and gifts", () => {
    async function linkedSgo() {
      await importProvisional("TX,Synthetic Listed Fund,00-1000001,listed,2026-11-01,");
      const { org } = await createSgo({ name: "Synthetic Listed Fund", ein: "00-1000001", ownerEmail: "owner@example.test" }, ownerActor);
      await linkProfileToListEntry(org.id, await entryId("provisional_curated", "00-1000001"), adminActor);
      return org;
    }

    it("reports unlisted for an SGO that was never linked, even if its EIN is on the list", async () => {
      await importProvisional("TX,Synthetic Listed Fund,00-1000001,listed,,");
      const { org } = await createSgo({ name: "Synthetic Claimant", ein: "00-1000001", ownerEmail: "owner@example.test" }, ownerActor);
      expect(await getListStatus(org.id)).toMatchObject({ status: "unlisted", label: "Not on the provisional list", entryId: null });
      const e = await errorOf(assertGiftAllowed(org.id, new Date()));
      expect(e).toMatchObject({ code: "conflict", details: { reason: "sgo_unlisted" } });
    });

    it("returns a reliance snapshot for a provisional listing", async () => {
      const org = await linkedSgo();
      const snap = await assertGiftAllowed(org.id, new Date("2026-11-18T15:00:00Z"));
      expect(snap).toEqual({
        entryId: await entryId("provisional_curated", "00-1000001"),
        source: "provisional_curated",
        status: "provisional",
        label: "On the provisional list — the IRS SGO list has not been published",
        retrievedAt: RETRIEVED.toISOString(),
        name: "Synthetic Listed Fund",
        ein: "00-1000001",
        state: "TX",
        listedFrom: "2026-11-01",
        removedOn: null,
        checkedAt: "2026-11-18T15:00:00.000Z",
      });
    });

    it("refuses gifts before listed_from", async () => {
      const org = await linkedSgo();
      const e = await errorOf(assertGiftAllowed(org.id, new Date("2026-10-31T12:00:00Z")));
      expect(e.details).toEqual({ reason: "sgo_not_yet_listed" });
    });

    it("applies a removal from its effective date in Texas time, keeping earlier gifts valid", async () => {
      const org = await linkedSgo();
      await importProvisional("TX,Synthetic Listed Fund,00-1000001,removed,2026-11-01,2026-12-01");
      // Still listed until the removal date.
      expect((await getListStatus(org.id, new Date("2026-11-18T15:00:00Z"))).status).toBe("provisional");
      // 23:59 Central on November 30.
      expect((await assertGiftAllowed(org.id, new Date("2026-12-01T05:59:00Z"))).status).toBe("provisional");
      // 00:00 Central on December 1: refused.
      const e = await errorOf(assertGiftAllowed(org.id, new Date("2026-12-01T06:00:00Z")));
      expect(e).toMatchObject({ code: "conflict", details: { reason: "sgo_removed" } });
      expect(e.message).toBe("Removed from the provisional list effective December 1, 2026 — gifts can no longer be accepted. A gift to this organization cannot be accepted.");
      const status = await getListStatus(org.id, new Date("2026-12-02T12:00:00Z"));
      expect(status).toMatchObject({ status: "removed", removedOn: "2026-12-01" });
      // The removal is audited on the affected SGO.
      expect((await listAuditLogs({ orgId: org.id, action: "sgo_list.entry_removed" })).items).toHaveLength(1);
    });

    it("ignores provisional entries once the IRS list is the source, and carries a verified EIN over", async () => {
      const org = await linkedSgo();
      await setSetting("sgoList.source", "irs_published", { actorUserId: admin.id });
      expect(await getListStatus(org.id)).toMatchObject({ status: "unlisted", source: "irs_published", label: "Not on the IRS SGO list" });
      expect((await errorOf(assertGiftAllowed(org.id, new Date()))).details).toEqual({ reason: "sgo_unlisted" });

      await importSgoList({ source: "irs_published", csv: csv("TX,SYNTHETIC LISTED FUND,00-1000001,listed,2027-01-01,"), retrievedAt: new Date("2026-11-18T14:00:00Z") }, SYS);
      setTestNow("2027-01-02T15:00:00Z");
      const status = await getListStatus(org.id);
      expect(status).toMatchObject({ status: "irs_listed", source: "irs_published", entryId: await entryId("irs_published", "00-1000001"), label: "On the IRS SGO list as of November 18, 2026" });
      const snap = await assertGiftAllowed(org.id, new Date("2027-01-02T15:00:00Z"));
      expect(snap).toMatchObject({ source: "irs_published", status: "irs_listed", name: "SYNTHETIC LISTED FUND" });

      // Switching back makes the provisional entry count again.
      await setSetting("sgoList.source", "provisional_curated", { actorUserId: admin.id });
      expect((await getListStatus(org.id)).status).toBe("provisional");
    });

    it("refuses gifts for suspended SGOs and SGOs not accepting donations", async () => {
      const org = await linkedSgo();
      await updateSgoProfile(org.id, { acceptsDonations: false }, ownerActor);
      expect((await errorOf(assertGiftAllowed(org.id, new Date()))).details).toEqual({ reason: "sgo_not_accepting" });
      await updateSgoProfile(org.id, { acceptsDonations: true }, ownerActor);
      const db = await getDb();
      await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, org.id));
      expect((await errorOf(assertGiftAllowed(org.id, new Date()))).details).toEqual({ reason: "sgo_inactive" });
      expect(await codeOf(assertGiftAllowed("org_missing", new Date()))).toBe("not_found");
      expect(await codeOf(assertGiftAllowed(org.id, new Date("nope")))).toBe("bad_request");
    });

    it("does not treat a business organization as an SGO", async () => {
      const db = await getDb();
      const id = newId("org");
      await db.insert(schema.organizations).values({ id, type: "business", name: "Synthetic Camp", slug: "synthetic-camp" });
      await db.insert(schema.sgoProfiles).values({ orgId: id, displayName: "Synthetic Camp" });
      expect(await codeOf(getSgoProfile(id))).toBe("not_found");
      expect(await codeOf(getListStatus(id))).toBe("not_found");
    });
  });

  /* ------------------------------------------------------------------------------------- directory */

  describe("directory", () => {
    async function setup() {
      await importProvisional(
        "TX,Synthetic Niños Scholarship Fund,00-1000001,listed,,",
        "TX,Synthetic Bluebonnet Aid,00-1000002,listed,,",
        "TX,Synthetic Removed Fund,00-1000003,removed,,2026-11-01",
        "TX,Synthetic Suspended Fund,00-1000004,listed,,",
        "TX,Synthetic Paused Fund,00-1000005,listed,,",
        "TX,Synthetic Future Fund,00-1000006,listed,2027-01-01,",
      );
      const made: Record<string, string> = {};
      for (const [name, ein] of [
        ["Synthetic Niños Scholarship Fund", "00-1000001"],
        ["Synthetic Bluebonnet Aid", "00-1000002"],
        ["Synthetic Removed Fund", "00-1000003"],
        ["Synthetic Suspended Fund", "00-1000004"],
        ["Synthetic Paused Fund", "00-1000005"],
        ["Synthetic Future Fund", "00-1000006"],
      ]) {
        const { org } = await listedSgo(name, ein);
        await linkProfileToListEntry(org.id, await entryId("provisional_curated", ein), adminActor);
        made[name] = org.id;
      }
      // Never linked: an organization that typed a listed-looking name.
      await createSgo({ name: "Synthetic Unlisted Scholarship Fund", ein: "00-1000007", ownerEmail: "unlisted@example.test" }, SYS);
      const db = await getDb();
      await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, made["Synthetic Suspended Fund"]));
      await updateSgoProfile(made["Synthetic Paused Fund"], { acceptsDonations: false }, SYS);
      return made;
    }

    it("returns only listed, active, donation-accepting SGOs", async () => {
      await setup();
      const all = await searchSgos({ query: "" });
      expect(all.map((s) => s.displayName)).toEqual(["Synthetic Bluebonnet Aid", "Synthetic Niños Scholarship Fund"]);
      expect(all[0].list).toEqual({ status: "provisional", source: "provisional_curated", label: "On the provisional list — the IRS SGO list has not been published", listedFrom: null, removedOn: null });
      for (const q of ["removed", "suspended", "paused", "future", "unlisted"]) expect(await searchSgos({ query: q })).toEqual([]);
    });

    it("matches case- and diacritic-insensitively, by EIN, and ranks prefix matches first", async () => {
      await setup();
      expect((await searchSgos({ query: "NINOS" })).map((s) => s.displayName)).toEqual(["Synthetic Niños Scholarship Fund"]);
      expect((await searchSgos({ query: "niños schol" })).map((s) => s.displayName)).toEqual(["Synthetic Niños Scholarship Fund"]);
      expect((await searchSgos({ query: "001000002" })).map((s) => s.ein)).toEqual(["00-1000002"]);
      expect(await searchSgos({ query: "00-1000003" })).toEqual([]);
      expect(await searchSgos({ query: "%" })).toEqual([]);
      expect((await searchSgos({ query: "synthetic", limit: 1 })).length).toBe(1);
      expect(await searchSgos({ query: "aid", state: "OK" })).toEqual([]);
      expect((await searchSgos({ query: "aid", state: "tx" })).length).toBe(1);
      expect(await codeOf(searchSgos({ query: "x", state: "ZZ" }))).toBe("validation_failed");
      expect(await codeOf(searchSgos({ query: "x".repeat(101) }))).toBe("validation_failed");
      expect(await codeOf(searchSgos({ query: "x", limit: 51 }))).toBe("validation_failed");
    });

    it("follows the active source", async () => {
      await setup();
      await setSetting("sgoList.source", "irs_published", { actorUserId: admin.id });
      expect(await searchSgos({ query: "" })).toEqual([]);
      await importSgoList({ source: "irs_published", csv: csv("TX,Synthetic Bluebonnet Aid,00-1000002,listed,,"), retrievedAt: RETRIEVED }, SYS);
      const hits = await searchSgos({ query: "" });
      expect(hits.map((s) => [s.displayName, s.list.status, s.list.label])).toEqual([["Synthetic Bluebonnet Aid", "irs_listed", "On the IRS SGO list as of November 18, 2026"]]);
    });

    it("getPublicSgo shows listed and removed SGOs and hides everything else", async () => {
      const made = await setup();
      const db = await getDb();
      const slugOf = async (id: string) => (await db.select({ slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, id)))[0].slug;
      expect((await getPublicSgo(await slugOf(made["Synthetic Bluebonnet Aid"])))?.list.status).toBe("provisional");
      expect((await getPublicSgo((await slugOf(made["Synthetic Bluebonnet Aid"])).toUpperCase()))?.displayName).toBe("Synthetic Bluebonnet Aid");
      expect((await getPublicSgo(await slugOf(made["Synthetic Removed Fund"])))?.list.status).toBe("removed");
      for (const name of ["Synthetic Suspended Fund", "Synthetic Paused Fund", "Synthetic Future Fund"]) expect(await getPublicSgo(await slugOf(made[name]))).toBeNull();
      expect(await getPublicSgo("synthetic-unlisted-scholarship-fund")).toBeNull();
      expect(await getPublicSgo("does-not-exist")).toBeNull();
      expect(await getPublicSgo("")).toBeNull();
    });
  });
});
