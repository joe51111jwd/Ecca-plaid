import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execRows, getDb, schema } from "@/db/client";
import { reconcileIncomeEvidence } from "@/engine/income";
import { setTestNow } from "@/lib/clock";
import { decryptJson, sha256Hex } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import type { User } from "@/server/auth";
import { revokeConsent } from "@/server/consents";
import { addMember, getOrCreateHouseholdForUser, inviteAdult, upsertOwnerMember } from "@/server/households";
import { runDueJobs } from "@/server/jobs";
import { codeOf, makeSgo, makeUser, makeVerification } from "../households/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { jobHandlers } from "./jobs";
import { createPlaidRail } from "./plaid";
import { RAIL_POLICY, SIMULATED_SLOW_READY_AFTER_MS } from "./policy";
import { setRailProviderForTests } from "./providers";
import {
  completeConnection,
  declineConnection,
  getConnection,
  getRailSummaryForDecision,
  handleRailWebhook,
  listConnections,
  previewRailConsent,
  railReportSha256,
  revokeConnection,
  revokeConnectionsForConsent,
  startConnection,
  syncConnection,
} from "./service";
import { fakePlaidFetch, makeWebhookSigner, payrollIncomeBody, signJwt } from "./test-support";
import { RailProviderError, type NormalizedIncomeReport, type RailProvider } from "./types";

// Every person, employer, organization and amount here is SYNTHETIC.

const T0 = "2026-11-18T15:00:00Z";
const REQUEST = { ip: "203.0.113.9", userAgent: "Synthetic Browser/1.0" };

async function detailsOf(p: Promise<unknown>): Promise<{ code: string; reason?: unknown }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code: string; details?: { reason?: unknown } };
    return { code: err.code, reason: err.details?.reason };
  }
  return { code: "ok" };
}

async function railRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.railConnections).where(eq(schema.railConnections.id, id));
  return row!;
}

async function railItems(connectionId: string) {
  const db = await getDb();
  return db.select().from(schema.incomeItems).where(eq(schema.incomeItems.railConnectionId, connectionId));
}

async function allItems(verificationId: string) {
  const db = await getDb();
  return db.select().from(schema.incomeItems).where(eq(schema.incomeItems.verificationId, verificationId));
}

async function runJobs() {
  return runDueJobs({ handlers: jobHandlers, limit: 50 });
}

/** Every row of every table as JSON text, to prove a secret is stored nowhere in plaintext. */
async function wholeDatabaseText(): Promise<string> {
  const db = await getDb();
  const tables = await execRows<{ tablename: string }>(db, sql`select tablename from pg_tables where schemaname = 'public'`);
  const parts: string[] = [];
  for (const { tablename } of tables) {
    const rows = await execRows<{ j: string }>(db, sql.raw(`select row_to_json(t)::text as j from "${tablename}" t`));
    parts.push(...rows.map((r) => r.j));
  }
  return parts.join("\n");
}

