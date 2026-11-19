import { notFound } from "@/lib/errors";
import { apiRoute, operation, toApiEvent } from "@/server/api";
import { getEvent } from "@/server/events";

export const dynamic = "force-dynamic";

/** GET /api/v1/events/{id} — an event of the other mode is not found. */
export const GET = apiRoute({
  ...operation("getEvent"),
  handler: async (ctx) => {
    const event = await getEvent(ctx.org.id, ctx.params.id);
    if (event.mode !== ctx.mode) throw notFound("Event");
    return { body: toApiEvent(event) };
  },
});
