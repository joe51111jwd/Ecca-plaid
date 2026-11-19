import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { InvoiceStatus, Mode } from "@/db/schema";
import { invalid } from "@/lib/errors";
import { describeFeeTerms, getBusinessProfile } from "@/server/businesses";
import { getBusinessInvoice, listBusinessInvoices, type BusinessInvoice } from "@/server/payments";
import type { FeeLedgerRow } from "./fees";

/**
 * Read models for the business portal's billing screens. Org-scoped reads: callers guard access first
 * (requireOrgMember for the business). Every query filters on the business AND the mode.
 */

function assertMode(mode: unknown): asserts mode is Mode {
  if (mode !== "test" && mode !== "live") throw invalid("mode must be test or live");
}

export type InvoiceSummary = Awaited<ReturnType<typeof listBusinessInvoices>>[number];

/** The business's invoices, newest first. */
export async function listInvoices(businessOrgId: string, params: { mode: Mode; status?: InvoiceStatus; limit?: number }, dbOrTx?: DbOrTx): Promise<InvoiceSummary[]> {
  assertMode(params.mode);
  return listBusinessInvoices({ businessOrgId, mode: params.mode, status: params.status, limit: params.limit }, dbOrTx);
}

/** One invoice with its lines; `not_found` when it belongs to another business. */
export async function getInvoice(businessOrgId: string, invoiceId: string, dbOrTx?: DbOrTx): Promise<BusinessInvoice> {
  return getBusinessInvoice(invoiceId, { businessOrgId }, dbOrTx);
}

/** The business's success-fee ledger rows, newest first. */
export async function listSuccessFees(businessOrgId: string, params: { mode: Mode; status?: FeeLedgerRow["status"]; limit?: number }, dbOrTx?: DbOrTx): Promise<FeeLedgerRow[]> {
  assertMode(params.mode);
  const limit = Math.min(200, Math.max(1, Math.trunc(params.limit ?? 50) || 50));
  const db = dbOrTx ?? (await getDb());
  const fl = schema.feeLedger;
  return db
    .select()
    .from(fl)
    .where(and(eq(fl.payerOrgId, businessOrgId), eq(fl.kind, "business_success_fee"), eq(fl.mode, params.mode), params.status ? eq(fl.status, params.status) : undefined))
    .orderBy(desc(fl.createdAt), desc(fl.id))
    .limit(limit);
}

export interface FeeSummary {
  mode: Mode;
  terms: { flatCents: number; bps: number; description: string };
  accrued: { count: number; cents: number };
  invoiced: { count: number; cents: number };
  paid: { count: number; cents: number };
}

/** Totals of the business's success fees by state, and its current fee terms in plain words. */
export async function feeSummary(businessOrgId: string, mode: Mode, dbOrTx?: DbOrTx): Promise<FeeSummary> {
  assertMode(mode);
  const db = dbOrTx ?? (await getDb());
  const { profile } = await getBusinessProfile(businessOrgId, db);
  const fl = schema.feeLedger;
  const rows = await db
    .select({ status: fl.status, count: sql<number>`count(*)::int`, cents: sql<string>`coalesce(sum(${fl.amountCents}), 0)::text` })
    .from(fl)
    .where(and(eq(fl.payerOrgId, businessOrgId), eq(fl.kind, "business_success_fee"), eq(fl.mode, mode)))
    .groupBy(fl.status);
  const pick = (status: FeeLedgerRow["status"]) => {
    const r = rows.find((x) => x.status === status);
    return { count: Number(r?.count ?? 0), cents: Number(r?.cents ?? 0) };
  };
  return {
    mode,
    terms: { flatCents: profile.successFeeFlatCents, bps: profile.successFeeBps, description: describeFeeTerms(profile) },
    accrued: pick("accrued"),
    invoiced: pick("invoiced"),
    paid: pick("paid"),
  };
}
