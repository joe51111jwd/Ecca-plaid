/**
 * UI policy of the point-of-booking surfaces (family handoff page, embed, business portal, demo camp). The spec sets
 * none of these numbers; each is a named constant so it can be found, questioned and changed in one place.
 */
import { MS } from "@/lib/clock";

/** POLICY: how often an open family handoff page re-reads its status while the tab is visible. */
export const STATUS_POLL_INTERVAL_MS = 10 * MS.second;

/** POLICY: how often the demo camp's booking-status page re-reads the handoff (it stands in for a webhook receiver). */
export const DEMO_STATUS_POLL_INTERVAL_MS = 5 * MS.second;

/** POLICY: a hold counts as "expiring soon" on the portal home when its deadline is within this window. */
export const EXPIRING_SOON_MS = 24 * MS.hour;

/** POLICY: how many handoffs the portal home scans for expiring holds and how many it lists. */
export const EXPIRING_SCAN_LIMIT = 200;
export const EXPIRING_LIST_LIMIT = 10;

/** POLICY: page size of the portal's handoff table. */
export const PORTAL_PAGE_SIZE = 25;

/** POLICY: largest request body the public (publishable-key) create endpoint reads. A booking is a few hundred bytes. */
export const PUBLIC_CREATE_MAX_BODY_BYTES = 8 * 1024;

/** POLICY: how long browsers may cache the public endpoint's CORS preflight answer. */
export const PUBLIC_CREATE_PREFLIGHT_MAX_AGE_SECONDS = 600;

/** POLICY: hold-extension choices offered in the portal (hours). The service enforces the real limits. */
export const HOLD_EXTENSION_CHOICES_HOURS: readonly number[] = [12, 24, 48, 72];

/**
 * POLICY: how many businesses one signed-in person may set up through /partner/signup per window. Signing up is
 * self-serve (any person with a working email address) and every business gets a publishable key, so it is capped
 * to stop scripted mass creation; a platform admin can still create more on someone's behalf.
 */
export const SIGNUP_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: MS.day });

/** Public create endpoint for the embed script (POST, CORS). */
export const PUBLIC_CREATE_PATH = "/embed/handoff/create";

/** Path of the embed script. Must equal HANDOFF_EMBED_CONTRACT.scriptPath (a test pins it). */
export const EMBED_SCRIPT_PATH = "/embed/handoff.js";

/** Business portal root. */
export const PORTAL_HOME = "/partner";

/** The demo camp site's root. */
export const DEMO_CAMP_HOME = "/demo/camp";

/**
 * POLICY: the demo camp (and the demo data it seeds) exists only where publishable keys are test keys, i.e. outside
 * production deployments. It creates organizations with a system actor, which must never happen on a live system.
 */
export function demoEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
