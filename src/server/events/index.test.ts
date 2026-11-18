import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { addMs, setTestNow } from "@/lib/clock";
import * as jobsModule from "@/server/jobs";
import { createEndpoint, disableEndpoint } from "@/server/webhooks";
import { createTestOrg } from "@/server/webhooks/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { emitEvent, EVENT_TYPES, getEvent, listEvents } from "./index";

const T0 = new Date("2026-11-18T12:00:00.000Z");
const { events, webhookDeliveries, jobs } = schema;

describe("events", () => {
  const t = useTestDb();
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    setTestNow(T0);
    orgA = await createTestOrg("Synthetic SGO A");
    orgB = await createTestOrg("Synthetic SGO B");
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  const endpointUrl = (name: string) => `http://127.0.0.1:9/${name}`;

  describe("emitEvent", () => {
    it("stores the event and returns it", async () => {
      const payload = { verification_id: "ver_SYNTHETIC0000000000001", status: "eligible", nested: { n: 1 } };
      const event = await emitEvent({ orgId: orgA, type: "verification.decided", payload, mode: "test" });
      expect(event.id).toMatch(/^evt_/);
      expect(event).toMatchObject({ orgId: orgA, type: "verification.decided", mode: "test", payload });
      expect(event.createdAt).toEqual(T0);
      expect(await t.db.select().from(events)).toEqual([event]);
      // Nobody is subscribed: no deliveries, no jobs.
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(0);
      expect(await t.db.select().from(jobs)).toHaveLength(0);
    });

    it("accepts every declared event type and both modes", async () => {
      for (const type of EVENT_TYPES) await emitEvent({ orgId: orgA, type, payload: {}, mode: "live" });
      const stored = await t.db.select().from(events);
      expect(stored.map((e) => e.type).sort()).toEqual([...EVENT_TYPES].sort());
      expect(new Set(stored.map((e) => e.mode))).toEqual(new Set(["live"]));
    });

    it("fans out to the organization's active endpoints that subscribe to the type", async () => {
      const all = await createEndpoint({ orgId: orgA, url: endpointUrl("all") });
      const decided = await createEndpoint({ orgId: orgA, url: endpointUrl("decided"), eventTypes: ["verification.decided", "verification.expired"] });
      await createEndpoint({ orgId: orgA, url: endpointUrl("donations"), eventTypes: ["donation.succeeded"] });
      const disabled = await createEndpoint({ orgId: orgA, url: endpointUrl("disabled") });
      await disableEndpoint(orgA, disabled.endpoint.id);
      await createEndpoint({ orgId: orgB, url: endpointUrl("other-tenant") });

      const event = await emitEvent({ orgId: orgA, type: "verification.decided", payload: { ok: true }, mode: "test" });

      const deliveries = await t.db.select().from(webhookDeliveries);
      expect(deliveries.map((d) => d.endpointId).sort()).toEqual([all.endpoint.id, decided.endpoint.id].sort());
      for (const d of deliveries) {
        expect(d.id).toMatch(/^whd_/);
        expect(d).toMatchObject({
          eventId: event.id,
          orgId: orgA,
          eventType: "verification.decided",
          attempt: 0,
          status: "pending",
          responseStatus: null,
          responseExcerpt: null,
          error: null,
          deliveredAt: null,
        });
        expect(d.nextAttemptAt).toEqual(T0);
        expect(d.createdAt).toEqual(T0);
      }

      const queued = await t.db.select().from(jobs);
      expect(queued).toHaveLength(2);
      for (const job of queued) {
        expect(job).toMatchObject({ type: "webhook.deliver", status: "queued", attempts: 0 });
        expect(job.runAt).toEqual(T0);
        const delivery = deliveries.find((d) => d.id === job.payload.deliveryId)!;
        expect(job.payload).toEqual({ deliveryId: delivery.id, attempt: 1 });
        expect(job.dedupeKey).toBe(`webhook.deliver:${delivery.id}:1`);
      }
      expect(new Set(queued.map((j) => j.payload.deliveryId)).size).toBe(2);
    });

    it("delivers nothing for types nobody subscribed to and nothing to other tenants", async () => {
      await createEndpoint({ orgId: orgA, url: endpointUrl("donations"), eventTypes: ["donation.succeeded"] });
      await createEndpoint({ orgId: orgB, url: endpointUrl("b-all") });
      await emitEvent({ orgId: orgA, type: "handoff.held", payload: {}, mode: "live" });
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(0);
      expect(await t.db.select().from(jobs)).toHaveLength(0);

      await emitEvent({ orgId: orgB, type: "handoff.held", payload: {}, mode: "live" });
      const deliveries = await t.db.select().from(webhookDeliveries);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].orgId).toBe(orgB);
    });

    it("rolls back the event, its deliveries and its jobs with the caller's transaction", async () => {
      await createEndpoint({ orgId: orgA, url: endpointUrl("all") });
      await expect(
        t.db.transaction(async (tx) => {
          const event = await emitEvent({ orgId: orgA, type: "verification.decided", payload: { n: 1 }, mode: "test" }, tx);
          // Visible inside the transaction...
          expect(await tx.select().from(events).where(eq(events.id, event.id))).toHaveLength(1);
          expect(await tx.select().from(webhookDeliveries)).toHaveLength(1);
          expect(await tx.select().from(jobs)).toHaveLength(1);
          throw new Error("state change failed");
        }),
      ).rejects.toThrow("state change failed");
      // ...and gone with it.
      expect(await t.db.select().from(events)).toHaveLength(0);
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(0);
      expect(await t.db.select().from(jobs)).toHaveLength(0);
    });

    it("commits the event, its deliveries and its jobs with the caller's transaction", async () => {
      await createEndpoint({ orgId: orgA, url: endpointUrl("all") });
      const event = await t.db.transaction(async (tx) => {
        await tx.update(schema.organizations).set({ name: "Renamed in the same transaction" }).where(eq(schema.organizations.id, orgA));
        return emitEvent({ orgId: orgA, type: "donation.succeeded", payload: { n: 2 }, mode: "live" }, tx);
      });
      expect(await getEvent(orgA, event.id)).toEqual(event);
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(1);
      expect(await t.db.select().from(jobs)).toHaveLength(1);
    });

    it("writes nothing at all when the fan-out fails, even without a caller transaction", async () => {
      await createEndpoint({ orgId: orgA, url: endpointUrl("one") });
      await createEndpoint({ orgId: orgA, url: endpointUrl("two") });
      let calls = 0;
      const realEnqueue = jobsModule.enqueue;
      vi.spyOn(jobsModule, "enqueue").mockImplementation(async (...args) => {
        // The first delivery's job is written, the second one fails.
        if (++calls === 2) throw new Error("synthetic queue outage");
        return realEnqueue(...args);
      });
      await expect(emitEvent({ orgId: orgA, type: "verification.decided", payload: {}, mode: "test" })).rejects.toThrow("synthetic queue outage");
      expect(calls).toBe(2);
      expect(await t.db.select().from(events)).toHaveLength(0);
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(0);
      expect(await t.db.select().from(jobs)).toHaveLength(0);
    });

    it("rejects unknown types, bad modes, missing organizations and non-object payloads", async () => {
      const base = { orgId: orgA, type: "verification.decided", payload: {}, mode: "test" } as const;
      await expect(emitEvent({ ...base, type: "verification.exploded" as never })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(emitEvent({ ...base, type: "*" as never })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(emitEvent({ ...base, mode: "prod" as never })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(emitEvent({ ...base, orgId: "" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(emitEvent({ ...base, payload: [1, 2] as never })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(emitEvent({ ...base, payload: null as never })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(emitEvent({ ...base, payload: { n: BigInt(1) } })).rejects.toMatchObject({ code: "validation_failed" });
      // An organization that does not exist violates the foreign key.
      await expect(emitEvent({ ...base, orgId: "org_does_not_exist" })).rejects.toThrow();
      expect(await t.db.select().from(events)).toHaveLength(0);
    });

    it("stores the payload exactly as JSON round-trips it", async () => {
      const event = await emitEvent({ orgId: orgA, type: "award.offered", payload: { at: new Date("2027-01-01T00:00:00Z"), skip: undefined, cents: 150000 }, mode: "test" });
      expect(event.payload).toEqual({ at: "2027-01-01T00:00:00.000Z", cents: 150000 });
    });
  });

  describe("listEvents and getEvent", () => {
    async function seed() {
      const made = [];
      // Three events share one timestamp so the cursor has to break ties by id.
      for (const [i, type] of (["verification.started", "verification.submitted", "verification.decided"] as const).entries()) {
        made.push(await emitEvent({ orgId: orgA, type, payload: { i }, mode: "test" }));
      }
      setTestNow(addMs(T0, 1000));
      made.push(await emitEvent({ orgId: orgA, type: "donation.succeeded", payload: { i: 3 }, mode: "live" }));
      setTestNow(addMs(T0, 2000));
      made.push(await emitEvent({ orgId: orgA, type: "verification.decided", payload: { i: 4 }, mode: "live" }));
      const foreign = await emitEvent({ orgId: orgB, type: "verification.decided", payload: { secret: "other tenant" }, mode: "test" });
      return { made, foreign };
    }

    it("lists only the organization's events, newest first", async () => {
      const { made, foreign } = await seed();
      const listed = await listEvents({ orgId: orgA });
      expect(listed).toHaveLength(5);
      expect(listed.map((e) => e.id)).not.toContain(foreign.id);
      expect(listed[0].id).toBe(made[4].id);
      expect(listed[1].id).toBe(made[3].id);
      const times = listed.map((e) => e.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect((await listEvents({ orgId: orgB })).map((e) => e.id)).toEqual([foreign.id]);
      expect(await listEvents({ orgId: "org_unknown" })).toEqual([]);
    });

    it("lists events that share a timestamp in the order they were emitted", async () => {
      // A frozen clock (demos, end-to-end tests) or one fast transaction gives many events the same instant.
      const types = ["handoff.started", "handoff.held", "handoff.eligible", "handoff.awarded", "handoff.completed"] as const;
      for (const type of types) await emitEvent({ orgId: orgA, type, payload: {}, mode: "test" });
      expect((await listEvents({ orgId: orgA })).map((e) => e.type)).toEqual([...types].reverse());
      expect((await listEvents({ orgId: orgA, limit: 2 })).map((e) => e.type)).toEqual(["handoff.completed", "handoff.awarded"]);
    });

    it("filters by type and mode and honours the limit", async () => {
      const { made } = await seed();
      expect((await listEvents({ orgId: orgA, type: "verification.decided" })).map((e) => e.payload.i)).toEqual([4, 2]);
      expect((await listEvents({ orgId: orgA, mode: "live" })).map((e) => e.id)).toEqual([made[4].id, made[3].id]);
      expect(await listEvents({ orgId: orgA, mode: "test" })).toHaveLength(3);
      expect(await listEvents({ orgId: orgA, mode: "test", type: "donation.succeeded" })).toEqual([]);
      expect(await listEvents({ orgId: orgA, limit: 2 })).toHaveLength(2);
      for (const bad of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { mode: "prod" as never }, { type: "" }]) {
        await expect(listEvents({ orgId: orgA, ...bad })).rejects.toMatchObject({ code: "validation_failed" });
      }
    });

    it("pages with an event id cursor without skipping or repeating events", async () => {
      await seed();
      const everything = await listEvents({ orgId: orgA });
      const paged = [];
      let before: string | undefined;
      for (;;) {
        const page = await listEvents({ orgId: orgA, limit: 2, before });
        paged.push(...page);
        if (page.length < 2) break;
        before = page.at(-1)!.id;
      }
      expect(paged.map((e) => e.id)).toEqual(everything.map((e) => e.id));
      expect(await listEvents({ orgId: orgA, before: everything.at(-1)!.id })).toEqual([]);
    });

    it("accepts a date as the cursor", async () => {
      const { made } = await seed();
      expect((await listEvents({ orgId: orgA, before: addMs(T0, 2000) })).map((e) => e.id)).not.toContain(made[4].id);
      expect(await listEvents({ orgId: orgA, before: addMs(T0, 2000) })).toHaveLength(4);
      expect(await listEvents({ orgId: orgA, before: addMs(T0, 1) })).toHaveLength(3);
      expect(await listEvents({ orgId: orgA, before: T0 })).toEqual([]);
    });

    it("rejects a cursor that is not one of the organization's events", async () => {
      const { foreign } = await seed();
      await expect(listEvents({ orgId: orgA, before: "evt_unknown" })).rejects.toMatchObject({ code: "bad_request" });
      await expect(listEvents({ orgId: orgA, before: foreign.id })).rejects.toMatchObject({ code: "bad_request" });
    });

    it("getEvent returns an own event and hides everything else as not_found", async () => {
      const { made, foreign } = await seed();
      expect(await getEvent(orgA, made[0].id)).toEqual(made[0]);
      expect(await getEvent(orgB, foreign.id)).toEqual(foreign);
      await expect(getEvent(orgA, foreign.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
      await expect(getEvent(orgB, made[0].id)).rejects.toMatchObject({ code: "not_found" });
      await expect(getEvent(orgA, "evt_unknown")).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
