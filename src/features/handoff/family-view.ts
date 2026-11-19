/**
 * Pure presentation logic of the family handoff page: progress, polling, the return link, the embedding origin and
 * the messages posted to the business's page. No React, no I/O, so every rule is unit-tested.
 */
import type { HandoffStatus } from "@/db/schema";
import { isAllowedReturnUrl, normalizeOrigin } from "@/server/businesses";
import { isFinal } from "@/server/handoffs";
import type { FamilyLocale } from "./copy";
import { familyPageCopy } from "./copy";

/* -------------------------------------------------------------------------------------------- progress */

export type ProgressState = "done" | "current" | "upcoming" | "stopped";

export interface ProgressStep {
  id: "held" | "verify" | "decide" | "booked";
  label: string;
  state: ProgressState;
}

/**
 * The four steps the family sees. "Organization decides" is its own step so "eligible" is visibly not the end:
 * the organization still has to decide on an award. A handoff that ended without a booking marks the step where it
 * stopped and leaves the rest upcoming: the income check when the household was never verified eligible, otherwise
 * the organization's decision (it declined or revoked, the hold expired, or the check was canceled after the
 * household was verified), so a verified family is never told its income check stopped.
 */
export function progressSteps(status: HandoffStatus, locale: FamilyLocale, opts: { verifiedEligible?: boolean } = {}): ProgressStep[] {
  const t = familyPageCopy(locale).steps;
  const ids: ProgressStep["id"][] = ["held", "verify", "decide", "booked"];
  // Index of the step the handoff is on (the first not yet done).
  const at: Record<HandoffStatus, number> = { started: 1, verifying: 1, held: 1, eligible: 2, awarded: 3, completed: 4, declined: -1, expired: -1, canceled: -1 };
  const label = (id: ProgressStep["id"]) => t[id];
  if (status === "completed") return ids.map((id) => ({ id, label: label(id), state: "done" }));
  if (isFinal(status)) {
    const stoppedAt = opts.verifiedEligible ? 2 : 1;
    return ids.map((id, i) => ({ id, label: label(id), state: i < stoppedAt ? "done" : i === stoppedAt ? "stopped" : "upcoming" }));
  }
  const current = at[status];
  return ids.map((id, i) => ({ id, label: label(id), state: i < current ? "done" : i === current ? "current" : "upcoming" }));
}

/** The page keeps re-reading its status until the handoff reaches a final state. */
export function shouldPoll(status: HandoffStatus): boolean {
  return !isFinal(status);
}

/* -------------------------------------------------------------------------------------------- return */

/** Query parameters appended to the return URL (HANDOFF_EMBED_CONTRACT.returnQuery). A hint for the business, never proof. */
export const RETURN_QUERY = ["handoff_id", "status"] as const;

/**
 * The business's return URL with `handoff_id` and `status` appended (existing query and fragment kept). Null when
 * there is no return URL or it does not parse as an absolute http(s) URL.
 */
export function buildReturnHref(returnUrl: string | null, hint: { handoffId: string; status: HandoffStatus }): string | null {
  if (!returnUrl) return null;
  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("handoff_id", hint.handoffId);
  url.searchParams.set("status", hint.status);
  return url.toString();
}

/* -------------------------------------------------------------------------------------- embedding origin */

/**
 * The origin of the page that frames /embed/handoff/{token}, as the embed script reported it (`parent_origin`),
 * accepted only when it is one of the business's allowed origins. Messages are posted to this origin and no other.
 * Null means: do not trust the frame; show the "open in a new tab" fallback instead of the handoff.
 */
export function resolveParentOrigin(raw: string | string[] | undefined | null, frameAncestors: readonly string[]): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  const r = normalizeOrigin(value);
  if (!r.ok) return null;
  return frameAncestors.includes(r.origin) ? r.origin : null;
}

/**
 * Whether a return URL may be offered from an embedded page: the same check the service makes, against the same
 * list, applied to what the page is about to render.
 */
export function returnAllowedFor(allowedOrigins: readonly string[], returnUrl: string): boolean {
  return isAllowedReturnUrl({ allowedOrigins }, returnUrl);
}

/* ------------------------------------------------------------------------------------------------ misc */

/** "450.00" → "$450.00"; null stays null. The service sends decimal strings, never floats. */
export function formatUsdString(amountUsd: string | null): string | null {
  if (amountUsd === null) return null;
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(amountUsd);
  if (!m) return null;
  const whole = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${m[1]}$${whole}.${m[3]}`;
}

/** A hex brand color for the accent bar, or null. The service already validated it; this only refuses anything else. */
export function safeBrandColor(color: string | null): string | null {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}
