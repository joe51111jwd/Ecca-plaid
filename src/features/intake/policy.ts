/**
 * Product policy of the family screens. None of these values comes from section 25F, the proposed regulations or
 * the spec; each is a named, documented choice so it can be found and changed in one place.
 */

/**
 * The time estimate the landing page shows ("About N minutes"). A product estimate for a family that has one
 * document ready, not a measured figure; revisit once real completion times are known.
 */
export const ESTIMATED_MINUTES = 10;

/** How often the status page asks the server again while documents are read or a decision is made. */
export const STATUS_REFRESH_MS = 5_000;
/** How often the upload page refreshes while a document is still being read. */
export const DOCUMENT_REFRESH_MS = 4_000;

/**
 * Cookie that remembers which verification link a person was signing in for, so the link in the sign-in email can
 * bring them straight back to it (the family token is a credential: it is never put in the email's redirect).
 */
export const PENDING_LINK_COOKIE = "ecca_family_link";
/** The pending-link cookie lives as long as a sign-in code does (15 minutes) plus a margin. */
export const PENDING_LINK_MAX_AGE_SECONDS = 30 * 60;

/**
 * Session cookie for the embedded flow. A partner's page frames /embed/verify; the main session cookie is
 * SameSite=Lax and never reaches a cross-site frame, so the embed signs in with a separate partitioned
 * (CHIPS) cookie that only exists inside that partner's frame. It carries the same kind of session token and is
 * resolved through the auth service.
 */
export const EMBED_SESSION_COOKIE = "ecca_embed_session";

/** Route that finishes a sign-in started from a verification link (the sign-in email points here). */
export const CONTINUE_PATH = "/family/continue";
/** Route that switches the language and remembers it. */
export const LANGUAGE_PATH = "/family/language";
/** The same, for the embedded flow (paths outside /embed may not be framed). */
export const EMBED_LANGUAGE_PATH = "/embed/verify/language";
/** Route handler that receives uploads (server actions cap request bodies at 1 MB). */
export const UPLOAD_PATH = "/family/upload";
/** Route handler that serves the household data export. */
export const EXPORT_PATH = "/family/data";

/** Most files the dropzone takes in one go; each is uploaded separately and the service caps the total. */
export const MAX_FILES_PER_DROP = 10;
/** Bytes of multipart framing allowed on top of the largest file before the upload route refuses the request. */
export const UPLOAD_OVERHEAD_BYTES = 64 * 1024;
