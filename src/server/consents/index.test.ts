import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import type { User } from "@/server/auth";
import { addMember, getOrCreateHouseholdForUser, inviteAdult } from "@/server/households";
import { codeOf, makeSgo, makeUser, makeVerification } from "../households/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import {
  assertActiveConsent,
  consentState,
  endOfCentralDay,
  getConsent,
  grantConsent,
  listConsentsForHousehold,
  reconstructConsent,
  renderConsent,
  revokeConsent,
  type Consent,
} from "./index";

// Every person, email and organization here is SYNTHETIC.

const REQUEST = { ip: "203.0.113.7", userAgent: "Synthetic Browser/1.0" };

async function detailsOf(p: Promise<unknown>): Promise<{ code: string; reason?: unknown }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code: string; details?: { reason?: unknown } };
    return { code: err.code, reason: err.details?.reason };
  }
  return { code: "ok" };
}

describe("consents", () => {
  useTestDb();
  let owner: User;
  let adult: User;
  let stranger: User;
  let householdId: string;
  let sgo: Awaited<ReturnType<typeof makeSgo>>;
  let verificationId: string;

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    owner = await makeUser("owner@example.com");
    stranger = await makeUser("stranger@example.com");
    householdId = (await getOrCreateHouseholdForUser(owner.id)).household.id;
    const m = await addMember(householdId, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, { userId: owner.id });
    const inv = await inviteAdult(householdId, { email: "adult@example.com", memberId: m.id }, { userId: owner.id });
    const db = await getDb();
    [adult] = await db.select().from(schema.users).where(eq(schema.users.id, inv.user.id));
    sgo = await makeSgo();
    verificationId = (await makeVerification(sgo.id, householdId)).id;
  });
  afterEach(() => setTestNow(null));

  function share(userId: string, extra: Record<string, unknown> = {}) {
    return grantConsent({
      kind: "verification_share",
      userId,
      householdId,
      verificationId,
      recipientOrgId: sgo.id,
      locale: "en",
      vars: { shareUntil: "2027-12-31", uploadRetentionDays: 90 },
      request: REQUEST,
      ...extra,
    });
  }

  describe("grantConsent", () => {
    it("records the version, exact-text hash, scope, time, expiry and request of a sharing consent", async () => {
      const { consent, rendered } = await share(owner.id, { vars: { shareUntil: "2027-12-31", uploadRetentionDays: 90, organizationName: "Spoofed Org" } });
      expect(rendered.text).toContain("Synthetic Scholarship Fund");
      expect(rendered.text).not.toContain("Spoofed");
      expect(consent).toMatchObject({
        kind: "verification_share",
        userId: owner.id,
        householdId,
        verificationId,
        recipientOrgId: sgo.id,
        copyVersion: "verification_share.v1",
        copySha256: rendered.sha256,
        locale: "en",
        ip: "203.0.113.7",
        userAgent: "Synthetic Browser/1.0",
        revokedAt: null,
      });
      expect(consent.grantedAt.toISOString()).toBe("2026-11-18T15:00:00.000Z");
      // End of December 31, 2027 in Texas (CST, UTC-6).
      expect(consent.expiresAt?.toISOString()).toBe("2028-01-01T06:00:00.000Z");
      expect(consent.scope).toMatchObject({ recipient: "Synthetic Scholarship Fund", shareUntil: "2027-12-31", uploadRetentionDays: 90, vars: { organizationName: "Synthetic Scholarship Fund" } });
      const { items } = await listAuditLogs({ action: "consent.grant" });
      expect(items[0]).toMatchObject({ actorId: owner.id, orgId: sgo.id, targetId: consent.id, metadata: { copyVersion: "verification_share.v1", kind: "verification_share" } });
    });

    it("stores the Spanish text's hash when shown in Spanish", async () => {
      const { consent, rendered } = await share(owner.id, { locale: "es" });
      expect(consent.locale).toBe("es");
      expect(rendered.text).toContain("31 de diciembre de 2027");
      expect(consent.copySha256).toBe(renderConsent("verification_share", "es", { organizationName: "Synthetic Scholarship Fund", shareUntil: "2027-12-31", uploadRetentionDays: 90 }).sha256);
    });

    it("only the household owner may give the sharing consent", async () => {
      expect(await codeOf(share(adult.id))).toBe("forbidden");
      expect(await codeOf(share(stranger.id))).toBe("not_found");
      const db = await getDb();
      expect(await db.select().from(schema.consents)).toHaveLength(0);
    });

    it("refuses when the words the person saw differ from the server's", async () => {
      const shown = renderConsent("verification_share", "en", { organizationName: "Synthetic Scholarship Fund", shareUntil: "2027-12-31", uploadRetentionDays: 90 });
      expect((await share(owner.id, { shownSha256: shown.sha256 })).consent.copySha256).toBe(shown.sha256);
      expect(await detailsOf(share(owner.id, { shownSha256: "0".repeat(64) }))).toEqual({ code: "conflict", reason: "copy_changed" });
    });

    it("checks the verification and the receiving organization", async () => {
      const otherOwner = await makeUser("other.owner@example.com");
      const otherHousehold = (await getOrCreateHouseholdForUser(otherOwner.id)).household.id;
      const theirs = await makeVerification(sgo.id, otherHousehold);
      expect(await codeOf(share(owner.id, { verificationId: theirs.id }))).toBe("not_found");
      expect(await codeOf(share(owner.id, { verificationId: "ver_missing" }))).toBe("not_found");
      const otherSgo = await makeSgo("Another Synthetic Fund");
      expect(await codeOf(share(owner.id, { recipientOrgId: otherSgo.id }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { recipientOrgId: null }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { verificationId: null }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { householdId: null }))).toBe("validation_failed");
      const canceled = await makeVerification(sgo.id, householdId, { status: "canceled" });
      expect(await codeOf(share(owner.id, { verificationId: canceled.id }))).toBe("conflict");
      // A verification not yet tied to a household can be consented to from the family's household.
      const unlinked = await makeVerification(sgo.id, null);
      expect(await codeOf(share(owner.id, { verificationId: unlinked.id }))).toBe("ok");
    });

    it("bounds the sharing period", async () => {
      expect(await codeOf(share(owner.id, { vars: { shareUntil: "2026-11-17", uploadRetentionDays: 90 } }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { vars: { shareUntil: "2026-11-18", uploadRetentionDays: 90 } }))).toBe("ok");
      expect(await codeOf(share(owner.id, { vars: { shareUntil: "2029-01-01", uploadRetentionDays: 90 } }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { vars: { shareUntil: "2027-12-31" } }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { locale: "fr" }))).toBe("validation_failed");
      expect(await codeOf(share(owner.id, { kind: "donor_e_delivery" }))).toBe("validation_failed");
    });

    it("a second adult may connect their own payroll account", async () => {
      const { consent } = await grantConsent({ kind: "rail_connect", userId: adult.id, householdId, verificationId, locale: "es", vars: { providerName: "Simulated Payroll", incomeYear: 2026 } });
      expect(consent).toMatchObject({ kind: "rail_connect", userId: adult.id, recipientOrgId: sgo.id, expiresAt: null, copyVersion: "rail_connect.v1" });
    });

    it("electronic delivery uses the person's own email and is not tied to a verification", async () => {
      const { consent, rendered } = await grantConsent({ kind: "electronic_delivery", userId: stranger.id, locale: "en", vars: { email: "spoof@example.com" } });
      expect(rendered.text).toContain("stranger@example.com");
      expect(consent).toMatchObject({ householdId: null, verificationId: null, recipientOrgId: null });
      expect(await codeOf(grantConsent({ kind: "electronic_delivery", userId: stranger.id, locale: "en", verificationId }))).toBe("validation_failed");
      expect(await codeOf(grantConsent({ kind: "electronic_delivery", userId: stranger.id, locale: "en", householdId }))).toBe("not_found");
      expect(await codeOf(grantConsent({ kind: "electronic_delivery", userId: "usr_missing", locale: "en" }))).toBe("forbidden");
    });

    it("passport reuse takes the dates from the earlier result and needs it to be still valid", async () => {
      const source = await makeVerification(sgo.id, householdId, { status: "eligible", decidedAt: new Date("2026-10-01T18:00:00Z"), expiresAt: new Date("2027-09-30T05:00:00Z") });
      const secondSgo = await makeSgo("Second Synthetic Fund");
      const reuse = await makeVerification(secondSgo.id, householdId, { passportSourceId: source.id });
      const input = { kind: "passport_reuse" as const, userId: owner.id, householdId, verificationId: reuse.id, recipientOrgId: secondSgo.id, locale: "en" as const, vars: { shareUntil: "2027-06-30", decidedDate: "2020-01-01" } };
      const { consent, rendered } = await grantConsent(input);
      expect(rendered.text).toContain("October 1, 2026");
      expect(rendered.text).toContain("September 30, 2027");
      expect(rendered.text).toContain("Second Synthetic Fund");
      expect(consent.recipientOrgId).toBe(secondSgo.id);
      expect(await codeOf(grantConsent({ ...input, vars: { shareUntil: "2027-10-30" } }))).toBe("validation_failed");
      expect(await codeOf(grantConsent({ ...input, userId: adult.id }))).toBe("forbidden");
      expect(await codeOf(grantConsent({ ...input, verificationId, recipientOrgId: sgo.id }))).toBe("conflict"); // not a reuse verification

      setTestNow("2027-10-01T00:00:00Z");
      expect(await codeOf(grantConsent(input))).toBe("conflict");
    });
  });

  describe("revokeConsent", () => {
    async function rail(status: "connected" | "failed" | "revoked", consentId: string | null) {
      const db = await getDb();
      const [r] = await db.insert(schema.railConnections).values({ id: newId("railConnection"), householdId, verificationId, provider: "simulated", status, consentId }).returning();
      return r;
    }

    it("sets only revokedAt, is idempotent and audited, and lists what must stop", async () => {
      const { consent } = await share(owner.id);
      const open = await rail("connected", null);
      await rail("failed", null);
      setTestNow("2026-11-20T10:00:00Z");
      const r = await revokeConsent(consent.id, { userId: owner.id, request: REQUEST });
      expect(r.alreadyRevoked).toBe(false);
      expect(r.consent.revokedAt?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
      expect(r.consent).toEqual({ ...consent, revokedAt: r.consent.revokedAt });
      expect(r.mustStop).toEqual({ verificationIds: [verificationId], railConnectionIds: [open.id], electronicDelivery: false });

      const again = await revokeConsent(consent.id, { userId: owner.id });
      expect(again.alreadyRevoked).toBe(true);
      expect(again.consent.revokedAt?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
      expect((await listAuditLogs({ action: "consent.revoke" })).items).toHaveLength(1);
    });

    it("a rail consent stops only the connections made under it", async () => {
      const { consent } = await grantConsent({ kind: "rail_connect", userId: adult.id, householdId, verificationId, locale: "en", vars: { providerName: "Simulated Payroll", incomeYear: 2026 } });
      const mine = await rail("connected", consent.id);
      const otherConsent = await grantConsent({ kind: "rail_connect", userId: owner.id, householdId, verificationId, locale: "en", vars: { providerName: "Simulated Payroll", incomeYear: 2026 } });
      await rail("connected", otherConsent.consent.id);
      const r = await revokeConsent(consent.id, { userId: adult.id });
      expect(r.mustStop.railConnectionIds).toEqual([mine.id]);
    });

    it("who may revoke: the person who gave it or the owner; not another adult; not a stranger", async () => {
      const { consent } = await share(owner.id);
      expect(await codeOf(revokeConsent(consent.id, { userId: adult.id }))).toBe("forbidden");
      expect(await codeOf(revokeConsent(consent.id, { userId: stranger.id }))).toBe("not_found");
      expect(await codeOf(revokeConsent("con_missing", { userId: owner.id }))).toBe("not_found");
      const railConsent = (await grantConsent({ kind: "rail_connect", userId: adult.id, householdId, verificationId, locale: "en", vars: { providerName: "Simulated Payroll", incomeYear: 2026 } })).consent;
      expect((await revokeConsent(railConsent.id, { userId: owner.id })).alreadyRevoked).toBe(false);
      const ed = (await grantConsent({ kind: "electronic_delivery", userId: stranger.id, locale: "en" })).consent;
      expect((await revokeConsent(ed.id, { userId: stranger.id })).mustStop).toEqual({ verificationIds: [], railConnectionIds: [], electronicDelivery: true });
    });
  });

  describe("assertActiveConsent", () => {
    it("explains why there is no active consent", async () => {
      expect(await detailsOf(assertActiveConsent(verificationId, "verification_share"))).toEqual({ code: "forbidden", reason: "consent_missing" });
      const { consent } = await share(owner.id, { vars: { shareUntil: "2026-12-31", uploadRetentionDays: 30 } });
      expect((await assertActiveConsent(verificationId, "verification_share")).id).toBe(consent.id);
      expect(await detailsOf(assertActiveConsent(verificationId, "rail_connect"))).toEqual({ code: "forbidden", reason: "consent_missing" });

      setTestNow("2027-01-01T05:59:59Z"); // still December 31 in Texas
      expect((await assertActiveConsent(verificationId, "verification_share")).id).toBe(consent.id);
      setTestNow("2027-01-01T06:00:00Z");
      expect(await detailsOf(assertActiveConsent(verificationId, "verification_share"))).toEqual({ code: "forbidden", reason: "consent_expired" });

      setTestNow("2026-11-19T00:00:00Z");
      await revokeConsent(consent.id, { userId: owner.id });
      expect(await detailsOf(assertActiveConsent(verificationId, "verification_share"))).toEqual({ code: "forbidden", reason: "consent_revoked" });
      const fresh = (await share(owner.id)).consent;
      expect((await assertActiveConsent(verificationId, "verification_share")).id).toBe(fresh.id);
    });

    it("consentState", () => {
      const at = new Date("2027-01-01T00:00:00Z");
      expect(consentState({ revokedAt: null, expiresAt: null }, at)).toBe("active");
      expect(consentState({ revokedAt: null, expiresAt: at }, at)).toBe("expired");
      expect(consentState({ revokedAt: at, expiresAt: null }, at)).toBe("revoked");
    });
  });

  describe("reads", () => {
    it("getConsent and listConsentsForHousehold respect household access", async () => {
      const { consent } = await share(owner.id);
      expect((await getConsent(consent.id, { userId: adult.id })).id).toBe(consent.id);
      expect(await codeOf(getConsent(consent.id, { userId: stranger.id }))).toBe("not_found");
      expect((await listConsentsForHousehold(householdId, { userId: adult.id })).map((c) => c.id)).toEqual([consent.id]);
      expect(await codeOf(listConsentsForHousehold(householdId, { userId: stranger.id }))).toBe("not_found");
    });

    it("reconstructConsent reproduces the exact words and detects tampering", async () => {
      const { consent, rendered } = await share(owner.id, { locale: "es" });
      expect(reconstructConsent(consent)?.text).toBe(rendered.text);
      const tampered: Consent = { ...consent, scope: { ...consent.scope, vars: { ...(consent.scope.vars as object), uploadRetentionDays: 9 } } };
      expect(reconstructConsent(tampered)).toBeNull();
      expect(reconstructConsent({ ...consent, copyVersion: "verification_share.v0" })).toBeNull();
    });
  });

  it("endOfCentralDay handles both standard and daylight time", () => {
    expect(endOfCentralDay("2027-12-31").toISOString()).toBe("2028-01-01T06:00:00.000Z");
    expect(endOfCentralDay("2027-06-30").toISOString()).toBe("2027-07-01T05:00:00.000Z");
    expect(endOfCentralDay("2027-03-13").toISOString()).toBe("2027-03-14T06:00:00.000Z"); // DST starts 2 a.m. on the 14th
    expect(endOfCentralDay("2027-11-06").toISOString()).toBe("2027-11-07T05:00:00.000Z"); // DST ends 2 a.m. on the 7th
  });
});
