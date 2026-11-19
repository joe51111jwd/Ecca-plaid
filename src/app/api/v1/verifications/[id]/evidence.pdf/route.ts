import { apiRoute, evidenceResponse, operation } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/verifications/{id}/evidence.pdf — 409 evidence_not_ready until the pack exists; audited. */
export const GET = apiRoute({
  ...operation("getEvidencePdf"),
  handler: (ctx) => evidenceResponse(ctx, "pdf"),
});
