"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem {
  href: string;
  label: ReactNode;
  /** A count shown after the label (items needing review). */
  count?: number;
  icon?: ReactNode;
  /** `exact`: active only on this path. `prefix` (default): active on this path and everything under it. */
  match?: "exact" | "prefix";
}

export interface TabsProps {
  items: TabItem[];
  /**
   * The href of the active tab. Pass it when tabs differ by query string (?status=needs_review);
   * leave it out for path-based tabs and the current pathname decides.
   */
  current?: string;
  /** Names the navigation for screen readers ("Verification sections"). */
  label: string;
  variant?: "underline" | "pills";
  /** Underline variant: draw the rule under the row. Turn off when the tabs sit on a bar that already has a bottom border. Default true. */
  divider?: boolean;
  className?: string;
}

function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

/** Longest matching tab wins, so "/sgo" does not light up while on "/sgo/settings". */
function activeHref(items: TabItem[], pathname: string): string | null {
  let best: TabItem | null = null;
  for (const item of items) {
    const path = pathOf(item.href);
    const matches = item.match === "exact" ? pathname === path : pathname === path || pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
    if (matches && (!best || path.length > pathOf(best.href).length)) best = item;
  }
  return best?.href ?? null;
}

/**
 * Tabs that are links: each tab is a URL, so the back button, sharing and server rendering all work.
 * Rendered as navigation (not an ARIA tablist) because each tab loads a page.
 */
export function Tabs({ items, current, label, variant = "underline", divider = true, className }: TabsProps) {
  const pathname = usePathname();
  const active = current ?? activeHref(items, pathname);
  return (
    <nav aria-label={label} className={cn("max-w-full overflow-x-auto", variant === "underline" && divider && "border-b border-line", className)}>
      <ul className={cn("flex min-w-max items-stretch", variant === "underline" ? "gap-6" : "gap-1")}>
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap transition-colors",
                  variant === "underline"
                    ? cn("min-h-11 border-b-2 px-0.5", divider && "-mb-px", isActive ? "border-action text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")
                    : cn("h-control-sm rounded-control px-3", isActive ? "bg-brand-surface text-brand-fg" : "text-fg-muted hover:bg-sunken hover:text-fg"),
                )}
              >
                {item.icon ? (
                  <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">
                    {item.icon}
                  </span>
                ) : null}
                {item.label}
                {item.count !== undefined ? (
                  <span className={cn("rounded-full px-1.5 text-xs leading-5 nums", isActive ? "bg-action text-action-fg" : "bg-sunken text-fg-muted")}>{item.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
