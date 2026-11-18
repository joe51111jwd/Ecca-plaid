import { and, eq } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { InvoiceStatus, PaymentStatus } from "@/db/schema";
import { now } from "@/lib/clock";
import { conflict } from "@/lib/errors";
import { audit, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { enqueue } from "@/server/jobs";
import { META, readPaymentMeta, type InvoiceRow, type PaymentRow } from "./metadata";
import { PAID_AT_BASIS } from "./policy";
import type { InvoiceEvent, PaymentEvent, ProcessorEvent } from "./types";

/**
 * The state machine that turns processor events into changes on `payments` and `business_invoices`.
 *
 *   payments:  requires_payment → processing → succeeded | failed | canceled        succeeded → refunded
 *              failed → processing | succeeded   (the payer tries again on the same payment)
 *   invoices:  open → paid | void
 *
 * Events arrive more than once and in any order (webhooks, the browser returning, an operator action), so
 * every rule here is written to be safe under both: applying an event twice changes nothing the second
 * time, and an event that is older than what has already been applied is ignored.
 *
 * Each change, its audit entry and the job that tells the owning domain about it are written in ONE
 * transaction: there is no state change without its job and no job without its state change.
 */

const { payments, businessInvoices } = schema;

/** Job enqueued after every change to a donation payment. Payload `{ paymentId }`. Handler: the donations domain. */
export const DONATION_PAYMENT_UPDATED_JOB = "donation.payment_updated";
/** Job enqueued after every change to a business invoice's payment state. Payload `{ invoiceId }`. Handler: the billing domain. */
export const INVOICE_PAYMENT_UPDATED_JOB = "invoice.payment_updated";

export type IgnoredReason =
  /** Not a payment or invoice of ours (the processor account can hold other objects). */
  | "unknown_object"
  /** Already applied. */
  | "duplicate"
  /** Older than what has been applied. */
  | "stale"
  /** The record is in a final state the event cannot change. */
  | "transition_not_allowed"
  /** Recorded for people to see; the status does not change. */
  | "no_state_change"
  /** Depends on an event we have not seen yet. */
  | "awaiting_prior_event";

export interface ApplyEventResult {
  /** True when a record changed (and a job was enqueued). */
  applied: boolean;
  ignored?: IgnoredReason;
  /** True when the processor should deliver this event again later (see "awaiting_prior_event"). */
  retry: boolean;
  paymentId?: string;
  invoiceId?: string;
  from?: PaymentStatus | InvoiceStatus;
  to?: PaymentStatus | InvoiceStatus;
}

const ignored = (reason: IgnoredReason, ids: { paymentId?: string; invoiceId?: string } = {}, retry = false): ApplyEventResult => ({
  applied: false,
  ignored: reason,
  retry,
  ...ids,
});

/* Payments --------------------------------------------------------------------------------------------- */

export type PaymentDecision =
  | { action: "transition"; to: PaymentStatus }
  /** The status stays; details change (a newer failure reason, a partial refund). */
  | { action: "update" }
  | { action: "ignore"; reason: IgnoredReason; retry?: boolean };

export interface PaymentStateView {
  status: PaymentStatus;
  /** The processor's charge attempt the current status belongs to. */
  attemptId: string | null;
  /** `occurredAt` of the last applied event. */
  lastEventAt: Date | null;
  refundedCents: number;
}

const transition = (to: PaymentStatus): PaymentDecision => ({ action: "transition", to });
const ignore = (reason: IgnoredReason, retry = false): PaymentDecision => ({ action: "ignore", reason, retry });

/**
 * "processing" and "failed" describe one charge attempt, and a payment can have several (a declined card,
 * then another card). An event of that kind from an earlier attempt must not overwrite a later one.
 * Same attempt: it can only move forward. Different or unknown attempt: the processor's clock decides.
 */
function attemptOrder(current: PaymentStateView, event: { attemptId?: string; occurredAt: Date }): "same" | "older" | "newer_or_unknown" {
  if (event.attemptId && current.attemptId && event.attemptId === current.attemptId) return "same";
  if (current.lastEventAt && event.occurredAt.getTime() < current.lastEventAt.getTime()) return "older";
  return "newer_or_unknown";
}

/** The pure rule: given where a payment is and an event, what happens. Exported for tests. */
export function decidePaymentTransition(current: PaymentStateView, event: PaymentEvent): PaymentDecision {
  const { status } = current;
  switch (event.type) {
    case "payment.succeeded":
      if (status === "succeeded" || status === "refunded") return ignore("duplicate");
      if (status === "canceled") return ignore("transition_not_allowed");
      return transition("succeeded");

    case "payment.canceled":
      if (status === "canceled") return ignore("duplicate");
      if (status === "succeeded" || status === "refunded") return ignore("transition_not_allowed");
      return transition("canceled");

    case "payment.refunded":
      if (status === "refunded") return ignore("duplicate");
      if (status === "canceled") return ignore("transition_not_allowed");
      // A refund can only follow a success. If the success event has not reached us yet, dropping the refund
      // would leave a refunded gift counted as received: ask for redelivery instead.
      if (status !== "succeeded") return ignore("awaiting_prior_event", true);
      if (event.fullyRefunded) return transition("refunded");
      return event.refundedAmountCents > current.refundedCents ? { action: "update" } : ignore("duplicate");

    case "payment.processing": {
      if (status === "processing") return ignore("duplicate");
      if (status === "requires_payment") return transition("processing");
      if (status === "canceled") return ignore("transition_not_allowed");
      if (status !== "failed") return ignore("stale");
      // failed → processing is a retry: only a different, later attempt may do it.
      return attemptOrder(current, event) === "newer_or_unknown" ? transition("processing") : ignore("stale");
    }

    case "payment.failed": {
      if (status === "requires_payment") return transition("failed");
      if (status === "canceled") return ignore("transition_not_allowed");
      if (status === "succeeded" || status === "refunded") return ignore("stale");
      const order = attemptOrder(current, event);
      if (status === "processing") return order === "older" ? ignore("stale") : transition("failed");
      // failed → failed: a later attempt failed too; keep its reason.
      if (order === "same") return ignore("duplicate");
      return order === "older" ? ignore("stale") : { action: "update" };
    }
  }
}

function paidAtFor(event: { chargedAt: Date; occurredAt: Date }): Date {
  return PAID_AT_BASIS === "charge_created" ? event.chargedAt : event.occurredAt;
}

function eventActor(event: ProcessorEvent): AuditActor {
  return { type: "webhook", id: event.id.slice(0, 200) };
}

async function enqueuePaymentJob(payment: PaymentRow, tx: DbOrTx): Promise<void> {
  if (payment.purpose === "donation") {
    await enqueue(DONATION_PAYMENT_UPDATED_JOB, { paymentId: payment.id }, {}, tx);
    return;
  }
  const invoiceId = readPaymentMeta(payment).invoiceId;
  if (invoiceId) await enqueue(INVOICE_PAYMENT_UPDATED_JOB, { invoiceId }, {}, tx);
}

async function applyPaymentEvent(event: PaymentEvent, db: DbOrTx): Promise<ApplyEventResult> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.processor, event.processor), eq(payments.processorPaymentId, event.processorPaymentId)))
      .for("update");
    if (!payment) return ignored("unknown_object");

    const meta = readPaymentMeta(payment);
    const decision = decidePaymentTransition(
      { status: payment.status, attemptId: meta.attemptId, lastEventAt: meta.lastEventAt, refundedCents: meta.refundedCents },
      event,
    );
    if (decision.action === "ignore") {
      if (event.type === "payment.succeeded" && payment.status === "canceled") {
        console.error(`[payments] ${event.processor} reports ${event.processorPaymentId} as paid, but payment ${payment.id} is canceled here. Needs a person.`);
      }
      return ignored(decision.reason, { paymentId: payment.id }, decision.retry === true);
    }

    if (event.type === "payment.succeeded" && event.amountCents !== undefined && event.amountCents !== payment.amountCents) {
      // Never record a gift for an amount other than the one that was collected. Thrown so the webhook
      // fails loudly and the processor keeps redelivering until a person has looked at it.
      throw conflict(`Processor collected ${event.amountCents} cents for payment ${payment.id}, which was created for ${payment.amountCents} cents`, {
        paymentId: payment.id,
        expectedCents: payment.amountCents,
        collectedCents: event.amountCents,
      });
    }

    const at = now();
    const occurredAt = event.occurredAt.toISOString();
    const metadata: Record<string, string> = { ...payment.metadata, [META.lastEventId]: event.id };
    const set: Partial<typeof payments.$inferInsert> = { updatedAt: at };
    // A partial refund reports on a succeeded payment; it must not move the attempt clock.
    if (event.type !== "payment.refunded") metadata[META.lastEventAt] = occurredAt;
    if ("attemptId" in event && event.attemptId) metadata[META.attemptId] = event.attemptId;
    if ("method" in event && event.method) set.method = event.method;

    switch (event.type) {
      case "payment.processing":
        set.failureReason = null;
        metadata[META.processingAt] = occurredAt;
        if (event.chargedAt) metadata[META.chargeCreatedAt] = event.chargedAt.toISOString();
        break;
      case "payment.succeeded":
        set.failureReason = null;
        set.paidAt = paidAtFor(event);
        metadata[META.chargeCreatedAt] = event.chargedAt.toISOString();
        metadata[META.succeededAt] = occurredAt;
        break;
      case "payment.failed":
        set.failureReason = event.failureReason.slice(0, 500);
        break;
      case "payment.canceled":
        if (event.reason) metadata[META.cancelReason] = event.reason.slice(0, 200);
        break;
      case "payment.refunded":
        metadata[META.refundedCents] = String(event.refundedAmountCents);
        if (event.fullyRefunded) set.refundedAt = event.occurredAt;
        break;
    }

    const to = decision.action === "transition" ? decision.to : payment.status;
    const [updated] = await tx
      .update(payments)
      .set({ ...set, status: to, metadata })
      .where(eq(payments.id, payment.id))
      .returning();

    // A second failure on an already failed payment only refreshes the reason shown to the payer.
    if (decision.action === "update" && event.type === "payment.failed") return ignored("no_state_change", { paymentId: payment.id });

    await audit(
      {
        actor: eventActor(event),
        orgId: payment.orgId,
        action: decision.action === "transition" ? "payment.status_changed" : "payment.partially_refunded",
        target: { type: "payment", id: payment.id },
        metadata: {
          processor: event.processor,
          event: event.type,
          from: payment.status,
          to,
          occurredAt,
          ...(event.type === "payment.refunded" ? { refundedCents: event.refundedAmountCents } : {}),
          ...(event.type === "payment.failed" && event.failureCode ? { failureCode: event.failureCode } : {}),
        },
      },
      tx,
    );
    await enqueuePaymentJob(updated, tx);
    return { applied: true, retry: false, paymentId: payment.id, from: payment.status, to };
  });
}

