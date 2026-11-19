/**
 * Access to the business portal (/partner). Every portal page calls `requirePortalPage` first: it requires a signed-in
 * member of an organization of type "business" (requireUser → getPrimaryOrg → the membership), resolves which of the
 * person's businesses and which mode is on screen, and loads the business profile. Services re-check authority on
 * every change; this is the page-level gate.
 */
import { notFound, redirect } from "next/navigation";
import type { MemberRole, Mode } from "@/db/schema";
import { isAppError } from "@/lib/errors";
import { getBusinessProfile, publishableKeyMode, type BusinessProfile } from "@/server/businesses";
import { getPrimaryOrg, requireUser, roleAtLeast, type Membership, type Organization, type User } from "@/server/auth";
import { pickMode, portalHref } from "../portal";
import { PORTAL_HOME } from "../policy";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface PortalContext {
  user: User;
  org: Organization;
  membership: Membership;
  profile: BusinessProfile;
  mode: Mode;
  defaultMode: Mode;
  /** Every business the person belongs to, for the org switcher. */
  orgs: Array<{ id: string; name: string; href: string }>;
  /** A portal path with this page's organization and mode carried along. */
  href: (path: string, extra?: Record<string, string | undefined>) => string;
  /** Whether the person's role is at least `role` in this business. */
  can: (role: MemberRole) => boolean;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * For portal pages. Signed out → sign in (and back to `returnTo`). No business yet → /partner/signup. Asking for a
 * business the person does not belong to → the ordinary 404, so other businesses' ids reveal nothing.
 */
export async function requirePortalPage(returnTo: string, searchParams: SearchParams): Promise<PortalContext> {
  const user = await requireUser({ returnTo });
  const requested = first(searchParams.org);
  let primary;
  try {
    primary = await getPrimaryOrg(user, "business", { orgId: requested && requested.length <= 128 ? requested : null });
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") notFound();
    throw e;
  }
  if (!primary) redirect(`${PORTAL_HOME}/signup`);
  const defaultOrgId = primary.options[0].org.id;
  const defaultMode = publishableKeyMode();
  const mode = pickMode(searchParams.mode, defaultMode);
  const { profile } = await getBusinessProfile(primary.org.id);
  const ctx = { orgId: primary.org.id, mode, defaultOrgId, defaultMode };
  return {
    user,
    org: primary.org,
    membership: primary.membership,
    profile,
    mode,
    defaultMode,
    orgs: primary.options.map((o) => ({ id: o.org.id, name: o.org.name, href: portalHref(PORTAL_HOME, { ...ctx, orgId: o.org.id }) })),
    href: (path, extra) => portalHref(path, ctx, extra),
    can: (role) => roleAtLeast(primary.membership.role, role),
  };
}
