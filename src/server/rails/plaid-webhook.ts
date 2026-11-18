/**
 * Verification of Plaid webhooks (docs/reference/payments-and-rails.md fact 58; Plaid "Verify webhooks"):
 * the `Plaid-Verification` header is a JWT signed with ES256; its key comes from
 * /webhook_verification_key/get by `kid`; `iat` must be at most five minutes old; and `request_body_sha256`
 * must equal the SHA-256 of the raw body, compared in constant time.
 *
 * Implemented with node:crypto (no JWT dependency). Nothing about the body is read or acted on until every
 * check has passed.
 */
import { createPublicKey, verify as nodeVerify, type JsonWebKey } from "node:crypto";
import { sha256Hex, safeEqual } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

/** Plaid: "verify that the webhook is not more than 5 minutes old". */
export const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;
/**
 * Policy (sources are silent): how far in the future `iat` may be before the webhook is rejected, to absorb
 * clock skew between Plaid and us without accepting tokens minted for later replay.
 */
export const PLAID_WEBHOOK_MAX_FUTURE_SKEW_SECONDS = 60;

/** The JWK returned by /webhook_verification_key/get (`key`). */
export interface PlaidWebhookKey {
  alg: string;
  crv: string;
  kid: string;
  kty: string;
  use?: string;
  x: string;
  y: string;
  created_at?: number;
  expired_at?: number | null;
}

export type GetPlaidWebhookKey = (kid: string) => Promise<PlaidWebhookKey>;

const reject = (why: string) => new AppError("unauthenticated", "Invalid webhook signature", { reason: why });

function decodeSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw reject("malformed_jwt");
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw reject("malformed_jwt");
  }
}

/**
 * Throws AppError `unauthenticated` unless the webhook is authentic, fresh and untampered. `now` is passed
 * in so the freshness rule can be tested.
 */
export async function verifyPlaidWebhook(rawBody: string, jwt: string | null | undefined, opts: { getKey: GetPlaidWebhookKey; now: Date }): Promise<void> {
  if (typeof jwt !== "string" || jwt.length === 0 || jwt.length > 8192) throw reject("missing_signature");
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) throw reject("malformed_jwt");
  const [h, p, s] = parts as [string, string, string];

  const header = decodeSegment(h) as { alg?: unknown; kid?: unknown };
  if (typeof header !== "object" || header === null || header.alg !== "ES256") throw reject("wrong_algorithm");
  if (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 200) throw reject("missing_kid");

  const jwk = await opts.getKey(header.kid);
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || (jwk.alg && jwk.alg !== "ES256")) throw reject("unexpected_key");
  if (typeof jwk.expired_at === "number" && jwk.expired_at * 1000 <= opts.now.getTime()) throw reject("key_expired");

  let ok = false;
  try {
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } as JsonWebKey, format: "jwk" });
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw reject("malformed_jwt");
    const signature = Buffer.from(s, "base64url");
    // JWS ES256 signatures are the raw 64-byte r||s form, not DER.
    ok = signature.length === 64 && nodeVerify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, signature);
  } catch (e) {
    if (e instanceof AppError) throw e;
    ok = false;
  }
  if (!ok) throw reject("bad_signature");

  const payload = decodeSegment(p) as { iat?: unknown; request_body_sha256?: unknown };
  if (typeof payload !== "object" || payload === null || typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) throw reject("missing_iat");
  const nowSeconds = opts.now.getTime() / 1000;
  if (nowSeconds - payload.iat > PLAID_WEBHOOK_MAX_AGE_SECONDS) throw reject("too_old");
  if (payload.iat - nowSeconds > PLAID_WEBHOOK_MAX_FUTURE_SKEW_SECONDS) throw reject("issued_in_future");
  if (typeof payload.request_body_sha256 !== "string" || !safeEqual(payload.request_body_sha256.toLowerCase(), sha256Hex(rawBody))) throw reject("body_mismatch");
}
