/**
 * The state machine behind <RailConnect>, kept pure so it can be tested without a browser.
 *
 *   intro ──start──▶ starting ──started──▶ provider (simulated picker | Plaid Link) ──complete──▶ completing
 *     ▲                                                                                        │
 *     └────────────────────────── retry ◀── done (ready | failed | declined | revoked) ◀────────┤
 *                                                    ▲                                         ▼
 *                                                    └──────────── refresh ◀──────────── waiting
 *
 * An `error` (a server action that failed) keeps the last good phase so the family can try again; the upload
 * escape hatch is rendered in every phase by the component.
 */
import type { LinkSessionPayload } from "@/server/rails/types";
import type { RailConnectionView } from "./types";

export type RailConnectPhase = "intro" | "starting" | "provider" | "completing" | "waiting" | "done";

export interface RailConnectState {
  phase: RailConnectPhase;
  connection: RailConnectionView | null;
  client: LinkSessionPayload | null;
  /** Message from a failed action, shown with a retry. */
  error: string | null;
}

export type RailConnectEvent =
  | { type: "start" }
  | { type: "started"; connection: RailConnectionView; client: LinkSessionPayload | null }
  | { type: "complete" }
  | { type: "updated"; connection: RailConnectionView }
  | { type: "error"; message: string }
  | { type: "retry" };

export function phaseForConnection(connection: RailConnectionView, hasClient: boolean): RailConnectPhase {
  switch (connection.status) {
    case "created":
    case "connecting":
      return hasClient ? "provider" : "done";
    case "connected":
    case "syncing":
      return "waiting";
    default:
      return "done";
  }
}

export function initialRailConnectState(connection: RailConnectionView | null | undefined): RailConnectState {
  if (!connection) return { phase: "intro", connection: null, client: null, error: null };
  // A connection still waiting for the person on the provider's screen cannot be resumed without its client
  // payload (the link token is not kept), so it starts over from the intro.
  const phase = connection.status === "created" || connection.status === "connecting" ? "intro" : phaseForConnection(connection, false);
  return { phase, connection: phase === "intro" ? null : connection, client: null, error: null };
}

export function railConnectReducer(state: RailConnectState, event: RailConnectEvent): RailConnectState {
  switch (event.type) {
    case "start":
      return state.phase === "intro" ? { ...state, phase: "starting", error: null } : state;
    case "started":
      return { phase: phaseForConnection(event.connection, event.client !== null), connection: event.connection, client: event.client, error: null };
    case "complete":
      return state.phase === "provider" ? { ...state, phase: "completing", error: null } : state;
    case "updated": {
      if (state.connection && state.connection.id !== event.connection.id) return state;
      const phase = phaseForConnection(event.connection, state.client !== null);
      return { ...state, connection: event.connection, phase, client: phase === "done" ? null : state.client, error: null };
    }
    case "error": {
      // Fall back to the last phase the family can act from.
      const phase: RailConnectPhase = state.phase === "starting" ? "intro" : state.phase === "completing" ? "provider" : state.phase;
      return { ...state, phase, error: event.message };
    }
    case "retry":
      return { phase: "intro", connection: null, client: null, error: null };
    default:
      return state;
  }
}

/** True when the outcome should steer the family to upload (failed, declined, revoked, or nothing countable found). */
export function shouldOfferUpload(state: RailConnectState): boolean {
  return state.phase === "done" && (state.connection?.offerUpload ?? true);
}
