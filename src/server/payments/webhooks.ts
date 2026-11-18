import { applyProcessorEvent } from "./events";
import { processorFor } from "./processor";

/** What came of one webhook request. */
export interface WebhookResult {
  /** Normalized events the request carried (0 for event types we do not act on). */
  events: number;
  /** How many of them changed a record. */
  applied: number;
  /**
   * True when an event could not be applied yet because it depends on one that has not arrived (a refund
   * before its payment's success). The route answers with a non-2xx status so the processor redelivers.
   */
  retry: boolean;
}

/**
 * Verifies and applies one Stripe webhook request. `rawBody` must be the exact bytes Stripe sent
 * (`await request.text()`), because the signature is computed over them.
 *
 * Throws AppError("bad_request") when the signature does not verify, AppError("not_available") when Stripe
 * is not configured, and whatever applying an event throws (the processor then redelivers). Safe to call
 * any number of times with the same request: applying an event twice changes nothing.
 */
export async function handleStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookResult> {
  const events = await processorFor("stripe").parseWebhook(rawBody, signatureHeader);
  const result: WebhookResult = { events: events.length, applied: 0, retry: false };
  for (const event of events) {
    const outcome = await applyProcessorEvent(event);
    if (outcome.applied) result.applied++;
    if (outcome.retry) result.retry = true;
  }
  return result;
}
