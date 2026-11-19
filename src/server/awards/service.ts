import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { AwardStatus, Mode, VendorType } from "@/db/schema";
import { now } from "@/lib/clock";
import { badRequest, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { assertOrgMember, type User } from "@/server/auth";
import { emitEvent } from "@/server/events";
import { centsToUsdString, declineHandoffForSgo, getHandoffForSgo, holdIsActive, markHandoffAwarded, type HandoffRow, type SgoHandoffView } from "@/server/handoffs";
import {
  AWARD_DECIDER_ROLE,
  AWARD_PAYMENT_METHODS,
  awardComplianceReminders,
  MAX_AWARD_CENTS,
  MAX_AWARD_NOTES_LENGTH,
  REASON_LENGTH,
  REVOKE_AFTER_COMPLETION_ALLOWED,
  type AwardPaymentMethod,
  type ComplianceReminder,
} from "./policy";

/**
 * Scholarship awards: an SGO's explicit decision, never automatic after verification.
 *
 *   offered ──▶ accepted ──▶ paid
 *      │  └──────────────────▲
 *      └──▶ revoked ◀── accepted
 *
 * An award needs an eligible, unexpired verification of the SGO's own; an award for a booking also needs the
 * handoff to be eligible and holding, and cannot exceed the booking amount. Offering one emits award.offered to
 * the SGO and moves the handoff to "awarded" (handoff.awarded to the business). Recording "paid" is the SGO's own
 * bookkeeping: no money moves through the platform.
 */

export type AwardRow = typeof schema.awards.$inferSelect;

/**
 * Who decides for the SGO: a signed-in staff member (checked here, at least AWARD_DECIDER_ROLE) or the SGO's API
 * key (authenticated by the API layer, checked again here). `mode` is the dashboard's or the key's mode.
 */
export type AwardActor =
  | { type: "user"; userId: string; mode: Mode; request?: AuditRequestInfo | null }
  | { type: "api_key"; apiKeyId: string; mode: Mode; request?: AuditRequestInfo | null };

function auditActorOf(actor: AwardActor): AuditActor {
  return actor.type === "user" ? { type: "user", id: actor.userId } : { type: "api_key", id: actor.apiKeyId };
}

async function authorize(db: DbOrTx, actor: AwardActor, sgoOrgId: string): Promise<void> {
  if (!actor || typeof actor !== "object" || (actor.mode !== "test" && actor.mode !== "live")) throw forbidden();
  if (typeof sgoOrgId !== "string" || sgoOrgId.length === 0 || sgoOrgId.length > 128) throw forbidden();
  const [org] = await db.select({ type: schema.organizations.type }).from(schema.organizations).where(eq(schema.organizations.id, sgoOrgId)).limit(1);
  if (!org || org.type !== "sgo") throw forbidden();
  if (actor.type === "api_key") {
    if (typeof actor.apiKeyId !== "string" || actor.apiKeyId.length === 0) throw forbidden();
    const [key] = await db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, actor.apiKeyId), eq(schema.apiKeys.orgId, sgoOrgId), eq(schema.apiKeys.mode, actor.mode), isNull(schema.apiKeys.revokedAt)))
      .limit(1);
    if (!key) throw forbidden();
    return;
  }
  if (actor.type !== "user" || typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
  if (!user) throw forbidden();
  await assertOrgMember(user as User, sgoOrgId, AWARD_DECIDER_ROLE, db);
}

function validationError(error: z.ZodError, message: string): never {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
  throw invalid(message, { fields });
}

const id = z.string().trim().min(1).max(128);
const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined || v.trim() === "" ? null : v.trim()))
    .refine((v) => v === null || v.length <= max, `At most ${max} characters.`);

