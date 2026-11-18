import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { execRows, getDb, schema, type DbOrTx } from "@/db/client";
import type { InvoiceStatus, Mode } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { addMs, centralYear, MS, now } from "@/lib/clock";
import { env } from "@/lib/env";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { formatUsd } from "@/lib/money";
import { audit, SYSTEM_ACTOR, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { queueEmail, renderEmail } from "@/server/email";
import { enqueue } from "@/server/jobs";
import { canInvoiceBecome, changeInvoiceStatus } from "./events";
import { lockKey, type InvoiceLineRow, type InvoiceRow } from "./metadata";
import { DEFAULT_INVOICE_DUE_DAYS, INVOICE_NUMBER_DIGITS, INVOICE_NUMBER_PREFIX, MAX_CHARGE_CENTS, MAX_INVOICE_DUE_DAYS, MAX_INVOICE_LINES } from "./policy";
import { getProcessor, processorFor } from "./processor";

/**
 * Invoices to businesses (camps, schools, vendors) for the platform's success fee.
 *
 * The business is billed on its own account. Nothing here can bill a family, and nothing here touches a
 * scholarship or a donation: an invoice is a list of fee lines owed by one business organization.
 *
 *   draft ──sendInvoice──▶ open ──(processor says paid | operator marks paid)──▶ paid
 *     └────────────────────┴──voidInvoice──▶ void
 */

const { businessInvoices, businessInvoiceLines, businessProfiles, organizations } = schema;

export interface BusinessInvoice extends InvoiceRow {
  lines: InvoiceLineRow[];
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
  return fields;
}

async function linesOf(invoiceId: string, db: DbOrTx): Promise<InvoiceLineRow[]> {
  return db.select().from(businessInvoiceLines).where(eq(businessInvoiceLines.invoiceId, invoiceId)).orderBy(asc(businessInvoiceLines.createdAt), asc(businessInvoiceLines.id));
}

export interface InvoiceScope {
  /** When set, the invoice must belong to this business. Pass it whenever the id came from a browser or an API caller. */
  businessOrgId?: string;
}

async function loadInvoice(invoiceId: string, scope: InvoiceScope | undefined, db: DbOrTx): Promise<InvoiceRow> {
  const [invoice] = await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId));
  if (!invoice || (scope?.businessOrgId !== undefined && invoice.businessOrgId !== scope.businessOrgId)) throw notFound("Invoice");
  return invoice;
}

/* Numbering -------------------------------------------------------------------------------------------- */

/**
 * The next number in the sequence for this mode and year: INV-2026-000123, or INV-TEST-2026-000123 for
 * sandbox invoices (their own sequence, so test data leaves no gaps in the real one). The year is the
 * calendar year in US Central time when the invoice is created.
 *
 * Race-safe: the advisory lock makes concurrent creators take their numbers one after another, and it is
 * held until the caller's transaction ends, so the number is not reused if that transaction commits and is
 * free again if it rolls back. The unique index on `number` backs this up.
 */
async function nextInvoiceNumber(tx: DbOrTx, mode: Mode, at: Date): Promise<string> {
  const prefix = `${INVOICE_NUMBER_PREFIX[mode]}-${centralYear(at)}-`;
  await lockKey(tx, `invoice-number:${prefix}`);
  const rows = await execRows<{ last: string | number | null }>(
    tx,
    sql`select max(substring(${businessInvoices.number} from '[0-9]+$')::bigint) as last from ${businessInvoices} where ${businessInvoices.number} like ${`${prefix}%`}`,
  );
  const next = Number(rows[0]?.last ?? 0) + 1;
  return `${prefix}${String(next).padStart(INVOICE_NUMBER_DIGITS, "0")}`;
}

/* Create ----------------------------------------------------------------------------------------------- */

export interface CreateBusinessInvoiceInput {
  /** The business being billed. Must be an organization of type "business". */
  businessOrgId: string;
  mode: Mode;
  lines: Array<{
    description: string;
    /** Positive integer cents. */
    amountCents: number;
    /** The fee_ledger entry this line bills. A ledger entry can be on only one invoice that is not void. */
    feeLedgerId?: string | null;
    handoffId?: string | null;
  }>;
  /** Billing period, YYYY-MM-DD (inclusive). */
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Who is creating it, for the audit log. Default: the system (a billing job). */
  actor?: AuditActor;
}

