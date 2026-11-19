import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { placeOrder, saveCheckout, startCheckout } from "@/server/donations";
import { createListedSgo, drainJobs as drainDonationJobs, paySandbox, singleFilerPatch } from "@/server/donations/test-support";
import { emitEvent } from "@/server/events";
import { makeBusiness, makeSgo, partner } from "@/server/handoffs/test-support";
import { systemActor, updateSgoProfile } from "@/server/sgos";
import { createEndpoint, setWebhookResolverForTests } from "@/server/webhooks";
import { useTestDb } from "../../../tests/helpers/db";
import { OPERATIONS, OPERATION_IDS, type OperationDefinition, type OperationId } from "./operations";
import { allowWebhookHosts, attachSyntheticEvidence, callApi, callJson, makeKey } from "./test-support";

/**
 * Tenant and mode isolation, route by route. Two SGOs (A, B) and one business (C), each with a test and a live key.
 * The victim resources belong to SGO A in test mode (and business C in test mode for handoffs). Every other key —
 * the other SGO, the business, and A's own live key — must get 403 (wrong organization type) or 404 on every route
 * that names a victim resource, must not see victim resources in any list, and must not change them.
 *
 * Documented exception (WEBHOOK_WRITE_NEEDS_LIVE_KEY_ONCE_LIVE): webhook endpoints belong to the organization, not a
 * mode, so A's live key may manage A's endpoints; their delivery history is still filtered by the key's mode.
 */

type KeyName = "aTest" | "aLive" | "bTest" | "bLive" | "cTest" | "cLive";

interface World {
  aOrgId: string;
  keys: Record<KeyName, string>;
  verificationId: string;
  liveVerificationId: string;
  donationId: string;
  eventId: string;
  endpointId: string;
  handoffId: string;
}

/** Valid bodies, so that a refusal can only come from isolation, never from validation. */
const BODIES: Partial<Record<OperationId, unknown>> = {
  createVerification: { external_ref: "ATTACKER" },
  createHandoff: { booking_ref: "ATTACKER" },
  completeHandoff: {},
  cancelHandoff: {},
  extendHandoffHold: { hours: 1 },
  createWebhookEndpoint: { url: "https://hooks.attacker.example/x" },
  updateWebhookEndpoint: { description: "attacker" },
  rotateWebhookSecret: {},
};

function victimPath(op: OperationDefinition, w: World): string {
  if (!op.path.includes("{id}")) return op.path;
  const resource = op.path.split("/")[1];
  const id = { verifications: w.verificationId, donations: w.donationId, events: w.eventId, webhook_endpoints: w.endpointId, handoffs: w.handoffId }[resource];
  if (!id) throw new Error(`No victim resource for ${op.path}`);
  return op.path.replace("{id}", id);
}

/** The key that owns the victim resource of an operation. */
function ownerOf(op: OperationDefinition): KeyName {
  return op.orgTypes.length === 1 && op.orgTypes[0] === "business" ? "cTest" : "aTest";
}

