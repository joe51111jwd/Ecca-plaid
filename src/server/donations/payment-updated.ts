import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { now } from "@/lib/clock";
import { AppError, isAppError } from "@/lib/errors";
import { markAcknowledgmentStale } from "@/server/acknowledgments";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { queueEmail } from "@/server/email";
import { emitEvent } from "@/server/events";
import { accrueDonationFees, voidDonationFees } from "@/server/fees";
import { enqueue } from "@/server/jobs";
import { getPayment, type PaymentSummary } from "@/server/payments";
import { getSetting } from "@/server/settings";
import { assertGiftAllowed, getListStatus, getSgoProfile, type GiftListSnapshot } from "@/server/sgos";
import { assessCreditEligibility, determineTaxYear, type FeeStructure, type GiftLines } from "@/taxmath";
import { toApiDonation } from "./api";
import { buildReceiptEmail } from "./receipt";
import { recomputeTotalsFor, type YearKey } from "./totals";
import { eligibilitySgoInput, type CheckoutListContext } from "./view";

/**
 * Handler of the "donation.payment_updated" job, which the payments service enqueues after every change to a
 * donation payment. It reads the payment's current state and brings the order's donations in line:
 *
 *   succeeded  donations succeeded; tax year from the charge time; credit eligibility re-assessed as of the charge
 *              with a fresh SGO-list snapshot; fees accrued; receipt emailed; donation.succeeded to the SGO;
 *              running totals and the large-donor advisory recomputed; acknowledgment marked for (re)generation
 *   failed     donations failed; the checkout reopens for another attempt
 *   canceled   donations canceled; the checkout reopens
 *   refunded   donations refunded; donation.refunded to the SGO; fees voided; totals and acknowledgment refreshed
 *
 * Idempotent under retries and duplicate jobs: every change happens under a row lock and only from a state that
 * allows it, and all side effects of one change are written in the same transaction as the change.
 */

const { donations, donors, checkoutSessions } = schema;
type DonationRow = typeof donations.$inferSelect;

const payloadSchema = z.object({ paymentId: z.string().min(1).max(100) });

export const DONATION_PAYMENT_UPDATED_JOB = "donation.payment_updated";

export async function handleDonationPaymentUpdated(payload: Record<string, unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("internal", "donation.payment_updated needs { paymentId }");
  const payment = await getPayment(parsed.data.paymentId);
  if (payment.purpose !== "donation") return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(donations).where(eq(donations.paymentId, payment.id)).orderBy(donations.taxpayerRole).for("update");
    // A payment that never got linked to an order (it was superseded or abandoned before linking) has nothing to update.
    if (rows.length === 0) return;
    switch (payment.status) {
      case "succeeded":
        await applySucceeded(tx, payment, rows);
        return;
      case "refunded": {
        // A refund can reach us before the success was processed; record the receipt of the money first, then its return.
        const succeeded = await applySucceeded(tx, payment, rows);
        await applyRefunded(tx, payment, succeeded);
        return;
      }
      case "failed":
        await applyUnpaid(tx, payment, rows, "failed");
        return;
      case "canceled":
        await applyUnpaid(tx, payment, rows, "canceled");
        return;
      default:
        return;
    }
  });
}

/* ------------------------------------------------------------------ succeeded */

async function listAtCharge(orgId: string, paidAt: Date, tx: DbOrTx): Promise<{ list: CheckoutListContext; snapshot: GiftListSnapshot | null }> {
  try {
    const snapshot = await assertGiftAllowed(orgId, paidAt, tx);
    return {
      snapshot,
      list: { status: snapshot.status, source: snapshot.source, label: snapshot.label, entryId: snapshot.entryId, listedFrom: snapshot.listedFrom, removedOn: snapshot.removedOn, retrievedAt: snapshot.retrievedAt, refusal: null },
    };
  } catch (e) {
    // The money has arrived whatever the list says now: record what the list showed at the charge, do not refuse.
    if (!isAppError(e) || e.code !== "conflict") throw e;
    const status = await getListStatus(orgId, paidAt, tx);
    const reason = (e.details as { reason?: string } | undefined)?.reason ?? "refused";
    return {
      snapshot: null,
      list: { status: status.status, source: status.source, label: status.label, entryId: status.entryId, listedFrom: status.listedFrom, removedOn: status.removedOn, retrievedAt: null, refusal: { reason, message: e.message } },
    };
  }
}

/** The fee rate recorded on the order (the checkout's stored gift lines), for the ledger row. */
function appliedFeeBps(preview: unknown): number {
  const fees = (preview as { fees?: Pick<GiftLines, "appliedFeeBps"> | null } | null)?.fees;
  return typeof fees?.appliedFeeBps === "number" ? fees.appliedFeeBps : 0;
}

