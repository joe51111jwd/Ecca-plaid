import { and, eq, ne } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { centralDateString, now } from "@/lib/clock";
import { AppError, conflict, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { formatUsd, mulDivRound } from "@/lib/money";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { formatBps, SUCCESS_FEE_LIMITS } from "@/server/businesses";

/**
 * The success fee a business owes for a booking completed with scholarship funds.
 *
 * The business pays, on its own account (spec, Business model §2). This file deliberately reads only the business's
 * profile and the handoff's booking fields (reference, amount, completion time): nothing about the household, the
 * family's contact details, donations, awards or scholarship payments. The fee is never netted from scholarship
 * funds because nothing here can see them.
 */

export type FeeLedgerRow = typeof schema.feeLedger.$inferSelect;

export interface SuccessFeeTerms {
  flatCents: number;
  bps: number;
}

/**
 * flat + bps × booking amount / 10,000, in integer cents. POLICY: the percentage part is rounded half-up to the cent
 * (the spec sets no rounding rule). With no booking amount only the flat part applies.
 */
export function computeSuccessFeeCents(terms: SuccessFeeTerms, bookingAmountCents: number | null): number {
  const { flatCents, bps } = terms;
  if (!Number.isSafeInteger(flatCents) || flatCents < 0 || flatCents > SUCCESS_FEE_LIMITS.maxFlatCents) throw new AppError("internal", `Invalid flat success fee: ${flatCents}`);
  if (!Number.isInteger(bps) || bps < 0 || bps > SUCCESS_FEE_LIMITS.maxBps) throw new AppError("internal", `Invalid success fee basis points: ${bps}`);
  if (bookingAmountCents !== null && (!Number.isSafeInteger(bookingAmountCents) || bookingAmountCents < 0)) throw new AppError("internal", `Invalid booking amount: ${bookingAmountCents}`);
  const pct = bookingAmountCents === null || bps === 0 ? 0 : mulDivRound(bookingAmountCents, bps, 10_000);
  return flatCents + pct;
}

/** "Success fee for booking CAMP-123 (completed 2026-11-18): $25 flat + 2.5% of $450". Business data only. */
export function describeSuccessFee(input: { bookingRef: string; completedAt: Date; terms: SuccessFeeTerms; bookingAmountCents: number | null }): string {
  const parts: string[] = [];
  if (input.terms.flatCents > 0) parts.push(`${formatUsd(input.terms.flatCents)} flat`);
  if (input.terms.bps > 0 && input.bookingAmountCents !== null) parts.push(`${formatBps(input.terms.bps)} of ${formatUsd(input.bookingAmountCents)}`);
  const ref = input.bookingRef.length > 100 ? `${input.bookingRef.slice(0, 99)}…` : input.bookingRef;
  return `Success fee for booking ${ref} (completed ${centralDateString(input.completedAt)}): ${parts.join(" + ")}`;
}

/**
 * Records the success fee for a completed handoff, under the business's fee terms at that moment. Idempotent: a
 * handoff has at most one live (not void) success-fee row, and a second call returns it. A zero fee writes no row
 * and returns null. Throws if the payer is not an organization of type "business" (never a family, never an SGO).
 *
 * Pass the transaction that completes the handoff so the fee and the completion commit together.
 */
export async function accrueSuccessFee(handoffId: string, dbOrTx?: DbOrTx): Promise<FeeLedgerRow | null> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const h = schema.handoffs;
    const [handoff] = await tx
      .select({ id: h.id, businessOrgId: h.businessOrgId, mode: h.mode, status: h.status, bookingRef: h.bookingRef, bookingAmountCents: h.bookingAmountCents, completedAt: h.completedAt })
      .from(h)
      .where(eq(h.id, handoffId))
      .limit(1)
      .for("update");
    if (!handoff) throw notFound("Handoff");
    if (handoff.status !== "completed" || !handoff.completedAt) throw conflict("A success fee is owed only for a completed booking.");

    const fl = schema.feeLedger;
    const [existing] = await tx
      .select()
      .from(fl)
      .where(and(eq(fl.handoffId, handoff.id), eq(fl.kind, "business_success_fee"), ne(fl.status, "void")))
      .limit(1);
    if (existing) return existing;

    const [payer] = await tx
      .select({ type: schema.organizations.type, flatCents: schema.businessProfiles.successFeeFlatCents, bps: schema.businessProfiles.successFeeBps })
      .from(schema.organizations)
      .innerJoin(schema.businessProfiles, eq(schema.businessProfiles.orgId, schema.organizations.id))
      .where(eq(schema.organizations.id, handoff.businessOrgId))
      .limit(1);
    if (!payer || payer.type !== "business") throw new AppError("internal", "A success fee can only be owed by an organization of type business.");

    const terms = { flatCents: payer.flatCents, bps: payer.bps };
    const amountCents = computeSuccessFeeCents(terms, handoff.bookingAmountCents);
    if (amountCents === 0) return null;

    const [row] = await tx
      .insert(fl)
      .values({
        id: newId("fee"),
        payerOrgId: handoff.businessOrgId,
        kind: "business_success_fee",
        mode: handoff.mode,
        amountCents,
        status: "accrued",
        handoffId: handoff.id,
        description: describeSuccessFee({ bookingRef: handoff.bookingRef, completedAt: handoff.completedAt, terms, bookingAmountCents: handoff.bookingAmountCents }),
        feeBps: terms.bps,
        baseCents: handoff.bookingAmountCents,
        createdAt: now(),
      })
      .returning();
    await audit(
      {
        actor: SYSTEM_ACTOR,
        orgId: handoff.businessOrgId,
        action: "fee.accrued",
        target: { type: "fee_ledger", id: row.id },
        metadata: { kind: "business_success_fee", handoffId: handoff.id, amountCents, flatCents: terms.flatCents, bps: terms.bps, baseCents: handoff.bookingAmountCents, mode: handoff.mode },
      },
      tx,
    );
    return row;
  });
}
