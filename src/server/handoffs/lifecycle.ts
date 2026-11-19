import { and, asc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { addMs, MS, now } from "@/lib/clock";
import { conflict, invalid, notFound } from "@/lib/errors";
import { audit, SYSTEM_ACTOR, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { accrueSuccessFee, type FeeLedgerRow } from "@/server/billing";
import { applyTransition, auditContextOf, authorizeOperator, lockHandoff, type HandoffActor } from "./internal";
import { findByToken } from "./create";
import { BOOKING_LIMITS, HANDOFF_JOB_BATCH, HOLD_EXTENSION_LIMITS } from "./policy";
import type { HandoffRow } from "./serialize";
import { HOLDING_STATUSES, isFinal, isHolding, targetForVerification } from "./state";

const SYSTEM = { actor: SYSTEM_ACTOR, request: null, extra: {} };

function scopeOf(actor: HandoffActor, businessOrgId: string): { businessOrgId: string; mode?: "test" | "live" } {
  return actor.type === "api_key" ? { businessOrgId, mode: actor.mode } : { businessOrgId };
}

/* --------------------------------------------------------------------------- verification → handoff */

/**
 * Brings a handoff in line with its verification (the mapping is `targetForVerification`): eligible → eligible,
 * ineligible → declined, needs_review or submitted-and-pending → held, opened-and-pending → verifying, canceled →
 * canceled. Moves only forward, only while the reservation is held, and is a no-op when nothing changed, so it is
 * safe to call any number of times (job retries, the recurring sync, page loads).
 * Returns the handoff, or null when it does not exist or has no verification.
 */
export async function syncHandoffWithVerification(handoffId: string, dbOrTx?: DbOrTx): Promise<HandoffRow | null> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const handoff = await lockHandoff(tx, handoffId);
    if (!handoff || !handoff.verificationId) return handoff;
    const [v] = await tx
      .select({ status: schema.verifications.status, startedAt: schema.verifications.startedAt, submittedAt: schema.verifications.submittedAt, handoffId: schema.verifications.handoffId })
      .from(schema.verifications)
      .where(eq(schema.verifications.id, handoff.verificationId))
      .limit(1);
    if (!v || v.handoffId !== handoff.id) return handoff;
    const target = targetForVerification(handoff.status, v);
    if (target === null) return handoff;
    const reason = target === "declined" ? "verification_not_eligible" : target === "canceled" ? "verification_canceled" : undefined;
    return applyTransition(tx, handoff, target, {
      ...SYSTEM,
      patch: reason ? { declineReason: reason, ...(target === "canceled" ? { canceledBy: "system" as const } : {}) } : undefined,
      metadata: { cause: "verification", verificationStatus: v.status },
    });
  });
}

/**
 * Handler body for "handoff.verification_updated" { handoffId, verificationId } (queued by the verifications
 * service after a decision and its evidence). The verification must be the one linked to the handoff.
 */
export async function applyVerificationOutcome(payload: { handoffId: string; verificationId: string }): Promise<HandoffRow | null> {
  const db = await getDb();
  const [row] = await db.select({ verificationId: schema.handoffs.verificationId }).from(schema.handoffs).where(eq(schema.handoffs.id, payload.handoffId)).limit(1);
  if (!row || row.verificationId !== payload.verificationId) return null;
  return syncHandoffWithVerification(payload.handoffId);
}

/**
 * Recurring progress sync: the verifications service only reports decisions, so "the family began" (verifying)
 * and "the family submitted" (held) are picked up here for handoffs whose verification changed since the handoff
 * last did. Returns how many handoffs moved.
 */
export async function syncDueProgress(limit = HANDOFF_JOB_BATCH): Promise<number> {
  const db = await getDb();
  const h = schema.handoffs;
  const v = schema.verifications;
  const due = await db
    .select({ id: h.id })
    .from(h)
    .innerJoin(v, eq(v.id, h.verificationId))
    .where(and(inArray(h.status, [...HOLDING_STATUSES]), isNotNull(h.verificationId), gt(v.updatedAt, h.updatedAt)))
    .orderBy(asc(h.updatedAt), asc(h.id))
    .limit(limit);
  let moved = 0;
  for (const { id } of due) {
    const before = await db.select({ status: h.status }).from(h).where(eq(h.id, id)).limit(1);
    const after = await syncHandoffWithVerification(id);
    if (after && before[0] && after.status !== before[0].status) moved++;
    else await db.update(h).set({ updatedAt: now() }).where(eq(h.id, id));
  }
  return moved;
}

/* ------------------------------------------------------------------------------------------- holds */

/**
 * Recurring "handoff.expire_holds": every handoff still holding a reservation whose hold window has passed becomes
 * expired (no award arrived in time). Returns how many expired.
 */