const createInput = z
  .object({
    businessOrgId: z.string().min(1).max(100),
    mode: z.enum(["test", "live"]),
    lines: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          amountCents: z.number().int().positive().max(MAX_CHARGE_CENTS),
          feeLedgerId: z.string().min(1).max(100).nullish(),
          handoffId: z.string().min(1).max(100).nullish(),
        }),
      )
      .min(1)
      .max(MAX_INVOICE_LINES),
    periodStart: z.iso.date().nullish(),
    periodEnd: z.iso.date().nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "The period must end on or after the day it starts" });
    }
    const total = value.lines.reduce((sum, l) => sum + l.amountCents, 0);
    if (total > MAX_CHARGE_CENTS) ctx.addIssue({ code: "custom", path: ["lines"], message: "The invoice total is more than can be collected in one payment" });
    const ledgerIds = value.lines.map((l) => l.feeLedgerId).filter(Boolean);
    if (new Set(ledgerIds).size !== ledgerIds.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "A fee can appear on an invoice only once" });
  });

/**
 * Creates a draft invoice with its number and lines. Nothing is sent and nothing is owed until
 * `sendInvoice`. Pass a transaction to create the invoice together with the caller's own bookkeeping
 * (for example marking fee_ledger rows as invoiced).
 */
export async function createBusinessInvoice(input: CreateBusinessInvoiceInput, dbOrTx?: DbOrTx): Promise<BusinessInvoice> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) throw invalid("Invalid invoice", { fields: fieldErrors(parsed.error) });
  const data = parsed.data;
  const db = dbOrTx ?? (await getDb());

  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, data.businessOrgId));
    if (!org || org.type !== "business") throw notFound("Business");

    const ledgerIds = data.lines.flatMap((l) => (l.feeLedgerId ? [l.feeLedgerId] : [])).sort();
    // Sorted, so two invoices that share fees always lock them in the same order.
    for (const id of ledgerIds) await lockKey(tx, `fee-ledger:${id}`);
    if (ledgerIds.length > 0) {
      const billed = await tx
        .select({ feeLedgerId: businessInvoiceLines.feeLedgerId, number: businessInvoices.number })
        .from(businessInvoiceLines)
        .innerJoin(businessInvoices, eq(businessInvoices.id, businessInvoiceLines.invoiceId))
        .where(and(inArray(businessInvoiceLines.feeLedgerId, ledgerIds), ne(businessInvoices.status, "void")));
      if (billed.length > 0) {
        throw conflict(`Already invoiced on ${[...new Set(billed.map((b) => b.number))].join(", ")}`, { feeLedgerIds: billed.map((b) => b.feeLedgerId) });
      }
    }

    const at = now();
    const number = await nextInvoiceNumber(tx, data.mode, at);
    const totalCents = data.lines.reduce((sum, l) => sum + l.amountCents, 0);
    const [invoice] = await tx
      .insert(businessInvoices)
      .values({
        id: newId("invoice"),
        businessOrgId: data.businessOrgId,
        mode: data.mode,
        number,
        status: "draft",
        periodStart: data.periodStart ?? null,
        periodEnd: data.periodEnd ?? null,
        totalCents,
        // Which processor issues it is settled when it is sent; until then this is the configured one.
        processor: env().PAYMENTS_PROVIDER,
        createdAt: at,
      })
      .returning();
    const lines = await tx
      .insert(businessInvoiceLines)
      .values(
        data.lines.map((line, index) => ({
          id: newId("invoiceLine"),
          invoiceId: invoice.id,
          feeLedgerId: line.feeLedgerId ?? null,
          handoffId: line.handoffId ?? null,
          description: line.description,
          amountCents: line.amountCents,
          // One millisecond apart, so the lines read back in the order they were given.
          createdAt: addMs(at, index),
        })),
      )
      .returning();
    await audit(
      {
        actor: input.actor ?? SYSTEM_ACTOR,
        orgId: data.businessOrgId,
        action: "invoice.created",
        target: { type: "business_invoice", id: invoice.id },
        metadata: { number, mode: data.mode, totalCents, lineCount: lines.length },
      },
      tx,
    );
    return { ...invoice, lines: lines.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) };
  });
}

