import type { ReactNode } from "react";
import { EmbedShell, FocusShell } from "@/components/layout";
import { Banner, LanguageToggle, Stepper, TextLink } from "@/components/ui";
import { getDictionary, type Locale } from "@/i18n";
import { STEPPER_STEPS, type StepperStep, type Surface } from "../flow";
import { EMBED_LANGUAGE_PATH, LANGUAGE_PATH } from "../policy";

export interface FlowShellProps {
  surface: Surface;
  locale: Locale;
  /** The path of this page without `lang` (where the language switch comes back to). */
  currentPath: string;
  /** The scholarship organization, shown so the family recognizes who is asking. */
  orgName?: string | null;
  /** Test-mode verification: a practice banner on every screen. */
  sandbox?: boolean;
  step?: StepperStep | null;
  back?: string | null;
  /** Show "Save and finish later" (the family is signed in). */
  showExit?: boolean;
  width?: "sm" | "md" | "lg";
  children: ReactNode;
}

/** `/family/language?to=…&next=…` (or the embed twin) for each language. */
export function languageHrefs(surface: Surface, currentPath: string): Record<Locale, string> {
  const route = surface === "embed" ? EMBED_LANGUAGE_PATH : LANGUAGE_PATH;
  const href = (to: Locale) => `${route}?${new URLSearchParams({ to, next: currentPath }).toString()}`;
  return { en: href("en"), es: href("es") };
}

/**
 * The frame of every family screen: the focus shell on this site (logo, the organization's name, language switch,
 * progress, back link, "save and finish later") or the chrome-less embed shell inside a partner's page.
 */
export function FlowShell({ surface, locale, currentPath, orgName, sandbox, step, back, showExit, width = "md", children }: FlowShellProps) {
  const t = getDictionary(locale);
  const toggle = <LanguageToggle current={locale} hrefs={languageHrefs(surface, currentPath)} />;
  const stepper = step ? <Stepper locale={locale} current={step} variant={surface === "embed" ? "compact" : "auto"} steps={STEPPER_STEPS.map((id) => ({ id, label: t.common.steps[id] }))} /> : null;
  const banner = sandbox ? <Banner tone="sandbox">{t.common.sandboxBanner}</Banner> : null;

  if (surface === "embed") {
    return (
      <EmbedShell locale={locale} partner={orgName ? { name: orgName } : undefined} languageToggle={toggle} secureNote="family">
        {banner ? <div className="mb-4 overflow-hidden rounded-card">{banner}</div> : null}
        {stepper ? <div className="mb-5">{stepper}</div> : null}
        {back ? (
          <a href={back} className="mb-3 inline-flex min-h-11 items-center text-base font-medium text-fg-muted hover:text-fg">
            ‹ {t.common.back}
          </a>
        ) : null}
        <div className="rounded-panel border border-line bg-surface p-5 shadow-sm">{children}</div>
      </EmbedShell>
    );
  }

  return (
    <FocusShell
      locale={locale}
      width={width}
      homeHref={null}
      partner={orgName ? { name: orgName } : undefined}
      languageToggle={toggle}
      banner={banner}
      progress={stepper}
      back={back ? { href: back, label: t.common.back } : undefined}
      exit={
        showExit ? (
          <TextLink href={locale === "es" ? "/family?lang=es" : "/family"} tone="quiet" standalone>
            {t.common.saveForLater}
          </TextLink>
        ) : undefined
      }
      secureNote="family"
    >
      {children}
    </FocusShell>
  );
}
