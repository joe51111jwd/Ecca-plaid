import { apiHandoff, apiRoute, handoffInputFromBody, listEnvelope, operation } from "@/server/api";
import { createHandoff, listHandoffs, recordToApi } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/** POST /api/v1/handoffs — server-to-server create with the business's secret key; the handoff URLs are returned once. */
export const POST = apiRoute({
  ...operation("createHandoff"),
  handler: async (ctx) => {
    const created = await createHandoff(handoffInputFromBody(ctx.body, ctx.request.headers.get("idempotency-key")), {
      kind: "api",
      businessOrgId: ctx.org.id,
      mode: ctx.mode,
      apiKeyId: ctx.apiKey.id,
      request: ctx.actor.request,
    });
    ctx.setAuditTarget("handoff", created.handoff.id);
    return { status: 201, body: { ...(await apiHandoff(ctx.org.id, created.handoff.id, ctx.mode)), url: created.url, embed_url: created.embedUrl } };
  },
});

/** GET /api/v1/handoffs — newest first, in the key's mode. */
export const GET = apiRoute({
  ...operation("listHandoffs"),
  handler: async (ctx) => {
    const page = await listHandoffs(ctx.org.id, {
      mode: ctx.mode,
      limit: ctx.query.limit,
      ...(ctx.query.status ? { status: ctx.query.status as Parameters<typeof listHandoffs>[1]["status"] } : {}),
      ...(ctx.query.starting_after ? { before: ctx.query.starting_after } : {}),
    });
    return { body: listEnvelope(page.data.map(recordToApi), page.nextCursor) };
  },
});
