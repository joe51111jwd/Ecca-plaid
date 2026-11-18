import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { ensurePlatformOrg, type User } from "@/server/auth";
import { createSgo, systemActor, updateSgoProfile } from "@/server/sgos";
import { useTestDb } from "../../../tests/helpers/db";
import {
  assertActivePartnership,
  endPartnership,
  getActivePartnerSgos,
  listPartnershipsForBusiness,
  listPartnershipsForSgo,
  requestPartnership,
  respondToPartnership,
} from "./partnerships";
import { createBusiness } from "./profiles";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

// All organizations, people and addresses below are synthetic.
describe("partnerships", () => {
  useTestDb();
  let bizOwner: User;
  let bizViewer: User;
  let sgoOwner: User;
  let sgoReviewer: User;
  let stranger: User;
  let admin: User;
  let businessId: string;
  let sgoId: string;

  async function user(email: string): Promise<User> {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ id: newId("user"), email }).returning();
    return u;
  }

  async function member(orgId: string, u: User, role: MemberRole): Promise<void> {
    const db = await getDb();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId, userId: u.id, role });
  }

  async function sgo(name: string, ownerEmail: string, acceptsHandoffs = true): Promise<string> {
    const { org } = await createSgo({ name, ownerEmail }, systemActor("test"));
    if (acceptsHandoffs) await updateSgoProfile(org.id, { acceptsHandoffs: true }, systemActor("test"));
    return org.id;
  }

  async function setOrgStatus(orgId: string, status: "active" | "suspended"): Promise<void> {
    const db = await getDb();
    await db.update(schema.organizations).set({ status }).where(eq(schema.organizations.id, orgId));
  }

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    bizOwner = await user("owner@camp.example");
    bizViewer = await user("viewer@camp.example");
    sgoOwner = await user("owner@sgo.example");
    sgoReviewer = await user("reviewer@sgo.example");
    stranger = await user("stranger@elsewhere.example");
    admin = await user("admin@platform.example");
    const platform = await ensurePlatformOrg();
    await member(platform.id, admin, "owner");

    businessId = (await createBusiness({ name: "Synthetic Summer Camp", vendorType: "summer_camp", billingEmail: "billing@camp.example", ownerEmail: bizOwner.email }, { userId: bizOwner.id })).org.id;
    await member(businessId, bizViewer, "viewer");
    sgoId = await sgo("Synthetic Scholarship Fund", sgoOwner.email);
    await member(sgoId, sgoReviewer, "reviewer");
  });
  afterEach(() => setTestNow(null));

  describe("state machine", () => {
    it("request → accept → end → request again → decline", async () => {
      const requested = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      expect(requested).toMatchObject({ businessOrgId: businessId, sgoOrgId: sgoId, status: "pending" });
      expect(requested.id).toMatch(/^prt_[0-9A-Za-z]{22}$/);
      expect(await getActivePartnerSgos(businessId)).toEqual([]);

      const accepted = await respondToPartnership(sgoId, requested.id, "active", { userId: sgoOwner.id });
      expect(accepted.status).toBe("active");
      expect(await getActivePartnerSgos(businessId)).toEqual([
        { partnershipId: requested.id, sgoOrgId: sgoId, displayName: "Synthetic Scholarship Fund", website: null, logoUrl: null },
      ]);
      expect((await assertActivePartnership(businessId, sgoId)).sgoOrgId).toBe(sgoId);

      const ended = await endPartnership(businessId, requested.id, { userId: bizOwner.id });
      expect(ended.status).toBe("ended");
      expect(await getActivePartnerSgos(businessId)).toEqual([]);
      expect(await codeOf(assertActivePartnership(businessId, sgoId))).toBe("forbidden");

      const again = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      expect(again).toMatchObject({ id: requested.id, status: "pending" });
      const declined = await respondToPartnership(sgoId, again.id, "ended", { userId: sgoOwner.id });
      expect(declined.status).toBe("ended");
    });

    it("refuses duplicate requests and answers to requests that are not pending", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id }))).toBe("conflict");
      await respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id });
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id }))).toBe("conflict");
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id }))).toBe("conflict");
      expect(await codeOf(respondToPartnership(sgoId, p.id, "ended", { userId: sgoOwner.id }))).toBe("conflict");
      await endPartnership(sgoId, p.id, { userId: sgoOwner.id });
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id }))).toBe("conflict");
    });

    it("rejects decisions other than active or ended", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      for (const d of ["pending", "accepted", "", null]) {
        expect(await codeOf(respondToPartnership(sgoId, p.id, d as never, { userId: sgoOwner.id }))).toBe("validation_failed");
      }
    });

    it("lets either side withdraw a pending request, and ending twice changes nothing", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      expect((await endPartnership(businessId, p.id, { userId: bizOwner.id })).status).toBe("ended");
      expect((await endPartnership(sgoId, p.id, { userId: sgoOwner.id })).status).toBe("ended");
      expect((await listAuditLogs({ orgId: businessId, action: "partnership.end" })).items).toHaveLength(1);
    });

    it("validates the request input", async () => {
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: "" }, { userId: bizOwner.id }))).toBe("validation_failed");
      expect(await codeOf(requestPartnership(null as never, { userId: bizOwner.id }))).toBe("validation_failed");
    });
  });

  describe("SGO eligibility", () => {
    it("requires the SGO to accept handoffs", async () => {
      const closed = await sgo("Synthetic Closed Fund", "closed@sgo.example", false);
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: closed }, { userId: bizOwner.id }))).toBe("conflict");
    });

    it("refuses to accept after the SGO stopped accepting handoffs", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      await updateSgoProfile(sgoId, { acceptsHandoffs: false }, systemActor("test"));
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id }))).toBe("conflict");
      // Declining is always possible.
      expect((await respondToPartnership(sgoId, p.id, "ended", { userId: sgoOwner.id })).status).toBe("ended");
    });

    it("refuses suspended SGOs and non-SGO organizations", async () => {
      await setOrgStatus(sgoId, "suspended");
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id }))).toBe("conflict");
      const otherBusiness = (await createBusiness({ name: "Synthetic Other Camp", vendorType: "other", billingEmail: "b@other.example", ownerEmail: bizOwner.email }, { userId: bizOwner.id })).org.id;
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: otherBusiness }, { userId: bizOwner.id }))).toBe("not_found");
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: "org_missing" }, { userId: bizOwner.id }))).toBe("not_found");
      // A business id in the business slot must be a business.
      expect(await codeOf(requestPartnership({ businessOrgId: sgoId, sgoOrgId: sgoId }, { userId: admin.id }))).toBe("not_found");
    });

    it("hides partners that become unavailable, without ending the partnership", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      await respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id });

      await updateSgoProfile(sgoId, { acceptsHandoffs: false }, systemActor("test"));
      expect(await getActivePartnerSgos(businessId)).toEqual([]);
      expect(await codeOf(assertActivePartnership(businessId, sgoId))).toBe("forbidden");
      await updateSgoProfile(sgoId, { acceptsHandoffs: true }, systemActor("test"));
      expect(await getActivePartnerSgos(businessId)).toHaveLength(1);

      await setOrgStatus(sgoId, "suspended");
      expect(await getActivePartnerSgos(businessId)).toEqual([]);
      await setOrgStatus(sgoId, "active");

      await setOrgStatus(businessId, "suspended");
      expect(await getActivePartnerSgos(businessId)).toEqual([]);
      expect(await codeOf(assertActivePartnership(businessId, sgoId))).toBe("forbidden");
      await setOrgStatus(businessId, "active");

      expect((await listPartnershipsForBusiness(businessId))[0].partnership.status).toBe("active");
    });
  });

  describe("roles on both sides", () => {
    it("only the business's owners/admins (or platform admins) may request", async () => {
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizViewer.id }))).toBe("forbidden");
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: sgoOwner.id }))).toBe("forbidden");
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: stranger.id }))).toBe("forbidden");
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: "" }))).toBe("forbidden");
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: admin.id }))).toBe("ok");
    });

    it("only the SGO's owners/admins (or platform admins) may answer, and only for their own SGO", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      // The business cannot approve its own request.
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: bizOwner.id }))).toBe("forbidden");
      expect(await codeOf(respondToPartnership(businessId, p.id, "active", { userId: bizOwner.id }))).toBe("not_found");
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: sgoReviewer.id }))).toBe("forbidden");
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: stranger.id }))).toBe("forbidden");

      // Another SGO's admin cannot answer a request addressed to this SGO, even by passing their own SGO id.
      const otherOwner = await user("owner@other-sgo.example");
      const otherSgo = await sgo("Synthetic Other Fund", otherOwner.email);
      expect(await codeOf(respondToPartnership(otherSgo, p.id, "active", { userId: otherOwner.id }))).toBe("not_found");
      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: otherOwner.id }))).toBe("forbidden");

      expect(await codeOf(respondToPartnership(sgoId, p.id, "active", { userId: admin.id }))).toBe("ok");
    });

    it("either side's owners/admins may end it; outsiders and viewers may not", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      await respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id });
      expect(await codeOf(endPartnership(businessId, p.id, { userId: bizViewer.id }))).toBe("forbidden");
      expect(await codeOf(endPartnership(sgoId, p.id, { userId: sgoReviewer.id }))).toBe("forbidden");
      expect(await codeOf(endPartnership(sgoId, p.id, { userId: bizOwner.id }))).toBe("forbidden");
      const otherOwner = await user("owner@other-sgo.example");
      const otherSgo = await sgo("Synthetic Other Fund", otherOwner.email);
      expect(await codeOf(endPartnership(otherSgo, p.id, { userId: otherOwner.id }))).toBe("not_found");
      expect(await codeOf(endPartnership(sgoId, p.id, { userId: sgoOwner.id }))).toBe("ok");
    });
  });

  describe("reads", () => {
    it("lists partnerships for each side with display names, scoped to that side", async () => {
      const second = await sgo("Another Synthetic Fund", "owner@second-sgo.example");
      const p1 = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      setTestNow("2026-11-18T16:00:00Z");
      const p2 = await requestPartnership({ businessOrgId: businessId, sgoOrgId: second }, { userId: bizOwner.id });
      await respondToPartnership(sgoId, p1.id, "active", { userId: sgoOwner.id });

      const forBusiness = await listPartnershipsForBusiness(businessId);
      expect(forBusiness.map((s) => [s.partnership.id, s.sgo.displayName, s.partnership.status])).toEqual([
        [p2.id, "Another Synthetic Fund", "pending"],
        [p1.id, "Synthetic Scholarship Fund", "active"],
      ]);
      expect(forBusiness[0].business).toEqual({ orgId: businessId, displayName: "Synthetic Summer Camp", vendorType: "summer_camp", website: null });
      expect((await listPartnershipsForBusiness(businessId, { status: "active" })).map((s) => s.partnership.id)).toEqual([p1.id]);

      const forSgo = await listPartnershipsForSgo(sgoId);
      expect(forSgo.map((s) => s.partnership.id)).toEqual([p1.id]);
      expect(forSgo[0].business.displayName).toBe("Synthetic Summer Camp");
      expect(await listPartnershipsForSgo(second, { status: "pending" })).toHaveLength(1);
      expect(await listPartnershipsForSgo(second, { status: "active" })).toHaveLength(0);
    });

    it("orders active partner SGOs by name and exposes only public fields", async () => {
      const second = await sgo("Another Synthetic Fund", "owner@second-sgo.example");
      await updateSgoProfile(second, { website: "https://fund.example", logoUrl: "https://fund.example/logo.png" }, systemActor("test"));
      for (const id of [sgoId, second]) {
        const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: id }, { userId: bizOwner.id });
        await respondToPartnership(id, p.id, "active", { userId: admin.id });
      }
      const partners = await getActivePartnerSgos(businessId);
      expect(partners.map((s) => s.displayName)).toEqual(["Another Synthetic Fund", "Synthetic Scholarship Fund"]);
      expect(Object.keys(partners[0]).sort()).toEqual(["displayName", "logoUrl", "partnershipId", "sgoOrgId", "website"]);
      expect(partners[0]).toMatchObject({ website: "https://fund.example/", logoUrl: "https://fund.example/logo.png" });
      expect(await getActivePartnerSgos("")).toEqual([]);
      expect(await getActivePartnerSgos("org_missing")).toEqual([]);
    });

    it("assertActivePartnership refuses ids from the wrong pair", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id });
      expect(await codeOf(assertActivePartnership(businessId, sgoId))).toBe("forbidden");
      await respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id });
      const other = await sgo("Synthetic Other Fund", "owner@other-sgo.example");
      expect(await codeOf(assertActivePartnership(businessId, other))).toBe("forbidden");
      expect(await codeOf(assertActivePartnership(sgoId, businessId))).toBe("forbidden");
      expect(await codeOf(assertActivePartnership("", sgoId))).toBe("forbidden");
      expect(await codeOf(assertActivePartnership(businessId, ""))).toBe("forbidden");
      expect(await codeOf(assertActivePartnership(businessId, sgoId))).toBe("ok");
    });
  });

  describe("audit", () => {
    it("records every change for both organizations", async () => {
      const p = await requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizOwner.id, request: { ip: "203.0.113.9", userAgent: "synthetic-agent" } });
      await respondToPartnership(sgoId, p.id, "active", { userId: sgoOwner.id });
      await endPartnership(sgoId, p.id, { userId: sgoOwner.id });

      for (const orgId of [businessId, sgoId]) {
        const items = (await listAuditLogs({ orgId, targetType: "partnership", targetId: p.id })).items;
        expect(items.map((a) => a.action).reverse()).toEqual(["partnership.request", "partnership.respond", "partnership.end"]);
      }
      const [req] = (await listAuditLogs({ orgId: sgoId, action: "partnership.request" })).items;
      expect(req).toMatchObject({ actorType: "user", actorId: bizOwner.id, ip: "203.0.113.9", metadata: { businessOrgId: businessId, sgoOrgId: sgoId, reopened: false } });
      const [respond] = (await listAuditLogs({ orgId: businessId, action: "partnership.respond" })).items;
      expect(respond).toMatchObject({ actorId: sgoOwner.id, metadata: expect.objectContaining({ from: "pending", to: "active" }) });
      const [end] = (await listAuditLogs({ orgId: businessId, action: "partnership.end" })).items;
      expect(end.metadata).toMatchObject({ from: "active", endedBy: "sgo" });
    });

    it("records nothing when a request is refused", async () => {
      expect(await codeOf(requestPartnership({ businessOrgId: businessId, sgoOrgId: sgoId }, { userId: bizViewer.id }))).toBe("forbidden");
      expect((await listAuditLogs({ orgId: businessId, targetType: "partnership" })).items).toHaveLength(0);
    });
  });
});
