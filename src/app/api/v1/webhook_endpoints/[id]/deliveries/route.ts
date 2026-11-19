import { apiRoute, listDeliveriesForMode, listEnvelope, operation, toApiWebhookDelivery } from "@/server/api";
import { getEndpoint } from "@/server/webhooks";

export const dynamic = "force-dynamic";

/** GET /api/v1/webhook_endpoints/{id}/deliveries — attempts for events of the key's mode only. */
export const GET = apiRoute({
  ...operation("listWebhookDeliveries"),
  handler: async (ctx) => {
    const endpoint = await getEndpoint(ctx.org.id, ctx.params.id);
    const page = await listDeliveriesForMode({ orgId: ctx.org.id, endpointId: endpoint.id, mode: ctx.mode, limit: ctx.query.limit, ...(ctx.query.status ? { status: ctx.query.status } : {}), ...(ctx.query.starting_after ? { cursor: ctx.query.starting_after } : {}) });
    return { body: listEnvelope(page.items.map((d) => toApiWebhookDelivery(d, ctx.mode)), page.nextCursor) };
  },
});