const offerSchema = z.strictObject({
  verificationId: id,
  handoffId: id.nullish(),
  studentMemberId: id.nullish(),
  amountCents: z.number({ error: "Enter the award in whole cents." }).int("Enter the award in whole cents.").positive("The award must be more than zero.").max(MAX_AWARD_CENTS, "The award is larger than this platform accepts."),
  paymentMethod: z.enum(AWARD_PAYMENT_METHODS as [AwardPaymentMethod, ...AwardPaymentMethod[]], { error: "Choose how the award will be paid." }),
  notes: optionalText(MAX_AWARD_NOTES_LENGTH),
});

export type OfferAwardInput = z.input<typeof offerSchema>;

const reasonSchema = z
  .string({ error: "Give a reason." })
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(REASON_LENGTH.min, "Give a reason.").max(REASON_LENGTH.max, `At most ${REASON_LENGTH.max} characters.`));

export interface OfferAwardResult {
  award: AwardRow;
  /** The handoff moved to "awarded", when the award is for a booking. */
  handoff: HandoffRow | null;
}

/** award.offered payload for the SGO's own webhooks. */
function awardPayload(award: AwardRow): Record<string, unknown> {
  return {
    id: award.id,
    object: "award",
    verification_id: award.verificationId,
    handoff_id: award.handoffId,
    student_member_id: award.studentMemberId,
    amount_usd: centsToUsdString(award.amountCents),
    payment_method: award.paymentMethod,
    status: award.status,
    decided_at: award.decidedAt.toISOString(),
  };
}

/**
 * The SGO offers an award. The verification must be the SGO's own (same mode), eligible and unexpired. When the
 * verification came from a booking handoff the award is for that booking unless another handoff id is given (which
 * is refused: an award can only be for the booking that created the verification). For a booking the amount cannot
 * exceed the booking amount, and the handoff must be eligible with its hold active.
 */
export async function offerAward(sgoOrgId: string, input: OfferAwardInput, actor: AwardActor): Promise<OfferAwardResult> {
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) validationError(parsed.error, "Check the award.");
  const data = parsed.data;
  const db = await getDb();
  return db.transaction(async (tx) => {
    await authorize(tx, actor, sgoOrgId);
    const v = schema.verifications;
    const [verification] = await tx
      .select({ id: v.id, orgId: v.orgId, mode: v.mode, status: v.status, expiresAt: v.expiresAt, handoffId: v.handoffId, householdId: v.householdId, studentMemberIds: v.studentMemberIds })
      .from(v)
      .where(and(eq(v.id, data.verificationId), eq(v.orgId, sgoOrgId), eq(v.mode, actor.mode)))
      .limit(1)
      .for("update");
    if (!verification) throw notFound("Verification");
    if (verification.status !== "eligible") throw conflict("An award can be offered only for a verification that is eligible.");
    if (verification.expiresAt && verification.expiresAt.getTime() <= now().getTime()) throw conflict("This verification result has expired. Ask the family to verify again before offering an award.");

    const handoffId = data.handoffId ?? verification.handoffId ?? null;
    if (handoffId !== null && handoffId !== verification.handoffId) throw conflict("An award can only be for the booking that started this verification.");

    if (handoffId !== null) {
      const [handoff] = await tx
        .select({ status: schema.handoffs.status, bookingAmountCents: schema.handoffs.bookingAmountCents })
        .from(schema.handoffs)
        .where(and(eq(schema.handoffs.id, handoffId), eq(schema.handoffs.sgoOrgId, sgoOrgId)))
        .limit(1);
      if (!handoff) throw notFound("Handoff");
      if (handoff.bookingAmountCents !== null && data.amountCents > handoff.bookingAmountCents) {
        throw invalid("The award cannot be more than the booking amount.", { fields: { amountCents: `At most ${centsToUsdString(handoff.bookingAmountCents)} for this booking.` } });
      }
    }

    if (data.studentMemberId) {
      const [member] = await tx
        .select({ householdId: schema.householdMembers.householdId, removedAt: schema.householdMembers.removedAt })
        .from(schema.householdMembers)
        .where(eq(schema.householdMembers.id, data.studentMemberId))
        .limit(1);
      const listed = verification.studentMemberIds.length === 0 || verification.studentMemberIds.includes(data.studentMemberId);
      if (!member || member.removedAt || member.householdId !== verification.householdId || !listed) {
        throw invalid("Choose a student from this verification's household.", { fields: { studentMemberId: "Not a student on this verification." } });
      }
    }

    const at = now();
    const [award] = await tx
      .insert(schema.awards)
      .values({
        id: newId("award"),
        orgId: sgoOrgId,
        verificationId: verification.id,
        handoffId,
        studentMemberId: data.studentMemberId ?? null,
        amountCents: data.amountCents,
        status: "offered",
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        decidedBy: actor.type === "user" ? actor.userId : null,
        decidedAt: at,
        createdAt: at,
      })
      .returning();
    const auditActor = auditActorOf(actor);
    await audit(
      {
        actor: auditActor,
        orgId: sgoOrgId,
        action: "award.offer",
        target: { type: "award", id: award.id },
        metadata: { verificationId: verification.id, handoffId, amountCents: award.amountCents, paymentMethod: award.paymentMethod, mode: actor.mode },
        request: actor.request ?? null,
      },
      tx,
    );
    await emitEvent({ orgId: sgoOrgId, type: "award.offered", payload: awardPayload(award), mode: verification.mode }, tx);
    const handoff = handoffId !== null ? await markHandoffAwarded(tx, { handoffId, sgoOrgId, awardId: award.id }, { actor: auditActor, request: actor.request ?? null }) : null;
    return { award, handoff };
  });
}

