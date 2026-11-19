import { apiRoute, listEnvelope, operation, toApiEvent } from "@/server/api";
import { listEvents } from "@/server/events";

export const dynamic = "force-dynamic";

/** GET /api/v1/events — newest first, in the key's mode. */
export const GET = apiRoute({
  ...operation("listEvents"),
  handler: async (ctx) => {
    const rows = await listEvents({ orgId: ctx.org.id, mode: ctx.mode, limit: ctx.query.limit + 1, ...(ctx.query.type ? { type: ctx.query.type } : {}), ...(ctx.query.starting_after ? { before: ctx.query.starting_after } : {}) });
    const page = rows.slice(0, ctx.query.limit);
    return { body: listEnvelope(page.map(toApiEvent), rows.length > ctx.query.limit ? page[page.length - 1].id : null) };
  },
});
