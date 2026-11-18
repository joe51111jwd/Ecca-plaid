import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode, PaymentStatus } from "@/db/schema";
import { now } from "@/lib/clock";
import { env } from "@/lib/env";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit, SYSTEM_ACTOR, type AuditRequestInfo } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { applyProcessorEvent, DONATION_PAYMENT_UPDATED_JOB } from "./events";
import { enqueue } from "@/server/jobs";
import { lockKey, META, readPaymentMeta, type PaymentLine, type PaymentRow } from "./metadata";
import { CURRENCY, MAX_CHARGE_CENTS, MIN_CHARGE_CENTS, REFUND_REASON_MIN_LENGTH } from "./policy";
import { getProcessor, processorFor } from "./processor";
import type { ClientPayment } from "./client";
import { sandboxClientPayment } from "./sandbox";
import type { PaymentLookup, ProcessorName, ProcessorPayment, Settlement } from "./types";

/**
 * Donation payments: the `payments` row behind a donor checkout and its counterpart at the processor.
 *
 * One checkout session has at most one payment that can still be paid. Asking for a new payment (a new
 * idempotency key, for example after the donor changed the amount) cancels the earlier unpaid one first, and
 * is refused once a payment for the checkout is being processed or has been paid — so a donor with two tabs
 * open cannot be charged twice.
 */

const { payments, checkoutSessions, organizations, sgoProfiles } = schema;

/* Shapes ----------------------------------------------------------------------------------------------- */

export interface CreateDonationPaymentInput {
  checkoutSessionId: string;
  /** The SGO receiving the gift. */
  orgId: string;
  /** Total charged to the donor in cents: must equal the sum of `lines`. */
  amountCents: number;
  /**
   * What the total is made of. The designated contribution(s) go to the SGO in full. A donor service fee,
   * when that fee structure is active, is its own line on top. No line can be negative, so a fee can only
   * ever be added to the donor's total, never taken out of the gift.
   */
  lines: PaymentLine[];
  /** Where our receipt goes. Not passed to the processor, which must not send one of its own. */
  receiptEmail?: string | null;
  /** Stable for one payment of this checkout. The same key returns the same payment. */
  idempotencyKey: string;
  mode: Mode;
  /** Shown on the processor's records and the sandbox pay page. Default "Contribution to {organization}". No personal data. */
  description?: string;
  /**
   * REQUIRES COUNSEL SIGN-OFF. Omit for the default (a direct charge on the SGO's own connected account).
   * Routes the gift through the platform's processor account instead; see SettlementMode in ./types.
   */
  settlement?: { settlementMode: "destination"; counselSignoffRef: string };
}

