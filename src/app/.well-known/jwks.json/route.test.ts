import { describe, expect, it } from "vitest";
import { buildSignedEvidence, EVIDENCE_JWKS_PATH, platformJwks, verifySignedEvidence, verifySignedEvidenceWithPlatformKey } from "@/engine/evidence";
import { syntheticCategoricalEligibleInput } from "@/engine/evidence/synthetic-fixtures";
import { getSigningKey } from "@/lib/crypto";
import { GET, dynamic } from "./route";

const URL_UNDER_TEST = `http://localhost${EVIDENCE_JWKS_PATH}`;

describe("GET /.well-known/jwks.json", () => {
  it("lives at the path the engine tells verifiers to use", () => {
    expect(EVIDENCE_JWKS_PATH).toBe("/.well-known/jwks.json");
    expect(import.meta.url).toContain("/src/app/.well-known/jwks.json/route.test.ts");
  });

  it("is rendered per request, never baked in at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("serves the public signing key as a JWK Set with cache headers", async () => {
    const response = GET(new Request(URL_UNDER_TEST));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/jwk-set+json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, stale-if-error=86400");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);

    const body = (await response.json()) as { keys: Array<Record<string, string>> };
    expect(body).toEqual(platformJwks());
    expect(body.keys).toHaveLength(1);
    const [jwk] = body.keys;
    expect(Object.keys(jwk).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x"]);
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", use: "sig", alg: "EdDSA", kid: getSigningKey().kid });
    expect(Buffer.from(jwk.x, "base64url")).toHaveLength(32);
  });

  it("never exposes private key material", async () => {
    const text = await GET(new Request(URL_UNDER_TEST)).text();
    const privateJwk = getSigningKey().privateKey.export({ format: "jwk" }) as { d: string };
    expect(text).not.toContain(privateJwk.d);
    expect(text).not.toContain('"d"');
    expect(text).not.toContain("PRIVATE");
  });

  it("answers a conditional request with 304 and the same validators", async () => {
    const first = GET(new Request(URL_UNDER_TEST));
    const etag = first.headers.get("etag")!;
    const second = GET(new Request(URL_UNDER_TEST, { headers: { "If-None-Match": etag } }));
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe("public, max-age=300, stale-if-error=86400");
    expect(await second.text()).toBe("");
    expect(GET(new Request(URL_UNDER_TEST, { headers: { "If-None-Match": '"something-else"' } })).status).toBe(200);
  });

  it("verifies a record signed with the deployment's key, end to end", async () => {
    const signed = buildSignedEvidence(syntheticCategoricalEligibleInput());
    expect(signed.signature.kid).toBe(getSigningKey().kid);
    const jwks = (await GET(new Request(URL_UNDER_TEST)).json()) as { keys: Array<Record<string, string>> };
    // Through JSON, as a verifier on another machine would hold both documents.
    const received = JSON.parse(JSON.stringify(signed)) as unknown;
    expect(verifySignedEvidence(received, jwks)).toEqual({ valid: true, kid: signed.signature.kid });
    expect(verifySignedEvidenceWithPlatformKey(received)).toEqual({ valid: true, kid: signed.signature.kid });

    const tampered = structuredClone(signed);
    tampered.record.decision.status = "ineligible";
    expect(verifySignedEvidence(tampered, jwks)).toMatchObject({ valid: false, reason: "record_hash_mismatch" });
    expect(verifySignedEvidenceWithPlatformKey(tampered).valid).toBe(false);
  });
});
