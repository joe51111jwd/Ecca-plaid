import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { addMs, MS, setTestNow } from "@/lib/clock";
import { parseCsv } from "@/lib/csv";
import { emitEvent, type EventRecord } from "@/server/events";
import { getJobStats, listJobs, runDueJobs } from "@/server/jobs";
import { useTestDb } from "../../../tests/helpers/db";
import { attemptDelivery, retryAfterMs, sendSignedRequest, sweepDueDeliveries, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_SCHEDULE_MS } from "./deliver";
import {
  AUTO_DISABLE_AFTER_DEAD_DELIVERIES,
  buildSignedRequest,
  createEndpoint,
  deleteEndpoint,
  disableEndpoint,
  getDelivery,
  getEndpoint,
  listDeliveries,
  resendDelivery,
  RESPONSE_EXCERPT_CHARS,
  rotateSecret,
  setWebhookResolverForTests,
  verifyWebhookSignature,
  WEBHOOK_TIMEOUT_MS,
  type WebhookEndpoint,
} from "./index";
import { jobHandlers, recurringJobs } from "./jobs";
import { createTestOrg, startReceiver, type Receiver } from "./test-support";

const T0 = new Date("2026-11-18T12:00:00.000Z");
const { webhookEndpoints, webhookDeliveries, jobs } = schema;
const run = () => runDueJobs({ handlers: jobHandlers, limit: 100 });

