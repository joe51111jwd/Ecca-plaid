import { notFound } from "@/lib/errors";
import { requireSgoActor } from "@/features/sgo/server/context";
import { documentFile, serveDashboardFile } from "@/features/sgo/server/downloads";

export const dynamic = "force-dynamic";

/**
 * GET /sgo/verifications/{id}/documents/{documentId}: the raw upload for the inline viewer. Every open is audited as
 * `document.view`; a purged file answers 410 (its hash and extracted fields are kept).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }): Promise<Response> {
  const { id, documentId } = await params;
  return serveDashboardFile(async (actor) => {
    const file = await documentFile(actor, documentId);
    if (file.verificationId !== id) throw notFound("Document");
    return file;
  }, () => requireSgoActor());
}
