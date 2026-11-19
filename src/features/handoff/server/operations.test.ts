import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { businessSystemActor, getBusinessProfile, listPartnershipsForBusiness, setSuccessFee } from "@/server/businesses";
import { offerAward } from "@/server/awards";
import { createHandoff, getHandoffView } from "@/server/handoffs";
import { addMember, apiSource, makeBusiness, makeSgo, makeUser, partner, setVerificationState } from "@/server/handoffs/test-support";
import { listApiKeys } from "@/server/api";
import { listEndpoints, setWebhookResolverForTests } from "@/server/webhooks";
import { useTestDb } from "../../../../tests/helpers/db";
import { SIGNUP_RATE_LIMIT } from "../policy";
import type { PortalActor } from "../types";
import * as ops from "./operations";
import { chooseSgoOp, cancelByFamilyOp } from "./family-operations";
import { handoffTimeline, listExpiringHolds, listSgosAcceptingHandoffs } from "./queries";

// Every organization, person, booking and amount below is synthetic.
const NOW = "2026-11-18T16:00:00.000Z";

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

const actorOf = (userId: string): PortalActor => ({ userId, request: { ip: "203.0.113.20", userAgent: "synthetic-test" } });

async function setup(opts: { role?: "owner" | "admin" | "reviewer" | "viewer" } = {}) {
  const biz = await makeBusiness({ holdWindowHours: 48 });
  const sgo = await makeSgo("Synthetic Fund");
  await partner(biz.orgId, sgo);
  const userId = await makeUser();
  await addMember(biz.orgId, userId, opts.role ?? "admin");
  const created = await createHandoff({ bookingRef: "SYN-OPS-1", bookingAmountCents: 45_000, channel: "redirect" }, await apiSource(biz.orgId));
  return { biz, sgo, userId, actor: actorOf(userId), created };
}

