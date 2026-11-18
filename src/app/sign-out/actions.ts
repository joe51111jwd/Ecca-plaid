"use server";

import { redirect } from "next/navigation";
import { audit } from "@/server/audit";
import { clearSessionCookie, getRequestInfo, getSessionCookieToken, revokeSessionByToken } from "@/server/auth";

/**
 * Ends the current session: revokes it server-side and clears the cookie. A Server Action, so it only runs on
 * POST (Next.js checks the Origin header of action requests). Usable directly as a form action, e.g.
 * `<UserMenu signOutAction={signOutAction} />`.
 */
export async function signOutAction(formData: FormData): Promise<void> {
  const lang = formData.get("lang") === "es" ? "&lang=es" : "";
  const token = await getSessionCookieToken();
  const revoked = token ? await revokeSessionByToken(token) : null;
  if (revoked) {
    await audit({ actor: { type: "user", id: revoked.userId }, action: "auth.sign_out", target: { type: "session", id: revoked.id }, request: await getRequestInfo() });
  }
  await clearSessionCookie();
  redirect(`/sign-in?signed_out=1${lang}`);
}
