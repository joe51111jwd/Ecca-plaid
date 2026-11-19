import { apiRoute, operation } from "@/server/api";
import { getVerification, toApiVerification } from "@/server/verifications";

export const dynamic = "force-dynamic";

/** GET /api/v1/verifications/{id} — audited read. */
export const GET = apiRoute({
  ...operation("getVerification"),
  handler: async (ctx) => ({ body: toApiVerification(await getVerification(ctx.org.id, ctx.params.id, { mode: ctx.mode, actor: ctx.actor }), { baseUrl: ctx.baseUrl }) }),
});
