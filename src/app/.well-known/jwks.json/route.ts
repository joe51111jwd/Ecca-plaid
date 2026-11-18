import { platformJwks } from "@/engine/evidence/platform";
import { sha256Hex } from "@/lib/crypto";
import { AppError, toErrorBody } from "@/lib/errors";

/**
 * GET /.well-known/jwks.json
 *
 * The public keys that verify evidence signatures, as a JWK Set (RFC 7517). Anyone holding a signed evidence
 * record uses this to check it; `npm run evidence:verify -- <record.json> --jwks <this URL>` does it for them.
 * Public by design: it holds public keys only, needs no sign-in and may be fetched from any origin.
 */

// The key is read from the environment (or the development key file) when a request arrives. Without this
// the route would be rendered once at build time and serve whatever key the build machine had.
export const dynamic = "force-dynamic";

/* Short enough that a rotated key reaches verifiers within minutes, long enough to keep a burst of checks
   off the server. During an outage a cache may keep serving the last good copy for a day. */
const CACHE_CONTROL = "public, max-age=300, stale-if-error=86400";

export function GET(request: Request): Response {
  let body: string;
  try {
    body = JSON.stringify(platformJwks());
  } catch (error) {
    console.error("[evidence] the signing key could not be loaded for /.well-known/jwks.json", error);
    const failure = toErrorBody(new AppError("not_available", "The evidence signing key is not available"));
    return Response.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }

  const etag = `"${sha256Hex(body).slice(0, 32)}"`;
  const headers = {
    "Content-Type": "application/jwk-set+json",
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    "Access-Control-Allow-Origin": "*",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
