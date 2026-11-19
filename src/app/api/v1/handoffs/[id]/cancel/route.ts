import { apiHandoff, apiRoute, operation } from "@/server/api";
import { cancelHandoff } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/** POST /api/v1/handoffs/{id}/cancel */
export const POST = apiRoute({
  ...operation("cancelHandoff"),
  handler: async (ctx) => {
    const row = await cancelHandoff(ctx.org.id, ctx.params.id, ctx.handoffActor, ctx.body.reason !== undefined ? { reason: ctx.body.reason } : {});
    ctx.setAuditTarget("handoff", row.id);
    return { body: await apiHandoff(ctx.org.id, row.id, ctx.mode) };
  },
});
