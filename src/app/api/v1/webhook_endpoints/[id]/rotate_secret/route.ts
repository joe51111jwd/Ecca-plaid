import { apiRoute, assertWebhookWritable, operation, toApiWebhookEndpoint } from "@/server/api";
import { rotateSecret } from "@/server/webhooks";

export const dynamic = "force-dynamic";

/** POST /api/v1/webhook_endpoints/{id}/rotate_secret — the new secret is returned once. */
export const POST = apiRoute({
  ...operation("rotateWebhookSecret"),
  handler: async (ctx) => {
    await assertWebhookWritable(ctx);
    const { endpoint, secret } = await rotateSecret(ctx.org.id, ctx.params.id, ctx.body.expire_previous_now ? { overlapMs: 0 } : {});
    ctx.setAuditTarget("webhook_endpoint", endpoint.id);
    return { body: { ...toApiWebhookEndpoint(endpoint), secret } };
  },
});
