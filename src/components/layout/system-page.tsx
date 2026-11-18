import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { MAIN_CONTENT_ID } from "./skip-link";

export interface SystemPageProps {
  /** Small label above the title: "Error 404". */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons: the way out. */
  actions?: ReactNode;
  /** Small print under the actions (a reference code for support). */
  footnote?: ReactNode;
  /** Where the logo links; null = not a link. */
  homeHref?: string | null;
}

/** Full-page message in the system style: not found, something went wrong, link expired, signed out. */
export function SystemPage({ eyebrow, title, description, actions, footnote, homeHref = "/" }: SystemPageProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-4 py-5 sm:px-6">
        <Logo href={homeHref ?? undefined} size="sm" />
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex flex-1 items-center justify-center px-4 pb-24 outline-none sm:px-6">
        <div className="w-full max-w-lg text-center">
          {eyebrow ? <p className="text-sm font-semibold text-brand-700">{eyebrow}</p> : null}
          <h1 className="mt-2 font-display text-display-sm text-fg sm:text-display-md">{title}</h1>
          {description ? <div className="mt-4 text-base text-fg-muted">{description}</div> : null}
          {actions ? <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">{actions}</div> : null}
          {footnote ? <div className="mt-8 text-sm text-fg-subtle">{footnote}</div> : null}
        </div>
      </main>
    </div>
  );
}