/* Invoices --------------------------------------------------------------------------------------------- */

export interface InvoiceChange {
  to: Extract<InvoiceStatus, "paid" | "void">;
  /** Required for "paid": when the money was received. */
  paidAt?: Date;
  actor: AuditActor;
  /** Extra context for the audit entry (who marked it, why). */
  note?: Record<string, unknown>;
  request?: AuditRequestInfo | null;
}

/**
 * Moves a locked invoice row to `paid` or `void`, writes the audit entry and enqueues the billing job.
 * The caller holds the row lock (`select ... for update`) and has checked that the move is allowed.
 */
export async function changeInvoiceStatus(tx: DbOrTx, invoice: InvoiceRow, change: InvoiceChange): Promise<InvoiceRow> {
  const [updated] = await tx
    .update(businessInvoices)
    .set(change.to === "paid" ? { status: "paid", paidAt: change.paidAt ?? now() } : { status: "void" })
    .where(eq(businessInvoices.id, invoice.id))
    .returning();
  await audit(
    {
      actor: change.actor,
      orgId: invoice.businessOrgId,
      action: change.to === "paid" ? "invoice.paid" : "invoice.voided",
      target: { type: "business_invoice", id: invoice.id },
      metadata: { number: invoice.number, from: invoice.status, to: change.to, totalCents: invoice.totalCents, ...change.note },
      request: change.request,
    },
    tx,
  );
  await enqueue(INVOICE_PAYMENT_UPDATED_JOB, { invoiceId: invoice.id }, {}, tx);
  return updated;
}

