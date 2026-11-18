import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { listOutbox } from "@/server/email";
import { listJobs } from "@/server/jobs";
import { useTestDb } from "../../../tests/helpers/db";
import { createBusinessInvoice, getBusinessInvoice, listBusinessInvoices, markInvoicePaid, sendInvoice, voidInvoice, type CreateBusinessInvoiceInput } from "./invoices";
import { setProcessorForTests } from "./processor";
import { getSandboxInvoiceView, paySandboxInvoice } from "./sandbox";
import { createFakeStripeProcessor } from "./stripe-test-support";
import { createTestBusiness, createTestSgo } from "./test-support";

const NOW = new Date("2026-11-18T18:00:00.000Z");
const OPERATOR = { type: "user" as const, id: "usr_synthetic_operator" };

describe("business invoices", () => {
  const t = useTestDb();
  let businessOrgId: string;

  function input(overrides: Partial<CreateBusinessInvoiceInput> = {}): CreateBusinessInvoiceInput {
    return {
      businessOrgId,
      mode: "test",
      lines: [
        { description: "Success fee: booking SYN-1001 (synthetic)", amountCents: 2_500 },
        { description: "Success fee: booking SYN-1002 (synthetic)", amountCents: 4_000 },
      ],
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      ...overrides,
    };
  }

  const keyOf = (hostedUrl: string | null) => new URL(hostedUrl ?? "").searchParams.get("key");
  const billingJobs = async () => (await listJobs({ type: "invoice.payment_updated" })).map((j) => j.payload);
  const stored = async (id: string) => (await t.db.select().from(schema.businessInvoices).where(eq(schema.businessInvoices.id, id)))[0];

  async function fieldsOf(promise: Promise<unknown>): Promise<string[]> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "validation_failed" });
    return Object.keys(((error as AppError).details as { fields: Record<string, string> }).fields);
  }

  beforeEach(async () => {
    setTestNow(NOW);
    businessOrgId = await createTestBusiness();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
    setProcessorForTests("stripe", null);
    vi.restoreAllMocks();
  });

  describe("createBusinessInvoice", () => {
    it("creates a numbered draft with its lines in order and their total", async () => {
      const invoice = await createBusinessInvoice(input());
      expect(invoice).toMatchObject({
        businessOrgId,
        mode: "test",
        number: "INV-TEST-2026-000001",
        status: "draft",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        totalCents: 6_500,
        processor: "sandbox",
        processorInvoiceId: null,
        hostedUrl: null,
        issuedAt: null,
        dueAt: null,
        paidAt: null,
      });
      expect(invoice.id).toMatch(/^inv_/);
      expect(invoice.lines.map((l) => [l.description, l.amountCents])).toEqual([
        ["Success fee: booking SYN-1001 (synthetic)", 2_500],
        ["Success fee: booking SYN-1002 (synthetic)", 4_000],
      ]);
      expect((await getBusinessInvoice(invoice.id, { businessOrgId })).lines.map((l) => l.id)).toEqual(invoice.lines.map((l) => l.id));
      const [entry] = (await listAuditLogs({ targetId: invoice.id })).items;
      expect(entry).toMatchObject({ action: "invoice.created", orgId: businessOrgId, actorType: "system" });
      // A draft owes nothing and tells nobody.
      expect(await billingJobs()).toHaveLength(0);
      expect(await listOutbox()).toHaveLength(0);
    });

    it("numbers invoices in sequence, separately for sandbox and live, by the year in Texas", async () => {
      const numbers: string[] = [];
      for (let i = 0; i < 3; i++) numbers.push((await createBusinessInvoice(input())).number);
      expect(numbers).toEqual(["INV-TEST-2026-000001", "INV-TEST-2026-000002", "INV-TEST-2026-000003"]);
      // Live invoices have their own sequence: sandbox invoices leave no gaps in it.
      expect((await createBusinessInvoice(input({ mode: "live" }))).number).toBe("INV-2026-000001");
      expect((await createBusinessInvoice(input({ mode: "live" }))).number).toBe("INV-2026-000002");
      expect((await createBusinessInvoice(input())).number).toBe("INV-TEST-2026-000004");

      // 11:30 pm on December 31 in Texas is already January 1 in UTC: the invoice still belongs to 2026.
      setTestNow("2027-01-01T05:30:00.000Z");
      expect((await createBusinessInvoice(input())).number).toBe("INV-TEST-2026-000005");
      // After midnight in Texas a new year's sequence starts.
      setTestNow("2027-01-01T06:00:00.000Z");
      expect((await createBusinessInvoice(input())).number).toBe("INV-TEST-2027-000001");
      expect((await createBusinessInvoice(input({ mode: "live" }))).number).toBe("INV-2027-000001");
    });

    it("gives every invoice its own number when many are created at once", async () => {
      const other = await createTestBusiness({ name: "Second Synthetic Camp" });
      const created = await Promise.all(Array.from({ length: 24 }, (_, i) => createBusinessInvoice(input({ businessOrgId: i % 2 ? other : businessOrgId, mode: i % 3 === 0 ? "live" : "test" }))));
      const numbers = created.map((c) => c.number);
      expect(new Set(numbers).size).toBe(24);
      const sequence = (prefix: string) => numbers.filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
      // No gaps and no repeats in either sequence.
      expect(sequence("INV-2026-")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(sequence("INV-TEST-2026-")).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    });

    it("does not burn a number when the caller's transaction rolls back", async () => {
      await createBusinessInvoice(input());
      const db = await getDb();
      await expect(
        db.transaction(async (tx) => {
          const draft = await createBusinessInvoice(input(), tx);
          expect(draft.number).toBe("INV-TEST-2026-000002");
          throw new Error("caller failed");
        }),
      ).rejects.toThrow("caller failed");
      expect(await t.db.select().from(schema.businessInvoices)).toHaveLength(1);
      expect(await t.db.select().from(schema.businessInvoiceLines)).toHaveLength(2);
      expect((await createBusinessInvoice(input())).number).toBe("INV-TEST-2026-000002");
    });

    it("keeps counting past the padded width and ignores numbers from other sequences", async () => {
      const seed = (number: string) => t.db.insert(schema.businessInvoices).values({ id: newId("invoice"), businessOrgId, mode: "test", number, status: "void", totalCents: 1 });
      await seed("INV-TEST-2026-999999");
      await seed("INV-TEST-2025-000777");
      await seed("INV-2026-000555");
      expect((await createBusinessInvoice(input())).number).toBe("INV-TEST-2026-1000000");
      expect((await createBusinessInvoice(input())).number).toBe("INV-TEST-2026-1000001");
      expect((await createBusinessInvoice(input({ mode: "live" }))).number).toBe("INV-2026-000556");
    });

    it("validates what it is given", async () => {
      expect(await fieldsOf(createBusinessInvoice(input({ lines: [] })))).toEqual(["lines"]);
      expect(await fieldsOf(createBusinessInvoice(input({ lines: [{ description: "Fee", amountCents: 0 }] })))).toEqual(["lines.0.amountCents"]);
      expect(await fieldsOf(createBusinessInvoice(input({ lines: [{ description: "Credit", amountCents: -500 }] })))).toEqual(["lines.0.amountCents"]);
      expect(await fieldsOf(createBusinessInvoice(input({ lines: [{ description: "Fee", amountCents: 12.5 }] })))).toEqual(["lines.0.amountCents"]);
      expect(await fieldsOf(createBusinessInvoice(input({ lines: [{ description: "  ", amountCents: 100 }] })))).toEqual(["lines.0.description"]);
      expect(await fieldsOf(createBusinessInvoice(input({ periodStart: "2026-12-01", periodEnd: "2026-11-30" })))).toEqual(["periodEnd"]);
      expect(await fieldsOf(createBusinessInvoice(input({ periodStart: "11/01/2026" })))).toEqual(["periodStart"]);
      expect(await fieldsOf(createBusinessInvoice(input({ periodStart: "2026-02-30" })))).toEqual(["periodStart"]);
      expect(await fieldsOf(createBusinessInvoice(input({ mode: "sandbox" as "test" })))).toEqual(["mode"]);
      expect(await fieldsOf(createBusinessInvoice(input({ lines: Array.from({ length: 251 }, () => ({ description: "Fee", amountCents: 1 })) })))).toEqual(["lines"]);
      expect(await t.db.select().from(schema.businessInvoices)).toHaveLength(0);
    });

    it("only bills businesses: never an SGO, never an unknown organization", async () => {
      const sgo = await createTestSgo();
      await expect(createBusinessInvoice(input({ businessOrgId: sgo }))).rejects.toMatchObject({ code: "not_found" });
      await expect(createBusinessInvoice(input({ businessOrgId: "org_missing" }))).rejects.toMatchObject({ code: "not_found" });
      expect(await t.db.select().from(schema.businessInvoices)).toHaveLength(0);
    });

    it("bills a fee only once, unless the earlier invoice was voided", async () => {
      const fee = (feeLedgerId: string) => ({ description: `Success fee ${feeLedgerId} (synthetic)`, amountCents: 2_500, feeLedgerId });
      const first = await createBusinessInvoice(input({ lines: [fee("fee_a"), fee("fee_b")] }));
      await expect(createBusinessInvoice(input({ lines: [fee("fee_b"), fee("fee_c")] }))).rejects.toMatchObject({ code: "conflict", message: `Already invoiced on ${first.number}`, details: { feeLedgerIds: ["fee_b"] } });
      expect(await fieldsOf(createBusinessInvoice(input({ lines: [fee("fee_d"), fee("fee_d")] })))).toEqual(["lines"]);
      expect(await t.db.select().from(schema.businessInvoices)).toHaveLength(1);

      await voidInvoice(first.id, { reason: "Billed to the wrong period (synthetic)." });
      const again = await createBusinessInvoice(input({ lines: [fee("fee_a"), fee("fee_b")] }));
      // The voided invoice keeps its number; the replacement takes the next one.
      expect(again.number).toBe("INV-TEST-2026-000002");
      expect(again.lines.map((l) => l.feeLedgerId)).toEqual(["fee_a", "fee_b"]);
    });
  });

  describe("sendInvoice", () => {
    it("issues the invoice: open, hosted page, due date, processor ids, and an email with the link", async () => {
      const draft = await createBusinessInvoice(input());
      const sent = await sendInvoice(draft.id, { dueInDays: 15, actor: OPERATOR });

      expect(sent).toMatchObject({ id: draft.id, status: "open", processor: "sandbox" });
      expect(sent.processorInvoiceId).toMatch(/^sbx_in_[0-9a-f]{24}$/);
      expect(sent.hostedUrl).toMatch(new RegExp(`^http://localhost:3000/sandbox/invoice/${draft.id}\\?key=sbx_inv_`));
      expect(sent.issuedAt?.toISOString()).toBe(NOW.toISOString());
      expect(sent.dueAt?.toISOString()).toBe("2026-12-03T18:00:00.000Z");
      expect(sent.lines).toHaveLength(2);

      const [profile] = await t.db.select().from(schema.businessProfiles).where(eq(schema.businessProfiles.orgId, businessOrgId));
      expect(profile.paymentsCustomerId).toMatch(/^sbx_cus_/);

      const [email] = await listOutbox();
      expect(email).toMatchObject({ toEmail: "billing@synthetic-camp.example", template: "business_invoice", relatedType: "business_invoice", relatedId: draft.id, status: "queued" });
      // A sandbox invoice says so before anyone opens it.
      expect(email.subject).toBe("[Sandbox] Invoice INV-TEST-2026-000001 from Passport");
      expect(email.text).toContain("This is a sandbox invoice. No money is owed and no payment will be taken.");
      expect(email.text).toContain("$65.00");
      expect(email.text).toContain("December 3, 2026");
      expect(email.text).toContain(sent.hostedUrl as string);
      expect((await listJobs({ type: "email.send" })).map((j) => j.payload)).toEqual([{ emailId: email.id }]);

      const trail = (await listAuditLogs({ targetId: draft.id })).items;
      expect(trail[0]).toMatchObject({ action: "invoice.sent", actorType: "user", actorId: OPERATOR.id });
      // Sending is not a payment: the billing domain hears nothing yet.
      expect(await billingJobs()).toHaveLength(0);
    });

    it("is idempotent, uses 30-day terms by default, and can skip the email", async () => {
      const draft = await createBusinessInvoice(input());
      const sent = await sendInvoice(draft.id, { notify: false });
      expect(sent.dueAt?.toISOString()).toBe("2026-12-18T18:00:00.000Z");
      expect(await listOutbox()).toHaveLength(0);

      setTestNow("2026-11-25T00:00:00.000Z");
      const again = await sendInvoice(draft.id);
      expect(again).toMatchObject({ status: "open", processorInvoiceId: sent.processorInvoiceId, hostedUrl: sent.hostedUrl });
      expect(again.issuedAt?.toISOString()).toBe(NOW.toISOString());
      expect(await listOutbox()).toHaveLength(0);
      expect((await listAuditLogs({ targetId: draft.id, action: "invoice.sent" })).items).toHaveLength(1);
    });

    it("needs a billing email, sensible terms and a draft", async () => {
      const noEmail = await createTestBusiness({ name: "Camp With No Billing Email", billingEmail: null });
      const draft = await createBusinessInvoice(input({ businessOrgId: noEmail }));
      expect(await fieldsOf(sendInvoice(draft.id))).toEqual(["billingEmail"]);
      expect((await stored(draft.id)).status).toBe("draft");

      const ok = await createBusinessInvoice(input());
      for (const dueInDays of [0, -1, 1.5, 366]) await expect(sendInvoice(ok.id, { dueInDays })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(sendInvoice("inv_missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(sendInvoice(ok.id, { businessOrgId: "org_other" })).rejects.toMatchObject({ code: "not_found" });
      await voidInvoice(ok.id, { reason: "Created by mistake (synthetic)." });
      await expect(sendInvoice(ok.id)).rejects.toMatchObject({ code: "conflict" });
    });

    it("never issues a live invoice through the sandbox", async () => {
      const live = await createBusinessInvoice(input({ mode: "live" }));
      await expect(sendInvoice(live.id)).rejects.toMatchObject({ code: "not_available" });
      expect((await stored(live.id)).status).toBe("draft");
    });

    it("on Stripe: stores Stripe's invoice, hosted page and customer, and sends our own email", async () => {
      const { processor, stripe } = createFakeStripeProcessor();
      setProcessorForTests("stripe", processor);
      vi.stubEnv("PAYMENTS_PROVIDER", "stripe");

      const draft = await createBusinessInvoice(input());
      const sent = await sendInvoice(draft.id);
      expect(sent).toMatchObject({ status: "open", processor: "stripe", processorInvoiceId: "in_synthetic2", hostedUrl: "https://invoice.stripe.example/i/in_synthetic2" });
      const [profile] = await t.db.select().from(schema.businessProfiles).where(eq(schema.businessProfiles.orgId, businessOrgId));
      expect(profile.paymentsCustomerId).toBe("cus_synthetic1");
      expect(stripe.invoices.create.mock.calls[0][1]).toEqual({ idempotencyKey: `invoice_${draft.id}_v1_invoice` });
      expect(stripe.invoices.create.mock.calls[0][0]).toMatchObject({ days_until_due: 30, metadata: { invoice_id: draft.id, invoice_number: draft.number, business_org_id: businessOrgId, mode: "test" } });
      expect((await listOutbox())[0].text).toContain("https://invoice.stripe.example/i/in_synthetic2");

      // Sending again does not create a second Stripe invoice.
      await sendInvoice(draft.id);
      expect(stripe.invoices.create).toHaveBeenCalledOnce();

      // The next invoice for the same business reuses the stored customer.
      const next = await sendInvoice((await createBusinessInvoice(input())).id);
      expect(stripe.customers.create).toHaveBeenCalledOnce();
      expect(stripe.customers.update).toHaveBeenCalledWith("cus_synthetic1", expect.anything());

      // An operator records a check: the Stripe invoice is closed without a charge, and ours is paid.
      await markInvoicePaid(draft.id, { actor: OPERATOR, note: "Check #1042 (synthetic)" });
      expect(stripe.invoices.pay).toHaveBeenCalledWith("in_synthetic2", { paid_out_of_band: true });
      await voidInvoice(next.id, { reason: "Duplicate of the first invoice (synthetic)." });
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith(next.processorInvoiceId);
      expect(next.processorInvoiceId).not.toBe(sent.processorInvoiceId);
      expect((await stored(next.id)).status).toBe("void");
    });
  });

  describe("the hosted sandbox invoice", () => {
    it("shows an issued invoice to whoever holds its link, and nobody else", async () => {
      const draft = await createBusinessInvoice(input());
      // A draft has not been issued: it has no page.
      await expect(getSandboxInvoiceView(draft.id, "anything")).rejects.toMatchObject({ code: "not_found" });
      const sent = await sendInvoice(draft.id);
      const key = keyOf(sent.hostedUrl);

      const view = await getSandboxInvoiceView(draft.id, key);
      expect(view).toMatchObject({ businessName: "Synthetic Summer Camp", key });
      expect(view.invoice).toMatchObject({ number: "INV-TEST-2026-000001", status: "open", totalCents: 6_500 });
      expect(view.lines).toHaveLength(2);

      const other = await sendInvoice((await createBusinessInvoice(input())).id);
      await expect(getSandboxInvoiceView(draft.id, null)).rejects.toMatchObject({ code: "not_found" });
      await expect(getSandboxInvoiceView(draft.id, "sbx_inv_wrong")).rejects.toMatchObject({ code: "not_found" });
      await expect(getSandboxInvoiceView(draft.id, keyOf(other.hostedUrl))).rejects.toMatchObject({ code: "not_found" });
      await expect(paySandboxInvoice(draft.id, keyOf(other.hostedUrl))).rejects.toMatchObject({ code: "not_found" });
      expect((await stored(draft.id)).status).toBe("open");
    });

    it("'Mark paid (sandbox)' pays the invoice once and tells the billing domain once", async () => {
      const sent = await sendInvoice((await createBusinessInvoice(input())).id);
      const key = keyOf(sent.hostedUrl);
      setTestNow("2026-11-20T14:30:00.000Z");

      expect(await paySandboxInvoice(sent.id, key)).toEqual({ invoiceId: sent.id, status: "paid" });
      const paid = await stored(sent.id);
      expect(paid.status).toBe("paid");
      expect(paid.paidAt?.toISOString()).toBe("2026-11-20T14:30:00.000Z");
      expect(await billingJobs()).toEqual([{ invoiceId: sent.id }]);

      // Pressing the button again is harmless.
      expect(await paySandboxInvoice(sent.id, key)).toEqual({ invoiceId: sent.id, status: "paid" });
      expect(await billingJobs()).toHaveLength(1);
      expect((await listAuditLogs({ targetId: sent.id, action: "invoice.paid" })).items).toHaveLength(1);
      expect((await getSandboxInvoiceView(sent.id, key)).invoice.status).toBe("paid");
    });

    it("cannot pay a voided invoice, and is closed in production when Stripe is the processor", async () => {
      const sent = await sendInvoice((await createBusinessInvoice(input())).id);
      const key = keyOf(sent.hostedUrl);

      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
      await expect(getSandboxInvoiceView(sent.id, key)).rejects.toMatchObject({ code: "not_found" });
      await expect(paySandboxInvoice(sent.id, key)).rejects.toMatchObject({ code: "not_found" });
      vi.unstubAllEnvs();
      expect((await stored(sent.id)).status).toBe("open");

      await voidInvoice(sent.id, { reason: "Withdrawn (synthetic)." });
      await expect(paySandboxInvoice(sent.id, key)).rejects.toMatchObject({ code: "conflict" });
      expect((await getSandboxInvoiceView(sent.id, key)).invoice.status).toBe("void");
    });
  });

  describe("markInvoicePaid (operator)", () => {
    it("records an out-of-band payment with who, how and when", async () => {
      const sent = await sendInvoice((await createBusinessInvoice(input())).id);
      const paidAt = new Date("2026-11-17T12:00:00.000Z");
      const paid = await markInvoicePaid(sent.id, { actor: OPERATOR, note: "Check #1042, deposited Nov 17 (synthetic)", paidAt, businessOrgId, request: { ip: "203.0.113.9" } });
      expect(paid.status).toBe("paid");
      expect(paid.paidAt?.toISOString()).toBe(paidAt.toISOString());
      expect(await billingJobs()).toEqual([{ invoiceId: sent.id }]);
      const [entry] = (await listAuditLogs({ targetId: sent.id, action: "invoice.paid" })).items;
      expect(entry).toMatchObject({ actorType: "user", actorId: OPERATOR.id, ip: "203.0.113.9" });
      expect(entry.metadata).toMatchObject({ source: "operator", note: "Check #1042, deposited Nov 17 (synthetic)", from: "open", to: "paid" });

      // Already paid: unchanged, no second job.
      expect((await markInvoicePaid(sent.id, { actor: OPERATOR, note: "Recorded again (synthetic)" })).paidAt?.toISOString()).toBe(paidAt.toISOString());
      expect(await billingJobs()).toHaveLength(1);
    });

    it("needs a note, a payment date that is not in the future, and an issued invoice", async () => {
      const draft = await createBusinessInvoice(input());
      await expect(markInvoicePaid(draft.id, { actor: OPERATOR, note: "Check (synthetic)" })).rejects.toMatchObject({ code: "conflict" });
      const sent = await sendInvoice(draft.id);
      expect(await fieldsOf(markInvoicePaid(sent.id, { actor: OPERATOR, note: " " }))).toEqual(["note"]);
      expect(await fieldsOf(markInvoicePaid(sent.id, { actor: OPERATOR, note: "Wire (synthetic)", paidAt: new Date("2026-11-19T00:00:00.000Z") }))).toEqual(["paidAt"]);
      await expect(markInvoicePaid(sent.id, { actor: OPERATOR, note: "Wire (synthetic)", businessOrgId: "org_other" })).rejects.toMatchObject({ code: "not_found" });
      expect((await stored(sent.id)).status).toBe("open");
      await voidInvoice(sent.id, { reason: "Withdrawn (synthetic)." });
      await expect(markInvoicePaid(sent.id, { actor: OPERATOR, note: "Wire (synthetic)" })).rejects.toMatchObject({ code: "conflict" });
      expect(await billingJobs()).toEqual([{ invoiceId: sent.id }]);
    });
  });

  describe("voidInvoice", () => {
    it("voids a draft or an open invoice with a reason, and never a paid one", async () => {
      const draft = await createBusinessInvoice(input());
      expect(await fieldsOf(voidInvoice(draft.id, { reason: "" }))).toEqual(["reason"]);
      const voided = await voidInvoice(draft.id, { reason: "Created by mistake (synthetic).", actor: OPERATOR });
      expect(voided).toMatchObject({ status: "void", paidAt: null });
      expect((await voidInvoice(draft.id, { reason: "Again (synthetic)." })).status).toBe("void");
      expect(await billingJobs()).toEqual([{ invoiceId: draft.id }]);
      const [entry] = (await listAuditLogs({ targetId: draft.id, action: "invoice.voided" })).items;
      expect(entry).toMatchObject({ actorType: "user", actorId: OPERATOR.id });
      expect(entry.metadata).toMatchObject({ reason: "Created by mistake (synthetic).", from: "draft", to: "void" });

      const open = await sendInvoice((await createBusinessInvoice(input())).id);
      expect((await voidInvoice(open.id, { reason: "Business closed its account (synthetic)." })).status).toBe("void");

      const paid = await sendInvoice((await createBusinessInvoice(input())).id);
      await paySandboxInvoice(paid.id, keyOf(paid.hostedUrl));
      await expect(voidInvoice(paid.id, { reason: "Too late (synthetic)." })).rejects.toMatchObject({ code: "conflict" });
      await expect(voidInvoice(open.id, { reason: "Wrong tenant (synthetic).", businessOrgId: "org_other" })).rejects.toMatchObject({ code: "not_found" });
      expect((await stored(paid.id)).status).toBe("paid");
    });
  });

  it("lists a business's invoices by mode and status, newest first, and never another business's", async () => {
    const first = await createBusinessInvoice(input());
    setTestNow("2026-11-19T18:00:00.000Z");
    const second = await sendInvoice((await createBusinessInvoice(input())).id);
    await createBusinessInvoice(input({ mode: "live" }));
    const other = await createTestBusiness({ name: "Second Synthetic Camp" });
    await createBusinessInvoice(input({ businessOrgId: other }));

    expect((await listBusinessInvoices({ businessOrgId, mode: "test" })).map((i) => i.id)).toEqual([second.id, first.id]);
    expect((await listBusinessInvoices({ businessOrgId, mode: "test", status: "open" })).map((i) => i.id)).toEqual([second.id]);
    expect(await listBusinessInvoices({ businessOrgId, mode: "live" })).toHaveLength(1);
    expect(await listBusinessInvoices({ businessOrgId: other, mode: "test", limit: 1 })).toHaveLength(1);
    await expect(getBusinessInvoice(first.id, { businessOrgId: other })).rejects.toMatchObject({ code: "not_found" });
  });
});
