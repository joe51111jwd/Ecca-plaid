import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { now as clockNow } from "@/lib/clock";

/**
 * Webhook signing and verification, following the Standard Webhooks specification
 * (https://www.standardwebhooks.com, symmetric scheme):
 *
 *   signed content   = `${id}.${timestamp}.${body}`          id = webhook-id, timestamp = unix seconds
 *   signature        = base64(HMAC-SHA256(key, signed content))
 *   key              = the base64-decoded part of the secret after "whsec_"
 *   webhook-signature header = space-separated list of "v1,<signature>"
 *
 * Everything here is pure (no database, no network); `verifyWebhookSignature` is the reference
 * verifier shown in the API documentation.
 */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const WEBHOOK_SIGNATURE_VERSION = "v1";
export const DEFAULT_TOLERANCE_SECONDS = 300;
const SECRET_BYTES = 32;

export const WEBHOOK_HEADER = { id: "webhook-id", timestamp: "webhook-timestamp", signature: "webhook-signature" } as const;

/** New signing secret: "whsec_" + base64 of 32 random bytes. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64")}`;
}

/** HMAC key for a secret. Throws on anything that is not base64 (with or without the "whsec_" prefix). */
export function webhookSecretKey(secret: string): Buffer {
  const encoded = secret.startsWith(WEBHOOK_SECRET_PREFIX) ? secret.slice(WEBHOOK_SECRET_PREFIX.length) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Webhook secret must be base64, optionally prefixed with whsec_");
  const key = Buffer.from(encoded, "base64");
  if (key.length === 0) throw new Error("Webhook secret is empty");
  return key;
}

function toUnixSeconds(timestamp: Date | number): number {
  const seconds = timestamp instanceof Date ? Math.floor(timestamp.getTime() / 1000) : timestamp;
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("Webhook timestamp must be a date or a whole number of unix seconds");
  return seconds;
}

function hmac(key: Buffer, id: string, seconds: number, body: string | Uint8Array): Buffer {
  const mac = createHmac("sha256", key);
  mac.update(`${id}.${seconds}.`);
  mac.update(body);
  return mac.digest();
}

/** One signature in header form: "v1,<base64>". */
export function signWebhook(input: { secret: string; id: string; timestamp: Date | number; body: string | Uint8Array }): string {
  // A "." in the id would let two different (id, timestamp, body) triples produce the same signed content.
  if (input.id.length === 0 || input.id.includes(".")) throw new Error("Webhook id must be non-empty and must not contain '.'");
  return `${WEBHOOK_SIGNATURE_VERSION},${hmac(webhookSecretKey(input.secret), input.id, toUnixSeconds(input.timestamp), input.body).toString("base64")}`;
}

export interface SignedRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  /** Exactly the bytes that were signed; send it unmodified. */
  body: string;
}

/**
 * The complete request for one delivery attempt. `secrets` may hold several secrets (the current one and
 * a previous one during a rotation overlap); the header then carries one signature per secret and the
 * receiver accepts the request if any of them matches.
 */
export function buildSignedRequest(input: {
  url: string;
  /** Stable across retries of the same event; receivers use it as an idempotency key. */
  id: string;
  /** Time of this attempt. */
  timestamp: Date | number;
  body: string;
  secrets: string | readonly string[];
  /** Default "application/json". */
  contentType?: string;
  userAgent?: string;
}): SignedRequest {
  const secrets = typeof input.secrets === "string" ? [input.secrets] : input.secrets;
  if (secrets.length === 0) throw new Error("At least one webhook secret is required");
  const seconds = toUnixSeconds(input.timestamp);
  const signatures = secrets.map((secret) => signWebhook({ secret, id: input.id, timestamp: seconds, body: input.body }));
  return {
    url: input.url,
    method: "POST",
    headers: {
      "content-type": input.contentType ?? "application/json",
      ...(input.userAgent ? { "user-agent": input.userAgent } : {}),
      [WEBHOOK_HEADER.id]: input.id,
      [WEBHOOK_HEADER.timestamp]: String(seconds),
      [WEBHOOK_HEADER.signature]: signatures.join(" "),
    },
    body: input.body,
  };
}

/* Verification ------------------------------------------------------------------------------------- */

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export interface VerifyWebhookInput {
  /** The endpoint's signing secret ("whsec_..."). */
  secret: string;
  /** Request headers: a Fetch `Headers` object or a plain object (any letter case, as in Node's `req.headers`). */
  headers: WebhookHeaders;
  /** The raw request body exactly as received. Never re-serialize parsed JSON. */
  body: string | Uint8Array;
  /** Maximum distance between webhook-timestamp and `now`, in either direction. Default 300. */
  toleranceSeconds?: number;
  /** Current time. Defaults to the app clock. */
  now?: Date;
}

export type WebhookVerification =
  | { valid: true; id: string; timestamp: Date }
  | { valid: false; reason: "missing_headers" | "invalid_timestamp" | "timestamp_too_old" | "timestamp_too_new" | "invalid_secret" | "no_matching_signature" };

function header(headers: WebhookHeaders, name: string): string | null {
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name);
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== name) continue;
    if (value === undefined) return null;
    return Array.isArray(value) ? value.join(" ") : value;
  }
  return null;
}

/** Verifies a received webhook and says why when it fails. */
export function checkWebhookSignature(input: VerifyWebhookInput): WebhookVerification {
  const id = header(input.headers, WEBHOOK_HEADER.id);
  const timestamp = header(input.headers, WEBHOOK_HEADER.timestamp);
  const signatures = header(input.headers, WEBHOOK_HEADER.signature);
  if (!id || !timestamp || !signatures) return { valid: false, reason: "missing_headers" };

  if (!/^\d{1,12}$/.test(timestamp)) return { valid: false, reason: "invalid_timestamp" };
  const seconds = Number(timestamp);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now ?? clockNow()).getTime() / 1000);
  // Replay protection: a captured request stops being acceptable once it is older than the tolerance.
  if (seconds < nowSeconds - tolerance) return { valid: false, reason: "timestamp_too_old" };
  if (seconds > nowSeconds + tolerance) return { valid: false, reason: "timestamp_too_new" };

  let key: Buffer;
  try {
    key = webhookSecretKey(input.secret);
  } catch {
    return { valid: false, reason: "invalid_secret" };
  }
  const expected = hmac(key, id, seconds, input.body);
  for (const candidate of signatures.split(/\s+/)) {
    const comma = candidate.indexOf(",");
    if (comma < 0 || candidate.slice(0, comma) !== WEBHOOK_SIGNATURE_VERSION) continue;
    const given = Buffer.from(candidate.slice(comma + 1), "base64");
    // Constant-time comparison; the length check only reveals the public digest size.
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { valid: true, id, timestamp: new Date(seconds * 1000) };
  }
  return { valid: false, reason: "no_matching_signature" };
}

/**
 * Reference verifier: true when the request carries a current, correctly signed webhook.
 *
 *   const ok = verifyWebhookSignature({ secret: process.env.WEBHOOK_SECRET, headers: req.headers, body: rawBody });
 *   if (!ok) return res.status(401).end();
 *
 * After a successful check, use the webhook-id header as an idempotency key: a delivery can arrive more
 * than once.
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  return checkWebhookSignature(input).valid;
}