/**
 * The SGO decides not to award a scholarship for a booking routed to it: the handoff becomes "declined" (the business
 * hears only "declined"). The reason stays in the SGO's audit trail. Once an award was offered, revoke it instead.
 */
export async function declineAwardForHandoff(sgoOrgId: string, handoffId: string, input: { reason: string }, actor: AwardActor): Promise<HandoffRow> {
  const reason = reasonSchema.safeParse(input?.reason);
  if (!reason.success) validationError(reason.error, "Give a reason for declining.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await authorize(tx, actor, sgoOrgId);
    const [scoped] = await tx
      .select({ id: schema.handoffs.id })
      .from(schema.handoffs)
      .where(and(eq(schema.handoffs.id, typeof handoffId === "string" ? handoffId : ""), eq(schema.handoffs.sgoOrgId, sgoOrgId), eq(schema.handoffs.mode, actor.mode)))
      .limit(1);
    if (!scoped) throw notFound("Handoff");
    const auditActor = auditActorOf(actor);
    const handoff = await declineHandoffForSgo(tx, { handoffId: scoped.id, sgoOrgId, reasonCode: "sgo_declined", allowAwarded: false }, { actor: auditActor, request: actor.request ?? null });
    await audit(
      { actor: auditActor, orgId: sgoOrgId, action: "award.declined_for_handoff", target: { type: "handoff", id: scoped.id }, metadata: { reason: reason.data, mode: actor.mode }, request: actor.request ?? null },
      tx,
    );
    return handoff;
  });
}

const AWARD_TRANSITIONS: Readonly<Record<AwardStatus, readonly AwardStatus[]>> = Object.freeze({
  offered: ["accepted", "paid", "revoked"],
  accepted: ["paid", "revoked"],
  paid: [],
  declined: [],
  revoked: [],
});

/** Is `from → to` a legal award status change through updateAwardStatus? */
export function canChangeAwardStatus(from: AwardStatus, to: AwardStatus): boolean {
  return AWARD_TRANSITIONS[from].includes(to);
}

const updateSchema = z.strictObject({
  status: z.enum(["accepted", "paid", "revoked"], { error: "Choose accepted, paid or revoked." }),
  note: z.string().optional(),
});

