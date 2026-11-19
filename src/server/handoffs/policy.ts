/**
 * Product policy of the point-of-booking handoff. The spec says to hold a reservation "for a stated window" and to
 * keep the business, not the family, as the customer; it sets no numbers. Every number below is therefore a named
 * policy constant, kept in one place so it can be found, questioned and changed.
 */
import { MS } from "@/lib/clock";
import type { MemberRole } from "@/db/schema";

/** Bytes of randomness in a handoff token (256 bits). Only its hash is stored. */
export const HANDOFF_TOKEN_BYTES = 32;
/** A token is `newToken(32)`: 43 base64url characters. Anything else is rejected before a database lookup. */
export const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Hosted handoff page; the token follows it. */
export const HANDOFF_PAGE_PATH = "/h";
/** The same page, framed inside the business's booking checkout. */
export const HANDOFF_EMBED_PATH = "/embed/handoff";

/** Field-encryption purpose for the linked verification's family link token (see handoffs.familyLinkEnc). */
export const FAMILY_LINK_PURPOSE = "handoff-family-link";

/**
 * POLICY: lengths of the booking fields. They arrive from the business's server or, through the embed, from the
 * family's browser, so they are treated as untrusted display text: whitespace collapsed, control characters
 * refused, and short enough to show on one card.
 */
export const BOOKING_LIMITS = Object.freeze({
  maxRefLength: 100,
  maxDescriptionLength: 300,
  maxStudentNameLength: 100,
  maxIdempotencyKeyLength: 255,
  /** $100,000: no camp or school booking comes near it; it only catches unit mistakes (dollars sent as cents × 100). */
  maxAmountCents: 10_000_000,
});

/**
 * POLICY: rate limits on the public (publishable-key) entry point. The key is not a secret, so anyone can call it
 * from any browser; the per-key limit caps what one leaked snippet can create, the per-IP limit stops one browser
 * from flooding a business's dashboard. The server-to-server path is limited by the API layer.
 */
export const EMBED_RATE_LIMITS = Object.freeze({
  perKey: { limit: 300, windowMs: MS.hour },
  perKeyAndIp: { limit: 10, windowMs: 10 * MS.minute },
});

/**
 * POLICY: how much the business may add to the original hold window over the life of one handoff (30 days, the
 * same ceiling as the hold window itself), and the largest single extension.
 */
export const HOLD_EXTENSION_LIMITS = Object.freeze({ maxTotalHours: 720, maxSingleHours: 720 });

/** POLICY: the least business role that may extend, complete or cancel a handoff in the portal (any member above viewer). */
export const HANDOFF_OPERATOR_ROLE: MemberRole = "reviewer";

/** POLICY: how many handoffs one run of the recurring jobs processes. Leftovers are picked up by the next run. */
export const HANDOFF_JOB_BATCH = 200;
/** How often holds are checked for expiry, and how often pre-decision progress is synced from the verification. */
export const EXPIRE_HOLDS_EVERY_MS = 5 * MS.minute;
export const SYNC_PROGRESS_EVERY_MS = 5 * MS.minute;

/** List paging for the business portal and the API. */
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 200;
