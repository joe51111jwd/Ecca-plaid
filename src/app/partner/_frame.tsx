import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out/actions";
import { PartnerShell } from "@/features/handoff/components/PartnerShell";
import { portalHref } from "@/features/handoff/portal";
import type { PortalContext } from "@/features/handoff/server/context";

/** Wraps a portal page in the PartnerShell for the context `requirePortalPage` returned. */
export function PortalFrame({ ctx, path, width, children }: { ctx: PortalContext; path: string; width?: "default" | "narrow" | "full"; children: ReactNode }) {
  const modeHref = (mode: "test" | "live") => portalHref(path, { orgId: ctx.org.id, mode, defaultOrgId: ctx.orgs[0]?.id ?? ctx.org.id, defaultMode: ctx.defaultMode });
  return (
    <PartnerShell
      org={{ id: ctx.org.id, name: ctx.org.name }}
      profile={ctx.profile}
      user={{ name: ctx.user.name, email: ctx.user.email }}
      orgs={ctx.orgs}
      mode={ctx.mode}
      modeHrefs={{ test: modeHref("test"), live: modeHref("live") }}
      href={ctx.href}
      signOutAction={signOutAction}
      width={width}
    >
      {children}
    </PartnerShell>
  );
}
