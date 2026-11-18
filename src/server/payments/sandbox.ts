import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import type { InvoiceStatus, Mode, PaymentStatus } from "@/db/schema";
import { addMs, now } from "@/lib/clock";
import { deriveKey, hmacSha256, safeEqual, sha256Hex } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { newToken } from "@/lib/ids";
import { enqueue } from "@/server/jobs";
import { applyProcessorEvent } from "./events";
import type { SandboxClientPayment } from "./client";
import { readPaymentMeta, type InvoiceLineRow, type InvoiceRow, type PaymentRow } from "./metadata";
import { CURRENCY, MAX_CHARGE_CENTS, MIN_CHARGE_CENTS, SANDBOX_ASYNC_SETTLE_DELAY_MS } from "./policy";
import { isExpired, isValidSecurityCode, normalizeCardNumber, parseExpiry, resolveSandboxCard, SANDBOX_FAILURE_MESSAGES, SANDBOX_TEST_CARDS, sandboxTestExpiry } from "./sandbox-cards";
import type {
  CreateInvoiceInput,
  CreatePaymentInput,
  PaymentFailedEvent,
  PaymentProcessor,
  PaymentSucceededEvent,
  ProcessorEvent,
  ProcessorInvoice,
  ProcessorPayment,
  ProcessorPaymentDetails,
  ProcessorRefund,
  RefundPaymentInput,
} from "./types";

/**
 * The sandbox payment processor: the default, and the reason the whole product runs with no processor account.
 *
 * NO MONEY MOVES HERE. A sandbox payment is "paid" by typing a documented test number into the sandbox pay
 * page (or the embedded sandbox form); a sandbox invoice is "paid" by pressing a button on its hosted page.
 * The entered card number decides the outcome and is then discarded: it is never stored or logged.
 *
 * The sandbox keeps no state of its own. Its payments and invoices ARE the `payments` and
 * `business_invoices` rows the service writes, and every outcome goes through the same normalized events and
 * state machine as a real processor's webhooks (./events), so what works here works on Stripe.
 *
 * It only ever handles `test` data, and its pages and actions switch themselves off when a production
 * deployment is configured for Stripe (`assertSandboxAvailable`).
 */

const { payments, businessInvoices, businessInvoiceLines, organizations } = schema;

/** Job that completes a sandbox payment left in "processing". Payload: SettlePayload. */
export const SANDBOX_SETTLE_JOB = "payments.sandbox_settle";

/* Availability ----------------------------------------------------------------------------------------- */

/**
 * False when this is a production deployment configured for Stripe: there the sandbox pages and actions do
 * not exist. Read straight from process.env (as the clock and the settings gates do) so a cached
 * configuration can never keep the sandbox open.
 */
export function isSandboxAvailable(): boolean {
  return !(process.env.NODE_ENV === "production" && process.env.PAYMENTS_PROVIDER === "stripe");
}

export function assertSandboxAvailable(): void {
  if (!isSandboxAvailable()) throw new AppError("not_found", "Not found");
}

/* Capability secrets ----------------------------------------------------------------------------------- */

/**
 * Whoever holds this value may complete the sandbox payment or pay the sandbox invoice it belongs to — the
 * sandbox's equivalent of a processor client secret or hosted-invoice URL. It is derived, never stored.
 */
function sandboxSecret(kind: "pay" | "inv", id: string): string {
  return `sbx_${kind}_${hmacSha256(deriveKey("sandbox-processor"), `${kind}:${id}`).toString("base64url")}`;
}

export function sandboxPaymentSecret(paymentId: string): string {
  return sandboxSecret("pay", paymentId);
}

function secretMatches(kind: "pay" | "inv", id: string, presented: string | null | undefined): boolean {
  return typeof presented === "string" && presented.length > 0 && safeEqual(presented, sandboxSecret(kind, id));
}

