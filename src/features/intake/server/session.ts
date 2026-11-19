/**
 * Who is signed in on a family screen, and the cookies the family flow sets. The main session cookie belongs to
 * the auth service; the embedded flow uses its own partitioned cookie (see EMBED_SESSION_COOKIE) holding the same
 * kind of session token, always validated through the auth service.
 */
import { cookies } from "next/headers";
import { env, isProd } from "@/lib/env";
import { getCurrentUser, getSessionFromToken, revokeSessionByToken, sessionCookieOptions, setSessionCookie, type User } from "@/server/auth";
import type { Surface } from "../flow";
import { EMBED_SESSION_COOKIE, PENDING_LINK_COOKIE, PENDING_LINK_MAX_AGE_SECONDS } from "../policy";

/** Cookie attributes for a cookie that must work inside a partner's iframe (third-party context). */
function embedCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/", maxAge };
}

function firstPartySecure(): boolean {
  return isProd() || env().APP_URL.startsWith("https://");
}

/**
 * The signed-in person for this surface. The embedded flow prefers its own session (inside a partner's frame the
 * main cookie is never sent) and falls back to the main one (the same page opened on this site).
 */
export async function getFamilyUser(surface: Surface): Promise<User | null> {
  if (surface === "embed") {
    const token = (await cookies()).get(EMBED_SESSION_COOKIE)?.value;
    if (token) {
      const found = await getSessionFromToken(token);
      if (found) return found.user;
    }
  }
  return getCurrentUser();
}

/** Stores a freshly created session token for this surface. */
export async function setFamilySession(surface: Surface, token: string): Promise<void> {
  if (surface === "embed") {
    const maxAge = sessionCookieOptions().maxAge;
    (await cookies()).set(EMBED_SESSION_COOKIE, token, embedCookieOptions(maxAge));
    return;
  }
  await setSessionCookie(token);
}

/** Ends the embedded session: revokes it and clears the partitioned cookie. Returns the revoked session's user id. */
export async function endEmbedSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(EMBED_SESSION_COOKIE)?.value;
  const revoked = token ? await revokeSessionByToken(token) : null;
  jar.set(EMBED_SESSION_COOKIE, "", embedCookieOptions(0));
  return revoked?.userId ?? null;
}

/** Remembers which verification link a sign-in was started from (read back by the continue route). */
export async function rememberPendingLink(token: string): Promise<void> {
  (await cookies()).set(PENDING_LINK_COOKIE, token, { httpOnly: true, secure: firstPartySecure(), sameSite: "lax", path: "/", maxAge: PENDING_LINK_MAX_AGE_SECONDS });
}

/** Reads and forgets the pending link. */
export async function takePendingLink(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(PENDING_LINK_COOKIE)?.value ?? null;
  if (token) jar.set(PENDING_LINK_COOKIE, "", { httpOnly: true, secure: firstPartySecure(), sameSite: "lax", path: "/", maxAge: 0 });
  return token;
}

/** Cookie attributes for the remembered language on this surface. */
export function localeCookieOptions(surface: Surface, maxAge: number) {
  return surface === "embed" ? { ...embedCookieOptions(maxAge), httpOnly: false } : { httpOnly: false, secure: firstPartySecure(), sameSite: "lax" as const, path: "/", maxAge };
}
