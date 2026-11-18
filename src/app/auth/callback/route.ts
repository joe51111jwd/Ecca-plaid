import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@/lib/errors";
import { consumeToken, defaultLandingPath, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { requestInfoFromHeaders } from "@/server/audit";

export const dynamic = "force-dynamic";

/** Responses here carry or follow a credential: never cache them and never leak the URL as a referrer. */
const PRIVATE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function redirectTo(request: NextRequest, path: string): NextResponse {
  const url = request.nextUrl.clone();
  const withoutHash = path.split("#")[0];
  const q = withoutHash.indexOf("?");
  url.pathname = q === -1 ? withoutHash : withoutHash.slice(0, q);
  url.search = q === -1 ? "" : withoutHash.slice(q);
  url.hash = "";
  // 303: the browser follows with a GET and the token URL is replaced in history.
  return NextResponse.redirect(url, { status: 303, headers: PRIVATE_HEADERS });
}

/**
 * GET /auth/callback?token=…  — the link in the sign-in email. Consumes the single-use token, sets the session
 * cookie and sends the person on: to the destination stored with the link, else to their role's home page.
 * Any failure goes back to /sign-in with a friendly "ask for a new link" state.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  const lang = request.nextUrl.searchParams.get("lang") === "es" ? "&lang=es" : "";
  try {
    const result = await consumeToken(token, requestInfoFromHeaders(request.headers));
    const destination = result.redirectTo ?? (await defaultLandingPath(result.user.id));
    const response = redirectTo(request, destination);
    response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
    return response;
  } catch (e) {
    if (isAppError(e) && e.code === "rate_limited") return redirectTo(request, `/sign-in?error=rate_limited${lang}`);
    if (!isAppError(e)) console.error(e);
    return redirectTo(request, `/sign-in?error=link_invalid${lang}`);
  }
}
