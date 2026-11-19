/**
 * Reference tables rendered on /docs. Keyed by the platform's own unions, so adding an event type or an error code
 * fails to compile until it is documented here.
 */
import type { ErrorCode } from "@/lib/errors";
import type { EventType } from "@/server/events";

export interface EventDoc {
  /** Which organization receives it. */
  receiver: "SGO" | "Business";
  when: string;
  /** What `data` holds. */
  data: string;
}

export const EVENT_CATALOGUE: Readonly<Record<EventType, EventDoc>> = Object.freeze({
  "verification.started": { receiver: "SGO", when: "The family opened the link and began.", data: "Verification" },
  "verification.submitted": { receiver: "SGO", when: "The family submitted documents or a data connection.", data: "Verification" },
  "verification.needs_review": { receiver: "SGO", when: "The automatic check could not decide; a person at your organization must review.", data: "Verification" },
  "verification.decided": { receiver: "SGO", when: "A decision exists (eligible or ineligible), made by the engine or a reviewer. Evidence files follow.", data: "Verification" },
  "verification.expired": { receiver: "SGO", when: "A decided result passed expires_at, or a family link expired before anyone opened it.", data: "Verification" },
  "verification.canceled": { receiver: "SGO", when: "The verification was canceled (API or dashboard).", data: "Verification" },
  "donation.succeeded": { receiver: "SGO", when: "A gift to your organization was paid.", data: "Donation" },
  "donation.refunded": { receiver: "SGO", when: "An operator recorded a refund of a gift.", data: "Donation" },
  "acknowledgment.issued": { receiver: "SGO", when: "An annual donor acknowledgment was issued (or reissued).", data: "Acknowledgment" },
  "award.offered": { receiver: "SGO", when: "Your organization offered a scholarship award.", data: "Award" },
  "handoff.started": { receiver: "Business", when: "A handoff was created; the reservation hold started.", data: "Handoff" },
  "handoff.held": { receiver: "Business", when: "The family submitted; the hold continues while the result or the SGO's decision is pending.", data: "Handoff" },
  "handoff.eligible": { receiver: "Business", when: "The household verified as eligible. Not an award and not a payment: the SGO decides next.", data: "Handoff" },
  "handoff.awarded": { receiver: "Business", when: "The SGO offered a scholarship award for the booking.", data: "Handoff" },
  "handoff.declined": { receiver: "Business", when: "No scholarship for this booking (not eligible, or the SGO did not award).", data: "Handoff" },
  "handoff.expired": { receiver: "Business", when: "The hold window passed without an award.", data: "Handoff" },
  "handoff.completed": { receiver: "Business", when: "You confirmed the booking was completed with scholarship funds.", data: "Handoff" },
});

export const ERROR_CODE_DOCS: Readonly<Record<ErrorCode, { status: number; meaning: string }>> = Object.freeze({
  bad_request: { status: 400, meaning: "The request is malformed: invalid JSON, wrong Content-Type, body too large, bad Idempotency-Key, a repeated query parameter." },
  unauthenticated: { status: 401, meaning: "Missing, malformed, unknown or revoked key. Always the same message." },
  payment_failed: { status: 402, meaning: "Not returned by API v1 endpoints." },
  forbidden: { status: 403, meaning: "The key may not do this: wrong organization type, suspended organization, live key required." },
  not_found: { status: 404, meaning: "No such record — also for another organization's or the other mode's records." },
  conflict: { status: 409, meaning: "The record is in the wrong state for this action, evidence is not ready, or an Idempotency-Key was reused or is in progress. See details.reason." },
  gone: { status: 410, meaning: "A stored file was deleted under the retention rules." },
  validation_failed: { status: 422, meaning: "Input failed validation. details.fields maps each field (snake_case, dotted for nested) to a message." },
  rate_limited: { status: 429, meaning: "Too many requests for this key. Wait Retry-After seconds." },
  internal: { status: 500, meaning: "Our fault. Retry with the same Idempotency-Key; quote the request_id if it persists." },
  not_available: { status: 503, meaning: "A dependency is temporarily unavailable. Retry later." },
});

/** Stable `details.reason` values the API returns. */
export const ERROR_REASONS: ReadonlyArray<{ reason: string; status: number; meaning: string }> = [
  { reason: "evidence_not_ready", status: 409, meaning: "No evidence file exists yet for this verification." },
  { reason: "verification_decided", status: 409, meaning: "A decided verification cannot be canceled." },
  { reason: "verification_canceled", status: 409, meaning: "Already canceled." },
  { reason: "verification_expired", status: 409, meaning: "The verification expired." },
  { reason: "idempotency_key_reused", status: 409, meaning: "The Idempotency-Key was used for a different request." },
  { reason: "idempotency_request_in_progress", status: 409, meaning: "The first request with this key is still running." },
  { reason: "invalid_idempotency_key", status: 400, meaning: "Idempotency-Key must be 1–255 printable ASCII characters without spaces." },
  { reason: "wrong_organization_type", status: 403, meaning: "SGO-only endpoint called with a business key, or the reverse." },
  { reason: "live_key_required", status: 403, meaning: "Your organization holds a live key, so webhook endpoints are changed with a live key." },
  { reason: "export_too_large", status: 422, meaning: "The CSV export would exceed its row limit; filter it." },
  { reason: "invalid_json", status: 400, meaning: "The body is not valid JSON." },
  { reason: "unsupported_content_type", status: 400, meaning: "Send Content-Type: application/json." },
  { reason: "body_too_large", status: 400, meaning: "The body exceeds the size limit." },
  { reason: "duplicate_query_parameter", status: 400, meaning: "A query parameter was given twice." },
];
