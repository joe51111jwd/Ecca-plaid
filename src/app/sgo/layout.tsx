import type { Metadata } from "next";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out/actions";
import { SgoShell } from "@/features/sgo/components/SgoShell";
import { roleLabel } from "@/features/sgo/labels";
import { optionalSgoContext } from "@/features/sgo/server/context";
import { loadShellCounts } from "@/features/sgo/server/queries";
import { setModeAction } from "./_actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { template: "%s · Scholarship organization", default: "Scholarship organization" },
  robots: { index: false, follow: false },
};

/**
 * The SGO dashboard frame. Each page calls requireSgoPage itself (a layout is not re-run on every navigation, and only
 * the page knows its own path to come back to after sign-in). Signed-out visitors and people without an SGO get no
 * frame here: the page redirects them, and the signup page renders its own.
 */
export default async function SgoLayout({ children }: { children: ReactNode }) {
  const ctx = await optionalSgoContext();
  if (!ctx) return children;
  const counts = await loadShellCounts(ctx.actor);
  return (
    <SgoShell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      org={{ id: ctx.org.id, name: ctx.profile.displayName || ctx.org.name, logoUrl: ctx.profile.logoUrl }}
      orgs={ctx.orgs.map((o) => ({ id: o.org.id, name: o.org.name, logoUrl: null }))}
      roleLabel={roleLabel(ctx.role)}
      mode={ctx.mode}
      liveAvailable={ctx.liveAvailable}
      counts={counts}
      setModeAction={setModeAction}
      signOutAction={signOutAction}
    >
      {children}
    </SgoShell>
  );
}
