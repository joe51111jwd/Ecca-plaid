import { Code2, Eye, FileCheck, HandCoins, Handshake, Inbox, Landmark, LayoutDashboard, Settings, UsersRound } from "lucide-react";
import type { DashboardNavSection } from "@/components/layout";

/** Every page of the SGO dashboard, so links are written once. */
export const SGO_PATHS = {
  home: "/sgo",
  verifications: "/sgo/verifications",
  newVerification: "/sgo/verifications/new",
  verification: (id: string) => `/sgo/verifications/${encodeURIComponent(id)}`,
  review: "/sgo/review",
  donations: "/sgo/donations",
  acknowledgments: "/sgo/acknowledgments",
  irsReport: "/sgo/irs-report",
  developers: "/sgo/developers",
  settings: "/sgo/settings",
  team: "/sgo/settings/team",
  partners: "/sgo/settings/partners",
  signup: "/sgo/signup",
} as const;

/** The sidebar. `reviewCount` is the number of open review tasks in the mode on screen. */
export function sgoNav(counts: { reviewCount: number; partnerRequests: number }): DashboardNavSection[] {
  return [
    {
      items: [
        { href: SGO_PATHS.home, label: "Home", icon: <LayoutDashboard />, match: "exact" },
        { href: SGO_PATHS.verifications, label: "Verifications", icon: <Inbox /> },
        { href: SGO_PATHS.review, label: "Review queue", icon: <Eye />, count: counts.reviewCount },
      ],
    },
    {
      title: "Giving",
      items: [
        { href: SGO_PATHS.donations, label: "Donations", icon: <HandCoins /> },
        { href: SGO_PATHS.acknowledgments, label: "Acknowledgments", icon: <FileCheck /> },
        { href: SGO_PATHS.irsReport, label: "IRS report", icon: <Landmark /> },
      ],
    },
    {
      title: "Organization",
      items: [
        { href: SGO_PATHS.developers, label: "Developers", icon: <Code2 /> },
        { href: SGO_PATHS.settings, label: "Settings", icon: <Settings />, match: "exact" },
        { href: SGO_PATHS.team, label: "Team", icon: <UsersRound /> },
        { href: SGO_PATHS.partners, label: "Camps and schools", icon: <Handshake />, count: counts.partnerRequests },
      ],
    },
  ];
}
