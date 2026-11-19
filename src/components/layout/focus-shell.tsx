import { ChevronLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { OrgMark } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { uiStrings, type UiLocale } from "@/components/ui/locale";
import { Logo } from "@/components/ui/logo";
import { HtmlLang } from "./html-lang";
import { orgMarkName } from "./org-mark-name";
import { MAIN_CONTENT_ID } from "./skip-link";

const WIDTH = { sm: "max-w-md", md: "max-w-focus", lg: "max-w-3xl", xl: "max-w-5xl" } as const;

export interface FocusShellPartner {
  /** The organization the person came through: the scholarship organization or the camp/school. */
  name: string;
  logoUrl?: string | null;
}

export interface FocusShellProps {
  children: ReactNode;
  /** Co-branding: shows "with {partner}" beside the logo so the person recognises who sent them. */
  partner?: FocusShellPartner;
  /** A `<LanguageToggle>` for the header. */
  languageToggle?: ReactNode;
  /** A `<Stepper>` shown above the card. */
  progress?: ReactNode;
  /** A back link above the card (previous step). */
  back?: { href: string; label?: ReactNode };
  /** A quiet link at the end of the header ("Save and finish later", "Sign out"). */
  exit?: ReactNode;
  /** A `<Banner>` above the header (sandbox mode). */
  banner?: ReactNode;
  /** A second column beside the card on wide screens (the donor tax-math panel). Stacks under the card on phones. */
  aside?: ReactNode;
  /**
   * Where the aside sits on phones. "below" (default) stacks it under the card; "pinned" puts it above the card and
   * keeps it stuck to the top of the screen while the card scrolls (the donor tax-math summary bar). On wide screens
   * the aside is always a sticky column beside the card.
   */
  asidePlacement?: "below" | "pinned";
  /** Card width: sm sign-in, md (default) one question per screen, lg/xl wider forms and summaries. */
  width?: keyof typeof WIDTH;
  /** false = render children without the card frame (the page supplies its own cards). */
  card?: boolean;
  /** Where the logo links. null = not a link, for flows a person should not wander out of. Default "/". */
  homeHref?: string | null;
  locale?: UiLocale;
  /**
   * The reassurance line in the footer. "family" = documents are stored encrypted and shared only with the
   * approved organization; "donor" = card details go to the processor and are never stored. Omit for a
   * general line, pass your own text, or false to hide it.
   */
  secureNote?: "family" | "donor" | false | Exclude<ReactNode, string> | (string & {});
  /** Small links under the reassurance line (privacy, help). */
  footer?: ReactNode;
}

/**
 * The single-task shell: sign-in, each family intake step, donor checkout. One calm column, one card,
 * large touch targets (it sets data-density="touch", so every control inside is at least 44px tall).
 */
export function FocusShell({ children, partner, languageToggle, progress, back, exit, banner, aside, asidePlacement = "below", width = "md", card = true, homeHref = "/", locale = "en", secureNote, footer }: FocusShellProps) {
  const t = uiStrings(locale);
  const column = aside ? "max-w-5xl" : WIDTH[width];
  const body = card ? <div className="rounded-panel border border-line bg-surface p-5 shadow-sm sm:p-8">{children}</div> : children;
  return (
    <div lang={locale} data-density="touch" className="flex min-h-dvh flex-col bg-canvas">
      <HtmlLang locale={locale} />
      {banner}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo href={homeHref ?? undefined} size="sm" />
            {partner ? (
              <span className="flex min-w-0 items-center gap-2 border-l border-line pl-3 text-sm text-fg-muted">
                <OrgMark name={orgMarkName(partner.name)} logoUrl={partner.logoUrl} size="sm" />
                <span className="truncate font-medium text-fg">{partner.name}</span>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {languageToggle}
            {exit}
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 sm:py-10">
        <div className={cn("mx-auto w-full", column)}>
          {progress ? <div className="mb-6">{progress}</div> : null}
          {back ? (
            <Link href={back.href} className="mb-4 inline-flex min-h-11 items-center gap-1 rounded-sm text-base font-medium text-fg-muted hover:text-fg">
              <ChevronLeft aria-hidden="true" className="size-5" />
              {back.label ?? t.back}
            </Link>
          ) : null}
          {aside ? (
            // Pinned uses a flex column on phones: a sticky grid item could only move within its own row.
            <div className={cn("items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8", asidePlacement === "pinned" ? "flex flex-col *:w-full lg:*:w-auto" : "grid")}>
              <div className="min-w-0">{body}</div>
              <aside className={cn("min-w-0 lg:sticky lg:top-6", asidePlacement === "pinned" && "sticky top-2 z-sticky order-first lg:order-none")}>{aside}</aside>
            </div>
          ) : (
            body
          )}
        </div>
      </main>

      <footer className="px-4 pb-8 sm:px-6">
        <div className={cn("mx-auto w-full text-center text-sm text-fg-muted", column)}>
          {secureNote === false ? null : (
            <p className="flex items-start justify-center gap-2">
              <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{secureNote === "family" ? t.secureNoteFamily : secureNote === "donor" ? t.secureNoteDonor : (secureNote ?? t.secureNote)}</span>
            </p>
          )}
          {footer ? <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">{footer}</div> : null}
        </div>
      </footer>
    </div>
  );
}
