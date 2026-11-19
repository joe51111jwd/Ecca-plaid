import { apiRoute, exportVerificationsCsv, operation } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/verifications/export.csv?columns=… — generic, column-mappable CSV; audited as a bulk read. */
export const GET = apiRoute({
  ...operation("exportVerifications"),
  handler: (ctx) => exportVerificationsCsv(ctx),
});
