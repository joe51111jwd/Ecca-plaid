import { apiHandoff, apiRoute, operation } from "@/server/api";
import { completeHandoff } from "@/server/handoffs";

export const dynamic = "force-dynamic";

/** POST /api/v1/handoffs/{id}/complete — only from awarded; accrues the business's success fee (never the family's). */
export const POST = apiRoute({
  ...operation("completeHandoff"),
  handler: async (ctx) => {
    const result = await completeHandoff(ctx.org.id, ctx.params.id, ctx.handoffActor, ctx.body.booking_amount_cents !== undefined ? { bookingAmountCents: ctx.body.booking_amount_cents } : {});
    ctx.setAuditTarget("handoff", result.handoff.id);
    return { body: await apiHandoff(ctx.org.id, result.handoff.id, ctx.mode) };
  },
});
