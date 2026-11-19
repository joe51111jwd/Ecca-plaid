import { NextResponse, type NextRequest } from "next/server";
import { isAppError, toErrorBody } from "@/lib/errors";
import { getCurrentUser, getRequestInfo } from "@/server/auth";
import { downloadAcknowledgmentForUser } from "@/server/acknowledgments";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/**
 * GET /donor/acknowledgments/{id}: the signed-in donor's own copy of an issued acknowledgment (PDF). The service
 * answers not found for anything that is not theirs, and audits the download. Signed out: back to sign-in.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent("/donor")}`, request.url), { headers: PRIVATE });
  const { id } = await params;
  try {
    const file = await downloadAcknowledgmentForUser(user.id, id, { request: await getRequestInfo() });
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        ...PRIVATE,
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        ETag: `"${file.sha256}"`,
      },
    });
  } catch (e) {
    if (!isAppError(e)) console.error(e);
    const { status, body } = toErrorBody(e);
    return NextResponse.json(body, { status, headers: PRIVATE });
  }
}
