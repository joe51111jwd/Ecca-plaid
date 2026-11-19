import type { AwardStatus, HandoffStatus, Mode, VerificationStatus } from "@/db/schema";
import type { schema } from "@/db/client";
import { BUSINESS_STATUS_DETAIL } from "./copy";
import { publicVerificationStatus, type PublicVerificationStatus } from "./state";

export type HandoffRow = typeof schema.handoffs.$inferSelect;
export type AwardPaymentMethod = "direct_to_vendor" | "qualified_digital_wallet" | "other";

/** What a handoff's outside surfaces may say about its linked records. */
export interface HandoffRelated {
  verificationStatus: VerificationStatus | null;
  /** The handoff's current award, if any. */
  award: { amountCents: number; paymentMethod: AwardPaymentMethod; status: AwardStatus } | null;
  sgoName: string | null;
}

/** An award stops being shown once it was revoked or declined. */
const SHOWN_AWARD_STATUSES: ReadonlySet<AwardStatus> = new Set(["offered", "accepted", "paid"]);

/** Integer cents → "450.00" (no floats). */
export function centsToUsdString(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError("cents must be a safe integer");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The webhook payload for handoff.<status> events, sent to the business. Compact on purpose: the status, the hold,
 * eligible / not eligible / pending, the award amount and how the SGO intends to pay, and the SGO's name. Never
 * income, documents, reasons, family contact details or student names. `metadata` is the business's own data,
 * echoed back so it can match the event to its booking.
 */
export interface HandoffWebhookPayload {
  id: string;
  object: "handoff";
  booking_ref: string;
  status: HandoffStatus;
  hold_expires_at: string | null;
  verification_status: PublicVerificationStatus;
  award: { amount_usd: string; payment_method: AwardPaymentMethod } | null;
  sgo: { name: string } | null;
  metadata: Record<string, string>;
}

function shownAward(related: HandoffRelated): HandoffRelated["award"] {
  return related.award && SHOWN_AWARD_STATUSES.has(related.award.status) ? related.award : null;
}

export function toWebhookPayload(row: HandoffRow, related: HandoffRelated): HandoffWebhookPayload {
  const award = shownAward(related);
  return {
    id: row.id,
    object: "handoff",
    booking_ref: row.bookingRef,
    status: row.status,
    hold_expires_at: row.holdExpiresAt ? row.holdExpiresAt.toISOString() : null,
    verification_status: publicVerificationStatus(related.verificationStatus),
    award: award ? { amount_usd: centsToUsdString(award.amountCents), payment_method: award.paymentMethod } : null,
    sgo: related.sgoName ? { name: related.sgoName } : null,
    metadata: { ...row.metadata },
  };
}

/**
 * The handoff as the business's API and portal see it. Same privacy rules as the webhook payload, plus the
 * booking fields the business itself sent. Never the handoff URL (a credential), the family's email or the student.
 */
export interface ApiHandoff extends HandoffWebhookPayload {
  mode: Mode;
  channel: "embed" | "redirect";
  created_via: "api" | "embed";
  status_detail: string;
  booking: { ref: string; description: string | null; amount_usd: string | null; amount_confirmed: boolean };
  return_url: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toApiHandoff(row: HandoffRow, related: HandoffRelated): ApiHandoff {
  return {
    ...toWebhookPayload(row, related),
    mode: row.mode,
    channel: row.channel,
    created_via: row.createdVia,
    status_detail: BUSINESS_STATUS_DETAIL[row.status],
    booking: {
      ref: row.bookingRef,
      description: row.bookingDescription,
      amount_usd: row.bookingAmountCents === null ? null : centsToUsdString(row.bookingAmountCents),
      amount_confirmed: row.bookingAmountConfirmed,
    },
    return_url: row.returnUrl,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
