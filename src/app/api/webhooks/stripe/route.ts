import { toErrorBody } from "@/lib/errors";
import { handleStripeWebhook } from "@/server/payments";

/**
 * Stripe webhook endpoint: POST /api/webhooks/stripe
 *
 * Register it in Stripe twice, both with the SNAPSHOT payload format (not "thin"): once for "Your account"
 * (invoices, destination charges) and once for "Connected accounts" (direct charges). Put both signing
 * secrets in STRIPE_WEBHOOK_SECRET, separated by a comma. Events to send: payment_intent.succeeded,
 * payment_intent.processing, payment_intent.payment_failed, payment_intent.canceled, charge.refunded,
 * invoice.paid, invoice.voided, invoice.payment_failed.
 *
 * The signature is verified against the raw body, so the body is read with `request.text()` and never
 * parsed first. The work done here is one short database transaction per event; everything slower
 * (receipts, acknowledgments, ledger updates) runs from the jobs that transaction enqueues, so Stripe gets
 * its answer quickly.
 *
 *   200  verified and applied (or nothing to do: events we do not act on, duplicates, stale events)
 *   400  missing or invalid signature
 *   409  verified, but cannot be applied yet or contradicts our records: Stripe redelivers
 *   413  body larger than any Stripe event
 *   503  Stripe is not configured here
 *
 * Stripe retries every non-2xx answer, and applying an event twice is harmless.
 */

/** Stripe event payloads are a few kilobytes; anything near this size is not one. */
const MAX_BODY_BYTES = 1_000_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const tooLarge = () => json({ error: { code: "bad_request", message: "Request body too large" } }, 413);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return tooLarge();
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return tooLarge();

    const result = await handleStripeWebhook(rawBody, request.headers.get("stripe-signature"));
    if (result.retry) return json({ received: false, retry: true }, 409);
    return json({ received: true, events: result.events, applied: result.applied });
  } catch (e) {
    const { status, body } = toErrorBody(e);
    if (status >= 500 || status === 409) console.error("[payments] Stripe webhook could not be processed", e);
    return json(body, status);
  }
}
