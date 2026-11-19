import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { offerAward } from "@/server/awards";
import { applyVerificationOutcome, completeHandoff, createHandoff, handoffSystemActor } from "@/server/handoffs";
import { runDueJobs } from "@/server/jobs";
import { paySandboxInvoice, voidInvoice } from "@/server/payments";
import { useTestDb } from "../../../tests/helpers/db";
import { addMember, apiSource, makeBusiness, makeSgo, makeUser, partner, setVerificationState } from "../handoffs/test-support";
import { accrueSuccessFee, computeSuccessFeeCents, describeSuccessFee } from "./fees";
import { applyInvoicePaymentUpdate, generateMonthlyInvoices } from "./invoicing";
import { INVOICE_GENERATE_EVERY_MS, INVOICE_GENERATE_JOB, jobHandlers, recurringJobs } from "./jobs";
import { feeSummary, getInvoice, listInvoices, listSuccessFees } from "./read";

// Every organization, booking, person, email address and amount below is SYNTHETIC.

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}

describe("computeSuccessFeeCents", () => {
  it("flat only, bps only, and both", () => {
    expect(computeSuccessFeeCents({ flatCents: 2500, bps: 0 }, 60_000)).toBe(2500);
    expect(computeSuccessFeeCents({ flatCents: 0, bps: 250 }, 60_000)).toBe(1500);
    expect(computeSuccessFeeCents({ flatCents: 2500, bps: 250 }, 60_000)).toBe(4000);
    expect(computeSuccessFeeCents({ flatCents: 0, bps: 0 }, 60_000)).toBe(0);
  });

  it("rounds the percentage part half-up to the cent, in integer math", () => {
    // 2.5% of $123.45 = 308.625 cents → 309.
    expect(computeSuccessFeeCents({ flatCents: 0, bps: 250 }, 12_345)).toBe(309);
    // 0.25% of $2.00 = 0.5 cents → 1 (exactly half rounds up).
    expect(computeSuccessFeeCents({ flatCents: 0, bps: 25 }, 200)).toBe(1);
    // 0.15% of $3.33 = 0.4995 cents → 0.
    expect(computeSuccessFeeCents({ flatCents: 0, bps: 15 }, 333)).toBe(0);
    // Large amounts stay exact (no float drift): 20% of $99,999.99.
    expect(computeSuccessFeeCents({ flatCents: 1, bps: 2000 }, 9_999_999)).toBe(1 + 2_000_000);
  });

  it("with no booking amount only the flat part applies", () => {
    expect(computeSuccessFeeCents({ flatCents: 2500, bps: 250 }, null)).toBe(2500);
    expect(computeSuccessFeeCents({ flatCents: 0, bps: 250 }, null)).toBe(0);
  });

  it("refuses invalid terms or amounts instead of computing a wrong fee", () => {
    expect(() => computeSuccessFeeCents({ flatCents: -1, bps: 0 }, 100)).toThrow();
    expect(() => computeSuccessFeeCents({ flatCents: 1.5, bps: 0 }, 100)).toThrow();
    expect(() => computeSuccessFeeCents({ flatCents: 0, bps: -1 }, 100)).toThrow();
    expect(() => computeSuccessFeeCents({ flatCents: 0, bps: 2.5 }, 100)).toThrow();
    expect(() => computeSuccessFeeCents({ flatCents: 0, bps: 100_000 }, 100)).toThrow();
    expect(() => computeSuccessFeeCents({ flatCents: 0, bps: 100 }, -100)).toThrow();
    expect(() => computeSuccessFeeCents({ flatCents: 0, bps: 100 }, 10.5)).toThrow();
  });
});

