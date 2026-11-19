/**
 * Messages the framed handoff page posts to the business's page, and the DOM-event names the embed script turns them
 * into. Client-safe (no server imports): the framed page's client component builds these.
 *
 * Contract (HANDOFF_EMBED_CONTRACT in src/server/api, rendered on /docs): every message is
 * `{ source: "ecca-embed", type, … }`, posted only to the verified embedding origin, and carries no family data.
 */
import type { HandoffStatus } from "@/db/schema";

/** `source` of every message the framed page posts (equal to EMBED_MESSAGE_SOURCE in src/components/layout). */
export const MESSAGE_SOURCE = "ecca-embed";

export interface HandoffStatusMessage {
  source: typeof MESSAGE_SOURCE;
  type: "handoff.status";
  handoff_id: string;
  status: HandoffStatus;
  hold_expires_at: string | null;
}

export interface HandoffClosedMessage {
  source: typeof MESSAGE_SOURCE;
  type: "handoff.closed";
  handoff_id: string;
  status: HandoffStatus;
}

/** Status hint for the host page: id, status and the hold deadline only. */
export function statusMessage(view: { id: string; status: HandoffStatus; hold: { expiresAt: string | null } }): HandoffStatusMessage {
  return { source: MESSAGE_SOURCE, type: "handoff.status", handoff_id: view.id, status: view.status, hold_expires_at: view.hold.expiresAt };
}

/** The family left the framed flow (chose to return to the booking page). */
export function closedMessage(view: { id: string; status: HandoffStatus }): HandoffClosedMessage {
  return { source: MESSAGE_SOURCE, type: "handoff.closed", handoff_id: view.id, status: view.status };
}

/** DOM events the embed script dispatches on its script element (they bubble to document). */
export const DOM_EVENTS = Object.freeze({
  /** Every message, with `detail.type` set (the documented contract name). */
  any: "passport:handoff",
  created: "passport:handoff:created",
  status: "passport:handoff:status",
  closed: "passport:handoff:closed",
  error: "passport:handoff:error",
});
