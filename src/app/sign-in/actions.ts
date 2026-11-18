"use server";

import { redirect } from "next/navigation";
import { actionError, isAppError, type ActionResult } from "@/lib/errors";
import { consumeCode, defaultLandingPath, getRequestInfo, requestSignIn, sanitizeRedirect, setSessionCookie } from "@/server/auth";
import { parseLocale, signInCopy } from "./copy";

/** Turns a service error into a message in the page's language, without leaking internals. */
function localizedFailure(e: unknown, locale: "en" | "es"): Extract<ActionResult<never>, { ok: false }> {
  const t = signInCopy(locale);
  if (!isAppError(e)) return actionError(e);
  const fields = (e.details as { fields?: Record<string, string> } | undefined)?.fields;
  if (e.code === "rate_limited") return { ok: false, error: { code: e.code, message: locale === "es" ? t.rateLimitedBody : e.message } };
  if (e.code === "validation_failed" && fields?.email) return { ok: false, error: { code: e.code, message: t.invalidEmail, fields: { email: t.invalidEmail } } };
  if (e.code === "validation_failed" || e.code === "gone") return { ok: false, error: { code: e.code, message: t.invalidCode, fields: { code: t.invalidCode } } };
  return { ok: false, error: { code: "internal", message: t.genericError } };
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/** Step 1: email a sign-in link and code. The result is the same whether or not the address has an account. */
export async function requestSignInAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ email: string }>> {
  const locale = parseLocale(text(formData, "lang"));
  try {
    const res = await requestSignIn({
      email: text(formData, "email"),
      redirectTo: sanitizeRedirect(text(formData, "next")),
      locale,
      request: await getRequestInfo(),
    });
    return { ok: true, data: { email: res.email } };
  } catch (e) {
    return localizedFailure(e, locale);
  }
}

/** Step 2: finish in the same window with the 6-digit code. Redirects on success. */
export async function verifyCodeAction(_prev: unknown, formData: FormData): Promise<ActionResult<never>> {
  const locale = parseLocale(text(formData, "lang"));
  let destination: string;
  try {
    const result = await consumeCode({ email: text(formData, "email"), code: text(formData, "code") }, await getRequestInfo());
    await setSessionCookie(result.sessionToken);
    destination = sanitizeRedirect(text(formData, "next")) ?? result.redirectTo ?? (await defaultLandingPath(result.user.id));
  } catch (e) {
    return localizedFailure(e, locale);
  }
  // Outside the try: redirect() works by throwing.
  redirect(destination);
}