/** In-app path of the sandbox pay page for a payment (relative, so it works on whatever host serves the app). */
export function sandboxPaymentPath(paymentId: string): string {
  return `/sandbox/pay/${encodeURIComponent(paymentId)}?key=${encodeURIComponent(sandboxPaymentSecret(paymentId))}`;
}

/** Absolute URL of the hosted sandbox invoice page (it goes into emails). */
export function sandboxInvoiceUrl(invoiceId: string): string {
  return appUrl(`/sandbox/invoice/${encodeURIComponent(invoiceId)}?key=${encodeURIComponent(sandboxSecret("inv", invoiceId))}`);
}

/* The processor ---------------------------------------------------------------------------------------- */

const stableId = (prefix: string, seed: string) => `${prefix}_${sha256Hex(`ecca-sandbox:${seed}`).slice(0, 24)}`;

function requireMetadataId(metadata: Record<string, string>, key: string): string {
  const value = metadata[key];
  if (!value) throw new AppError("internal", `Sandbox processor: metadata.${key} is required`);
  return value;
}

function details(row: PaymentRow): ProcessorPaymentDetails {
  const meta = readPaymentMeta(row);
  return {
    processorPaymentId: row.processorPaymentId ?? "",
    clientSecret: sandboxPaymentSecret(row.id),
    status: row.status,
    amountCents: row.amountCents,
    chargedAt: meta.chargeCreatedAt ?? undefined,
    method: row.method ?? undefined,
    failureReason: row.failureReason ?? undefined,
    attemptId: meta.attemptId ?? undefined,
    livemode: false,
  };
}

export class SandboxProcessor implements PaymentProcessor {
  readonly name = "sandbox" as const;

  assertModeSupported(mode: Mode): void {
    if (mode !== "test") {
      throw new AppError("not_available", "Live payments are not available: this deployment uses the sandbox payment processor, which never moves money.");
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<ProcessorPayment> {
    this.assertModeSupported(input.mode);
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < MIN_CHARGE_CENTS || input.amountCents > MAX_CHARGE_CENTS) {
      throw invalid("The amount is outside what can be charged");
    }
    if (input.designatedAmountCents + input.serviceFeeOnTopCents !== input.amountCents) {
      throw new AppError("internal", "Sandbox processor: the designated amount and the service fee must add up to the amount charged");
    }
    const paymentId = requireMetadataId(input.metadata, "payment_id");
    return {
      // Derived from the idempotency key, so repeating the call names the same payment.
      processorPaymentId: stableId("sbx_pi", `payment:${input.idempotencyKey}`),
      clientSecret: sandboxPaymentSecret(paymentId),
      status: "requires_payment",
    };
  }

  private async load(processorPaymentId: string): Promise<PaymentRow> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.processor, "sandbox"), eq(payments.processorPaymentId, processorPaymentId)));
    if (!row) throw notFound("Sandbox payment");
    return row;
  }

  async retrievePayment(processorPaymentId: string): Promise<ProcessorPaymentDetails> {
    return details(await this.load(processorPaymentId));
  }

  async cancelPayment(processorPaymentId: string): Promise<ProcessorPaymentDetails> {
    const row = await this.load(processorPaymentId);
    if (row.status === "canceled") return { ...details(row), canceledAt: row.updatedAt };
    if (row.status !== "requires_payment" && row.status !== "failed") {
      throw conflict(`A sandbox payment that is ${row.status} cannot be canceled`);
    }
    return { ...details(row), status: "canceled", canceledAt: now() };
  }

  async refundPayment(input: RefundPaymentInput): Promise<ProcessorRefund> {
    const row = await this.load(input.processorPaymentId);
    if (row.status !== "succeeded") throw conflict(`A sandbox payment that is ${row.status} cannot be refunded`);
    return {
      processorRefundId: stableId("sbx_re", `refund:${input.idempotencyKey}`),
      status: "succeeded",
      refundedAt: now(),
      amountCents: row.amountCents,
    };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProcessorInvoice> {
    this.assertModeSupported(input.mode);
    const invoiceId = requireMetadataId(input.metadata, "invoice_id");
    return {
      processorInvoiceId: stableId("sbx_in", `invoice:${input.idempotencyKey}`),
      hostedUrl: sandboxInvoiceUrl(invoiceId),
      status: "open",
      processorCustomerId: stableId("sbx_cus", `customer:${input.customer.orgId}`),
    };
  }

  async voidInvoice(): Promise<{ status: InvoiceStatus }> {
    return { status: "void" };
  }

  async markInvoicePaidOutOfBand(): Promise<{ status: InvoiceStatus }> {
    return { status: "paid" };
  }

  async parseWebhook(): Promise<ProcessorEvent[]> {
    throw new AppError("not_available", "The sandbox processor does not send webhooks");
  }
}