export async function expireDueHolds(limit = HANDOFF_JOB_BATCH): Promise<number> {
  const db = await getDb();
  const h = schema.handoffs;
  const at = now();
  const due = await db
    .select({ id: h.id })
    .from(h)
    .where(and(inArray(h.status, [...HOLDING_STATUSES]), lte(h.holdExpiresAt, at)))
    .orderBy(asc(h.holdExpiresAt), asc(h.id))
    .limit(limit);
  let expired = 0;
  for (const { id } of due) {
    const changed = await db.transaction(async (tx) => {
      const handoff = await lockHandoff(tx, id);
      if (!handoff || !isHolding(handoff.status) || !handoff.holdExpiresAt || handoff.holdExpiresAt.getTime() > now().getTime()) return false;
      await applyTransition(tx, handoff, "expired", { ...SYSTEM, patch: { declineReason: "hold_expired" }, metadata: { holdExpiresAt: handoff.holdExpiresAt.toISOString() } });
      return true;
    });
    if (changed) expired++;
  }
  return expired;
}

/**
 * The business adds `hours` to a handoff's hold (from the current deadline, or from now if it already passed and
 * the expiry job has not run yet). Only while the reservation is held, and within the policy maximum over the
 * handoff's life. Audited; no event (the business made the change itself, and the next event carries the deadline).
 */
export async function extendHold(businessOrgId: string, handoffId: string, hours: number, actor: HandoffActor): Promise<HandoffRow> {
  if (!Number.isInteger(hours) || hours < 1 || hours > HOLD_EXTENSION_LIMITS.maxSingleHours) {
    throw invalid(`Extend the hold by 1 to ${HOLD_EXTENSION_LIMITS.maxSingleHours} whole hours.`, { fields: { hours: "Whole hours." } });
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    await authorizeOperator(tx, actor, businessOrgId);
    const handoff = await lockHandoff(tx, handoffId, scopeOf(actor, businessOrgId));
    if (!handoff) throw notFound("Handoff");
    if (!isHolding(handoff.status)) throw conflict(`A handoff that is ${handoff.status} has no hold to extend.`);
    if (handoff.holdExtendedHours + hours > HOLD_EXTENSION_LIMITS.maxTotalHours) {
      const left = HOLD_EXTENSION_LIMITS.maxTotalHours - handoff.holdExtendedHours;
      throw conflict(left > 0 ? `This hold can be extended by at most ${left} more hours.` : "This hold cannot be extended any further.", { remainingHours: Math.max(0, left) });
    }
    const at = now();
    const base = handoff.holdExpiresAt && handoff.holdExpiresAt.getTime() > at.getTime() ? handoff.holdExpiresAt : at;
    const holdExpiresAt = addMs(base, hours * MS.hour);
    const [updated] = await tx
      .update(schema.handoffs)
      .set({ holdExpiresAt, holdExtendedHours: handoff.holdExtendedHours + hours, updatedAt: at })
      .where(eq(schema.handoffs.id, handoff.id))
      .returning();
    const ctx = auditContextOf(actor);
    await audit(
      {
        actor: ctx.actor,
        orgId: businessOrgId,
        action: "handoff.hold_extended",
        target: { type: "handoff", id: handoff.id },
        metadata: { hours, from: handoff.holdExpiresAt?.toISOString() ?? null, to: holdExpiresAt.toISOString(), totalExtendedHours: updated.holdExtendedHours, ...ctx.extra },
        request: ctx.request,
      },
      tx,
    );
    return updated;
  });
}

/* --------------------------------------------------------------------------------------- completion */

const completeOptions = z
  .object({
    /** The final booking amount, confirmed by the business server-side. Required when the amount is still unconfirmed and was used for the award. */
    bookingAmountCents: z.number().int().positive().max(BOOKING_LIMITS.maxAmountCents).optional(),
  })
  .strict();

export interface CompleteHandoffResult {
  handoff: HandoffRow;
  /** The success fee owed by the business, or null when its terms make the fee zero. */
  fee: FeeLedgerRow | null;
}

/**
 * The business confirms that the booking was completed with scholarship funds. Only from "awarded". Optionally
 * confirms the final booking amount (it cannot be below the award). Accrues the business's success fee in the same
 * transaction and emits handoff.completed.
 */
export async function completeHandoff(businessOrgId: string, handoffId: string, actor: HandoffActor, opts: { bookingAmountCents?: number } = {}): Promise<CompleteHandoffResult> {
  const parsed = completeOptions.safeParse(opts);
  if (!parsed.success) throw invalid("Enter the final booking amount in whole cents.", { fields: { bookingAmountCents: "Positive whole cents." } });
  const confirmed = parsed.data.bookingAmountCents;
  const db = await getDb();
  return db.transaction(async (tx) => {
    await authorizeOperator(tx, actor, businessOrgId);
    const handoff = await lockHandoff(tx, handoffId, scopeOf(actor, businessOrgId));
    if (!handoff) throw notFound("Handoff");
    if (handoff.status !== "awarded") throw conflict(handoff.status === "completed" ? "This booking is already completed." : "A booking can be completed with scholarship funds only after the SGO has offered an award.");
    if (confirmed !== undefined && handoff.awardId) {
      const [award] = await tx.select({ amountCents: schema.awards.amountCents }).from(schema.awards).where(eq(schema.awards.id, handoff.awardId)).limit(1);
      if (award && confirmed < award.amountCents) throw conflict("The booking amount cannot be less than the scholarship award for it.");
    }
    const ctx = auditContextOf(actor);
    const at = now();
    const updated = await applyTransition(tx, handoff, "completed", {
      ...ctx,
      patch: { completedAt: at, ...(confirmed !== undefined ? { bookingAmountCents: confirmed, bookingAmountConfirmed: true } : {}) },
      metadata: confirmed !== undefined ? { confirmedBookingAmountCents: confirmed, previousBookingAmountCents: handoff.bookingAmountCents } : {},
    });
    const fee = await accrueSuccessFee(updated.id, tx);
    return { handoff: updated, fee };
  });
}

