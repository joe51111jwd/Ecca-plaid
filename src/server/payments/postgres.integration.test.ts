import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSchemaSql, schema, setDbForTests, type Db } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listJobs } from "@/server/jobs";
import { truncateAll } from "../../../tests/helpers/db";
import { createDonationPayment, getPayment } from "./donation-payments";
import { applyProcessorEvent } from "./events";
import { createBusinessInvoice, sendInvoice } from "./invoices";
import { confirmSandboxPayment, paySandboxInvoice, sandboxPaymentSecret } from "./sandbox";
import { createTestBusiness, createTestCheckout, createTestSgo } from "./test-support";

/**
 * The race-sensitive paths on a real Postgres server with a connection pool, where transactions truly run
 * at the same time (the embedded database used by the other tests serializes them). Skipped unless
 * TEST_DATABASE_URL points at a server on which a throwaway database may be created:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run src/server/payments/postgres.integration.test.ts
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ADMIN_URL)("payments on real Postgres", () => {
  const dbName = `ecca_payments_test_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database "${dbName}"`);
    await admin.end();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString(), max: 16 });
    db = drizzle(pool, { schema }) as unknown as Db;
    for (const stmt of await generateSchemaSql()) await db.execute(sql.raw(stmt));
    setDbForTests({ db, driver: "pg", close: () => pool.end() });
  });
  afterAll(async () => {
    setDbForTests(null);
    await pool?.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // The pool's sockets close a moment after end() resolves; wait for them instead of killing them.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.query(`drop database if exists "${dbName}"`);
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "55006" || attempt >= 100) throw e;
        await sleep(50);
      }
    }
    await admin.end();
  });
  beforeEach(async () => {
    await truncateAll(db);
    setTestNow("2026-12-10T15:00:00.000Z");
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  async function newPayment(idempotencyKey = "attempt-1") {
    const orgId = await createTestSgo();
    const checkoutSessionId = await createTestCheckout(orgId);
    const input = {
      checkoutSessionId,
      orgId,
      amountCents: 170_000,
      lines: [{ kind: "designated_contribution" as const, amountCents: 170_000, description: "Designated contribution (synthetic)" }],
      idempotencyKey,
      mode: "test" as const,
    };
    return { input, payment: await createDonationPayment(input) };
  }

  it("gives 40 invoices created at the same moment 40 consecutive numbers", async () => {
    const businesses = await Promise.all(Array.from({ length: 4 }, (_, i) => createTestBusiness({ name: `Synthetic Camp ${i}` })));
    const created = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        createBusinessInvoice({ businessOrgId: businesses[i % 4], mode: i % 4 === 0 ? "live" : "test", lines: [{ description: "Success fee (synthetic)", amountCents: 2_500 }] }),
      ),
    );
    const sequence = (prefix: string) => created.map((c) => c.number).filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
    expect(sequence("INV-2026-")).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(sequence("INV-TEST-2026-")).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(await db.select().from(schema.businessInvoices)).toHaveLength(40);
  });

  it("bills a fee once when two invoices for it are created at the same moment", async () => {
    const businessOrgId = await createTestBusiness();
    const attempt = () => createBusinessInvoice({ businessOrgId, mode: "test", lines: [{ description: "Success fee (synthetic)", amountCents: 2_500, feeLedgerId: "fee_synthetic_1" }] });
    const results = await Promise.allSettled(Array.from({ length: 12 }, attempt));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
    expect(await db.select().from(schema.businessInvoiceLines)).toHaveLength(1);
  });

  it("creates one payment when the same idempotency key arrives 20 times at once", async () => {
    const orgId = await createTestSgo();
    const checkoutSessionId = await createTestCheckout(orgId);
    const input = {
      checkoutSessionId,
      orgId,
      amountCents: 170_000,
      lines: [{ kind: "designated_contribution" as const, amountCents: 170_000, description: "Designated contribution (synthetic)" }],
      idempotencyKey: "attempt-1",
      mode: "test" as const,
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => createDonationPayment(input)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.select().from(schema.payments)).toHaveLength(1);
  });

  it("leaves one payable payment when a checkout asks for several at once", async () => {
    const { input } = await newPayment("attempt-0");
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createDonationPayment({ ...input, idempotencyKey: `attempt-${i + 1}` })));
    const rows = await db.select().from(schema.payments);
    // However the requests interleave, at most one payment of the checkout can still be paid.
    expect(rows.filter((r) => r.status === "requires_payment" || r.status === "failed").length).toBeLessThanOrEqual(1);
    expect(rows.filter((r) => r.status === "canceled").length).toBeGreaterThanOrEqual(rows.length - 1);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("lets exactly one of many simultaneous submissions pay a sandbox payment", async () => {
    const { payment } = await newPayment();
    const submit = () => confirmSandboxPayment({ paymentId: payment.id, clientSecret: sandboxPaymentSecret(payment.id), cardNumber: "4242424242424242", expiry: "12/30", securityCode: "123" });
    const results = await Promise.allSettled(Array.from({ length: 12 }, submit));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
    expect((await getPayment(payment.id)).status).toBe("succeeded");
    expect(await listJobs({ type: "donation.payment_updated" })).toHaveLength(1);
  });

  it("applies an event once when a processor delivers it 20 times at once", async () => {
    const { payment } = await newPayment();
    const event = {
      id: "evt_synthetic_duplicate",
      processor: "sandbox" as const,
      occurredAt: new Date("2026-12-10T15:00:00.000Z"),
      livemode: false,
      type: "payment.succeeded" as const,
      processorPaymentId: payment.processorPaymentId as string,
      chargedAt: new Date("2026-12-10T14:59:00.000Z"),
      amountCents: 170_000,
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => applyProcessorEvent(event)));
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => r.ignored === "duplicate")).toHaveLength(19);
    expect(await listJobs({ type: "donation.payment_updated" })).toHaveLength(1);
    const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(row.paidAt?.toISOString()).toBe("2026-12-10T14:59:00.000Z");
  });

  it("settles a race between success and cancel to exactly one final state", async () => {
    const { payment } = await newPayment();
    const base = { processor: "sandbox" as const, occurredAt: new Date("2026-12-10T15:00:00.000Z"), livemode: false, processorPaymentId: payment.processorPaymentId as string };
    const results = await Promise.all([
      applyProcessorEvent({ ...base, id: "evt_ok", type: "payment.succeeded", chargedAt: base.occurredAt }),
      applyProcessorEvent({ ...base, id: "evt_cancel", type: "payment.canceled" }),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    const final = (await getPayment(payment.id)).status;
    expect(["succeeded", "canceled"]).toContain(final);
    expect(await listJobs({ type: "donation.payment_updated" })).toHaveLength(1);
  });

  it("pays a sandbox invoice once when the button is pressed many times at once", async () => {
    const sent = await sendInvoice((await createBusinessInvoice({ businessOrgId: await createTestBusiness(), mode: "test", lines: [{ description: "Success fee (synthetic)", amountCents: 2_500 }] })).id);
    const key = new URL(sent.hostedUrl as string).searchParams.get("key");
    const results = await Promise.all(Array.from({ length: 12 }, () => paySandboxInvoice(sent.id, key)));
    expect(results.every((r) => r.status === "paid")).toBe(true);
    expect(await listJobs({ type: "invoice.payment_updated" })).toHaveLength(1);
  });

  it("sends an invoice once when asked many times at once", async () => {
    const draft = await createBusinessInvoice({ businessOrgId: await createTestBusiness(), mode: "test", lines: [{ description: "Success fee (synthetic)", amountCents: 2_500 }] });
    const results = await Promise.all(Array.from({ length: 10 }, () => sendInvoice(draft.id)));
    expect(new Set(results.map((r) => r.processorInvoiceId)).size).toBe(1);
    expect(results.every((r) => r.status === "open")).toBe(true);
    // One email, however many requests raced.
    expect(await db.select().from(schema.emails)).toHaveLength(1);
  });
});