export interface PaymentSummary {
  id: string;
  processor: ProcessorName;
  processorPaymentId: string | null;
  purpose: PaymentRow["purpose"];
  checkoutSessionId: string | null;
  orgId: string | null;
  mode: Mode;
  amountCents: number;
  /** The designated contribution inside `amountCents` (null for payments that are not donations). */
  designatedAmountCents: number | null;
  serviceFeeCents: number;
  currency: string;
  status: PaymentStatus;
  /** card | us_bank_account | ... once known. */
  method: string | null;
  failureReason: string | null;
  /** The processor's charge time. This instant decides the gift's tax year. */
  paidAt: Date | null;
  refundedAt: Date | null;
  refundedCents: number;
  lines: PaymentLine[];
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DonationPayment extends PaymentSummary {
  /** False when the idempotency key matched a payment created earlier. */
  created: boolean;
  client: ClientPayment;
}

/* Helpers ---------------------------------------------------------------------------------------------- */

function summarize(row: PaymentRow): PaymentSummary {
  const meta = readPaymentMeta(row);
  return {
    id: row.id,
    processor: row.processor,
    processorPaymentId: row.processorPaymentId,
    purpose: row.purpose,
    checkoutSessionId: row.checkoutSessionId,
    orgId: row.orgId,
    mode: meta.mode,
    amountCents: row.amountCents,
    designatedAmountCents: meta.designatedCents,
    serviceFeeCents: meta.serviceFeeCents,
    currency: row.currency,
    status: row.status,
    method: row.method,
    failureReason: row.failureReason,
    paidAt: row.paidAt,
    refundedAt: row.refundedAt,
    refundedCents: meta.refundedCents,
    lines: meta.lines,
    description: meta.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadPayment(paymentId: string, db?: DbOrTx): Promise<PaymentRow> {
  const [row] = await (db ?? (await getDb())).select().from(payments).where(eq(payments.id, paymentId));
  if (!row) throw notFound("Payment");
  return row;
}

/** Where the processor keeps this payment: direct charges live on the SGO's connected account. */
function lookupFor(row: PaymentRow): PaymentLookup {
  const meta = readPaymentMeta(row);
  return { connectedAccountId: meta.settlementMode === "direct" ? meta.connectedAccountId : null };
}

const isPayable = (status: PaymentStatus) => status === "requires_payment" || status === "failed";

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
  return fields;
}

/* Create ----------------------------------------------------------------------------------------------- */

const lineInput = z.object({
  kind: z.enum(["designated_contribution", "donor_service_fee"]),
  amountCents: z.number().int().positive().max(MAX_CHARGE_CENTS),
  description: z.string().trim().min(1).max(200),
});

const createInput = z
  .object({
    checkoutSessionId: z.string().min(1).max(100),
    orgId: z.string().min(1).max(100),
    amountCents: z.number().int().min(MIN_CHARGE_CENTS).max(MAX_CHARGE_CENTS),
    lines: z.array(lineInput).min(1).max(10),
    receiptEmail: z.email().max(254).nullish(),
    idempotencyKey: z.string().min(1).max(200),
    mode: z.enum(["test", "live"]),
    description: z.string().trim().min(1).max(200).optional(),
    settlement: z.strictObject({ settlementMode: z.literal("destination"), counselSignoffRef: z.string().trim().min(1).max(500) }).optional(),
  })
  .superRefine((value, ctx) => {
    const designated = value.lines.filter((l) => l.kind === "designated_contribution");
    const fees = value.lines.filter((l) => l.kind === "donor_service_fee");
    if (designated.length === 0) ctx.addIssue({ code: "custom", path: ["lines"], message: "A donation payment needs at least one designated contribution line" });
    if (fees.length > 1) ctx.addIssue({ code: "custom", path: ["lines"], message: "A payment can carry at most one donor service fee line" });
    const sum = value.lines.reduce((total, l) => total + l.amountCents, 0);
    if (sum !== value.amountCents) ctx.addIssue({ code: "custom", path: ["amountCents"], message: "The amount must equal the sum of the lines" });
  });

type CreateData = z.output<typeof createInput>;

/**
 * The earliest calendar date anywhere on Earth (UTC+14). Live designated gifts are refused while even this
 * date is before the credit start date. It is a backstop under the donations domain's own date gate, chosen
 * so it can never be stricter than whatever instant counsel decides governs (reference Open Question 7).
 */
function earliestDateOnEarth(at: Date): string {
  return new Date(at.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
}

async function assertLiveGiftsAllowed(mode: Mode): Promise<void> {
  if (mode !== "live") return;
  if (!(await getSetting("gifts.liveEnabled"))) throw forbidden("Live gifts are not being accepted yet.");
  const startDate = await getSetting("credit.startDate");
  if (earliestDateOnEarth(now()) < startDate) throw forbidden(`Live gifts cannot be collected before ${startDate}.`);
}

function sameRequest(row: PaymentRow, data: CreateData): boolean {
  const meta = readPaymentMeta(row);
  const key = (lines: PaymentLine[]) => JSON.stringify(lines.map((l) => [l.kind, l.amountCents]));
  return row.orgId === data.orgId && row.amountCents === data.amountCents && meta.mode === data.mode && key(meta.lines) === key(data.lines);
}

interface Prepared {
  row: PaymentRow;
  created: boolean;
  /** Earlier unpaid payments of the same checkout that this one replaces. */
  superseded: PaymentRow[];
  settlement: Settlement;
}

async function prepare(data: CreateData, processorName: ProcessorName): Promise<Prepared> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // One payment at a time per checkout session: concurrent calls wait here.
    await lockKey(tx, `checkout:${data.checkoutSessionId}`);

    const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, data.checkoutSessionId));
    if (!session || session.orgId !== data.orgId) throw notFound("Checkout session");
    if (session.mode !== data.mode) throw conflict(`This checkout is in ${session.mode} mode and cannot take a ${data.mode} payment`);
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, data.orgId));
    if (!org || org.type !== "sgo") throw notFound("Organization");
    const [profile] = await tx.select({ paymentsAccountId: sgoProfiles.paymentsAccountId }).from(sgoProfiles).where(eq(sgoProfiles.orgId, data.orgId));
    const connectedAccountId = profile?.paymentsAccountId?.trim() || undefined;

    const existing = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.checkoutSessionId, data.checkoutSessionId), eq(payments.purpose, "donation")));
    const others = (keep: PaymentRow) => existing.filter((p) => p.id !== keep.id && isPayable(p.status));
    const settlementOf = (row: PaymentRow): Settlement => {
      const meta = readPaymentMeta(row);
      return meta.settlementMode === "destination"
        ? { settlementMode: "destination", connectedAccountId: meta.connectedAccountId ?? "", counselSignoffRef: row.metadata[META.counselSignoffRef] ?? "" }
        : { settlementMode: "direct", connectedAccountId: meta.connectedAccountId ?? undefined };
    };

    const same = existing.find((p) => readPaymentMeta(p).idempotencyKey === data.idempotencyKey);
    if (same) {
      if (!sameRequest(same, data)) throw conflict("This idempotency key was already used for a payment with different details", { paymentId: same.id });
      return { row: same, created: false, superseded: isPayable(same.status) ? others(same) : [], settlement: settlementOf(same) };
    }

    if (session.status !== "open" && session.status !== "awaiting_payment") throw conflict(`This checkout is ${session.status} and cannot take a payment`);
    const blocking = existing.find((p) => !isPayable(p.status) && p.status !== "canceled");
    if (blocking) {
      throw conflict(blocking.status === "processing" ? "A payment for this checkout is already being processed." : "This checkout has already been paid.", { paymentId: blocking.id });
    }
    if (processorName === "stripe" && !connectedAccountId) {
      throw new AppError("not_available", "This organization cannot receive gifts yet: its payments account has not been connected.");
    }

    const designatedCents = data.lines.filter((l) => l.kind === "designated_contribution").reduce((sum, l) => sum + l.amountCents, 0);
    const at = now();
    const settlement: Settlement = data.settlement
      ? { settlementMode: "destination", connectedAccountId: connectedAccountId ?? "", counselSignoffRef: data.settlement.counselSignoffRef }
      : { settlementMode: "direct", connectedAccountId };
    const [row] = await tx
      .insert(payments)
      .values({
        id: newId("payment"),
        processor: processorName,
        purpose: "donation",
        checkoutSessionId: data.checkoutSessionId,
        orgId: data.orgId,
        amountCents: data.amountCents,
        currency: CURRENCY,
        status: "requires_payment",
        metadata: {
          [META.mode]: data.mode,
          [META.idempotencyKey]: data.idempotencyKey,
          [META.description]: data.description ?? `Contribution to ${org.name}`,
          [META.lines]: JSON.stringify(data.lines),
          [META.designatedCents]: String(designatedCents),
          [META.serviceFeeCents]: String(data.amountCents - designatedCents),
          [META.settlementMode]: settlement.settlementMode ?? "direct",
          ...(connectedAccountId ? { [META.connectedAccountId]: connectedAccountId } : {}),
          ...(data.settlement ? { [META.counselSignoffRef]: data.settlement.counselSignoffRef } : {}),
        },
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await audit(
      {
        actor: SYSTEM_ACTOR,
        orgId: data.orgId,
        action: "payment.created",
        target: { type: "payment", id: row.id },
        metadata: {
          processor: processorName,
          mode: data.mode,
          amountCents: data.amountCents,
          designatedCents,
          checkoutSessionId: data.checkoutSessionId,
          settlementMode: settlement.settlementMode ?? "direct",
          ...(data.settlement ? { counselSignoffRef: data.settlement.counselSignoffRef } : {}),
        },
      },
      tx,
    );
    return { row, created: true, superseded: others(row), settlement };
  });
}

