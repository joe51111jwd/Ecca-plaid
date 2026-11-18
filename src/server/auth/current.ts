import { cookies, headers } from "next/headers";
import { cache } from "react";
import { requestInfoFromHeaders, type AuditRequestInfo } from "@/server/audit";
import { getSessionFromToken, SESSION_COOKIE, sessionCookieOptions, type Session, type User } from "./session";

/**
 * Request-bound helpers on top of next/headers. Reading works in Server Components, Server Functions and Route
 * Handlers; setting/clearing the cookie only in Server Functions and Route Handlers (a Next.js rule).
 */

/** The live session for this request, resolved once per request (React cache). */
export const getCurrentSession = cache(async (): Promise<{ session: Session; user: User } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionFromToken(token);
});

/** The signed-in user for this request, or null. */
export const getCurrentUser = cache(async (): Promise<User | null> => (await getCurrentSession())?.user ?? null);

/** Client IP and user agent of this request, for audit entries and rate-limit keys. */
export async function getRequestInfo(): Promise<AuditRequestInfo> {
  return requestInfoFromHeaders(await headers());
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  // Same attributes as when set, so the browser matches and replaces the cookie.
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

/** The raw session token from the request cookie (for sign-out). */
export async function getSessionCookieToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
