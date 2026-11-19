/**
 * Pure read-model shaping for the business portal (/partner): the conversion funnel, holds expiring soon, the
 * handoff timeline, the install snippets and the webhook event list. No I/O, so it is unit-tested directly.
 */
import type { HandoffStatus, Mode } from "@/db/schema";
import { EVENT_CATALOGUE } from "@/server/api";
import { EVENT_TYPES, type EventType } from "@/server/events";
import { BUSINESS_STATUS_DETAIL, HOLDING_STATUSES, type HandoffConversionStats } from "@/server/handoffs";
import { EMBED_SCRIPT_PATH, HOLD_EXTENSION_CHOICES_HOURS } from "./policy";

/* ------------------------------------------------------------------------------------------------ mode */

/** `?mode=live|test`; anything else falls back to the deployment's default mode. */
export function pickMode(value: string | string[] | undefined | null, fallback: Mode): Mode {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "live" || v === "test" ? v : fallback;
}

/** A portal path with the organization and mode carried along (only when they differ from the defaults). */
export function portalHref(path: string, ctx: { orgId: string; mode: Mode; defaultOrgId: string; defaultMode: Mode }, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  if (ctx.orgId !== ctx.defaultOrgId) q.set("org", ctx.orgId);
  if (ctx.mode !== ctx.defaultMode) q.set("mode", ctx.mode);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/* ---------------------------------------------------------------------------------------------- funnel */

export interface FunnelStep {
  key: "started" | "eligible" | "awarded" | "completed";
  label: string;
  count: number;
  /** Share of all handoffs, as a whole-number percent string ("42%"); "—" when there are none. */
  share: string;
  description: string;
}

export interface Funnel {
  total: number;
  steps: FunnelStep[];
  /** Handoffs that ended without a booking, by reason. */
  ended: { declined: number; expired: number; canceled: number };
  /** Handoffs whose reservation is still held right now. */
  holding: number;
}

/** floor(100 × n / d) as "N%"; "—" for d = 0. Integer arithmetic. */
export function percent(n: number, d: number): string {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n < 0 || d < 0) throw new Error("percent: whole, non-negative numbers only");
  if (d === 0) return "—";
  return `${Math.floor((n * 100) / d)}%`;
}

/**
 * The funnel from the service's status counts. Each step counts the handoffs that reached it at some point (a
 * completed booking also passed "eligible" and "awarded"), so the numbers only ever go down step by step.
 */
export function buildFunnel(stats: HandoffConversionStats): Funnel {
  const s = stats.byStatus;
  const awarded = s.awarded + s.completed;
  const steps: FunnelStep[] = [
    { key: "started", label: "Families started", count: stats.total, share: percent(stats.total, stats.total), description: "Clicked the scholarship button and got a handoff link." },
    { key: "eligible", label: "Verified eligible", count: stats.reachedEligible, share: percent(stats.reachedEligible, stats.total), description: "Household income verified under the limit. Not an award." },
    { key: "awarded", label: "Awarded by the SGO", count: awarded, share: percent(awarded, stats.total), description: "The scholarship organization offered an award for the booking." },
    { key: "completed", label: "Bookings completed", count: stats.completed, share: percent(stats.completed, stats.total), description: "You confirmed the booking was completed with scholarship funds." },
  ];
  return {
    total: stats.total,
    steps,
    ended: { declined: s.declined, expired: s.expired, canceled: s.canceled },
    holding: HOLDING_STATUSES.reduce((sum, st) => sum + s[st], 0),
  };
}

/* --------------------------------------------------------------------------------------- hold extension */

/**
 * The hold-extension choices (hours) the portal offers when `remainingHours` of the handoff's lifetime extension
 * allowance are left: the policy choices that fit, plus the whole remainder when it is smaller than every choice, so
 * a hold that can still be extended never shows an empty picker. Empty when nothing is left.
 */
export function holdExtensionChoices(remainingHours: number, choices: readonly number[] = HOLD_EXTENSION_CHOICES_HOURS): number[] {
  const left = Number.isFinite(remainingHours) ? Math.floor(remainingHours) : 0;
  if (left < 1) return [];
  const fitting = choices.filter((h) => Number.isInteger(h) && h >= 1 && h <= left);
  return fitting.length > 0 ? fitting : [left];
}

/* ------------------------------------------------------------------------------------- expiring holds */

/** "in 3 hours", "in 45 minutes", "in 2 days" — for a deadline after `at`. */
export function timeUntil(deadline: Date, at: Date): string {
  const ms = deadline.getTime() - at.getTime();
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `in ${days} days`;
}

/* -------------------------------------------------------------------------------------------- timeline */

export interface AuditEntryLike {
  id: string;
  at: Date;
  action: string;
  actorType: string;
  metadata: Record<string, unknown> | null;
}