async function applySucceeded(tx: DbOrTx, payment: PaymentSummary, rows: DonationRow[]): Promise<DonationRow[]> {
  const todo = rows.filter((r) => r.status !== "succeeded" && r.status !== "refunded");
  const done = rows.filter((r) => r.status === "succeeded");
  if (todo.length === 0) return done;
  const paidAt = payment.paidAt;
  if (!paidAt) throw new AppError("internal", `Payment ${payment.id} is ${payment.status} without a charge time`);

  const orgId = todo[0].orgId;
  const { org, profile } = await getSgoProfile(orgId, tx);
  const creditStartDate = await getSetting("credit.startDate", tx);
  const { list, snapshot } = await listAtCharge(orgId, paidAt, tx);
  const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, todo[0].checkoutSessionId)).for("update");
  const at = now();

  const updated: DonationRow[] = [];
  for (const row of todo) {
    const eligibility = assessCreditEligibility({
      paidAt,
      initiatedAt: row.designatedAt,
      creditStartDate,
      sgo: eligibilitySgoInput(list, profile.irsPortalRegistered),
      attestations: { individual: row.individualConfirmed, usCitizenOrResident: row.usCitizenOrResidentConfirmed, noEarmark: row.noEarmarkConfirmed, notInExchangeForScholarship: row.notInExchangeConfirmed },
      paymentMethod: payment.method ?? "unknown",
      currency: payment.currency,
      liveMode: row.mode === "live",
      donorTimeZone: row.donorTimeZone,
    });
    const year = determineTaxYear(paidAt, row.donorTimeZone);
    const relianceAtCharge = snapshot ? { ...snapshot } : { refused: list.refusal, status: list.status, source: list.source, label: list.label, entryId: list.entryId, removedOn: list.removedOn, checkedAt: paidAt.toISOString() };
    const [next] = await tx
      .update(donations)
      .set({
        status: "succeeded",
        contributedAt: paidAt,
        taxYear: year.taxYear,
        yearBoundaryAmbiguous: year.yearBoundaryAmbiguous,
        creditEligible: eligibility.creditEligible,
        creditIneligibleReason: eligibility.ineligibleReason,
        sgoListStatusAtGift: list.status,
        sgoListEntryIdAtGift: list.entryId,
        relianceAtCharge: relianceAtCharge as Record<string, unknown>,
        eligibilityAtCharge: JSON.parse(JSON.stringify(eligibility)) as Record<string, unknown>,
        failureReason: null,
        updatedAt: at,
      })
      .where(eq(donations.id, row.id))
      .returning();
    updated.push(next);
  }

  const structure = updated[0].feeStructure as FeeStructure;
  const bps = appliedFeeBps(session?.preview);
  await accrueDonationFees(updated, { structure, sgoFeeBps: structure === "sgo_invoiced" ? bps : 0, donorServiceFeeBps: structure === "donor_service_fee" ? bps : 0 }, tx);

  const keys: YearKey[] = updated.map((d) => ({ orgId: d.orgId, donorId: d.donorId, taxYear: d.taxYear as number, mode: d.mode }));
  await recomputeTotalsFor(keys, tx);
  for (const d of updated) {
    await markAcknowledgmentStale({ orgId: d.orgId, donorId: d.donorId, taxYear: d.taxYear as number, mode: d.mode, reason: "gift_succeeded", donationId: d.id }, tx);
  }

  const donorRows = await tx.select().from(donors).where(inArray(donors.id, updated.map((d) => d.donorId)));
  const donorById = new Map(donorRows.map((d) => [d.id, d]));
  const all = [...done, ...updated].sort((a, b) => a.taxpayerRole.localeCompare(b.taxpayerRole));
  const eligibilityOf = (d: DonationRow) => d.eligibilityAtCharge as { creditEligible?: boolean; blockers?: Array<{ message: string }> } | null;

  const first = updated[0];
  const receipt = buildReceiptEmail({
    mode: first.mode,
    sgoName: profile.displayName,
    sgoEin: profile.ein,
    paymentId: payment.id,
    paidAt,
    donorTimeZone: first.donorTimeZone,
    donations: all.map((d) => {
      const donor = donorById.get(d.donorId);
      return {
        role: d.taxpayerRole,
        fullName: donor ? [donor.firstName, donor.middleName, donor.lastName, donor.suffix].filter(Boolean).join(" ") : "",
        designatedCents: d.designatedAmountCents,
        nonDesignatedCents: d.nonDesignatedAmountCents,
      };
    }),
    serviceFeeCents: all.reduce((sum, d) => sum + d.donorServiceFeeCents, 0),
    chargedCents: payment.amountCents,
    designationText: first.designationText,
    creditEligible: eligibilityOf(first)?.creditEligible === true,
    blockers: eligibilityOf(first)?.blockers ?? [],
  });
  const firstDonor = donorById.get(first.donorId);
  const to = session?.email ?? firstDonor?.email;
  let receiptEmailId: string | null = null;
  if (to && done.length === 0) {
    const email = await queueEmail({ to, subject: receipt.subject, template: "donation_receipt", html: receipt.html, text: receipt.text, related: { type: "payment", id: payment.id } }, tx);
    await enqueue("email.send", { emailId: email.id }, { dedupeKey: `email.send:${email.id}` }, tx);
    receiptEmailId = email.id;
  }

  const result: DonationRow[] = [...done];
  for (const d of updated) {
    let row = d;
    if (receiptEmailId) {
      [row] = await tx.update(donations).set({ receiptEmailId }).where(eq(donations.id, d.id)).returning();
    }
    const donor = donorById.get(row.donorId);
    if (!donor) throw new AppError("internal", `Donor ${row.donorId} of donation ${row.id} is missing`);
    await emitEvent({ orgId: row.orgId, type: "donation.succeeded", payload: toApiDonation(row, donor) as unknown as Record<string, unknown>, mode: row.mode }, tx);
    await audit(
      {
        actor: SYSTEM_ACTOR,
        orgId: row.orgId,
        action: "donation.succeeded",
        target: { type: "donation", id: row.id },
        metadata: { paymentId: payment.id, taxYear: row.taxYear, creditEligible: row.creditEligible, yearBoundaryAmbiguous: row.yearBoundaryAmbiguous, listStatusAtGift: row.sgoListStatusAtGift },
      },
      tx,
    );
    result.push(row);
  }

  if (session && session.paymentId === payment.id && session.status !== "completed") {
    await tx.update(checkoutSessions).set({ status: "completed", completedAt: at }).where(eq(checkoutSessions.id, session.id));
  }
  void org;
  return result;
}

