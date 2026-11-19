import { openApiDocument } from "@/server/api";

/** GET /api/v1/openapi.json — the OpenAPI 3.1 description of this API (also at /openapi/v1.json). Public. */
export function GET(): Response {
  return new Response(JSON.stringify(openApiDocument(), null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