/* ------------------------------------------------------------------------------------------ cancel */

const reasonSchema = z
  .string()
  .max(500)
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, " ").trim() : undefined));

/** The business cancels a handoff that has not ended. Audited (with its reason, never sent to the family). */
export async function cancelHandoff(businessOrgId: string, handoffId: string, actor: HandoffActor, opts: { reason?: string } = {}): Promise<HandoffRow> {
  const reason = reasonSchema.safeParse(opts.reason);
  if (!reason.success) throw invalid("Keep the reason under 500 characters.", { fields: { reason: "At most 500 characters." } });
  const db = await getDb();
  return db.transaction(async (tx) => {
    await authorizeOperator(tx, actor, businessOrgId);
    const handoff = await lockHandoff(tx, handoffId, scopeOf(actor, businessOrgId));
    if (!handoff) throw notFound("Handoff");
    if (handoff.status === "canceled") return handoff;
    if (isFinal(handoff.status)) throw conflict(`A handoff that is ${handoff.status} cannot be canceled.`);
    return applyTransition(tx, handoff, "canceled", { ...auditContextOf(actor), patch: { canceledBy: "business", declineReason: "canceled_by_business" }, metadata: reason.data ? { reason: reason.data } : {} });
  });
}

/** The family cancels from the handoff page (token holder). */
export async function cancelHandoffByFamily(token: string, opts: { request?: AuditRequestInfo | null } = {}): Promise<HandoffRow> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const handoff = await findByToken(tx, token, { forUpdate: true });
    if (!handoff) throw notFound("Handoff");
    if (handoff.status === "canceled") return handoff;
    if (isFinal(handoff.status)) throw conflict("This scholarship check has already ended.");
    return applyTransition(tx, handoff, "canceled", { actor: { type: "family" }, request: opts.request ?? null, extra: {}, patch: { canceledBy: "family", declineReason: "canceled_by_family" } });
  });
}

/* --------------------------------------------------------------- SGO decisions (for src/server/awards) */

export interface SgoDecisionContext {
  actor: AuditActor;
  request?: AuditRequestInfo | null;
}

/**
 * Moves an eligible handoff routed to `sgoOrgId` to "awarded" with `awardId`, inside the caller's transaction (the
 * one that writes the award). For the awards service only.
 */
export async function markHandoffAwarded(tx: DbOrTx, input: { handoffId: string; sgoOrgId: string; awardId: string }, ctx: SgoDecisionContext): Promise<HandoffRow> {
  const handoff = await lockHandoff(tx, input.handoffId, { sgoOrgId: input.sgoOrgId });
  if (!handoff) throw notFound("Handoff");
  if (handoff.status !== "eligible") {
    throw conflict(handoff.status === "awarded" ? "An award was already offered for this booking." : `An award can be offered only once the household is eligible and the hold is active (this handoff is ${handoff.status}).`);
  }
  return applyTransition(tx, handoff, "awarded", { actor: ctx.actor, request: ctx.request ?? null, extra: {}, patch: { awardId: input.awardId }, metadata: { awardId: input.awardId, cause: "sgo_award" } });
}

/**
 * The SGO declines to award (or revokes its award): the handoff routed to it becomes "declined". `reason` is kept
 * for the SGO's own audit trail and is never sent to the business or the family. For the awards service only.
 * `allowAwarded` is set only when an award is being revoked.
 */
export async function declineHandoffForSgo(
  tx: DbOrTx,
  input: { handoffId: string; sgoOrgId: string; reasonCode: "sgo_declined" | "award_revoked"; allowAwarded: boolean },
  ctx: SgoDecisionContext,
): Promise<HandoffRow> {
  const handoff = await lockHandoff(tx, input.handoffId, { sgoOrgId: input.sgoOrgId });
  if (!handoff) throw notFound("Handoff");
  if (handoff.status === "declined") return handoff;
  if (handoff.status === "awarded" && !input.allowAwarded) throw conflict("An award was already offered for this booking. Revoke the award instead.");
  if (isFinal(handoff.status)) throw conflict(`A handoff that is ${handoff.status} can no longer be declined.`);
  return applyTransition(tx, handoff, "declined", { actor: ctx.actor, request: ctx.request ?? null, extra: {}, patch: { declineReason: input.reasonCode }, metadata: { cause: input.reasonCode } });
}
