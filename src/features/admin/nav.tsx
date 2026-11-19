import { Building2, FileClock, Gauge, HandCoins, Landmark, ListChecks, Mail, ServerCog, ShieldOff, SlidersHorizontal } from "lucide-react";
import type { DashboardNavSection } from "@/components/layout";

export const ADMIN_HOME = "/admin";

export interface AdminNavCounts {
  /** Failed jobs waiting for an operator. */
  deadJobs?: number;
}

/** The admin console sidebar. Every page under /admin renders inside it. */
export function adminNav(counts: AdminNavCounts = {}): DashboardNavSection[] {
  return [
    {
      items: [
        { href: ADMIN_HOME, label: "Overview", icon: <Gauge />, match: "exact" },
        { href: "/admin/gates", label: "Gates & fees", icon: <SlidersHorizontal /> },
      ],
    },
    {
      title: "Organizations",
      items: [
        { href: "/admin/sgo-list", label: "SGO list", icon: <ListChecks /> },
        { href: "/admin/organizations", label: "Organizations", icon: <Building2 /> },
        { href: "/admin/income-limits", label: "Income limits", icon: <Landmark /> },
      ],
    },
    {
      title: "Operations",
      items: [
        { href: "/admin/jobs", label: "Jobs", icon: <ServerCog />, ...(counts.deadJobs ? { count: counts.deadJobs } : {}) },
        { href: "/admin/audit", label: "Audit log", icon: <FileClock /> },
        { href: "/admin/email", label: "Email outbox", icon: <Mail /> },
      ],
    },
    {
      title: "Requests",
      items: [
        { href: "/admin/privacy", label: "Privacy requests", icon: <ShieldOff /> },
        { href: "/admin/refunds", label: "Refunds", icon: <HandCoins /> },
      ],
    },
  ];
}