/* ------------------------------------------------------------------ refunded */

async function applyRefunded(tx: DbOrTx, payment: PaymentSummary, rows: DonationRow[]): Promise<void> {
  const todo = rows.filter((r) => r.status === "succeeded");
  if (todo.length === 0) return;
  const at = now();
  const refundedAt = payment.refundedAt ?? at;
  const updated: DonationRow[] = [];
  for (const row of todo) {
    const [next] = await tx.update(donations).set({ status: "refunded", refundedAt, updatedAt: at }).where(eq(donations.id, row.id)).returning();
    updated.push(next);
  }
  await voidDonationFees(updated.map((d) => d.id), "The payment for this gift was refunded.", tx);
  const keys: YearKey[] = updated.filter((d) => d.taxYear !== null).map((d) => ({ orgId: d.orgId, donorId: d.donorId, taxYear: d.taxYear as number, mode: d.mode }));
  await recomputeTotalsFor(keys, tx);
  for (const key of keys) await markAcknowledgmentStale({ ...key, reason: "gift_refunded", donationId: updated.find((d) => d.donorId === key.donorId)?.id ?? null }, tx);
  const donorRows = await tx.select().from(donors).where(inArray(donors.id, updated.map((d) => d.donorId)));
  for (const row of updated) {
    const donor = donorRows.find((d) => d.id === row.donorId);
    if (!donor) throw new AppError("internal", `Donor ${row.donorId} of donation ${row.id} is missing`);
    await emitEvent({ orgId: row.orgId, type: "donation.refunded", payload: toApiDonation(row, donor) as unknown as Record<string, unknown>, mode: row.mode }, tx);
    await audit({ actor: SYSTEM_ACTOR, orgId: row.orgId, action: "donation.refunded", target: { type: "donation", id: row.id }, metadata: { paymentId: payment.id, taxYear: row.taxYear } }, tx);
  }
}

/* ------------------------------------------------------------------ failed / canceled */

async function applyUnpaid(tx: DbOrTx, payment: PaymentSummary, rows: DonationRow[], to: "failed" | "canceled"): Promise<void> {
  const from: ReadonlyArray<DonationRow["status"]> = to === "failed" ? ["pending"] : ["pending", "failed"];
  const todo = rows.filter((r) => from.includes(r.status));
  const at = now();
  for (const row of todo) {
    await tx
      .update(donations)
      .set({ status: to, failureReason: to === "failed" ? (payment.failureReason ?? "The payment could not be completed.") : row.failureReason, updatedAt: at })
      .where(eq(donations.id, row.id));
    await audit({ actor: SYSTEM_ACTOR, orgId: row.orgId, action: `donation.${to}`, target: { type: "donation", id: row.id }, metadata: { paymentId: payment.id, failureReason: payment.failureReason } }, tx);
  }
  // Reopen the checkout for another attempt, but only if this payment is still the checkout's current one.
  const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, rows[0].checkoutSessionId)).for("update");
  if (session && session.paymentId === payment.id && session.status === "awaiting_payment") {
    await tx.update(checkoutSessions).set({ status: "open", lastActivityAt: at }).where(eq(checkoutSessions.id, session.id));
  }
}
