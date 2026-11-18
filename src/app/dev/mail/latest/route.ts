import { NextResponse, type NextRequest } from "next/server";
import { badRequest, notFound as emailNotFound, toErrorBody } from "@/lib/errors";
import { extractLinks, listOutbox } from "@/server/email";
import { assertDevMailboxEnabled } from "../shared";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function errorResponse(error: unknown): NextResponse {
  const { status, body } = toErrorBody(error);
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * GET /dev/mail/latest?to=<email>[&template=<name>]
 *
 * The newest email recorded for a recipient, as JSON — how end-to-end tests pick up sign-in links:
 *
 *   const res = await request.get(`/dev/mail/latest?to=${encodeURIComponent(email)}`);
 *   const { links } = await res.json();          // links[0] is the first URL in the text body
 *
 * 400 without `to`, 404 when nothing was sent to that address, and 404 for everything in production.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  assertDevMailboxEnabled();
  const to = request.nextUrl.searchParams.get("to")?.trim();
  if (!to) return errorResponse(badRequest('Query parameter "to" is required'));
  const template = request.nextUrl.searchParams.get("template")?.trim() || undefined;

  const [email] = await listOutbox({ to, template, limit: 1 });
  if (!email) return errorResponse(emailNotFound("Email"));

  return NextResponse.json(
    {
      id: email.id,
      to: email.toEmail,
      subject: email.subject,
      template: email.template,
      status: email.status,
      text: email.text,
      html: email.html,
      links: extractLinks(email.text),
      createdAt: email.createdAt.toISOString(),
    },
    { headers: noStore },
  );
}
