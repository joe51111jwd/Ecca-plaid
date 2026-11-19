import type { MemberRole, Mode } from "@/db/schema";

/**
 * Product policy of the SGO dashboard. None of these values comes from the spec or the regulations; each is a
 * decision the sources leave open, named here so it can be found, questioned and changed in one place.
 */

/** Cookie holding the dashboard's test/live switch. A view preference only: every service call is scoped again. */
export const SGO_MODE_COOKIE = "passport_sgo_mode";

/** Cookie holding which of the person's SGOs is on screen (validated against their memberships on every request). */
export const SGO_ORG_COOKIE = "passport_sgo_org";

/** A year: the dashboard preferences outlive a session but are re-checked on every request. */
export const SGO_PREFERENCE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** The mode a person sees until they switch. Test, so nobody lands on real data by accident. */
export const DEFAULT_MODE: Mode = "test";

/**
 * POLICY: live mode in the dashboard opens only once a platform admin has verified the organization against the SGO
 * list (its profile carries a list entry). A self-serve workspace therefore starts, and stays, in test mode until a
 * person at the platform has checked it. The spec asks for "self-serve creation of an SGO workspace in test mode"
 * and names no other gate.
 */
export const LIVE_MODE_REQUIRES_VERIFIED_LISTING = true;

/** Least role to see the dashboard at all (any member). */
export const VIEW_ROLE: MemberRole = "viewer";
/** Least role to review verifications, ask families for more, offer awards and create verifications. */
export const REVIEW_ROLE: MemberRole = "reviewer";
/**
 * Least role to change settings, API keys, webhooks and the team, and to enter donor numbers, issue
 * acknowledgments and generate the IRS report (the acknowledgments service enforces the same role).
 */
export const MANAGE_ROLE: MemberRole = "admin";

/**
 * POLICY: a deadline (January 31 acknowledgments, February 28 IRS report) is "approaching" on the home page from this
 * many days before it. The acknowledgments service starts its own reminder emails at 14 days; the dashboard shows it
 * earlier so the work can be planned.
 */
export const DEADLINE_APPROACHING_DAYS = 45;

/** POLICY: an open review task older than this many days is called out on the home page as waiting too long. */
export const REVIEW_WAITING_LONG_DAYS = 3;

/** Rows per page on the verification list and the review queue (the services cap at 100). */
export const LIST_PAGE_SIZE = 25;

/** Rows per page on the donation list. */
export const DONATION_PAGE_SIZE = 50;

/** Rows shown in the worklist per page. */
export const WORKLIST_PAGE_SIZE = 100;

/** Deliveries shown per endpoint in the delivery log. */
export const DELIVERY_LOG_LIMIT = 25;

/** Largest donor-number CSV accepted from the browser (the service caps at 5 MB as well). */
export const DONOR_NUMBER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** First calendar year the dashboard offers in tax-year pickers (the credit applies to gifts from 2027; sandbox gifts may be dated earlier). */
export const FIRST_TAX_YEAR = 2026;

/** Label used everywhere a sandbox donor number appears. */
export const SANDBOX_NUMBER_LABEL = "Sandbox number: not valid for filing";
