import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { parseCsv } from "@/lib/csv";
import { offerAward } from "@/server/awards";
import { listAuditLogs } from "@/server/audit";
import { placeOrder, saveCheckout, startCheckout } from "@/server/donations";
import { createListedSgo, drainJobs as drainDonationJobs, paySandbox, singleFilerPatch } from "@/server/donations/test-support";
import { emitEvent } from "@/server/events";
import { jobHandlers as handoffJobs } from "@/server/handoffs/jobs";
import { addMember, makeBusiness, makeSgo, makeUser, partner, setVerificationState, SYNTHETIC_ORIGIN } from "@/server/handoffs/test-support";
import { setWebhookResolverForTests } from "@/server/webhooks";
import { useTestDb } from "../../../tests/helpers/db";
import {
  donationListSchema,
  donationSchema,
  eventListSchema,
  eventSchema,
  handoffCreatedSchema,
  handoffListSchema,
  handoffSchema,
  meSchema,
  verificationCreatedSchema,
  verificationListSchema,
  verificationSchema,
  webhookDeliveryListSchema,
  webhookEndpointListSchema,
  webhookEndpointSchema,
  webhookEndpointWithSecretSchema,
} from "./schemas";
import { allowWebhookHosts, attachSyntheticEvidence, callApi, callJson, makeKey } from "./test-support";

const T0 = "2026-11-18T16:00:00.000Z";

type Json = Record<string, unknown> & { id: string };
type List = { object: "list"; data: Json[]; has_more: boolean; next_cursor: string | null };

function expectShape(schemaToUse: { safeParse(v: unknown): { success: boolean; error?: unknown } }, value: unknown): void {
  const r = schemaToUse.safeParse(value);
  if (!r.success) throw new Error(`Response does not match its documented schema: ${JSON.stringify(r.error)}\n${JSON.stringify(value)}`);
}

