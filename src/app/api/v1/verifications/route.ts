import { apiRoute, listEnvelope, operation, verificationInputFromBody } from "@/server/api";
import { createVerification, listVerifications, toApiVerification } from "@/server/verifications";

export const dynamic = "force-dynamic";

/** POST /api/v1/verifications — create a verification; the family link is returned once. */
export const POST = apiRoute({
  ...operation("createVerification"),
  handler: async (ctx) => {
    const created = await createVerification({ orgId: ctx.org.id, mode: ctx.mode, ...verificationInputFromBody(ctx.body), createdBy: { type: "api_key", id: ctx.apiKey.id } });
    ctx.setAuditTarget("verification", created.verification.id);
    const embedUrl = `${ctx.baseUrl}/embed/verify/${created.familyToken}`;
    return { status: 201, body: { ...toApiVerification(created.verification, { baseUrl: ctx.baseUrl }), family_url: created.familyUrl, embed_url: embedUrl } };
  },
});

/** GET /api/v1/verifications — newest first, in the key's mode. */
export const GET = apiRoute({
  ...operation("listVerifications"),
  handler: async (ctx) => {
    const page = await listVerifications(ctx.org.id, { mode: ctx.mode, status: ctx.query.status ?? null, externalRef: ctx.query.external_ref ?? null, limit: ctx.query.limit, cursor: ctx.query.starting_after ?? null });
    return { body: listEnvelope(page.items.map((row) => toApiVerification(row, { baseUrl: ctx.baseUrl })), page.nextCursor) };
  },
});
