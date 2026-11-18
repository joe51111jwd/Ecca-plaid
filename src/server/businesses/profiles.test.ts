import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { ensurePlatformOrg, type User } from "@/server/auth";
import { setSetting } from "@/server/settings";
import { useTestDb } from "../../../tests/helpers/db";
import { businessSystemActor } from "./access";
import { describeFeeTerms } from "./fees";
import {
  createBusiness,
  getBusinessByPublishableKey,
  getBusinessProfile,
  newPublishableKey,
  PUBLISHABLE_KEY_PATTERN,
  publishableKeyModeOf,
  resolvePublishableKey,
  rotatePublishableKey,
  setSuccessFee,
  updateBusinessProfile,
} from "./profiles";
import { isAllowedOrigin, isAllowedReturnUrl } from "./validation";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; fields: Record<string, string> }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, fields: ((e.details as { fields?: Record<string, string> }) ?? {}).fields ?? {} };
    throw e;
  }
  throw new Error("expected an error");
}

// All people, businesses and addresses below are synthetic.
describe("business profiles", () => {
  useTestDb();
  let owner: User;
  let stranger: User;
  let admin: User;

  async function user(email: string): Promise<User> {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
    return u;
  }

  async function member(orgId: string, u: User, role: MemberRole): Promise<void> {
    const db = await getDb();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId: u.id, role });
  }

  async function newBusiness(name = "Synthetic Summer Camp") {
    return createBusiness({ name, vendorType: "summer_camp", billingEmail: "billing@camp.example", ownerEmail: owner.email }, { userId: owner.id });
  }

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    owner = await user("owner@camp.example");
    stranger = await user("stranger@elsewhere.example");
    admin = await user("admin@platform.example");
    const platform = await ensurePlatformOrg();
    await member(platform.id, admin, "owner");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
  });

  describe("createBusiness", () => {
    it("creates the organization, profile and owner membership, with the platform default fee", async () => {
      await setSetting("business.defaultSuccessFee", { flatCents: 1500, bps: 100 }, { actorUserId: admin.id });
      const { org, profile } = await createBusiness(
        { name: "  Synthetic   Summer Camp ", vendorType: "summer_camp", website: "camp.example", billingEmail: " Billing@Camp.Example ", ownerEmail: "OWNER@camp.example" },
        { userId: owner.id },
      );
      expect(org).toMatchObject({ type: "business", name: "Synthetic Summer Camp", status: "active" });
      expect(profile).toMatchObject({
        orgId: org.id,
        displayName: "Synthetic Summer Camp",
        vendorType: "summer_camp",
        website: "https://camp.example/",
        billingEmail: "billing@camp.example",
        successFeeFlatCents: 1500,
        successFeeBps: 100,
        holdWindowHours: 72,
        allowedOrigins: [],
        brandColor: null,
        logoUrl: null,
      });
      expect(profile.publishableKey).toMatch(PUBLISHABLE_KEY_PATTERN);
      expect(profile.publishableKey.startsWith("pk_test_")).toBe(true);

      const db = await getDb();
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, org.id));
      expect(m).toMatchObject({ userId: owner.id, role: "owner" });

      const audits = await listAuditLogs({ orgId: org.id });
      expect(audits.items.map((a) => a.action).sort()).toEqual(["business.create", "org.create"]);
      const created = audits.items.find((a) => a.action === "business.create")!;
      expect(created).toMatchObject({ actorType: "user", actorId: owner.id, targetType: "business", targetId: org.id });
      expect(created.metadata).toMatchObject({ vendorType: "summer_camp", successFee: { flatCents: 1500, bps: 100 } });
    });

    it("copies the default, so later changes to the default do not move existing terms", async () => {
      const { org } = await newBusiness();
      await setSetting("business.defaultSuccessFee", { flatCents: 999, bps: 5 }, { actorUserId: admin.id });
      const { profile } = await getBusinessProfile(org.id);
      expect([profile.successFeeFlatCents, profile.successFeeBps]).toEqual([0, 0]);
    });

    it("creates the owner's account when a platform admin names a new address", async () => {
      const { org } = await createBusiness({ name: "Synthetic Microschool", vendorType: "microschool", billingEmail: "ap@micro.example", ownerEmail: "founder@micro.example" }, { userId: admin.id });
      const db = await getDb();
      const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "founder@micro.example"));
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, org.id));
      expect(m).toMatchObject({ userId: u.id, role: "owner" });
    });

    it("lets system code create a business and records why", async () => {
      const { org } = await createBusiness({ name: "Synthetic Tutoring", vendorType: "tutoring", billingEmail: "a@tutor.example", ownerEmail: "t@tutor.example" }, businessSystemActor("seed"));
      const audits = await listAuditLogs({ orgId: org.id, action: "business.create" });
      expect(audits.items[0]).toMatchObject({ actorType: "system", metadata: expect.objectContaining({ systemReason: "seed" }) });
      expect(await codeOf(createBusiness({ name: "X", vendorType: "tutoring", billingEmail: "a@tutor.example", ownerEmail: "t@tutor.example" }, businessSystemActor(" ")))).toBe("forbidden");
    });

    it("refuses to sign up a business for someone else", async () => {
      expect(await codeOf(createBusiness({ name: "Synthetic", vendorType: "other", billingEmail: "b@x.example", ownerEmail: owner.email }, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(createBusiness({ name: "Synthetic", vendorType: "other", billingEmail: "b@x.example", ownerEmail: owner.email }, { userId: "usr_missing" }))).toBe("forbidden");
      expect(await codeOf(createBusiness({ name: "Synthetic", vendorType: "other", billingEmail: "b@x.example", ownerEmail: owner.email }, { userId: "" }))).toBe("forbidden");
    });

    it("validates input", async () => {
      const bad = await errorOf(
        createBusiness({ name: " ", vendorType: "space_camp" as never, website: "javascript:alert(1)", billingEmail: "nope", ownerEmail: owner.email }, { userId: owner.id }),
      );
      expect(bad.code).toBe("validation_failed");
      expect(Object.keys(bad.fields).sort()).toEqual(["billingEmail", "name", "vendorType", "website"]);
      expect(await codeOf(createBusiness({ name: "A", vendorType: "other", billingEmail: "b@x.example", ownerEmail: owner.email, extra: 1 } as never, { userId: owner.id }))).toBe("validation_failed");
      expect(await codeOf(createBusiness({ name: "A\u0000B", vendorType: "other", billingEmail: "b@x.example", ownerEmail: owner.email }, { userId: owner.id }))).toBe("validation_failed");
    });
  });

  describe("publishable keys", () => {
    it("formats keys by mode and parses them back", () => {
      expect(newPublishableKey("test")).toMatch(/^pk_test_[A-Za-z0-9_-]{32}$/);
      expect(newPublishableKey("live")).toMatch(/^pk_live_[A-Za-z0-9_-]{32}$/);
      expect(newPublishableKey("test")).not.toBe(newPublishableKey("test"));
      expect(publishableKeyModeOf(newPublishableKey("live"))).toBe("live");
      for (const bad of ["", "pk_test_", "pk_prod_" + "a".repeat(32), "sk_test_" + "a".repeat(32), "pk_test_" + "a".repeat(31), `pk_test_${"a".repeat(31)}!`, null, 1]) {
        expect(publishableKeyModeOf(bad)).toBeNull();
      }
    });

    it("returns only public branding fields for a key", async () => {
      const { org, profile } = await newBusiness();
      await updateBusinessProfile(
        org.id,
        { brandColor: "#1f4e79", logoUrl: "https://cdn.camp.example/logo.png", allowedOrigins: ["https://camp.example"], holdWindowHours: 48 },
        { userId: owner.id },
      );
      await setSuccessFee(org.id, { flatCents: 2500, bps: 0 }, { userId: admin.id });
      const pub = await getBusinessByPublishableKey(profile.publishableKey);
      expect(pub).toEqual({
        businessOrgId: org.id,
        displayName: "Synthetic Summer Camp",
        vendorType: "summer_camp",
        website: null,
        brandColor: "#1F4E79",
        logoUrl: "https://cdn.camp.example/logo.png",
        holdWindowHours: 48,
        mode: "test",
      });
      const serialized = JSON.stringify(pub);
      for (const secretish of ["billing@camp.example", "successFee", "allowedOrigins", "publishableKey", "paymentsCustomerId", "settings", "2500", profile.publishableKey]) {
        expect(serialized).not.toContain(secretish);
      }
    });

    it("resolves the full record server-side for origin checks", async () => {
      const { org, profile } = await newBusiness();
      await updateBusinessProfile(org.id, { allowedOrigins: ["https://camp.example"] }, { userId: owner.id });
      const r = await resolvePublishableKey(profile.publishableKey);
      expect(r?.org.id).toBe(org.id);
      expect(r?.mode).toBe("test");
      expect(isAllowedOrigin(r!.profile, "https://camp.example")).toBe(true);
      expect(isAllowedReturnUrl(r!.profile, "https://camp.example/thanks")).toBe(true);
      expect(isAllowedReturnUrl(r!.profile, "https://camp.example.evil.example/thanks")).toBe(false);
    });

    it("returns null for unknown, malformed, wrong-mode keys and suspended businesses", async () => {
      const { org, profile } = await newBusiness();
      expect(await getBusinessByPublishableKey(newPublishableKey("test"))).toBeNull();
      expect(await getBusinessByPublishableKey("not-a-key")).toBeNull();
      expect(await getBusinessByPublishableKey(`${profile.publishableKey}'--`)).toBeNull();
      expect(await getBusinessByPublishableKey(undefined)).toBeNull();
      expect(await getBusinessByPublishableKey(profile.publishableKey.replace("pk_test_", "pk_live_"))).toBeNull();

      vi.stubEnv("NODE_ENV", "production");
      expect(await getBusinessByPublishableKey(profile.publishableKey)).toBeNull();
      vi.unstubAllEnvs();

      const db = await getDb();
      await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, org.id));
      expect(await getBusinessByPublishableKey(profile.publishableKey)).toBeNull();
    });

    it("rotates the key: the old one stops working at once", async () => {
      const { org, profile } = await newBusiness();
      const rotated = await rotatePublishableKey(org.id, { userId: owner.id });
      expect(rotated.publishableKey).not.toBe(profile.publishableKey);
      expect(rotated.publishableKey).toMatch(PUBLISHABLE_KEY_PATTERN);
      expect(await getBusinessByPublishableKey(profile.publishableKey)).toBeNull();
      expect((await getBusinessByPublishableKey(rotated.publishableKey))?.businessOrgId).toBe(org.id);
      const audits = await listAuditLogs({ orgId: org.id, action: "business.publishable_key_rotate" });
      expect(audits.items).toHaveLength(1);
      expect(JSON.stringify(audits.items[0].metadata)).not.toContain(rotated.publishableKey);
    });

    it("lets only owners, admins and platform admins rotate", async () => {
      const { org } = await newBusiness();
      const viewer = await user("viewer@camp.example");
      const reviewer = await user("reviewer@camp.example");
      const otherAdmin = await user("admin@camp.example");
      await member(org.id, viewer, "viewer");
      await member(org.id, reviewer, "reviewer");
      await member(org.id, otherAdmin, "admin");
      expect(await codeOf(rotatePublishableKey(org.id, { userId: viewer.id }))).toBe("forbidden");
      expect(await codeOf(rotatePublishableKey(org.id, { userId: reviewer.id }))).toBe("forbidden");
      expect(await codeOf(rotatePublishableKey(org.id, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(rotatePublishableKey(org.id, { userId: otherAdmin.id }))).toBe("ok");
      expect(await codeOf(rotatePublishableKey(org.id, { userId: admin.id }))).toBe("ok");
    });
  });

  describe("getBusinessProfile", () => {
    it("is not_found for missing or non-business organizations", async () => {
      const platform = await ensurePlatformOrg();
      expect(await codeOf(getBusinessProfile("org_missing"))).toBe("not_found");
      expect(await codeOf(getBusinessProfile(""))).toBe("not_found");
      expect(await codeOf(getBusinessProfile(platform.id))).toBe("not_found");
    });
  });

  describe("updateBusinessProfile", () => {
    it("updates fields, normalizes them and audits the diff", async () => {
      const { org } = await newBusiness();
      const updated = await updateBusinessProfile(
        org.id,
        {
          displayName: "Synthetic Camp (Renamed)",
          vendorType: "after_school",
          website: "https://www.camp.example",
          billingEmail: "AP@camp.example",
          brandColor: "#0b5394",
          logoUrl: "https://cdn.camp.example/logo.svg",
          holdWindowHours: 720,
          allowedOrigins: ["https://camp.example/", "HTTPS://camp.example", "https://www.camp.example", "http://localhost:3100"],
        },
        { userId: owner.id },
      );
      expect(updated).toMatchObject({
        displayName: "Synthetic Camp (Renamed)",
        vendorType: "after_school",
        website: "https://www.camp.example/",
        billingEmail: "ap@camp.example",
        brandColor: "#0B5394",
        logoUrl: "https://cdn.camp.example/logo.svg",
        holdWindowHours: 720,
        allowedOrigins: ["https://camp.example", "https://www.camp.example", "http://localhost:3100"],
      });
      const audits = await listAuditLogs({ orgId: org.id, action: "business.profile_update" });
      expect(audits.items).toHaveLength(1);
      const changes = (audits.items[0].metadata as { changes: Record<string, { from: unknown; to: unknown }> }).changes;
      expect(Object.keys(changes).sort()).toEqual(["allowedOrigins", "billingEmail", "brandColor", "displayName", "holdWindowHours", "logoUrl", "vendorType", "website"]);
      expect(changes.holdWindowHours).toEqual({ from: 72, to: 720 });
    });

    it("clears optional fields with empty strings and skips no-op updates", async () => {
      const { org } = await newBusiness();
      await updateBusinessProfile(org.id, { brandColor: "#1F4E79", logoUrl: "https://cdn.camp.example/l.png" }, { userId: owner.id });
      const cleared = await updateBusinessProfile(org.id, { brandColor: "", logoUrl: "  ", website: "" }, { userId: owner.id });
      expect(cleared).toMatchObject({ brandColor: null, logoUrl: null, website: null });
      await updateBusinessProfile(org.id, { brandColor: null, allowedOrigins: [] }, { userId: owner.id });
      expect((await listAuditLogs({ orgId: org.id, action: "business.profile_update" })).items).toHaveLength(2);
    });

    it.each([
      [{ vendorType: "space_camp" }, "vendorType", /Choose a vendor type/],
      [{ brandColor: "#FFFF00" }, "brandColor", /hard to read.*darker shade such as #[0-9A-F]{6}/],
      [{ brandColor: "#FFF" }, "brandColor", /six hex digits/],
      [{ logoUrl: "http://cdn.camp.example/logo.png" }, "logoUrl", /https/],
      [{ logoUrl: "data:image/png;base64,AAAA" }, "logoUrl", /https/],
      [{ holdWindowHours: 0 }, "holdWindowHours", /at least 1 hour/],
      [{ holdWindowHours: 721 }, "holdWindowHours", /at most 720/],
      [{ holdWindowHours: 1.5 }, "holdWindowHours", /whole hours/],
      [{ holdWindowHours: "24" }, "holdWindowHours", /whole hours/],
      [{ allowedOrigins: ["https://*.camp.example"] }, "allowedOrigins.0", /wildcards/],
      [{ allowedOrigins: ["https://camp.example", "http://camp.example"] }, "allowedOrigins.1", /https/],
      [{ allowedOrigins: ["https://camp.example/book"] }, "allowedOrigins.0", /no path/],
      [{ allowedOrigins: "https://camp.example" }, "allowedOrigins", /list/],
      [{ allowedOrigins: Array.from({ length: 21 }, (_, i) => `https://s${i}.camp.example`) }, "allowedOrigins", /at most 20/],
      [{ billingEmail: "not-an-email" }, "billingEmail", /./],
      [{ displayName: "" }, "displayName", /name/],
    ])("rejects %j", async (patch, field, message) => {
      const { org } = await newBusiness();
      const e = await errorOf(updateBusinessProfile(org.id, patch as never, { userId: owner.id }));
      expect(e.code).toBe("validation_failed");
      expect(e.fields[field]).toMatch(message);
    });

    it("refuses unknown keys, commercial fields and empty patches", async () => {
      const { org } = await newBusiness();
      for (const patch of [{}, { successFeeBps: 0 }, { publishableKey: "pk_test_x" }, { paymentsCustomerId: "cus_x" }, { settings: {} }]) {
        expect(await codeOf(updateBusinessProfile(org.id, patch as never, { userId: owner.id }))).toBe("validation_failed");
      }
    });

    it("refuses localhost origins in production", async () => {
      const { org } = await newBusiness();
      vi.stubEnv("NODE_ENV", "production");
      expect(await codeOf(updateBusinessProfile(org.id, { allowedOrigins: ["http://localhost:3100"] }, { userId: owner.id }))).toBe("validation_failed");
    });

    it("checks the actor's role in this business", async () => {
      const { org } = await newBusiness();
      const other = await newBusiness("Synthetic Other Camp");
      const viewer = await user("viewer@camp.example");
      await member(org.id, viewer, "viewer");
      expect(await codeOf(updateBusinessProfile(org.id, { holdWindowHours: 24 }, { userId: viewer.id }))).toBe("forbidden");
      expect(await codeOf(updateBusinessProfile(org.id, { holdWindowHours: 24 }, { userId: stranger.id }))).toBe("forbidden");
      // The owner of one business cannot edit another.
      const otherOwner = await user("owner@other.example");
      await member(other.org.id, otherOwner, "owner");
      expect(await codeOf(updateBusinessProfile(org.id, { holdWindowHours: 24 }, { userId: otherOwner.id }))).toBe("forbidden");
      // A stranger learns nothing about whether an organization exists.
      expect(await codeOf(updateBusinessProfile("org_missing", { holdWindowHours: 24 }, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(updateBusinessProfile("org_missing", { holdWindowHours: 24 }, { userId: admin.id }))).toBe("not_found");
      expect(await codeOf(updateBusinessProfile(org.id, { holdWindowHours: 24 }, { userId: admin.id }))).toBe("ok");
    });
  });

  describe("setSuccessFee", () => {
    it("is for platform admins only and is audited", async () => {
      const { org } = await newBusiness();
      expect(await codeOf(setSuccessFee(org.id, { flatCents: 0, bps: 0 }, { userId: owner.id }))).toBe("forbidden");
      expect(await codeOf(setSuccessFee(org.id, { flatCents: 0, bps: 0 }, { userId: stranger.id }))).toBe("forbidden");
      const updated = await setSuccessFee(org.id, { flatCents: 2500, bps: 150 }, { userId: admin.id });
      expect([updated.successFeeFlatCents, updated.successFeeBps]).toEqual([2500, 150]);
      const audits = await listAuditLogs({ orgId: org.id, action: "business.success_fee_update" });
      expect(audits.items).toHaveLength(1);
      expect(audits.items[0]).toMatchObject({ actorId: admin.id, metadata: { from: { flatCents: 0, bps: 0 }, to: { flatCents: 2500, bps: 150 } } });
      // Same terms again: no change, no second entry.
      await setSuccessFee(org.id, { flatCents: 2500, bps: 150 }, { userId: admin.id });
      expect((await listAuditLogs({ orgId: org.id, action: "business.success_fee_update" })).items).toHaveLength(1);
      expect(describeFeeTerms(updated)).toMatch(/\$25 plus 1\.5% of the booking amount.*Families are never charged/);
    });

    it("validates the terms", async () => {
      const { org } = await newBusiness();
      for (const terms of [
        { flatCents: -1, bps: 0 },
        { flatCents: 1.5, bps: 0 },
        { flatCents: 0, bps: 2001 },
        { flatCents: 1_000_001, bps: 0 },
        { flatCents: 0, bps: -1 },
        { flatCents: 0 },
        { flatCents: 0, bps: 0, extra: true },
      ]) {
        expect(await codeOf(setSuccessFee(org.id, terms as never, { userId: admin.id }))).toBe("validation_failed");
      }
      expect(await codeOf(setSuccessFee("org_missing", { flatCents: 0, bps: 0 }, { userId: admin.id }))).toBe("not_found");
    });
  });
});
