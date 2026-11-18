import { eq } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import { forbidden, notFound } from "@/lib/errors";
import type { AuditRequestInfo } from "@/server/audit";
import { assertHouseholdAccess, type HouseholdAccess, type User } from "@/server/auth";

/** The signed-in person a household operation is done for. Pages and actions get it from requireUser(). */
export interface HouseholdActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

export type HouseholdRole = HouseholdAccess["access"];

/**
 * What each household role may do. The spec gives the household "a clear owner for consent"; a second adult
 * with their own sign-in "can view and add documents but cannot grant the sharing consent". Beyond that the
 * sources are silent, so editing the household (address, members, students, invitations) and exporting its
 * data are owner-only by policy: one person is accountable for what the household submits.
 */
export const HOUSEHOLD_PERMISSIONS = {
  view: ["owner", "adult"],
  add_documents: ["owner", "adult"],
  connect_rail: ["owner", "adult"],
  edit_household: ["owner"],
  invite_adult: ["owner"],
  grant_share_consent: ["owner"],
  export_data: ["owner"],
} as const satisfies Record<string, readonly HouseholdRole[]>;

export type HouseholdPermission = keyof typeof HOUSEHOLD_PERMISSIONS;

export function householdCan(role: HouseholdRole, permission: HouseholdPermission): boolean {
  return (HOUSEHOLD_PERMISSIONS[permission] as readonly HouseholdRole[]).includes(role);
}

export async function loadActorUser(db: DbOrTx, userId: string): Promise<User> {
  const [user] = typeof userId === "string" && userId.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1) : [];
  if (!user) throw notFound("Household");
  return user;
}

/**
 * The actor's access to the household, required to include `permission`. A household the actor does not
 * belong to is not_found (ids cannot be probed); a role without the permission is forbidden.
 */
export async function requirePermission(db: DbOrTx, householdId: string, actor: HouseholdActor, permission: HouseholdPermission): Promise<HouseholdAccess> {
  const user = await loadActorUser(db, actor.userId);
  const access = await assertHouseholdAccess(user, householdId, db);
  if (!householdCan(access.access, permission)) throw forbidden("Only the adult in charge of this household can do this.");
  return access;
}