/**
 * Stores the processor's payment id on our row. The row, not the processor's idempotency key, is what
 * guarantees one processor payment per payment for good: the id is written once, under a lock that also
 * proves no other row already holds it.
 */
async function attachProcessorPayment(paymentId: string, processor: ProcessorName, processorPaymentId: string): Promise<PaymentRow> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await lockKey(tx, `processor-payment:${processor}:${processorPaymentId}`);
    const [taken] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.processor, processor), eq(payments.processorPaymentId, processorPaymentId), ne(payments.id, paymentId)));
    if (taken) throw new AppError("internal", `Processor payment ${processorPaymentId} is already attached to payment ${taken.id}`);
    const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!row) throw notFound("Payment");
    if (row.processorPaymentId) {
      if (row.processorPaymentId !== processorPaymentId) throw new AppError("internal", `Payment ${paymentId} already has processor payment ${row.processorPaymentId}`);
      return row;
    }
    const [updated] = await tx.update(payments).set({ processorPaymentId, updatedAt: now() }).where(eq(payments.id, paymentId)).returning();
    return updated;
  });
}

async function clientPayment(row: PaymentRow, fresh?: ProcessorPayment): Promise<ClientPayment> {
  if (row.processor === "sandbox") return sandboxClientPayment(row);
  const meta = readPaymentMeta(row);
  const publishableKey = env().NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new AppError("not_available", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set");
  let clientSecret: string | null = null;
  if (isPayable(row.status) && row.processorPaymentId) {
    // Never stored on our side: read from the processor whenever the browser needs it.
    clientSecret = fresh?.clientSecret ?? (await processorFor("stripe").retrievePayment(row.processorPaymentId, lookupFor(row))).clientSecret ?? null;
  }
  return {
    provider: "stripe",
    paymentId: row.id,
    mode: meta.mode,
    status: row.status,
    amountCents: row.amountCents,
    currency: CURRENCY,
    description: meta.description,
    lines: meta.lines,
    failureReason: row.failureReason,
    clientSecret,
    publishableKey,
    connectedAccountId: lookupFor(row).connectedAccountId ?? null,
  };
}

/**
 * Creates the payment for a donor checkout: our `payments` row and the processor's payment. Calling it again
 * with the same idempotency key returns the same payment (and finishes creating it if an earlier call was
 * interrupted). A different key replaces any earlier unpaid payment of the checkout.
 *
 * The caller (the donations service) owns the checkout rules: designation, SGO list status, the fee
 * structure and the credit start date. This function still refuses live payments while live gifts are
 * switched off.
 */
export async function createDonationPayment(input: CreateDonationPaymentInput): Promise<DonationPayment> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) throw invalid("Invalid payment request", { fields: fieldErrors(parsed.error) });
  const data = parsed.data;

  const configured = getProcessor();
  configured.assertModeSupported(data.mode);
  await assertLiveGiftsAllowed(data.mode);

  const prepared = await prepare(data, configured.name);
  let row = prepared.row;

  for (const earlier of prepared.superseded) {
    const status = await cancelRow(earlier, "superseded");
    if (status !== "canceled") {
      // The donor paid (or started paying) the earlier payment in the meantime. Withdraw the new one.
      if (prepared.created) await cancelRow(row, "earlier_payment_completed");
      throw conflict(status === "processing" ? "A payment for this checkout is already being processed." : "This checkout has already been paid.", { paymentId: earlier.id });
    }
  }

  let fresh: ProcessorPayment | undefined;
  if (!row.processorPaymentId && row.status === "requires_payment") {
    const meta = readPaymentMeta(row);
    const processor = processorFor(row.processor);
    fresh = await processor.createPayment({
      purpose: "donation",
      mode: meta.mode,
      amountCents: row.amountCents,
      designatedAmountCents: meta.designatedCents ?? row.amountCents,
      serviceFeeOnTopCents: meta.serviceFeeCents,
      description: meta.description,
      receiptEmail: data.receiptEmail ?? undefined,
      // Derived from our own id: stable for this payment and free of anything the caller put in its key.
      idempotencyKey: `payment_${row.id}_create_v1`,
      metadata: { payment_id: row.id, checkout_session_id: data.checkoutSessionId, org_id: data.orgId },
      settlement: prepared.settlement,
    });
    row = await attachProcessorPayment(row.id, row.processor, fresh.processorPaymentId);
  }
  if (!row.processorPaymentId) throw conflict("This payment was canceled before it could be created. Start a new payment.", { paymentId: row.id });

  return { ...summarize(row), created: prepared.created, client: await clientPayment(row, fresh) };
}

