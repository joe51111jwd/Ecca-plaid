import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { addMs, MS, setTestNow } from "@/lib/clock";
import { decryptField, encryptField } from "@/lib/crypto";
import { emitEvent } from "@/server/events";
import { useTestDb } from "../../../tests/helpers/db";
import {
  createEndpoint,
  deleteEndpoint,
  disableEndpoint,
  enableEndpoint,
  getDelivery,
  getEndpoint,
  listDeliveries,
  listEndpoints,
  MAX_ENDPOINTS_PER_ORG,
  resendDelivery,
  rotateSecret,
  SECRET_ROTATION_OVERLAP_MS,
  setWebhookResolverForTests,
  updateEndpoint,
} from "./index";
import { openEndpointSecrets, signingSecrets } from "./secrets";
import { createTestOrg } from "./test-support";

const T0 = new Date("2026-11-18T12:00:00.000Z");
const { webhookEndpoints, webhookDeliveries, jobs, events } = schema;
const URL_A = "http://127.0.0.1:9/hooks/a";

describe("webhook endpoints", () => {
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
    setWebhookResolverForTests(null);
  });

  const row = async (id: string) => (await t.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)))[0];

  describe("createEndpoint", () => {
    it("creates an active endpoint with defaults and returns the secret once", async () => {
      const { endpoint, secret } = await createEndpoint({ orgId: orgA, url: URL_A });
      expect(endpoint.id).toMatch(/^whe_/);
      expect(endpoint).toEqual({
        id: endpoint.id,
        orgId: orgA,
        url: URL_A,
        description: null,
        eventTypes: ["*"],
        format: "native",
        status: "active",
        failureCount: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        createdAt: T0,
      });
      // "whsec_" + base64 of 32 random bytes.
      expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
      expect(Buffer.from(secret.slice(6), "base64")).toHaveLength(32);
      const other = await createEndpoint({ orgId: orgA, url: URL_A });
      expect(other.secret).not.toBe(secret);
    });

    it("stores the secret only encrypted, under the webhook-secret purpose", async () => {
      const { endpoint, secret } = await createEndpoint({ orgId: orgA, url: URL_A });
      const stored = await row(endpoint.id);
      expect(stored.secretEnc).toMatch(/^v1\./);
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(JSON.stringify(stored)).not.toContain(secret.slice(6));
      expect(decryptField(stored.secretEnc, "webhook-secret")).toBe(secret);
      expect(() => decryptField(stored.secretEnc, "field")).toThrow();
    });

    it("never exposes the secret through reads", async () => {
      const { endpoint, secret } = await createEndpoint({ orgId: orgA, url: URL_A });
      for (const view of [await getEndpoint(orgA, endpoint.id), ...(await listEndpoints(orgA)), await updateEndpoint(orgA, endpoint.id, { description: "x" }), await disableEndpoint(orgA, endpoint.id)]) {
        expect(Object.keys(view).sort()).toEqual(["createdAt", "description", "eventTypes", "failureCount", "format", "id", "lastFailureAt", "lastSuccessAt", "orgId", "status", "url"]);
        expect(JSON.stringify(view)).not.toContain(secret);
        expect(JSON.stringify(view)).not.toContain("secret");
      }
    });

    it("accepts a description, event types and a format, and normalizes them", async () => {
      const { endpoint } = await createEndpoint({
        orgId: orgA,
        url: "HTTP://LOCALHOST:9/Hooks#frag",
        description: "  Synthetic CRM sync  ",
        eventTypes: ["verification.decided", "handoff.held", "verification.decided"],
        format: "generic_csv_row",
      });
      expect(endpoint).toMatchObject({
        url: "http://localhost:9/Hooks",
        description: "Synthetic CRM sync",
        eventTypes: ["verification.decided", "handoff.held"],
        format: "generic_csv_row",
      });
      expect((await createEndpoint({ orgId: orgA, url: URL_A, eventTypes: ["donation.succeeded", "*"] })).endpoint.eventTypes).toEqual(["*"]);
      expect((await createEndpoint({ orgId: orgA, url: URL_A, description: "   " })).endpoint.description).toBeNull();
      expect((await createEndpoint({ orgId: orgA, url: URL_A, description: null })).endpoint.description).toBeNull();
    });

    it("rejects invalid input with field messages", async () => {
      const bad = async (input: Record<string, unknown>, field: string) => {
        await expect(createEndpoint({ orgId: orgA, url: URL_A, ...input } as never)).rejects.toMatchObject({
          code: "validation_failed",
          details: { fields: { [field]: expect.any(String) } },
        });
      };
      await bad({ eventTypes: [] }, "eventTypes");
      await bad({ eventTypes: ["verification.exploded"] }, "eventTypes");
      await bad({ eventTypes: ["verification.*"] }, "eventTypes");
      await bad({ eventTypes: "verification.decided" }, "eventTypes");
      await bad({ format: "xml" }, "format");
      await bad({ description: "x".repeat(501) }, "description");
      await bad({ url: 42 }, "url");
      await bad({ orgId: "" }, "orgId");
      expect(await t.db.select().from(webhookEndpoints)).toHaveLength(0);
    });

    it("applies the SSRF guard to the URL", async () => {
      setWebhookResolverForTests(async (hostname) => {
        if (hostname === "receiver.example") return [{ address: "93.184.216.34", family: 4 }];
        if (hostname === "intranet.example") return [{ address: "10.1.2.3", family: 4 }];
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      });
      for (const url of ["http://10.0.0.8/hook", "http://169.254.169.254/latest/meta-data", "http://192.168.1.1/", "http://[fd00::1]/", "http://127.0.0.2/", "ftp://receiver.example/", "https://intranet.example/hook", "https://nxdomain.example/hook", "nonsense", "https://user:pw@receiver.example/"]) {
        await expect(createEndpoint({ orgId: orgA, url }), url).rejects.toMatchObject({ code: "validation_failed", details: { fields: { url: expect.any(String) } } });
      }
      expect(await t.db.select().from(webhookEndpoints)).toHaveLength(0);
      expect((await createEndpoint({ orgId: orgA, url: "https://receiver.example/hook" })).endpoint.url).toBe("https://receiver.example/hook");
    });

    it(`allows at most ${MAX_ENDPOINTS_PER_ORG} endpoints per organization`, async () => {
      for (let i = 0; i < MAX_ENDPOINTS_PER_ORG; i++) await createEndpoint({ orgId: orgA, url: `${URL_A}/${i}` });
      await expect(createEndpoint({ orgId: orgA, url: URL_A })).rejects.toMatchObject({ code: "conflict" });
      // The limit is per organization.
      await expect(createEndpoint({ orgId: orgB, url: URL_A })).resolves.toBeTruthy();
      const [first] = await listEndpoints(orgA);
      await deleteEndpoint(orgA, first.id);
      await expect(createEndpoint({ orgId: orgA, url: URL_A })).resolves.toBeTruthy();
    });

    it("enforces the endpoint cap under concurrent creation", async () => {
      const results = await Promise.allSettled(Array.from({ length: MAX_ENDPOINTS_PER_ORG + 5 }, (_, i) => createEndpoint({ orgId: orgA, url: `${URL_A}/${i}` })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_ENDPOINTS_PER_ORG);
      expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason)).toEqual(Array(5).fill(expect.objectContaining({ code: "conflict" })));
      expect(await listEndpoints(orgA)).toHaveLength(MAX_ENDPOINTS_PER_ORG);
    });
  });

  describe("tenant scoping", () => {
    it("lists only the organization's endpoints, oldest first", async () => {
      const a1 = await createEndpoint({ orgId: orgA, url: `${URL_A}/1` });
      setTestNow(addMs(T0, 1000));
      const a2 = await createEndpoint({ orgId: orgA, url: `${URL_A}/2` });
      const b1 = await createEndpoint({ orgId: orgB, url: `${URL_A}/b` });
      expect((await listEndpoints(orgA)).map((e) => e.id)).toEqual([a1.endpoint.id, a2.endpoint.id]);
      expect((await listEndpoints(orgB)).map((e) => e.id)).toEqual([b1.endpoint.id]);
      expect(await listEndpoints("org_unknown")).toEqual([]);
    });

    it("treats another organization's endpoint as not found for every operation and changes nothing", async () => {
      const { endpoint } = await createEndpoint({ orgId: orgA, url: URL_A });
      const before = await row(endpoint.id);
      const attempts = [
        () => getEndpoint(orgB, endpoint.id),
        () => updateEndpoint(orgB, endpoint.id, { url: "http://127.0.0.1:9/stolen" }),
        () => rotateSecret(orgB, endpoint.id),
        () => disableEndpoint(orgB, endpoint.id),
        () => enableEndpoint(orgB, endpoint.id),
        () => deleteEndpoint(orgB, endpoint.id),
        () => getEndpoint(orgA, "whe_unknown"),
        () => deleteEndpoint(orgA, "whe_unknown"),
      ];
      for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: "not_found", status: 404 });
      expect(await row(endpoint.id)).toEqual(before);
    });
  });

  describe("updateEndpoint", () => {
    it("changes only the given fields", async () => {
      const { endpoint } = await createEndpoint({ orgId: orgA, url: URL_A, description: "before" });
      const updated = await updateEndpoint(orgA, endpoint.id, { url: "http://127.0.0.1:9/new", eventTypes: ["handoff.awarded"], format: "generic_csv_row" });
      expect(updated).toEqual({ ...endpoint, url: "http://127.0.0.1:9/new", eventTypes: ["handoff.awarded"], format: "generic_csv_row" });
      expect((await updateEndpoint(orgA, endpoint.id, { description: "after" })).description).toBe("after");
      expect((await updateEndpoint(orgA, endpoint.id, { description: null })).description).toBeNull();
      expect((await updateEndpoint(orgA, endpoint.id, { description: "again" })).description).toBe("again");
      expect((await updateEndpoint(orgA, endpoint.id, { description: "" })).description).toBeNull();
      // An empty patch is a read.
      expect(await updateEndpoint(orgA, endpoint.id, {})).toEqual(await getEndpoint(orgA, endpoint.id));
    });

    it("keeps the secret and re-checks a new URL", async () => {
      const { endpoint, secret } = await createEndpoint({ orgId: orgA, url: URL_A });
      await expect(updateEndpoint(orgA, endpoint.id, { url: "http://169.254.169.254/" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(updateEndpoint(orgA, endpoint.id, { url: "http://10.0.0.1/" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(updateEndpoint(orgA, endpoint.id, { eventTypes: ["nope"] })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(updateEndpoint(orgA, endpoint.id, { eventTypes: [] })).rejects.toMatchObject({ code: "validation_failed" });
      expect((await getEndpoint(orgA, endpoint.id)).url).toBe(URL_A);
      await updateEndpoint(orgA, endpoint.id, { url: "http://127.0.0.1:9/moved" });
      expect(decryptField((await row(endpoint.id)).secretEnc, "webhook-secret")).toBe(secret);
    });

    it("refuses fields that are not editable", async () => {
      const { endpoint } = await createEndpoint({ orgId: orgA, url: URL_A });
      for (const patch of [{ status: "disabled" }, { secretEnc: "x" }, { orgId: orgB }, { failureCount: 0 }]) {
        await expect(updateEndpoint(orgA, endpoint.id, patch as never)).rejects.toMatchObject({ code: "validation_failed" });
      }
      expect(await getEndpoint(orgA, endpoint.id)).toEqual(endpoint);
    });
  });

  describe("rotateSecret", () => {
    it("issues a new secret and keeps the old one valid for the overlap only", async () => {
      const created = await createEndpoint({ orgId: orgA, url: URL_A });
      setTestNow(addMs(T0, MS.hour));
      const rotated = await rotateSecret(orgA, created.endpoint.id);
      expect(rotated.secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
      expect(rotated.secret).not.toBe(created.secret);
      expect(rotated.endpoint).toEqual(created.endpoint);

      const stored = (await row(created.endpoint.id)).secretEnc;
      expect(stored).not.toContain(rotated.secret);
      const secrets = openEndpointSecrets(stored);
      expect(secrets.current).toBe(rotated.secret);
      expect(secrets.previous).toEqual({ secret: created.secret, expiresAt: addMs(T0, MS.hour + SECRET_ROTATION_OVERLAP_MS) });
      expect(SECRET_ROTATION_OVERLAP_MS).toBe(24 * MS.hour);
      expect(signingSecrets(secrets, addMs(T0, 2 * MS.hour))).toEqual([rotated.secret, created.secret]);
      expect(signingSecrets(secrets, addMs(T0, 25 * MS.hour - 1))).toEqual([rotated.secret, created.secret]);
      expect(signingSecrets(secrets, addMs(T0, 25 * MS.hour))).toEqual([rotated.secret]);
    });

    it("drops the old secret immediately with overlapMs 0 and forgets older secrets on a second rotation", async () => {
      const created = await createEndpoint({ orgId: orgA, url: URL_A });
      const first = await rotateSecret(orgA, created.endpoint.id, { overlapMs: 0 });
      expect(openEndpointSecrets((await row(created.endpoint.id)).secretEnc)).toEqual({ current: first.secret });

      const second = await rotateSecret(orgA, created.endpoint.id);
      const third = await rotateSecret(orgA, created.endpoint.id);
      const secrets = openEndpointSecrets((await row(created.endpoint.id)).secretEnc);
      expect(secrets.current).toBe(third.secret);
      expect(secrets.previous?.secret).toBe(second.secret);
      expect(JSON.stringify(secrets)).not.toContain(first.secret);
      await expect(rotateSecret(orgA, created.endpoint.id, { overlapMs: -1 })).rejects.toMatchObject({ code: "validation_failed" });
    });

    it("reads a bare encrypted secret written without this module (e.g. by a seed script)", async () => {
      const { endpoint } = await createEndpoint({ orgId: orgA, url: URL_A });
      const seeded = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
      await t.db.update(webhookEndpoints).set({ secretEnc: encryptField(seeded, "webhook-secret") }).where(eq(webhookEndpoints.id, endpoint.id));
      expect(openEndpointSecrets((await row(endpoint.id)).secretEnc)).toEqual({ current: seeded });
      const rotated = await rotateSecret(orgA, endpoint.id);
      expect(openEndpointSecrets((await row(endpoint.id)).secretEnc).previous?.secret).toBe(seeded);
      expect(rotated.secret).not.toBe(seeded);
    });
  });

  describe("disable, enable, delete", () => {
    it("disables and re-enables, resetting the failure streak", async () => {
      const { endpoint } = await createEndpoint({ orgId: orgA, url: URL_A });
      await t.db.update(webhookEndpoints).set({ failureCount: 20, status: "disabled" }).where(eq(webhookEndpoints.id, endpoint.id));
      expect(await enableEndpoint(orgA, endpoint.id)).toMatchObject({ status: "active", failureCount: 0 });
      expect(await disableEndpoint(orgA, endpoint.id)).toMatchObject({ status: "disabled" });
      expect(await disableEndpoint(orgA, endpoint.id)).toMatchObject({ status: "disabled" });
      expect(await enableEndpoint(orgA, endpoint.id)).toMatchObject({ status: "active" });
    });

    it("deletes the endpoint with its deliveries and keeps the events", async () => {
      const keep = await createEndpoint({ orgId: orgA, url: `${URL_A}/keep` });
      const gone = await createEndpoint({ orgId: orgA, url: `${URL_A}/gone` });
      const event = await emitEvent({ orgId: orgA, type: "verification.decided", payload: {}, mode: "test" });
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(2);

      await deleteEndpoint(orgA, gone.endpoint.id);
      expect((await listEndpoints(orgA)).map((e) => e.id)).toEqual([keep.endpoint.id]);
      const left = await t.db.select().from(webhookDeliveries);
      expect(left.map((d) => d.endpointId)).toEqual([keep.endpoint.id]);
      expect(await t.db.select().from(events)).toHaveLength(1);
      await expect(getEndpoint(orgA, gone.endpoint.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(deleteEndpoint(orgA, gone.endpoint.id)).rejects.toMatchObject({ code: "not_found" });
      expect(await listDeliveries({ orgId: orgA, eventId: event.id })).toHaveLength(1);
    });
  });

  describe("deliveries", () => {
    async function seed() {
      const a1 = (await createEndpoint({ orgId: orgA, url: `${URL_A}/1` })).endpoint;
      const a2 = (await createEndpoint({ orgId: orgA, url: `${URL_A}/2`, eventTypes: ["verification.decided"] })).endpoint;
      const b1 = (await createEndpoint({ orgId: orgB, url: `${URL_A}/b` })).endpoint;
      const e1 = await emitEvent({ orgId: orgA, type: "verification.decided", payload: { n: 1 }, mode: "test" });
      setTestNow(addMs(T0, 1000));
      const e2 = await emitEvent({ orgId: orgA, type: "donation.succeeded", payload: { n: 2 }, mode: "test" });
      setTestNow(addMs(T0, 2000));
      const eb = await emitEvent({ orgId: orgB, type: "verification.decided", payload: { n: 3 }, mode: "test" });
      return { a1, a2, b1, e1, e2, eb };
    }

    it("lists an organization's deliveries newest first, filtered by endpoint, event and status", async () => {
      const { a1, a2, e1, e2, eb } = await seed();
      const all = await listDeliveries({ orgId: orgA });
      expect(all).toHaveLength(3);
      expect(all[0].eventId).toBe(e2.id);
      expect(all.every((d) => d.orgId === orgA)).toBe(true);
      expect((await listDeliveries({ orgId: orgA, endpointId: a2.id })).map((d) => d.eventId)).toEqual([e1.id]);
      expect((await listDeliveries({ orgId: orgA, endpointId: a1.id })).map((d) => d.eventId)).toEqual([e2.id, e1.id]);
      expect(await listDeliveries({ orgId: orgA, eventId: e1.id })).toHaveLength(2);
      expect(await listDeliveries({ orgId: orgA, eventId: e1.id, endpointId: a2.id })).toHaveLength(1);
      expect(await listDeliveries({ orgId: orgA, limit: 2 })).toHaveLength(2);
      expect(await listDeliveries({ orgId: orgA, status: "pending" })).toHaveLength(3);
      expect(await listDeliveries({ orgId: orgA, status: "succeeded" })).toEqual([]);

      // Another tenant's ids used as filters match nothing.
      expect(await listDeliveries({ orgId: orgA, eventId: eb.id })).toEqual([]);
      expect(await listDeliveries({ orgId: orgB, endpointId: a1.id })).toEqual([]);
      expect(await listDeliveries({ orgId: orgB })).toHaveLength(1);
      await expect(listDeliveries({ orgId: orgA, limit: 0 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(listDeliveries({ orgId: "" })).rejects.toMatchObject({ code: "validation_failed" });
    });

    it("getDelivery is scoped to the organization", async () => {
      await seed();
      const [delivery] = await listDeliveries({ orgId: orgA, limit: 1 });
      expect(await getDelivery(orgA, delivery.id)).toEqual(delivery);
      await expect(getDelivery(orgB, delivery.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(getDelivery(orgA, "whd_unknown")).rejects.toMatchObject({ code: "not_found" });
    });

    it("resendDelivery creates a fresh delivery with its own job and leaves a finished original untouched", async () => {
      const { a2, e1 } = await seed();
      const [original] = await listDeliveries({ orgId: orgA, endpointId: a2.id });
      await t.db.update(webhookDeliveries).set({ status: "succeeded", attempt: 1, responseStatus: 200, deliveredAt: T0, nextAttemptAt: null }).where(eq(webhookDeliveries.id, original.id));
      const finished = await getDelivery(orgA, original.id);

      setTestNow(addMs(T0, MS.hour));
      const resent = await resendDelivery(orgA, original.id);
      expect(resent.id).not.toBe(original.id);
      expect(resent).toMatchObject({ endpointId: a2.id, eventId: e1.id, orgId: orgA, eventType: "verification.decided", attempt: 0, status: "pending", responseStatus: null, error: null });
      expect(resent.nextAttemptAt).toEqual(addMs(T0, MS.hour));
      expect(await getDelivery(orgA, original.id)).toEqual(finished);

      const [job] = await t.db.select().from(jobs).where(eq(jobs.dedupeKey, `webhook.deliver:${resent.id}:1`));
      expect(job).toMatchObject({ type: "webhook.deliver", status: "queued", payload: { deliveryId: resent.id, attempt: 1 } });
      expect(job.runAt).toEqual(addMs(T0, MS.hour));
    });

    it("resendDelivery closes an original that was still being retried", async () => {
      const { a2 } = await seed();
      const [original] = await listDeliveries({ orgId: orgA, endpointId: a2.id });
      await t.db
        .update(webhookDeliveries)
        .set({ status: "failed", attempt: 3, responseStatus: 500, nextAttemptAt: addMs(T0, 12 * MS.hour) })
        .where(eq(webhookDeliveries.id, original.id));
      const resent = await resendDelivery(orgA, original.id);
      expect(await getDelivery(orgA, original.id)).toMatchObject({ status: "dead", attempt: 3, nextAttemptAt: null, error: `Replaced by a manual resend (${resent.id})` });
      expect(await listDeliveries({ orgId: orgA, endpointId: a2.id, status: "pending" })).toHaveLength(1);
    });

    it("resendDelivery refuses a disabled endpoint, other tenants and unknown ids, creating nothing", async () => {
      const { a1 } = await seed();
      const [original] = await listDeliveries({ orgId: orgA, endpointId: a1.id });
      const countBefore = (await t.db.select().from(webhookDeliveries)).length;
      await expect(resendDelivery(orgB, original.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(resendDelivery(orgA, "whd_unknown")).rejects.toMatchObject({ code: "not_found" });
      await disableEndpoint(orgA, a1.id);
      await expect(resendDelivery(orgA, original.id)).rejects.toMatchObject({ code: "conflict" });
      expect(await t.db.select().from(webhookDeliveries)).toHaveLength(countBefore);
      expect((await getDelivery(orgA, original.id)).status).toBe("pending");
    });
  });
});