describe("rails service", () => {
  useTestDb();
  let owner: User;
  let adult: User;
  let stranger: User;
  let householdId: string;
  let ownerMemberId: string;
  let spouseMemberId: string;
  let adultMemberId: string;
  let verificationId: string;
  let strangerVerificationId: string;
  let sgoId: string;

  beforeEach(async () => {
    setTestNow(T0);
    owner = await makeUser("owner@example.com");
    stranger = await makeUser("stranger@example.com");
    householdId = (await getOrCreateHouseholdForUser(owner.id)).household.id;
    ownerMemberId = (await upsertOwnerMember(householdId, { firstName: "Rosa", lastName: "Synthetic", relationship: "parent" }, { userId: owner.id })).id;
    spouseMemberId = (await addMember(householdId, { kind: "adult", firstName: "Marco", lastName: "Synthetic", relationship: "parent" }, { userId: owner.id })).id;
    const third = await addMember(householdId, { kind: "adult", firstName: "Lena", lastName: "Synthetic", relationship: "other" }, { userId: owner.id });
    adultMemberId = third.id;
    const inv = await inviteAdult(householdId, { email: "adult@example.com", memberId: third.id }, { userId: owner.id });
    const db = await getDb();
    [adult] = await db.select().from(schema.users).where(eq(schema.users.id, inv.user.id));
    const sgo = await makeSgo();
    sgoId = sgo.id;
    verificationId = (await makeVerification(sgo.id, householdId)).id;
    const strangerHousehold = (await getOrCreateHouseholdForUser(stranger.id)).household.id;
    strangerVerificationId = (await makeVerification(sgo.id, strangerHousehold)).id;
  });
  afterEach(() => {
    setTestNow(null);
    setRailProviderForTests("plaid", null);
    setRailProviderForTests("simulated", null);
    delete process.env.RAIL_PROVIDER;
  });

  const start = (over: Record<string, unknown> = {}, who: User = owner) => startConnection({ verificationId, memberId: ownerMemberId, kind: "payroll", ...over }, { userId: who.id, request: REQUEST });

  async function connectPersona(persona: string, opts: { kind?: "payroll" | "bank"; memberId?: string } = {}) {
    const started = await start({ kind: opts.kind ?? "payroll", memberId: opts.memberId ?? ownerMemberId });
    const view = await completeConnection(started.connection.id, { persona }, { userId: owner.id });
    return { started, view };
  }

  /* ----------------------------------------------------------------------------- consent */

  describe("consent", () => {
    it("previews the exact rail_connect words with the SGO, the provider and the income year", async () => {
      const preview = await previewRailConsent(verificationId, { userId: owner.id }, "es");
      expect(preview.incomeYear).toBe(2025);
      expect(preview.providerName).toMatch(/sandbox/);
      expect(preview.rendered.text).toContain("Synthetic Scholarship Fund");
      expect(preview.rendered.text).toContain("2025");
      expect(preview.rendered.locale).toBe("es");
    });

    it("startConnection records a rail_connect consent naming the provider before anything is connected", async () => {
      const preview = await previewRailConsent(verificationId, { userId: owner.id }, "en");
      const started = await start({ shownSha256: preview.rendered.sha256, locale: "en" });
      const db = await getDb();
      const [consent] = await db.select().from(schema.consents).where(eq(schema.consents.id, started.consentId));
      expect(consent).toMatchObject({ kind: "rail_connect", userId: owner.id, householdId, verificationId, recipientOrgId: sgoId, copySha256: preview.rendered.sha256, ip: "203.0.113.9" });
      expect(consent!.scope).toMatchObject({ provider: expect.stringMatching(/sandbox/), incomeYear: 2025 });
      expect(started.connection).toMatchObject({ status: "connecting", provider: "simulated", sandbox: true, kind: "payroll", memberId: ownerMemberId, offerUpload: false });
      expect(started.client).toMatchObject({ provider: "simulated", sandbox: true });
      expect((await railRow(started.connection.id)).consentId).toBe(consent!.id);
      const events = await db.select().from(schema.verificationEvents).where(eq(schema.verificationEvents.verificationId, verificationId));
      expect(events.map((e) => e.type)).toEqual(["rail.started"]);
      const logs = await listAuditLogs({ action: "rail.start" });
      expect(logs.items).toHaveLength(1);
    });

    it("refuses when the text the person saw differs from the server's", async () => {
      expect(await detailsOf(start({ shownSha256: "0".repeat(64) }))).toEqual({ code: "conflict", reason: "copy_changed" });
      const db = await getDb();
      expect(await db.select().from(schema.railConnections)).toHaveLength(0);
    });

    it("a revoked consent stops completion and syncing; revocation revokes the connection and keeps only the report hash", async () => {
      const { view } = await connectPersona("single_w2");
      expect(view.status).toBe("ready");
      const before = await railRow(view.id);
      expect(before.reportSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await railItems(view.id)).toHaveLength(1);

      const result = await revokeConsent(before.consentId!, { userId: owner.id });
      expect(result.mustStop.railConnectionIds).toEqual([view.id]);
      await revokeConnectionsForConsent(result.mustStop.railConnectionIds, { actor: { userId: owner.id } });

      const after = await railRow(view.id);
      expect(after).toMatchObject({ status: "revoked", reportEnc: null, accessTokenEnc: null, reportSha256: before.reportSha256 });
      expect(await railItems(view.id)).toHaveLength(0);
      const shown = await getConnection(view.id, { userId: owner.id });
      expect(shown).toMatchObject({ status: "revoked", retrieved: null, offerUpload: true, reportSha256: before.reportSha256 });
      expect(shown.failureMessage?.es).toMatch(/desconectó/);

      // Nothing more is fetched for it.
      await syncConnection(view.id, { poll: 0, trigger: "job" });
      expect((await railRow(view.id)).status).toBe("revoked");
      // Idempotent.
      await revokeConnectionsForConsent([view.id]);
      expect((await listAuditLogs({ action: "rail.revoke" })).items).toHaveLength(1);
    });

    it("completion after the consent was taken back is refused", async () => {
      const started = await start();
      await revokeConsent(started.consentId, { userId: owner.id });
      expect(await detailsOf(completeConnection(started.connection.id, { persona: "single_w2" }, { userId: owner.id }))).toEqual({ code: "forbidden", reason: "consent_revoked" });
    });

    it("a sync after the consent was revoked does nothing", async () => {
      const started = await start();
      const view = await completeConnection(started.connection.id, { persona: "slow_provider" }, { userId: owner.id });
      expect(view.status).toBe("syncing");
      await revokeConsent(started.consentId, { userId: owner.id });
      setTestNow(new Date(Date.parse(T0) + SIMULATED_SLOW_READY_AFTER_MS + 1000));
      await syncConnection(view.id, { poll: 1, trigger: "job" });
      expect((await railRow(view.id)).reportEnc).toBeNull();
      expect(await railItems(view.id)).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------------------- personas */

  describe("personas end to end", () => {
    it("single W-2: one counted wage item from the W-2, encrypted report with its hash", async () => {
      const { view } = await connectPersona("single_w2");
      expect(view).toMatchObject({ status: "ready", offerUpload: false, waiting: false, failureReason: null });
      expect(view.retrieved?.sources.map((s) => [s.type, s.counted])).toEqual([
        ["w2", true],
        ["final_paystub_ytd", true],
      ]);
      const items = await railItems(view.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ source: "rail", category: "wages_salary", annualAmountCents: 4_125_000, incomeYear: 2025, counted: true, memberId: ownerMemberId, railConnectionId: view.id, documentId: null });
      expect(items[0]!.basis).toMatch(/sandbox test data/);
      const row = await railRow(view.id);
      const report = decryptJson<NormalizedIncomeReport>(row.reportEnc!, "rail-report");
      expect(row.reportSha256).toBe(railReportSha256(report));
      expect(report.person.name).toBe("Rosa Synthetic");
      expect(row.reportEnc).not.toContain("Synthetic Grocery");
    });

    it("two jobs: the W-2s are summed into one wage item", async () => {
      const { view } = await connectPersona("two_jobs");
      const items = await railItems(view.id);
      expect(items.map((i) => i.annualAmountCents)).toEqual([3_494_000]);
    });

    it("high earner: the full W-2 is recorded (the decision engine compares it to the limit)", async () => {
      const { view } = await connectPersona("high_earner");
      expect((await railItems(view.id)).map((i) => i.annualAmountCents)).toEqual([240_000_000]);
    });

    it("employer found but no data for the year: failed with a plain reason, report hash kept, upload offered", async () => {
      const { view } = await connectPersona("no_prior_year");
      expect(view).toMatchObject({ status: "failed", failureReason: "no_data_for_year", offerUpload: true });
      expect(view.failureMessage?.en).toMatch(/upload/i);
      expect(view.failureMessage?.es).toMatch(/Suba/);
      expect((await railRow(view.id)).reportSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await railItems(view.id)).toHaveLength(0);
    });

    it("mid-year pay stub only: ready but nothing counted, review flag for the decision, upload offered", async () => {
      const { view } = await connectPersona("partial_year");
      expect(view).toMatchObject({ status: "ready", offerUpload: true });
      expect(view.retrieved?.coverage).toEqual({ incomeYearCovered: false, partialYear: true });
      expect(await railItems(view.id)).toHaveLength(0);
      const summary = await getRailSummaryForDecision(verificationId);
      expect(summary.flags.map((f) => f.code)).toEqual(["pay_stub_projection_only"]);
      expect(summary.evidence).toEqual([]);
    });

    it("bank deposits: never counted; flagged as net deposits", async () => {
      const { view } = await connectPersona("bank_deposits", { kind: "bank" });
      expect(view.status).toBe("ready");
      expect(await railItems(view.id)).toHaveLength(0);
      const summary = await getRailSummaryForDecision(verificationId);
      expect(summary.railReports).toEqual([{ railConnectionId: view.id, provider: "simulated", kind: "bank", dataBasis: "bank_net_deposits", retrievedOn: "2026-11-18" }]);
      expect(summary.flags.map((f) => f.code)).toEqual(["rail_bank_net_deposits"]);
    });

    it.each([
      ["provider_outage", "provider_unavailable"],
      ["employer_not_found", "employer_not_found"],
      ["session_expired", "connection_expired"],
    ] as const)("%s fails with %s and a bilingual message", async (persona, reason) => {
      const { view } = await connectPersona(persona);
      expect(view).toMatchObject({ status: "failed", failureReason: reason, offerUpload: true });
      expect(view.failureMessage?.en.length).toBeGreaterThan(20);
      expect(view.failureMessage?.es.length).toBeGreaterThan(20);
    });

    it("person declines: declined, upload offered", async () => {
      const { view } = await connectPersona("declines");
      expect(view).toMatchObject({ status: "declined", offerUpload: true });
      expect(view.failureMessage?.en).toMatch(/chose not to connect/);
    });

    it("slow provider: waits, then a delayed job makes it ready", async () => {
      const { view } = await connectPersona("slow_provider");
      expect(view).toMatchObject({ status: "syncing", waiting: true });
      expect(await runJobs()).toMatchObject({ ran: 0 });
      setTestNow(new Date(Date.parse(T0) + SIMULATED_SLOW_READY_AFTER_MS + 1000));
      expect(await runJobs()).toMatchObject({ ran: 1, succeeded: 1 });
      const after = await getConnection(view.id, { userId: owner.id });
      expect(after).toMatchObject({ status: "ready", waiting: false });
      expect(await railItems(view.id)).toHaveLength(1);
    });

    it("a re-sync replaces the connection's items and never duplicates them", async () => {
      const { view } = await connectPersona("single_w2");
      const first = await railItems(view.id);
      await syncConnection(view.id, { poll: 0, trigger: "job" });
      await syncConnection(view.id, { poll: 0, trigger: "job" });
      const again = await railItems(view.id);
      expect(again).toHaveLength(1);
      expect(again[0]!.annualAmountCents).toBe(first[0]!.annualAmountCents);
      expect((await railRow(view.id)).status).toBe("ready");
    });

    it("completing twice is idempotent; completing an ended connection is a conflict", async () => {
      const { started, view } = await connectPersona("single_w2");
      const again = await completeConnection(started.connection.id, { persona: "high_earner" }, { userId: owner.id });
      expect(again.status).toBe("ready");
      expect((await railItems(view.id)).map((i) => i.annualAmountCents)).toEqual([4_125_000]);
      const declined = await connectPersona("declines");
      expect(await detailsOf(completeConnection(declined.view.id, { persona: "single_w2" }, { userId: owner.id }))).toMatchObject({ code: "conflict", reason: "connection_closed" });
    });
  });

  /* ---------------------------------------------------------------------------- fallback */

  describe("fallback to upload", () => {
    async function seedFamilyEvidence() {
      const db = await getDb();
      const objectId = newId("object");
      await db.insert(schema.objects).values({ id: objectId, storageKey: `k/${objectId}`, purpose: "upload", sha256: sha256Hex("synthetic"), size: 9, contentType: "application/pdf", wrappedKey: "synthetic", householdId });
      const documentId = newId("document");
      await db.insert(schema.documents).values({ id: documentId, verificationId, householdId, declaredKind: "w2", objectId, sha256: sha256Hex("synthetic"), filename: "w2-synthetic.pdf", contentType: "application/pdf", size: 9 });
      await db.insert(schema.incomeItems).values([
        { id: newId("incomeItem"), verificationId, memberId: spouseMemberId, source: "document", category: "wages_salary", incomeYear: 2025, annualAmountCents: 1_000_000, documentId },
        { id: newId("incomeItem"), verificationId, memberId: null, source: "self_reported", category: "child_support_received", incomeYear: 2025, annualAmountCents: 120_000 },
      ]);
      return { documentId };
    }

    it.each(["provider_outage", "declines", "no_prior_year", "session_expired"])("after %s, existing documents and items are untouched", async (persona) => {
      const { documentId } = await seedFamilyEvidence();
      const before = await allItems(verificationId);
      await connectPersona(persona);
      const db = await getDb();
      expect(await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))).toHaveLength(1);
      expect(await allItems(verificationId)).toEqual(before);
      const [ver] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verificationId));
      expect(ver!.status).toBe("pending");
    });

    it("declining an unfinished connection leaves the rest intact, and a revocation removes only the rail's items", async () => {
      await seedFamilyEvidence();
      const started = await start();
      const declined = await declineConnection(started.connection.id, { userId: owner.id });
      expect(declined.status).toBe("declined");
      const { view } = await connectPersona("single_w2");
      expect(await allItems(verificationId)).toHaveLength(3);
      await revokeConnection(view.id, { userId: owner.id });
      const left = await allItems(verificationId);
      expect(left.map((i) => i.source).sort()).toEqual(["document", "self_reported"]);
    });

    it("after a decision, revocation keeps the items the decision rests on but still deletes the report", async () => {
      const { view } = await connectPersona("single_w2");
      const db = await getDb();
      await db.update(schema.verifications).set({ decidedAt: new Date(T0) }).where(eq(schema.verifications.id, verificationId));
      await revokeConnection(view.id, { userId: owner.id });
      expect(await railItems(view.id)).toHaveLength(1);
      expect((await railRow(view.id)).reportEnc).toBeNull();
    });
  });

  /* ------------------------------------------------------------------------------ access */

  describe("access", () => {
    it("denies other households everything, answering not_found", async () => {
      const { view } = await connectPersona("single_w2");
      const s = { userId: stranger.id };
      expect(await codeOf(listConnections(verificationId, s))).toBe("not_found");
      expect(await codeOf(getConnection(view.id, s))).toBe("not_found");
      expect(await codeOf(completeConnection(view.id, { persona: "single_w2" }, s))).toBe("not_found");
      expect(await codeOf(declineConnection(view.id, s))).toBe("not_found");
      expect(await codeOf(revokeConnection(view.id, s))).toBe("not_found");
      expect(await codeOf(previewRailConsent(verificationId, s, "en"))).toBe("not_found");
      expect(await codeOf(startConnection({ verificationId, memberId: ownerMemberId, kind: "payroll" }, s))).toBe("not_found");
      // The owner cannot reach the stranger's verification either, nor use a member of another household.
      expect(await codeOf(startConnection({ verificationId: strangerVerificationId, memberId: ownerMemberId, kind: "payroll" }, { userId: owner.id }))).toBe("not_found");
      expect(await codeOf(listConnections("ver_missing", { userId: owner.id }))).toBe("not_found");
      expect(await codeOf(getConnection("rail_missing", { userId: owner.id }))).toBe("not_found");
      expect(await codeOf(listConnections(verificationId, { userId: "usr_missing" }))).toBe("forbidden");
    });

    it("each adult with a sign-in connects their own account; the owner may connect for a member without one", async () => {
      expect(await codeOf(start({ memberId: ownerMemberId }, adult))).toBe("forbidden");
      expect(await codeOf(start({ memberId: adultMemberId }, owner))).toBe("forbidden");
      expect(await codeOf(start({ memberId: spouseMemberId }, adult))).toBe("forbidden");
      const own = await start({ memberId: adultMemberId }, adult);
      expect(own.connection.status).toBe("connecting");
      const forSpouse = await start({ memberId: spouseMemberId }, owner);
      expect(forSpouse.connection.memberId).toBe(spouseMemberId);
      // Only the person who started a connection finishes it.
      expect(await codeOf(completeConnection(own.connection.id, { persona: "single_w2" }, { userId: owner.id }))).toBe("forbidden");
      // The adult can list the household's connections but cannot revoke one the owner made.
      expect((await listConnections(verificationId, { userId: adult.id })).length).toBe(2);
      expect(await codeOf(revokeConnection(forSpouse.connection.id, { userId: adult.id }))).toBe("forbidden");
      expect(await codeOf(revokeConnection(own.connection.id, { userId: owner.id }))).toBe("ok");
    });

    it("rejects bad input, unknown or removed members, closed verifications and live mode with the sandbox rail", async () => {
      expect(await codeOf(startConnection({ verificationId, memberId: ownerMemberId, kind: "transcript" as "payroll" }, { userId: owner.id }))).toBe("validation_failed");
      expect(await codeOf(start({ memberId: "hm_missing" }))).toBe("not_found");
      const db = await getDb();
      await db.update(schema.householdMembers).set({ removedAt: new Date(T0) }).where(eq(schema.householdMembers.id, spouseMemberId));
      expect(await codeOf(start({ memberId: spouseMemberId }))).toBe("not_found");
      await db.update(schema.verifications).set({ mode: "live" }).where(eq(schema.verifications.id, verificationId));
      expect(await detailsOf(start())).toEqual({ code: "not_available", reason: "rail_unavailable_for_mode" });
      await db.update(schema.verifications).set({ mode: "test", status: "eligible", stage: "decided" }).where(eq(schema.verifications.id, verificationId));
      expect(await detailsOf(start())).toEqual({ code: "conflict", reason: "verification_closed" });
      expect(await db.select().from(schema.consents)).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------------- polling limits */

  describe("sync robustness", () => {
    it("gives up after the poll limit with provider_unavailable", async () => {
      let calls = 0;
      const flaky: RailProvider = {
        ...(await import("./simulated")).simulatedRail,
        async fetchIncomeReport() {
          calls += 1;
          throw new RailProviderError("provider_unavailable", "synthetic outage", { retryable: true });
        },
      };
      setRailProviderForTests("simulated", flaky);
      const started = await start();
      const view = await completeConnection(started.connection.id, { persona: "single_w2" }, { userId: owner.id });
      expect(view.status).toBe("syncing");
      await syncConnection(view.id, { poll: RAIL_POLICY.maxPolls - 1, trigger: "poll" });
      expect(await railRow(view.id)).toMatchObject({ status: "failed", failureReason: "provider_unavailable" });
      expect(calls).toBe(2);
    });

    it("a failed re-sync does not undo a report already received", async () => {
      const { view } = await connectPersona("single_w2");
      setRailProviderForTests("simulated", {
        ...(await import("./simulated")).simulatedRail,
        async fetchIncomeReport() {
          throw new RailProviderError("connection_expired", "synthetic");
        },
      });
      await syncConnection(view.id, { poll: 0, trigger: "job" });
      expect((await railRow(view.id)).status).toBe("ready");
      expect(await railItems(view.id)).toHaveLength(1);
      expect((await listAuditLogs({ action: "rail.resync_failed" })).items).toHaveLength(1);
    });

    it("never lets sandbox data reach a verification that became live", async () => {
      const started = await start();
      const view = await completeConnection(started.connection.id, { persona: "slow_provider" }, { userId: owner.id });
      const db = await getDb();
      await db.update(schema.verifications).set({ mode: "live" }).where(eq(schema.verifications.id, verificationId));
      setTestNow(new Date(Date.parse(T0) + SIMULATED_SLOW_READY_AFTER_MS + 1000));
      await syncConnection(view.id, { poll: 1, trigger: "job" });
      expect(await railRow(view.id)).toMatchObject({ status: "failed", failureReason: "provider_unavailable", reportEnc: null });
      expect(await railItems(view.id)).toHaveLength(0);
    });

    it("a stale provider failure from a double-submitted completion does not fail a connection that was linked meanwhile", async () => {
      const { simulatedRail } = await import("./simulated");
      let calls = 0;
      setRailProviderForTests("simulated", {
        ...simulatedRail,
        async completeLink(input) {
          calls += 1;
          if (calls === 1) {
            // The second submission wins the race and links the connection while this one is still at the provider.
            // (a provider that prepares the data later, so the connection is "syncing", not yet "ready").
            await completeConnection(input.connection.id, { persona: "slow_provider" }, { userId: owner.id });
            throw new RailProviderError("connection_expired", "synthetic: the one-time token was already used");
          }
          return simulatedRail.completeLink(input);
        },
      });
      const started = await start();
      const view = await completeConnection(started.connection.id, { persona: "slow_provider" }, { userId: owner.id });
      expect(calls).toBe(2);
      expect(view).toMatchObject({ status: "syncing", failureReason: null, waiting: true });
      expect((await listAuditLogs({ action: "rail.fail" })).items).toHaveLength(0);
      setTestNow(new Date(Date.parse(T0) + SIMULATED_SLOW_READY_AFTER_MS + 1000));
      await runJobs();
      expect((await railRow(view.id)).status).toBe("ready");
      expect(await railItems(view.id)).toHaveLength(1);
    });

    it("never replaces income items after the verification was decided", async () => {
      const { view } = await connectPersona("single_w2");
      const idsBefore = (await railItems(view.id)).map((i) => i.id);
      const db = await getDb();
      await db.update(schema.verifications).set({ status: "eligible", stage: "decided", decidedAt: new Date(T0) }).where(eq(schema.verifications.id, verificationId));
      await syncConnection(view.id, { poll: 0, trigger: "webhook" });
      expect((await railItems(view.id)).map((i) => i.id)).toEqual(idsBefore);
      // Also when only decidedAt is set (status still pending while a decision is being recorded).
      await db.update(schema.verifications).set({ status: "pending", stage: "processing" }).where(eq(schema.verifications.id, verificationId));
      await syncConnection(view.id, { poll: 0, trigger: "webhook" });
      expect((await railItems(view.id)).map((i) => i.id)).toEqual(idsBefore);
      expect((await listAuditLogs({ action: "rail.sync" })).items).toHaveLength(1);
    });

    it("a report that breaks the stored format or names another year fails as records_unreadable instead of throwing", async () => {
      const { simulatedRail } = await import("./simulated");
      const variants: Array<(r: NormalizedIncomeReport) => NormalizedIncomeReport> = [
        (r) => ({ ...r, sources: r.sources.map((s) => ({ ...s, employerName: "E".repeat(201) })) }),
        (r) => ({ ...r, sources: r.sources.map((s) => ({ ...s, grossAnnualCents: -1 })) }),
        (r) => ({ ...r, incomeYear: 2024 }),
      ];
      for (const mutate of variants) {
        setRailProviderForTests("simulated", {
          ...simulatedRail,
          async fetchIncomeReport(connection, ctx) {
            const result = await simulatedRail.fetchIncomeReport(connection, ctx);
            return result.state === "ready" ? { state: "ready", report: mutate(result.report) } : result;
          },
        });
        const started = await start();
        const view = await completeConnection(started.connection.id, { persona: "single_w2" }, { userId: owner.id });
        expect(view).toMatchObject({ status: "failed", failureReason: "records_unreadable", offerUpload: true, waiting: false });
        expect(await railItems(view.id)).toHaveLength(0);
      }
    });

    it("an unexpected error during the inline fetch hands the connection to the sync job instead of stranding it", async () => {
      const { simulatedRail } = await import("./simulated");
      let broken = true;
      setRailProviderForTests("simulated", {
        ...simulatedRail,
        async fetchIncomeReport(connection, ctx) {
          if (broken) throw new TypeError("synthetic bug");
          return simulatedRail.fetchIncomeReport(connection, ctx);
        },
      });
      const started = await start();
      const view = await completeConnection(started.connection.id, { persona: "single_w2" }, { userId: owner.id });
      expect(view).toMatchObject({ status: "connected", waiting: true });
      const db = await getDb();
      expect((await db.select().from(schema.jobs)).map((j) => j.type)).toEqual(["rail.sync"]);
      broken = false;
      setTestNow(new Date(Date.parse(T0) + RAIL_POLICY.pollIntervalMs + 1000));
      expect(await runJobs()).toMatchObject({ ran: 1, succeeded: 1 });
      expect(await getConnection(view.id, { userId: owner.id })).toMatchObject({ status: "ready" });
      expect(await railItems(view.id)).toHaveLength(1);
    });

    it("the job handler validates its payload", async () => {
      await expect(jobHandlers["rail.sync"]!({}, { jobId: "job_1", attempt: 1 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(jobHandlers["rail.revoke_remote"]!({ connectionId: 5 }, { jobId: "job_1", attempt: 1 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(jobHandlers["rail.sync"]!({ connectionId: "rail_missing" }, { jobId: "job_1", attempt: 1 })).resolves.toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------------- decision summary */

  describe("getRailSummaryForDecision", () => {
    it("gives reconcile-ready evidence, rail report summaries, pending and unfinished connections", async () => {
      const ready = await connectPersona("single_w2");
      const slow = await connectPersona("slow_provider", { memberId: spouseMemberId });
      const unfinished = await start({ memberId: spouseMemberId });
      await connectPersona("provider_outage");

      const summary = await getRailSummaryForDecision(verificationId);
      expect(summary.pending).toBe(true);
      expect(summary.unfinished).toEqual([unfinished.connection.id]);
      expect(summary.connections.map((c) => c.status)).toEqual(["ready", "syncing", "connecting", "failed"]);
      expect(summary.connections[0]).toMatchObject({ craPosture: "not_applicable", sandbox: true, reportSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(summary.connections[3]!.failureReason).toBe("provider_unavailable");
      expect(summary.railReports.map((r) => r.railConnectionId)).toEqual([ready.view.id]);
      expect(summary.evidence.every((e) => e.origin === "rail" && e.sourceId === ready.view.id)).toBe(true);
      const reconciled = reconcileIncomeEvidence({ incomeYear: 2025, evidence: summary.evidence });
      expect(reconciled.items.map((i) => i.annualAmountCents)).toEqual([4_125_000]);
      expect(slow.view.status).toBe("syncing");
      expect((await listAuditLogs({ action: "rail.read_for_decision" })).items).toHaveLength(1);
    });

    it("throws not_found for an unknown verification and is empty without connections", async () => {
      expect(await codeOf(getRailSummaryForDecision("ver_missing"))).toBe("not_found");
      expect(await getRailSummaryForDecision(verificationId)).toMatchObject({ pending: false, unfinished: [], connections: [], evidence: [], flags: [], railReports: [] });
    });
  });

  /* --------------------------------------------------------------------------------- Plaid */

  describe("with Plaid (mocked HTTP)", () => {
    const signer = makeWebhookSigner("kid-1", Math.floor(Date.parse(T0) / 1000) - 3600);
    let plaid: ReturnType<typeof fakePlaidFetch>;
    let payrollReady = false;

    beforeEach(() => {
      payrollReady = false;
      process.env.RAIL_PROVIDER = "plaid";
      plaid = fakePlaidFetch({
        "/user/create": (b) => ({ json: { user_id: `usr_${String(b.client_user_id)}` } }),
        "/link/token/create": () => ({ json: { link_token: "link-sandbox-synthetic", expiration: "2026-11-18T19:00:00Z" } }),
        "/item/public_token/exchange": () => ({ json: { access_token: "access-sandbox-SECRET-TOKEN-123", item_id: "item_1" } }),
        "/credit/payroll_income/get": () => ({ json: payrollIncomeBody(2025, { status: payrollReady ? "PROCESSING_COMPLETE" : "PROCESSING" }) }),
        "/credit/bank_income/get": () => ({ json: { bank_income: [{ items: [{ bank_income_sources: [{ income_source_id: "s1", income_description: "SYNTHETIC PAYROLL DEPOSIT", income_category: "SALARY", historical_summary: [{ start_date: "2025-03-01", end_date: "2025-03-31", total_amounts: [{ amount: 3000, iso_currency_code: "USD" }] }] }] }] }] } }),
        "/webhook_verification_key/get": () => ({ json: { key: signer.key } }),
        "/item/remove": () => ({ json: {} }),
        "/user/remove": () => ({ json: {} }),
      });
      setRailProviderForTests("plaid", createPlaidRail({ clientId: "client-synthetic", secret: "secret-synthetic", environment: "sandbox", fetch: plaid.fetch }));
    });

    function webhook(userId: string, status: string, opts: { sign?: boolean } = {}) {
      const body = JSON.stringify({ webhook_type: "INCOME", webhook_code: "USER_INCOME_VERIFICATION", item_id: "item_1", user_id: userId, verification_status: status, environment: "sandbox" }, null, 2);
      const headers = new Headers();
      if (opts.sign !== false) headers.set("plaid-verification", signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid, typ: "JWT" }, { iat: Math.floor(Date.parse(T0) / 1000), request_body_sha256: sha256Hex(body) }));
      return { body, headers };
    }

    it("payroll: link token → success → webhook (verified) → sync → ready", async () => {
      const started = await start();
      expect(started.client).toEqual({ provider: "plaid", sandbox: true, linkToken: "link-sandbox-synthetic", expiration: "2026-11-18T19:00:00Z" });
      const row = await railRow(started.connection.id);
      expect(row.externalId).toBe(`usr_${row.id}`);
      expect(started.connection.providerName).toBe("Plaid");

      const linked = await completeConnection(started.connection.id, { status: "success", publicToken: "public-sandbox-x" }, { userId: owner.id });
      expect(linked.status).toBe("syncing");
      expect(plaid.calls.some((c) => c.path === "/item/public_token/exchange")).toBe(false);
      expect((await railRow(row.id)).accessTokenEnc).toBeNull();

      // An unsigned webhook is rejected and schedules nothing.
      const unsigned = webhook(row.externalId!, "VERIFICATION_STATUS_PROCESSING_COMPLETE", { sign: false });
      expect(await codeOf(handleRailWebhook("plaid", unsigned.body, unsigned.headers))).toBe("unauthenticated");

      payrollReady = true;
      const signed = webhook(row.externalId!, "VERIFICATION_STATUS_PROCESSING_COMPLETE");
      expect(await handleRailWebhook("plaid", signed.body, signed.headers)).toEqual({ status: "processed", connectionId: row.id });
      expect(await runJobs()).toMatchObject({ ran: 1, succeeded: 1 });
      const after = await getConnection(row.id, { userId: owner.id });
      expect(after.status).toBe("ready");
      expect((await railItems(row.id)).map((i) => i.annualAmountCents)).toEqual([5_200_000]);
      expect((await listAuditLogs({ action: "rail.webhook" })).items[0]).toMatchObject({ actorType: "webhook" });

      // A webhook for an unknown user is ignored after verification.
      const unknown = webhook("usr_unknown", "VERIFICATION_STATUS_PROCESSING_COMPLETE");
      expect(await handleRailWebhook("plaid", unknown.body, unknown.headers)).toEqual({ status: "ignored", connectionId: null });
    });

    it("payroll: the fallback poll fetches if the webhook never comes; PROCESSING keeps waiting", async () => {
      const started = await start();
      await completeConnection(started.connection.id, { status: "success", publicToken: "public-sandbox-x" }, { userId: owner.id });
      setTestNow(new Date(Date.parse(T0) + RAIL_POLICY.webhookFallbackPollMs + 1000));
      await runJobs();
      expect((await railRow(started.connection.id)).status).toBe("syncing");
      payrollReady = true;
      setTestNow(new Date(Date.parse(T0) + RAIL_POLICY.webhookFallbackPollMs + RAIL_POLICY.pollIntervalMs + 2000));
      await runJobs();
      expect((await railRow(started.connection.id)).status).toBe("ready");
    });

    it("payroll: a PROCESSING_FAILED webhook fails the connection and the family is offered upload", async () => {
      const started = await start();
      await completeConnection(started.connection.id, { status: "success", publicToken: "public-sandbox-x" }, { userId: owner.id });
      const row = await railRow(started.connection.id);
      const failed = webhook(row.externalId!, "VERIFICATION_STATUS_PROCESSING_FAILED");
      await handleRailWebhook("plaid", failed.body, failed.headers);
      expect(await getConnection(row.id, { userId: owner.id })).toMatchObject({ status: "failed", failureReason: "provider_unavailable", offerUpload: true });
    });

    it("bank: the access token is stored only encrypted, and revocation removes the Item and the user at Plaid", async () => {
      const started = await start({ kind: "bank" });
      const view = await completeConnection(started.connection.id, { status: "success", publicToken: "public-sandbox-x" }, { userId: owner.id });
      expect(view.status).toBe("ready");
      expect(await railItems(view.id)).toHaveLength(0);
      const row = await railRow(view.id);
      expect(row.accessTokenEnc).toMatch(/^v1\./);

      const text = await wholeDatabaseText();
      expect(text).not.toContain("access-sandbox-SECRET-TOKEN-123");
      expect(text).not.toContain("SYNTHETIC PAYROLL DEPOSIT");
      expect(text).not.toContain("secret-synthetic");

      await revokeConnection(view.id, { userId: owner.id });
      const removeCalls = plaid.calls.filter((c) => c.path === "/item/remove" || c.path === "/user/remove");
      expect(removeCalls.map((c) => [c.path, c.body])).toEqual([
        ["/item/remove", { access_token: "access-sandbox-SECRET-TOKEN-123" }],
        ["/user/remove", { user_id: row.externalId }],
      ]);
      expect(await railRow(view.id)).toMatchObject({ status: "revoked", accessTokenEnc: null, reportEnc: null, reportSha256: row.reportSha256 });
    });

    it("bank: when Plaid is down at revocation, the token is kept for a retry job that finishes the removal", async () => {
      const started = await start({ kind: "bank" });
      const view = await completeConnection(started.connection.id, { status: "success", publicToken: "public-sandbox-x" }, { userId: owner.id });
      let down = true;
      const flaky = fakePlaidFetch({
        "/item/remove": () => (down ? { status: 503, json: {} } : { json: {} }),
        "/user/remove": () => ({ json: {} }),
      });
      setRailProviderForTests("plaid", createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: flaky.fetch }));
      await revokeConnection(view.id, { userId: owner.id });
      expect(await railRow(view.id)).toMatchObject({ status: "revoked", reportEnc: null });
      expect((await railRow(view.id)).accessTokenEnc).toMatch(/^v1\./);
      expect(await runJobs()).toMatchObject({ ran: 1, failed: 1 });
      down = false;
      setTestNow(new Date(Date.parse(T0) + 60 * 60 * 1000));
      expect(await runJobs()).toMatchObject({ ran: 1, succeeded: 1 });
      expect((await railRow(view.id)).accessTokenEnc).toBeNull();
    });

    it("bank: when the Item was removed but the user removal failed, the retry does not present the dead token again", async () => {
      const started = await start({ kind: "bank" });
      const view = await completeConnection(started.connection.id, { status: "success", publicToken: "public-sandbox-x" }, { userId: owner.id });
      let userDown = true;
      const partial = fakePlaidFetch({
        "/item/remove": () => ({ json: {} }),
        "/user/remove": () => (userDown ? { status: 503, json: {} } : { json: {} }),
      });
      setRailProviderForTests("plaid", createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: partial.fetch }));
      await revokeConnection(view.id, { userId: owner.id });
      expect((await railRow(view.id)).accessTokenEnc).toBeNull();
      userDown = false;
      expect(await runJobs()).toMatchObject({ ran: 1, succeeded: 1 });
      expect(partial.calls.map((c) => c.path)).toEqual(["/item/remove", "/user/remove", "/user/remove"]);
    });

    it("Link exit without an error is a decline; an expired link token fails as connection_expired", async () => {
      const a = await start();
      expect((await completeConnection(a.connection.id, { status: "exit", errorCode: null, exitStatus: "requires_credentials" }, { userId: owner.id })).status).toBe("declined");
      const b = await start();
      expect(await completeConnection(b.connection.id, { status: "exit", errorCode: "INVALID_LINK_TOKEN", exitStatus: null }, { userId: owner.id })).toMatchObject({ status: "failed", failureReason: "connection_expired" });
    });

    it("a Plaid outage while opening the session leaves a failed connection and no client payload", async () => {
      setRailProviderForTests("plaid", createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/user/create": () => ({ status: 500, json: {} }) }).fetch }));
      const started = await start();
      expect(started.client).toBeNull();
      expect(started.connection).toMatchObject({ status: "failed", failureReason: "provider_unavailable", offerUpload: true });
    });

    it("a sandbox Plaid configuration cannot serve a live verification", async () => {
      const db = await getDb();
      await db.update(schema.verifications).set({ mode: "live" }).where(eq(schema.verifications.id, verificationId));
      expect(await detailsOf(start())).toEqual({ code: "not_available", reason: "rail_unavailable_for_mode" });
    });
  });
});
