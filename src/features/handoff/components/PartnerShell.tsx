import { CreditCard, Gauge, PlugZap, Settings, Ticket } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DashboardShell, OrgSwitcher, UserMenu, type DashboardNavSection } from "@/components/layout";
import { Banner, StatusBadge } from "@/components/ui";
import type { Mode } from "@/db/schema";
import { vendorTypeLabel, type BusinessProfile } from "@/server/businesses";
import { PORTAL_HOME } from "../policy";

export interface PartnerShellProps {
  org: { id: string; name: string };
  profile: Pick<BusinessProfile, "displayName" | "logoUrl" | "vendorType">;
  user: { name: string | null; email: string };
  orgs: Array<{ id: string; name: string; href: string }>;
  mode: Mode;
  /** Links that switch the data on screen between test and live. */
  modeHrefs: Record<Mode, string>;
  href: (path: string) => string;
  signOutAction: (formData: FormData) => void | Promise<void>;
  width?: "default" | "narrow" | "full";
  children: ReactNode;
}

export function partnerNav(href: (path: string) => string): DashboardNavSection[] {
  return [
    {
      items: [
        { href: href(PORTAL_HOME), label: "Home", icon: <Gauge />, match: "exact" },
        { href: href(`${PORTAL_HOME}/handoffs`), label: "Handoffs", icon: <Ticket /> },
        { href: href(`${PORTAL_HOME}/billing`), label: "Billing", icon: <CreditCard /> },
      ],
    },
    {
      title: "Set up",
      items: [
        { href: href(`${PORTAL_HOME}/install`), label: "Install", icon: <PlugZap /> },
        { href: href(`${PORTAL_HOME}/settings`), label: "Settings", icon: <Settings /> },
      ],
    },
  ];
}

/** The business portal frame: DashboardShell with the portal sections, the org switcher, the account menu and the test/live switch. */
export function PartnerShell({ org, profile, user, orgs, mode, modeHrefs, href, signOutAction, width, children }: PartnerShellProps) {
  const other: Mode = mode === "test" ? "live" : "test";
  return (
    <DashboardShell
      appLabel="Camp or school"
      homeHref={href(PORTAL_HOME)}
      nav={partnerNav(href)}
      width={width}
      mode={mode}
      modeControl={
        <span className="flex items-center gap-2">
          <StatusBadge kind="mode" status={mode} />
          <Link href={modeHrefs[other]} className="text-sm text-link underline decoration-1 underline-offset-4 hover:text-link-hover">
            View {other} data
          </Link>
        </span>
      }
      banner={mode === "test" ? <Banner tone="sandbox">Test mode: these handoffs, fees and invoices are sandbox data. No money moves.</Banner> : undefined}
      orgSwitcher={
        <OrgSwitcher
          current={{ id: org.id, name: profile.displayName, href: href(PORTAL_HOME), logoUrl: profile.logoUrl, typeLabel: vendorTypeLabel(profile.vendorType) }}
          orgs={orgs.map((o) => ({ id: o.id, name: o.name, href: o.href, typeLabel: "Camp or school" }))}
        />
      }
      userMenu={<UserMenu name={user.name?.trim() || user.email} email={user.email} signOutAction={signOutAction} />}
    >
      {children}
    </DashboardShell>
  );
}
