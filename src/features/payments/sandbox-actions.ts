"use server";

import { MS } from "@/lib/clock";
import { actionError, type ActionResult } from "@/lib/errors";
import { assertSandboxAvailable, confirmSandboxPayment, paySandboxInvoice, type SandboxConfirmResult } from "@/server/payments";
import { enforceRateLimit } from "@/server/ratelimit";

/**
 * Server actions behind the sandbox pay form and the sandbox invoice page.
 *
 * There is no signed-in user here by design: a donor pays without an account, and a business opens its
 * invoice from an email. What authorizes each call is the secret that came with the page (the sandbox's
 * equivalent of a processor client secret), which the service checks before it does anything. Both actions
 * refuse to run where the sandbox is switched off.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** A person retyping a card number needs a handful of tries; a script does not get more. */
const ATTEMPTS = { limit: 30, windowMs: 10 * MS.minute };

/**
 * Completes a sandbox payment from the card-style form. The card number is used to pick the outcome and is
 * not stored, logged or returned.
 */
export async function submitSandboxPaymentAction(_previous: ActionResult<SandboxConfirmResult> | null, formData: FormData): Promise<ActionResult<SandboxConfirmResult>> {
  try {
    assertSandboxAvailable();
    const paymentId = text(formData, "paymentId").slice(0, 100);
    await enforceRateLimit(`sandbox-pay:${paymentId}`, ATTEMPTS);
    const result = await confirmSandboxPayment({
      paymentId,
      clientSecret: text(formData, "clientSecret"),
      cardNumber: text(formData, "sandboxCardNumber"),
      expiry: text(formData, "sandboxExpiry"),
      securityCode: text(formData, "sandboxSecurityCode"),
    });
    return { ok: true, data: result };
  } catch (e) {
    return actionError(e);
  }
}

/** The "Mark paid (sandbox)" button on the hosted sandbox invoice page. */
export async function paySandboxInvoiceAction(_previous: ActionResult<{ invoiceId: string }> | null, formData: FormData): Promise<ActionResult<{ invoiceId: string }>> {
  try {
    assertSandboxAvailable();
    const invoiceId = text(formData, "invoiceId").slice(0, 100);
    await enforceRateLimit(`sandbox-invoice:${invoiceId}`, ATTEMPTS);
    const result = await paySandboxInvoice(invoiceId, text(formData, "key"));
    return { ok: true, data: { invoiceId: result.invoiceId } };
  } catch (e) {
    return actionError(e);
  }
}
