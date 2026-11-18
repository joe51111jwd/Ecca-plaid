import { toErrorBody } from "@/lib/errors";
import { handleRailWebhook } from "@/server/rails";

/**
 * Plaid webhook endpoint: POST /api/webhooks/plaid (the `webhook` URL given to /link/token/create).
 *
 * The `Plaid-Verification` JWT is verified against the raw body BEFORE anything else happens: no
 * connection is looked up and nothing is answered as "ok" for a request whose signature has not been
 * checked. The raw body bytes are hashed as received (the signed hash is whitespace-sensitive), read with a size cap.
 *
 *   200  verified; acted on, or nothing to do (other webhook types, unknown users)
 *   401  missing or invalid signature
 *   413  body larger than any Plaid webhook
 *   503  Plaid is not configured here, or the key lookup failed (Plaid retries)
 */

/** Plaid webhook bodies are a few hundred bytes; anything near this size is not one. */
const MAX_BODY_BYTES = 64_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The body as UTF-8 text, or null once it passes `maxBytes`. Read incrementally so a chunked request with no
 * (or a false) Content-Length cannot make us buffer an unbounded body before the size check.
 */
async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request): Promise<Response> {
  const tooLarge = () => json({ error: { code: "bad_request", message: "Request body too large" } }, 413);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return tooLarge();
  try {
    const rawBody = await readBodyCapped(request, MAX_BODY_BYTES);
    if (rawBody === null) return tooLarge();
    const result = await handleRailWebhook("plaid", rawBody, request.headers);
    return json({ received: true, status: result.status });
  } catch (e) {
    const { status, body } = toErrorBody(e);
    if (status >= 500) console.error("[rails] Plaid webhook could not be processed", e);
    return json(body, status);
  }
}