/**
 * Records what happened to an award: accepted (the family took it up), paid (the SGO paid it under its own
 * procedures), or revoked (with a reason). Paid and revoked are final. Revoking an award whose booking is still
 * "awarded" declines that handoff; an award on a completed booking cannot be revoked here. Setting the current
 * status again changes nothing.
 */
export async function updateAwardStatus(sgoOrgId: string, awardId: string, input: { status: "accepted" | "paid" | "revoked"; note?: string }, actor: AwardActor): Promise<{ award: AwardRow; handoff: HandoffRow | null }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) validationError(parsed.error, "Check the award status.");
  const { status } = parsed.data;
  let note: string | null = null;
  if (status === "revoked") {
    const r = reasonSchema.safeParse(parsed.data.note);
    if (!r.success) validationError(r.error, "Give a reason for revoking the award.");
    note = r.data;
  } else if (parsed.data.note !== undefined) {
    const trimmed = parsed.data.note.replace(/\s+/g, " ").trim();
    if (trimmed.length > REASON_LENGTH.max) throw invalid(`Keep the note under ${REASON_LENGTH.max} characters.`, { fields: { note: `At most ${REASON_LENGTH.max} characters.` } });
    note = trimmed || null;
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    await authorize(tx, actor, sgoOrgId);
    const [row] = await tx
      .select({ award: schema.awards })
      .from(schema.awards)
      .innerJoin(schema.verifications, eq(schema.verifications.id, schema.awards.verificationId))
      .where(and(eq(schema.awards.id, typeof awardId === "string" ? awardId : ""), eq(schema.awards.orgId, sgoOrgId), eq(schema.verifications.mode, actor.mode)))
      .limit(1)
      .for("update", { of: schema.awards });
    if (!row) throw notFound("Award");
    const award = row.award;
    if (award.status === status) return { award, handoff: null };
    if (!canChangeAwardStatus(award.status, status)) throw conflict(`An award that is ${award.status} cannot become ${status}.`);

    const auditActor = auditActorOf(actor);
    let declineLinked = false;
    if (status === "revoked" && award.handoffId) {
      const [linked] = await tx.select({ status: schema.handoffs.status, awardId: schema.handoffs.awardId }).from(schema.handoffs).where(eq(schema.handoffs.id, award.handoffId)).limit(1);
      if (linked && linked.awardId === award.id) {
        if (linked.status === "completed" && !REVOKE_AFTER_COMPLETION_ALLOWED) {
          throw conflict("The business already completed this booking with the award. Contact the business and the platform team to unwind it.");
        }
        declineLinked = linked.status === "awarded";
      }
    }
    const [updated] = await tx.update(schema.awards).set({ status }).where(and(eq(schema.awards.id, award.id), eq(schema.awards.status, award.status))).returning();
    if (!updated) throw conflict("The award changed while this request was being handled. Try again.");
    // After the award row says "revoked", so the handoff.declined event no longer carries the award.
    const handoff =
      declineLinked && award.handoffId
        ? await declineHandoffForSgo(tx, { handoffId: award.handoffId, sgoOrgId, reasonCode: "award_revoked", allowAwarded: true }, { actor: auditActor, request: actor.request ?? null })
        : null;
    await audit(
      {
        actor: auditActor,
        orgId: sgoOrgId,
        action: `award.${status}`,
        target: { type: "award", id: award.id },
        metadata: { from: award.status, to: status, handoffId: award.handoffId, mode: actor.mode, ...(note ? { note } : {}) },
        request: actor.request ?? null,
      },
      tx,
    );
    return { award: updated, handoff };
  });
}

/* ------------------------------------------------------------------------------------------- reads */

export interface ListAwardsParams {
  mode: Mode;
  status?: AwardStatus;
  verificationId?: string;
  handoffId?: string;
  /** 1 to 200, default 50. */
  limit?: number;
  /** Cursor: the id of the last award of the previous page. */
  before?: string;
}