/* Read ------------------------------------------------------------------------------------------------- */

export async function getBusinessInvoice(invoiceId: string, scope?: InvoiceScope, dbOrTx?: DbOrTx): Promise<BusinessInvoice> {
  const db = dbOrTx ?? (await getDb());
  const invoice = await loadInvoice(invoiceId, scope, db);
  return { ...invoice, lines: await linesOf(invoice.id, db) };
}

export interface ListBusinessInvoicesParams {
  businessOrgId: string;
  mode: Mode;
  status?: InvoiceStatus;
  /** 1 to 200, default 50. */
  limit?: number;
}

/** A business's invoices, newest first. */
export async function listBusinessInvoices(params: ListBusinessInvoicesParams, dbOrTx?: DbOrTx): Promise<InvoiceRow[]> {
  const limit = Math.min(200, Math.max(1, Math.trunc(params.limit ?? 50) || 50));
  const db = dbOrTx ?? (await getDb());
  return db
    .select()
    .from(businessInvoices)
    .where(and(eq(businessInvoices.businessOrgId, params.businessOrgId), eq(businessInvoices.mode, params.mode), params.status ? eq(businessInvoices.status, params.status) : undefined))
    .orderBy(desc(businessInvoices.createdAt), desc(businessInvoices.number))
    .limit(limit);
}

/* Send ------------------------------------------------------------------------------------------------- */

export interface SendInvoiceOptions extends InvoiceScope {
  /** Payment terms in days. Default DEFAULT_INVOICE_DUE_DAYS. */
  dueInDays?: number;
  /** Email the business a link to the hosted invoice page (default true). */
  notify?: boolean;
  actor?: AuditActor;
}

const dueDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "long" });

function invoiceEmail(invoice: InvoiceRow, businessName: string, hostedUrl: string, dueAt: Date) {
  const sandbox = invoice.mode === "test";
  const period = invoice.periodStart && invoice.periodEnd ? `${invoice.periodStart} to ${invoice.periodEnd}` : (invoice.periodStart ?? invoice.periodEnd);
  const rendered = renderEmail({
    preheader: `${formatUsd(invoice.totalCents, { cents: true })} due ${dueDateFormat.format(dueAt)}`,
    heading: `Invoice ${invoice.number}`,
    paragraphs: [
      `A new invoice from ${BRAND.name} is ready for ${businessName}.`,
      ...(sandbox ? ["This is a sandbox invoice. No money is owed and no payment will be taken."] : []),
    ],
    details: [
      { label: "Invoice", value: invoice.number },
      { label: "Amount due", value: formatUsd(invoice.totalCents, { cents: true }) },
      { label: "Due", value: dueDateFormat.format(dueAt) },
      ...(period ? [{ label: "Period", value: period }] : []),
    ],
    cta: { label: sandbox ? "View sandbox invoice" : "View and pay invoice", url: hostedUrl },
    footerNote: `Questions about this invoice? Write to ${BRAND.supportEmail}.`,
  });
  return { subject: `${sandbox ? "[Sandbox] " : ""}Invoice ${invoice.number} from ${BRAND.name}`, ...rendered };
}

/**
 * Issues a draft invoice: creates and finalizes it at the processor, stores the hosted page and the due
 * date, moves it to `open` and (unless `notify` is false) emails the business the link. Calling it again
 * for an invoice that is already open returns it unchanged.
 */
