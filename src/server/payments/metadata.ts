import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { schema } from "@/db/client";
import type { Mode } from "@/db/schema";
import type { SettlementMode } from "./types";

/**
 * What the payments service keeps in `payments.metadata`.
 *
 * The column is a free-form string map, so everything here is a string and is read back through
 * `readPaymentMeta`, which never trusts the stored shape. These keys are internal to the payments service:
 * other domains read payments through the service, not through this map.
 */
export const META = {
  mode: "mode",
  idempotencyKey: "idempotency_key",
  description: "description",
  lines: "lines",
  designatedCents: "designated_cents",
  serviceFeeCents: "service_fee_cents",
  settlementMode: "settlement_mode",
  connectedAccountId: "connected_account_id",
  counselSignoffRef: "counsel_signoff_ref",
  /** The processor's id for the charge attempt the current status belongs to. */
  attemptId: "attempt_id",
  /** `occurredAt` of the last event that changed the status (ISO 8601). */
  lastEventAt: "last_event_at",
  lastEventId: "last_event_id",
  /** The three timestamps reference fact 17 asks to keep, so any rule counsel picks can be applied later. */
  chargeCreatedAt: "charge_created_at",
  processingAt: "processing_at",
  succeededAt: "succeeded_at",
  refundedCents: "refunded_cents",
  processorRefundId: "processor_refund_id",
  refundStatus: "refund_status",
  cancelReason: "cancel_reason",
  /** For payments recorded against a business invoice. */
  invoiceId: "invoice_id",
  invoiceNumber: "invoice_number",
} as const;

export type PaymentRow = typeof schema.payments.$inferSelect;
export type InvoiceRow = typeof schema.businessInvoices.$inferSelect;
export type InvoiceLineRow = typeof schema.businessInvoiceLines.$inferSelect;

/** One line of what the payer is charged. Amounts are positive integer cents. */
export type PaymentLine =
  | {
      /** The amount designated as a section 25F qualified contribution. Goes to the SGO in full. */
      kind: "designated_contribution";
      amountCents: number;
      description: string;
    }
  | {
      /** A separate fee the donor pays on top. Never part of the contribution, never taken out of it. */
      kind: "donor_service_fee";
      amountCents: number;
      description: string;
    };

const storedLines = z.array(
  z.object({
    kind: z.enum(["designated_contribution", "donor_service_fee"]),
    amountCents: z.number().int().positive(),
    description: z.string(),
  }),
);

export interface PaymentMeta {
  mode: Mode;
  idempotencyKey: string | null;
  description: string;
  lines: PaymentLine[];
  designatedCents: number | null;
  serviceFeeCents: number;
  settlementMode: SettlementMode;
  connectedAccountId: string | null;
  attemptId: string | null;
  lastEventAt: Date | null;
  chargeCreatedAt: Date | null;
  refundedCents: number;
  processorRefundId: string | null;
  invoiceId: string | null;
}

function date(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cents(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function lines(value: string | undefined): PaymentLine[] {
  if (!value) return [];
  try {
    const parsed = storedLines.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function readPaymentMeta(row: Pick<PaymentRow, "metadata">): PaymentMeta {
  const m = row.metadata ?? {};
  return {
    // Anything that is not explicitly live is test: an unreadable row must never be treated as real money.
    mode: m[META.mode] === "live" ? "live" : "test",
    idempotencyKey: m[META.idempotencyKey] ?? null,
    description: m[META.description] ?? "",
    lines: lines(m[META.lines]),
    designatedCents: cents(m[META.designatedCents]),
    serviceFeeCents: cents(m[META.serviceFeeCents]) ?? 0,
    settlementMode: m[META.settlementMode] === "destination" ? "destination" : "direct",
    connectedAccountId: m[META.connectedAccountId] || null,
    attemptId: m[META.attemptId] || null,
    lastEventAt: date(m[META.lastEventAt]),
    chargeCreatedAt: date(m[META.chargeCreatedAt]),
    refundedCents: cents(m[META.refundedCents]) ?? 0,
    processorRefundId: m[META.processorRefundId] || null,
    invoiceId: m[META.invoiceId] || null,
  };
}

/** First half of the two-int advisory lock key ("PAYS"), so these locks cannot collide with other domains'. */
const LOCK_NAMESPACE = 0x50415953;

/**
 * Serializes every transaction that takes the same key until the holder commits or rolls back.
 *
 * The payments tables have no unique index on the values that must be unique (idempotency key, processor
 * object id), so "check, then write" is made safe by holding this lock around both steps. It holds at READ
 * COMMITTED, the isolation level used throughout the app.
 */
export async function lockKey(tx: DbOrTx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}::int4, hashtext(${key}))`);
}
