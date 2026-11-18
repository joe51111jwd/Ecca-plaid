import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { verifyPlaidWebhook } from "./plaid-webhook";
import { makeWebhookSigner, signJwt } from "./test-support";

// Keys are generated per run; nothing here is a real Plaid key.

const NOW = new Date("2026-11-18T15:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

function makeSigner(kid = "synthetic-kid-1") {
  return makeWebhookSigner(kid, NOW_S - 86400);
}

const BODY = '{\n  "environment": "sandbox",\n  "user_id": "usr_synthetic",\n  "verification_status": "VERIFICATION_STATUS_PROCESSING_COMPLETE",\n  "webhook_code": "USER_INCOME_VERIFICATION",\n  "webhook_type": "INCOME"\n}';

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: string } };
    return `${err.code}:${err.details?.reason}`;
  }
}

describe("verifyPlaidWebhook", () => {
  const signer = makeSigner();
  const getKey = vi.fn(async (kid: string) => {
    if (kid !== signer.kid) throw new Error("unknown kid");
    return signer.key;
  });
  const good = () => signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid, typ: "JWT" }, { iat: NOW_S - 10, request_body_sha256: sha256Hex(BODY) });

  it("accepts an authentic, fresh, untampered webhook", async () => {
    await expect(verifyPlaidWebhook(BODY, good(), { getKey, now: NOW })).resolves.toBeUndefined();
    expect(getKey).toHaveBeenCalledWith(signer.kid);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await reason(verifyPlaidWebhook(BODY, null, { getKey, now: NOW }))).toBe("unauthenticated:missing_signature");
    expect(await reason(verifyPlaidWebhook(BODY, "", { getKey, now: NOW }))).toBe("unauthenticated:missing_signature");
    expect(await reason(verifyPlaidWebhook(BODY, "a.b", { getKey, now: NOW }))).toBe("unauthenticated:malformed_jwt");
    expect(await reason(verifyPlaidWebhook(BODY, "!!.??.**", { getKey, now: NOW }))).toBe("unauthenticated:malformed_jwt");
  });

  it("rejects any algorithm other than ES256, including none and HS256, before fetching a key", async () => {
    getKey.mockClear();
    for (const alg of ["none", "HS256", "RS256", "ES384"]) {
      const jwt = signJwt(signer.privateKey, { alg, kid: signer.kid }, { iat: NOW_S, request_body_sha256: sha256Hex(BODY) });
      expect(await reason(verifyPlaidWebhook(BODY, jwt, { getKey, now: NOW }))).toBe("unauthenticated:wrong_algorithm");
    }
    expect(getKey).not.toHaveBeenCalled();
  });

  it("rejects a signature from another key", async () => {
    const other = makeSigner(signer.kid);
    const jwt = signJwt(other.privateKey, { alg: "ES256", kid: signer.kid }, { iat: NOW_S, request_body_sha256: sha256Hex(BODY) });
    expect(await reason(verifyPlaidWebhook(BODY, jwt, { getKey, now: NOW }))).toBe("unauthenticated:bad_signature");
  });

  it("rejects a tampered payload even with the original signature", async () => {
    const [h, , s] = good().split(".");
    const forged = Buffer.from(JSON.stringify({ iat: NOW_S, request_body_sha256: sha256Hex("{}") })).toString("base64url");
    expect(await reason(verifyPlaidWebhook("{}", `${h}.${forged}.${s}`, { getKey, now: NOW }))).toBe("unauthenticated:bad_signature");
  });

  it("rejects a body that does not match the signed hash, including whitespace changes", async () => {
    const reformatted = JSON.stringify(JSON.parse(BODY));
    expect(await reason(verifyPlaidWebhook(reformatted, good(), { getKey, now: NOW }))).toBe("unauthenticated:body_mismatch");
    expect(await reason(verifyPlaidWebhook(BODY.replace("COMPLETE", "FAILED"), good(), { getKey, now: NOW }))).toBe("unauthenticated:body_mismatch");
  });

  it("rejects webhooks older than five minutes or issued in the future", async () => {
    const old = signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid }, { iat: NOW_S - 301, request_body_sha256: sha256Hex(BODY) });
    expect(await reason(verifyPlaidWebhook(BODY, old, { getKey, now: NOW }))).toBe("unauthenticated:too_old");
    const edge = signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid }, { iat: NOW_S - 300, request_body_sha256: sha256Hex(BODY) });
    expect(await reason(verifyPlaidWebhook(BODY, edge, { getKey, now: NOW }))).toBe("ok");
    const future = signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid }, { iat: NOW_S + 120, request_body_sha256: sha256Hex(BODY) });
    expect(await reason(verifyPlaidWebhook(BODY, future, { getKey, now: NOW }))).toBe("unauthenticated:issued_in_future");
    const noIat = signJwt(signer.privateKey, { alg: "ES256", kid: signer.kid }, { request_body_sha256: sha256Hex(BODY) });
    expect(await reason(verifyPlaidWebhook(BODY, noIat, { getKey, now: NOW }))).toBe("unauthenticated:missing_iat");
  });

  it("rejects an expired verification key and a key of the wrong type", async () => {
    const expired = vi.fn(async () => ({ ...signer.key, expired_at: NOW_S - 1 }));
    expect(await reason(verifyPlaidWebhook(BODY, good(), { getKey: expired, now: NOW }))).toBe("unauthenticated:key_expired");
    const rsa = vi.fn(async () => ({ ...signer.key, kty: "RSA" }));
    expect(await reason(verifyPlaidWebhook(BODY, good(), { getKey: rsa, now: NOW }))).toBe("unauthenticated:unexpected_key");
  });

  it("rejects a JWT without a kid", async () => {
    const jwt = signJwt(signer.privateKey, { alg: "ES256" }, { iat: NOW_S, request_body_sha256: sha256Hex(BODY) });
    expect(await reason(verifyPlaidWebhook(BODY, jwt, { getKey, now: NOW }))).toBe("unauthenticated:missing_kid");
  });
});
