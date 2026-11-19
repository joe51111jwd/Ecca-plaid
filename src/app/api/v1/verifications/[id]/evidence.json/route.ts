import { apiRoute, evidenceResponse, operation } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/verifications/{id}/evidence.json — the signed record; 409 evidence_not_ready until it exists; audited. */
export const GET = apiRoute({
  ...operation("getEvidenceJson"),
  handler: (ctx) => evidenceResponse(ctx, "json"),
});
