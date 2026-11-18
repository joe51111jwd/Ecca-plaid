/** Every domain event the platform emits. Webhook endpoints subscribe to these names. */
export const EVENT_TYPES = [
  "verification.started",
  "verification.submitted",
  "verification.needs_review",
  "verification.decided",
  "verification.expired",
  "verification.canceled",
  "donation.succeeded",
  "donation.refunded",
  "acknowledgment.issued",
  "award.offered",
  "handoff.started",
  "handoff.held",
  "handoff.eligible",
  "handoff.awarded",
  "handoff.declined",
  "handoff.expired",
  "handoff.completed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(v: string): v is EventType {
  return (EVENT_TYPES as readonly string[]).includes(v);
}
