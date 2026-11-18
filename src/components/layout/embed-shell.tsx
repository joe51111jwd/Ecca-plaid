import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import { OrgMark } from "@/components/ui/avatar";
import { uiStrings, type UiLocale } from "@/components/ui/locale";
import { BRAND } from "@/lib/brand";
import { EmbedFrame } from "./embed-frame";
import { MAIN_CONTENT_ID } from "./skip-link";

export interface EmbedShellProps {
  children: ReactNode;
  /** The business whose page embeds this: shown in a slim header so the family sees a familiar name. */
  partner?: { name: string; logoUrl?: string | null };
  /** A `<LanguageToggle>` shown at the end of the header. */
  languageToggle?: ReactNode;
  /** Post the content height to the parent page so it can size the iframe. Default true. */
  autoHeight?: boolean;
  /**
   * The embedding page's origin (one of the business's allowed origins). Messages are only delivered to
   * that origin. Default "*": the height carries no personal data, but pass the real origin when known.
   */
  targetOrigin?: string;
  locale?: UiLocale;
  /** The reassurance line under the content: "family", "donor", your own text, or false to hide it (see FocusShell). */
  secureNote?: "family" | "donor" | false | Exclude<ReactNode, string> | (string & {});
}

/**
 * Chrome-less shell for pages shown inside a partner's iframe (/embed/…): no site header or footer,
 * transparent page background, touch-sized controls, and automatic height reporting to the parent.
 */
export function EmbedShell({ children, partner, languageToggle, autoHeight = true, targetOrigin, locale = "en", secureNote }: EmbedShellProps) {
  const t = uiStrings(locale);
  return (
    <EmbedFrame autoHeight={autoHeight} targetOrigin={targetOrigin} locale={locale}>
      {partner || languageToggle ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {partner ? (
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <OrgMark name={partner.name} logoUrl={partner.logoUrl} size="sm" />
              <span className="truncate font-semibold text-fg">{partner.name}</span>
            </span>
          ) : (
            <span />
          )}
          {languageToggle}
        </header>
      ) : null}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
        {children}
      </main>
      {secureNote === false ? null : (
        <footer className="mt-4 flex items-start gap-2 text-xs leading-5 text-fg-muted">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {secureNote === "family" ? t.secureNoteFamily : secureNote === "donor" ? t.secureNoteDonor : (secureNote ?? t.secureNote)} <span className="whitespace-nowrap">· {BRAND.name}</span>
          </span>
        </footer>
      )}
    </EmbedFrame>
  );
}
