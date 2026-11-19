/**
 * Words for the verification timeline. Pure. The event types are written by src/server/verifications; a type this
 * table does not know is shown with its own name made readable, never hidden.
 */

const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  created: "Verification created",
  "invite.queued": "Invitation email queued",
  started: "Family opened the link",
  "consent.granted": "Family gave consent to share",
  "household.completed": "Household form completed",
  "household.changed_since_completed": "Household changed after it was completed",
  "path.changed": "Family chose how to send proof",
  "document.uploaded": "Document uploaded",
  "document.removed": "Family took a document back",
  "document.extracted": "Document read",
  "document.reviewer_keyed": "Reviewer keyed a document's fields",
  "document.purged": "Raw file deleted under the retention policy",
  "documents.released_abandoned": "Unsubmitted uploads released",
  "certification.signed": "Family signed a certification",
  "certification.withdrawn": "Family withdrew a certification",
  submitted: "Family submitted",
  "decision.waiting": "Waiting for information",
  "decision.made": "Decision recorded",
  "review.requested": "Sent to a reviewer",
  "review.assigned": "Review assigned",
  "review.unassigned": "Review unassigned",
  "review.more_info_requested": "Reviewer asked the family for more",
  "review.rerun_requested": "Reviewer re-ran the check",
  "review.resolved": "Reviewer resolved the verification",
  "review.closed": "Review task closed",
  "income.reviewer_added": "Reviewer added an income line",
  "income.reviewer_removed": "Reviewer removed an income line",
  "evidence.generated": "Evidence pack generated",
  "passport.reused": "Earlier result reused with a new consent",
  "passport.evidence_copied": "Evidence copied from the earlier result",
  "passport.fallback": "Earlier result could not be reused",
  canceled: "Verification canceled",
  expired: "Verification expired",
});

const ACTOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  family: "Family",
  user: "Staff member",
  api_key: "API key",
  system: "System",
  handoff: "Booking handoff",
});

export function timelineLabel(type: string): string {
  const known = EVENT_LABELS[type];
  if (known) return known;
  const readable = type.replace(/[._]+/g, " ").trim();
  return readable.length > 0 ? readable.charAt(0).toUpperCase() + readable.slice(1) : "Event";
}

/** Who did it: a staff member is named when the caller knows their name, otherwise by kind. */
export function timelineActor(actorType: string, actorId: string | null, names: ReadonlyMap<string, string>): string {
  if (actorType === "user" && actorId && names.has(actorId)) return names.get(actorId)!;
  return ACTOR_LABELS[actorType] ?? "Unknown";
}