describe("describeSuccessFee", () => {
  it("states the booking, the completion day in Texas and the terms, and nothing about the family", () => {
    const text = describeSuccessFee({ bookingRef: "SYN-CAMP-1", completedAt: new Date("2026-12-01T03:00:00Z"), terms: { flatCents: 2500, bps: 250 }, bookingAmountCents: 60_000 });
    expect(text).toBe("Success fee for booking SYN-CAMP-1 (completed 2026-11-30): $25 flat + 2.5% of $600");
  });

  it("shortens a very long booking reference", () => {
    const text = describeSuccessFee({ bookingRef: "R".repeat(150), completedAt: new Date("2026-11-18T16:00:00Z"), terms: { flatCents: 100, bps: 0 }, bookingAmountCents: null });
    expect(text).toContain(`${"R".repeat(99)}…`);
    expect(text).not.toContain("R".repeat(100));
  });
});

describe("business billing", () => {
  useTestDb();
  let biz: { orgId: string; publishableKey: string };
  let other: { orgId: string; publishableKey: string };
  let sgo: string;
  let sgoReviewer: string;
  let seq = 0;

  beforeEach(async () => {
    setTestNow("2026-11-18T16:00:00.000Z");
    biz = await makeBusiness({ name: "Synthetic Lake Camp", fee: { flatCents: 2500, bps: 250 } });
    other = await makeBusiness({ name: "Synthetic Art School", fee: { flatCents: 1000, bps: 0 } });
    sgo = await makeSgo("Synthetic Fund");
    await partner(biz.orgId, sgo);
    await partner(other.orgId, sgo);
    sgoReviewer = await makeUser();
    await addMember(sgo, sgoReviewer, "reviewer");
  });
  afterEach(() => setTestNow(null));

  /** A booking taken all the way to completed through the real services. */
  async function completed(businessOrgId: string, bookingAmountCents: number | null = 60_000, awardCents = 40_000) {
    seq += 1;
    const res = await createHandoff(
      { bookingRef: `SYN-${seq}`, bookingAmountCents, channel: "redirect", familyEmail: `family-${seq}@example.com`, studentFirstName: "Riley", studentLastName: "Synthetic" },
      await apiSource(businessOrgId),
    );
    await setVerificationState(res.handoff.verificationId!, { status: "eligible", expiresAt: new Date("2027-12-31T00:00:00Z") });
    await applyVerificationOutcome({ handoffId: res.handoff.id, verificationId: res.handoff.verificationId! });
    const { award } = await offerAward(sgo, { verificationId: res.handoff.verificationId!, amountCents: awardCents, paymentMethod: "direct_to_vendor" }, { type: "user", userId: sgoReviewer, mode: "test" });
    const done = await completeHandoff(businessOrgId, res.handoff.id, handoffSystemActor("billing test"));
    return { ...done, award };
  }

  async function ledger() {
    const db = await getDb();
    return db.select().from(schema.feeLedger);
  }

  async function runBillingJobs() {
    for (;;) {
      const r = await runDueJobs({ handlers: jobHandlers, limit: 50 });
      if (r.ran === 0) return;
    }
  }

  describe("accrual", () => {
    it("accrues one business_success_fee row per completed booking, owed by the business", async () => {
      const { fee, handoff } = await completed(biz.orgId);
      expect(fee).toMatchObject({ kind: "business_success_fee", payerOrgId: biz.orgId, amountCents: 4000, status: "accrued", handoffId: handoff.id, feeBps: 250, baseCents: 60_000, mode: "test" });
      expect(fee?.description).toBe("Success fee for booking SYN-1 (completed 2026-11-18): $25 flat + 2.5% of $600");
    });

    it("is idempotent: a second accrual returns the same row", async () => {
      const { fee, handoff } = await completed(biz.orgId);
      const again = await accrueSuccessFee(handoff.id);
      expect(again?.id).toBe(fee?.id);
      expect(await ledger()).toHaveLength(1);
    });

    it("uses only the flat part when the booking has no amount", async () => {
      const { fee } = await completed(biz.orgId, null);
      expect(fee?.amountCents).toBe(2500);
      expect(fee?.baseCents).toBeNull();
    });

    it("refuses a booking that is not completed, and an unknown one", async () => {
      const res = await createHandoff({ bookingRef: "SYN-OPEN", channel: "redirect" }, await apiSource(biz.orgId));
      expect(await codeOf(accrueSuccessFee(res.handoff.id))).toBe("conflict");
      expect(await codeOf(accrueSuccessFee("handoff_missing"))).toBe("not_found");
      expect(await ledger()).toHaveLength(0);
    });

    it("refuses to charge an organization that is not a business", async () => {
      const { handoff, fee } = await completed(biz.orgId);
      const db = await getDb();
      await db.delete(schema.feeLedger).where(eq(schema.feeLedger.id, fee!.id));
      await db.update(schema.organizations).set({ type: "sgo" }).where(eq(schema.organizations.id, biz.orgId));
      expect(await codeOf(accrueSuccessFee(handoff.id))).toBe("internal");
      expect(await ledger()).toHaveLength(0);
    });
  });

  describe("monthly invoicing", () => {
    it("bills nothing during the month the fees accrued in", async () => {
      await completed(biz.orgId);
      setTestNow("2026-11-30T20:00:00.000Z");
      const run = await generateMonthlyInvoices();
      expect(run).toMatchObject({ periodEnd: "2026-10-31", created: [], sent: [], failures: [] });
      expect((await ledger())[0].status).toBe("accrued");
    });

    it("bills last month's fees: one invoice per business, one line per completed booking, then sends and settles them", async () => {
      const a1 = await completed(biz.orgId, 60_000);
      const a2 = await completed(biz.orgId, 12_345, 10_000);
      const b1 = await completed(other.orgId, 30_000, 30_000);
      // Accrued at 9 PM on November 30 in Texas (03:00 UTC on December 1): still November.
      setTestNow("2026-12-01T03:00:00.000Z");
      const late = await completed(biz.orgId, 20_000, 5_000);
      // December's fee waits for January.
      setTestNow("2026-12-01T15:00:00.000Z");
      const december = await completed(biz.orgId, 20_000, 5_000);

      setTestNow("2026-12-02T15:00:00.000Z");
      const run = await generateMonthlyInvoices();
      expect(run.periodEnd).toBe("2026-11-30");
      expect(run.failures).toEqual([]);
      expect(run.created).toHaveLength(2);
      expect(run.sent).toHaveLength(2);

      const bizInvoice = run.created.find((c) => c.businessOrgId === biz.orgId)!;
      // $40.00 + ($25 + 2.5% of $123.45 = $28.09) + ($25 + $5) = $98.09.
      expect(bizInvoice).toMatchObject({ mode: "test", lineCount: 3, totalCents: 4000 + 2809 + 3000 });
      const full = await getInvoice(biz.orgId, bizInvoice.invoiceId);
      expect(full).toMatchObject({ status: "open", periodStart: "2026-11-01", periodEnd: "2026-11-30", businessOrgId: biz.orgId });
      expect(full.lines.map((l) => l.handoffId).sort()).toEqual([a1.handoff.id, a2.handoff.id, late.handoff.id].sort());
      expect(full.lines.map((l) => l.feeLedgerId).sort()).toEqual([a1.fee!.id, a2.fee!.id, late.fee!.id].sort());
      const otherInvoice = run.created.find((c) => c.businessOrgId === other.orgId)!;
      expect(otherInvoice).toMatchObject({ lineCount: 1, totalCents: 1000 });
      expect((await getInvoice(other.orgId, otherInvoice.invoiceId)).lines[0].handoffId).toBe(b1.handoff.id);

      const rows = await ledger();
      expect(rows.filter((r) => r.status === "invoiced")).toHaveLength(4);
      expect(rows.find((r) => r.id === december.fee!.id)).toMatchObject({ status: "accrued", invoiceId: null });

      // Running again the same day (or every day this month) creates nothing new.
      const rerun = await generateMonthlyInvoices();
      expect(rerun).toMatchObject({ created: [], sent: [], failures: [] });

      // The business pays on the hosted sandbox page; the payments service tells billing; ledger rows become paid.
      const key = new URL(full.hostedUrl!).searchParams.get("key");
      await paySandboxInvoice(full.id, key);
      await runBillingJobs();
      const after = await ledger();
      expect(after.filter((r) => r.invoiceId === full.id).map((r) => r.status)).toEqual(["paid", "paid", "paid"]);
      expect(after.find((r) => r.id === b1.fee!.id)?.status).toBe("invoiced");
      // A repeated notification changes nothing.
      expect(await applyInvoicePaymentUpdate(full.id)).toBe(0);

      const summary = await feeSummary(biz.orgId, "test");
      expect(summary).toMatchObject({
        accrued: { count: 1, cents: 3000 },
        invoiced: { count: 0, cents: 0 },
        paid: { count: 3, cents: 9809 },
        terms: { flatCents: 2500, bps: 250 },
      });
      expect(summary.terms.description.length).toBeGreaterThan(0);
    });

    it("a voided invoice releases its fees, and the next run bills them again", async () => {
      const done = await completed(biz.orgId);
      setTestNow("2026-12-02T15:00:00.000Z");
      const first = (await generateMonthlyInvoices()).created[0];
      await voidInvoice(first.invoiceId, { reason: "Synthetic: wrong terms" });
      await runBillingJobs();
      expect((await ledger())[0]).toMatchObject({ id: done.fee!.id, status: "accrued", invoiceId: null });

      const second = (await generateMonthlyInvoices()).created;
      expect(second).toHaveLength(1);
      expect(second[0].invoiceId).not.toBe(first.invoiceId);
      expect((await ledger())[0]).toMatchObject({ status: "invoiced", invoiceId: second[0].invoiceId });
    });

    it("a business without a billing email does not block the others; its draft is sent once the email is added", async () => {
      await completed(biz.orgId);
      await completed(other.orgId);
      const db = await getDb();
      await db.update(schema.businessProfiles).set({ billingEmail: null }).where(eq(schema.businessProfiles.orgId, biz.orgId));
      setTestNow("2026-12-02T15:00:00.000Z");
      const run = await generateMonthlyInvoices();
      expect(run.created).toHaveLength(2);
      expect(run.sent).toHaveLength(1);
      expect(run.failures).toHaveLength(1);
      expect(run.failures[0]).toMatchObject({ businessOrgId: biz.orgId, mode: "test" });
      const draftId = run.failures[0].invoiceId!;
      expect((await getInvoice(biz.orgId, draftId)).status).toBe("draft");

      await db.update(schema.businessProfiles).set({ billingEmail: "billing@synthetic-camp.example" }).where(eq(schema.businessProfiles.orgId, biz.orgId));
      const retry = await generateMonthlyInvoices();
      expect(retry).toMatchObject({ created: [], sent: [draftId], failures: [] });
      expect((await getInvoice(biz.orgId, draftId)).status).toBe("open");
    });

    it("the recurring job logs per-business failures instead of failing the whole run", async () => {
      await completed(biz.orgId);
      const db = await getDb();
      await db.update(schema.businessProfiles).set({ billingEmail: null }).where(eq(schema.businessProfiles.orgId, biz.orgId));
      setTestNow("2026-12-02T15:00:00.000Z");
      const originalError = console.error;
      const logged: unknown[] = [];
      console.error = (...args: unknown[]) => logged.push(args);
      try {
        await expect(jobHandlers[INVOICE_GENERATE_JOB]({}, { jobId: "job_test", attempt: 1 })).resolves.toBeUndefined();
      } finally {
        console.error = originalError;
      }
      expect(logged).toHaveLength(1);
    });

    it("registers the daily invoice run and refuses a malformed payment notification", async () => {
      expect(recurringJobs).toEqual([{ type: INVOICE_GENERATE_JOB, everyMs: INVOICE_GENERATE_EVERY_MS }]);
      expect(INVOICE_GENERATE_EVERY_MS).toBe(86_400_000);
      await expect(jobHandlers["invoice.payment_updated"]({}, { jobId: "job_test", attempt: 1 })).rejects.toThrow();
      await expect(jobHandlers["invoice.payment_updated"]({ invoiceId: 42 }, { jobId: "job_test", attempt: 1 })).rejects.toThrow();
      expect(await codeOf(applyInvoicePaymentUpdate("inv_missing"))).toBe("not_found");
    });
  });

  describe("read models and tenant isolation", () => {
    it("a business sees only its own invoices and fees", async () => {
      await completed(biz.orgId);
      await completed(other.orgId);
      setTestNow("2026-12-02T15:00:00.000Z");
      const run = await generateMonthlyInvoices();
      const otherInvoice = run.created.find((c) => c.businessOrgId === other.orgId)!;

      const mine = await listInvoices(biz.orgId, { mode: "test" });
      expect(mine).toHaveLength(1);
      expect(mine[0].businessOrgId).toBe(biz.orgId);
      expect(await listInvoices(biz.orgId, { mode: "live" })).toHaveLength(0);
      expect(await codeOf(getInvoice(biz.orgId, otherInvoice.invoiceId))).toBe("not_found");
      expect(await codeOf(listInvoices(biz.orgId, { mode: "prod" as "test" }))).toBe("validation_failed");

      const fees = await listSuccessFees(biz.orgId, { mode: "test" });
      expect(fees).toHaveLength(1);
      expect(fees.every((f) => f.payerOrgId === biz.orgId)).toBe(true);
      expect(await listSuccessFees(biz.orgId, { mode: "test", status: "accrued" })).toHaveLength(0);
      expect(await listSuccessFees(biz.orgId, { mode: "live" })).toHaveLength(0);
      expect((await feeSummary(other.orgId, "test")).invoiced).toEqual({ count: 1, cents: 1000 });
    });
  });

  describe("invariants: the business pays, never the family, never from the scholarship", () => {
    it("every invoice is owed by an organization of type business and names no family, student or award", async () => {
      const done = await completed(biz.orgId);
      setTestNow("2026-12-02T15:00:00.000Z");
      await generateMonthlyInvoices();
      const db = await getDb();
      const invoices = await db.select().from(schema.businessInvoices);
      expect(invoices.length).toBeGreaterThan(0);
      for (const inv of invoices) {
        const [org] = await db.select({ type: schema.organizations.type }).from(schema.organizations).where(eq(schema.organizations.id, inv.businessOrgId));
        expect(org.type).toBe("business");
      }
      const lines = await db.select().from(schema.businessInvoiceLines);
      const text = JSON.stringify({ invoices, lines });
      expect(text).not.toContain("example.com"); // the family's email
      expect(text).not.toContain("Riley");
      expect(text).not.toContain(done.award.id);
      for (const row of await ledger()) {
        expect(row).toMatchObject({ kind: "business_success_fee", payerOrgId: biz.orgId, donationId: null, paymentId: null });
      }
    });

    it("the fee is never netted from the scholarship: the award amount is untouched by accrual, invoicing and payment", async () => {
      const done = await completed(biz.orgId, 60_000, 40_000);
      setTestNow("2026-12-02T15:00:00.000Z");
      const run = await generateMonthlyInvoices();
      const inv = await getInvoice(biz.orgId, run.created[0].invoiceId);
      await paySandboxInvoice(inv.id, new URL(inv.hostedUrl!).searchParams.get("key"));
      await runBillingJobs();
      const db = await getDb();
      const [award] = await db.select().from(schema.awards).where(eq(schema.awards.id, done.award.id));
      expect(award.amountCents).toBe(40_000);
      expect(inv.totalCents).toBe(4000);
    });

    it("the billing source reads no household, family contact, donation, award or scholarship-payment data", () => {
      const dir = join(process.cwd(), "src/server/billing");
      const forbidden = [
        /schema\.(households|householdMembers|verifications|donations|donors|payments|awards|checkoutSessions|acknowledgments|consents|documents|incomeItems)\b/,
        /\b(familyEmail|applicantEmail|studentFirstName|studentLastName|householdId|donationId|paymentId|awardId|verificationId)\b/,
        /@\/server\/(households|donations|awards|verifications|documents|rails|consents|acknowledgments)\b/,
      ];
      const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
      expect(files.length).toBeGreaterThanOrEqual(5);
      for (const file of files) {
        const code = readFileSync(join(dir, file), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        for (const pattern of forbidden) expect({ file, match: code.match(pattern)?.[0] ?? null }).toEqual({ file, match: null });
      }
    });
  });
});
