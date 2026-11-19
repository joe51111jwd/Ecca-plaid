import { apiRoute, operation, toApiMe } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/me — the organization and mode of the key. */
export const GET = apiRoute({
  ...operation("getMe"),
  handler: async (ctx) => ({ body: toApiMe(ctx.org, ctx.mode, ctx.apiKey) }),
});
