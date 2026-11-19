import { handlePublicCreate, preflightResponse, type PublicResponse } from "@/features/handoff/server/public-create";

export const dynamic = "force-dynamic";

function toResponse(r: PublicResponse): Response {
  return r.body === null ? new Response(null, { status: r.status, headers: r.headers }) : Response.json(r.body, { status: r.status, headers: r.headers });
}

/**
 * POST /embed/handoff/create — the embed script starts a handoff with the business's publishable key. The Origin
 * must be on the business's allowed list (checked by the handoffs service). Returns the handoff id and the URLs to
 * open; the server-to-server alternative is POST /api/v1/handoffs with a secret key.
 */
export async function POST(request: Request): Promise<Response> {
  return toResponse(await handlePublicCreate(request));
}

/** CORS preflight, for integrations that send a JSON content type. */
export async function OPTIONS(request: Request): Promise<Response> {
  return toResponse(preflightResponse(request.headers.get("origin")));
}