/** Which invoice statuses may still become `paid` or `void`. A draft has not been issued; paid and void are final. */
export function canInvoiceBecome(current: InvoiceStatus, to: "paid" | "void"): boolean {
  if (to === "paid") return current === "open" || current === "uncollectible";
  return current === "draft" || current === "open" || current === "uncollectible";
}

async function applyInvoiceEvent(event: InvoiceEvent, db: DbOrTx): Promise<ApplyEventResult> {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(businessInvoices)
      .where(and(eq(businessInvoices.processor, event.processor), eq(businessInvoices.processorInvoiceId, event.processorInvoiceId)))
      .for("update");
    if (!invoice) return ignored("unknown_object");
    const ids = { invoiceId: invoice.id };

    if (event.type === "invoice.payment_failed") {
      // The invoice stays open and the business can pay again; a person should still be able to see it happened.
      await audit(
        {
          actor: eventActor(event),
          orgId: invoice.businessOrgId,
          action: "invoice.payment_failed",
          target: { type: "business_invoice", id: invoice.id },
          metadata: { number: invoice.number, processor: event.processor, reason: event.failureReason ?? null, occurredAt: event.occurredAt.toISOString() },
        },
        tx,
      );
      return ignored("no_state_change", ids);
    }

    const to = event.type === "invoice.paid" ? "paid" : "void";
    if (invoice.status === to) return ignored("duplicate", ids);
    if (!canInvoiceBecome(invoice.status, to)) return ignored("transition_not_allowed", ids);

    await changeInvoiceStatus(tx, invoice, {
      to,
      paidAt: event.type === "invoice.paid" ? event.paidAt : undefined,
      actor: eventActor(event),
      note: { processor: event.processor, event: event.type },
    });
    return { applied: true, retry: false, ...ids, from: invoice.status, to };
  });
}

/* Entry point ------------------------------------------------------------------------------------------ */

/**
 * Applies one normalized processor event. Idempotent and order-tolerant (see the top of this file).
 *
 * Pass a transaction as `dbOrTx` to make the change part of a larger unit of work; without one the change
 * commits on its own. Throws only when an event contradicts our records in a way a person must resolve
 * (the processor collected a different amount than was asked for).
 */
export async function applyProcessorEvent(event: ProcessorEvent, dbOrTx?: DbOrTx): Promise<ApplyEventResult> {
  const db = dbOrTx ?? (await getDb());
  switch (event.type) {
    case "payment.succeeded":
    case "payment.failed":
    case "payment.processing":
    case "payment.canceled":
    case "payment.refunded":
      return applyPaymentEvent(event, db);
    case "invoice.paid":
    case "invoice.voided":
    case "invoice.payment_failed":
      return applyInvoiceEvent(event, db);
  }
}