/* Paying a sandbox payment ----------------------------------------------------------------------------- */

export interface SandboxPaymentView {
  /** What `<PaymentForm>` needs, exactly as a checkout page would get it from `getPaymentForClient`. */
  payment: SandboxClientPayment;
  /** The organization the payment is for, when known. */
  payeeName: string | null;
}

/** The browser's view of a sandbox payment row. */
export function sandboxClientPayment(row: PaymentRow): SandboxClientPayment {
  const meta = readPaymentMeta(row);
  return {
    provider: "sandbox",
    paymentId: row.id,
    mode: "test",
    status: row.status,
    amountCents: row.amountCents,
    currency: CURRENCY,
    description: meta.description,
    lines: meta.lines,
    failureReason: row.failureReason,
    clientSecret: sandboxPaymentSecret(row.id),
    sandboxUrl: sandboxPaymentPath(row.id),
    testCards: SANDBOX_TEST_CARDS,
    testExpiry: sandboxTestExpiry(now()),
  };
}

/** What the hosted sandbox pay page shows. Throws not_found unless `key` is the payment's sandbox secret. */
export async function getSandboxPaymentView(paymentId: string, key: string | null | undefined): Promise<SandboxPaymentView> {
  assertSandboxAvailable();
  if (!secretMatches("pay", paymentId, key)) throw notFound("Payment");
  const db = await getDb();
  const [row] = await db
    .select({ payment: payments, payeeName: organizations.name })
    .from(payments)
    .leftJoin(organizations, eq(organizations.id, payments.orgId))
    .where(eq(payments.id, paymentId));
  if (!row || row.payment.processor !== "sandbox") throw notFound("Payment");
  return { payment: sandboxClientPayment(row.payment), payeeName: row.payeeName ?? null };
}

const confirmInput = z.object({
  paymentId: z.string().min(1).max(100),
  clientSecret: z.string().min(1).max(200),
  cardNumber: z.string().max(40),
  expiry: z.string().max(12),
  securityCode: z.string().max(8),
});

export type ConfirmSandboxPaymentInput = z.input<typeof confirmInput>;

export interface SandboxConfirmResult {
  paymentId: string;
  status: Extract<PaymentStatus, "succeeded" | "processing" | "failed">;
  /** Set when `status` is "failed". Safe to show. */
  failureReason: string | null;
}

interface SettlePayload {
  paymentId: string;
  attemptId: string;
  outcome: "succeeded" | "failed";
  /** When the sandbox "charged" the payment (ISO 8601): the time the form was submitted, not the time the job runs. */
  chargedAt: string;
}

const settlePayload = z.object({
  paymentId: z.string().min(1),
  attemptId: z.string().min(1),
  outcome: z.enum(["succeeded", "failed"]),
  chargedAt: z.iso.datetime(),
});

const NOT_PAYABLE: Record<Exclude<PaymentStatus, "requires_payment" | "failed">, string> = {
  processing: "This payment is already being processed.",
  succeeded: "This payment has already been completed.",
  canceled: "This payment was canceled. Start again from the page you came from.",
  refunded: "This payment was refunded.",
};

