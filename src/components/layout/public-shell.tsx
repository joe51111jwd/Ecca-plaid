import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "@/app/site.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { LogoMark } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { MAIN_CONTENT_ID } from "./skip-link";

export interface PublicNavItem {
  href: string;
  label: string;
}

/** The public entry points, in the order the header presents them. */
export const PUBLIC_NAV: PublicNavItem[] = [
  { href: "/give", label: "Give" },
  { href: "/family", label: "Families" },
  { href: "/sgo", label: "Organizations" },
  { href: "/partner", label: "Camps" },
  { href: "/docs", label: "Developers" },
];

export interface PublicShellProps {
  children: ReactNode;
  /** Header links. Defaults to PUBLIC_NAV. */
  nav?: PublicNavItem[];
  /** Buttons at the end of the header. Defaults to the "open a test workspace" call to action; pass `null` for none. */
  actions?: ReactNode;
  /** A `<Banner>` above the header. */
  banner?: ReactNode;
  /** Extra legal text for the footer, shown above the standing notes. */
  footerNote?: ReactNode;
  /** Classes for `<main>` (it is full-width and unpadded so sections can run edge to edge). */
  mainClassName?: string;
}

const DEFAULT_CTA = { href: "/sgo/signup", label: "Open a test workspace" };

function HeaderCta() {
  return (
    <Link href={DEFAULT_CTA.href} className="site-button site-button--sm" data-tone="dark">
      {DEFAULT_CTA.label}
      <span aria-hidden="true"> →</span>
    </Link>
  );
}

function SiteMark({ tone = "brand" }: { tone?: "brand" | "inverse" }) {
  return (
    <Link href="/" aria-label={`${BRAND.name} — home`} className="site-mark">
      <LogoMark size="sm" tone={tone} />
      <span className="site-mark__word">{BRAND.name}</span>
    </Link>
  );
}

/**
 * Public chrome in the editorial site style: a quiet sticky header with mono navigation and one call to
 * action, and a dark mono footer with the standing legal notes. Used by the home page and other public,
 * read-only pages; the page content inside `<main>` keeps the app design system.
 */
export function PublicShell({ children, nav = PUBLIC_NAV, actions, banner, footerNote, mainClassName }: PublicShellProps) {
  const headerActions = actions === undefined ? <HeaderCta /> : actions;
  return (
    <div data-surface="site" className="site-shell">
      {banner}
      <header className="site-header">
        <div className="site-wrap site-header__bar">
          <SiteMark />
          <nav aria-label="Main" className="site-nav">
            <ul>
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="site-nav__link">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="site-header__actions">
            {headerActions ? <div className="site-header__cta">{headerActions}</div> : null}
            <details className="site-menu">
              <summary aria-label="Menu" className="site-menu__toggle">
                <span aria-hidden="true" className="site-menu__icon" />
              </summary>
              <nav aria-label="Main" className="site-menu__panel">
                <ul>
                  {nav.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="site-menu__link">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                  {headerActions ? <li className="site-menu__cta">{headerActions}</li> : null}
                </ul>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={cn("site-main", mainClassName)}>
        {children}
      </main>

      <footer className="site-footer" data-surface="site-dark">
        <div className="site-wrap">
          <div className="site-footer__top">
            <SiteMark tone="inverse" />
            <nav aria-label="Footer">
              <ul className="site-footer__links">
                {PUBLIC_NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
                <li>
                  <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
                </li>
              </ul>
            </nav>
          </div>
          <div className="site-footer__notes">
            {footerNote}
            <p>Not tax or legal advice. Built to proposed rules that are not final.</p>
            <p>Income limits are provisional until the IRS publishes its own.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
