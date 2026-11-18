import { and, desc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { now } from "@/lib/clock";
import { toCsv } from "@/lib/csv";
import { AppError, badRequest, invalid } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { formatUsd } from "@/lib/money";
import { renderCopy, type FeeStructure } from "@/taxmath";

/**
 * The fee ledger: every fee the platform is owed on a donor gift (this module) or on a business booking (the
 * businesses domain writes those rows). This file is the domain's public API.
 *
 * Money rules (docs/architecture.md): a fee is never taken out of the designated amount and never paid from the
 * section 25F account. This module only ever writes `fee_ledger` rows; it never reads or changes a donation's
 * amounts. Under the "none" structure (the default until counsel's memo is on file) nothing is written at all.
 *
 *  - sgo_platform_fee:  structure "sgo_invoiced". Owed by the SGO, invoiced separately, payable from operating funds.
 *  - donor_service_fee: structure "donor_service_fee". Paid by the donor on top of the gift, as its own line.
 */

const { feeLedger } = schema;

export type FeeLedgerRow = typeof feeLedger.$inferSelect;
export type FeeKind = FeeLedgerRow["kind"];
export type FeeStatus = FeeLedgerRow["status"];

/** The donation fields an accrual reads. The fee amounts were fixed when the order was placed. */
export interface FeeAccrualDonation {
  id: string;
  orgId: string;
  mode: Mode;
  paymentId: string | null;
  designatedAmountCents: number;
  nonDesignatedAmountCents: number;
  feeStructure: FeeStructure;
  platformFeeCents: number;
  donorServiceFeeCents: number;
}

/** The fee terms the gift was made under (the `fees.structure` setting as it stood when the order was placed). */
export interface FeeTerms {
  structure: FeeStructure;
  sgoFeeBps: number;
  donorServiceFeeBps: number;
}

const termsSchema = z.strictObject({
  structure: z.enum(["none", "sgo_invoiced", "donor_service_fee"]),
  sgoFeeBps: z.number().int().min(0).max(10_000),
  donorServiceFeeBps: z.number().int().min(0).max(10_000),
});

const centsSchema = z.number().int().min(0);
const donationSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  mode: z.enum(["test", "live"]),
  paymentId: z.string().min(1).nullable(),
  designatedAmountCents: centsSchema,
  nonDesignatedAmountCents: centsSchema,
  feeStructure: z.enum(["none", "sgo_invoiced", "donor_service_fee"]),
  platformFeeCents: centsSchema,
  donorServiceFeeCents: centsSchema,
});

/**
 * Writes the fee rows owed on succeeded donations, per the structure the gifts were made under. Idempotent: one
 * row per donation and fee kind, so a retried job writes nothing twice. Returns every fee row of these donations.
 * Under "none" nothing is written and an empty list is returned.
 */
