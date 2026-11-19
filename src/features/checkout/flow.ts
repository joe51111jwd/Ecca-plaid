import { now } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import type { AuditRequestInfo } from "@/server/audit";
import { getCheckout, getCheckoutPayment, placeOrder, saveCheckout, startCheckout, type CheckoutPatch, type CheckoutView } from "@/server/donations";
import type { ClientPayment } from "@/server/payments";
import { stateName, US_STATE_CODES } from "@/server/sgos";
import { toClientView, toReceiptSummary, type CheckoutClientView, type ReceiptSummary } from "./view-model";

/**
 * The checkout screens' calls into the donations service, by checkout token. Server-side only: the server
 * actions and pages call these after resolving the token from the cookie (hosted) or the path (widget).
 * Every rule is the service's; this only shapes what comes back for the screens.
 */

export interface LoadedCheckout {
  view: CheckoutClientView;
  /** The order's payment while the checkout is awaiting payment; null otherwise. */
  payment: ClientPayment | null;
  raw: CheckoutView;
}

export async function loadCheckout(token: string): Promise<LoadedCheckout> {
  const raw = await getCheckout(token);
  const payment = raw.session.status === "awaiting_payment" && raw.session.paymentId ? await paymentOrNull(token) : null;
  return { view: toClientView(raw), payment, raw };
}

async function paymentOrNull(token: string): Promise<ClientPayment | null> {
  try {
    return await getCheckoutPayment(token);
  } catch (e) {
    if (isAppError(e) && (e.code === "conflict" || e.code === "not_found")) return null;
    throw e;
  }
}

export interface BeginGiftInput {
  slug: string;
  source: "hosted" | "widget";
  userId?: string | null;
  /** The amount typed on the start screen, saved straight away. */
  giftCents?: number | null;
  donorTimeZone?: string | null;
}

/** Starts a checkout (and saves the amount and time zone when given). Returns the token to hand to the browser. */
export async function beginGift(input: BeginGiftInput): Promise<{ token: string; view: CheckoutClientView }> {
  const { token, view } = await startCheckout({ sgoSlug: input.slug, source: input.source, userId: input.userId ?? null });
  const patch: CheckoutPatch = {};
  if (input.giftCents != null) patch.giftCents = input.giftCents;
  if (input.donorTimeZone) patch.donorTimeZone = input.donorTimeZone;
  if (Object.keys(patch).length === 0) return { token, view: toClientView(view) };
  try {
    return { token, view: toClientView(await saveCheckout(token, patch)) };
  } catch (e) {
    // The checkout exists either way; an amount the service refuses is shown on the form rather than losing it.
    if (isAppError(e) && e.code === "validation_failed") return { token, view: toClientView(view) };
    throw e;
  }
}

export async function saveGift(token: string, patch: unknown): Promise<CheckoutClientView> {
  return toClientView(await saveCheckout(token, patch as CheckoutPatch));
}

export interface PlaceGiftOptions {
  userId?: string | null;
  request?: AuditRequestInfo | null;
  shownDesignationTextSha256?: string | null;
}

export async function placeGift(token: string, options: PlaceGiftOptions = {}): Promise<{ view: CheckoutClientView; payment: ClientPayment }> {
  const order = await placeOrder(token, { userId: options.userId ?? null, request: options.request ?? null, shownDesignationTextSha256: options.shownDesignationTextSha256 ?? null });
  return { view: toClientView(order.view), payment: order.payment };
}

export interface LoadedReceipt {
  view: CheckoutClientView;
  receipt: ReceiptSummary;
  payment: ClientPayment | null;
}

/** The confirmation page's data: the checkout as it stands and the receipt summary of its order. */
export async function loadReceipt(token: string): Promise<LoadedReceipt> {
  const raw = await getCheckout(token);
  const payment = raw.session.paymentId ? await paymentOrNull(token) : null;
  return { view: toClientView(raw), receipt: toReceiptSummary(raw, payment, now()), payment };
}

/** What a checkout page should show for the token this browser holds (or none). */
export type ResolvedCheckout =
  | { kind: "none" }
  /** The browser held a checkout that can no longer be used (expired, canceled, unknown). */
  | { kind: "ended"; reason: "expired" | "canceled" | "unknown" }
  | { kind: "active"; loaded: LoadedCheckout }
  | { kind: "completed"; loaded: LoadedCheckout };

/**
 * Loads the checkout behind a token for a page. A token for another organization's checkout is treated as unknown,
 * so a widget URL edited to another slug cannot show one SGO's page with another's checkout.
 */
export async function resolveCheckout(token: string | null | undefined, slug: string): Promise<ResolvedCheckout> {
  if (!token) return { kind: "none" };
  let loaded: LoadedCheckout;
  try {
    loaded = await loadCheckout(token);
  } catch (e) {
    if (isAppError(e) && e.code === "gone") return { kind: "ended", reason: "expired" };
    if (isAppError(e) && (e.code === "not_found" || e.code === "validation_failed")) return { kind: "ended", reason: "unknown" };
    throw e;
  }
  if (loaded.raw.sgo.slug !== slug) return { kind: "ended", reason: "unknown" };
  switch (loaded.view.status) {
    case "completed":
      return { kind: "completed", loaded };
    case "canceled":
      return { kind: "ended", reason: "canceled" };
    case "expired":
      return { kind: "ended", reason: "expired" };
    default:
      return { kind: "active", loaded };
  }
}

/** The 50 States and D.C. for the address field. */
export function usStateOptions(): Array<{ code: string; name: string }> {
  return US_STATE_CODES.map((code) => ({ code, name: stateName(code) }));
}