export async function sendInvoice(invoiceId: string, options: SendInvoiceOptions = {}): Promise<BusinessInvoice> {
  const dueInDays = options.dueInDays ?? DEFAULT_INVOICE_DUE_DAYS;
  if (!Number.isInteger(dueInDays) || dueInDays < 1 || dueInDays > MAX_INVOICE_DUE_DAYS) throw invalid(`Payment terms must be between 1 and ${MAX_INVOICE_DUE_DAYS} days`);

  const db = await getDb();
  const draft = await loadInvoice(invoiceId, options, db);
  if (draft.status === "open" && draft.processorInvoiceId) return { ...draft, lines: await linesOf(draft.id, db) };
  if (draft.status !== "draft") throw conflict(`An invoice that is ${draft.status} cannot be sent`);

  const processor = getProcessor();
  processor.assertModeSupported(draft.mode);
  const [business] = await db
    .select({ name: organizations.name, displayName: businessProfiles.displayName, billingEmail: businessProfiles.billingEmail, customerId: businessProfiles.paymentsCustomerId })
    .from(organizations)
    .leftJoin(businessProfiles, eq(businessProfiles.orgId, organizations.id))
    .where(eq(organizations.id, draft.businessOrgId));
  if (!business) throw notFound("Business");
  const billingEmail = business.billingEmail?.trim();
  if (!billingEmail) throw invalid("This business has no billing email. Add one before sending an invoice.", { fields: { billingEmail: "A billing email is required" } });
  const businessName = business.displayName ?? business.name;
  const lines = await linesOf(draft.id, db);
  if (lines.length === 0) throw conflict("An invoice with no lines cannot be sent");

  // Outside any transaction: this is a network call on a real processor.
  const issued = await processor.createInvoice({
    mode: draft.mode,
    customer: { orgId: draft.businessOrgId, name: businessName, email: billingEmail, processorCustomerId: business.customerId },
    lines: lines.map((l) => ({ description: l.description, amountCents: l.amountCents })),
    dueInDays,
    description: `Invoice ${draft.number}`,
    metadata: { invoice_id: draft.id, invoice_number: draft.number, business_org_id: draft.businessOrgId },
    idempotencyKey: `invoice_${draft.id}_v1`,
  });

  const result = await db.transaction(async (tx): Promise<BusinessInvoice | { abandoned: InvoiceStatus }> => {
    // The processor's invoice id is stored once, and no two of our invoices may hold the same one.
    await lockKey(tx, `processor-invoice:${processor.name}:${issued.processorInvoiceId}`);
    const [taken] = await tx
      .select({ id: businessInvoices.id })
      .from(businessInvoices)
      .where(and(eq(businessInvoices.processor, processor.name), eq(businessInvoices.processorInvoiceId, issued.processorInvoiceId), ne(businessInvoices.id, draft.id)));
    if (taken) throw new AppError("internal", `Processor invoice ${issued.processorInvoiceId} is already attached to invoice ${taken.id}`);

    const [current] = await tx.select().from(businessInvoices).where(eq(businessInvoices.id, draft.id)).for("update");
    if (!current) throw notFound("Invoice");
    if (current.status !== "draft") {
      // Another request sent it (or voided it) while the processor call was in flight.
      return current.status === "open" ? { ...current, lines } : { abandoned: current.status };
    }

    const issuedAt = now();
    const dueAt = addMs(issuedAt, dueInDays * MS.day);
    const [open] = await tx
      .update(businessInvoices)
      .set({ status: "open", processor: processor.name, processorInvoiceId: issued.processorInvoiceId, hostedUrl: issued.hostedUrl, issuedAt, dueAt })
      .where(eq(businessInvoices.id, draft.id))
      .returning();
    if (issued.processorCustomerId !== business.customerId) {
      await tx.update(businessProfiles).set({ paymentsCustomerId: issued.processorCustomerId, updatedAt: issuedAt }).where(eq(businessProfiles.orgId, draft.businessOrgId));
    }

    let emailId: string | null = null;
    if (options.notify !== false) {
      const message = invoiceEmail(open, businessName, issued.hostedUrl, dueAt);
      const email = await queueEmail({ to: billingEmail, subject: message.subject, template: "business_invoice", html: message.html, text: message.text, related: { type: "business_invoice", id: open.id } }, tx);
      await enqueue("email.send", { emailId: email.id }, { dedupeKey: `email:${email.id}` }, tx);
      emailId = email.id;
    }
    await audit(
      {
        actor: options.actor ?? SYSTEM_ACTOR,
        orgId: open.businessOrgId,
        action: "invoice.sent",
        target: { type: "business_invoice", id: open.id },
        metadata: { number: open.number, processor: processor.name, totalCents: open.totalCents, dueAt: dueAt.toISOString(), emailId },
      },
      tx,
    );
    return { ...open, lines };
  });

  if ("abandoned" in result) {
    // Our invoice was withdrawn meanwhile: the one just created at the processor must not stay payable.
    await processor.voidInvoice(issued.processorInvoiceId).catch((e) => console.error(`[payments] could not void processor invoice ${issued.processorInvoiceId} for ${draft.number}`, e));
    throw conflict(`An invoice that is ${result.abandoned} cannot be sent`);
  }
  return result;
}