/* Read ------------------------------------------------------------------------------------------------- */

export interface PaymentScope {
  /** When set, the payment must belong to this checkout session. Pass it whenever the id came from a browser. */
  checkoutSessionId?: string;
  /** When set, the payment must belong to this organization. */
  orgId?: string;
}

function assertInScope(row: PaymentRow, scope: PaymentScope | undefined): void {
  if (scope?.checkoutSessionId !== undefined && row.checkoutSessionId !== scope.checkoutSessionId) throw notFound("Payment");
  if (scope?.orgId !== undefined && row.orgId !== scope.orgId) throw notFound("Payment");
}

/** A payment as the rest of the app sees it. */
export async function getPayment(paymentId: string, scope?: PaymentScope, dbOrTx?: DbOrTx): Promise<PaymentSummary> {
  const row = await loadPayment(paymentId, dbOrTx);
  assertInScope(row, scope);
  return summarize(row);
}

/** What the browser needs to pay (or to show where the payment stands): feed it to `<PaymentForm payment={...}>`. */
export async function getPaymentForClient(paymentId: string, scope?: PaymentScope): Promise<ClientPayment> {
  const row = await loadPayment(paymentId);
  assertInScope(row, scope);
  if (!row.processorPaymentId && row.status === "requires_payment") {
    throw conflict("This payment has not finished being created. Create it again with the same idempotency key.", { paymentId: row.id });
  }
  return clientPayment(row);
}