/** The SGO's awards, newest first, in one mode. Org-scoped read: callers guard access first. */
export async function listAwards(sgoOrgId: string, params: ListAwardsParams, dbOrTx?: DbOrTx): Promise<{ data: AwardRow[]; hasMore: boolean; nextCursor: string | null }> {
  if (params.mode !== "test" && params.mode !== "live") throw invalid("mode must be test or live");
  const limit = params.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalid("limit must be between 1 and 200");
  const db = dbOrTx ?? (await getDb());
  const a = schema.awards;
  const scope = and(eq(a.orgId, sgoOrgId), eq(schema.verifications.mode, params.mode));
  let cursor: SQL | undefined;
  if (params.before !== undefined) {
    const [c] = await db.select({ id: a.id, createdAt: a.createdAt }).from(a).innerJoin(schema.verifications, eq(schema.verifications.id, a.verificationId)).where(and(scope, eq(a.id, params.before))).limit(1);
    if (!c) throw badRequest("Unknown cursor: `before` must be the id of an award from the previous page");
    cursor = or(lt(a.createdAt, c.createdAt), and(eq(a.createdAt, c.createdAt), lt(a.id, c.id)));
  }
  const rows = await db
    .select({ award: a })
    .from(a)
    .innerJoin(schema.verifications, eq(schema.verifications.id, a.verificationId))
    .where(and(scope, params.status ? eq(a.status, params.status) : undefined, params.verificationId ? eq(a.verificationId, params.verificationId) : undefined, params.handoffId ? eq(a.handoffId, params.handoffId) : undefined, cursor))
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(limit + 1);
  const data = rows.slice(0, limit).map((r) => r.award);
  const hasMore = rows.length > limit;
  return { data, hasMore, nextCursor: hasMore ? data[data.length - 1].id : null };
}

export interface AwardContext {
  verification: { id: string; status: string; expiresAt: Date | null; provisional: boolean; awardable: boolean };
  /** The booking the award would be for, when the verification came from a handoff. */
  handoff: SgoHandoffView | null;
  /** The largest award allowed for that booking (its amount), or null when there is no booking amount. */
  maxAmountCents: number | null;
  reminders: ComplianceReminder[];
}

/**
 * What the SGO's award screen shows before deciding: whether the verification can take an award, the booking it
 * would fund, the amount ceiling and the compliance reminders (with the vendor-type caution where it applies).
 */
export async function getAwardContext(sgoOrgId: string, verificationId: string, opts: { mode: Mode; paymentMethod?: AwardPaymentMethod | null }, dbOrTx?: DbOrTx): Promise<AwardContext> {
  if (opts.mode !== "test" && opts.mode !== "live") throw invalid("mode must be test or live");
  const db = dbOrTx ?? (await getDb());
  const v = schema.verifications;
  const [verification] = await db
    .select({ id: v.id, status: v.status, expiresAt: v.expiresAt, provisional: v.provisional, handoffId: v.handoffId })
    .from(v)
    .where(and(eq(v.id, typeof verificationId === "string" ? verificationId : ""), eq(v.orgId, sgoOrgId), eq(v.mode, opts.mode)))
    .limit(1);
  if (!verification) throw notFound("Verification");
  const handoff = verification.handoffId ? await getHandoffForSgo(sgoOrgId, verification.handoffId, { mode: opts.mode }, db).catch(() => null) : null;
  const unexpired = !verification.expiresAt || verification.expiresAt.getTime() > now().getTime();
  const vendorType: VendorType | null = handoff ? handoff.business.vendorType : null;
  return {
    verification: {
      id: verification.id,
      status: verification.status,
      expiresAt: verification.expiresAt,
      provisional: verification.provisional,
      awardable: verification.status === "eligible" && unexpired && (handoff === null || (handoff.status === "eligible" && holdIsActive(handoff, now()))),
    },
    handoff,
    maxAmountCents: handoff?.booking.amountCents ?? null,
    reminders: awardComplianceReminders({ vendorType, paymentMethod: opts.paymentMethod }),
  };
}
