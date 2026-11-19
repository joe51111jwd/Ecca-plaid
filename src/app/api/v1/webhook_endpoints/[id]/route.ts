import { apiRoute, assertWebhookWritable, operation, toApiWebhookEndpoint } from "@/server/api";
import { deleteEndpoint, disableEndpoint, enableEndpoint, getEndpoint, updateEndpoint } from "@/server/webhooks";

export const dynamic = "force-dynamic";

/** GET /api/v1/webhook_endpoints/{id} */
export const GET = apiRoute({
  ...operation("getWebhookEndpoint"),
  handler: async (ctx) => ({ body: toApiWebhookEndpoint(await getEndpoint(ctx.org.id, ctx.params.id)) }),
});

/** PATCH /api/v1/webhook_endpoints/{id} — change url, description, event types, format, or enable/disable. */
export const PATCH = apiRoute({
  ...operation("updateWebhookEndpoint"),
  handler: async (ctx) => {
    await assertWebhookWritable(ctx);
    const { status, ...rest } = ctx.body;
    let endpoint = await updateEndpoint(ctx.org.id, ctx.params.id, {
      ...(rest.url !== undefined ? { url: rest.url } : {}),
      ...(rest.description !== undefined ? { description: rest.description } : {}),
      ...(rest.event_types !== undefined ? { eventTypes: rest.event_types } : {}),
      ...(rest.format !== undefined ? { format: rest.format } : {}),
    });
    if (status === "disabled" && endpoint.status !== "disabled") endpoint = await disableEndpoint(ctx.org.id, endpoint.id);
    if (status === "active" && endpoint.status !== "active") endpoint = await enableEndpoint(ctx.org.id, endpoint.id);
    ctx.setAuditTarget("webhook_endpoint", endpoint.id);
    return { body: toApiWebhookEndpoint(endpoint) };
  },
});

/** DELETE /api/v1/webhook_endpoints/{id} — removes the endpoint and its delivery history (events are kept). */
export const DELETE = apiRoute({
  ...operation("deleteWebhookEndpoint"),
  handler: async (ctx) => {
    await assertWebhookWritable(ctx);
    await deleteEndpoint(ctx.org.id, ctx.params.id);
    ctx.setAuditTarget("webhook_endpoint", ctx.params.id);
    return { body: { id: ctx.params.id, object: "webhook_endpoint", deleted: true } };
  },
});
