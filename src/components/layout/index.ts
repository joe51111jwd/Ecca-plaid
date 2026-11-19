/** App shells. Import from "@/components/layout". Each shell renders the page's single <main id="main-content">. */
export { PUBLIC_NAV, PublicShell, type PublicNavItem, type PublicShellProps } from "./public-shell";
export { FocusShell, type FocusShellPartner, type FocusShellProps } from "./focus-shell";
export { DashboardShell, OrgSwitcher, UserMenu, type DashboardShellProps, type OrgSwitcherOrg, type OrgSwitcherProps, type UserMenuProps } from "./dashboard-shell";
export { DashboardNav, type DashboardNavItem, type DashboardNavSection } from "./dashboard-nav";
export { EmbedShell, type EmbedShellProps } from "./embed-shell";
export { EMBED_MESSAGE_SOURCE, useEmbedAutoHeight, type EmbedAutoHeightOptions, type EmbedResizeMessage } from "./embed-frame";
export { SystemPage, type SystemPageProps } from "./system-page";
export { MAIN_CONTENT_ID, SkipLink } from "./skip-link";
export { HtmlLang } from "./html-lang";
export { orgInitials, orgMarkName } from "./org-mark-name";
