import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { parseCsv } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { useTestDb } from "../../../tests/helpers/db";
import { accrueDonationFees, listFeeLedger, listFeesForDonations, sgoFeeStatement, voidDonationFees, type FeeAccrualDonation } from "./index";

/* Synthetic organizations and amounts. */

const NOW = new Date("2027-02-10T15:00:00.000Z");

describe("fee ledger", () => {
  const t = useTestDb();
  let orgId: string;
  let otherOrgId: string;

  async function org(name: string): Promise<string> {
    const id = newId("org");
    await t.db.insert(schema.organizations).values({ id, type: "sgo", name, slug: `synthetic-${id.toLowerCase()}` });
    return id;
  }

  function donation(overrides: Partial<FeeAccrualDonation> = {}): FeeAccrualDonation {
    return {
      id: newId("donation"),
      orgId,
      mode: "test",
      paymentId: newId("payment"),
      designatedAmountCents: 170_000,
      nonDesignatedAmountCents: 0,
      feeStructure: "none",
      platformFeeCents: 0,
      donorServiceFeeCents: 0,
      ...overrides,
    };
  }

  beforeEach(async () => {
    setTestNow(NOW);
    orgId = await org("Synthetic Scholarship Fund");
    otherOrgId = await org("Other Synthetic Fund");
  });
  afterEach(() => setTestNow(null));

  describe("accrueDonationFees", () => {
    it("writes nothing and returns nothing while the structure is none", async () => {
      expect(await accrueDonationFees(donation(), { structure: "none", sgoFeeBps: 0, donorServiceFeeBps: 0 })).toEqual([]);
      expect(await t.db.select().from(schema.feeLedger)).toHaveLength(0);
    });

    it("refuses a donation that carries a fee its structure does not allow", async () => {
      await expect(accrueDonationFees(donation({ platformFeeCents: 1 }), { structure: "none", sgoFeeBps: 0, donorServiceFeeBps: 0 })).rejects.toBeInstanceOf(AppError);
      await expect(accrueDonationFees(donation({ feeStructure: "sgo_invoiced", donorServiceFeeCents: 5 }), { structure: "sgo_invoiced", sgoFeeBps: 100, donorServiceFeeBps: 0 })).rejects.toBeInstanceOf(AppError);
      await expect(accrueDonationFees(donation({ feeStructure: "sgo_invoiced" }), { structure: "donor_service_fee", sgoFeeBps: 0, donorServiceFeeBps: 100 })).rejects.toThrow(/made under fee structure/);
      await expect(accrueDonationFees(donation({ platformFeeCents: -1, feeStructure: "sgo_invoiced" }), { structure: "sgo_invoiced", sgoFeeBps: 100, donorServiceFeeBps: 0 })).rejects.toBeInstanceOf(AppError);
      await expect(accrueDonationFees(donation(), { structure: "free" as "none", sgoFeeBps: 0, donorServiceFeeBps: 0 })).rejects.toMatchObject({ code: "validation_failed" });
      expect(await t.db.select().from(schema.feeLedger)).toHaveLength(0);
    });

    it("accrues an SGO platform fee once per donation, however often it is called", async () => {
      const d = donation({ feeStructure: "sgo_invoiced", platformFeeCents: 2_550 });
      const terms = { structure: "sgo_invoiced" as const, sgoFeeBps: 150, donorServiceFeeBps: 0 };
      const first = await accrueDonationFees(d, terms);
      const second = await accrueDonationFees([d], terms);
      expect(first).toEqual(second);
      expect(first).toMatchObject([{ kind: "sgo_platform_fee", status: "accrued", amountCents: 2_550, payerOrgId: orgId, donationId: d.id, paymentId: d.paymentId, feeStructure: "sgo_invoiced", feeBps: 150, baseCents: 170_000, mode: "test" }]);
      expect(first[0].description).toMatch(/outside the section 25F account/);
      expect(await t.db.select().from(schema.feeLedger)).toHaveLength(1);
    });

    it("accrues a donor service fee as its own row, and skips a zero fee", async () => {
      const paid = donation({ feeStructure: "donor_service_fee", donorServiceFeeCents: 1_700 });
      const zero = donation({ feeStructure: "donor_service_fee", donorServiceFeeCents: 0 });
      const rows = await accrueDonationFees([paid, zero], { structure: "donor_service_fee", sgoFeeBps: 0, donorServiceFeeBps: 100 });
      expect(rows).toMatchObject([{ kind: "donor_service_fee", amountCents: 1_700, donationId: paid.id }]);
      expect(await listFeesForDonations([paid.id, zero.id])).toHaveLength(1);
      expect(await listFeesForDonations([])).toEqual([]);
    });
  });

  describe("voidDonationFees", () => {
    it("voids accrued rows and leaves invoiced or paid ones for billing to credit", async () => {
      const a = donation({ feeStructure: "sgo_invoiced", platformFeeCents: 100 });
      const b = donation({ feeStructure: "sgo_invoiced", platformFeeCents: 200 });
      const terms = { structure: "sgo_invoiced" as const, sgoFeeBps: 100, donorServiceFeeBps: 0 };
      await accrueDonationFees([a, b], terms);
      await t.db.update(schema.feeLedger).set({ status: "invoiced" }).where(eq(schema.feeLedger.donationId, b.id));
      const result = await voidDonationFees([a.id, b.id], "Refunded (synthetic)");
      expect(result.voided).toMatchObject([{ donationId: a.id, status: "void", voidReason: "Refunded (synthetic)", voidedAt: NOW }]);
      expect(result.notVoidable).toMatchObject([{ donationId: b.id, status: "invoiced" }]);
      expect((await voidDonationFees([a.id], "again")).voided).toEqual([]);
      await expect(voidDonationFees([a.id], " ")).rejects.toMatchObject({ code: "bad_request" });
      expect(await voidDonationFees([], "nothing")).toEqual({ voided: [], notVoidable: [] });
    });
  });

  describe("listFeeLedger", () => {
    it("lists one payer's rows newest first with filters and cursor paging", async () => {
      const terms = { structure: "sgo_invoiced" as const, sgoFeeBps: 100, donorServiceFeeBps: 0 };
      for (let i = 0; i < 3; i++) {
        setTestNow(new Date(NOW.getTime() + i * 60_000));
        await accrueDonationFees(donation({ feeStructure: "sgo_invoiced", platformFeeCents: 100 + i }), terms);
      }
      await accrueDonationFees(donation({ orgId: otherOrgId, feeStructure: "sgo_invoiced", platformFeeCents: 999 }), terms);
      await accrueDonationFees(donation({ mode: "live", feeStructure: "sgo_invoiced", platformFeeCents: 777 }), terms);

      const first = await listFeeLedger(orgId, { mode: "test", limit: 2 });
      expect(first.items.map((r) => r.amountCents)).toEqual([102, 101]);
      const second = await listFeeLedger(orgId, { mode: "test", limit: 2, cursor: first.nextCursor });
      expect(second.items.map((r) => r.amountCents)).toEqual([100]);
      expect(second.nextCursor).toBeNull();
      expect((await listFeeLedger(orgId, { mode: "live" })).items.map((r) => r.amountCents)).toEqual([777]);
      expect((await listFeeLedger(orgId, { mode: "test", kind: "donor_service_fee" })).items).toEqual([]);
      expect((await listFeeLedger(orgId, { mode: "test", from: new Date(NOW.getTime() + 60_000) })).items).toHaveLength(2);
      await expect(listFeeLedger(orgId, { mode: "test", cursor: "nope" })).rejects.toMatchObject({ code: "bad_request" });
      await expect(listFeeLedger("", { mode: "test" })).rejects.toMatchObject({ code: "bad_request" });
      await expect(listFeeLedger(orgId, { mode: "test", limit: 0 })).rejects.toMatchObject({ code: "validation_failed" });
    });
  });

  describe("sgoFeeStatement", () => {
    it("totals one SGO's platform fees for a period by status, with a CSV for invoicing", async () => {
      const terms = { structure: "sgo_invoiced" as const, sgoFeeBps: 100, donorServiceFeeBps: 0 };
      const rows = [donation({ feeStructure: "sgo_invoiced", platformFeeCents: 1_000 }), donation({ feeStructure: "sgo_invoiced", platformFeeCents: 2_000 }), donation({ feeStructure: "sgo_invoiced", platformFeeCents: 4_000 })];
      await accrueDonationFees(rows, terms);
      await t.db.update(schema.feeLedger).set({ status: "invoiced" }).where(eq(schema.feeLedger.donationId, rows[1].id));
      await voidDonationFees([rows[2].id], "Refunded (synthetic)");
      // Outside the statement: another SGO, a donor service fee, and a fee after the period.
      await accrueDonationFees(donation({ orgId: otherOrgId, feeStructure: "sgo_invoiced", platformFeeCents: 9_000 }), terms);
      await accrueDonationFees(donation({ feeStructure: "donor_service_fee", donorServiceFeeCents: 500 }), { structure: "donor_service_fee", sgoFeeBps: 0, donorServiceFeeBps: 100 });
      setTestNow(new Date("2027-03-01T06:00:00.000Z"));
      await accrueDonationFees(donation({ feeStructure: "sgo_invoiced", platformFeeCents: 8_000 }), terms);

      const statement = await sgoFeeStatement(orgId, { mode: "test", from: new Date("2027-02-01T06:00:00.000Z"), to: new Date("2027-03-01T06:00:00.000Z") });
      expect(statement.rows).toHaveLength(3);
      expect(statement.totals).toEqual({ accruedCents: 1_000, invoicedCents: 2_000, paidCents: 0, waivedCents: 0, voidCents: 4_000, billableCents: 1_000, owedCents: 3_000 });
      expect(statement.note).toMatch(/operating funds outside that account/);
      expect(statement.filename).toBe(`sandbox-sgo-fee-statement-${orgId}-2027-02-01-to-2027-03-01.csv`);
      const [header, ...csvRows] = parseCsv(statement.csv);
      expect(header).toEqual(["fee_id", "created_at", "status", "donation_id", "payment_id", "base_cents", "fee_bps", "amount_cents", "amount_usd", "description"]);
      // Rows created in the same instant are ordered by id; compare as a set.
      expect(csvRows.map((r) => r[7]).sort()).toEqual(["1000", "2000", "4000"]);
      expect(csvRows.find((r) => r[7] === "1000")?.[8]).toBe("$10.00");
    });

    it("validates the period", async () => {
      await expect(sgoFeeStatement(orgId, { mode: "test", from: NOW, to: NOW })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(sgoFeeStatement(orgId, { mode: "test", from: new Date("x"), to: NOW })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(sgoFeeStatement("", { mode: "test", from: new Date(0), to: NOW })).rejects.toMatchObject({ code: "bad_request" });
      const empty = await sgoFeeStatement(orgId, { mode: "live", from: new Date(0), to: NOW });
      expect(empty.totals.owedCents).toBe(0);
      expect(parseCsv(empty.csv)).toHaveLength(1);
    });
  });
});
