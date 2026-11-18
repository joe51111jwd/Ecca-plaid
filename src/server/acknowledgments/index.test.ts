import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { useTestDb } from "../../../tests/helpers/db";
import { acknowledgmentSummaries, donorNumberSummaries, listPendingAcknowledgmentRefreshes, markAcknowledgmentStale, resolveAcknowledgmentRefresh } from "./index";

/* Synthetic organizations, donors and numbers. */

const NOW = new Date("2027-01-05T15:00:00.000Z");

describe("acknowledgments", () => {
  const t = useTestDb();
  let orgId: string;
  let donorA: string;
  let donorB: string;

  async function donor(first: string): Promise<string> {
    const id = newId("donor");
    await t.db.insert(schema.donors).values({ id, email: `${first.toLowerCase()}@synthetic.example`, firstName: first, lastName: "Synthetic", addressLine1: "1 Synthetic Way", city: "Austin", state: "TX", zip: "78701" });
    return id;
  }

  beforeEach(async () => {
    setTestNow(NOW);
    orgId = newId("org");
    await t.db.insert(schema.organizations).values({ id: orgId, type: "sgo", name: "Synthetic Fund", slug: `synthetic-${orgId.toLowerCase()}` });
    donorA = await donor("Avery");
    donorB = await donor("Blake");
  });
  afterEach(() => setTestNow(null));

  describe("refresh requests", () => {
    it("keeps one pending request per donor, SGO, year and mode, with the latest reason", async () => {
      await markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "test", reason: "gift_succeeded", donationId: "don_1" });
      setTestNow(new Date(NOW.getTime() + 1_000));
      await markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "test", reason: "gift_refunded", donationId: "don_2" });
      await markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "live", reason: "gift_succeeded" });
      const pending = await listPendingAcknowledgmentRefreshes({ mode: "test" });
      expect(pending).toMatchObject([{ donorId: donorA, reason: "gift_refunded", lastDonationId: "don_2", resolvedAt: null }]);
      expect(await listPendingAcknowledgmentRefreshes({ mode: "live", orgId, taxYear: 2027 })).toHaveLength(1);
      expect(await listPendingAcknowledgmentRefreshes({ mode: "test", taxYear: 2026 })).toHaveLength(0);
    });

    it("resolves only the request the generator read, never a newer one", async () => {
      await markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "test", reason: "gift_succeeded" });
      const [read] = await listPendingAcknowledgmentRefreshes({ mode: "test" });
      setTestNow(new Date(NOW.getTime() + 5_000));
      await markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "test", reason: "gift_succeeded" });
      expect(await resolveAcknowledgmentRefresh({ ...read })).toBe(false);
      const [latest] = await listPendingAcknowledgmentRefreshes({ mode: "test" });
      expect(await resolveAcknowledgmentRefresh({ ...latest })).toBe(true);
      expect(await listPendingAcknowledgmentRefreshes({ mode: "test" })).toHaveLength(0);
      await markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "test", reason: "correction" });
      expect(await listPendingAcknowledgmentRefreshes({ mode: "test" })).toHaveLength(1);
    });

    it("validates its input", async () => {
      await expect(markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 1999, mode: "test", reason: "gift_succeeded" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(markAcknowledgmentStale({ orgId, donorId: donorA, taxYear: 2027, mode: "test", reason: "whim" as "correction" })).rejects.toMatchObject({ code: "validation_failed" });
    });
  });

  describe("summaries", () => {
    it("reports the latest acknowledgment version, or not_generated, and whether a refresh is pending", async () => {
      await t.db.insert(schema.acknowledgments).values([
        { id: newId("acknowledgment"), orgId, donorId: donorA, mode: "test", taxYear: 2027, version: 1, status: "superseded", totalDesignatedCents: 100_000 },
        { id: newId("acknowledgment"), orgId, donorId: donorA, mode: "test", taxYear: 2027, version: 2, status: "issued", totalDesignatedCents: 170_000, issuedAt: NOW, delivery: "email" },
        { id: newId("acknowledgment"), orgId, donorId: donorA, mode: "test", taxYear: 2026, version: 1, status: "issued", totalDesignatedCents: 5 },
      ]);
      await markAcknowledgmentStale({ orgId, donorId: donorB, taxYear: 2027, mode: "test", reason: "gift_succeeded" });
      const map = await acknowledgmentSummaries({ orgId, mode: "test", taxYear: 2027, donorIds: [donorA, donorB, donorA] });
      expect(map.get(donorA)).toMatchObject({ status: "issued", version: 2, issuedAt: NOW, delivery: "email", needsRegeneration: false });
      expect(map.get(donorB)).toMatchObject({ status: "not_generated", version: null, needsRegeneration: true });
      expect((await acknowledgmentSummaries({ orgId, mode: "test", taxYear: 2027, donorIds: [] })).size).toBe(0);
    });

    it("never invents a donor number: assigned, sandbox, pending registration or not assigned", async () => {
      await t.db.insert(schema.donorNumbers).values([
        { id: newId("donorNumber"), orgId, donorId: donorA, taxYear: 2027, mode: "test", number: "SANDBOX-1", source: "sandbox_generated" },
        { id: newId("donorNumber"), orgId, donorId: donorA, taxYear: 2027, mode: "live", number: "SYNTHETIC-PORTAL-1", source: "irs_portal_entered" },
      ]);
      const unregistered = await donorNumberSummaries({ orgId, mode: "test", taxYear: 2027, donorIds: [donorA, donorB], sgoPortalRegistered: false });
      expect(unregistered.get(donorA)).toMatchObject({ status: "sandbox", number: "SANDBOX-1" });
      expect(unregistered.get(donorB)).toMatchObject({ status: "pending_sgo_registration", number: null });
      const registered = await donorNumberSummaries({ orgId, mode: "live", taxYear: 2027, donorIds: [donorA, donorB], sgoPortalRegistered: true });
      expect(registered.get(donorA)).toMatchObject({ status: "assigned", number: "SYNTHETIC-PORTAL-1", source: "irs_portal_entered" });
      expect(registered.get(donorB)).toMatchObject({ status: "not_assigned", number: null });
    });
  });
});