export async function accrueDonationFees(donations: FeeAccrualDonation | readonly FeeAccrualDonation[], terms: FeeTerms, dbOrTx?: DbOrTx): Promise<FeeLedgerRow[]> {
  const list = (Array.isArray(donations) ? donations : [donations]) as readonly FeeAccrualDonation[];
  const parsedTerms = termsSchema.safeParse(terms);
  if (!parsedTerms.success) throw invalid("Invalid fee terms", { fields: Object.fromEntries(parsedTerms.error.issues.map((i) => [i.path.join(".") || "terms", i.message])) });
  const { structure } = parsedTerms.data;

  const rows: Array<typeof feeLedger.$inferInsert> = [];
  for (const raw of list) {
    const parsed = donationSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("internal", `Donation ${raw?.id ?? "?"} cannot accrue fees: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    const d = parsed.data;
    if (d.feeStructure !== structure) throw new AppError("internal", `Donation ${d.id} was made under fee structure "${d.feeStructure}", not "${structure}"`);
    // Each structure owes at most one kind of fee; anything else is a corrupted order, not something to bill.
    if (structure !== "sgo_invoiced" && d.platformFeeCents !== 0) throw new AppError("internal", `Donation ${d.id} carries an SGO fee under "${structure}"`);
    if (structure !== "donor_service_fee" && d.donorServiceFeeCents !== 0) throw new AppError("internal", `Donation ${d.id} carries a donor service fee under "${structure}"`);
    const base = d.designatedAmountCents + d.nonDesignatedAmountCents;
    const at = now();
    if (structure === "sgo_invoiced" && d.platformFeeCents > 0) {
      rows.push({
        id: newId("fee"),
        payerOrgId: d.orgId,
        kind: "sgo_platform_fee",
        mode: d.mode,
        amountCents: d.platformFeeCents,
        status: "accrued",
        donationId: d.id,
        paymentId: d.paymentId,
        feeStructure: structure,
        feeBps: parsedTerms.data.sgoFeeBps,
        baseCents: base,
        description: "Platform fee on a donor gift, invoiced to the organization separately and payable from operating funds outside the section 25F account.",
        createdAt: at,
      });
    }
    if (structure === "donor_service_fee" && d.donorServiceFeeCents > 0) {
      rows.push({
        id: newId("fee"),
        payerOrgId: d.orgId,
        kind: "donor_service_fee",
        mode: d.mode,
        amountCents: d.donorServiceFeeCents,
        status: "accrued",
        donationId: d.id,
        paymentId: d.paymentId,
        feeStructure: structure,
        feeBps: parsedTerms.data.donorServiceFeeBps,
        baseCents: base,
        description: "Service fee the donor paid on top of the gift, as a separate line. Not part of the contribution.",
        createdAt: at,
      });
    }
  }
  if (list.length === 0) return [];
  const db = dbOrTx ?? (await getDb());
  if (rows.length > 0) await db.insert(feeLedger).values(rows).onConflictDoNothing({ target: [feeLedger.donationId, feeLedger.kind] });
  return db
    .select()
    .from(feeLedger)
    .where(inArray(feeLedger.donationId, list.map((d) => d.id)))
    .orderBy(feeLedger.createdAt, feeLedger.id);
}

export interface VoidFeesResult {
  voided: FeeLedgerRow[];
  /** Rows already invoiced or paid: left as they are for billing to credit. */
  notVoidable: FeeLedgerRow[];
}

/** Voids the accrued (not yet invoiced) fee rows of donations whose money was returned. */
export async function voidDonationFees(donationIds: readonly string[], reason: string, dbOrTx?: DbOrTx): Promise<VoidFeesResult> {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length === 0 || why.length > 500) throw badRequest("A reason of 1 to 500 characters is required to void fees");
  if (donationIds.length === 0) return { voided: [], notVoidable: [] };
  const db = dbOrTx ?? (await getDb());
  const voided = await db
    .update(feeLedger)
    .set({ status: "void", voidedAt: now(), voidReason: why })
    .where(and(inArray(feeLedger.donationId, [...donationIds]), eq(feeLedger.status, "accrued")))
    .returning();
  const notVoidable = await db
    .select()
    .from(feeLedger)
    .where(and(inArray(feeLedger.donationId, [...donationIds]), inArray(feeLedger.status, ["invoiced", "paid"])));
  return { voided, notVoidable };
}

/* ------------------------------------------------------------------ reads */

/** The fee rows of the given donations, oldest first. Callers scope the donation ids to an organization first. */
export async function listFeesForDonations(donationIds: readonly string[], dbOrTx?: DbOrTx): Promise<FeeLedgerRow[]> {
  if (donationIds.length === 0) return [];
  const db = dbOrTx ?? (await getDb());
  return db.select().from(feeLedger).where(inArray(feeLedger.donationId, [...donationIds])).orderBy(feeLedger.createdAt, feeLedger.id);
}

export interface ListFeeLedgerParams {
  mode: Mode;
  kind?: FeeKind;
  status?: FeeStatus;
  /** Created at or after. */
  from?: Date;
  /** Created before. */
  to?: Date;
  limit?: number;
  cursor?: string | null;
}

export interface FeeLedgerPage {
  items: FeeLedgerRow[];
  nextCursor: string | null;
}

const listSchema = z.strictObject({
  mode: z.enum(["test", "live"]),
  kind: z.enum(["sgo_platform_fee", "donor_service_fee", "business_success_fee"]).optional(),
  status: z.enum(["accrued", "invoiced", "paid", "waived", "void"]).optional(),
  from: z.date().optional(),
  to: z.date().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().max(200).nullish(),
});

function encodeCursor(row: Pick<FeeLedgerRow, "createdAt" | "id">): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) throw badRequest("Invalid cursor");
  return { createdAt, id };
}

/** Fee rows owed by one organization, newest first. Org-scoped: the caller has checked access. */
export async function listFeeLedger(payerOrgId: string, params: ListFeeLedgerParams, dbOrTx?: DbOrTx): Promise<FeeLedgerPage> {
  if (typeof payerOrgId !== "string" || payerOrgId.length === 0) throw badRequest("An organization is required");
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) throw invalid("Check the fee ledger filters.", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "params", i.message])) });
  const p = parsed.data;
  const where: SQL[] = [eq(feeLedger.payerOrgId, payerOrgId), eq(feeLedger.mode, p.mode)];
  if (p.kind) where.push(eq(feeLedger.kind, p.kind));
  if (p.status) where.push(eq(feeLedger.status, p.status));
  if (p.from) where.push(gte(feeLedger.createdAt, p.from));
  if (p.to) where.push(lt(feeLedger.createdAt, p.to));
  if (p.cursor) {
    const c = decodeCursor(p.cursor);
    where.push(or(lt(feeLedger.createdAt, c.createdAt), and(eq(feeLedger.createdAt, c.createdAt), lt(feeLedger.id, c.id))) as SQL);
  }
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select()
    .from(feeLedger)
    .where(and(...where))
    .orderBy(desc(feeLedger.createdAt), desc(feeLedger.id))
    .limit(p.limit + 1);
  const items = rows.slice(0, p.limit);
  return { items, nextCursor: rows.length > p.limit ? encodeCursor(items[items.length - 1]) : null };
}

export interface SgoFeeStatementTotals {
  accruedCents: number;
  invoicedCents: number;
  paidCents: number;
  waivedCents: number;
  voidCents: number;
  /** Accrued and not yet invoiced: what a new invoice for this period would bill. */
  billableCents: number;
  /** Everything owed for the period: accrued + invoiced + paid. */
  owedCents: number;
}

export interface SgoFeeStatement {
  orgId: string;
  mode: Mode;
  period: { from: string; to: string };
  rows: FeeLedgerRow[];
  totals: SgoFeeStatementTotals;
  /** How the fee is paid, from the taxmath copy registry (structure "sgo_invoiced"). */
  note: string;
  filename: string;
  csv: string;
}

export const SGO_FEE_STATEMENT_COLUMNS = ["fee_id", "created_at", "status", "donation_id", "payment_id", "base_cents", "fee_bps", "amount_cents", "amount_usd", "description"] as const;

const statementSchema = z.strictObject({ mode: z.enum(["test", "live"]), from: z.date(), to: z.date() });

/**
 * The SGO platform fees for a period (created in [from, to)), with totals and a CSV, for invoicing the SGO from
 * its operating funds outside the section 25F account. Org-scoped: the caller has checked access.
 */
export async function sgoFeeStatement(orgId: string, period: { mode: Mode; from: Date; to: Date }, dbOrTx?: DbOrTx): Promise<SgoFeeStatement> {
  if (typeof orgId !== "string" || orgId.length === 0) throw badRequest("An organization is required");
  const parsed = statementSchema.safeParse(period);
  if (!parsed.success || Number.isNaN(parsed.data.from.getTime()) || Number.isNaN(parsed.data.to.getTime())) throw invalid("Give the statement period as two dates.", { fields: { period: "Required." } });
  const { mode, from, to } = parsed.data;
  if (from.getTime() >= to.getTime()) throw invalid("The period must end after it starts.", { fields: { to: "Must be after the start." } });
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select()
    .from(feeLedger)
    .where(and(eq(feeLedger.payerOrgId, orgId), eq(feeLedger.mode, mode), eq(feeLedger.kind, "sgo_platform_fee"), gte(feeLedger.createdAt, from), lt(feeLedger.createdAt, to)))
    .orderBy(feeLedger.createdAt, feeLedger.id);
  const sum = (status: FeeStatus) => rows.filter((r) => r.status === status).reduce((total, r) => total + r.amountCents, 0);
  const totals: SgoFeeStatementTotals = {
    accruedCents: sum("accrued"),
    invoicedCents: sum("invoiced"),
    paidCents: sum("paid"),
    waivedCents: sum("waived"),
    voidCents: sum("void"),
    billableCents: sum("accrued"),
    owedCents: sum("accrued") + sum("invoiced") + sum("paid"),
  };
  const csv = toCsv(
    [...SGO_FEE_STATEMENT_COLUMNS],
    rows.map((r) => ({
      fee_id: r.id,
      created_at: r.createdAt.toISOString(),
      status: r.status,
      donation_id: r.donationId,
      payment_id: r.paymentId,
      base_cents: r.baseCents,
      fee_bps: r.feeBps,
      amount_cents: r.amountCents,
      amount_usd: formatUsd(r.amountCents, { cents: true }),
      description: r.description,
    })),
  );
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  return {
    orgId,
    mode,
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    totals,
    note: renderCopy("fee.sgo_invoiced.sgo", { platformName: BRAND.name }),
    filename: `${mode === "test" ? "sandbox-" : ""}sgo-fee-statement-${orgId}-${fromIso}-to-${toIso}.csv`,
    csv,
  };
}
