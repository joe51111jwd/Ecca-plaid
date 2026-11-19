import type { ReactNode } from "react";
import { DashboardShell, UserMenu } from "@/components/layout";
import { Badge } from "@/components/ui";
import { adminNav, ADMIN_HOME, type AdminNavCounts } from "../nav";

export interface AdminShellProps {
  user: { name: string | null; email: string };
  /** Deployment environment, shown in the top bar so a production console is never mistaken for a sandbox. */
  environment: "production" | "development" | "test";
  counts?: AdminNavCounts;
  width?: "default" | "narrow" | "full";
  /** Server action that ends the session (src/app/sign-out/actions). */
  signOutAction: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
}

/** The platform admin console frame: DashboardShell with the admin sections, the account menu and the environment. */
export function AdminShell({ user, environment, counts, width, signOutAction, children }: AdminShellProps) {
  return (
    <DashboardShell
      appLabel="Platform admin"
      homeHref={ADMIN_HOME}
      nav={adminNav(counts)}
      width={width}
      topBar={
        <Badge tone={environment === "production" ? "danger" : "caution"} size="sm">
          {environment === "production" ? "Production: changes affect real people and money" : `${environment === "test" ? "Test" : "Development"} environment`}
        </Badge>
      }
      userMenu={<UserMenu name={user.name?.trim() || user.email} email={user.email} signOutAction={signOutAction} />}
    >
      {children}
    </DashboardShell>
  );
}
