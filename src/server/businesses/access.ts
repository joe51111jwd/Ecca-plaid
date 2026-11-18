import { and, eq } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { forbidden } from "@/lib/errors";
import type { AuditActor, AuditRequestInfo } from "@/server/audit";
import { isPlatformAdmin, roleAtLeast } from "@/server/auth";

/**
 * Who is acting on a business or a partnership.
 *  - A signed-in person: `{ userId, request? }` (the same shape as OrgActor / SgoUserActor). The service checks their
 *    membership itself; a page's guard is not trusted to have checked the right organization.
 *  - Trusted server code with no person behind it (seed script, jobs): `businessSystemActor("reason")`. Never build
 *    one from request input.
 */
export interface BusinessUserActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

export interface BusinessSystemActor {
  system: true;
  /** Why the system is acting, recorded on the audit entry. */
  reason: string;
}

export type BusinessActor = BusinessUserActor | BusinessSystemActor;

export function businessSystemActor(reason: string): BusinessSystemActor {
  return { system: true, reason };
}

export function isBusinessSystemActor(actor: BusinessActor): actor is BusinessSystemActor {
  return typeof actor === "object" && actor !== null && "system" in actor && actor.system === true;
}

export function auditContextOf(actor: BusinessActor): { actor: AuditActor; request: AuditRequestInfo | null; extra: Record<string, unknown> } {
  return isBusinessSystemActor(actor)
    ? { actor: { type: "system" }, request: null, extra: { systemReason: actor.reason } }
    : { actor: { type: "user", id: actor.userId }, request: actor.request ?? null, extra: {} };
}

/** Owners and admins manage an organization's business settings and partnerships. */
export const MANAGE_ROLE: MemberRole = "admin";

export interface Authority {
  platformAdmin: boolean;
  system: boolean;
  role: MemberRole | null;
}

/**
 * Throws `forbidden` unless the actor may manage `orgId`: an owner/admin of it, a platform admin, or system code.
 * Checked before the organization is loaded, so a stranger cannot tell missing organizations from foreign ones.
 */
export async function authorizeManage(db: DbOrTx, actor: BusinessActor, orgId: string): Promise<Authority> {
  if (isBusinessSystemActor(actor)) {
    if (typeof actor.reason !== "string" || actor.reason.trim() === "") throw forbidden();
    return { platformAdmin: false, system: true, role: null };
  }
  if (!actor || typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
  if (await isPlatformAdmin(actor.userId, db)) return { platformAdmin: true, system: false, role: null };
  if (typeof orgId !== "string" || orgId.length === 0) throw forbidden();
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, actor.userId)))
    .limit(1);
  if (!m) throw forbidden();
  if (!roleAtLeast(m.role, MANAGE_ROLE)) throw forbidden("Your role in this organization does not allow this");
  return { platformAdmin: false, system: false, role: m.role };
}

/** Throws `forbidden` unless the actor is a platform admin (commercial terms) or system code. */
export async function authorizePlatform(db: DbOrTx, actor: BusinessActor): Promise<Authority> {
  if (isBusinessSystemActor(actor)) {
    if (typeof actor.reason !== "string" || actor.reason.trim() === "") throw forbidden();
    return { platformAdmin: false, system: true, role: null };
  }
  if (!actor || typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
  if (!(await isPlatformAdmin(actor.userId, db))) throw forbidden("Only platform administrators can change commercial terms");
  return { platformAdmin: true, system: false, role: null };
}