describe("portal operations", () => {
  const t = useTestDb();
  beforeEach(() => {
    setTestNow(NOW);
    setWebhookResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => {
    setTestNow(null);
    setWebhookResolverForTests(null);
  });

  describe("handoffs", () => {
    it("extends a hold and names the new deadline in Texas time", async () => {
      const s = await setup();
      const r = await ops.extendHoldOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id, hours: "24" }));
      expect(r).toEqual({ ok: true, data: { message: "Hold extended by 24 hours, to November 21, 2026 at 10:00 AM CST." } });
      const [row] = await t.db.select().from(schema.handoffs).where(eq(schema.handoffs.id, s.created.handoff.id));
      expect(row.holdExpiresAt?.toISOString()).toBe("2026-11-21T16:00:00.000Z");
    });

    it("refuses a viewer, and a member of another business", async () => {
      const s = await setup({ role: "viewer" });
      expect(await codeOf(ops.extendHoldOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id, hours: "24" })))).toBe("forbidden");
      const other = await setup();
      expect(await codeOf(ops.cancelHandoffOp(other.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id })))).toBe("forbidden");
      // Naming their own business with another business's handoff finds nothing.
      expect(await codeOf(ops.cancelHandoffOp(other.actor, fd({ orgId: other.biz.orgId, handoffId: s.created.handoff.id })))).toBe("not_found");
    });

    it("refuses an organization that is not a business", async () => {
      const s = await setup();
      expect(await codeOf(ops.extendHoldOp(s.actor, fd({ orgId: s.sgo, handoffId: s.created.handoff.id, hours: "1" })))).toBe("not_found");
    });

    it("completes an awarded booking, confirming the amount, and reports the success fee", async () => {
      const s = await setup();
      await setSuccessFee(s.biz.orgId, { flatCents: 2_500, bps: 0 }, businessSystemActor("test"));
      await setVerificationState(s.created.handoff.verificationId!, { status: "eligible", expiresAt: new Date("2026-12-31T23:59:59Z") });
      await getHandoffView(s.created.token);
      const sgoReviewer = await makeUser();
      await addMember(s.sgo, sgoReviewer, "reviewer");
      await offerAward(s.sgo, { verificationId: s.created.handoff.verificationId!, amountCents: 30_000, paymentMethod: "direct_to_vendor" }, { type: "user", userId: sgoReviewer, mode: "test" });

      const r = await ops.completeHandoffOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id, bookingAmount: "450.00" }));
      expect(r).toEqual({ ok: true, data: { message: "Booking marked completed. A success fee of $25 was added to your next invoice." } });
      expect(await codeOf(ops.completeHandoffOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id })))).toBe("conflict");
    });

    it("refuses to complete a booking that has no award", async () => {
      const s = await setup();
      expect(await codeOf(ops.completeHandoffOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id })))).toBe("conflict");
    });

    it("cancels with a reason recorded on the timeline", async () => {
      const s = await setup();
      await ops.cancelHandoffOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id, reason: "Family switched sessions" }));
      const timeline = await handoffTimeline(s.biz.orgId, s.created.handoff.id);
      expect(timeline.map((e) => e.title)).toEqual(["Handoff created", "Handoff canceled"]);
      expect(timeline[1]).toMatchObject({ description: "Reason: Family switched sessions", actor: "Your team" });
    });
  });

  describe("settings", () => {
    it("saves branding and the hold window", async () => {
      const s = await setup();
      await ops.saveProfileOp(s.actor, fd({ orgId: s.biz.orgId, brandColor: "#1f5c3f", holdWindowHours: "96", vendorType: "tutoring" }));
      const { profile } = await getBusinessProfile(s.biz.orgId);
      expect(profile).toMatchObject({ brandColor: "#1F5C3F", holdWindowHours: 96, vendorType: "tutoring" });
    });

    it("passes the service's own validation messages through", async () => {
      const s = await setup();
      expect(await codeOf(ops.saveProfileOp(s.actor, fd({ orgId: s.biz.orgId, brandColor: "#ffff00" })))).toBe("validation_failed");
      expect(await codeOf(ops.saveOriginsOp(s.actor, fd({ orgId: s.biz.orgId, allowedOrigins: "https://*.example.org" })))).toBe("validation_failed");
    });

    it("only owners and admins change settings", async () => {
      const s = await setup({ role: "reviewer" });
      expect(await codeOf(ops.saveProfileOp(s.actor, fd({ orgId: s.biz.orgId, displayName: "Renamed" })))).toBe("forbidden");
      expect(await codeOf(ops.rotatePublishableKeyOp(s.actor, fd({ orgId: s.biz.orgId })))).toBe("forbidden");
    });

    it("saves origins and rotates the publishable key", async () => {
      const s = await setup();
      const r = await ops.saveOriginsOp(s.actor, fd({ orgId: s.biz.orgId, allowedOrigins: "https://camp.synthetic-example.org\nhttps://www.camp.synthetic-example.org" }));
      expect(r).toEqual({ ok: true, data: { message: "Saved 2 allowed origins." } });
      const before = (await getBusinessProfile(s.biz.orgId)).profile.publishableKey;
      await ops.rotatePublishableKeyOp(s.actor, fd({ orgId: s.biz.orgId }));
      expect((await getBusinessProfile(s.biz.orgId)).profile.publishableKey).not.toBe(before);
    });

    it("requests and ends partnerships", async () => {
      const s = await setup();
      const other = await makeSgo("Second Synthetic Fund");
      const choices = await listSgosAcceptingHandoffs();
      expect(choices.map((c) => c.orgId)).toEqual(expect.arrayContaining([s.sgo, other]));
      await ops.requestPartnershipOp(s.actor, fd({ orgId: s.biz.orgId, sgoOrgId: other }));
      expect(await codeOf(ops.requestPartnershipOp(s.actor, fd({ orgId: s.biz.orgId, sgoOrgId: other })))).toBe("conflict");
      const list = await listPartnershipsForBusiness(s.biz.orgId);
      expect(list.find((p) => p.sgo.orgId === other)?.partnership.status).toBe("pending");
      const active = list.find((p) => p.sgo.orgId === s.sgo)!;
      await ops.endPartnershipOp(s.actor, fd({ orgId: s.biz.orgId, partnershipId: active.partnership.id }));
      expect((await listPartnershipsForBusiness(s.biz.orgId)).find((p) => p.sgo.orgId === s.sgo)?.partnership.status).toBe("ended");
    });

    it("lists only SGOs that accept handoffs", async () => {
      const closed = await makeSgo("Closed Synthetic Fund", { acceptsHandoffs: false });
      const open = await makeSgo("Open Synthetic Fund");
      const ids = (await listSgosAcceptingHandoffs()).map((c) => c.orgId);
      expect(ids).toContain(open);
      expect(ids).not.toContain(closed);
    });
  });

  describe("team", () => {
    it("adds, re-roles and removes members", async () => {
      const s = await setup();
      await ops.inviteMemberOp(s.actor, fd({ orgId: s.biz.orgId, email: "new-staff@synthetic-camp.example", role: "viewer" }));
      const [u] = await t.db.select().from(schema.users).where(eq(schema.users.email, "new-staff@synthetic-camp.example"));
      await ops.changeRoleOp(s.actor, fd({ orgId: s.biz.orgId, userId: u.id, role: "reviewer" }));
      const [m] = await t.db.select().from(schema.memberships).where(eq(schema.memberships.userId, u.id));
      expect(m.role).toBe("reviewer");
      await ops.removeMemberOp(s.actor, fd({ orgId: s.biz.orgId, userId: u.id }));
      expect(await t.db.select().from(schema.memberships).where(eq(schema.memberships.userId, u.id))).toHaveLength(0);
    });

    it("a viewer cannot add members", async () => {
      const s = await setup({ role: "viewer" });
      expect(await codeOf(ops.inviteMemberOp(s.actor, fd({ orgId: s.biz.orgId, email: "x@synthetic-camp.example", role: "viewer" })))).toBe("forbidden");
    });
  });

  describe("developers", () => {
    it("creates an API key whose secret is returned once, and revokes it", async () => {
      const s = await setup();
      const r = await ops.createApiKeyOp(s.actor, fd({ orgId: s.biz.orgId, name: "Booking server", mode: "test" }));
      expect(r.ok && r.data.secret?.value).toMatch(/^ecca_test_/);
      const [key] = (await listApiKeys(s.biz.orgId, { activeOnly: true })).filter((k) => k.name === "Booking server");
      await ops.revokeApiKeyOp(s.actor, fd({ orgId: s.biz.orgId, keyId: key.id }));
      expect((await listApiKeys(s.biz.orgId, { activeOnly: true })).some((k) => k.id === key.id)).toBe(false);
    });

    it("manages webhook endpoints for owners and admins only, with an audit entry for each change", async () => {
      const s = await setup();
      const r = await ops.createWebhookOp(s.actor, fd({ orgId: s.biz.orgId, url: "https://hooks.synthetic-camp.example/passport", description: "Bookings", eventTypes: ["handoff.held", "handoff.eligible"] }));
      expect(r.ok && r.data.secret?.label).toBe("Signing secret");
      const [endpoint] = await listEndpoints(s.biz.orgId);
      expect(endpoint.eventTypes).toEqual(["handoff.held", "handoff.eligible"]);
      await ops.toggleWebhookOp(s.actor, fd({ orgId: s.biz.orgId, endpointId: endpoint.id, enable: "false" }));
      expect((await listEndpoints(s.biz.orgId))[0].status).toBe("disabled");
      await ops.toggleWebhookOp(s.actor, fd({ orgId: s.biz.orgId, endpointId: endpoint.id, enable: "true" }));
      const rotated = await ops.rotateWebhookSecretOp(s.actor, fd({ orgId: s.biz.orgId, endpointId: endpoint.id }));
      expect(rotated.ok && rotated.data.secret?.value).toBeTruthy();
      await ops.deleteWebhookOp(s.actor, fd({ orgId: s.biz.orgId, endpointId: endpoint.id }));
      expect(await listEndpoints(s.biz.orgId)).toHaveLength(0);
      const audits = await t.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, endpoint.id));
      expect(audits.map((a) => a.action).sort()).toEqual(["webhook_endpoint.create", "webhook_endpoint.delete", "webhook_endpoint.disable", "webhook_endpoint.enable", "webhook_endpoint.rotate_secret"]);

      const viewer = await makeUser();
      await addMember(s.biz.orgId, viewer, "reviewer");
      expect(await codeOf(ops.createWebhookOp(actorOf(viewer), fd({ orgId: s.biz.orgId, url: "https://hooks.synthetic-camp.example/x", description: "", eventTypes: ["*"] })))).toBe("forbidden");
    });
  });

  describe("signup", () => {
    it("creates the person's own business with them as owner", async () => {
      const userId = await makeUser("founder@synthetic-camp.example");
      const r = await ops.signupOp(actorOf(userId), fd({ name: "Synthetic Tutoring Co", vendorType: "tutoring", website: "", billingEmail: "billing@synthetic-camp.example" }));
      expect(r.ok && r.data.link?.href).toMatch(/^\/partner\/install\?org=/);
      const [m] = await t.db.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
      expect(m.role).toBe("owner");
    });

    it("caps how many businesses one person can set up per day, without affecting anyone else", async () => {
      const userId = await makeUser("serial@synthetic-camp.example");
      const signup = (who: string, n: number) => ops.signupOp(actorOf(who), fd({ name: `Synthetic Camp ${n}`, vendorType: "summer_camp", website: "", billingEmail: "billing@synthetic-camp.example" }));
      for (let n = 1; n <= SIGNUP_RATE_LIMIT.limit; n++) expect((await signup(userId, n)).ok).toBe(true);
      expect(await codeOf(signup(userId, 99))).toBe("rate_limited");
      const owned = await t.db.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
      expect(owned).toHaveLength(SIGNUP_RATE_LIMIT.limit);

      const someoneElse = await makeUser("other-founder@synthetic-camp.example");
      expect((await signup(someoneElse, 100)).ok).toBe(true);

      setTestNow(new Date(new Date(NOW).getTime() + SIGNUP_RATE_LIMIT.windowMs + 1000));
      expect((await signup(userId, 101)).ok).toBe(true);
    });
  });

  describe("family operations", () => {
    it("lets the family choose among several partners, then stop", async () => {
      const biz = await makeBusiness();
      const a = await makeSgo("Synthetic Fund A");
      const b = await makeSgo("Synthetic Fund B");
      await partner(biz.orgId, a);
      await partner(biz.orgId, b);
      const created = await createHandoff({ bookingRef: "SYN-FAM-1", channel: "redirect" }, await apiSource(biz.orgId));
      expect((await getHandoffView(created.token)).step).toBe("choose_sgo");
      expect(await codeOf(chooseSgoOp(fd({ token: created.token, sgoOrgId: "" }), null))).toBe("validation_failed");
      expect(await codeOf(chooseSgoOp(fd({ token: "short", sgoOrgId: a }), null))).toBe("not_found");
      await chooseSgoOp(fd({ token: created.token, sgoOrgId: b, locale: "es" }), null);
      const view = await getHandoffView(created.token);
      expect(view.sgo?.orgId).toBe(b);
      expect(view.verificationUrl).toMatch(/\/v\//);
      await cancelByFamilyOp(fd({ token: created.token }), null);
      expect((await getHandoffView(created.token)).status).toBe("canceled");
    });
  });

  describe("expiring holds", () => {
    it("lists holding handoffs due within the window, soonest first, for this business and mode only", async () => {
      const s = await setup();
      const later = await createHandoff({ bookingRef: "SYN-OPS-2", channel: "redirect" }, await apiSource(s.biz.orgId));
      await ops.extendHoldOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: later.handoff.id, hours: "1" }));
      // Both holds end in 48-49 hours: outside a 24-hour window now, inside it a day later.
      expect(await listExpiringHolds(s.biz.orgId, "test", new Date(NOW))).toEqual([]);
      const dayLater = new Date("2026-11-19T17:00:00.000Z");
      expect((await listExpiringHolds(s.biz.orgId, "test", dayLater)).map((h) => h.bookingRef)).toEqual(["SYN-OPS-1", "SYN-OPS-2"]);
      expect(await listExpiringHolds(s.biz.orgId, "live", dayLater)).toEqual([]);
      await ops.cancelHandoffOp(s.actor, fd({ orgId: s.biz.orgId, handoffId: s.created.handoff.id }));
      expect((await listExpiringHolds(s.biz.orgId, "test", dayLater)).map((h) => h.bookingRef)).toEqual(["SYN-OPS-2"]);
      const other = await setup();
      expect((await listExpiringHolds(other.biz.orgId, "test", dayLater)).map((h) => h.bookingRef)).toEqual(["SYN-OPS-1"]);
    });
  });
});
