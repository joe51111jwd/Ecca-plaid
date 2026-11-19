import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { hashToken } from "@/lib/crypto";
import { setTestNow } from "@/lib/clock";
import { newId, newToken } from "@/lib/ids";
import { ensurePlatformOrg } from "@/server/auth";
import { enqueue } from "@/server/jobs";
import { getSetting } from "@/server/settings";
import { createSgo, importSgoList, systemActor } from "@/server/sgos";
import { useTestDb } from "../../../../tests/helpers/db";
import type { AdminActor, AdminNotice } from "../types";
import type { ActionResult } from "@/lib/errors";
import * as ops from "./operations";
import { retrievalInstant } from "./operations";

/** Every person, organization, EIN and household in this file is SYNTHETIC (EINs use the unassigned 00- prefix). */

const NOW = "2026-11-18T16:00:00.000Z";
const SYS = systemActor("admin-ui test fixture");
const HEADER = "state,name,ein,status,listed_from,removed_on";

function form(entries: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function makeUser(email: string) {
  const db = await getDb();
  const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
  return u;
}

async function makeAdmin(email = "admin@synthetic.example"): Promise<AdminActor> {
  const db = await getDb();
  const platform = await ensurePlatformOrg(db);
  const user = await makeUser(email);
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId: platform.id, userId: user.id, role: "owner" });
  return { userId: user.id, request: { ip: "203.0.113.9", userAgent: "vitest" } };
}

function expectOk(r: ActionResult<AdminNotice>): AdminNotice {
  if (!r.ok) throw new Error(`Expected success, got ${r.error.code}: ${r.error.message} ${JSON.stringify(r.error.fields ?? {})}`);
  return r.data;
}

function expectFail(r: ActionResult<AdminNotice>, code: string): { message: string; fields?: Record<string, string> } {
  if (r.ok) throw new Error(`Expected ${code}, got success: ${r.data.message}`);
  expect(r.error.code).toBe(code);
  return r.error;
}

async function auditActions(action: string) {
  const db = await getDb();
  return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));
}

