import { Menu } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { MAIN_CONTENT_ID } from "./skip-link";

export interface PublicNavItem {
  href: string;
  label: string;
}

/** The public entry points, in the order the landing page presents them. */
export const PUBLIC_NAV: PublicNavItem[] = [
  { href: "/give", label: "Give" },
  { href: "/family", label: "Families" },
  { href: "/sgo", label: "Scholarship organizations" },
  { href: "/partner", label: "Camps and schools" },
  { href: "/docs", label: "Developers" },
];

export interface PublicShellProps {
  children: ReactNode;
  /** Header links. Defaults to PUBLIC_NAV. */
  nav?: PublicNavItem[];
  /** Buttons at the end of the header (a sign-in link, a primary call to action). */
  actions?: ReactNode;
  /** A `<Banner>` above the header. */
  banner?: ReactNode;
  /** Extra legal text for the footer, shown above the standing notes. */
  footerNote?: ReactNode;
  /** Classes for `<main>` (it is full-width and unpadded so marketing sections can run edge to edge). */
  mainClassName?: string;
}

const FOOTER_GROUPS: Array<{ title: string; links: PublicNavItem[] }> = [
  {
    title: "Give",
    links: [{ href: "/give", label: "Give to a scholarship organization" }],
  },
  {
    title: "Families",
    links: [{ href: "/family", label: "Apply or check your application" }],
  },
  {
    title: "Organizations",
    links: [
      { href: "/sgo", label: "Scholarship organizations" },
      { href: "/partner", label: "Camps and schools" },
    ],
  },
  {
    title: "Developers",
    links: [{ href: "/docs", label: "API reference" }],
  },
];

/**
 * Marketing chrome: sticky header with the public navigation and a footer with the standing legal notes.
 * For the landing page and other public, read-only pages. The mobile menu is a native `<details>`.
 */
export function PublicShell({ children, nav = PUBLIC_NAV, actions, banner, footerNote, mainClassName }: PublicShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {banner}
      <header className="sticky top-0 z-nav border-b border-line bg-surface/95 backdrop-blur-sm supports-[not(backdrop-filter:blur(0))]:bg-surface">
        <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <Logo href="/" />
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-flex h-10 items-center rounded-control px-3 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken hover:text-fg">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            {actions}
            <details className="group/menu relative lg:hidden">
              <summary aria-label="Menu" className="inline-flex size-11 items-center justify-center rounded-control text-fg hover:bg-sunken">
                <Menu aria-hidden="true" className="size-5" />
              </summary>
              <nav aria-label="Main" className="absolute top-full right-0 z-nav mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 shadow-lg">
                <ul>
                  {nav.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="flex min-h-11 items-center rounded-control px-3 text-base font-medium text-fg hover:bg-sunken">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={cn("flex-1 outline-none", mainClassName)}>
        {children}
      </main>

      <footer data-surface="inverse" className="bg-brand-950">
        <div className="mx-auto max-w-page px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
            <div>
              <Logo tone="inverse" />
              <p className="mt-4 max-w-sm text-sm text-fg-muted">{BRAND.tagline}</p>
              <p className="mt-4 text-sm text-fg-muted">
                Questions:{" "}
                <a href={`mailto:${BRAND.supportEmail}`} className="rounded-sm text-link underline decoration-1 underline-offset-[3px] hover:text-link-hover">
                  {BRAND.supportEmail}
                </a>
              </p>
            </div>
            <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
              {FOOTER_GROUPS.map((group) => (
                <div key={group.title}>
                  <h2 className="text-sm font-semibold text-fg">{group.title}</h2>
                  <ul className="mt-3 space-y-2">
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className="inline-flex min-h-6 items-center rounded-sm text-sm text-fg-muted hover:text-fg hover:underline">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
          <div className="mt-10 space-y-2 border-t border-line pt-6 text-xs leading-5 text-fg-subtle">
            {footerNote}
            <p>
              Information on this site is general and is not legal or tax advice. The federal scholarship tax credit rules described here include proposed regulations that are not final and may change.
            </p>
            <p>Income limits shown by {BRAND.name} are provisional until the IRS publishes its own limits, and are labeled that way wherever they appear.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
