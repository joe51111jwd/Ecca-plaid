import Stripe from "stripe";
import { vi, type Mock } from "vitest";
import { STRIPE_API_VERSION, StripeProcessor, type StripeClient } from "./stripe";

/**
 * A stand-in for the Stripe client, for tests only. No network: every resource method is a recording mock
 * that answers with a small synthetic object shaped like Stripe's, and `webhooks` is the SDK's real
 * signature code (it is pure). Not imported by application code.
 */

type AnyRecord = Record<string, unknown>;

export interface FakeStripe {
  client: StripeClient;
  paymentIntents: { create: Mock; retrieve: Mock; cancel: Mock };
  refunds: { create: Mock };
  customers: { create: Mock; update: Mock };
  invoices: { create: Mock; finalizeInvoice: Mock; voidInvoice: Mock; pay: Mock };
  invoiceItems: { create: Mock };
  /** Intents by id, as the fake "Stripe" currently holds them. Mutate to stage a state (paid, declined…). */
  intents: Map<string, AnyRecord>;
}

/** Unix seconds of a fixed synthetic charge time: 2026-12-31T23:59:30-06:00 (New Year's Eve in Texas). */
export const SYNTHETIC_CHARGE_CREATED = Math.floor(Date.parse("2026-12-31T23:59:30-06:00") / 1000);

export function createFakeStripe(options: { livemode?: boolean } = {}): FakeStripe {
  const livemode = options.livemode ?? false;
  const intents = new Map<string, AnyRecord>();
  const byIdempotencyKey = new Map<string, AnyRecord>();
  const invoiceTotals = new Map<string, number>();
  let serial = 0;
  const next = (prefix: string) => `${prefix}_synthetic${++serial}`;

  /** Like Stripe: the same idempotency key returns the first answer. */
  const once = <T extends AnyRecord>(requestOptions: AnyRecord | undefined, make: () => T): T => {
    const key = typeof requestOptions?.idempotencyKey === "string" ? requestOptions.idempotencyKey : null;
    if (key && byIdempotencyKey.has(key)) return byIdempotencyKey.get(key) as T;
    const made = make();
    if (key) byIdempotencyKey.set(key, made);
    return made;
  };

  const paymentIntents = {
    create: vi.fn(async (params: AnyRecord, requestOptions?: AnyRecord) =>
      once(requestOptions, () => {
        const id = next("pi");
        const intent: AnyRecord = {
          id,
          object: "payment_intent",
          amount: params.amount,
          amount_received: 0,
          currency: params.currency,
          client_secret: `${id}_secret_synthetic`,
          status: "requires_payment_method",
          last_payment_error: null,
          latest_charge: null,
          canceled_at: null,
          cancellation_reason: null,
          livemode,
          metadata: params.metadata ?? {},
        };
        intents.set(id, intent);
        return intent;
      }),
    ),
    retrieve: vi.fn(async (id: string) => {
      const intent = intents.get(id);
      if (!intent) throw new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", message: `No such payment_intent: '${id}'` });
      return intent;
    }),
    cancel: vi.fn(async (id: string, params?: AnyRecord) => {
      const intent = intents.get(id);
      if (!intent) throw new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", message: `No such payment_intent: '${id}'` });
      if (intent.status === "succeeded" || intent.status === "processing") {
        throw new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "payment_intent_unexpected_state", message: `You cannot cancel this PaymentIntent because it has a status of ${String(intent.status)}.` });
      }
      Object.assign(intent, { status: "canceled", canceled_at: 1_800_000_000, cancellation_reason: params?.cancellation_reason ?? null });
      return intent;
    }),
  };

  const refunds = {
    create: vi.fn(async (params: AnyRecord, requestOptions?: AnyRecord) =>
      once(requestOptions, () => ({ id: next("re"), object: "refund", status: "succeeded", created: 1_800_000_500, amount: intents.get(String(params.payment_intent))?.amount ?? 0, payment_intent: params.payment_intent })),
    ),
  };

  const customers = {
    create: vi.fn(async (_params: AnyRecord, requestOptions?: AnyRecord) => once(requestOptions, () => ({ id: next("cus"), object: "customer" }))),
    update: vi.fn(async (id: string) => ({ id, object: "customer" })),
  };

  const invoices = {
    create: vi.fn(async (_params: AnyRecord, requestOptions?: AnyRecord) =>
      once(requestOptions, () => {
        const id = next("in");
        invoiceTotals.set(id, 0);
        return { id, object: "invoice", status: "draft", livemode };
      }),
    ),
    finalizeInvoice: vi.fn(async (id: string) => ({
      id,
      object: "invoice",
      status: "open",
      livemode,
      total: invoiceTotals.get(id) ?? 0,
      hosted_invoice_url: `https://invoice.stripe.example/i/${id}`,
    })),
    voidInvoice: vi.fn(async (id: string) => ({ id, object: "invoice", status: "void", livemode })),
    pay: vi.fn(async (id: string) => ({ id, object: "invoice", status: "paid", livemode })),
  };

  const invoiceItems = {
    create: vi.fn(async (params: AnyRecord, requestOptions?: AnyRecord) =>
      once(requestOptions, () => {
        const invoiceId = String(params.invoice);
        invoiceTotals.set(invoiceId, (invoiceTotals.get(invoiceId) ?? 0) + Number(params.amount));
        return { id: next("ii"), object: "invoiceitem" };
      }),
    ),
  };

  const client = { paymentIntents, refunds, customers, invoices, invoiceItems, webhooks: Stripe.webhooks } as unknown as StripeClient;
  return { client, paymentIntents, refunds, customers, invoices, invoiceItems, intents };
}

