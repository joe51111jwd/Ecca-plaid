/**
 * Helpers shared by the files of this module. Not part of the public API (index.ts).
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { Mode, VerificationFlag, VerificationStage } from "@/db/schema";
import { now } from "@/lib/clock";
import { AppError, conflict, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import type { AuditActor, AuditRequestInfo } from "@/server/audit";
import { assertHouseholdAccess, type HouseholdAccess, type User } from "@/server/auth";
import { CLOSED_STATUSES, FAMILY_EDITABLE_STAGES, STAGE_ORDER } from "./policy";

export type VerificationRow = typeof schema.verifications.$inferSelect;
export type DocumentRow = typeof schema.documents.$inferSelect;
export type CertificationRow = typeof schema.verificationCertifications.$inferSelect;

/** The signed-in person a family-side operation is done for (the same shape as HouseholdActor). */
export interface FamilyActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

/**
 * Who is acting for the SGO: an API key (scoped to one organization and one mode) or a signed-in staff member
 * (whose dashboard is showing one mode). The caller has already authenticated the key or checked membership.
 */
export interface OrgActor {
  type: "api_key" | "user";
  id: string;
  mode: Mode;
  request?: AuditRequestInfo | null;
}

export type VerificationEventActor = { type: "family" | "user" | "api_key" | "system"; id: string | null };

export async function recordVerificationEvent(db: DbOrTx, verificationId: string, type: string, actor: VerificationEventActor, data: Record<string, unknown> = {}): Promise<void> {
  await db.insert(schema.verificationEvents).values({ id: newId("verificationEvent"), verificationId, type, actorType: actor.type, actorId: actor.id, data, createdAt: now() });
}

export function familyAuditActor(actor: FamilyActor): AuditActor {
  return { type: "user", id: actor.userId };
}

export function orgAuditActor(actor: OrgActor): AuditActor {
  return { type: actor.type, id: actor.id };
}

/** The later of two stages in lifecycle order: family steps never move a verification backwards. */
export function laterStage(current: VerificationStage, target: VerificationStage): VerificationStage {
  return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(current) ? target : current;
}

export async function loadVerificationRow(db: DbOrTx, id: string, opts: { forUpdate?: boolean } = {}): Promise<VerificationRow | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
  const q = db.select().from(schema.verifications).where(eq(schema.verifications.id, id)).limit(1);
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

export async function loadUser(db: DbOrTx, userId: string): Promise<User> {
  const [user] = typeof userId === "string" && userId.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1) : [];
  if (!user) throw notFound("Verification");
  return user;
}

export interface FamilyAccess {
  verification: VerificationRow;
  user: User;
  access: HouseholdAccess;
}

/**
 * The verification as the family member may act on it: it must be bound to a household the person belongs to.
 * A verification of another household is reported exactly like a missing one, so ids cannot be probed.
 */
export async function requireFamilyAccess(db: DbOrTx, verificationId: string, actor: FamilyActor, opts: { forUpdate?: boolean } = {}): Promise<FamilyAccess> {
  const user = await loadUser(db, actor.userId);
  const verification = await loadVerificationRow(db, verificationId, opts);
  if (!verification || !verification.householdId) throw notFound("Verification");
  try {
    const access = await assertHouseholdAccess(user, verification.householdId, db);
    return { verification, user, access };
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") throw notFound("Verification");
    throw e;
  }
}

/** Refuses changes once the verification is closed, submitted or decided. */
export function assertFamilyEditable(v: VerificationRow): void {
  if (CLOSED_STATUSES.has(v.status)) throw conflict(v.status === "canceled" ? "This verification was canceled." : "This verification has expired.", { reason: `verification_${v.status}` });
  if (v.status !== "pending" || !FAMILY_EDITABLE_STAGES.has(v.stage)) {
    throw conflict("This verification has been submitted and can no longer be changed.", { reason: "verification_locked", stage: v.stage, status: v.status });
  }
}

/** Appends a reviewer-visible flag unless one with the same code is already recorded. */
export async function addVerificationFlag(db: DbOrTx, v: VerificationRow, code: string, message: string): Promise<void> {
  if (v.flags.some((f) => f.code === code)) return;
  const flag: VerificationFlag = { code, message, at: now().toISOString() };
  await db
    .update(schema.verifications)
    .set({ flags: sql`${schema.verifications.flags} || ${JSON.stringify([flag])}::jsonb`, updatedAt: now() })
    .where(eq(schema.verifications.id, v.id));
}

/** Tenant- and mode-scoped lookup for org-facing functions. Other tenants' and other modes' rows are not found. */
export async function loadOrgVerification(db: DbOrTx, orgId: string, mode: Mode, id: string, opts: { forUpdate?: boolean } = {}): Promise<VerificationRow> {
  if (typeof id !== "string" || id.length === 0 || id.length > 128 || typeof orgId !== "string" || orgId.length === 0) throw notFound("Verification");
  const q = db
    .select()
    .from(schema.verifications)
    .where(and(eq(schema.verifications.id, id), eq(schema.verifications.orgId, orgId), eq(schema.verifications.mode, mode)))
    .limit(1);
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  if (!row) throw notFound("Verification");
  return row;
}

/** A certification id. Prefixed like every other entity; built on newId's generator. */
export function newCertificationId(): string {
  return `vcr_${newId("consent").slice("con_".length)}`;
}
