import { apiRoute, operation } from "@/server/api";
import { cancelVerification, toApiVerification } from "@/server/verifications";

export const dynamic = "force-dynamic";

/** POST /api/v1/verifications/{id}/cancel */
export const POST = apiRoute({
  ...operation("cancelVerification"),
  handler: async (ctx) => {
    const row = await cancelVerification(ctx.org.id, ctx.params.id, ctx.actor);
    ctx.setAuditTarget("verification", row.id);
    return { body: toApiVerification(row, { baseUrl: ctx.baseUrl }) };
  },
});
