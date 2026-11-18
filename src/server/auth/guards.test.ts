import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import type { MemberRole, OrgType } from "@/db/schema";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { useTestDb } from "../../../tests/helpers/db";
import {
  assertHouseholdAccess,
  assertOrgMember,
  assertPlatformAdmin,
  getMemberships,
  getPrimaryOrg,
  minimumRole,
  requireOrgMember,
  requireOrgType,
  requireUser,
  requireUserOrThrow,
  roleAtLeast,
} from "./guards";
import { defaultLandingPath } from "./platform";
import { createSession, SESSION_COOKIE, type User } from "./session";

// Request context stand-ins: a cookie jar and a redirect that throws like Next's does.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
// React's request cache is a no-op outside a request; make it explicit so each call re-reads the jar.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

describe("guards", () => {
  useTestDb();
  let alice: User;
  let bob: User;

  async function user(email: string): Promise<User> {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
    return u;
  }
  async function org(type: OrgType, slug: string) {
    const db = await getDb();
    const [o] = await db.insert(schema.organizations).values({ id: newId("org"), type, name: slug, slug }).returning();
    return o;
  }
  async function member(orgId: string, userId: string, role: MemberRole) {
    const db = await getDb();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId, role });
  }

  beforeEach(async () => {
    jar.clear();
    alice = await user("alice@example.com");
    bob = await user("bob@example.com");
  });
  afterEach(() => jar.clear());

  it("orders roles owner > admin > reviewer > viewer", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("reviewer", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "reviewer")).toBe(false);
    expect(minimumRole()).toBe("viewer");
    expect(minimumRole([])).toBe("viewer");
    expect(minimumRole("admin")).toBe("admin");
    expect(minimumRole(["owner", "reviewer", "admin"])).toBe("reviewer");
  });

  describe("requireUser", () => {
    it("redirects to sign-in with a sanitized next path when signed out", async () => {
      await expect(requireUser({ returnTo: "/sgo/verifications?page=2" })).rejects.toMatchObject({ url: "/sign-in?next=%2Fsgo%2Fverifications%3Fpage%3D2" });
      await expect(requireUser({ returnTo: "//evil.com" })).rejects.toMatchObject({ url: "/sign-in" });
      await expect(requireUser()).rejects.toMatchObject({ url: "/sign-in" });
      expect(await codeOf(requireUserOrThrow())).toBe("unauthenticated");
    });

    it("returns the user for a live session cookie and rejects a revoked or forged one", async () => {
      const { token } = await createSession(alice.id);
      jar.set(SESSION_COOKIE, token);
      expect((await requireUser()).id).toBe(alice.id);
      expect((await requireUserOrThrow()).id).toBe(alice.id);
      jar.set(SESSION_COOKIE, "A".repeat(43));
      expect(await codeOf(requireUserOrThrow())).toBe("unauthenticated");
    });
  });

  describe("organization access", () => {
    it("enforces membership and role, and denies cross-org access", async () => {
      const sgoA = await org("sgo", "sgo-a");
      const sgoB = await org("sgo", "sgo-b");
      await member(sgoA.id, alice.id, "reviewer");
      await member(sgoB.id, bob.id, "owner");

      const access = await assertOrgMember(alice, sgoA.id);
      expect(access.org.id).toBe(sgoA.id);
      expect(access.membership.role).toBe("reviewer");
      expect(await codeOf(assertOrgMember(alice, sgoA.id, "reviewer"))).toBe("ok");
      expect(await codeOf(assertOrgMember(alice, sgoA.id, "admin"))).toBe("forbidden");
      expect(await codeOf(assertOrgMember(alice, sgoA.id, ["admin", "owner"]))).toBe("forbidden");
      expect(await codeOf(assertOrgMember(alice, sgoB.id))).toBe("forbidden");
      expect(await codeOf(assertOrgMember(bob, sgoA.id, "viewer"))).toBe("forbidden");
      // A missing organization looks exactly like a foreign one.
      expect(await codeOf(assertOrgMember(alice, "org_doesnotexist"))).toBe("forbidden");
      expect(await codeOf(assertOrgMember(alice, ""))).toBe("forbidden");
    });

    it("requireOrgMember reads the user from the session", async () => {
      const sgo = await org("sgo", "sgo-c");
      await member(sgo.id, alice.id, "admin");
      expect(await codeOf(requireOrgMember(sgo.id))).toBe("unauthenticated");
      jar.set(SESSION_COOKIE, (await createSession(alice.id)).token);
      expect((await requireOrgMember(sgo.id, "admin")).membership.role).toBe("admin");
      expect(await codeOf(requireOrgMember(sgo.id, "owner"))).toBe("forbidden");
    });

    it("checks organization type", async () => {
      const biz = await org("business", "camp-one");
      expect((await requireOrgType(biz.id, "business")).id).toBe(biz.id);
      expect(await codeOf(requireOrgType(biz.id, "sgo"))).toBe("not_found");
      expect(await codeOf(requireOrgType("org_missing", "sgo"))).toBe("not_found");
    });

    it("identifies platform admins only through the platform organization", async () => {
      const platform = await org("platform", "platform");
      const sgo = await org("sgo", "sgo-d");
      await member(sgo.id, bob.id, "owner");
      expect(await codeOf(assertPlatformAdmin(bob))).toBe("forbidden");
      await member(platform.id, alice.id, "viewer");
      expect((await assertPlatformAdmin(alice)).org.id).toBe(platform.id);
    });

    it("picks the primary organization of a type and honours an org switcher", async () => {
      const first = await org("sgo", "sgo-first");
      const second = await org("sgo", "sgo-second");
      const biz = await org("business", "biz-x");
      const foreign = await org("sgo", "sgo-foreign");
      await member(first.id, alice.id, "viewer");
      await member(second.id, alice.id, "owner");
      await member(biz.id, alice.id, "admin");

      const primary = await getPrimaryOrg(alice, "sgo");
      expect(primary?.org.id).toBe(first.id);
      expect(primary?.options.map((o) => o.org.id)).toEqual([first.id, second.id]);
      expect((await getPrimaryOrg(alice, "sgo", { orgId: second.id }))?.membership.role).toBe("owner");
      expect(await codeOf(getPrimaryOrg(alice, "sgo", { orgId: foreign.id }))).toBe("forbidden");
      expect(await codeOf(getPrimaryOrg(alice, "sgo", { orgId: biz.id }))).toBe("forbidden");
      expect(await getPrimaryOrg(bob, "sgo")).toBeNull();
      expect(await getMemberships(alice.id)).toHaveLength(3);
    });

    it("chooses the landing page by role", async () => {
      expect(await defaultLandingPath(alice.id)).toBe("/family");
      await member((await org("business", "biz-y")).id, alice.id, "viewer");
      expect(await defaultLandingPath(alice.id)).toBe("/partner");
      await member((await org("sgo", "sgo-y")).id, alice.id, "viewer");
      expect(await defaultLandingPath(alice.id)).toBe("/sgo");
      await member((await org("platform", "platform")).id, alice.id, "owner");
      expect(await defaultLandingPath(alice.id)).toBe("/admin");
    });
  });

  describe("household access", () => {
    it("allows the owner and linked adult members only", async () => {
      const carol = await user("carol@example.com");
      const dave = await user("dave@example.com");
      const db = await getDb();
      const [hh] = await db.insert(schema.households).values({ id: newId("household"), ownerUserId: alice.id }).returning();
      await db.insert(schema.householdMembers).values([
        { id: newId("member"), householdId: hh.id, kind: "adult", firstName: "Synthetic", lastName: "Adult", userId: bob.id },
        { id: newId("member"), householdId: hh.id, kind: "student", firstName: "Synthetic", lastName: "Student", userId: carol.id },
        { id: newId("member"), householdId: hh.id, kind: "adult", firstName: "Removed", lastName: "Adult", userId: dave.id, removedAt: new Date("2026-11-01T00:00:00Z") },
      ]);

      expect((await assertHouseholdAccess(alice, hh.id)).access).toBe("owner");
      expect((await assertHouseholdAccess(bob, hh.id)).access).toBe("adult");
      expect(await codeOf(assertHouseholdAccess(carol, hh.id))).toBe("not_found");
      expect(await codeOf(assertHouseholdAccess(dave, hh.id))).toBe("not_found");
      expect(await codeOf(assertHouseholdAccess(alice, "hh_missing"))).toBe("not_found");
    });
  });
});
