import type { Metadata } from "next";
import { EmbedShell } from "@/components/layout";
import { Button, LanguageToggle } from "@/components/ui";
import { cancelHandoffByFamilyAction, chooseSgoAction } from "@/app/h/actions";
import { familyPageCopy, pickFamilyLocale } from "@/features/handoff/copy";
import { FamilyHandoff } from "@/features/handoff/components/FamilyHandoff";
import { FrameGuard } from "@/features/handoff/components/FrameGuard";
import { resolveParentOrigin } from "@/features/handoff/family-view";
import { loadFamilyView } from "@/features/handoff/server/family-page";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = pickFamilyLocale((await searchParams).lang);
  return { title: familyPageCopy(locale).pageTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * /embed/handoff/{token} — the same handoff page inside the business's booking checkout (opened by
 * public/embed/handoff.js in inline mode). The embedding origin arrives as `parent_origin` and is honoured only when it
 * is one of the business's allowed origins; messages (height, status) go to that origin alone.
 */
export default async function EmbeddedHandoffPage({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  const locale = pickFamilyLocale(query.lang);
  const t = familyPageCopy(locale);
  const view = await loadFamilyView(token);
  const hosted = `/h/${encodeURIComponent(token)}${locale === "es" ? "?lang=es" : ""}`;
  if (!view) {
    return (
      <EmbedShell locale={locale} autoHeight={false} secureNote={false}>
        <h1 className="text-lg font-semibold text-fg">{t.notFoundTitle}</h1>
        <p className="mt-2 text-fg-muted">{t.notFoundBody}</p>
      </EmbedShell>
    );
  }
  const parentOrigin = resolveParentOrigin(query.parent_origin, view.frameAncestors);
  const self = `/embed/handoff/${encodeURIComponent(token)}`;
  const keep = parentOrigin ? `parent_origin=${encodeURIComponent(parentOrigin)}` : "";
  const fallback = (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-fg">{t.framedBlockedTitle}</h1>
      <p className="text-fg-muted">{t.framedBlockedBody}</p>
      <Button href={hosted} target="_blank" rel="noopener noreferrer">
        {t.framedBlockedOpen}
      </Button>
    </div>
  );
  return (
    <EmbedShell
      partner={{ name: view.business.displayName, logoUrl: view.business.logoUrl }}
      languageToggle={<LanguageToggle current={locale} hrefs={{ en: keep ? `${self}?${keep}` : self, es: `${self}?${keep ? `${keep}&` : ""}lang=es` }} />}
      targetOrigin={parentOrigin ?? undefined}
      autoHeight={parentOrigin !== null}
      locale={locale}
      secureNote="family"
    >
      <FrameGuard allowedParent={parentOrigin} fallback={fallback}>
        <FamilyHandoff view={view} token={token} locale={locale} parentOrigin={parentOrigin} actions={{ choose: chooseSgoAction, cancel: cancelHandoffByFamilyAction }} />
      </FrameGuard>
    </EmbedShell>
  );
}