describe("admin operations", () => {
  useTestDb();
  let admin: AdminActor;
  let outsider: AdminActor;

  beforeEach(async () => {
    setTestNow(NOW);
    admin = await makeAdmin();
    outsider = { userId: (await makeUser("outsider@synthetic.example")).id, request: null };
  });
  afterEach(() => setTestNow(null));

  describe("retrieval dates", () => {
    it("uses now for today and the start of the day in Central time otherwise", () => {
      const at = new Date(NOW);
      expect(retrievalInstant("2026-11-18", at)).toEqual(at);
      expect(retrievalInstant("2026-11-17", at).toISOString()).toBe("2026-11-17T06:00:00.000Z");
      expect(retrievalInstant("2026-07-01", at).toISOString()).toBe("2026-07-01T05:00:00.000Z");
    });
  });

  describe("fee structure", () => {
    it("refuses to leave none without counsel's memo and changes nothing", async () => {
      const err = expectFail(await ops.saveFeeStructure(admin, form({ active: "donor_service_fee", donorServiceFeePercent: "3", sgoFeePercent: "", counselMemoRef: "", approvedOn: "" })), "validation_failed");
      expect(err.fields?.counselMemoRef).toBeDefined();
      expect((await getSetting("fees.structure")).active).toBe("none");
      expect(await auditActions("settings.update")).toHaveLength(0);
    });

    it("saves a structure with the memo and audits the before and after", async () => {
      const notice = expectOk(await ops.saveFeeStructure(admin, form({ active: "sgo_invoiced", sgoFeePercent: "2.5", donorServiceFeePercent: "0", counselMemoRef: "MEMO-SYN-1", approvedOn: "2026-11-10" })));
      expect(notice.message).toContain("2.5%");
      expect(await getSetting("fees.structure")).toEqual({ active: "sgo_invoiced", sgoFeeBps: 250, donorServiceFeeBps: 0, counselMemoRef: "MEMO-SYN-1", approvedAt: "2026-11-10T00:00:00.000Z" });
      const [entry] = await auditActions("settings.update");
      expect(entry.actorId).toBe(admin.userId);
      expect(entry.ip).toBe("203.0.113.9");
      expect(entry.metadata).toMatchObject({ from: { active: "none" }, to: { active: "sgo_invoiced" } });
    });

    it("refuses a non-admin even with a valid form", async () => {
      expectFail(await ops.saveFeeStructure(outsider, form({ active: "none", sgoFeePercent: "0", donorServiceFeePercent: "0", counselMemoRef: "", approvedOn: "" })), "forbidden");
    });
  });

  describe("live gifts", () => {
    it("turning on needs a counsel reference, which is audited with the change", async () => {
      expectFail(await ops.setLiveGifts(admin, form({ enabled: "on" })), "validation_failed");
      expect(await getSetting("gifts.liveEnabled")).toBe(false);

      expectOk(await ops.setLiveGifts(admin, form({ enabled: "on", acknowledged: "on", counselReference: "MEMO-SYN-LIVE" })));
      expect(await getSetting("gifts.liveEnabled")).toBe(true);
      const [ref] = await auditActions("settings.live_gifts_counsel_reference");
      expect(ref.metadata).toEqual({ counselReference: "MEMO-SYN-LIVE" });
      expect(await auditActions("settings.update")).toHaveLength(1);
    });

    it("reports a no-op switch as a conflict and turns off without a reference", async () => {
      expectFail(await ops.setLiveGifts(admin, form({ enabled: "off" })), "conflict");
      expectOk(await ops.setLiveGifts(admin, form({ enabled: "on", acknowledged: "on", counselReference: "MEMO-SYN-LIVE" })));
      expectOk(await ops.setLiveGifts(admin, form({ enabled: "off" })));
      expect(await getSetting("gifts.liveEnabled")).toBe(false);
      expect(await auditActions("settings.live_gifts_counsel_reference")).toHaveLength(1);
    });

    it("a non-admin cannot turn live gifts on, and nothing is written", async () => {
      expectFail(await ops.setLiveGifts(outsider, form({ enabled: "on", acknowledged: "on", counselReference: "MEMO-SYN-LIVE" })), "forbidden");
      expect(await getSetting("gifts.liveEnabled")).toBe(false);
      expect(await auditActions("settings.live_gifts_counsel_reference")).toHaveLength(0);
    });
  });

  describe("credit start date and list source", () => {
    it("moves the credit start date outside production", async () => {
      expectOk(await ops.setCreditStartDate(admin, form({ date: "2026-12-01" })));
      expect(await getSetting("credit.startDate")).toBe("2026-12-01");
      expectFail(await ops.setCreditStartDate(admin, form({ date: "2026-12-32" })), "validation_failed");
    });

    it("refuses to switch to a list with no listed entries", async () => {
      const err = expectFail(await ops.setListSource(admin, form({ source: "irs_published" })), "validation_failed");
      expect(err.fields?.source).toBeDefined();
      expect(await getSetting("sgoList.source")).toBe("provisional_curated");
      expectFail(await ops.setListSource(admin, form({ source: "provisional_curated" })), "conflict");
    });

    it("switches once the IRS list has a listed entry", async () => {
      await importSgoList({ source: "irs_published", csv: `${HEADER}\nTX,Synthetic IRS Fund,00-7654321,listed,2027-01-01,`, retrievedAt: new Date(NOW) }, SYS);
      expectOk(await ops.setListSource(admin, form({ source: "irs_published" })));
      expect(await getSetting("sgoList.source")).toBe("irs_published");
    });
  });

  describe("SGO list", () => {
    const csvFile = (text: string) => new File([text], "list.csv", { type: "text/csv" });

    it("imports a file and reports the counts", async () => {
      const notice = expectOk(
        await ops.importList(admin, form({ source: "provisional_curated", sourceUrl: "https://example.org/list.csv", retrievedOn: "2026-11-18", file: csvFile(`${HEADER}\nTX,Synthetic Fund A,00-1111111,listed,,\nTX,Synthetic Fund B,,listed,,`) })),
      );
      expect(notice.details).toEqual(expect.arrayContaining([{ label: "Added", value: "2" }]));
      const [audited] = await auditActions("sgo_list.import");
      expect(audited.actorId).toBe(admin.userId);
      expect(audited.metadata).toMatchObject({ sourceUrl: "https://example.org/list.csv", retrievedAt: NOW });
    });

    it("refuses a missing file, a future download date and a bad file", async () => {
      expect(expectFail(await ops.importList(admin, form({ source: "provisional_curated", sourceUrl: "", retrievedOn: "2026-11-18" })), "validation_failed").fields?.file).toBeDefined();
      expect(expectFail(await ops.importList(admin, form({ source: "provisional_curated", sourceUrl: "", retrievedOn: "2026-11-19", file: csvFile(`${HEADER}\nTX,A,,listed,,`) })), "validation_failed").fields?.retrievedOn).toBeDefined();
      expectFail(await ops.importList(admin, form({ source: "irs_published", sourceUrl: "", retrievedOn: "2026-11-18", file: csvFile(`${HEADER}\nTX,No EIN Fund,,listed,,`) })), "validation_failed");
      expect(await auditActions("sgo_list.import")).toHaveLength(0);
    });

    it("refuses an oversized file before reading it", async () => {
      const big = csvFile(`${HEADER}\n${"#".repeat(950 * 1024)}`);
      expect(expectFail(await ops.importList(admin, form({ source: "provisional_curated", sourceUrl: "", retrievedOn: "2026-11-18", file: big })), "validation_failed").fields?.file).toBe("Too large.");
    });

    it("refuses a non-admin import", async () => {
      expectFail(await ops.importList(outsider, form({ source: "provisional_curated", sourceUrl: "", retrievedOn: "2026-11-18", file: csvFile(`${HEADER}\nTX,A,,listed,,`) })), "forbidden");
    });

    it("marks an entry removed through the importer, audits it for the linked SGO, and leaves other entries alone", async () => {
      const { org } = await createSgo({ name: "Synthetic Linked Fund", ein: "00-2222222", ownerEmail: "owner@synthetic.example" }, SYS);
      await importSgoList({ source: "provisional_curated", csv: `${HEADER}\nTX,Synthetic Linked Fund,00-2222222,listed,2026-01-01,\nTX,Synthetic Other Fund,00-3333333,listed,,`, retrievedAt: new Date(NOW) }, SYS);
      const db = await getDb();
      const [entry] = await db.select().from(schema.sgoListEntries).where(eq(schema.sgoListEntries.ein, "00-2222222"));
      expectOk(await ops.linkListEntry(admin, form({ orgId: org.id, entryId: entry.id })));

      expect(expectFail(await ops.removeListEntry(admin, form({ entryId: entry.id, removedOn: "2025-12-31", learnedOn: "2026-11-18", sourceUrl: "" })), "validation_failed").fields?.removedOn).toBeDefined();

      const notice = expectOk(await ops.removeListEntry(admin, form({ entryId: entry.id, removedOn: "2027-03-15", learnedOn: "2026-11-18", sourceUrl: "" })));
      expect(notice.message).toContain("2027-03-15");
      const rows = await db.select().from(schema.sgoListEntries);
      expect(rows.find((r) => r.id === entry.id)).toMatchObject({ status: "removed", removedOn: "2027-03-15", listedFrom: "2026-01-01", name: "Synthetic Linked Fund" });
      expect(rows.find((r) => r.ein === "00-3333333")).toMatchObject({ status: "listed", removedOn: null });
      const [removed] = await auditActions("sgo_list.entry_removed");
      expect(removed).toMatchObject({ orgId: org.id, targetId: entry.id });

      expect(expectFail(await ops.removeListEntry(admin, form({ entryId: entry.id, removedOn: "2027-03-15", learnedOn: "2026-11-18", sourceUrl: "" })), "validation_failed").message).toMatch(/already removed/);
      expectFail(await ops.removeListEntry(admin, form({ entryId: "sle_missing", removedOn: "2027-03-15", learnedOn: "2026-11-18", sourceUrl: "" })), "validation_failed");
    });

    it("links and unlinks, refusing an entry from another State", async () => {
      const { org } = await createSgo({ name: "Synthetic Texas Fund", ownerEmail: "tx-owner@synthetic.example" }, SYS);
      await importSgoList({ source: "provisional_curated", csv: `${HEADER}\nOK,Synthetic Oklahoma Fund,,listed,,\nTX,Synthetic Texas Fund,,listed,,`, retrievedAt: new Date(NOW) }, SYS);
      const db = await getDb();
      const entries = await db.select().from(schema.sgoListEntries);
      const ok = entries.find((e) => e.state === "OK")!;
      const tx = entries.find((e) => e.state === "TX")!;
      expectFail(await ops.linkListEntry(admin, form({ orgId: org.id, entryId: ok.id })), "conflict");
      expectOk(await ops.linkListEntry(admin, form({ orgId: org.id, entryId: tx.id })));
      expect((await db.select().from(schema.sgoProfiles).where(eq(schema.sgoProfiles.orgId, org.id)))[0].listEntryId).toBe(tx.id);
      expect(expectOk(await ops.linkListEntry(admin, form({ orgId: org.id, entryId: "" }))).message).toMatch(/no longer linked/);
      expectFail(await ops.linkListEntry(outsider, form({ orgId: org.id, entryId: tx.id })), "forbidden");
    });
  });

  describe("organizations", () => {
    it("creates an SGO and a business owned by someone else", async () => {
      const sgo = expectOk(await ops.createSgoOp(admin, form({ name: "Synthetic New Fund", ein: "00-4444444", city: "Austin", state: "tx", ownerEmail: "NEW-owner@synthetic.example" })));
      expect(sgo.link?.href).toMatch(/^\/admin\/organizations\/org_/);
      const biz = expectOk(await ops.createBusinessOp(admin, form({ name: "Synthetic Camp", vendorType: "summer_camp", website: "", billingEmail: "billing@synthetic.example", ownerEmail: "camp@synthetic.example" })));
      expect(biz.message).toContain("Synthetic Camp");
      expectFail(await ops.createBusinessOp(admin, form({ name: "Bad", vendorType: "casino", website: "", billingEmail: "b@synthetic.example", ownerEmail: "c@synthetic.example" })), "validation_failed");
      expectFail(await ops.createSgoOp(outsider, form({ name: "Not Mine", ownerEmail: "someone-else@synthetic.example", state: "TX", ein: "", city: "" })), "forbidden");
    });

    it("suspends and reinstates with a reason, audited, and never the platform org", async () => {
      const { org } = await createSgo({ name: "Synthetic Suspend Fund", ownerEmail: "s-owner@synthetic.example" }, SYS);
      expectFail(await ops.setOrgStatusOp(admin, form({ orgId: org.id, status: "suspended", reason: "no" })), "validation_failed");
      expectOk(await ops.setOrgStatusOp(admin, form({ orgId: org.id, status: "suspended", reason: "Contract terminated by the SGO" })));
      expectFail(await ops.setOrgStatusOp(admin, form({ orgId: org.id, status: "suspended", reason: "Contract terminated by the SGO" })), "conflict");
      const [entry] = await auditActions("org.suspend");
      expect(entry).toMatchObject({ orgId: org.id, actorId: admin.userId });
      expect(entry.metadata).toEqual({ from: "active", to: "suspended", reason: "Contract terminated by the SGO" });
      expectOk(await ops.setOrgStatusOp(admin, form({ orgId: org.id, status: "active", reason: "Contract renewed in writing" })));
      expect(await auditActions("org.reactivate")).toHaveLength(1);

      const platform = await ensurePlatformOrg();
      expectFail(await ops.setOrgStatusOp(admin, form({ orgId: platform.id, status: "suspended", reason: "Testing the platform guard" })), "conflict");
      expectFail(await ops.setOrgStatusOp(outsider, form({ orgId: org.id, status: "suspended", reason: "Not allowed to do this" })), "forbidden");
      expectFail(await ops.setOrgStatusOp(admin, form({ orgId: "org_missing", status: "suspended", reason: "Does not exist at all" })), "not_found");
    });

    it("manages members through the orgs service", async () => {
      const { org } = await createSgo({ name: "Synthetic Members Fund", ownerEmail: "m-owner@synthetic.example" }, SYS);
      expect(expectOk(await ops.addMemberOp(admin, form({ orgId: org.id, email: "reviewer@synthetic.example", role: "reviewer" }))).message).toMatch(/new account/);
      const db = await getDb();
      const [reviewer] = await db.select().from(schema.users).where(eq(schema.users.email, "reviewer@synthetic.example"));
      expectOk(await ops.changeRoleOp(admin, form({ orgId: org.id, userId: reviewer.id, role: "admin" })));
      const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, org.id), eq(schema.memberships.userId, reviewer.id)));
      expect(m.role).toBe("admin");
      expectOk(await ops.removeMemberOp(admin, form({ orgId: org.id, userId: reviewer.id })));
      expect(await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, org.id), eq(schema.memberships.userId, reviewer.id)))).toHaveLength(0);

      const [owner] = await db.select().from(schema.users).where(eq(schema.users.email, "m-owner@synthetic.example"));
      const lastOwner = await ops.removeMemberOp(admin, form({ orgId: org.id, userId: owner.id }));
      expect(lastOwner.ok).toBe(false);
      expectFail(await ops.addMemberOp(admin, form({ orgId: org.id, email: "x@synthetic.example", role: "god" })), "validation_failed");
    });

    it("sets a business success fee, platform admins only", async () => {
      const created = expectOk(await ops.createBusinessOp(admin, form({ name: "Synthetic Fee Camp", vendorType: "summer_camp", website: "", billingEmail: "fee@synthetic.example", ownerEmail: "fee-owner@synthetic.example" })));
      const orgId = created.details![0].value;
      const notice = expectOk(await ops.setSuccessFeeOp(admin, form({ orgId, flatDollars: "25", percent: "1.5" })));
      expect(notice.message).toContain("$25.00");
      expect(notice.message).toContain("1.5%");
      const db = await getDb();
      const [p] = await db.select().from(schema.businessProfiles).where(eq(schema.businessProfiles.orgId, orgId));
      expect([p.successFeeFlatCents, p.successFeeBps]).toEqual([2500, 150]);
      expect((await auditActions("business.success_fee_update"))[0].metadata).toMatchObject({ to: { flatCents: 2500, bps: 150 } });
      expectFail(await ops.setSuccessFeeOp(admin, form({ orgId, flatDollars: "25.001", percent: "1" })), "validation_failed");
      const [ownerUser] = await db.select().from(schema.users).where(eq(schema.users.email, "fee-owner@synthetic.example"));
      expectFail(await ops.setSuccessFeeOp({ userId: ownerUser.id, request: null }, form({ orgId, flatDollars: "0", percent: "0" })), "forbidden");
    });
  });

  describe("jobs", () => {
    it("retries a dead job and audits the operator retry", async () => {
      const { id } = await enqueue("synthetic.test_job", { n: 1 }, { maxAttempts: 1 });
      const db = await getDb();
      await db.update(schema.jobs).set({ status: "dead", attempts: 1, lastError: "synthetic failure" }).where(eq(schema.jobs.id, id));
      expectOk(await ops.retryJobOp(admin, form({ jobId: id })));
      const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      expect(job).toMatchObject({ status: "queued", attempts: 0 });
      const [entry] = await auditActions("job.retry");
      expect(entry.metadata).toEqual({ type: "synthetic.test_job", previousStatus: "dead", previousAttempts: 1 });
      expectFail(await ops.retryJobOp(admin, form({ jobId: "job_missing" })), "not_found");
    });

    it("refuses to retry a succeeded job", async () => {
      const { id } = await enqueue("synthetic.test_job", {});
      const db = await getDb();
      await db.update(schema.jobs).set({ status: "succeeded" }).where(eq(schema.jobs.id, id));
      expectFail(await ops.retryJobOp(admin, form({ jobId: id })), "conflict");
      expect(await auditActions("job.retry")).toHaveLength(0);
    });
  });

  describe("privacy", () => {
    async function household() {
      const db = await getDb();
      const owner = await makeUser("parent@synthetic.example");
      await db.update(schema.users).set({ phone: "+15125550100" }).where(eq(schema.users.id, owner.id));
      const [h] = await db
        .insert(schema.households)
        .values({ id: newId("household"), ownerUserId: owner.id, addressLine1: "100 SYNTHETIC LANE", city: "AUSTIN", state: "TX", zip: "78701", countyFips: "48453", countyName: "Travis County" })
        .returning();
      const { org } = await createSgo({ name: "Synthetic Privacy Fund", ownerEmail: "p-owner@synthetic.example" }, SYS);
      const [v] = await db
        .insert(schema.verifications)
        .values({ id: newId("verification"), orgId: org.id, householdId: h.id, status: "pending", familyTokenHash: hashToken(newToken()), familyTokenExpiresAt: new Date("2030-01-01T00:00:00Z") })
        .returning();
      return { h, v, org };
    }

    it("processes a deletion and cancels the verification it leaves open", async () => {
      const { h, v } = await household();
      expectFail(await ops.processDeletionOp(admin, form({ householdId: h.id, reason: "short" })), "validation_failed");
      const notice = expectOk(await ops.processDeletionOp(admin, form({ householdId: h.id, reason: "Parent asked by phone; identity confirmed; ticket SYN-42" })));
      expect(notice.details).toEqual(expect.arrayContaining([{ label: "Open verifications canceled", value: "1 of 1" }, { label: "Phone numbers cleared", value: "1" }]));
      const db = await getDb();
      const [after] = await db.select().from(schema.households).where(eq(schema.households.id, h.id));
      expect([after.addressLine1, after.zip, after.countyFips]).toEqual([null, null, null]);
      const [ver] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, v.id));
      expect(ver.status).toBe("canceled");
      expect(await auditActions("household.deletion_processed")).toHaveLength(1);
      expect(await auditActions("verification.cancel")).toHaveLength(1);

      // Re-running is safe and has nothing left to cancel.
      const again = expectOk(await ops.processDeletionOp(admin, form({ householdId: h.id, reason: "Re-run to confirm completion, ticket SYN-42" })));
      expect(again.details).toEqual(expect.arrayContaining([{ label: "Open verifications canceled", value: "0 of 0" }]));
    });

    it("refuses a non-admin and an unknown household", async () => {
      const { h } = await household();
      expectFail(await ops.processDeletionOp(outsider, form({ householdId: h.id, reason: "Not an admin trying to delete data" })), "forbidden");
      expectFail(await ops.processDeletionOp(admin, form({ householdId: "hh_missing", reason: "Unknown household identifier here" })), "not_found");
    });
  });

  describe("refunds", () => {
    it("validates before calling the donations service", async () => {
      expect(expectFail(await ops.refundOp(admin, form({ donationId: "don_x", reason: "short", counselReference: "MEMO-1" })), "validation_failed").fields?.reason).toBeDefined();
      expectFail(await ops.refundOp(admin, form({ donationId: "don_missing", reason: "Donor asked; counsel advised a refund in writing", counselReference: "" })), "validation_failed");
      expectFail(await ops.refundOp(admin, form({ donationId: "don_missing", reason: "Donor asked; counsel advised a refund in writing", counselReference: "MEMO-SYN-R" })), "not_found");
      expectFail(await ops.refundOp(outsider, form({ donationId: "don_missing", reason: "Donor asked; counsel advised a refund in writing", counselReference: "MEMO-SYN-R" })), "forbidden");
    });
  });
});