export const SYNTHETIC_WEBHOOK_SECRET = "whsec_synthetic_platform_secret";
export const SYNTHETIC_CONNECT_WEBHOOK_SECRET = "whsec_synthetic_connect_secret";

export function createFakeStripeProcessor(options: { livemode?: boolean; webhookSecrets?: string[] } = {}): { processor: StripeProcessor; stripe: FakeStripe } {
  const stripe = createFakeStripe({ livemode: options.livemode });
  const processor = new StripeProcessor({
    client: stripe.client,
    webhookSecrets: options.webhookSecrets ?? [SYNTHETIC_WEBHOOK_SECRET, SYNTHETIC_CONNECT_WEBHOOK_SECRET],
    keyMode: options.livemode ? "live" : "test",
  });
  return { processor, stripe };
}

/** Stages the fake so that an intent looks paid, with a charge created at `chargeCreated` (Unix seconds). */
export function markIntentPaid(stripe: FakeStripe, intentId: string, options: { chargeCreated?: number; method?: string } = {}): AnyRecord {
  const intent = stripe.intents.get(intentId);
  if (!intent) throw new Error(`No fake intent ${intentId}`);
  Object.assign(intent, {
    status: "succeeded",
    amount_received: intent.amount,
    latest_charge: {
      id: `ch_${intentId}`,
      object: "charge",
      created: options.chargeCreated ?? SYNTHETIC_CHARGE_CREATED,
      payment_method_details: { type: options.method ?? "card" },
    },
  });
  return intent;
}

let eventSerial = 0;

/** A synthetic snapshot event, serialized the way Stripe posts it. */
export function stripeEventBody(type: string, object: AnyRecord, overrides: AnyRecord = {}): string {
  return JSON.stringify({
    id: `evt_synthetic${++eventSerial}`,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_800_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object },
    ...overrides,
  });
}

/**
 * The `Stripe-Signature` header for a body, built with the SDK's documented test helper
 * (`stripe.webhooks.generateTestHeaderString`). `timestamp` is Unix seconds; default now.
 */
export function signStripeBody(body: string, secret: string = SYNTHETIC_WEBHOOK_SECRET, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret, ...(timestamp ? { timestamp } : {}) });
}
