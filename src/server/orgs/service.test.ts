import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { listOutbox } from "@/server/email";
import { ensurePlatformOrg, type User } from "@/server/auth";
import { useTestDb } from "../../../tests/helpers/db";
import { addMember, createOrganization, getOrg, getOrgBySlug, listMembers, listOrgsForUser, removeMember, updateMemberRole } from "./service";
import { slugify } from "./slug";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

describe("orgs", () => {
  useTestDb();
  let owner: User;
  let stranger: User;

  async function user(email: string): Promise<User> {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
    return u;
  }

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    owner = await user("owner@example.com");
    stranger = await user("stranger@example.com");
  });
  afterEach(() => setTestNow(null));

  describe("slugs", () => {
    it("slugifies names", () => {
      expect(slugify("Niños de Texas, Inc.")).toBe("ninos-de-texas-inc");
      expect(slugify("  A & B  ")).toBe("a-and-b");
      expect(slugify("!!!")).toBe("");
      expect(slugify("x".repeat(80)).length).toBe(48);
    });

    it("generates unique slugs and avoids reserved words", async () => {
      const a = await createOrganization({ type: "sgo", name: "Synthetic Scholarship Fund" });
      const b = await createOrganization({ type: "sgo", name: "Synthetic Scholarship Fund" });
      const c = await createOrganization({ type: "business", name: "Synthetic Scholarship Fund" });
      expect([a.slug, b.slug, c.slug]).toEqual(["synthetic-scholarship-fund", "synthetic-scholarship-fund-2", "synthetic-scholarship-fund-3"]);
      expect((await createOrganization({ type: "sgo", name: "Admin" })).slug).toBe("admin-org");
      expect((await createOrganization({ type: "sgo", name: "???" })).slug).toBe("org");
      expect((await createOrganization({ type: "sgo", name: "y".repeat(100) })).slug).toHaveLength(48);
      expect((await createOrganization({ type: "sgo", name: "y".repeat(100) })).slug).toMatch(/^y+-2$/);
    });

    it("validates explicit slugs", async () => {
      expect((await createOrganization({ type: "sgo", name: "Fund", slug: "my-fund" })).slug).toBe("my-fund");
      expect(await codeOf(createOrganization({ type: "sgo", name: "Fund", slug: "my-fund" }))).toBe("conflict");
      expect(await codeOf(createOrganization({ type: "sgo", name: "Fund", slug: "sgo" }))).toBe("validation_failed");
      expect(await codeOf(createOrganization({ type: "sgo", name: "Fund", slug: "Bad Slug!" }))).toBe("validation_failed");
      expect(await codeOf(createOrganization({ type: "sgo", name: "Fund", slug: "-x-" }))).toBe("validation_failed");
      expect(await codeOf(createOrganization({ type: "sgo", name: "   " }))).toBe("validation_failed");
      expect(await codeOf(createOrganization({ type: "nonsense" as "sgo", name: "Fund" }))).toBe("validation_failed");
    });

    it("allows exactly one platform organization", async () => {
      const p = await createOrganization({ type: "platform", name: "Platform" });
      expect(p.slug).toBe("platform");
      expect(await codeOf(createOrganization({ type: "platform", name: "Another" }))).toBe("conflict");
      expect((await ensurePlatformOrg()).id).toBe(p.id);
    });
  });

  it("creates an organization with its first owner, audited, and lists it for the user", async () => {
    const org = await createOrganization({ type: "sgo", name: "Synthetic SGO", ownerUserId: owner.id }, { userId: owner.id });
    expect((await getOrg(org.id))?.name).toBe("Synthetic SGO");
    expect((await getOrgBySlug("SYNTHETIC-SGO"))?.id).toBe(org.id);
    expect(await getOrg("org_missing")).toBeNull();
    const mine = await listOrgsForUser(owner.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].role).toBe("owner");
    const log = await listAuditLogs({ orgId: org.id, action: "org.create" });
    expect(log.items[0].actorId).toBe(owner.id);
  });

  describe("members", () => {
    let orgId: string;
    beforeEach(async () => {
      orgId = (await createOrganization({ type: "sgo", name: "Members SGO", ownerUserId: owner.id })).id;
    });

    it("adds a member by email, creating the account lazily, and emails an invitation without a credential", async () => {
      const r = await addMember({ orgId, email: " New.Reviewer@Example.com ", role: "reviewer" }, { userId: owner.id });
      expect(r.isNewUser).toBe(true);
      expect(r.user.email).toBe("new.reviewer@example.com");
      expect(r.membership.role).toBe("reviewer");

      const [mail] = await listOutbox({ to: "new.reviewer@example.com" });
      expect(mail.template).toBe("org_invitation");
      expect(mail.text).toContain("Members SGO");
      expect(mail.text).toContain("/sign-in?email=new.reviewer%40example.com&next=%2Fsgo");
      expect(mail.text).not.toMatch(/token=/);

      expect(await codeOf(addMember({ orgId, email: "new.reviewer@example.com", role: "viewer" }, { userId: owner.id }))).toBe("conflict");
      const existing = await addMember({ orgId, email: "stranger@example.com", role: "viewer" }, { userId: owner.id });
      expect(existing.isNewUser).toBe(false);
      expect(existing.user.id).toBe(stranger.id);
      expect((await listAuditLogs({ orgId, action: "org.member_add" })).items).toHaveLength(2);
    });

    it("enforces who may manage members", async () => {
      const admin = (await addMember({ orgId, email: "admin@example.com", role: "admin" }, { userId: owner.id })).user;
      const viewer = (await addMember({ orgId, email: "viewer@example.com", role: "viewer" }, { userId: owner.id })).user;

      // Outsiders and low roles cannot manage; missing orgs look the same as foreign ones.
      expect(await codeOf(addMember({ orgId, email: "x@example.com", role: "viewer" }, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(addMember({ orgId: "org_missing", email: "x@example.com", role: "viewer" }, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(addMember({ orgId, email: "x@example.com", role: "viewer" }, { userId: viewer.id }))).toBe("forbidden");
      expect(await codeOf(updateMemberRole({ orgId, userId: viewer.id, role: "admin" }, { userId: viewer.id }))).toBe("forbidden");

      // Admins manage non-owners but never touch the owner role.
      expect(await codeOf(addMember({ orgId, email: "y@example.com", role: "reviewer" }, { userId: admin.id }))).toBe("ok");
      expect(await codeOf(addMember({ orgId, email: "z@example.com", role: "owner" }, { userId: admin.id }))).toBe("forbidden");
      expect(await codeOf(updateMemberRole({ orgId, userId: viewer.id, role: "owner" }, { userId: admin.id }))).toBe("forbidden");
      expect(await codeOf(updateMemberRole({ orgId, userId: owner.id, role: "viewer" }, { userId: admin.id }))).toBe("forbidden");
      expect(await codeOf(removeMember({ orgId, userId: owner.id }, { userId: admin.id }))).toBe("forbidden");
      expect((await updateMemberRole({ orgId, userId: viewer.id, role: "reviewer" }, { userId: admin.id })).role).toBe("reviewer");

      expect(await codeOf(updateMemberRole({ orgId, userId: viewer.id, role: "superuser" as MemberRole }, { userId: owner.id }))).toBe("validation_failed");
      expect(await codeOf(updateMemberRole({ orgId, userId: stranger.id, role: "viewer" }, { userId: owner.id }))).toBe("not_found");
    });

    it("never removes or demotes the last owner", async () => {
      expect(await codeOf(updateMemberRole({ orgId, userId: owner.id, role: "admin" }, { userId: owner.id }))).toBe("conflict");
      expect(await codeOf(removeMember({ orgId, userId: owner.id }, { userId: owner.id }))).toBe("conflict");

      const second = (await addMember({ orgId, email: "second@example.com", role: "owner" }, { userId: owner.id })).user;
      expect((await updateMemberRole({ orgId, userId: owner.id, role: "admin" }, { userId: second.id })).role).toBe("admin");
      expect(await codeOf(removeMember({ orgId, userId: second.id }, { userId: second.id }))).toBe("conflict");
      const log = await listAuditLogs({ orgId, action: "org.member_role_update" });
      expect(log.items[0].metadata).toMatchObject({ from: "owner", to: "admin" });
    });

    it("keeps one owner when two owners demote each other at the same time", async () => {
      const second = (await addMember({ orgId, email: "second@example.com", role: "owner" }, { userId: owner.id })).user;
      const results = await Promise.allSettled([
        updateMemberRole({ orgId, userId: owner.id, role: "admin" }, { userId: second.id }),
        updateMemberRole({ orgId, userId: second.id, role: "admin" }, { userId: owner.id }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const owners = (await listMembers(orgId, { userId: owner.id })).filter((m) => m.membership.role === "owner");
      expect(owners).toHaveLength(1);
    });

    it("lets members remove themselves and lists members for members only", async () => {
      const viewer = (await addMember({ orgId, email: "viewer@example.com", role: "viewer" }, { userId: owner.id })).user;
      const list = await listMembers(orgId, { userId: viewer.id });
      expect(list.map((m) => m.user.email)).toEqual(["owner@example.com", "viewer@example.com"]);
      expect(await codeOf(listMembers(orgId, { userId: stranger.id }))).toBe("forbidden");

      await removeMember({ orgId, userId: viewer.id }, { userId: viewer.id });
      expect(await codeOf(listMembers(orgId, { userId: viewer.id }))).toBe("forbidden");
      expect((await listAuditLogs({ orgId, action: "org.member_remove" })).items[0].metadata).toMatchObject({ self: true });
      expect(await codeOf(removeMember({ orgId, userId: owner.id }, { userId: stranger.id }))).toBe("forbidden");
    });

    it("lets a platform admin manage any organization", async () => {
      const platform = await ensurePlatformOrg();
      const db = await getDb();
      await db.insert(schema.memberships).values({ id: newId("membership"), orgId: platform.id, userId: stranger.id, role: "owner" });
      const added = await addMember({ orgId, email: "rescued@example.com", role: "owner" }, { userId: stranger.id });
      expect(added.membership.role).toBe("owner");
      expect(await listMembers(orgId, { userId: stranger.id })).toHaveLength(2);
      await removeMember({ orgId, userId: owner.id }, { userId: stranger.id });
      expect(await listOrgsForUser(owner.id)).toHaveLength(0);
    });
  });
});
