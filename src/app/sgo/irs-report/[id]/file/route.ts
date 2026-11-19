import { requireSgoActor } from "@/features/sgo/server/context";
import { irsReportFile, serveDashboardFile } from "@/features/sgo/server/downloads";

export const dynamic = "force-dynamic";

/** GET /sgo/irs-report/{id}/file: one stored report version as CSV (hash-checked, audited). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return serveDashboardFile((actor) => irsReportFile(actor, id), () => requireSgoActor());
}
