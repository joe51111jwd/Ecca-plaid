import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Mode } from "@/db/schema";
import { centralDateString, now } from "@/lib/clock";
import { AppError, isAppError } from "@/lib/errors";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { createBusinessInvoice, getBusinessInvoice, paymentsPolicy, sendInvoice } from "@/server/payments";

/**
 * Monthly invoicing of success fees, and keeping the fee ledger in step with what happens to an invoice.
 *
 *   fee_ledger: accrued ──invoice.generate──▶ invoiced ──invoice paid──▶ paid
 *                  ▲                              │
 *                  └──────── invoice voided ──────┘   (billed again on the next run)
 *
 * The payer is always the business organization: every line is a business_success_fee row owed by that business.
 * No family, household, donation, award or scholarship payment is read or referenced here.
 */

export interface InvoiceRunFailure {
  businessOrgId: string;
  mode: Mode;
  invoiceId: string | null;
  message: string;
}

export interface InvoiceRunResult {
  /** Billing period end used for this run (the last day of the previous month, US Central). */
  periodEnd: string;
  created: Array<{ invoiceId: string; businessOrgId: string; mode: Mode; totalCents: number; lineCount: number }>;
  sent: string[];
  failures: InvoiceRunFailure[];
}

/** First day of the month of a YYYY-MM-DD date. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The day before a YYYY-MM-DD date. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return prev.toISOString().slice(0, 10);
}

/**
 * Bills every success fee accrued before the current calendar month (US Central), one invoice per business and
 * mode, one line per completed booking, then sends the invoices. Safe to run daily (it is scheduled daily and
 * acts once per month's fees): accrued rows become invoiced in the transaction that creates their invoice, and a
 * draft that could not be sent (for example, no billing email yet) is sent by a later run.
 *
 * Failures for one business never block the others; they are returned and logged.
 */
