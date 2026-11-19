import { BookOpen, LifeBuoy } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardShell, OrgSwitcher, UserMenu } from "@/components/layout";
import { Banner, TextLink } from "@/components/ui";
import type { Mode } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { SGO_PATHS, sgoNav } from "../nav";
import { ModeSwitch } from "./ModeSwitch";

export interface SgoShellProps {
  user: { name: string | null; email: string };
  org: { id: string; name: string; logoUrl: string | null };
  orgs: Array<{ id: string; name: string; logoUrl: string | null }>;
  roleLabel: string;
  mode: Mode;
  liveAvailable: boolean;
  counts: { reviewCount: number; partnerRequests: number };
  setModeAction: (formData: FormData) => void | Promise<void>;
  signOutAction: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
}

const TYPE_LABEL = "Scholarship organization";

/** The SGO dashboard frame: sidebar, org switcher, the test/live switch, the account menu and the sandbox banner. */
export function SgoShell({ user, org, orgs, roleLabel, mode, liveAvailable, counts, setModeAction, signOutAction, children }: SgoShellProps) {
  const entry = (o: { id: string; name: string; logoUrl: string | null }) => ({ id: o.id, name: o.name, logoUrl: o.logoUrl, href: `/sgo/switch/${encodeURIComponent(o.id)}`, typeLabel: TYPE_LABEL });
  return (
    <DashboardShell
      appLabel={TYPE_LABEL}
      homeHref={SGO_PATHS.home}
      nav={sgoNav(counts)}
      mode={mode}
      modeControl={<ModeSwitch mode={mode} liveAvailable={liveAvailable} action={setModeAction} />}
      orgSwitcher={<OrgSwitcher current={entry(org)} orgs={orgs.map(entry)} />}
      userMenu={
        <UserMenu
          name={user.name?.trim() || user.email}
          email={`${user.email} · ${roleLabel}`}
          items={[{ label: "Team", href: SGO_PATHS.team }, { label: "Settings", href: SGO_PATHS.settings }]}
          signOutAction={signOutAction}
        />
      }
      banner={
        mode === "test" ? (
          <Banner tone="sandbox" className="py-1! text-xs!">
            <strong className="font-semibold">Test mode</strong> · sandbox verifications, gifts and donor numbers. Nothing here is valid for filing.
          </Banner>
        ) : null
      }
      sidebarFooter={
        <ul className="space-y-1">
          <li>
            <TextLink href="/docs" tone="quiet" standalone>
              <BookOpen aria-hidden="true" className="size-4" /> API documentation
            </TextLink>
          </li>
          <li>
            <TextLink href={`mailto:${BRAND.supportEmail}`} tone="quiet" standalone>
              <LifeBuoy aria-hidden="true" className="size-4" /> Contact support
            </TextLink>
          </li>
        </ul>
      }
    >
      {children}
    </DashboardShell>
  );
}
