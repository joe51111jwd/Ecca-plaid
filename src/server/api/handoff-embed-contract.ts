/**
 * The contract of the point-of-booking embed script, as documented on /docs/handoffs. The script itself
 * (public/embed/handoff.js) and the framed page are built by the partner-UI module; they must implement exactly this,
 * and the docs render it from here so the page and the implementation have one reference.
 *
 * Shape follows the existing giving widget (public/embed/donate.js): one script tag, data attributes, one iframe on
 * the host the script was loaded from, messages `{ source: "ecca-embed", type, … }` checked by origin and frame.
 */
import { HANDOFF_EMBED_PATH } from "@/server/handoffs";

export interface EmbedAttribute {
  name: string;
  required: boolean;
  description: string;
}

export interface EmbedEvent {
  type: string;
  detail: string;
}

export const HANDOFF_EMBED_CONTRACT = Object.freeze({
  scriptPath: "/embed/handoff.js",
  framePath: HANDOFF_EMBED_PATH,
  /** Equal to EMBED_MESSAGE_SOURCE in src/components/layout/embed-frame (a client module, so not imported here; a test pins it). */
  messageSource: "ecca-embed",
  /** DOM event dispatched on the script element (bubbles to document) for every message below except `resize`. */
  domEvent: "passport:handoff",
  attributes: [
    { name: "data-publishable-key", required: true, description: "Your publishable key (pk_test_… or pk_live_…). Public by design: the page's origin must be on your allowed-origins list." },
    { name: "data-booking-ref", required: true, description: "Your booking or order id (at most 100 characters)." },
    { name: "data-booking-description", required: false, description: "What is being booked, shown to the family (at most 300 characters)." },
    { name: "data-booking-amount-cents", required: false, description: "Booking total in whole cents. From the browser it is recorded as unconfirmed; confirm it server-side when you complete the handoff." },
    { name: "data-return-url", required: false, description: "Where the family goes back to. Must be on one of your allowed origins." },
    { name: "data-locale", required: false, description: "en (default) or es." },
    { name: "data-target", required: false, description: "Id of the element to mount the frame in. Default: right after the script tag." },
  ] satisfies EmbedAttribute[],
  events: [
    { type: "resize", detail: "{ height } — the frame resizes itself; nothing to do." },
    { type: "handoff.created", detail: "{ handoff_id } — store it with your booking; read status with GET /api/v1/handoffs/{id}." },
    { type: "handoff.status", detail: "{ handoff_id, status, hold_expires_at } — a display hint only." },
    { type: "handoff.closed", detail: "{ handoff_id } — the family left the flow (finished or chose to leave)." },
  ] satisfies EmbedEvent[],
  /** Query parameters appended to the return URL when the family is sent back. A hint, never proof. */
  returnQuery: ["handoff_id", "status"],
});