describe("webhook delivery", () => {
  const t = useTestDb();
  let orgId: string;
  let receiver: Receiver;
  const extraReceivers: Receiver[] = [];

  beforeEach(async () => {
    setTestNow(T0);
    orgId = await createTestOrg();
    receiver = await startReceiver();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    setTestNow(null);
    setWebhookResolverForTests(null);
    vi.restoreAllMocks();
    await receiver.close();
    for (const r of extraReceivers.splice(0)) await r.close();
  });

  async function endpointAt(url: string, extra: Partial<Parameters<typeof createEndpoint>[0]> = {}): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    return createEndpoint({ orgId, url, ...extra });
  }
  const emit = (payload: Record<string, unknown> = { verification_id: "ver_SYNTHETIC0000000000001", status: "eligible" }): Promise<EventRecord> =>
    emitEvent({ orgId, type: "verification.decided", payload, mode: "test" });
  const onlyDelivery = async () => {
    const all = await listDeliveries({ orgId });
    expect(all).toHaveLength(1);
    return all[0];
  };

  describe("a successful delivery", () => {
    it("POSTs the signed event once and records the response", async () => {
      const { endpoint, secret } = await endpointAt(`${receiver.origin}/hooks/passport?tenant=synthetic`);
      receiver.reply(() => ({ status: 200, body: '{"received":true}', headers: { "content-type": "application/json" } }));
      const event = await emit();

      expect(await run()).toEqual({ ran: 1, succeeded: 1, failed: 0 });

      expect(receiver.requests).toHaveLength(1);
      const [request] = receiver.requests;
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/hooks/passport?tenant=synthetic");
      expect(request.headers["content-type"]).toBe("application/json");
      expect(request.headers["user-agent"]).toBe("Passport-Webhooks/1.0");
      expect(request.headers["content-length"]).toBe(String(Buffer.byteLength(request.body)));
      expect(request.headers.host).toBe(`127.0.0.1:${receiver.port}`);
      expect(request.headers["webhook-id"]).toBe(event.id);
      expect(request.headers["webhook-timestamp"]).toBe(String(T0.getTime() / 1000));
      expect(request.headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/);
      expect(JSON.parse(request.body)).toEqual({
        id: event.id,
        type: "verification.decided",
        created_at: "2026-11-18T12:00:00.000Z",
        mode: "test",
        data: { verification_id: "ver_SYNTHETIC0000000000001", status: "eligible" },
      });
      // Key order is part of the contract shown in the docs.
      expect(Object.keys(JSON.parse(request.body))).toEqual(["id", "type", "created_at", "mode", "data"]);

      // The receiver can verify it with the secret it was given and nothing else.
      expect(verifyWebhookSignature({ secret, headers: request.headers, body: request.body, now: T0 })).toBe(true);
      expect(verifyWebhookSignature({ secret, headers: request.headers, body: `${request.body} `, now: T0 })).toBe(false);
      const expected = buildSignedRequest({ url: endpoint.url, id: event.id, timestamp: T0, body: request.body, secrets: secret });
      expect(request.headers["webhook-signature"]).toBe(expected.headers["webhook-signature"]);

      const delivery = await onlyDelivery();
      expect(delivery).toMatchObject({ status: "succeeded", attempt: 1, responseStatus: 200, responseExcerpt: '{"received":true}', error: null, nextAttemptAt: null });
      expect(delivery.deliveredAt).toEqual(T0);
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: 0, lastSuccessAt: T0, lastFailureAt: null });
      expect((await getJobStats()).byStatus).toMatchObject({ queued: 0, running: 0, succeeded: 1, dead: 0 });
    });

    it("treats every 2xx as success, with or without a body", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      const statuses = [201, 202, 204, 299];
      receiver.reply((_req, i) => ({ status: statuses[i], body: statuses[i] === 204 ? "" : "accepted" }));
      for (const status of statuses) {
        await emit({ status });
        await run();
      }
      const deliveries = await listDeliveries({ orgId });
      expect(deliveries.map((d) => d.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
      expect(deliveries.map((d) => d.responseStatus).sort()).toEqual([201, 202, 204, 299]);
      expect(deliveries.find((d) => d.responseStatus === 204)!.responseExcerpt).toBeNull();
    });

    it("delivers one event to every subscribed endpoint independently", async () => {
      const second = await startReceiver();
      extraReceivers.push(second);
      const a = await endpointAt(`${receiver.origin}/a`);
      const b = await endpointAt(`${second.origin}/b`);
      second.reply(() => ({ status: 503, body: "synthetic outage" }));
      const event = await emit();
      expect(await run()).toEqual({ ran: 2, succeeded: 2, failed: 0 });

      expect(receiver.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);
      // Same event id for both receivers, each signed with its own secret.
      expect(receiver.requests[0].headers["webhook-id"]).toBe(event.id);
      expect(second.requests[0].headers["webhook-id"]).toBe(event.id);
      expect(verifyWebhookSignature({ secret: a.secret, headers: receiver.requests[0].headers, body: receiver.requests[0].body, now: T0 })).toBe(true);
      expect(verifyWebhookSignature({ secret: b.secret, headers: receiver.requests[0].headers, body: receiver.requests[0].body, now: T0 })).toBe(false);
      expect(verifyWebhookSignature({ secret: b.secret, headers: second.requests[0].headers, body: second.requests[0].body, now: T0 })).toBe(true);

      expect((await listDeliveries({ orgId, endpointId: a.endpoint.id }))[0].status).toBe("succeeded");
      expect((await listDeliveries({ orgId, endpointId: b.endpoint.id }))[0]).toMatchObject({ status: "failed", responseStatus: 503, responseExcerpt: "synthetic outage" });
    });

    it("delivers events emitted at the same instant in the order they were emitted", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      const steps = ["started", "held", "eligible", "awarded", "completed"];
      for (const step of steps) await emit({ step });
      await run();
      expect(receiver.requests.map((r) => JSON.parse(r.body).data.step)).toEqual(steps);
      // Listed newest first.
      const events = await Promise.all((await listDeliveries({ orgId })).map((d) => t.db.select().from(schema.events).where(eq(schema.events.id, d.eventId))));
      expect(events.map(([e]) => e.payload.step)).toEqual([...steps].reverse());
    });

    it("sends the generic_csv_row format as signed CSV", async () => {
      const { secret } = await endpointAt(`${receiver.origin}/csv`, { format: "generic_csv_row" });
      const event = await emit({ verification_id: "ver_SYNTHETIC0000000000001", status: "eligible", household: { size: 4, county: "Harris" }, methods: ["upload", "rail"], note: null });
      await run();
      const [request] = receiver.requests;
      expect(request.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(verifyWebhookSignature({ secret, headers: request.headers, body: request.body, now: T0 })).toBe(true);
      expect(parseCsv(request.body)).toEqual([
        ["event_id", "event_type", "created_at", "mode", "data.household.county", "data.household.size", "data.methods", "data.note", "data.status", "data.verification_id"],
        [event.id, "verification.decided", "2026-11-18T12:00:00.000Z", "test", "Harris", "4", "upload;rail", "", "eligible", "ver_SYNTHETIC0000000000001"],
      ]);
      expect((await onlyDelivery()).status).toBe("succeeded");
    });
  });

  describe("failures and retries", () => {
    it("retries after 1m, 5m, 30m, 2h, 12h and 24h, then marks the delivery dead", async () => {
      expect(WEBHOOK_RETRY_SCHEDULE_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000, 86_400_000]);
      expect(WEBHOOK_MAX_ATTEMPTS).toBe(7);
      const { endpoint, secret } = await endpointAt(`${receiver.origin}/hook`);
      receiver.reply(() => ({ status: 500, body: "synthetic server error" }));
      const event = await emit();

      let clock = T0;
      for (const [i, delay] of WEBHOOK_RETRY_SCHEDULE_MS.entries()) {
        expect(await run()).toEqual({ ran: 1, succeeded: 1, failed: 0 });
        expect(receiver.requests).toHaveLength(i + 1);
        const delivery = await onlyDelivery();
        expect(delivery).toMatchObject({
          status: "failed",
          attempt: i + 1,
          responseStatus: 500,
          responseExcerpt: "synthetic server error",
          error: "The endpoint responded with HTTP 500",
          deliveredAt: null,
        });
        expect(delivery.nextAttemptAt).toEqual(addMs(clock, delay));
        expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: 0, lastFailureAt: clock, lastSuccessAt: null });

        const [next] = await listJobs({ status: "queued" });
        expect(next).toMatchObject({ type: "webhook.deliver", payload: { deliveryId: delivery.id, attempt: i + 2 }, dedupeKey: `webhook.deliver:${delivery.id}:${i + 2}` });
        expect(next.runAt).toEqual(addMs(clock, delay));

        // Not a millisecond early.
        setTestNow(addMs(clock, delay - 1));
        expect(await run()).toEqual({ ran: 0, succeeded: 0, failed: 0 });
        clock = addMs(clock, delay);
        setTestNow(clock);
      }

      // Seventh and last attempt.
      expect(await run()).toEqual({ ran: 1, succeeded: 1, failed: 0 });
      expect(receiver.requests).toHaveLength(7);
      const dead = await onlyDelivery();
      expect(dead).toMatchObject({ status: "dead", attempt: 7, responseStatus: 500, error: "The endpoint responded with HTTP 500", nextAttemptAt: null, deliveredAt: null });
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: 1, lastFailureAt: clock });

      // Nothing further is scheduled, ever.
      expect(await listJobs({ status: "queued" })).toEqual([]);
      setTestNow(addMs(clock, 30 * MS.day));
      expect(await run()).toEqual({ ran: 0, succeeded: 0, failed: 0 });
      expect(receiver.requests).toHaveLength(7);

      // Every attempt carried the same id and a fresh timestamp and signature.
      expect(new Set(receiver.requests.map((r) => r.headers["webhook-id"]))).toEqual(new Set([event.id]));
      const timestamps = receiver.requests.map((r) => Number(r.headers["webhook-timestamp"]));
      const offsets = [0, 60, 360, 2160, 9360, 52_560, 138_960];
      expect(timestamps).toEqual(offsets.map((s) => T0.getTime() / 1000 + s));
      expect(new Set(receiver.requests.map((r) => r.headers["webhook-signature"])).size).toBe(7);
      for (const [i, request] of receiver.requests.entries()) {
        expect(verifyWebhookSignature({ secret, headers: request.headers, body: request.body, now: new Date(timestamps[i] * 1000) })).toBe(true);
      }
      expect(new Set(receiver.requests.map((r) => r.body)).size).toBe(1);
    });

    it("succeeds on a later attempt and clears the failure streak", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/hook`);
      await t.db.update(webhookEndpoints).set({ failureCount: 7 }).where(eq(webhookEndpoints.id, endpoint.id));
      receiver.reply((_req, i) => (i < 2 ? { status: 502, body: "bad gateway" } : { status: 200, body: "ok" }));
      await emit();
      await run();
      setTestNow(addMs(T0, MS.minute));
      await run();
      setTestNow(addMs(T0, 6 * MS.minute));
      await run();

      expect(receiver.requests).toHaveLength(3);
      const delivery = await onlyDelivery();
      expect(delivery).toMatchObject({ status: "succeeded", attempt: 3, responseStatus: 200, responseExcerpt: "ok", error: null, nextAttemptAt: null });
      expect(delivery.deliveredAt).toEqual(addMs(T0, 6 * MS.minute));
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ failureCount: 0, lastSuccessAt: addMs(T0, 6 * MS.minute), lastFailureAt: addMs(T0, MS.minute) });
      expect(await listJobs({ status: "queued" })).toEqual([]);
    });

    it("treats 3xx as a failure and never follows the redirect", async () => {
      const target = await startReceiver();
      extraReceivers.push(target);
      await endpointAt(`${receiver.origin}/moved`);
      const statuses = [301, 302, 303, 307, 308];
      receiver.reply((_req, i) => ({ status: statuses[i], headers: { location: `${target.origin}/elsewhere` }, body: "redirecting" }));
      for (const status of statuses) await emit({ status });
      await run();
      expect(receiver.requests).toHaveLength(5);
      expect(target.requests).toHaveLength(0);
      const deliveries = await listDeliveries({ orgId });
      expect(deliveries.map((d) => d.status)).toEqual(Array(5).fill("failed"));
      expect(deliveries.map((d) => d.responseStatus).sort()).toEqual([301, 302, 303, 307, 308]);
      expect(deliveries[0].error).toMatch(/^The endpoint responded with HTTP 30\d$/);
    });

    it("does not follow a redirect to an internal address either", async () => {
      await endpointAt(`${receiver.origin}/ssrf`);
      receiver.reply(() => ({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
      await emit();
      await run();
      expect(receiver.requests).toHaveLength(1);
      expect(await onlyDelivery()).toMatchObject({ status: "failed", responseStatus: 302 });
    });

    it("fails the attempt when the receiver does not answer in time", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/slow`);
      receiver.reply(() => ({ hang: true }));
      await emit();
      const delivery = await onlyDelivery();
      const started = Date.now();
      const res = await attemptDelivery(delivery.id, 1, { timeoutMs: 400 });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(res).toMatchObject({ outcome: "retry_scheduled", status: null });
      expect(res.nextAttemptAt).toEqual(addMs(T0, MS.minute));
      expect(receiver.requests).toHaveLength(1);
      expect(await getDelivery(orgId, delivery.id)).toMatchObject({ status: "failed", attempt: 1, responseStatus: null, responseExcerpt: null, error: "No response within 400 ms" });
      expect((await getEndpoint(orgId, endpoint.id)).lastFailureAt).toEqual(T0);
    });

    it("fails the attempt when nothing listens on the port", async () => {
      const closed = await startReceiver();
      await closed.close();
      await endpointAt(`${closed.origin}/nobody-home`);
      await emit();
      await run();
      const delivery = await onlyDelivery();
      expect(delivery).toMatchObject({ status: "failed", attempt: 1, responseStatus: null });
      expect(delivery.error).toContain("ECONNREFUSED");
    });

    it("keeps only the first 500 characters of the response, without control bytes", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      const bodies = [
        "x".repeat(2000),
        "é".repeat(700),
        `before\u0000after\u0007 tab\tnewline\nend`,
        Buffer.concat([Buffer.from("partial "), Buffer.from([0xe2, 0x82])]), // truncated multi-byte sequence
        "y".repeat(1024 * 1024),
      ];
      receiver.reply((_req, i) => ({ status: 400, body: bodies[i] }));
      for (let i = 0; i < bodies.length; i++) {
        await emit({ i });
        await run();
      }
      // Newest first, so reversed is the order the bodies were served in.
      const excerpts = (await listDeliveries({ orgId })).reverse().map((d) => d.responseExcerpt!);
      expect(excerpts[0]).toBe("x".repeat(500));
      expect(excerpts[1]).toBe("é".repeat(500));
      expect(excerpts[2]).toBe("beforeafter tab\tnewline\nend");
      expect(excerpts[3]).toBe("partial �");
      expect(excerpts[4]).toBe("y".repeat(500));
    });

    it("waits longer than the schedule when the receiver sends Retry-After, within limits", async () => {
      await endpointAt(`${receiver.origin}/busy`);
      const cases: Array<{ header: string; expectedMs: number }> = [
        { header: "600", expectedMs: 10 * MS.minute }, // later than the 1-minute step: honoured
        { header: "5", expectedMs: MS.minute }, // earlier than the schedule: the schedule stays the floor
        { header: new Date(T0.getTime() + 20 * MS.minute).toUTCString(), expectedMs: 20 * MS.minute }, // HTTP date
        { header: "9999999", expectedMs: 24 * MS.hour }, // capped
        { header: "soon", expectedMs: MS.minute }, // unusable: ignored
        { header: "-30", expectedMs: MS.minute },
        { header: new Date(T0.getTime() - MS.hour).toUTCString(), expectedMs: MS.minute }, // in the past
      ];
      receiver.reply((_req, i) => ({ status: i % 2 === 0 ? 429 : 503, headers: { "retry-after": cases[i].header }, body: "slow down" }));
      for (const [i, { header, expectedMs }] of cases.entries()) {
        const event = await emit({ i });
        const [delivery] = await listDeliveries({ orgId, eventId: event.id });
        const res = await attemptDelivery(delivery.id, 1);
        expect(res.outcome, header).toBe("retry_scheduled");
        expect(res.nextAttemptAt, header).toEqual(addMs(T0, expectedMs));
        expect((await getDelivery(orgId, delivery.id)).nextAttemptAt, header).toEqual(addMs(T0, expectedMs));
        const [job] = await t.db.select().from(jobs).where(eq(jobs.dedupeKey, `webhook.deliver:${delivery.id}:2`));
        expect(job.runAt, header).toEqual(addMs(T0, expectedMs));
      }
      expect(retryAfterMs(null, T0)).toBe(0);
      expect(retryAfterMs("", T0)).toBe(0);
      expect(retryAfterMs(" 120 ", T0)).toBe(120_000);
      expect(retryAfterMs("1.5", T0)).toBe(0);
    });

    it("stops and disables the endpoint when the receiver answers 410 Gone", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/retired`);
      receiver.reply(() => ({ status: 410, body: "gone" }));
      await emit();
      await run();
      expect(await onlyDelivery()).toMatchObject({ status: "dead", attempt: 1, responseStatus: 410, nextAttemptAt: null });
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "disabled", failureCount: 1 });
      expect(await listJobs({ status: "queued" })).toEqual([]);
    });
  });

  describe("automatic disabling", () => {
    /** Emits an event and fast-forwards its delivery to the final attempt, which then fails. */
    async function oneDeadDelivery(): Promise<void> {
      const event = await emit();
      const [delivery] = await listDeliveries({ orgId, eventId: event.id });
      await t.db
        .update(webhookDeliveries)
        .set({ status: "failed", attempt: WEBHOOK_MAX_ATTEMPTS - 1 })
        .where(eq(webhookDeliveries.id, delivery.id));
      expect(await attemptDelivery(delivery.id, WEBHOOK_MAX_ATTEMPTS)).toMatchObject({ outcome: "dead", reason: "retries_exhausted" });
    }

    it(`disables the endpoint after ${AUTO_DISABLE_AFTER_DEAD_DELIVERIES} consecutive dead deliveries, not before`, async () => {
      expect(AUTO_DISABLE_AFTER_DEAD_DELIVERIES).toBe(20);
      const { endpoint } = await endpointAt(`${receiver.origin}/down`);
      receiver.reply(() => ({ status: 500 }));
      for (let i = 1; i <= 19; i++) {
        await oneDeadDelivery();
        expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: i });
      }
      await oneDeadDelivery();
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "disabled", failureCount: 20 });

      // A disabled endpoint gets no new deliveries.
      const before = (await listDeliveries({ orgId, limit: 200 })).length;
      await emit();
      expect(await listDeliveries({ orgId, limit: 200 })).toHaveLength(before);
    });

    it("counts consecutive dead deliveries only: one success starts the count again", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/flaky`);
      receiver.reply(() => ({ status: 500 }));
      for (let i = 0; i < 19; i++) await oneDeadDelivery();
      expect((await getEndpoint(orgId, endpoint.id)).failureCount).toBe(19);

      receiver.reply(() => ({ status: 200 }));
      await emit();
      await run();
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: 0 });

      receiver.reply(() => ({ status: 500 }));
      for (let i = 0; i < 19; i++) await oneDeadDelivery();
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: 19 });
      await oneDeadDelivery();
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "disabled", failureCount: 20 });
    });

    it("does not count failed attempts that still have retries left", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/down`);
      receiver.reply(() => ({ status: 500 }));
      for (let i = 0; i < 25; i++) await emit({ i });
      await run();
      expect(receiver.requests).toHaveLength(25);
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ status: "active", failureCount: 0 });
    });
  });

  describe("endpoint state at delivery time", () => {
    it("closes a pending delivery unsent when the endpoint was disabled meanwhile", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/hook`);
      await emit();
      await disableEndpoint(orgId, endpoint.id);
      expect(await run()).toEqual({ ran: 1, succeeded: 1, failed: 0 });
      expect(receiver.requests).toHaveLength(0);
      expect(await onlyDelivery()).toMatchObject({ status: "dead", attempt: 0, nextAttemptAt: null, error: "Not delivered: the endpoint is disabled", responseStatus: null });
      expect(await getEndpoint(orgId, endpoint.id)).toMatchObject({ failureCount: 0, lastFailureAt: null });
    });

    it("drops the job quietly when the endpoint was deleted meanwhile", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/hook`);
      await emit();
      await deleteEndpoint(orgId, endpoint.id);
      expect(await run()).toEqual({ ran: 1, succeeded: 1, failed: 0 });
      expect(receiver.requests).toHaveLength(0);
      expect(await listDeliveries({ orgId })).toEqual([]);
    });

    it("signs with the new and the previous secret during a rotation overlap, then only with the new one", async () => {
      const created = await endpointAt(`${receiver.origin}/hook`);
      const rotated = await rotateSecret(orgId, created.endpoint.id);
      await emit({ n: 1 });
      await run();
      const during = receiver.requests[0];
      expect(String(during.headers["webhook-signature"]).split(" ")).toHaveLength(2);
      expect(verifyWebhookSignature({ secret: rotated.secret, headers: during.headers, body: during.body, now: T0 })).toBe(true);
      expect(verifyWebhookSignature({ secret: created.secret, headers: during.headers, body: during.body, now: T0 })).toBe(true);

      const later = addMs(T0, 24 * MS.hour);
      setTestNow(later);
      await emit({ n: 2 });
      await run();
      const after = receiver.requests[1];
      expect(String(after.headers["webhook-signature"]).split(" ")).toHaveLength(1);
      expect(verifyWebhookSignature({ secret: rotated.secret, headers: after.headers, body: after.body, now: later })).toBe(true);
      expect(verifyWebhookSignature({ secret: created.secret, headers: after.headers, body: after.body, now: later })).toBe(false);
    });

    it("stops honouring a leaked secret immediately after a rotation without overlap", async () => {
      const created = await endpointAt(`${receiver.origin}/hook`);
      const rotated = await rotateSecret(orgId, created.endpoint.id, { overlapMs: 0 });
      await emit();
      await run();
      const [request] = receiver.requests;
      expect(verifyWebhookSignature({ secret: rotated.secret, headers: request.headers, body: request.body, now: T0 })).toBe(true);
      expect(verifyWebhookSignature({ secret: created.secret, headers: request.headers, body: request.body, now: T0 })).toBe(false);
    });
  });

  describe("idempotency", () => {
    it("sends nothing when the same attempt runs twice or the delivery is finished or unknown", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      await emit();
      const delivery = await onlyDelivery();
      expect(await attemptDelivery(delivery.id, 1)).toMatchObject({ outcome: "succeeded", status: 200 });
      expect(await attemptDelivery(delivery.id, 1)).toEqual({ outcome: "skipped", reason: "already_finished" });
      expect(await attemptDelivery(delivery.id, 2)).toEqual({ outcome: "skipped", reason: "already_finished" });
      expect(await attemptDelivery("whd_unknown", 1)).toEqual({ outcome: "skipped", reason: "delivery_not_found" });
      expect(receiver.requests).toHaveLength(1);
      // The queued job for attempt 1 is now a no-op as well.
      expect(await run()).toEqual({ ran: 1, succeeded: 1, failed: 0 });
      expect(receiver.requests).toHaveLength(1);
    });

    it("ignores a stale job for an attempt that was already made", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      receiver.reply(() => ({ status: 500 }));
      await emit();
      const delivery = await onlyDelivery();
      expect((await attemptDelivery(delivery.id, 1)).outcome).toBe("retry_scheduled");
      expect(await attemptDelivery(delivery.id, 1)).toEqual({ outcome: "skipped", reason: "stale_attempt" });
      expect(await attemptDelivery(delivery.id, 3)).toEqual({ outcome: "skipped", reason: "stale_attempt" });
      expect(receiver.requests).toHaveLength(1);
      expect(await getDelivery(orgId, delivery.id)).toMatchObject({ attempt: 1, status: "failed" });
    });

    it("records each attempt once even when two workers run it at the same time", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/hook`);
      receiver.reply(() => ({ status: 500 }));
      await emit();
      const delivery = await onlyDelivery();
      const outcomes = await Promise.all([attemptDelivery(delivery.id, 1), attemptDelivery(delivery.id, 1)]);
      expect(outcomes.map((o) => o.outcome).sort()).toEqual(["retry_scheduled", "skipped"]);
      expect(await getDelivery(orgId, delivery.id)).toMatchObject({ attempt: 1, status: "failed" });
      // Exactly one follow-up job, not two.
      expect(await t.db.select().from(jobs).where(eq(jobs.dedupeKey, `webhook.deliver:${delivery.id}:2`))).toHaveLength(1);
      expect((await getEndpoint(orgId, endpoint.id)).failureCount).toBe(0);
    });

    it("lets a manual resend take over from a delivery that is still retrying", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      receiver.reply((_req, i) => ({ status: i === 0 ? 500 : 200 }));
      const event = await emit();
      await run();
      const original = await onlyDelivery();
      expect(original.status).toBe("failed");

      const resent = await resendDelivery(orgId, original.id);
      await run();
      expect(receiver.requests).toHaveLength(2);
      expect(receiver.requests[1].headers["webhook-id"]).toBe(event.id);
      expect(await getDelivery(orgId, resent.id)).toMatchObject({ status: "succeeded", attempt: 1 });

      // The original's retry job comes due and does nothing.
      setTestNow(addMs(T0, MS.day));
      await run();
      expect(receiver.requests).toHaveLength(2);
      expect(await getDelivery(orgId, original.id)).toMatchObject({ status: "dead", attempt: 1 });
    });
  });

  describe("SSRF guard at delivery time", () => {
    it("refuses to send when the host now resolves to an internal address (DNS rebinding)", async () => {
      // At registration the name points to a public (documentation) address...
      setWebhookResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
      const { endpoint } = await endpointAt("http://hooks.synthetic.example/webhook");
      await emit();
      const delivery = await onlyDelivery();

      // ...and at delivery time to the loopback receiver, a private address and the metadata service.
      const answers = [
        { address: "127.0.0.1", expected: /loopback/ },
        { address: "10.0.0.5", expected: /private network/ },
        { address: "169.254.169.254", expected: /metadata/ },
      ];
      for (const [i, { address, expected }] of answers.entries()) {
        const res = await attemptDelivery(delivery.id, i + 1, { resolve: async () => [{ address, family: 4 }] });
        expect(res).toMatchObject({ outcome: "retry_scheduled", status: null });
        const recorded = await getDelivery(orgId, delivery.id);
        expect(recorded).toMatchObject({ status: "failed", attempt: i + 1, responseStatus: null });
        expect(recorded.error).toMatch(expected);
      }
      expect(receiver.requests).toHaveLength(0);
      expect((await getEndpoint(orgId, endpoint.id)).lastFailureAt).toEqual(T0);
    });

    it("refuses a mix of public and internal answers and a host that stopped resolving", async () => {
      setWebhookResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
      await endpointAt("http://hooks.synthetic.example/webhook");
      await emit();
      const delivery = await onlyDelivery();
      const mixed = await attemptDelivery(delivery.id, 1, {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "192.168.7.7", family: 4 },
        ],
      });
      expect(mixed.outcome).toBe("retry_scheduled");
      expect((await getDelivery(orgId, delivery.id)).error).toMatch(/private network/);

      const unresolved = await attemptDelivery(delivery.id, 2, {
        resolve: async () => {
          throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" });
        },
      });
      expect(unresolved.outcome).toBe("retry_scheduled");
      expect((await getDelivery(orgId, delivery.id)).error).toBe("The webhook URL host could not be resolved");
    });

    it("refuses a stored URL that is internal, however it got there", async () => {
      const { endpoint } = await endpointAt(`${receiver.origin}/hook`);
      await emit();
      const delivery = await onlyDelivery();
      for (const [i, url] of ["http://169.254.169.254/latest/meta-data/", "http://[::ffff:10.0.0.1]/", "http://127.0.0.2/", "file:///etc/passwd"].entries()) {
        await t.db.update(webhookEndpoints).set({ url }).where(eq(webhookEndpoints.id, endpoint.id));
        expect((await attemptDelivery(delivery.id, i + 1)).outcome).toBe("retry_scheduled");
        expect((await getDelivery(orgId, delivery.id)).error).toMatch(/not allowed|must start with https/);
      }
      expect(receiver.requests).toHaveLength(0);
    });

    it("connects to the vetted address, not to whatever the name resolves to later", async () => {
      // "localhost" is the one name allowed to be loopback outside production; the resolver pins it to the receiver.
      const lookups: string[] = [];
      setWebhookResolverForTests(async (hostname) => {
        lookups.push(hostname);
        return [{ address: "127.0.0.1", family: 4 }];
      });
      const { secret } = await endpointAt(`http://localhost:${receiver.port}/pinned`);
      await emit();
      await run();
      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0].headers.host).toBe(`localhost:${receiver.port}`);
      expect(verifyWebhookSignature({ secret, headers: receiver.requests[0].headers, body: receiver.requests[0].body, now: T0 })).toBe(true);
      // Resolved once at registration and once for the delivery; the socket did not resolve again on its own.
      expect(lookups).toEqual(["localhost", "localhost"]);
      expect((await onlyDelivery()).status).toBe("succeeded");
    });

    it("sendSignedRequest uses only the addresses it is given", async () => {
      // The name does not exist in DNS at all; the request still reaches the receiver through the pinned address.
      const request = buildSignedRequest({
        url: `http://does-not-resolve.invalid:${receiver.port}/pinned`,
        id: "evt_SYNTHETIC0000000000001",
        timestamp: T0,
        body: "{}",
        secrets: "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      });
      expect(await sendSignedRequest(request, [{ address: "127.0.0.1", family: 4 }], 5000)).toEqual({ status: 200, excerpt: "ok", error: null, retryAfter: null });
      expect(receiver.requests[0].headers.host).toBe(`does-not-resolve.invalid:${receiver.port}`);
    });
  });

  describe("jobs", () => {
    it("registers the delivery handler and the recurring retry sweep", () => {
      expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
      expect(RESPONSE_EXCERPT_CHARS).toBe(500);
      expect(Object.keys(jobHandlers).sort()).toEqual(["webhook.deliver", "webhook.retry"]);
      expect(recurringJobs).toEqual([{ type: "webhook.retry", everyMs: 5 * MS.minute }]);
    });

    it("fails the job (for a queue retry) on a malformed payload", async () => {
      await expect(jobHandlers["webhook.deliver"]({}, { jobId: "job_x", attempt: 1 })).rejects.toThrow();
      await expect(jobHandlers["webhook.deliver"]({ deliveryId: "whd_x", attempt: 0 }, { jobId: "job_x", attempt: 1 })).rejects.toThrow();
      await expect(jobHandlers["webhook.deliver"]({ deliveryId: "whd_x", attempt: "1" }, { jobId: "job_x", attempt: 1 })).rejects.toThrow();
    });

    it("the sweep re-enqueues a due delivery whose job was lost, and only that", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      await emit({ n: "lost" });
      await t.db.delete(jobs);
      setTestNow(addMs(T0, MS.minute));
      await emit({ n: "has-job" });

      // Inside the grace period nothing is touched.
      expect(await sweepDueDeliveries()).toEqual({ checked: 0, enqueued: 0 });
      setTestNow(addMs(T0, 2 * MS.minute));
      expect(await sweepDueDeliveries()).toEqual({ checked: 1, enqueued: 1 });
      // A second sweep finds the job it just created and adds nothing.
      expect(await sweepDueDeliveries()).toEqual({ checked: 1, enqueued: 0 });
      setTestNow(addMs(T0, 3 * MS.minute));
      expect(await sweepDueDeliveries()).toEqual({ checked: 2, enqueued: 0 });
      expect(await listJobs({ type: "webhook.deliver" })).toHaveLength(2);

      await run();
      expect(receiver.requests).toHaveLength(2);
      expect((await listDeliveries({ orgId })).map((d) => d.status)).toEqual(["succeeded", "succeeded"]);
      expect(await sweepDueDeliveries()).toEqual({ checked: 0, enqueued: 0 });
    });

    it("the sweep picks up a failed delivery at the right attempt number", async () => {
      await endpointAt(`${receiver.origin}/hook`);
      receiver.reply((_req, i) => ({ status: i === 0 ? 500 : 200 }));
      await emit();
      await run();
      await t.db.delete(jobs);
      setTestNow(addMs(T0, MS.minute + 2 * MS.minute));
      await jobHandlers["webhook.retry"]({}, { jobId: "job_sweep", attempt: 1 });
      const [job] = await listJobs({ type: "webhook.deliver" });
      expect(job.payload).toMatchObject({ attempt: 2 });
      await run();
      expect(await onlyDelivery()).toMatchObject({ status: "succeeded", attempt: 2 });
    });
  });
});