function sandboxEventBase(row: PaymentRow, attemptId: string, at: Date) {
  return {
    id: `sbx_evt_${newToken(12)}`,
    processor: "sandbox" as const,
    occurredAt: at,
    livemode: false,
    processorPaymentId: row.processorPaymentId as string,
    attemptId,
  };
}

/**
 * Completes a sandbox payment from the card-style form. The card number picks the outcome (see
 * ./sandbox-cards) and is not kept anywhere.
 *
 * Throws validation_failed with per-field messages for bad card fields, not_found for an unknown payment
 * or a wrong secret, and conflict when the payment can no longer be paid.
 */
export async function confirmSandboxPayment(input: ConfirmSandboxPaymentInput): Promise<SandboxConfirmResult> {
  assertSandboxAvailable();
  const parsed = confirmInput.safeParse(input);
  if (!parsed.success) throw invalid("Check the card details and try again.");
  const data = parsed.data;
  if (!secretMatches("pay", data.paymentId, data.clientSecret)) throw notFound("Payment");

  const at = now();
  const fields: Record<string, string> = {};
  const card = resolveSandboxCard(data.cardNumber);
  if (!normalizeCardNumber(data.cardNumber)) fields.cardNumber = "Enter one of the test card numbers.";
  else if (!card) fields.cardNumber = "That is not a sandbox test number. Real card numbers are not accepted here: use one of the test numbers listed on this page.";
  const expiry = parseExpiry(data.expiry);
  if (!expiry) fields.expiry = "Enter the expiry date as MM/YY.";
  else if (isExpired(expiry, at)) fields.expiry = "Use any expiry date in the future.";
  if (!isValidSecurityCode(data.securityCode)) fields.securityCode = "Enter any 3 or 4 digits.";
  if (!card || Object.keys(fields).length > 0) throw invalid("Check the card details and try again.", { fields });

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, data.paymentId)).for("update");
    if (!row || row.processor !== "sandbox" || !row.processorPaymentId) throw notFound("Payment");
    if (row.status !== "requires_payment" && row.status !== "failed") throw conflict(NOT_PAYABLE[row.status]);

    const attemptId = `sbx_ch_${newToken(9)}`;
    const base = sandboxEventBase(row, attemptId, at);

    switch (card.outcome) {
      case "succeeded":
        await applyProcessorEvent({ ...base, type: "payment.succeeded", chargedAt: at, amountCents: row.amountCents, method: "card" }, tx);
        return { paymentId: row.id, status: "succeeded", failureReason: null };

      case "declined":
      case "insufficient_funds": {
        const failure = SANDBOX_FAILURE_MESSAGES[card.outcome];
        await applyProcessorEvent({ ...base, type: "payment.failed", failureReason: failure.message, failureCode: failure.code, method: "card" }, tx);
        return { paymentId: row.id, status: "failed", failureReason: failure.message };
      }

      case "processing_then_succeeded":
      case "processing_then_failed": {
        await applyProcessorEvent({ ...base, type: "payment.processing", chargedAt: at, method: "us_bank_account" }, tx);
        const payload: SettlePayload = {
          paymentId: row.id,
          attemptId,
          outcome: card.outcome === "processing_then_succeeded" ? "succeeded" : "failed",
          chargedAt: at.toISOString(),
        };
        // Same transaction as the move to "processing": a payment can never be left pending with no job to finish it.
        await enqueue(SANDBOX_SETTLE_JOB, { ...payload }, { runAt: addMs(at, SANDBOX_ASYNC_SETTLE_DELAY_MS) }, tx);
        return { paymentId: row.id, status: "processing", failureReason: null };
      }
    }
  });
}

