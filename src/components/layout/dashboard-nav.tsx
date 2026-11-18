"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Drawer } from "@/components/ui/dialog";

export interface DashboardNavItem {
  href: string;
  label: string;
  /** A lucide icon ELEMENT (`<Inbox />`), not the component — it crosses the server/client boundary. */
  icon?: ReactNode;
  /** A count shown at the end (open review tasks). */
  count?: number;
  /** `exact` for an index page like "/sgo" that must not stay lit on its children. Default `prefix`. */
  match?: "exact" | "prefix";
}

export interface DashboardNavSection {
  /** Small heading above the group. Omit for the first, unlabeled group. */
  title?: string;
  items: DashboardNavItem[];
}

function isMatch(item: DashboardNavItem, pathname: string): boolean {
  const path = item.href.split(/[?#]/)[0] || "/";
  if (item.match === "exact") return pathname === path;
  return pathname === path || pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
}

/** The longest matching href is the current page, so a parent and its child are never both lit. */
function currentHref(sections: DashboardNavSection[], pathname: string): string | null {
  let best: DashboardNavItem | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (isMatch(item, pathname) && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best?.href ?? null;
}

/** The sidebar's link list. Marks the current page from the URL. */
export function DashboardNav({ sections, label = "Sections", onNavigate }: { sections: DashboardNavSection[]; label?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = currentHref(sections, pathname);
  return (
    <nav aria-label={label} className="flex flex-col gap-5">
      {sections.map((section, index) => (
        <div key={section.title ?? index}>
          {section.title ? <p className="mb-1.5 px-3 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{section.title}</p> : null}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center gap-2.5 rounded-control px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                      active ? "bg-brand-surface text-brand-fg" : "text-fg-muted hover:bg-sunken hover:text-fg",
                    )}
                  >
                    {item.icon ? (
                      <span aria-hidden="true" className={cn("inline-flex shrink-0 [&>svg]:size-4", active ? "text-brand-700" : "text-fg-subtle")}>
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count !== undefined && item.count > 0 ? (
                      <span className={cn("rounded-full px-1.5 text-xs leading-5 nums", active ? "bg-action text-action-fg" : "bg-sunken text-fg-muted")}>{item.count}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Phone and tablet: the sidebar lives in a drawer behind a menu button. */
export function DashboardMobileNav({ sections, title, header, footer }: { sections: DashboardNavSection[]; title: string; header?: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <IconButton label="Open menu" icon={<Menu />} onClick={() => setOpen(true)} aria-haspopup="dialog" />
      <Drawer open={open} onClose={() => setOpen(false)} side="left" size="sm" title={title}>
        <div className="flex flex-col gap-5">
          {header}
          <DashboardNav sections={sections} onNavigate={() => setOpen(false)} />
          {footer ? <div className="border-t border-line pt-4">{footer}</div> : null}
        </div>
      </Drawer>
    </div>
  );
}
