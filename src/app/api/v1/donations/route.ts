import { apiRoute, listEnvelope, operation } from "@/server/api";
import { listDonationsForSgo, toApiDonation } from "@/server/donations";

export const dynamic = "force-dynamic";

/** GET /api/v1/donations — newest first, in the key's mode; audited by the donations service. */
export const GET = apiRoute({
  ...operation("listDonations"),
  handler: async (ctx) => {
    const page = await listDonationsForSgo(
      ctx.org.id,
      { mode: ctx.mode, limit: ctx.query.limit, cursor: ctx.query.starting_after ?? null, ...(ctx.query.status ? { status: ctx.query.status } : {}), ...(ctx.query.tax_year !== undefined ? { taxYear: ctx.query.tax_year } : {}) },
      { actor: { type: "api_key", id: ctx.apiKey.id }, request: ctx.actor.request },
    );
    return { body: listEnvelope(page.items.map((item) => toApiDonation(item.donation, item.donor)), page.nextCursor) };
  },
});