describe("tenant and mode isolation matrix", () => {
  useTestDb({ truncate: false });
  const w = {} as World;
  const ownerSnapshot: Record<string, unknown> = {};

  beforeAll(async () => {
    setTestNow("2026-11-18T16:00:00.000Z");
    allowWebhookHosts();
    const a = await createListedSgo({ name: "Synthetic Fund A", portalRegistered: true });
    const b = await makeSgo("Synthetic Fund B");
    const c = await makeBusiness({ name: "Synthetic Camp C" });
    await updateSgoProfile(a.orgId, { acceptsHandoffs: true }, systemActor("api isolation test"));
    await partner(c.orgId, a.orgId);
    w.aOrgId = a.orgId;

    // A's endpoint exists before any event, so the event below creates a delivery for it.
    w.endpointId = (await createEndpoint({ orgId: a.orgId, url: "https://hooks.fund-a.example/p" })).endpoint.id;

    w.keys = {
      aTest: await makeKey(a.orgId, "test"),
      aLive: await makeKey(a.orgId, "live"),
      bTest: await makeKey(b, "test"),
      bLive: await makeKey(b, "live"),
      cTest: await makeKey(c.orgId, "test"),
      cLive: await makeKey(c.orgId, "live"),
    };

    w.verificationId = (await callJson<{ id: string }>("POST", "/verifications", { key: w.keys.aTest, body: { external_ref: "VICTIM" } })).body.id;
    await attachSyntheticEvidence(a.orgId, w.verificationId);
    w.liveVerificationId = (await callJson<{ id: string }>("POST", "/verifications", { key: w.keys.aLive, body: { external_ref: "VICTIM-LIVE" } })).body.id;

    const { token } = await startCheckout({ sgoSlug: a.slug, source: "hosted" });
    await saveCheckout(token, singleFilerPatch());
    await saveCheckout(token, { designationConfirmed: true });
    await paySandbox((await placeOrder(token)).payment);
    await drainDonationJobs();
    const [donation] = await (await getDb()).select().from(schema.donations).where(eq(schema.donations.orgId, a.orgId));
    w.donationId = donation.id;

    w.eventId = (await emitEvent({ orgId: a.orgId, type: "verification.decided", payload: { id: w.verificationId, victim: true }, mode: "test" })).id;
    const handoff = await callJson<{ id: string }>("POST", "/handoffs", { key: w.keys.cTest, body: { booking_ref: "VICTIM-BOOKING" } });
    expect(handoff.status).toBe(201);
    w.handoffId = handoff.body.id;

    for (const path of [`/verifications/${w.verificationId}`, `/handoffs/${w.handoffId}`, `/webhook_endpoints/${w.endpointId}`]) {
      ownerSnapshot[path] = (await callJson("GET", path, { key: path.startsWith("/handoffs") ? w.keys.cTest : w.keys.aTest })).body;
    }
  });

  afterAll(() => {
    setTestNow(null);
    setWebhookResolverForTests(null);
  });

  const victimIds = () => [w.verificationId, w.liveVerificationId, w.donationId, w.eventId, w.handoffId];
  const ATTACKERS: KeyName[] = ["aLive", "bTest", "bLive", "cTest", "cLive"];

  it("covers every operation of the API", () => {
    const covered = OPERATION_IDS.filter((id) => !(OPERATIONS[id] as OperationDefinition).public);
    expect(covered.length).toBeGreaterThan(20);
  });

  for (const id of OPERATION_IDS) {
    const op = OPERATIONS[id] as OperationDefinition;
    if (op.public) continue;
    it(`${op.method} ${op.path}`, async () => {
      const path = victimPath(op, w);
      const owner = ownerOf(op);
      for (const attacker of [...ATTACKERS, "aTest" as KeyName].filter((k) => k !== owner)) {
        const sameOrgOtherMode = (owner === "aTest" && attacker === "aLive") || (owner === "cTest" && attacker === "cLive");
        const org = attacker[0];
        const orgType = org === "c" ? "business" : "sgo";
        const webhookWrite = op.path.startsWith("/webhook_endpoints") && op.method !== "GET";
        let target = path;
        if (id === "deleteWebhookEndpoint" && sameOrgOtherMode) {
          // Allowed (documented): prove it on a throwaway endpoint so the victim stays for the other routes.
          target = `/webhook_endpoints/${(await createEndpoint({ orgId: w.aOrgId, url: "https://hooks.fund-a.example/throwaway" })).endpoint.id}`;
        }
        const res = await callApi(op.method, target, { key: w.keys[attacker], ...(BODIES[id] !== undefined ? { body: BODIES[id] } : {}) });
        const label = `${attacker} → ${op.method} ${path} = ${res.status}`;
        const text = await res.text();

        if (!op.orgTypes.includes(orgType)) {
          expect(res.status, label).toBe(403);
          continue;
        }
        const webhookEndpointRoute = op.path.startsWith("/webhook_endpoints");
        if (webhookWrite && attacker.endsWith("Test")) {
          // Every organization here holds a live key, so test keys may not change endpoints at all (checked before
          // any endpoint is loaded, so the answer says nothing about which ids exist).
          expect(res.status, label).toBe(403);
          expect((JSON.parse(text) as { error: { details: { reason: string } } }).error.details.reason, label).toBe("live_key_required");
          continue;
        }
        if (webhookEndpointRoute && sameOrgOtherMode) {
          // Endpoints are per organization. A's live key may see and manage A's endpoints, but never test deliveries.
          expect(res.status, label).toBeLessThan(400);
          if (id === "listWebhookDeliveries") expect((JSON.parse(text) as { data: unknown[] }).data, label).toEqual([]);
          continue;
        }
        if (op.path.includes("{id}")) {
          expect(res.status, label).toBe(404);
          continue;
        }
        // Lists and creates: allowed, but scoped to the attacker's own organization and mode.
        expect(res.status, label).toBeLessThan(400);
        for (const victim of victimIds()) {
          if (sameOrgOtherMode && victim === w.liveVerificationId) continue;
          // C's own handoff (and its events) are C's to see.
          if (attacker === "cTest" && victim === w.handoffId) continue;
          expect(text.includes(victim), `${label} leaked ${victim}`).toBe(false);
        }
        if (webhookEndpointRoute && org !== "a") expect(text.includes(w.endpointId), label).toBe(false);
      }
    });
  }

  it("left every victim resource unchanged and lists only the owner's own records", async () => {
    for (const [path, before] of Object.entries(ownerSnapshot)) {
      const after = (await callJson("GET", path, { key: path.startsWith("/handoffs") ? w.keys.cTest : w.keys.aTest })).body;
      if (path.startsWith("/webhook_endpoints")) {
        // A's live key was allowed to edit it (documented); nobody else changed it.
        expect((after as { id: string }).id).toBe((before as { id: string }).id);
        continue;
      }
      expect(after, path).toEqual(before);
    }
    const aList = await callJson<{ data: Array<{ external_ref: string }> }>("GET", "/verifications?limit=100", { key: w.keys.aTest });
    // VICTIM, plus the verification C's handoff opened at A (external_ref null); nothing an attacker created.
    expect(aList.body.data.map((v) => v.external_ref ?? "(handoff)").sort()).toEqual(["(handoff)", "VICTIM"]);
    const aLiveList = await callJson<{ data: Array<{ external_ref: string }> }>("GET", "/verifications?limit=100", { key: w.keys.aLive });
    // A's live key created ATTACKER in A's live mode; C's live key opened a live handoff verification at A.
    expect(aLiveList.body.data.map((v) => v.external_ref ?? "(handoff)").sort()).toEqual(["(handoff)", "ATTACKER", "VICTIM-LIVE"]);
    const cTestList = await callJson<{ data: Array<{ booking_ref: string }> }>("GET", "/handoffs?limit=100", { key: w.keys.cTest });
    expect(cTestList.body.data.map((h) => h.booking_ref)).toEqual(["VICTIM-BOOKING"]);
    const events = await callJson<{ data: Array<{ id: string }> }>("GET", "/events?limit=100", { key: w.keys.bTest });
    expect(events.body.data.map((e) => e.id)).not.toContain(w.eventId);
    const csv = await (await callApi("GET", "/verifications/export.csv?columns=external_ref", { key: w.keys.bTest })).text();
    expect(csv).not.toContain("VICTIM");
  });
});
