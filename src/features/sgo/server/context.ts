import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { MemberRole, Mode } from "@/db/schema";
import { forbidden, isAppError, unauthenticated } from "@/lib/errors";
import { assertOrgMember, getCurrentUser, getPrimaryOrg, getRequestInfo, requireUser, roleAtLeast, type Membership, type Organization, type User } from "@/server/auth";
import { getSgoProfile, type SgoProfile } from "@/server/sgos";
import { REVIEW_ACCESS } from "@/server/verifications";
import { DEFAULT_MODE, LIVE_MODE_REQUIRES_VERIFIED_LISTING, SGO_MODE_COOKIE, SGO_ORG_COOKIE, VIEW_ROLE } from "../policy";
import type { SgoActor } from "../types";

/**
 * Access to the SGO dashboard. Every page under /sgo calls `requireSgoPage` first and every server action goes
 * through `requireSgoActor` (via ./run-action). Both resolve the organization from the person's own memberships
 * (an org-switcher cookie only chooses among them) and check the membership with `assertOrgMember`; the orgId that
 * reaches a service never comes from the URL or a form.
 */

export interface SgoContext {
  user: User;
  org: Organization;
  profile: SgoProfile;
  membership: Membership;
  role: MemberRole;
  mode: Mode;
  /** Live mode can be switched on for this organization (see LIVE_MODE_REQUIRES_VERIFIED_LISTING). */
  liveAvailable: boolean;
  /** Every SGO the person belongs to, for the org switcher. */
  orgs: Array<{ org: Organization; membership: Membership }>;
  actor: SgoActor;
}

export function parseMode(raw: string | undefined | null): Mode | null {
  return raw === "test" || raw === "live" ? raw : null;
}

/** Whether live mode may be shown for this profile. */
export function liveModeAvailable(profile: Pick<SgoProfile, "listEntryId">): boolean {
  return !LIVE_MODE_REQUIRES_VERIFIED_LISTING || profile.listEntryId !== null;
}

/**
 * Whether a member with `role` may open a family's raw uploads. The verifications service refuses anyone below
 * REVIEW_ACCESS.viewDocument, so the dashboard offers the viewer only to them instead of a link that answers 404.
 */
export function canOpenUploads(role: MemberRole): boolean {
  return roleAtLeast(role, REVIEW_ACCESS.viewDocument);
}

/** The mode on screen: the cookie's choice when live is available, otherwise test. */
export function effectiveMode(requested: Mode | null, liveAvailable: boolean): Mode {
  const mode = requested ?? DEFAULT_MODE;
  return mode === "live" && !liveAvailable ? "test" : mode;
}

/**
 * Resolves the dashboard context for a known user. Null when the user belongs to no SGO. Exported for tests and for
 * the two request-bound wrappers below.
 */
export async function resolveSgoContext(user: User, prefs: { orgId: string | null; mode: Mode | null }, request: SgoActor["request"]): Promise<SgoContext | null> {
  let primary;
  try {
    primary = await getPrimaryOrg(user, "sgo", { orgId: prefs.orgId });
  } catch (e) {
    // A stale org cookie (membership removed): fall back to the person's first SGO instead of locking them out.
    if (isAppError(e) && e.code === "forbidden") primary = await getPrimaryOrg(user, "sgo");
    else throw e;
  }
  if (!primary) return null;
  const access = await assertOrgMember(user, primary.org.id, VIEW_ROLE);
  const { profile } = await getSgoProfile(access.org.id);
  const liveAvailable = liveModeAvailable(profile);
  const mode = effectiveMode(prefs.mode, liveAvailable);
  return {
    user,
    org: access.org,
    profile,
    membership: access.membership,
    role: access.membership.role,
    mode,
    liveAvailable,
    orgs: primary.options,
    actor: { userId: user.id, orgId: access.org.id, role: access.membership.role, mode, request },
  };
}

async function readPrefs(): Promise<{ orgId: string | null; mode: Mode | null }> {
  const jar = await cookies();
  const orgId = jar.get(SGO_ORG_COOKIE)?.value ?? null;
  return { orgId: orgId && /^[A-Za-z0-9_-]{1,128}$/.test(orgId) ? orgId : null, mode: parseMode(jar.get(SGO_MODE_COOKIE)?.value) };
}

async function requestOf(): Promise<SgoActor["request"]> {
  const info = await getRequestInfo();
  return { ip: info.ip ?? null, userAgent: info.userAgent ?? null };
}

/**
 * For pages: signed-out visitors go to sign in (and come back to `returnTo`); a person with no SGO goes to the
 * self-serve signup; a role below `minRole` gets the ordinary 404 (the page is not advertised to them).
 */
export async function requireSgoPage(returnTo: string, minRole: MemberRole = VIEW_ROLE): Promise<SgoContext> {
  const user = await requireUser({ returnTo });
  const ctx = await resolveSgoContext(user, await readPrefs(), await requestOf());
  if (!ctx) redirect("/sgo/signup");
  if (!roleAtLeast(ctx.role, minRole)) notFound();
  return ctx;
}

/** For the layout: the context when there is one, null otherwise (signed out, or no SGO yet). Never redirects. */
export async function optionalSgoContext(): Promise<SgoContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return resolveSgoContext(user, await readPrefs(), await requestOf());
}

/** For server actions and route handlers: the acting staff member with at least `minRole`. Throws AppError. */
export async function requireSgoActor(minRole: MemberRole = VIEW_ROLE): Promise<SgoContext> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  const ctx = await resolveSgoContext(user, await readPrefs(), await requestOf());
  if (!ctx) throw forbidden("You are not a member of a scholarship organization.");
  if (!roleAtLeast(ctx.role, minRole)) throw forbidden("Your role in this organization does not allow this");
  return ctx;
}

/** The signed-in user for the signup flow (no SGO needed yet). */
export async function requireSignupUser(): Promise<{ user: User; request: SgoActor["request"] }> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return { user, request: await requestOf() };
}
