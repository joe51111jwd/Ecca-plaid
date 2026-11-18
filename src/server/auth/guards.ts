import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { MemberRole, OrgType } from "@/db/schema";
import { forbidden, notFound, unauthenticated } from "@/lib/errors";
import { getCurrentUser } from "./current";
import type { Membership, Organization } from "./platform";
import { sanitizeRedirect } from "./redirect";
import type { User } from "./session";

/**
 * Access checks. Every page, server action and route handler calls one first.
 *
 * Each `require*` guard reads the signed-in user from the request; each `assert*` twin takes the user
 * explicitly (for services, jobs and tests). Org guards answer "forbidden" both when the organization does not
 * exist and when the user is not in it, so organization ids cannot be probed.
 */

export type Household = typeof schema.households.$inferSelect;

export const ROLE_RANK: Record<MemberRole, number> = { owner: 4, admin: 3, reviewer: 2, viewer: 1 };
export const MEMBER_ROLES: readonly MemberRole[] = ["owner", "admin", "reviewer", "viewer"];

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** True when `role` is `min` or higher (owner > admin > reviewer > viewer). */
export function roleAtLeast(role: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * The minimum role a `roles` argument asks for: a single role means "this or higher"; a list means "any of
 * these or higher", i.e. its lowest-ranked entry. Undefined or empty means any member.
 */
export function minimumRole(roles?: MemberRole | readonly MemberRole[]): MemberRole {
  if (!roles || (Array.isArray(roles) && roles.length === 0)) return "viewer";
  const list: readonly MemberRole[] = Array.isArray(roles) ? roles : [roles as MemberRole];
  return list.reduce((min, r) => (ROLE_RANK[r] < ROLE_RANK[min] ? r : min), list[0]);
}

export interface OrgAccess {
  user: User;
  org: Organization;
  membership: Membership;
}

/* ------------------------------------------------------------------------------------------- users */

/**
 * For pages: the signed-in user, or a redirect to /sign-in. Pass the page's own path (with query) as
 * `returnTo` so the person comes back to it; unsafe values are dropped.
 */
export async function requireUser(opts: { returnTo?: string | null } = {}): Promise<User> {
  const user = await getCurrentUser();
  if (user) return user;
  const next = opts.returnTo ? sanitizeRedirect(opts.returnTo) : null;
  redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
}

/** For route handlers and server actions: the signed-in user, or AppError `unauthenticated`. */
export async function requireUserOrThrow(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}

/* ------------------------------------------------------------------------------------- memberships */

export async function getMemberships(userId: string, dbOrTx?: DbOrTx): Promise<Array<{ membership: Membership; org: Organization }>> {
  const db = dbOrTx ?? (await getDb());
  return db
    .select({ membership: schema.memberships, org: schema.organizations })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id));
}

export async function assertOrgMember(user: User, orgId: string, roles?: MemberRole | readonly MemberRole[], dbOrTx?: DbOrTx): Promise<OrgAccess> {
  if (typeof orgId !== "string" || orgId.length === 0) throw forbidden();
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .select({ membership: schema.memberships, org: schema.organizations })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, user.id)))
    .limit(1);
  if (!row) throw forbidden();
  if (!roleAtLeast(row.membership.role, minimumRole(roles))) throw forbidden("Your role in this organization does not allow this");
  return { user, org: row.org, membership: row.membership };
}

/** The signed-in user's access to `orgId` with at least the given role(s). Throws unauthenticated / forbidden. */
export async function requireOrgMember(orgId: string, roles?: MemberRole | readonly MemberRole[], dbOrTx?: DbOrTx): Promise<OrgAccess> {
  const user = await requireUserOrThrow();
  return assertOrgMember(user, orgId, roles, dbOrTx);
}

/** The organization, if it is of the given type; `not_found` otherwise (also for a missing organization). */
export async function requireOrgType(orgId: string, type: OrgType, dbOrTx?: DbOrTx): Promise<Organization> {
  const db = dbOrTx ?? (await getDb());
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org || org.type !== type) throw notFound("Organization");
  return org;
}

export async function assertPlatformAdmin(user: User, dbOrTx?: DbOrTx): Promise<OrgAccess> {
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .select({ membership: schema.memberships, org: schema.organizations })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.organizations.type, "platform")))
    .limit(1);
  if (!row) throw forbidden();
  return { user, org: row.org, membership: row.membership };
}

export async function requirePlatformAdmin(dbOrTx?: DbOrTx): Promise<OrgAccess> {
  const user = await requireUserOrThrow();
  return assertPlatformAdmin(user, dbOrTx);
}

export interface PrimaryOrg {
  org: Organization;
  membership: Membership;
  /** Every organization of this type the user belongs to, for an org switcher. */
  options: Array<{ org: Organization; membership: Membership }>;
}

/**
 * "The SGO (or business) I belong to" for dashboards. With `orgId` (an org-switcher query parameter) that
 * organization is used, and asking for one the user is not a member of is `forbidden`. Without it, the earliest
 * membership of that type wins. Null when the user has no organization of that type.
 */
export async function getPrimaryOrg(user: Pick<User, "id">, type: OrgType, opts: { orgId?: string | null } = {}, dbOrTx?: DbOrTx): Promise<PrimaryOrg | null> {
  const options = (await getMemberships(user.id, dbOrTx)).filter((m) => m.org.type === type);
  if (opts.orgId) {
    const chosen = options.find((m) => m.org.id === opts.orgId);
    if (!chosen) throw forbidden();
    return { ...chosen, options };
  }
  if (options.length === 0) return null;
  return { ...options[0], options };
}

/* -------------------------------------------------------------------------------------- households */

export interface HouseholdAccess {
  user: User;
  household: Household;
  /** "owner" for the household's owner, "adult" for another adult member with their own sign-in. */
  access: "owner" | "adult";
}

export async function assertHouseholdAccess(user: User, householdId: string, dbOrTx?: DbOrTx): Promise<HouseholdAccess> {
  if (typeof householdId !== "string" || householdId.length === 0) throw notFound("Household");
  const db = dbOrTx ?? (await getDb());
  const [household] = await db.select().from(schema.households).where(eq(schema.households.id, householdId)).limit(1);
  // Same answer for "missing" and "not yours", so household ids cannot be probed.
  if (!household) throw notFound("Household");
  if (household.ownerUserId === user.id) return { user, household, access: "owner" };
  const hm = schema.householdMembers;
  const [member] = await db
    .select({ id: hm.id })
    .from(hm)
    .where(and(eq(hm.householdId, householdId), eq(hm.userId, user.id), eq(hm.kind, "adult"), isNull(hm.removedAt)))
    .limit(1);
  if (!member) throw notFound("Household");
  return { user, household, access: "adult" };
}

export async function requireHouseholdAccess(householdId: string, dbOrTx?: DbOrTx): Promise<HouseholdAccess> {
  const user = await requireUserOrThrow();
  return assertHouseholdAccess(user, householdId, dbOrTx);
}