/* Sync ------------------------------------------------------------------------------------------------- */

/**
 * Reads the payment's state from the processor and applies it through the same state machine as a webhook.
 * For the page a donor returns to after paying, when the webhook may not have arrived yet, and for repairs.
 * Refunds are not visible on the processor's payment object and only arrive by event.
 */
export async function syncPaymentWithProcessor(paymentId: string, scope?: PaymentScope): Promise<PaymentSummary> {
  const row = await loadPayment(paymentId);
  assertInScope(row, scope);
  // The sandbox has no state of its own: our row is its payment.
  if (row.processor === "sandbox" || !row.processorPaymentId) return summarize(row);

  const found = await processorFor(row.processor).retrievePayment(row.processorPaymentId, lookupFor(row));
  const base = { id: `sync_${row.id}_${found.status}`, processor: row.processor, livemode: found.livemode, processorPaymentId: row.processorPaymentId };
  const at = now();
  switch (found.status) {
    case "succeeded":
      if (!found.chargedAt) throw new AppError("internal", `Processor reports payment ${row.id} as paid without a charge`);
      await applyProcessorEvent({ ...base, type: "payment.succeeded", occurredAt: found.chargedAt, chargedAt: found.chargedAt, amountCents: found.amountCents, method: found.method });
      break;
    case "processing":
      await applyProcessorEvent({ ...base, type: "payment.processing", occurredAt: found.chargedAt ?? at, chargedAt: found.chargedAt, method: found.method });
      break;
    case "failed":
      await applyProcessorEvent({ ...base, type: "payment.failed", occurredAt: found.chargedAt ?? at, failureReason: found.failureReason ?? "The payment could not be completed.", method: found.method });
      break;
    case "canceled":
      await applyProcessorEvent({ ...base, type: "payment.canceled", occurredAt: found.canceledAt ?? at });
      break;
    default:
      break;
  }
  return summarize(await loadPayment(paymentId));
}

