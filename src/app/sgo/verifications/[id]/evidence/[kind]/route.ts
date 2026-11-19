import { requireSgoActor } from "@/features/sgo/server/context";
import { evidenceFile, serveDashboardFile } from "@/features/sgo/server/downloads";

export const dynamic = "force-dynamic";

/** GET /sgo/verifications/{id}/evidence/{pdf|json}: the evidence pack, for the dashboard's organization and mode (audited). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; kind: string }> }): Promise<Response> {
  const { id, kind } = await params;
  return serveDashboardFile((actor) => evidenceFile(actor, id, kind), () => requireSgoActor());
}
