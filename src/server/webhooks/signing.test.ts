import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { setTestNow } from "@/lib/clock";
import {
  buildSignedRequest,
  checkWebhookSignature,
  DEFAULT_TOLERANCE_SECONDS,
  generateWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
  webhookSecretKey,
} from "./signing";

/**
 * Known-answer vectors. The signatures were computed outside this codebase with OpenSSL:
 *
 *   printf '%s' "<id>.<timestamp>.<body>" | openssl dgst -sha256 -mac HMAC -macopt hexkey:<key hex> -binary | base64
 *
 * Vector A uses the message id, payload and secret of the Standard Webhooks reference libraries' own
 * tests (libraries/python/tests/test_webhooks.py in github.com/standard-webhooks/standard-webhooks)
 * at timestamp 1614265330. Vectors B and C use synthetic secrets (bytes 00..1f and ff..e0) and a
 * synthetic event.
 */
const A = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};
const BODY =
  '{"id":"evt_SYNTHETIC0000000000001","type":"verification.decided","created_at":"2026-11-18T15:04:05.000Z","mode":"test","data":{"verification_id":"ver_SYNTHETIC0000000000001","status":"eligible"}}';
const B = {
  secret: "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  id: "evt_SYNTHETIC0000000000001",
  timestamp: 1795014245, // 2026-11-18T15:04:05Z
  body: BODY,
  signature: "v1,NG+OCqFhxc5tADEgjVXxgcOMHyjQEmqYDzLxbv8WAP0=",
};
const C = { ...B, secret: "whsec_//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=", signature: "v1,1gLldynhNFtFyt3Lq9jbPOwJ7Ml2cla745aoKvxeJrI=" };
const AT = new Date(B.timestamp * 1000);

const headersFor = (v: { id: string; timestamp: number; signature: string }) => ({
  "webhook-id": v.id,
  "webhook-timestamp": String(v.timestamp),
  "webhook-signature": v.signature,
});

afterEach(() => setTestNow(null));

