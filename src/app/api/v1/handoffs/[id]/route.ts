import { apiHandoff, apiRoute, operation } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/handoffs/{id} */
export const GET = apiRoute({
  ...operation("getHandoff"),
  handler: async (ctx) => ({ body: await apiHandoff(ctx.org.id, ctx.params.id, ctx.mode) }),
});