export async function generateMonthlyInvoices(): Promise<InvoiceRunResult> {
  const db = await getDb();
  const currentMonth = monthStart(centralDateString(now()));
  const periodEnd = dayBefore(currentMonth);
  const result: InvoiceRunResult = { periodEnd, created: [], sent: [], failures: [] };
  const fl = schema.feeLedger;

  const accrued = await db
    .select({ id: fl.id, payerOrgId: fl.payerOrgId, mode: fl.mode, createdAt: fl.createdAt })
    .from(fl)
    .where(and(eq(fl.kind, "business_success_fee"), eq(fl.status, "accrued"), isNotNull(fl.payerOrgId)))
    .orderBy(asc(fl.createdAt), asc(fl.id));

  const groups = new Map<string, { businessOrgId: string; mode: Mode; ids: string[] }>();
  for (const row of accrued) {
    if (!row.payerOrgId || centralDateString(row.createdAt) >= currentMonth) continue;
    const key = `${row.payerOrgId}:${row.mode}`;
    const g = groups.get(key) ?? { businessOrgId: row.payerOrgId, mode: row.mode, ids: [] };
    g.ids.push(row.id);
    groups.set(key, g);
  }

  for (const group of groups.values()) {
    for (let i = 0; i < group.ids.length; i += paymentsPolicy.MAX_INVOICE_LINES) {
      const ids = group.ids.slice(i, i + paymentsPolicy.MAX_INVOICE_LINES);
      try {
        const created = await invoiceFees(group.businessOrgId, group.mode, ids, currentMonth, periodEnd);
        if (created) result.created.push(created);
      } catch (e) {
        result.failures.push({ businessOrgId: group.businessOrgId, mode: group.mode, invoiceId: null, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Send every billing draft: the ones just created and any an earlier run could not send.
  const drafts = await db
    .selectDistinct({ id: schema.businessInvoices.id, businessOrgId: schema.businessInvoices.businessOrgId, mode: schema.businessInvoices.mode })
    .from(schema.businessInvoices)
    .innerJoin(fl, eq(fl.invoiceId, schema.businessInvoices.id))
    .where(and(eq(schema.businessInvoices.status, "draft"), eq(fl.kind, "business_success_fee"), eq(fl.status, "invoiced")));
  for (const draft of drafts) {
    try {
      await sendInvoice(draft.id, { businessOrgId: draft.businessOrgId });
      result.sent.push(draft.id);
    } catch (e) {
      result.failures.push({ businessOrgId: draft.businessOrgId, mode: draft.mode, invoiceId: draft.id, message: isAppError(e) ? e.message : e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

async function invoiceFees(businessOrgId: string, mode: Mode, ids: string[], currentMonth: string, periodEnd: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const fl = schema.feeLedger;
    const rows = await tx
      .select({ id: fl.id, amountCents: fl.amountCents, description: fl.description, handoffId: fl.handoffId, createdAt: fl.createdAt, status: fl.status, payerOrgId: fl.payerOrgId, kind: fl.kind, mode: fl.mode })
      .from(fl)
      .where(inArray(fl.id, ids))
      .orderBy(asc(fl.createdAt), asc(fl.id))
      .for("update");
    const billable = rows.filter(
      (r) => r.status === "accrued" && r.kind === "business_success_fee" && r.payerOrgId === businessOrgId && r.mode === mode && r.amountCents > 0 && centralDateString(r.createdAt) < currentMonth,
    );
    if (billable.length === 0) return null;

    const [payer] = await tx.select({ type: schema.organizations.type }).from(schema.organizations).where(eq(schema.organizations.id, businessOrgId)).limit(1);
    if (!payer || payer.type !== "business") throw new AppError("internal", "Success fees can only be invoiced to an organization of type business.");

    const invoice = await createBusinessInvoice(
      {
        businessOrgId,
        mode,
        lines: billable.map((r) => ({ description: r.description ?? "Success fee for a completed booking", amountCents: r.amountCents, feeLedgerId: r.id, handoffId: r.handoffId })),
        periodStart: monthStart(centralDateString(billable[0].createdAt)),
        periodEnd,
      },
      tx,
    );
    await tx
      .update(fl)
      .set({ status: "invoiced", invoiceId: invoice.id })
      .where(
        and(
          inArray(
            fl.id,
            billable.map((r) => r.id),
          ),
          eq(fl.status, "accrued"),
        ),
      );
    return { invoiceId: invoice.id, businessOrgId, mode, totalCents: invoice.totalCents, lineCount: invoice.lines.length };
  });
}

/**
 * Handler body for "invoice.payment_updated" { invoiceId }: a paid invoice marks its fee rows paid; a voided one
 * releases them back to accrued so the next run bills them again. Other statuses change nothing. Idempotent.
 * Returns the number of ledger rows changed.
 */
export async function applyInvoicePaymentUpdate(invoiceId: string): Promise<number> {
  if (typeof invoiceId !== "string" || invoiceId.length === 0) throw new AppError("internal", "invoice.payment_updated needs an invoiceId");
  const invoice = await getBusinessInvoice(invoiceId);
  const db = await getDb();
  const fl = schema.feeLedger;
  return db.transaction(async (tx) => {
    const scope = and(eq(fl.invoiceId, invoice.id), eq(fl.kind, "business_success_fee"), eq(fl.payerOrgId, invoice.businessOrgId));
    let changed: Array<{ id: string }> = [];
    if (invoice.status === "paid") {
      changed = await tx.update(fl).set({ status: "paid" }).where(and(scope, eq(fl.status, "invoiced"))).returning({ id: fl.id });
    } else if (invoice.status === "void") {
      changed = await tx
        .update(fl)
        .set({ status: "accrued", invoiceId: null })
        .where(and(scope, inArray(fl.status, ["invoiced", "accrued"])))
        .returning({ id: fl.id });
    }
    if (changed.length > 0) {
      await audit(
        {
          actor: SYSTEM_ACTOR,
          orgId: invoice.businessOrgId,
          action: invoice.status === "paid" ? "fee.paid" : "fee.released",
          target: { type: "business_invoice", id: invoice.id },
          metadata: { number: invoice.number, feeIds: changed.map((c) => c.id), invoiceStatus: invoice.status },
        },
        tx,
      );
    }
    return changed.length;
  });
}
