import { and, eq } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { forbidden, notFound } from "@/lib/errors";
import type { AuditActor, AuditRequestInfo } from "@/server/audit";
import { isPlatformAdmin, roleAtLeast, type Organization } from "@/server/auth";
import { isSafeId } from "./identity";

/**
 * Who is acting on an SGO.
 *  - A signed-in person: `{ userId, request? }` (the same shape as OrgActor in src/server/orgs). The service checks
 *    their membership itself; a page's guard is not trusted to have checked the right organization.
 *  - Trusted server code with no person behind it (seed script, payments onboarding webhook, jobs):
 *    `systemActor("reason")`. Never build one from request input.
 */
export interface SgoUserActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

export interface SgoSystemActor {
  system: true;
  /** Why the system is acting, recorded on the audit entry (e.g. "seed", "payments.account_updated"). */
  reason: string;
}

export type SgoActor = SgoUserActor | SgoSystemActor;

export function systemActor(reason: string): SgoSystemActor {
  return { system: true, reason };
}

export function isSystemActor(actor: SgoActor): actor is SgoSystemActor {
  return "system" in actor && actor.system === true;
}

/** The audit actor and request for an SGO actor, plus the system reason to record in metadata. */
export function auditContextOf(actor: SgoActor): { actor: AuditActor; request: AuditRequestInfo | null; systemReason?: string } {
  return isSystemActor(actor) ? { actor: { type: "system" }, request: null, systemReason: actor.reason } : { actor: { type: "user", id: actor.userId }, request: actor.request ?? null };
}

/** What the actor is allowed to do across the module. */
export type SgoPermission =
  /** Edit the profile, policy, integration choice, attest IRS portal registration: SGO owner/admin, platform admin, system. */
  | "manage"
  /** Platform-only acts (list import and links, payments account): platform admin or system. */
  | "platform";

const MANAGE_ROLE: MemberRole = "admin";

export interface Authorized {
  platformAdmin: boolean;
  role: MemberRole | null;
}

/** Throws `forbidden` unless the actor holds `permission` (org-scoped permissions need `orgId`). */
export async function authorize(db: DbOrTx, actor: SgoActor, permission: SgoPermission, orgId?: string): Promise<Authorized> {
  if (isSystemActor(actor)) {
    if (typeof actor.reason !== "string" || actor.reason.trim() === "") throw forbidden();
    return { platformAdmin: true, role: null };
  }
  if (!isSafeId(actor.userId)) throw forbidden();
  const platformAdmin = await isPlatformAdmin(actor.userId, db);
  if (platformAdmin) return { platformAdmin, role: null };
  if (permission === "platform" || !isSafeId(orgId)) throw forbidden();
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, actor.userId)))
    .limit(1);
  if (!m) throw forbidden();
  if (!roleAtLeast(m.role, MANAGE_ROLE)) throw forbidden("Your role in this organization does not allow this");
  return { platformAdmin, role: m.role };
}

export type SgoProfile = typeof schema.sgoProfiles.$inferSelect;

/** The SGO organization and its profile. `not_found` for a missing org, a non-SGO org or a missing profile. */
export async function loadSgo(db: DbOrTx, orgId: string, opts: { forUpdate?: boolean } = {}): Promise<{ org: Organization; profile: SgoProfile }> {
  if (!isSafeId(orgId)) throw notFound("SGO");
  const q = db
    .select({ org: schema.organizations, profile: schema.sgoProfiles })
    .from(schema.sgoProfiles)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.sgoProfiles.orgId))
    .where(and(eq(schema.sgoProfiles.orgId, orgId), eq(schema.organizations.type, "sgo")))
    .limit(1);
  const [row] = opts.forUpdate ? await q.for("update", { of: schema.sgoProfiles }) : await q;
  if (!row) throw notFound("SGO");
  return row;
}
