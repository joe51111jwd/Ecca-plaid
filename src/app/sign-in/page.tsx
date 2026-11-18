import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FocusShell } from "@/components/layout";
import { Alert, LanguageToggle } from "@/components/ui";
import { defaultLandingPath, emailAddressSchema, getCurrentUser, sanitizeRedirect } from "@/server/auth";
import { firstParam, parseLocale, signInCopy } from "./copy";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function hrefWith(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/sign-in?${s}` : "/sign-in";
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const locale = parseLocale(firstParam(sp.lang));
  const next = sanitizeRedirect(firstParam(sp.next));
  const error = firstParam(sp.error);
  const prefill = emailAddressSchema.safeParse(firstParam(sp.email) ?? "");
  const defaultEmail = prefill.success ? prefill.data : "";

  const user = await getCurrentUser();
  if (user && !error) redirect(next ?? (await defaultLandingPath(user.id)));

  const t = signInCopy(locale);
  const keep = { next: next ?? undefined, email: defaultEmail || undefined };
  return (
    <FocusShell width="sm" locale={locale} languageToggle={<LanguageToggle current={locale} hrefs={{ en: hrefWith(keep), es: hrefWith({ ...keep, lang: "es" }) }} />}>
      <h1 className="text-2xl font-semibold text-fg">{t.title}</h1>
      <p className="mt-2 mb-6 text-fg-muted">{t.intro}</p>
      {error === "link_invalid" ? (
        <Alert tone="warning" title={t.linkInvalidTitle} className="mb-6">
          {t.linkInvalidBody}
        </Alert>
      ) : error === "rate_limited" ? (
        <Alert tone="warning" title={t.rateLimitedTitle} className="mb-6">
          {t.rateLimitedBody}
        </Alert>
      ) : firstParam(sp.signed_out) ? (
        <Alert tone="info" role="status" className="mb-6">
          {t.signedOut}
        </Alert>
      ) : null}
      <SignInForm locale={locale} next={next} defaultEmail={defaultEmail} />
    </FocusShell>
  );
}
