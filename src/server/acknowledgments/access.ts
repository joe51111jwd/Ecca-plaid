import { and, eq, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { badRequest, forbidden } from "@/lib/errors";
import type { AuditActor, AuditRequestInfo } from "@/server/audit";
import { isPlatformAdmin, roleAtLeast } from "@/server/auth";
import { isSystemActor, type SgoActor } from "@/server/sgos";
import { MANAGE_ROLE } from "./policy";

/**
 * Who may act. Mutations take an SgoActor (a signed-in person, checked here against the SGO's memberships, or
 * trusted server code via `systemActor(reason)`); reads take a ReadAccess naming the reader for the audit log, the
 * caller having already guarded membership (the same contract as src/server/donations read models).
 */

export interface ReadAccess {
  actor: AuditActor;
  request?: AuditRequestInfo | null;
}

export interface ActorContext {
  audit: AuditActor;
  request: AuditRequestInfo | null;
  /** Stored in assigned_by / issued_by / generated_by. */
  label: string;
  systemReason?: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function requireOrgId(orgId: unknown): string {
  if (typeof orgId !== "string" || !SAFE_ID.test(orgId)) throw badRequest("An organization is required");
  return orgId;
}

export function requireReadAccess(access: ReadAccess | undefined): ReadAccess {
  if (!access?.actor?.type) throw forbidden("A reader must be named for donor records");
  return access;
}

/** Throws forbidden unless the actor is the system, a platform admin, or a member of the SGO with at least `minRole`. */
export async function authorizeStaff(db: DbOrTx, actor: SgoActor, orgId: string, minRole: MemberRole = MANAGE_ROLE): Promise<ActorContext> {
  if (!actor || typeof actor !== "object") throw forbidden();
  if (isSystemActor(actor)) {
    if (typeof actor.reason !== "string" || actor.reason.trim() === "") throw forbidden();
    return { audit: { type: "system" }, request: null, label: `system:${actor.reason}`, systemReason: actor.reason };
  }
  if (typeof actor.userId !== "string" || !SAFE_ID.test(actor.userId)) throw forbidden();
  const ctx: ActorContext = { audit: { type: "user", id: actor.userId }, request: actor.request ?? null, label: actor.userId };
  if (await isPlatformAdmin(actor.userId, db)) return ctx;
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, actor.userId)))
    .limit(1);
  if (!m) throw forbidden();
  if (!roleAtLeast(m.role, minRole)) throw forbidden("Your role in this organization does not allow this");
  return ctx;
}

/** Namespace of this domain's transaction advisory locks ("ACKN"). */
const LOCK_NAMESPACE = 0x41434b4e;

/** Serializes work on one key (e.g. one SGO's donor numbers for a year) until the transaction ends. */
export async function lockKey(tx: DbOrTx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${key}))`);
}
