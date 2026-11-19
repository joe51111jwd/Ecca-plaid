import type { Metadata } from "next";
import { FocusShell, SystemPage } from "@/components/layout";
import { LanguageToggle } from "@/components/ui";
import { cancelHandoffByFamilyAction, chooseSgoAction } from "@/app/h/actions";
import { familyPageCopy, pickFamilyLocale } from "@/features/handoff/copy";
import { FamilyHandoff } from "@/features/handoff/components/FamilyHandoff";
import { loadFamilyView } from "@/features/handoff/server/family-page";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = pickFamilyLocale((await searchParams).lang);
  // The URL carries the family's token: never send it to another site in a Referer header.
  return { title: familyPageCopy(locale).pageTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** /h/{token} — the family's hosted handoff page, reached from a camp's or school's booking checkout. */
export default async function HandoffPage({ params, searchParams }: Props) {
  const { token } = await params;
  const locale = pickFamilyLocale((await searchParams).lang);
  const t = familyPageCopy(locale);
  const view = await loadFamilyView(token);
  if (!view) return <SystemPage title={t.notFoundTitle} description={t.notFoundBody} homeHref={null} />;
  const base = `/h/${encodeURIComponent(token)}`;
  return (
    <FocusShell
      partner={{ name: view.business.displayName, logoUrl: view.business.logoUrl }}
      languageToggle={<LanguageToggle current={locale} hrefs={{ en: base, es: `${base}?lang=es` }} />}
      homeHref={null}
      locale={locale}
      width="lg"
      secureNote="family"
    >
      <FamilyHandoff view={view} token={token} locale={locale} actions={{ choose: chooseSgoAction, cancel: cancelHandoffByFamilyAction }} />
    </FocusShell>
  );
}
