import { requireSgoActor } from "@/features/sgo/server/context";
import { donationsCsvFile, serveDashboardFile } from "@/features/sgo/server/downloads";

export const dynamic = "force-dynamic";

/** GET /sgo/donations/export?year=2027&status=succeeded: the donations CSV for the dashboard's mode (audited). */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return serveDashboardFile((actor) => donationsCsvFile(actor, { taxYear: url.searchParams.get("year"), status: url.searchParams.get("status") }), () => requireSgoActor());
}