/* Cancel ----------------------------------------------------------------------------------------------- */

/** Cancels a row that never reached the processor. There is no processor event to apply, so the change is made here. */
async function cancelLocally(paymentId: string, reason: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!row || row.processorPaymentId || row.status !== "requires_payment") return;
    const [updated] = await tx
      .update(payments)
      .set({ status: "canceled", updatedAt: now(), metadata: { ...row.metadata, [META.cancelReason]: reason } })
      .where(eq(payments.id, row.id))
      .returning();
    await audit(
      { actor: SYSTEM_ACTOR, orgId: row.orgId, action: "payment.status_changed", target: { type: "payment", id: row.id }, metadata: { from: row.status, to: "canceled", reason } },
      tx,
    );
    if (updated.purpose === "donation") await enqueue(DONATION_PAYMENT_UPDATED_JOB, { paymentId: row.id }, {}, tx);
  });
}

/** Cancels an unpaid payment at the processor and here. Returns the status the payment ended up in. */
async function cancelRow(row: PaymentRow, reason: string): Promise<PaymentStatus> {
  if (!isPayable(row.status)) return row.status;
  if (!row.processorPaymentId) {
    await cancelLocally(row.id, reason);
    return (await loadPayment(row.id)).status;
  }
  try {
    const canceled = await processorFor(row.processor).cancelPayment(row.processorPaymentId, lookupFor(row));
    await applyProcessorEvent({
      id: `cancel_${row.id}`,
      processor: row.processor,
      occurredAt: canceled.canceledAt ?? now(),
      livemode: canceled.livemode,
      type: "payment.canceled",
      processorPaymentId: row.processorPaymentId,
      reason,
    });
  } catch (e) {
    // The processor refuses to cancel a payment that has been paid or is being processed. Find out which.
    await syncPaymentWithProcessor(row.id).catch((syncError) => console.error(`[payments] could not sync payment ${row.id} after a failed cancel`, syncError));
    const current = await loadPayment(row.id);
    if (isPayable(current.status)) throw e;
    return current.status;
  }
  return (await loadPayment(row.id)).status;
}

/**
 * Cancels a payment that has not been paid (the donor left, or the checkout changed). Throws conflict when
 * the payment is already being processed or has been paid.
 */
export async function cancelPayment(paymentId: string, options: PaymentScope & { reason?: string } = {}): Promise<PaymentSummary> {
  const row = await loadPayment(paymentId);
  assertInScope(row, options);
  if (row.status === "canceled") return summarize(row);
  if (!isPayable(row.status)) throw conflict(`A payment that is ${row.status} cannot be canceled`);
  const status = await cancelRow(row, options.reason?.trim().slice(0, 200) || "canceled");
  if (status !== "canceled") throw conflict(`This payment is ${status} and can no longer be canceled`);
  return summarize(await loadPayment(paymentId));
}

/* Refund ----------------------------------------------------------------------------------------------- */

export interface RefundPaymentRequest {
  paymentId: string;
  /**
   * Must be exactly `true`. A designated section 25F gift is irrevocable once designated, and whether and
   * how it may be refunded is a question for counsel, not a routine support action. The flag makes the
   * caller state that an operator decided to override that default.
   */
  operatorOverride: true;
  /** Why, in the operator's words (who asked, what counsel or the SGO said). Kept in the audit log. */
  reason: string;
  /** The platform operator issuing the refund. The caller has already checked they are a platform admin. */
  actorUserId: string;
  request?: AuditRequestInfo | null;
}

const refundInput = z.object({
  paymentId: z.string().min(1).max(100),
  operatorOverride: z.literal(true),
  reason: z.string().trim().min(REFUND_REASON_MIN_LENGTH).max(1000),
  actorUserId: z.string().min(1).max(100),
});

export interface RefundResult {
  payment: PaymentSummary;
  refund: { processorRefundId: string; status: "succeeded" | "pending" };
}

