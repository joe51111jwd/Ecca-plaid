import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { hashToken } from "@/lib/crypto";
import { newId, newToken } from "@/lib/ids";
import { ensurePlatformOrg } from "@/server/auth";
import { createBusiness, businessSystemActor } from "@/server/businesses";
import { createSgo, importSgoList, systemActor } from "@/server/sgos";
import { useTestDb } from "../../../../tests/helpers/db";
import {
  countListedEntriesBySource,
  findHouseholds,
  getListEntry,
  getOrganization,
  getOverviewCounts,
  getRefundCandidate,
  getVerificationScopes,
  listOrganizations,
  setOrganizationStatus,
} from "./queries";

/** Every person, organization, EIN and household in this file is SYNTHETIC. */

const SYS = systemActor("admin-ui queries test");
const HEADER = "state,name,ein,status,listed_from,removed_on";

async function user(email: string) {
  const db = await getDb();
  const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
  return u;
}

describe("admin queries", () => {
  useTestDb();
  let adminId: string;

  beforeEach(async () => {
    const db = await getDb();
    const platform = await ensurePlatformOrg(db);
    adminId = (await user("admin@synthetic.example")).id;
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId: platform.id, userId: adminId, role: "owner" });
  });

  it("counts an empty platform as zeros, with every key present", async () => {
    const c = await getOverviewCounts();
    expect(c.orgs.sgo).toEqual({ pending: 0, active: 0, suspended: 0 });
    expect(c.orgs.platform.active).toBe(1);
    expect(c.verifications.live).toEqual({ pending: 0, eligible: 0, ineligible: 0, needs_review: 0, expired: 0, canceled: 0 });
    expect(c.succeededDonations).toEqual({ test: { count: 0, designatedCents: 0 }, live: { count: 0, designatedCents: 0 } });
    expect([c.households, c.openReviewTasks, c.failedEmails]).toEqual([0, 0, 0]);
  });

  it("counts organizations by type and status, verifications by mode, and failed emails", async () => {
    const { org: a } = await createSgo({ name: "Synthetic Count Fund A", ownerEmail: "a@synthetic.example" }, SYS);
    await createSgo({ name: "Synthetic Count Fund B", ownerEmail: "b@synthetic.example" }, SYS);
    await createBusiness({ name: "Synthetic Count Camp", vendorType: "summer_camp", billingEmail: "c@synthetic.example", ownerEmail: "c@synthetic.example" }, businessSystemActor("test"));
    await setOrganizationStatus({ orgId: a.id, status: "suspended", reason: "Synthetic suspension for counting" }, { userId: adminId, request: null });
    const db = await getDb();
    for (const [mode, status] of [["live", "needs_review"], ["live", "pending"], ["test", "eligible"]] as const) {
      await db.insert(schema.verifications).values({ id: newId("verification"), orgId: a.id, mode, status, familyTokenHash: hashToken(newToken()), familyTokenExpiresAt: new Date("2030-01-01T00:00:00Z") });
    }
    await db.insert(schema.emails).values({ id: newId("email"), toEmail: "x@synthetic.example", fromEmail: "f@synthetic.example", subject: "s", template: "t", html: "h", text: "t", status: "failed" });

    const c = await getOverviewCounts();
    expect(c.orgs.sgo).toEqual({ pending: 0, active: 1, suspended: 1 });
    expect(c.orgs.business.active).toBe(1);
    expect(c.verifications.live.needs_review).toBe(1);
    expect(c.verifications.live.pending).toBe(1);
    expect(c.verifications.test.eligible).toBe(1);
    expect(c.failedEmails).toBe(1);
  });

  it("counts only listed entries per source and finds one entry", async () => {
    await importSgoList({ source: "provisional_curated", csv: `${HEADER}\nTX,Synthetic L1,,listed,,\nTX,Synthetic R1,,removed,,2027-02-01`, retrievedAt: new Date("2026-11-01T12:00:00Z") }, SYS);
    expect(await countListedEntriesBySource()).toEqual({ provisional_curated: 1, irs_published: 0 });
    const db = await getDb();
    const [row] = await db.select().from(schema.sgoListEntries).limit(1);
    expect((await getListEntry(row.id))?.id).toBe(row.id);
    expect(await getListEntry("sle_missing")).toBeNull();
  });

  it("lists organizations with member counts and profile facts, filtered and searched literally", async () => {
    const { org: sgo } = await createSgo({ name: "Synthetic 100% Fund", ein: "00-5555555", ownerEmail: "o1@synthetic.example" }, SYS);
    await createSgo({ name: "Synthetic 1000 Fund", ownerEmail: "o2@synthetic.example" }, SYS);
    const { org: biz } = await createBusiness({ name: "Synthetic_Under Camp", vendorType: "tutoring", billingEmail: "o3@synthetic.example", ownerEmail: "o3@synthetic.example" }, businessSystemActor("test"));

    const all = await listOrganizations();
    expect(all.map((r) => r.org.type).sort()).toEqual(["business", "platform", "sgo", "sgo"]);
    const sgoRow = all.find((r) => r.org.id === sgo.id)!;
    expect(sgoRow).toMatchObject({ memberCount: 1, sgo: { ein: "00-5555555", state: "TX", listEntryId: null }, business: null });
    expect(all.find((r) => r.org.id === biz.id)?.business).toEqual({ vendorType: "tutoring", successFeeFlatCents: 0, successFeeBps: 0 });
    expect(all.find((r) => r.org.type === "platform")?.memberCount).toBe(1);

    expect((await listOrganizations({ q: "100%" })).map((r) => r.org.id)).toEqual([sgo.id]);
    expect((await listOrganizations({ q: "_under" })).map((r) => r.org.id)).toEqual([biz.id]);
    expect((await listOrganizations({ q: "s_n" })).length).toBe(0);
    expect((await listOrganizations({ type: "business" })).map((r) => r.org.id)).toEqual([biz.id]);
    expect(await listOrganizations({ status: "suspended" })).toEqual([]);
    expect((await getOrganization(sgo.id))?.name).toBe("Synthetic 100% Fund");
    expect(await getOrganization("")).toBeNull();
    expect(await getOrganization("x".repeat(101))).toBeNull();
  });

  it("refuses a status change from a non-admin and writes nothing", async () => {
    const { org } = await createSgo({ name: "Synthetic Guard Fund", ownerEmail: "g@synthetic.example" }, SYS);
    const owner = (await (await getDb()).select().from(schema.users).where(eq(schema.users.email, "g@synthetic.example")))[0];
    await expect(setOrganizationStatus({ orgId: org.id, status: "suspended", reason: "The owner tries to suspend" }, { userId: owner.id, request: null })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setOrganizationStatus({ orgId: org.id, status: "suspended", reason: "   " }, { userId: adminId, request: null })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await getOrganization(org.id))?.status).toBe("active");
  });

  describe("households", () => {
    async function household(email: string) {
      const db = await getDb();
      const owner = await user(email);
      const [h] = await db.insert(schema.households).values({ id: newId("household"), ownerUserId: owner.id, addressLine1: "1 SYNTHETIC WAY", zip: "78701", countyName: "Travis County" }).returning();
      await db.insert(schema.householdMembers).values([
        { id: newId("member"), householdId: h.id, kind: "adult", firstName: "Avery", lastName: "Synthetic", isOwner: true },
        { id: newId("member"), householdId: h.id, kind: "student", firstName: "Riley", lastName: "Synthetic", removedAt: new Date("2026-10-01T00:00:00Z") },
      ]);
      return h;
    }

    it("finds by exact household id or exact owner email (case-insensitive), never by partial match", async () => {
      const h = await household("parent@synthetic.example");
      await household("other@synthetic.example");
      expect((await findHouseholds("PARENT@synthetic.example")).map((m) => m.householdId)).toEqual([h.id]);
      expect((await findHouseholds(h.id)).map((m) => m.householdId)).toEqual([h.id]);
      expect(await findHouseholds("parent@")).toEqual([]);
      expect(await findHouseholds(h.id.slice(0, 8))).toEqual([]);
      expect(await findHouseholds("%")).toEqual([]);
      expect(await findHouseholds("   ")).toEqual([]);
      const [m] = await findHouseholds(h.id);
      expect(m).toMatchObject({ ownerEmail: "parent@synthetic.example", countyName: "Travis County", addressCleared: false, members: 1, documents: 0, openVerifications: 0, activeConsents: 0, openRailConnections: 0 });
    });

    it("returns the organization and mode of verifications", async () => {
      const { org } = await createSgo({ name: "Synthetic Scope Fund", ownerEmail: "sc@synthetic.example" }, SYS);
      const db = await getDb();
      const id = newId("verification");
      await db.insert(schema.verifications).values({ id, orgId: org.id, mode: "live", familyTokenHash: hashToken(newToken()), familyTokenExpiresAt: new Date("2030-01-01T00:00:00Z") });
      expect(await getVerificationScopes([id])).toEqual([{ id, orgId: org.id, mode: "live", status: "pending" }]);
      expect(await getVerificationScopes([])).toEqual([]);
    });
  });

  it("returns null for an unknown or malformed donation id", async () => {
    expect(await getRefundCandidate("don_missing")).toBeNull();
    expect(await getRefundCandidate("")).toBeNull();
    expect(await getRefundCandidate("x".repeat(101))).toBeNull();
  });
});
