import { Languages } from "lucide-react";
import { cn } from "./cn";
import { uiStrings, type UiLocale } from "./locale";

export interface LanguageToggleProps {
  current: UiLocale;
  /** Where each language lives. The page builds these (same page, other locale). */
  hrefs: Record<UiLocale, string>;
  className?: string;
}

const NAMES: Record<UiLocale, string> = { en: "English", es: "Español" };

/**
 * English / Español switcher. Presentational: plain links, so it works before any script loads and the
 * choice is a URL. Each language is written in itself.
 */
export function LanguageToggle({ current, hrefs, className }: LanguageToggleProps) {
  return (
    <nav aria-label={uiStrings(current).language} className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Languages aria-hidden="true" className="mr-0.5 size-4 text-fg-muted" />
      {(Object.keys(NAMES) as UiLocale[]).map((locale, index) => (
        <span key={locale} className="inline-flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="text-fg-disabled">
              /
            </span>
          ) : null}
          {/* A plain anchor: switching language must be a full document navigation so <html lang> is re-rendered. */}
          <a
            href={hrefs[locale]}
            lang={locale}
            hrefLang={locale}
            aria-current={locale === current ? "true" : undefined}
            className={cn("inline-flex min-h-6 items-center rounded-sm px-1 py-1", locale === current ? "font-semibold text-fg" : "text-fg-muted underline decoration-1 underline-offset-[3px] hover:text-fg")}
          >
            {NAMES[locale]}
          </a>
        </span>
      ))}
    </nav>
  );
}
