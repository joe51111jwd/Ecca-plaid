import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Button, SubmitButton } from "@/components/ui";
import { defaultLandingPath, getCurrentUser } from "@/server/auth";
import { firstParam, parseLocale, signInCopy } from "../sign-in/copy";
import { signOutAction } from "./actions";

export const metadata: Metadata = { title: "Sign out", robots: { index: false } };

/** GET only confirms; signing out happens in the POSTed server action (a link or prefetch must never sign anyone out). */
export default async function SignOutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = parseLocale(firstParam((await searchParams).lang));
  const t = signInCopy(locale);
  const user = await getCurrentUser();

  return (
    <FocusShell width="sm" locale={locale}>
      <h1 className="text-2xl font-semibold text-fg">{t.signOutTitle}</h1>
      {user ? (
        <>
          <p className="mt-2 mb-6 text-fg-muted">{t.signOutBody(user.email)}</p>
          <form action={signOutAction} className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <input type="hidden" name="lang" value={locale} />
            <SubmitButton pendingText={t.signOutPending} size="lg">
              {t.signOutButton}
            </SubmitButton>
            <Button variant="secondary" size="lg" href={await defaultLandingPath(user.id)}>
              {t.signOutCancel}
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-2 mb-6 text-fg-muted">{t.notSignedIn}</p>
          <Button href={locale === "es" ? "/sign-in?lang=es" : "/sign-in"} size="lg">
            {t.goToSignIn}
          </Button>
        </>
      )}
    </FocusShell>
  );
}