/* Mark paid (operator) --------------------------------------------------------------------------------- */

export interface MarkInvoicePaidOptions extends InvoiceScope {
  /** Who is recording the payment. */
  actor: AuditActor;
  /** How it was paid (check number, wire reference). Kept in the audit log. */
  note: string;
  /** When the money was received. Default: now. Not in the future. */
  paidAt?: Date;
  request?: AuditRequestInfo | null;
}

/**
 * Records that an open invoice was paid outside the processor (a check, a wire) and closes it at the
 * processor so its hosted page stops accepting payment. Payments made ON the hosted page arrive as
 * processor events and need no call here. Already paid: returned unchanged.
 */
export async function markInvoicePaid(invoiceId: string, options: MarkInvoicePaidOptions): Promise<BusinessInvoice> {
  const note = options.note?.trim() ?? "";
  if (note.length < 3 || note.length > 500) throw invalid("Say how the invoice was paid (3 to 500 characters)", { fields: { note: "Required" } });
  const at = now();
  const paidAt = options.paidAt ?? at;
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > at.getTime()) throw invalid("The payment date cannot be in the future", { fields: { paidAt: "Cannot be in the future" } });

  const db = await getDb();
  const invoice = await loadInvoice(invoiceId, options, db);
  if (invoice.status === "paid") return { ...invoice, lines: await linesOf(invoice.id, db) };
  if (!canInvoiceBecome(invoice.status, "paid")) throw conflict(`An invoice that is ${invoice.status} cannot be marked paid`);
  if (invoice.processorInvoiceId) await processorFor(invoice.processor).markInvoicePaidOutOfBand(invoice.processorInvoiceId);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoice.id)).for("update");
    if (!current) throw notFound("Invoice");
    const lines = await linesOf(current.id, tx);
    // The processor's own "paid" event may have arrived while we were calling it.
    if (current.status === "paid") return { ...current, lines };
    if (!canInvoiceBecome(current.status, "paid")) throw conflict(`An invoice that is ${current.status} cannot be marked paid`);
    const paid = await changeInvoiceStatus(tx, current, { to: "paid", paidAt, actor: options.actor, note: { source: "operator", note }, request: options.request });
    return { ...paid, lines };
  });
}

/* Void ------------------------------------------------------------------------------------------------- */

export interface VoidInvoiceOptions extends InvoiceScope {
  actor?: AuditActor;
  /** Why the invoice is withdrawn. Kept in the audit log. */
  reason: string;
  request?: AuditRequestInfo | null;
}

/**
 * Withdraws an invoice that has not been paid. A draft is voided here only; an open invoice is voided at
 * the processor first. The number is not reused. Already void: returned unchanged.
 */
export async function voidInvoice(invoiceId: string, options: VoidInvoiceOptions): Promise<BusinessInvoice> {
  const reason = options.reason?.trim() ?? "";
  if (reason.length < 3 || reason.length > 500) throw invalid("Say why the invoice is being voided (3 to 500 characters)", { fields: { reason: "Required" } });

  const db = await getDb();
  const invoice = await loadInvoice(invoiceId, options, db);
  if (invoice.status === "void") return { ...invoice, lines: await linesOf(invoice.id, db) };
  if (!canInvoiceBecome(invoice.status, "void")) throw conflict(`An invoice that is ${invoice.status} cannot be voided`);
  if (invoice.processorInvoiceId && invoice.status !== "draft") await processorFor(invoice.processor).voidInvoice(invoice.processorInvoiceId);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoice.id)).for("update");
    if (!current) throw notFound("Invoice");
    const lines = await linesOf(current.id, tx);
    if (current.status === "void") return { ...current, lines };
    if (!canInvoiceBecome(current.status, "void")) throw conflict(`An invoice that is ${current.status} cannot be voided`);
    const voided = await changeInvoiceStatus(tx, current, { to: "void", actor: options.actor ?? SYSTEM_ACTOR, note: { reason }, request: options.request });
    return { ...voided, lines };
  });
}
