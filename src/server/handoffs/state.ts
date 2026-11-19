import type { HandoffStatus, VerificationStatus } from "@/db/schema";

/**
 * The handoff state machine, in one place.
 *
 *   started → verifying → held → eligible → awarded → completed
 *      │          │         │       │          │
 *      └──────────┴─────────┴───────┴──→ declined   (verification not eligible, or the SGO does not award / revokes)
 *      └──────────┴─────────┴───────┴──→ expired    (hold window passed without an award)
 *      └──────────┴─────────┴───────┴──────────┴──→ canceled (business or family)
 *
 * Forward skips are legal (a reused passport result can make a just-started handoff eligible at once; a family can
 * submit before the progress sync noticed it began). Nothing moves backwards, and the four final states are final.
 * "eligible" is NOT a promise of payment: an award is a separate, explicit SGO decision.
 */

export const HANDOFF_STATUSES: readonly HandoffStatus[] = ["started", "verifying", "held", "eligible", "awarded", "completed", "declined", "expired", "canceled"];

const TRANSITIONS: Readonly<Record<HandoffStatus, readonly HandoffStatus[]>> = Object.freeze({
  started: ["verifying", "held", "eligible", "declined", "expired", "canceled"],
  verifying: ["held", "eligible", "declined", "expired", "canceled"],
  held: ["eligible", "declined", "expired", "canceled"],
  eligible: ["awarded", "declined", "expired", "canceled"],
  awarded: ["completed", "declined", "canceled"],
  completed: [],
  declined: [],
  expired: [],
  canceled: [],
});

export function isHandoffStatus(v: unknown): v is HandoffStatus {
  return typeof v === "string" && (HANDOFF_STATUSES as readonly string[]).includes(v);
}

/** Is `from → to` a legal move? A status never "moves" to itself. */
export function canTransition(from: HandoffStatus, to: HandoffStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: HandoffStatus): readonly HandoffStatus[] {
  return TRANSITIONS[from];
}

export const FINAL_STATUSES: ReadonlySet<HandoffStatus> = new Set(["completed", "declined", "expired", "canceled"]);

export function isFinal(status: HandoffStatus): boolean {
  return FINAL_STATUSES.has(status);
}

/** Statuses during which the reservation is being held and the hold window can run out. */
export const HOLDING_STATUSES: readonly HandoffStatus[] = ["started", "verifying", "held", "eligible"];

export function isHolding(status: HandoffStatus): boolean {
  return HOLDING_STATUSES.includes(status);
}

/**
 * Is the reservation still held at `at`? A holding status AND a deadline still in the future. The deadline itself
 * already counts as passed, matching the expiry job (`holdExpiresAt <= now` expires).
 */
export function holdIsActive(h: { status: HandoffStatus; holdExpiresAt: Date | null }, at: Date): boolean {
  return isHolding(h.status) && h.holdExpiresAt !== null && h.holdExpiresAt.getTime() > at.getTime();
}

/**
 * What the business (and anyone outside the SGO) may learn about the verification: eligible, not eligible, or
 * pending. Review states, expiry and cancellation all read as pending; never income, documents or reasons.
 */
export type PublicVerificationStatus = "pending" | "eligible" | "not_eligible";

export function publicVerificationStatus(status: VerificationStatus | null | undefined): PublicVerificationStatus {
  if (status === "eligible") return "eligible";
  if (status === "ineligible") return "not_eligible";
  return "pending";
}

/** The facts of a verification that decide where its handoff should be. */
export interface VerificationProgress {
  status: VerificationStatus;
  startedAt: Date | null;
  submittedAt: Date | null;
}

/**
 * Where a handoff should move given its verification, or null for "no move". Pure, so the mapping can be tested on
 * its own:
 *   eligible → eligible; ineligible → declined; canceled → canceled;
 *   needs_review, or pending after the family submitted → held; pending after the family opened the link → verifying;
 *   expired → no move (the hold window decides).
 * A target that is not a legal move from the current status (e.g. "held" for an already eligible handoff) is null.
 * Once an award is offered the verification no longer moves the handoff: undoing an award is the SGO's explicit
 * decision (revoking it), never a side effect of a re-review.
 */
export function targetForVerification(current: HandoffStatus, v: VerificationProgress): HandoffStatus | null {
  if (!isHolding(current)) return null;
  let target: HandoffStatus | null = null;
  switch (v.status) {
    case "eligible":
      target = "eligible";
      break;
    case "ineligible":
      target = "declined";
      break;
    case "canceled":
      target = "canceled";
      break;
    case "needs_review":
      target = "held";
      break;
    case "pending":
      target = v.submittedAt ? "held" : v.startedAt ? "verifying" : null;
      break;
    case "expired":
      target = null;
      break;
  }
  if (target === null || target === current || !canTransition(current, target)) return null;
  return target;
}
