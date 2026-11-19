"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export interface DocsNavItem {
  href: string;
  label: string;
}

export interface DocsNavGroup {
  title: string;
  items: DocsNavItem[];
}

/** Sidebar navigation of the developer docs. The current page is marked for sighted and screen-reader users alike. */
export function DocsNav({ groups }: { groups: DocsNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Developer documentation" className="text-sm">
      <ul className="space-y-6">
        {groups.map((group) => (
          <li key={group.title}>
            <p className="mb-2 font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-fg-muted uppercase">{group.title}</p>
            <ul className="space-y-0.5 border-l border-line">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "-ml-px block border-l-2 py-1.5 pl-4 transition-colors",
                        active ? "border-brand-600 font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
