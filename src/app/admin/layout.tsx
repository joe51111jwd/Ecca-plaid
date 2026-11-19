import type { Metadata } from "next";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out/actions";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { requireAdminPage } from "@/features/admin/server/guard";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/server/auth";
import { getJobStats } from "@/server/jobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { template: "%s · Platform admin", default: "Platform admin" },
  robots: { index: false, follow: false },
};

/**
 * The admin console frame. Each page calls requireAdminPage itself (a layout is not re-run on every navigation, and
 * only the page knows its own path to come back to after sign-in): a signed-out visitor gets no frame here and is
 * redirected by the page.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await getCurrentUser())) return children;
  const { user } = await requireAdminPage("/admin");
  const stats = await getJobStats();
  return (
    <AdminShell user={user} environment={env().NODE_ENV} counts={{ deadJobs: stats.byStatus.dead }} signOutAction={signOutAction}>
      {children}
    </AdminShell>
  );
}
