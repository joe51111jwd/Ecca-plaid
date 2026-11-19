import { apiRoute, assertDonationInMode, operation } from "@/server/api";
import { getDonationForSgo, toApiDonation } from "@/server/donations";

export const dynamic = "force-dynamic";

/** GET /api/v1/donations/{id} — another organization's or the other mode's donation is not found; audited. */
export const GET = apiRoute({
  ...operation("getDonation"),
  handler: async (ctx) => {
    await assertDonationInMode(ctx.org.id, ctx.params.id, ctx.mode);
    const detail = await getDonationForSgo(ctx.org.id, ctx.params.id, { actor: { type: "api_key", id: ctx.apiKey.id }, request: ctx.actor.request });
    return { body: toApiDonation(detail.donation, detail.donor) };
  },
});
