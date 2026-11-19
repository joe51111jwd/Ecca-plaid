import { apiHandoff, apiRoute, operation } from "@/server/api";
import { extendHold } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/** POST /api/v1/handoffs/{id}/extend_hold */
export const POST = apiRoute({
  ...operation("extendHandoffHold"),
  handler: async (ctx) => {
    const row = await extendHold(ctx.org.id, ctx.params.id, ctx.body.hours, ctx.handoffActor);
    ctx.setAuditTarget("handoff", row.id);
    return { body: await apiHandoff(ctx.org.id, row.id, ctx.mode) };
  },
});
