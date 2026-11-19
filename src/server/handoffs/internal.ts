import { and, eq, isNull } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { HandoffStatus } from "@/db/schema";
import { now } from "@/lib/clock";
import { conflict, forbidden } from "@/lib/errors";
import { audit, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { isPlatformAdmin, roleAtLeast } from "@/server/auth";
import { emitEvent, isEventType } from "@/server/events";
import { HANDOFF_OPERATOR_ROLE } from "./policy";
import { toWebhookPayload, type HandoffRelated, type HandoffRow } from "./serialize";
import { canTransition } from "./state";

/**
 * Who acts on a handoff from the business side.
 *  - `user`: a signed-in member of the business (the service checks the membership itself) or a platform admin.
 *  - `api_key`: the business's secret API key, already authenticated by the API layer; checked again here against
 *    the business and mode.
 *  - `system`: trusted server code with no person behind it (jobs, seed). Never built from request input.
 */
export type HandoffActor =
  | { type: "user"; userId: string; request?: AuditRequestInfo | null }
  | { type: "api_key"; apiKeyId: string; mode: "test" | "live"; request?: AuditRequestInfo | null }
  | { type: "system"; reason: string };

export function handoffSystemActor(reason: string): HandoffActor {
  return { type: "system", reason };
}

export interface ActorContext {
  actor: AuditActor;
  request: AuditRequestInfo | null;
  extra: Record<string, unknown>;
}

export function auditContextOf(actor: HandoffActor): ActorContext {
  if (actor.type === "system") return { actor: { type: "system" }, request: null, extra: { systemReason: actor.reason } };
  if (actor.type === "api_key") return { actor: { type: "api_key", id: actor.apiKeyId }, request: actor.request ?? null, extra: {} };
  return { actor: { type: "user", id: actor.userId }, request: actor.request ?? null, extra: {} };
}

/**
 * Throws `forbidden` unless the actor may operate this business's handoffs. Checked before any handoff is loaded, so
 * a stranger cannot tell a missing handoff from another business's.
 */
export async function authorizeOperator(db: DbOrTx, actor: HandoffActor, businessOrgId: string): Promise<void> {
  if (typeof businessOrgId !== "string" || businessOrgId.length === 0) throw forbidden();
  if (!actor || typeof actor !== "object") throw forbidden();
  if (actor.type === "system") {
    if (typeof actor.reason !== "string" || actor.reason.trim() === "") throw forbidden();
    return;
  }
  if (actor.type === "api_key") {
    if (typeof actor.apiKeyId !== "string" || actor.apiKeyId.length === 0) throw forbidden();
    const [key] = await db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, actor.apiKeyId), eq(schema.apiKeys.orgId, businessOrgId), eq(schema.apiKeys.mode, actor.mode), isNull(schema.apiKeys.revokedAt)))
      .limit(1);
    if (!key) throw forbidden();
    return;
  }
  if (actor.type !== "user" || typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
  if (await isPlatformAdmin(actor.userId, db)) return;
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, businessOrgId), eq(schema.memberships.userId, actor.userId)))
    .limit(1);
  if (!m) throw forbidden();
  if (!roleAtLeast(m.role, HANDOFF_OPERATOR_ROLE)) throw forbidden("Your role in this organization does not allow this");
}

/** The handoff row, locked for update, or null. `scope` limits it to one business (and mode) or one SGO. */
export async function lockHandoff(
  tx: DbOrTx,
  id: string,
  scope: { businessOrgId?: string; sgoOrgId?: string; mode?: "test" | "live" } = {},
): Promise<HandoffRow | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
  const h = schema.handoffs;
  const [row] = await tx
    .select()
    .from(h)
    .where(
      and(
        eq(h.id, id),
        scope.businessOrgId !== undefined ? eq(h.businessOrgId, scope.businessOrgId) : undefined,
        scope.sgoOrgId !== undefined ? eq(h.sgoOrgId, scope.sgoOrgId) : undefined,
        scope.mode !== undefined ? eq(h.mode, scope.mode) : undefined,
      ),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

/** The linked verification status, award and SGO name of one handoff. */
export async function loadRelated(db: DbOrTx, row: HandoffRow): Promise<HandoffRelated> {
  const [verification] = row.verificationId
    ? await db.select({ status: schema.verifications.status }).from(schema.verifications).where(eq(schema.verifications.id, row.verificationId)).limit(1)
    : [];
  const [award] = row.awardId
    ? await db
        .select({ amountCents: schema.awards.amountCents, paymentMethod: schema.awards.paymentMethod, status: schema.awards.status })
        .from(schema.awards)
        .where(eq(schema.awards.id, row.awardId))
        .limit(1)
    : [];
  const [sgo] = row.sgoOrgId ? await db.select({ name: schema.sgoProfiles.displayName }).from(schema.sgoProfiles).where(eq(schema.sgoProfiles.orgId, row.sgoOrgId)).limit(1) : [];
  return { verificationStatus: verification?.status ?? null, award: award ?? null, sgoName: sgo?.name ?? null };
}

/** Fields a transition may change along with the status. */
export type TransitionPatch = Partial<
  Pick<HandoffRow, "awardId" | "declineReason" | "canceledBy" | "completedAt" | "bookingAmountCents" | "bookingAmountConfirmed" | "holdExpiresAt">
>;

export interface TransitionContext extends ActorContext {
  patch?: TransitionPatch;
  /** Extra audit metadata (never family data). */
  metadata?: Record<string, unknown>;
}

/**
 * Moves a locked handoff to `to`: one conditional update, one audit entry, and the `handoff.<to>` event to the
 * business, all in the caller's transaction. Because the caller holds the row lock and the update is conditional on
 * the status it read, a retried job or a concurrent request can never emit the same transition twice.
 * Throws `conflict` for an illegal move.
 */
export async function applyTransition(tx: DbOrTx, current: HandoffRow, to: HandoffStatus, ctx: TransitionContext): Promise<HandoffRow> {
  if (!canTransition(current.status, to)) throw conflict(`A handoff that is ${current.status} cannot become ${to}.`, { from: current.status, to });
  const at = now();
  const [updated] = await tx
    .update(schema.handoffs)
    .set({ ...ctx.patch, status: to, statusChangedAt: at, updatedAt: at })
    .where(and(eq(schema.handoffs.id, current.id), eq(schema.handoffs.status, current.status)))
    .returning();
  if (!updated) throw conflict("The handoff changed while this request was being handled. Try again.");
  await audit(
    {
      actor: ctx.actor,
      orgId: current.businessOrgId,
      action: `handoff.${to}`,
      target: { type: "handoff", id: current.id },
      metadata: { from: current.status, to, sgoOrgId: current.sgoOrgId, ...ctx.metadata, ...ctx.extra },
      request: ctx.request,
    },
    tx,
  );
  await emitHandoffEvent(tx, updated);
  return updated;
}

/**
 * Emits `handoff.<status>` to the business when that event type exists. The platform's event catalogue has no
 * `handoff.verifying` or `handoff.canceled` yet; those transitions are audited and visible through the API, and
 * start emitting as soon as the catalogue lists them.
 */
export async function emitHandoffEvent(tx: DbOrTx, row: HandoffRow): Promise<void> {
  const type = `handoff.${row.status}`;
  if (!isEventType(type)) return;
  const payload = toWebhookPayload(row, await loadRelated(tx, row));
  await emitEvent({ orgId: row.businessOrgId, type, payload: payload as unknown as Record<string, unknown>, mode: row.mode }, tx);
}
