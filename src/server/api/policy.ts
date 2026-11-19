/**
 * Product policy of the public HTTP API (v1). None of these values comes from the spec or the proposed rules; where
 * the sources are silent the behaviour is a named constant here so it can be found, questioned and changed in one
 * place. Every value is documented on /docs/errors (rate limits, idempotency) or /docs (keys).
 */
import { MS } from "@/lib/clock";

/** Base path of the versioned API. Every route handler lives under src/app/api/v1. */
export const API_BASE_PATH = "/api/v1";
export const API_VERSION = "v1";

/* ---------------------------------------------------------------------------------------------- keys */

/** Secret keys look like `ecca_test_<43 base64url chars>` (256 random bits). */
export const API_KEY_PREFIX = { test: "ecca_test_", live: "ecca_live_" } as const;
export const API_KEY_RANDOM_BYTES = 32;
/** What a well-formed key looks like. Anything else is refused before any database lookup. */
export const API_KEY_PATTERN = /^ecca_(test|live)_([A-Za-z0-9_-]{32,128})$/;
/** Characters of the random part kept in the display prefix (`ecca_test_AbC123`), so people can tell keys apart. */
export const API_KEY_DISPLAY_CHARS = 6;
export const API_KEY_NAME_MAX = 100;
/** Active (unrevoked) keys one organization may hold per mode. */
export const MAX_ACTIVE_KEYS_PER_MODE = 20;
/** `last_used_at` is written at most this often per key, so a busy key does not turn every read into a write. */
export const LAST_USED_WRITE_INTERVAL_MS = MS.minute;

/**
 * POLICY: which organizations may hold and use live keys. The spec names no gate; the platform has no separate
 * "API live" setting, so live mode follows the organization's status: only an `active` organization can create or
 * use a live key. Test keys work for `active` and `pending` organizations. A `suspended` organization's keys stop
 * working in both modes.
 */
export const LIVE_KEY_ORG_STATUSES = ["active"] as const;
export const TEST_KEY_ORG_STATUSES = ["active", "pending"] as const;

/* ------------------------------------------------------------------------------------- rate limits */

/** Requests per API key per window (fixed window, see src/server/ratelimit). */
export const API_RATE_LIMIT = Object.freeze({ limit: 600, windowMs: MS.minute });
/**
 * Failed authentications per client IP per window. Keys are 256-bit secrets, so this is not about guessing; it keeps
 * a misconfigured client hammering with a revoked key from loading the database.
 */
export const AUTH_FAILURE_RATE_LIMIT = Object.freeze({ limit: 120, windowMs: 10 * MS.minute });

/* ------------------------------------------------------------------------------------- idempotency */

/** An Idempotency-Key is remembered this long; after that the same key starts a new request. */
export const IDEMPOTENCY_TTL_MS = 24 * MS.hour;
/**
 * A first request that has not finished after this long is treated as abandoned (the process died mid-request), so
 * a retry with the same key may take it over instead of being refused until the key expires.
 */
export const IDEMPOTENCY_IN_FLIGHT_TIMEOUT_MS = 2 * MS.minute;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;
/** Field-encryption purpose for stored responses (a create response carries the family link, a credential). */
export const IDEMPOTENCY_RESPONSE_PURPOSE = "api-idempotency-response";

/* ------------------------------------------------------------------------------------------ bodies */

/** Largest JSON request body accepted, in bytes. The biggest legitimate body (a create with full metadata) is ~10 KB. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/* ------------------------------------------------------------------------------------------ paging */

export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;
/** Cursors are opaque strings; this bounds what is accepted. */
export const CURSOR_MAX_LENGTH = 300;

/* ----------------------------------------------------------------------------------------- exports */

/** Most rows one CSV export may contain. Narrow it with `status` or `external_ref` beyond that. */
export const CSV_EXPORT_MAX_ROWS = 50_000;
/** Page size used while assembling an export. */
export const CSV_EXPORT_PAGE_SIZE = 100;
/** Longest custom header label in `?columns=`. */
export const CSV_HEADER_LABEL_MAX = 100;

/* -------------------------------------------------------------------------------------- webhooks */

/**
 * POLICY: webhook endpoints have no mode (the schema stores one set per organization) and receive the events of both
 * modes, each marked with `mode`. A test key could therefore point live events at any URL. So once an organization
 * holds an active live key, creating, changing, rotating or deleting endpoints through the API needs a live key;
 * before that, test keys may manage them. Any key may list endpoints; delivery history is filtered to the key's mode.
 */
export const WEBHOOK_WRITE_NEEDS_LIVE_KEY_ONCE_LIVE = true;