export interface TimelineEntry {
  id: string;
  title: string;
  description?: string;
  at: Date;
  actor: string;
  tone: "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "caution";
}

const ACTOR_LABEL: Record<string, string> = { user: "Your team", api_key: "Your server (API key)", system: "System", family: "Family", webhook: "Processor" };

const STATUS_TITLE: Record<HandoffStatus, { title: string; tone: TimelineEntry["tone"] }> = {
  started: { title: "Handoff started", tone: "info" },
  verifying: { title: "Family began income verification", tone: "info" },
  held: { title: "Family submitted; result pending", tone: "brand" },
  eligible: { title: "Household verified eligible (awaiting the SGO's award decision)", tone: "info" },
  awarded: { title: "SGO offered a scholarship award", tone: "success" },
  completed: { title: "Booking marked completed with scholarship funds", tone: "success" },
  declined: { title: "No scholarship for this booking", tone: "neutral" },
  expired: { title: "Hold expired", tone: "warning" },
  canceled: { title: "Handoff canceled", tone: "neutral" },
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Timeline entries from the handoff's audit trail (oldest first). Only business-safe facts: no decline reasons from
 * the SGO, nothing about the household.
 */
export function timelineFromAudit(entries: readonly AuditEntryLike[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : 1))) {
    const actor = ACTOR_LABEL[e.actorType] ?? "System";
    const m = e.metadata ?? {};
    if (e.action === "handoff.create") {
      out.push({ id: e.id, title: "Handoff created", description: str(m.createdVia) === "embed" ? "From the button on your booking page." : "From your server (API).", at: e.at, actor, tone: "neutral" });
    } else if (e.action === "handoff.sgo_chosen") {
      out.push({ id: e.id, title: "Family chose a scholarship organization", at: e.at, actor, tone: "neutral" });
    } else if (e.action === "handoff.link_reissued") {
      out.push({ id: e.id, title: "Family link reissued", at: e.at, actor, tone: "neutral" });
    } else if (e.action === "handoff.hold_extended") {
      const hours = typeof m.hours === "number" ? m.hours : null;
      const to = str(m.to);
      out.push({ id: e.id, title: hours ? `Hold extended by ${hours} hours` : "Hold extended", ...(to ? { description: `New deadline: ${to}` } : {}), at: e.at, actor, tone: "brand" });
    } else if (e.action.startsWith("handoff.")) {
      const status = e.action.slice("handoff.".length) as HandoffStatus;
      const spec = STATUS_TITLE[status];
      if (!spec) continue;
      const reason = status === "canceled" && e.actorType === "user" ? str(m.reason) : null;
      out.push({ id: e.id, title: spec.title, description: reason ? `Reason: ${reason}` : BUSINESS_STATUS_DETAIL[status], at: e.at, actor, tone: spec.tone });
    }
  }
  return out;
}

/* --------------------------------------------------------------------------------------------- install */

function attrEscape(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The copy-paste embed snippet for this business. */
export function embedSnippet(appOrigin: string, publishableKey: string, mode: "button" | "inline" = "button"): string {
  return `<script
  src="${attrEscape(appOrigin)}${EMBED_SCRIPT_PATH}"
  data-publishable-key="${attrEscape(publishableKey)}"
  data-booking-ref="YOUR-BOOKING-ID"
  data-booking-description="Session 2, June 8-12"
  data-booking-amount-cents="45000"
  data-return-url="https://your-site.example/booking/YOUR-BOOKING-ID"
  data-mode="${mode}"
  async></script>
<script>
  // A hint for your page only. Confirm the status on your server (webhook or GET /api/v1/handoffs/{id}).
  document.addEventListener("passport:handoff:created", (event) => {
    saveHandoffId(event.detail.handoff_id);
  });
</script>`;
}

/** The server-to-server create call (secret key, never in the browser). */
export function serverCreateExample(appOrigin: string): string {
  return `curl ${appOrigin}/api/v1/handoffs \\
  -H "Authorization: Bearer $PASSPORT_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: booking-BK-2027-0042" \\
  -d '{
    "booking_ref": "BK-2027-0042",
    "booking_description": "Session 2, June 8-12",
    "booking_amount_cents": 45000,
    "return_url": "https://your-site.example/booking/BK-2027-0042",
    "channel": "redirect"
  }'
# The response has "url": send the family there. Keep the handoff "id"; never store or log the url.`;
}

export interface WebhookEventDoc {
  type: EventType;
  when: string;
}

/** The events a business receives, with when each fires (from the API's event catalogue). */
export function businessWebhookEvents(): WebhookEventDoc[] {
  return EVENT_TYPES.filter((t) => EVENT_CATALOGUE[t].receiver === "Business").map((t) => ({ type: t, when: EVENT_CATALOGUE[t].when }));
}