/**
 * Returns a whole payment to the payer. FOR OPERATIONS STAFF ONLY: there is no donor- or SGO-facing path to
 * this function, and it does nothing without `operatorOverride: true` and a written reason. Both, and the
 * outcome, are recorded in the audit log.
 *
 * On a direct charge the refund is debited from the SGO's processor balance (and from its bank account if
 * that balance is short), and can stay "pending" until the balance covers it. A pending refund leaves the
 * payment `succeeded`; it becomes `refunded` when the processor reports the refund.
 */
export async function refundPayment(input: RefundPaymentRequest): Promise<RefundResult> {
  if (input?.operatorOverride !== true) {
    throw forbidden("A designated gift is not refunded as a routine action. An operator must explicitly override, with a reason.");
  }
  const parsed = refundInput.safeParse(input);
  if (!parsed.success) throw invalid("A refund needs the payment, the operator and a written reason", { fields: fieldErrors(parsed.error) });
  const data = parsed.data;
  const actor = { type: "user" as const, id: data.actorUserId };

  const db = await getDb();
  const row = await db.transaction(async (tx) => {
    const [found] = await tx.select().from(payments).where(eq(payments.id, data.paymentId)).for("update");
    if (!found) throw notFound("Payment");
    if (found.status === "refunded" || readPaymentMeta(found).processorRefundId) throw conflict("A refund has already been issued for this payment");
    if (found.status !== "succeeded" || !found.processorPaymentId) throw conflict(`Only a completed payment can be refunded; this one is ${found.status}`);
    // Written before the processor is called, so the decision is on record even if the call never returns.
    await audit(
      {
        actor,
        orgId: found.orgId,
        action: "payment.refund_requested",
        target: { type: "payment", id: found.id },
        metadata: { operatorOverride: true, reason: data.reason, amountCents: found.amountCents, processor: found.processor },
        request: input.request,
      },
      tx,
    );
    return found;
  });

  const meta = readPaymentMeta(row);
  const processorPaymentId = row.processorPaymentId as string;
  let refund;
  try {
    refund = await processorFor(row.processor).refundPayment({
      processorPaymentId,
      connectedAccountId: lookupFor(row).connectedAccountId,
      settlementMode: meta.settlementMode,
      idempotencyKey: `payment_${row.id}_refund_v1`,
      metadata: { payment_id: row.id },
    });
  } catch (e) {
    await audit({ actor, orgId: row.orgId, action: "payment.refund_failed", target: { type: "payment", id: row.id }, metadata: { error: e instanceof Error ? e.message : String(e) }, request: input.request });
    throw e;
  }
  if (refund.status === "failed") {
    await audit({ actor, orgId: row.orgId, action: "payment.refund_failed", target: { type: "payment", id: row.id }, metadata: { processorRefundId: refund.processorRefundId }, request: input.request });
    throw new AppError("payment_failed", "The processor could not issue the refund.");
  }

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(payments).where(eq(payments.id, row.id)).for("update");
    await tx
      .update(payments)
      .set({ updatedAt: now(), metadata: { ...current.metadata, [META.processorRefundId]: refund.processorRefundId, [META.refundStatus]: refund.status } })
      .where(eq(payments.id, row.id));
    await audit(
      {
        actor,
        orgId: row.orgId,
        action: "payment.refund_issued",
        target: { type: "payment", id: row.id },
        metadata: { processorRefundId: refund.processorRefundId, status: refund.status, amountCents: refund.amountCents },
        request: input.request,
      },
      tx,
    );
  });

  if (refund.status === "succeeded") {
    await applyProcessorEvent({
      id: `refund_${refund.processorRefundId}`,
      processor: row.processor,
      occurredAt: refund.refundedAt ?? now(),
      livemode: meta.mode === "live",
      type: "payment.refunded",
      processorPaymentId,
      refundedAmountCents: refund.amountCents,
      fullyRefunded: refund.amountCents >= row.amountCents,
    });
  }
  return { payment: summarize(await loadPayment(row.id)), refund: { processorRefundId: refund.processorRefundId, status: refund.status } };
}
