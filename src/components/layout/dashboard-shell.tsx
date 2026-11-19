import { Check, ChevronsUpDown, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, OrgMark } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { Logo } from "@/components/ui/logo";
import { DropdownMenu, type MenuItem } from "@/components/ui/menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { DashboardMobileNav, DashboardNav, type DashboardNavSection } from "./dashboard-nav";
import { orgMarkName } from "./org-mark-name";
import { MAIN_CONTENT_ID } from "./skip-link";

const CONTENT_WIDTH = { default: "max-w-page", narrow: "max-w-3xl", full: "max-w-none" } as const;

export interface DashboardShellProps {
  children: ReactNode;
  /** The sidebar, as data, so the SGO, business and admin apps each configure the same shell. */
  nav: DashboardNavSection[];
  /** Which app this is, shown under the logo: "Scholarship organization", "Camp or school", "Platform admin". */
  appLabel: string;
  /** Where the logo links. Default "/". */
  homeHref?: string;
  /** Slot at the top of the sidebar — an `<OrgSwitcher>`. */
  orgSwitcher?: ReactNode;
  /** Slot at the end of the top bar — a `<UserMenu>`. */
  userMenu?: ReactNode;
  /** Whether the data on screen is sandbox or real. Always pass it on pages that show tenant data. */
  mode?: "test" | "live";
  /** Replaces the mode badge with your own control (a test/live switch). */
  modeControl?: ReactNode;
  /** Slot at the start of the top bar: search, breadcrumbs. */
  topBar?: ReactNode;
  /** A `<Banner>` above everything. */
  banner?: ReactNode;
  /** Slot at the bottom of the sidebar: docs and help links. */
  sidebarFooter?: ReactNode;
  /** Content column width. `narrow` for settings forms, `full` for very wide tables. */
  width?: keyof typeof CONTENT_WIDTH;
}

/**
 * The staff shell: fixed sidebar and top bar on desktop, a menu drawer on phones.
 * Dense by default. In test mode a hatched rule runs under the top bar so sandbox data is never mistaken for real.
 */
export function DashboardShell({ children, nav, appLabel, homeHref = "/", orgSwitcher, userMenu, mode, modeControl, topBar, banner, sidebarFooter, width = "default" }: DashboardShellProps) {
  const brand = (
    <div className="flex flex-col gap-1">
      <Logo href={homeHref} size="sm" />
      <p className="text-xs font-medium text-fg-muted">{appLabel}</p>
    </div>
  );
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {banner}
      <div className="flex-1 lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-surface lg:block">
          <div className="sticky top-0 flex h-dvh flex-col gap-5 overflow-y-auto px-3 py-4">
            <div className="px-3">{brand}</div>
            {orgSwitcher ? <div>{orgSwitcher}</div> : null}
            <div className="flex-1">
              <DashboardNav sections={nav} label={`${appLabel} sections`} />
            </div>
            {sidebarFooter ? <div className="border-t border-line px-3 pt-4 text-sm text-fg-muted">{sidebarFooter}</div> : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-sticky border-b border-line bg-surface">
            <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
              <DashboardMobileNav sections={nav} title={appLabel} header={orgSwitcher} footer={sidebarFooter} />
              <div className="lg:hidden">
                <Logo href={homeHref} size="sm" variant="mark" />
              </div>
              <div className="min-w-0 flex-1">{topBar}</div>
              {modeControl ?? (mode ? <StatusBadge kind="mode" status={mode} /> : null)}
              {userMenu}
            </div>
            {mode === "test" ? <div aria-hidden="true" className="hatch h-1.5 border-t border-dashed border-caution-line bg-caution-surface" /> : null}
          </header>
          <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
            <div className={cn("mx-auto w-full", CONTENT_WIDTH[width])}>{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

export interface UserMenuProps {
  name: string;
  email: string;
  /** Extra links above "Sign out" (profile, organization settings). */
  items?: MenuItem[];
  /** Server action that ends the session. */
  signOutAction?: (formData: FormData) => void | Promise<void>;
  signOutLabel?: string;
}

/** The account menu for the top bar: who is signed in, their links, sign out. */
export function UserMenu({ name, email, items = [], signOutAction, signOutLabel = "Sign out" }: UserMenuProps) {
  const all: MenuItem[] = [...items, ...(signOutAction ? [{ label: signOutLabel, action: signOutAction, icon: <LogOut />, separated: items.length > 0 }] : [])];
  return (
    <DropdownMenu
      label={`Account menu for ${name}`}
      triggerStyle="plain"
      trigger={
        <>
          <Avatar name={name} size="sm" />
          <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        </>
      }
      header={
        <>
          <p className="truncate font-semibold text-fg">{name}</p>
          <p className="truncate text-fg-muted">{email}</p>
        </>
      }
      items={all}
    />
  );
}

export interface OrgSwitcherOrg {
  id: string;
  name: string;
  /** Where choosing this organization goes (its dashboard home). */
  href: string;
  logoUrl?: string | null;
  /** "Scholarship organization", "Camp or school". */
  typeLabel?: string;
}

export interface OrgSwitcherProps {
  current: OrgSwitcherOrg;
  /** Every organization the person belongs to, including the current one. With one entry it is a plain label. */
  orgs: OrgSwitcherOrg[];
}

/** Shows which organization's data is on screen and switches between the person's organizations. */
export function OrgSwitcher({ current, orgs }: OrgSwitcherProps) {
  const face = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
      <OrgMark name={orgMarkName(current.name)} logoUrl={current.logoUrl} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-fg">{current.name}</span>
        {current.typeLabel ? <span className="block truncate text-xs font-normal text-fg-muted">{current.typeLabel}</span> : null}
      </span>
    </span>
  );
  if (orgs.length <= 1) return <div className="flex items-center rounded-control border border-line px-3 py-2">{face}</div>;
  return (
    <DropdownMenu
      label={`Switch organization. Current: ${current.name}`}
      align="start"
      triggerStyle="field"
      trigger={
        <>
          {face}
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        </>
      }
      items={orgs.map((org) => ({
        label: org.name,
        description: org.typeLabel,
        href: org.href,
        icon: org.id === current.id ? <Check /> : <span className="block size-4" />,
      }))}
    />
  );
}