/**
 * Handler of SANDBOX_SETTLE_JOB: finishes a payment the sandbox left in "processing". Idempotent — a payment
 * that has moved on (settled already, canceled, retried with another attempt) is left alone.
 */
export async function settleSandboxPayment(rawPayload: unknown): Promise<void> {
  const payload = settlePayload.parse(rawPayload);
  if (!isSandboxAvailable()) {
    console.warn(`[payments] Sandbox payment ${payload.paymentId} was left pending: the sandbox processor is switched off in this environment`);
    return;
  }
  const db = await getDb();
  const [row] = await db.select().from(payments).where(eq(payments.id, payload.paymentId));
  if (!row || row.processor !== "sandbox" || !row.processorPaymentId) return;
  if (row.status !== "processing" || readPaymentMeta(row).attemptId !== payload.attemptId) return;

  const base = sandboxEventBase(row, payload.attemptId, now());
  if (payload.outcome === "succeeded") {
    const event: PaymentSucceededEvent = {
      ...base,
      type: "payment.succeeded",
      // The charge time recorded when the payer submitted the form, not the moment this job happens to run.
      chargedAt: new Date(payload.chargedAt),
      amountCents: row.amountCents,
      method: "us_bank_account",
    };
    await applyProcessorEvent(event);
    return;
  }
  const failure = SANDBOX_FAILURE_MESSAGES.processing_then_failed;
  const event: PaymentFailedEvent = { ...base, type: "payment.failed", failureReason: failure.message, failureCode: failure.code, method: "us_bank_account" };
  await applyProcessorEvent(event);
}

/* The hosted sandbox invoice --------------------------------------------------------------------------- */

export interface SandboxInvoiceView {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  businessName: string | null;
  /** Pass back to `paySandboxInvoice`. */
  key: string;
}

async function loadSandboxInvoice(invoiceId: string, key: string | null | undefined): Promise<InvoiceRow> {
  assertSandboxAvailable();
  if (!secretMatches("inv", invoiceId, key)) throw notFound("Invoice");
  const db = await getDb();
  const [invoice] = await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId));
  // A draft has not been issued: it has no hosted page yet.
  if (!invoice || invoice.processor !== "sandbox" || !invoice.processorInvoiceId || invoice.status === "draft") throw notFound("Invoice");
  return invoice;
}

/** What the hosted sandbox invoice page shows. Throws not_found unless `key` is the invoice's sandbox secret. */
export async function getSandboxInvoiceView(invoiceId: string, key: string | null | undefined): Promise<SandboxInvoiceView> {
  const invoice = await loadSandboxInvoice(invoiceId, key);
  const db = await getDb();
  const lines = await db.select().from(businessInvoiceLines).where(eq(businessInvoiceLines.invoiceId, invoice.id)).orderBy(asc(businessInvoiceLines.createdAt), asc(businessInvoiceLines.id));
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, invoice.businessOrgId));
  return { invoice, lines, businessName: org?.name ?? null, key: sandboxSecret("inv", invoice.id) };
}

/** The "Mark paid (sandbox)" button: reports the invoice as paid, exactly as a processor's `invoice.paid` event would. */
export async function paySandboxInvoice(invoiceId: string, key: string | null | undefined): Promise<{ invoiceId: string; status: InvoiceStatus }> {
  const invoice = await loadSandboxInvoice(invoiceId, key);
  if (invoice.status === "paid") return { invoiceId: invoice.id, status: "paid" };
  if (invoice.status !== "open" && invoice.status !== "uncollectible") throw conflict(`This invoice is ${invoice.status} and can no longer be paid.`);
  const at = now();
  await applyProcessorEvent({
    id: `sbx_evt_${newToken(12)}`,
    processor: "sandbox",
    occurredAt: at,
    livemode: false,
    type: "invoice.paid",
    processorInvoiceId: invoice.processorInvoiceId as string,
    paidAt: at,
  });
  return { invoiceId: invoice.id, status: "paid" };
}