describe("verification routes", () => {
  useTestDb();
  let sgo: string;
  let key: string;
  beforeEach(async () => {
    setTestNow(T0);
    sgo = await makeSgo("Synthetic Verification Fund");
    key = await makeKey(sgo, "test");
  });
  afterEach(() => setTestNow(null));

  it("creates a verification with the family and embed links shown once, never in reads", async () => {
    const created = await callJson<Json & { family_url: string; embed_url: string }>("POST", "/verifications", {
      key,
      body: { external_ref: "APP-1", applicant_name: "Pat Synthetic", applicant_email: "pat@synthetic.example", student: { first_name: "Riley", last_name: "Synthetic" }, metadata: { campus: "north" }, locale: "es" },
    });
    expect(created.status).toBe(201);
    expectShape(verificationCreatedSchema, created.body);
    expect(created.body).toMatchObject({ object: "verification", mode: "test", status: "pending", stage: "created", external_ref: "APP-1", metadata: { campus: "north" }, provisional: true });
    const token = created.body.family_url.split("/v/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.embed_url).toBe(`http://localhost:3000/embed/verify/${token}`);

    const read = await callJson<Json>("GET", `/verifications/${created.body.id}`, { key });
    expect(read.status).toBe(200);
    expectShape(verificationSchema, read.body);
    const text = JSON.stringify(read.body);
    for (const secret of [token, "Pat Synthetic", "pat@synthetic.example", "Riley"]) expect(text).not.toContain(secret);
    expect((await listAuditLogs({ orgId: sgo, action: "verification.read" })).items).toHaveLength(1);
  });

  it("sends the invitation only when asked, and requires an email for it", async () => {
    const res = await callJson("POST", "/verifications", { key, body: { send_invite: true, applicant_email: "family@synthetic.example" } });
    expect(res.status).toBe(201);
    const db = await getDb();
    expect(await db.select().from(schema.emails).where(eq(schema.emails.toEmail, "family@synthetic.example"))).toHaveLength(1);
  });

  it("paginates newest first with stable cursors, also while new rows arrive, and filters", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      setTestNow(new Date(new Date(T0).getTime() + i * 1000));
      ids.push((await callJson<Json>("POST", "/verifications", { key, body: { external_ref: i % 2 === 0 ? "EVEN" : `ODD-${i}` } })).body.id);
    }
    // Two rows with the same timestamp still page deterministically.
    const same = (await callJson<Json>("POST", "/verifications", { key, body: { external_ref: "SAME" } })).body.id;
    // Same timestamp as the previous row: the tie is broken by id, descending.
    const tied = [ids.pop()!, same];
    const rest = [...ids].reverse();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: { status: number; body: List } = await callJson<List>("GET", `/verifications?limit=3${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`, { key });
      expect(res.status).toBe(200);
      expectShape(verificationListSchema, res.body);
      seen.push(...res.body.data.map((v) => v.id));
      expect(res.body.has_more).toBe(res.body.next_cursor !== null);
      cursor = res.body.next_cursor;
      if (pages === 0) {
        // A verification created between pages does not shift the pages that follow.
        setTestNow("2026-11-18T17:00:00.000Z");
        await callJson("POST", "/verifications", { key, body: { external_ref: "LATE" } });
      }
      pages++;
    } while (cursor);
    // No gaps, no duplicates; the tied pair comes first (in the database's id order), then strictly newest first.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice(0, 2).sort()).toEqual([...tied].sort());
    expect(seen.slice(2)).toEqual(rest);
    expect(pages).toBe(3);
    // Paging again gives exactly the same sequence (the late row now leads).
    const again: string[] = [];
    let c2: string | null = null;
    do {
      const res: { body: List } = await callJson<List>("GET", `/verifications?limit=3${c2 ? `&starting_after=${encodeURIComponent(c2)}` : ""}`, { key });
      again.push(...res.body.data.map((v) => v.id));
      c2 = res.body.next_cursor;
    } while (c2);
    expect(again.slice(1)).toEqual(seen);

    const even = await callJson<List>("GET", "/verifications?external_ref=EVEN", { key });
    expect(even.body.data).toHaveLength(4);
    const pending = await callJson<List>("GET", "/verifications?status=pending&limit=100", { key });
    expect(pending.body.data).toHaveLength(9);
    expect((await callJson("GET", "/verifications?starting_after=garbage", { key })).status).toBe(422);
  });

  it("cancels an undecided verification and refuses to cancel twice or a decided one", async () => {
    const v = (await callJson<Json>("POST", "/verifications", { key, body: {} })).body;
    const canceled = await callJson<Json>("POST", `/verifications/${v.id}/cancel`, { key });
    expect(canceled.status).toBe(200);
    expectShape(verificationSchema, canceled.body);
    expect(canceled.body.status).toBe("canceled");
    expect((await callJson("POST", `/verifications/${v.id}/cancel`, { key })).status).toBe(409);

    const decided = (await callJson<Json>("POST", "/verifications", { key, body: {} })).body;
    await attachSyntheticEvidence(sgo, decided.id);
    const refused = await callJson<{ error: { details: { reason: string } } }>("POST", `/verifications/${decided.id}/cancel`, { key });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe("verification_decided");
    expect((await listAuditLogs({ orgId: sgo, action: "api.verification.cancel" })).items).toHaveLength(1);
  });

  it("answers evidence downloads with 409 evidence_not_ready before a decision and the audited file after", async () => {
    const v = (await callJson<Json>("POST", "/verifications", { key, body: {} })).body;
    for (const kind of ["pdf", "json"]) {
      const early = await callJson<{ error: { code: string; details: { reason: string; status: string } } }>("GET", `/verifications/${v.id}/evidence.${kind}`, { key });
      expect(early.status).toBe(409);
      expect(early.body.error).toMatchObject({ code: "conflict", details: { reason: "evidence_not_ready", status: "pending" } });
    }
    expect((await listAuditLogs({ orgId: sgo, action: "evidence.download" })).items).toHaveLength(0);

    const { pdfId, jsonId } = await attachSyntheticEvidence(sgo, v.id);
    const pdf = await callApi("GET", `/verifications/${v.id}/evidence.pdf`, { key });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe(`attachment; filename="evidence-${v.id}.pdf"`);
    expect(pdf.headers.get("cache-control")).toBe("no-store");
    expect(pdf.headers.get("x-evidence-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(await pdf.arrayBuffer()).toString("utf8")).toContain("%PDF-1.7");

    const json = await callApi("GET", `/verifications/${v.id}/evidence.json`, { key });
    expect(json.status).toBe(200);
    const signed = (await json.json()) as { record: unknown; signature: { kid: string } };
    expect(signed.record).toBeTruthy();
    expect(signed.signature.kid).toBeTruthy();

    const audits = (await listAuditLogs({ orgId: sgo, action: "evidence.download" })).items;
    expect(audits.map((a) => (a.metadata as { objectId: string }).objectId).sort()).toEqual([jsonId, pdfId].sort());
    expect(audits.every((a) => a.actorType === "api_key" && a.targetId === v.id)).toBe(true);

    const read = (await callJson<Json>("GET", `/verifications/${v.id}`, { key })).body;
    expect(read.evidence_pack_url).toBe(`http://localhost:3000/api/v1/verifications/${v.id}/evidence.pdf`);
    expect(read.evidence_json_url).toBe(`http://localhost:3000/api/v1/verifications/${v.id}/evidence.json`);
  });

  describe("CSV export", () => {
    it("exports every standard column by default, newest first, with a header row", async () => {
      await callJson("POST", "/verifications", { key, body: { external_ref: "A-1" } });
      setTestNow("2026-11-18T16:00:01.000Z");
      await callJson("POST", "/verifications", { key, body: { external_ref: "A-2" } });
      const res = await callApi("GET", "/verifications/export.csv", { key });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="verifications-test-2026-11-18.csv"');
      const rows = parseCsv(await res.text());
      expect(rows[0][0]).toBe("id");
      expect(rows[0]).toContain("threshold_source");
      expect(rows.slice(1).map((r) => r[1])).toEqual(["A-2", "A-1"]);
      const audit = (await listAuditLogs({ orgId: sgo, action: "verification.export" })).items;
      expect(audit).toHaveLength(1);
      expect(audit[0].metadata).toMatchObject({ rows: 2, mode: "test" });
    });

    it("picks, orders and renames columns, including metadata, and can drop the header", async () => {
      const v = (await callJson<Json>("POST", "/verifications", { key, body: { external_ref: "MAP-1", metadata: { campus: "north", "grade.level": "5" } } })).body;
      await attachSyntheticEvidence(sgo, v.id);
      const res = await callApi("GET", `/verifications/export.csv?columns=${encodeURIComponent("external_ref:ApplicantID,status:Result,metadata.campus:Campus,metadata.grade.level,metadata.missing:Missing,provisional,id")}`, { key });
      const rows = parseCsv(await res.text());
      expect(rows[0]).toEqual(["ApplicantID", "Result", "Campus", "metadata.grade.level", "Missing", "provisional", "id"]);
      expect(rows[1]).toEqual(["MAP-1", "eligible", "north", "5", "", "true", v.id]);
      const noHeader = parseCsv(await (await callApi("GET", "/verifications/export.csv?columns=external_ref&header=false", { key })).text());
      expect(noHeader).toEqual([["MAP-1"]]);
      expect((await callApi("GET", "/verifications/export.csv?status=pending&columns=id", { key })).status).toBe(200);
    });

    it("refuses unknown columns and bad labels with 422", async () => {
      for (const columns of ["nope", "status,,id", "status:", "status:" + "x".repeat(101), "metadata.", "metadata.bad key", `status:a\u0001b`, Array.from({ length: 101 }, () => "id").join(",")]) {
        const res = await callJson<{ error: { details: { fields: Record<string, string> } } }>("GET", `/verifications/export.csv?columns=${encodeURIComponent(columns)}`, { key });
        expect(res.status, columns).toBe(422);
        expect(Object.keys(res.body.error.details.fields)).toEqual(["columns"]);
      }
    });

    it("neutralizes spreadsheet formula injection in every cell, including custom labels", async () => {
      const created = await callJson("POST", "/verifications", { key, body: { external_ref: '=HYPERLINK("http://evil.example","x")', metadata: { note: "+SUM(A1:A9)", at: "@cmd", dash: "-2+3" } } });
      expect(created.status).toBe(201);
      const res = await callApi("GET", `/verifications/export.csv?columns=${encodeURIComponent("external_ref:=Ref,metadata.note,metadata.at,metadata.dash")}`, { key });
      const text = await res.text();
      const rows = parseCsv(text);
      expect(rows[0][0]).toBe("'=Ref");
      for (const cell of rows[1]) expect(cell, cell).toMatch(/^'/);
    });
  });
});

describe("donation routes", () => {
  useTestDb();
  beforeEach(() => setTestNow(T0));
  afterEach(() => setTestNow(null));

  it("lists and reads the SGO's donations in the key's mode, audited", async () => {
    const sgo = await createListedSgo({ portalRegistered: true });
    const { token } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
    await saveCheckout(token, singleFilerPatch());
    await saveCheckout(token, { designationConfirmed: true });
    const placed = await placeOrder(token);
    await paySandbox(placed.payment);
    await drainDonationJobs();

    const key = await makeKey(sgo.orgId, "test");
    const list = await callJson<List>("GET", "/donations", { key });
    expect(list.status).toBe(200);
    expectShape(donationListSchema, list.body);
    expect(list.body.data).toHaveLength(1);
    const donation = list.body.data[0];
    expect(donation).toMatchObject({ object: "donation", mode: "test", designated_25f: true });

    const one = await callJson<Json>("GET", `/donations/${donation.id}`, { key });
    expect(one.status).toBe(200);
    expectShape(donationSchema, one.body);
    expect(JSON.stringify(one.body)).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    expect((await listAuditLogs({ orgId: sgo.orgId, action: "donation.read" })).items).toHaveLength(1);
    expect((await callJson<List>("GET", "/donations?status=refunded", { key })).body.data).toHaveLength(0);
    expect((await callJson<List>("GET", "/donations?tax_year=2026&limit=1", { key })).body.data).toHaveLength(1);

    const liveKey = await makeKey(sgo.orgId, "live");
    expect((await callJson<List>("GET", "/donations", { key: liveKey })).body.data).toHaveLength(0);
    expect((await callJson("GET", `/donations/${donation.id}`, { key: liveKey })).status).toBe(404);
    // The other-mode probe was refused before the service could read (and audit) the record.
    expect((await listAuditLogs({ orgId: sgo.orgId, action: "donation.read" })).items).toHaveLength(1);
  });
});

describe("handoff routes", () => {
  useTestDb();
  let biz: { orgId: string; publishableKey: string };
  let sgo: string;
  let key: string;
  let sgoReviewer: string;
  beforeEach(async () => {
    setTestNow(T0);
    biz = await makeBusiness({ holdWindowHours: 72 });
    sgo = await makeSgo("Synthetic Partner Fund");
    await partner(biz.orgId, sgo);
    sgoReviewer = await makeUser();
    await addMember(sgo, sgoReviewer, "reviewer");
    key = await makeKey(biz.orgId, "test");
  });
  afterEach(() => setTestNow(null));

  const createBody = { booking_ref: "BK-1", booking_description: "Synthetic camp week", booking_amount_cents: 45000, family_email: "family@synthetic.example", student: { first_name: "Riley" }, return_url: `${SYNTHETIC_ORIGIN}/done`, metadata: { session: "w1" } };

  it("creates a handoff with its URLs once, then reads, lists, extends and cancels it", async () => {
    const created = await callJson<Json & { url: string; embed_url: string }>("POST", "/handoffs", { key, body: createBody });
    expect(created.status).toBe(201);
    expectShape(handoffCreatedSchema, created.body);
    expect(created.body).toMatchObject({ status: "started", channel: "redirect", created_via: "api", booking: { ref: "BK-1", amount_usd: "450.00", amount_confirmed: true }, sgo: { name: "Synthetic Partner Fund" } });
    expect(created.body.url).toMatch(/\/h\/[A-Za-z0-9_-]{43}$/);
    expect(created.body.embed_url).toMatch(/\/embed\/handoff\/[A-Za-z0-9_-]{43}$/);

    const read = await callJson<Json>("GET", `/handoffs/${created.body.id}`, { key });
    expectShape(handoffSchema, read.body);
    const text = JSON.stringify(read.body);
    for (const secret of [created.body.url.split("/h/")[1], "family@synthetic.example", "Riley"]) expect(text).not.toContain(secret);

    const list = await callJson<List>("GET", "/handoffs?limit=1", { key });
    expectShape(handoffListSchema, list.body);
    expect(list.body.data.map((h) => h.id)).toEqual([created.body.id]);

    const extended = await callJson<Json>("POST", `/handoffs/${created.body.id}/extend_hold`, { key, body: { hours: 24 } });
    expect(extended.status).toBe(200);
    expect(extended.body.hold_expires_at).toBe("2026-11-22T16:00:00.000Z");
    expect((await callJson("POST", `/handoffs/${created.body.id}/extend_hold`, { key, body: { hours: 0 } })).status).toBe(422);
    expect((await callJson("POST", `/handoffs/${created.body.id}/extend_hold`, { key, body: { hours: 1.5 } })).status).toBe(422);

    const early = await callJson<{ error: { code: string } }>("POST", `/handoffs/${created.body.id}/complete`, { key, body: {} });
    expect(early.status).toBe(409);

    const canceled = await callJson<Json>("POST", `/handoffs/${created.body.id}/cancel`, { key, body: { reason: "Family chose another week" } });
    expect(canceled.body.status).toBe("canceled");
    expect((await listAuditLogs({ orgId: biz.orgId, action: "api.handoff.cancel" })).items).toHaveLength(1);
  });

  it("completes a booking after the SGO awards, never before; eligible alone is not enough", async () => {
    const created = (await callJson<Json>("POST", "/handoffs", { key, body: createBody })).body;
    const db = await getDb();
    const [row] = await db.select().from(schema.handoffs).where(eq(schema.handoffs.id, created.id));
    await setVerificationState(row.verificationId!, { status: "eligible", expiresAt: new Date("2026-12-31T23:59:59Z") });
    await handoffJobs["handoff.verification_updated"]({ handoffId: row.id, verificationId: row.verificationId! }, { jobId: "job_test", attempt: 1 });
    const eligible = (await callJson<Json>("GET", `/handoffs/${created.id}`, { key })).body;
    expect(eligible).toMatchObject({ status: "eligible", verification_status: "eligible", award: null });
    expect((await callJson("POST", `/handoffs/${created.id}/complete`, { key, body: {} })).status).toBe(409);

    await offerAward(sgo, { verificationId: row.verificationId!, amountCents: 40_000, paymentMethod: "direct_to_vendor" }, { type: "user", userId: sgoReviewer, mode: "test" });
    expect((await callJson("POST", `/handoffs/${created.id}/complete`, { key, body: { booking_amount_cents: 30_000 } })).status).toBe(409);
    const done = await callJson<Json>("POST", `/handoffs/${created.id}/complete`, { key, body: { booking_amount_cents: 45_000 } });
    expect(done.status).toBe(200);
    expectShape(handoffSchema, done.body);
    expect(done.body).toMatchObject({ status: "completed", award: { amount_usd: "400.00", payment_method: "direct_to_vendor" } });
  });

  it("maps service validation to the API's field names and refuses a non-partner SGO", async () => {
    const bad = await callJson<{ error: { details: { fields: Record<string, string> } } }>("POST", "/handoffs", { key, body: { booking_ref: "BK", return_url: "https://not-allowed.example/x" } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.details.fields)).toEqual(["return_url"]);
    const stranger = await makeSgo("Synthetic Stranger Fund");
    expect((await callJson("POST", "/handoffs", { key, body: { booking_ref: "BK", sgo_org_id: stranger } })).status).toBeGreaterThanOrEqual(400);
    expect((await callJson("POST", "/handoffs", { key, body: { booking_ref: "" } })).status).toBe(422);
    expect((await callJson("POST", "/handoffs", { key, body: { booking_ref: "BK", booking_amount_cents: 12.5 } })).status).toBe(422);
  });

  it("replays a retried create with the same Idempotency-Key", async () => {
    const first = await callApi("POST", "/handoffs", { key, body: createBody, headers: { "Idempotency-Key": "booking-BK-1" } });
    const second = await callApi("POST", "/handoffs", { key, body: createBody, headers: { "Idempotency-Key": "booking-BK-1" } });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    const db = await getDb();
    expect(await db.select().from(schema.handoffs).where(eq(schema.handoffs.businessOrgId, biz.orgId))).toHaveLength(1);
  });
});

describe("account, events and webhook endpoint routes", () => {
  useTestDb();
  let sgo: string;
  let key: string;
  beforeEach(async () => {
    setTestNow(T0);
    allowWebhookHosts();
    sgo = await makeSgo("Synthetic Events Fund");
    key = await makeKey(sgo, "test");
  });
  afterEach(() => {
    setTestNow(null);
    setWebhookResolverForTests(null);
  });

  it("GET /me describes the key", async () => {
    const me = await callJson<{ organization: { id: string }; mode: string }>("GET", "/me", { key });
    expectShape(meSchema, me.body);
    expect(me.body).toMatchObject({ mode: "test", organization: { id: sgo } });
    const live = await callJson<{ mode: string }>("GET", "/me", { key: await makeKey(sgo, "live") });
    expect(live.body.mode).toBe("live");
  });

  it("lists events of the key's mode newest first with cursors, filters by type, and reads one", async () => {
    for (let i = 0; i < 5; i++) {
      setTestNow(new Date(new Date(T0).getTime() + i * 1000));
      await emitEvent({ orgId: sgo, type: i % 2 ? "verification.decided" : "verification.submitted", payload: { n: i, synthetic: true }, mode: "test" });
    }
    const liveEvent = await emitEvent({ orgId: sgo, type: "verification.decided", payload: { live: true }, mode: "live" });
    const page1 = await callJson<List>("GET", "/events?limit=2", { key });
    expectShape(eventListSchema, page1.body);
    expect(page1.body.data.map((e) => (e.data as { n: number }).n)).toEqual([4, 3]);
    const page2 = await callJson<List>("GET", `/events?limit=2&starting_after=${page1.body.next_cursor}`, { key });
    expect(page2.body.data.map((e) => (e.data as { n: number }).n)).toEqual([2, 1]);
    const page3 = await callJson<List>("GET", `/events?limit=2&starting_after=${page2.body.next_cursor}`, { key });
    expect(page3.body).toMatchObject({ has_more: false, next_cursor: null });
    expect(page3.body.data).toHaveLength(1);
    const decided = await callJson<List>("GET", "/events?type=verification.decided", { key });
    expect(decided.body.data).toHaveLength(2);
    const one = await callJson<Json>("GET", `/events/${page1.body.data[0].id}`, { key });
    expectShape(eventSchema, one.body);
    expect((await callJson("GET", `/events/${liveEvent.id}`, { key })).status).toBe(404);
    expect((await callJson("GET", "/events?type=nope", { key })).status).toBe(422);
  });

  it("manages webhook endpoints: secret once, update, disable/enable, rotate, delete, deliveries by mode", async () => {
    const created = await callJson<Json & { secret: string }>("POST", "/webhook_endpoints", { key, body: { url: "https://hooks.synthetic.example/p", description: "ours", event_types: ["verification.decided"] } });
    expect(created.status).toBe(201);
    expectShape(webhookEndpointWithSecretSchema, created.body);
    expect(created.body.secret).toMatch(/^whsec_/);

    const list = await callJson<List>("GET", "/webhook_endpoints", { key });
    expectShape(webhookEndpointListSchema, list.body);
    expect(JSON.stringify(list.body)).not.toContain(created.body.secret);
    const got = await callJson<Json>("GET", `/webhook_endpoints/${created.body.id}`, { key });
    expectShape(webhookEndpointSchema, got.body);

    const updated = await callJson<Json>("PATCH", `/webhook_endpoints/${created.body.id}`, { key, body: { event_types: ["*"], description: null, status: "disabled" } });
    expect(updated.body).toMatchObject({ event_types: ["*"], description: null, status: "disabled" });
    expect((await callJson<Json>("PATCH", `/webhook_endpoints/${created.body.id}`, { key, body: { status: "active" } })).body.status).toBe("active");
    expect((await callJson("PATCH", `/webhook_endpoints/${created.body.id}`, { key, body: { event_types: ["nope.event"] } })).status).toBe(422);
    expect((await callJson("POST", "/webhook_endpoints", { key, body: { url: "http://10.0.0.1/hook" } })).status).toBe(422);

    const rotated = await callJson<Json & { secret: string }>("POST", `/webhook_endpoints/${created.body.id}/rotate_secret`, { key, body: { expire_previous_now: true } });
    expectShape(webhookEndpointWithSecretSchema, rotated.body);
    expect(rotated.body.secret).not.toBe(created.body.secret);

    await emitEvent({ orgId: sgo, type: "verification.decided", payload: { mode_probe: "test" }, mode: "test" });
    await emitEvent({ orgId: sgo, type: "verification.decided", payload: { mode_probe: "live" }, mode: "live" });
    const deliveries = await callJson<List>("GET", `/webhook_endpoints/${created.body.id}/deliveries`, { key });
    expectShape(webhookDeliveryListSchema, deliveries.body);
    expect(deliveries.body.data).toHaveLength(1);
    expect(deliveries.body.data[0]).toMatchObject({ mode: "test", event_type: "verification.decided", status: "pending" });
    const paged = await callJson<List>("GET", `/webhook_endpoints/${created.body.id}/deliveries?limit=1&status=pending`, { key });
    expect(paged.body.has_more).toBe(false);

    const deleted = await callJson<Json>("DELETE", `/webhook_endpoints/${created.body.id}`, { key });
    expect(deleted.body).toEqual({ id: created.body.id, object: "webhook_endpoint", deleted: true });
    expect((await callJson("GET", `/webhook_endpoints/${created.body.id}`, { key })).status).toBe(404);
    const actions = (await listAuditLogs({ orgId: sgo })).items.map((l) => l.action);
    for (const action of ["api.webhook_endpoint.create", "api.webhook_endpoint.update", "api.webhook_endpoint.rotate_secret", "api.webhook_endpoint.delete"]) expect(actions).toContain(action);
  });

  it("requires a live key to change endpoints once the organization holds one", async () => {
    const before = await callJson<Json>("POST", "/webhook_endpoints", { key, body: { url: "https://hooks.synthetic.example/a" } });
    expect(before.status).toBe(201);
    const liveKey = await makeKey(sgo, "live");
    const refused = await callJson<{ error: { code: string; details: { reason: string } } }>("POST", "/webhook_endpoints", { key, body: { url: "https://hooks.synthetic.example/b" } });
    expect(refused.status).toBe(403);
    expect(refused.body.error.details.reason).toBe("live_key_required");
    for (const [method, path, body] of [
      ["PATCH", `/webhook_endpoints/${before.body.id}`, { description: "x" }],
      ["POST", `/webhook_endpoints/${before.body.id}/rotate_secret`, {}],
      ["DELETE", `/webhook_endpoints/${before.body.id}`, undefined],
    ] as const) {
      expect((await callJson(method, path, { key, body })).status, `${method} ${path}`).toBe(403);
    }
    // Reads still work with the test key; the live key may write.
    expect((await callJson("GET", "/webhook_endpoints", { key })).status).toBe(200);
    expect((await callJson("POST", "/webhook_endpoints", { key: liveKey, body: { url: "https://hooks.synthetic.example/c" } })).status).toBe(201);
  });
});
