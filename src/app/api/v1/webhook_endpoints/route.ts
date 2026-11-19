import { apiRoute, assertWebhookWritable, listEnvelope, operation, toApiWebhookEndpoint } from "@/server/api";
import { createEndpoint, listEndpoints } from "@/server/webhooks";

export const dynamic = "force-dynamic";

/** POST /api/v1/webhook_endpoints — the signing secret is returned once. */
export const POST = apiRoute({
  ...operation("createWebhookEndpoint"),
  handler: async (ctx) => {
    await assertWebhookWritable(ctx);
    const { endpoint, secret } = await createEndpoint({
      orgId: ctx.org.id,
      url: ctx.body.url,
      description: ctx.body.description ?? null,
      ...(ctx.body.event_types ? { eventTypes: ctx.body.event_types } : {}),
      ...(ctx.body.format ? { format: ctx.body.format } : {}),
    });
    ctx.setAuditTarget("webhook_endpoint", endpoint.id);
    return { status: 201, body: { ...toApiWebhookEndpoint(endpoint), secret } };
  },
});

/** GET /api/v1/webhook_endpoints — all of the organization's endpoints (at most 20), oldest first. */
export const GET = apiRoute({
  ...operation("listWebhookEndpoints"),
  handler: async (ctx) => ({ body: listEnvelope((await listEndpoints(ctx.org.id)).map(toApiWebhookEndpoint), null) }),
});
