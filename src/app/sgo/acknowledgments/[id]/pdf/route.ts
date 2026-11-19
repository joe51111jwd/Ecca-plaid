import { requireSgoActor } from "@/features/sgo/server/context";
import { acknowledgmentFile, serveDashboardFile } from "@/features/sgo/server/downloads";

export const dynamic = "force-dynamic";

/** GET /sgo/acknowledgments/{id}/pdf: one acknowledgment version as issued (hash-checked, audited). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return serveDashboardFile((actor) => acknowledgmentFile(actor, id), () => requireSgoActor());
}