describe("signWebhook", () => {
  it("matches the independently computed vectors", () => {
    for (const v of [A, B, C]) expect(signWebhook(v)).toBe(v.signature);
  });

  it("accepts a Date (floored to seconds), bytes for the body and a secret without the prefix", () => {
    expect(signWebhook({ ...B, timestamp: new Date(B.timestamp * 1000 + 999) })).toBe(B.signature);
    expect(signWebhook({ ...B, body: new TextEncoder().encode(B.body) })).toBe(B.signature);
    expect(signWebhook({ ...B, secret: B.secret.slice("whsec_".length) })).toBe(B.signature);
  });

  it("uses the decoded secret bytes as the key, not the secret text", () => {
    const key = Buffer.from("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "base64");
    expect(key).toEqual(Buffer.from(Array.from({ length: 32 }, (_, i) => i)));
    expect(webhookSecretKey(B.secret)).toEqual(key);
    const manual = createHmac("sha256", key).update(`${B.id}.${B.timestamp}.${B.body}`).digest("base64");
    expect(B.signature).toBe(`v1,${manual}`);
  });

  it("changes when any signed part changes", () => {
    expect(signWebhook({ ...B, id: "evt_SYNTHETIC0000000000002" })).not.toBe(B.signature);
    expect(signWebhook({ ...B, timestamp: B.timestamp + 1 })).not.toBe(B.signature);
    expect(signWebhook({ ...B, body: `${B.body} ` })).not.toBe(B.signature);
  });

  it("rejects ids and timestamps that would make the signed content ambiguous, and malformed secrets", () => {
    expect(() => signWebhook({ ...B, id: "evt.1" })).toThrow(/must not contain/);
    expect(() => signWebhook({ ...B, id: "" })).toThrow();
    expect(() => signWebhook({ ...B, timestamp: 1.5 })).toThrow(/timestamp/);
    expect(() => signWebhook({ ...B, timestamp: -1 })).toThrow(/timestamp/);
    expect(() => signWebhook({ ...B, timestamp: new Date("nope") })).toThrow(/timestamp/);
    expect(() => signWebhook({ ...B, secret: "whsec_" })).toThrow(/base64/);
    expect(() => signWebhook({ ...B, secret: "whsec_not base64!" })).toThrow(/base64/);
    expect(() => signWebhook({ ...B, secret: "" })).toThrow(/base64/);
  });
});

describe("generateWebhookSecret", () => {
  it('returns "whsec_" + base64 of 32 random bytes, different every time', () => {
    const secrets = Array.from({ length: 50 }, () => generateWebhookSecret());
    for (const s of secrets) {
      expect(s).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
      expect(webhookSecretKey(s)).toHaveLength(32);
    }
    expect(new Set(secrets).size).toBe(50);
  });
});

describe("buildSignedRequest", () => {
  it("builds the POST with Standard Webhooks headers and the exact body", () => {
    const req = buildSignedRequest({ url: "https://receiver.example/hooks", id: B.id, timestamp: AT, body: B.body, secrets: B.secret, userAgent: "Synthetic/1.0" });
    expect(req).toEqual({
      url: "https://receiver.example/hooks",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Synthetic/1.0",
        "webhook-id": B.id,
        "webhook-timestamp": "1795014245",
        "webhook-signature": B.signature,
      },
      body: B.body,
    });
  });

  it("sends one signature per secret, space separated, during a rotation overlap", () => {
    const req = buildSignedRequest({ url: "https://receiver.example/hooks", id: B.id, timestamp: B.timestamp, body: B.body, secrets: [C.secret, B.secret] });
    expect(req.headers["webhook-signature"]).toBe(`${C.signature} ${B.signature}`);
    expect(req.headers["user-agent"]).toBeUndefined();
    // Either secret verifies the same request.
    for (const secret of [B.secret, C.secret]) expect(verifyWebhookSignature({ secret, headers: req.headers, body: req.body, now: AT })).toBe(true);
    expect(verifyWebhookSignature({ secret: A.secret, headers: req.headers, body: req.body, now: AT })).toBe(false);
  });

  it("honours a custom content type and refuses an empty secret list", () => {
    const req = buildSignedRequest({ url: "https://receiver.example/x", id: B.id, timestamp: AT, body: "a,b\r\n", secrets: [B.secret], contentType: "text/csv; charset=utf-8" });
    expect(req.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(() => buildSignedRequest({ url: "https://receiver.example/x", id: B.id, timestamp: AT, body: "", secrets: [] })).toThrow(/secret/);
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts the known vectors", () => {
    expect(verifyWebhookSignature({ secret: A.secret, headers: headersFor(A), body: A.body, now: new Date(A.timestamp * 1000) })).toBe(true);
    expect(verifyWebhookSignature({ secret: B.secret, headers: headersFor(B), body: B.body, now: AT })).toBe(true);
    expect(checkWebhookSignature({ secret: B.secret, headers: headersFor(B), body: B.body, now: AT })).toEqual({ valid: true, id: B.id, timestamp: AT });
  });

  it("reads headers from Fetch Headers, from mixed-case objects and from Node-style arrays", () => {
    expect(verifyWebhookSignature({ secret: B.secret, headers: new Headers(headersFor(B)), body: B.body, now: AT })).toBe(true);
    const upper = { "Webhook-Id": B.id, "WEBHOOK-TIMESTAMP": String(B.timestamp), "Webhook-Signature": B.signature, host: "receiver.example" };
    expect(verifyWebhookSignature({ secret: B.secret, headers: upper, body: B.body, now: AT })).toBe(true);
    const arrays = { ...headersFor(B), "webhook-signature": ["v1,AAAA", B.signature], "x-other": undefined };
    expect(verifyWebhookSignature({ secret: B.secret, headers: arrays, body: B.body, now: AT })).toBe(true);
  });

  it("accepts raw bytes for the body and defaults `now` to the app clock", () => {
    setTestNow(AT);
    expect(verifyWebhookSignature({ secret: B.secret, headers: headersFor(B), body: Buffer.from(B.body) })).toBe(true);
    setTestNow(new Date(AT.getTime() + 301_000));
    expect(verifyWebhookSignature({ secret: B.secret, headers: headersFor(B), body: Buffer.from(B.body) })).toBe(false);
  });

  it("rejects a bad signature, a tampered body, a different id and the wrong secret", () => {
    const check = (over: Partial<Parameters<typeof checkWebhookSignature>[0]>) =>
      checkWebhookSignature({ secret: B.secret, headers: headersFor(B), body: B.body, now: AT, ...over });
    const flipped = B.signature.replace("NG+O", "NG+P");
    expect(check({ headers: { ...headersFor(B), "webhook-signature": flipped } })).toEqual({ valid: false, reason: "no_matching_signature" });
    expect(check({ body: B.body.replace("eligible", "ineligible") })).toEqual({ valid: false, reason: "no_matching_signature" });
    expect(check({ body: JSON.stringify(JSON.parse(B.body), null, 1) })).toEqual({ valid: false, reason: "no_matching_signature" });
    expect(check({ headers: { ...headersFor(B), "webhook-id": "evt_SYNTHETIC0000000000002" } })).toEqual({ valid: false, reason: "no_matching_signature" });
    expect(check({ secret: C.secret })).toEqual({ valid: false, reason: "no_matching_signature" });
    expect(check({ secret: "whsec_!!!" })).toEqual({ valid: false, reason: "invalid_secret" });
    // Truncated, empty, unversioned and wrong-version signatures never match.
    for (const signature of [B.signature.slice(0, -4), "v1,", "v1", B.signature.slice(3), B.signature.replace("v1,", "v2,"), B.signature.replace("v1,", "v1a,"), ","]) {
      expect(check({ headers: { ...headersFor(B), "webhook-signature": signature } }), signature).toEqual({ valid: false, reason: "no_matching_signature" });
    }
    expect(verifyWebhookSignature({ secret: B.secret, headers: { ...headersFor(B), "webhook-signature": flipped }, body: B.body, now: AT })).toBe(false);
  });

  it("rejects the reference libraries' deliberately wrong signature for vector A", () => {
    // Differs from the valid signature in its last character before the padding.
    const wrong = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OA=";
    expect(verifyWebhookSignature({ secret: A.secret, headers: { ...headersFor(A), "webhook-signature": wrong }, body: A.body, now: new Date(A.timestamp * 1000) })).toBe(false);
  });

  it("rejects a signature that is valid for another timestamp", () => {
    const res = checkWebhookSignature({ secret: B.secret, headers: { ...headersFor(B), "webhook-timestamp": String(B.timestamp + 1) }, body: B.body, now: AT });
    expect(res).toEqual({ valid: false, reason: "no_matching_signature" });
  });

  it("enforces the timestamp tolerance in both directions", () => {
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(300);
    const at = (offsetSeconds: number, toleranceSeconds?: number) =>
      checkWebhookSignature({ secret: B.secret, headers: headersFor(B), body: B.body, now: new Date((B.timestamp + offsetSeconds) * 1000), toleranceSeconds });
    expect(at(300).valid).toBe(true);
    expect(at(301)).toEqual({ valid: false, reason: "timestamp_too_old" });
    expect(at(86_400)).toEqual({ valid: false, reason: "timestamp_too_old" });
    expect(at(-300).valid).toBe(true);
    expect(at(-301)).toEqual({ valid: false, reason: "timestamp_too_new" });
    expect(at(60, 59)).toEqual({ valid: false, reason: "timestamp_too_old" });
    expect(at(60, 60).valid).toBe(true);
    expect(at(1, 0)).toEqual({ valid: false, reason: "timestamp_too_old" });
    expect(at(0, 0).valid).toBe(true);
  });

  it("rejects missing headers and malformed timestamps", () => {
    const base = headersFor(B);
    for (const missing of ["webhook-id", "webhook-timestamp", "webhook-signature"] as const) {
      const headers: Record<string, string> = { ...base };
      delete headers[missing];
      expect(checkWebhookSignature({ secret: B.secret, headers, body: B.body, now: AT })).toEqual({ valid: false, reason: "missing_headers" });
    }
    expect(checkWebhookSignature({ secret: B.secret, headers: {}, body: B.body, now: AT })).toEqual({ valid: false, reason: "missing_headers" });
    for (const timestamp of ["soon", "1795014245.5", "-1795014245", "1795014245000000", "0x6afd2ca5", " "]) {
      expect(checkWebhookSignature({ secret: B.secret, headers: { ...base, "webhook-timestamp": timestamp }, body: B.body, now: AT }), timestamp).toEqual({
        valid: false,
        reason: "invalid_timestamp",
      });
    }
  });

  it("accepts the request when any one of several signatures in the header matches", () => {
    const other = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const asymmetric = "v2a,kG9XaxZjAEpKB8KeQQb5G1Xp73YH5Rf5gxoWe7cg1kYMiyspdtZXe9w+dAwKeOurAwxfqmlOG/QR4m9s37DzAg==";
    for (const signature of [`${other} ${B.signature}`, `${B.signature} ${other}`, `${asymmetric} ${other} ${B.signature}`, `${other}   ${B.signature}`]) {
      expect(verifyWebhookSignature({ secret: B.secret, headers: { ...headersFor(B), "webhook-signature": signature }, body: B.body, now: AT }), signature).toBe(true);
    }
    expect(verifyWebhookSignature({ secret: B.secret, headers: { ...headersFor(B), "webhook-signature": `${other} ${asymmetric} ${C.signature}` }, body: B.body, now: AT })).toBe(false);
  });

  it("round-trips a freshly generated secret", () => {
    const secret = generateWebhookSecret();
    const req = buildSignedRequest({ url: "https://receiver.example/hooks", id: "evt_SYNTHETICROUNDTRIP000001", timestamp: AT, body: '{"ok":true}', secrets: secret });
    expect(verifyWebhookSignature({ secret, headers: req.headers, body: req.body, now: AT })).toBe(true);
    expect(verifyWebhookSignature({ secret: generateWebhookSecret(), headers: req.headers, body: req.body, now: AT })).toBe(false);
  });
});
