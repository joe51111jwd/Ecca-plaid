import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { audit, type AuditRequestInfo } from "@/server/audit";
import { isPlatformAdmin } from "@/server/auth";
import { refundPayment, type PaymentSummary } from "@/server/payments";
import { COUNSEL_REFERENCE_MIN_LENGTH, REFUND_REASON_MIN_LENGTH } from "./policy";

/**
 * There is no self-serve refund and no "un-designate": a designation is irrevocable (Temp. Treas. Reg.
 * 1.25F-1T(a)(12)) and whether a designated gift may be refunded at all is NOT IN SOURCES (donor-credit-rules.md
 * Engineering Implications 8). The only path is an operator refund: a platform admin, a written reason and the
 * reference of counsel's advice, all audited. Refunds are whole-payment only (payments policy), so a joint gift is
 * returned for both spouses together. The donations follow when the processor reports the refund (the
 * "donation.payment_updated" job), so totals only ever reflect money actually received.
 */

const inputSchema = z.strictObject({
  donationId: z.string().min(1).max(100),
  actorUserId: z.string().min(1).max(100),
  reason: z.string().trim().min(REFUND_REASON_MIN_LENGTH, `Give a reason of at least ${REFUND_REASON_MIN_LENGTH} characters.`).max(1000),
  counselReference: z.string().trim().min(COUNSEL_REFERENCE_MIN_LENGTH, "Record the reference of counsel's advice for this refund.").max(500),
  request: z.custom<AuditRequestInfo | null | undefined>().optional(),
});

export type RecordOperatorRefundInput = z.input<typeof inputSchema>;

export interface OperatorRefundResult {
  paymentId: string;
  /** Every donation the payment carried (both spouses on a joint gift). */
  donationIds: string[];
  /** "pending" when the processor has not completed the refund yet; the donations stay succeeded until it does. */
  refundStatus: "succeeded" | "pending";
  payment: PaymentSummary;
}

export async function recordOperatorRefund(input: RecordOperatorRefundInput): Promise<OperatorRefundResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw invalid("A refund needs the donation, the operator, a written reason and counsel's reference.", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "input", i.message])) });
  const data = parsed.data;
  const db = await getDb();
  if (!(await isPlatformAdmin(data.actorUserId, db))) throw forbidden("Only a platform administrator can refund a designated gift.");

  const [donation] = await db.select().from(schema.donations).where(eq(schema.donations.id, data.donationId));
  if (!donation) throw notFound("Donation");
  if (!donation.paymentId) throw conflict("This donation has no payment to refund.");
  if (donation.status !== "succeeded") throw conflict(`Only a succeeded gift can be refunded; this one is ${donation.status}.`);
  const siblings = await db.select({ id: schema.donations.id }).from(schema.donations).where(eq(schema.donations.paymentId, donation.paymentId));
  const donationIds = siblings.map((s) => s.id);

  // Recorded before the processor is called, so the decision is on file even if the call never returns.
  await audit(
    {
      actor: { type: "user", id: data.actorUserId },
      orgId: donation.orgId,
      action: "donation.refund_requested",
      target: { type: "donation", id: donation.id },
      metadata: { paymentId: donation.paymentId, donationIds, reason: data.reason, counselReference: data.counselReference, mode: donation.mode },
      request: data.request ?? null,
    },
    db,
  );
  const result = await refundPayment({
    paymentId: donation.paymentId,
    operatorOverride: true,
    reason: `${data.reason} (counsel reference: ${data.counselReference})`,
    actorUserId: data.actorUserId,
    request: data.request ?? null,
  });
  await audit(
    {
      actor: { type: "user", id: data.actorUserId },
      orgId: donation.orgId,
      action: "donation.refund_issued",
      target: { type: "donation", id: donation.id },
      metadata: { paymentId: donation.paymentId, donationIds, refundStatus: result.refund.status, counselReference: data.counselReference },
      request: data.request ?? null,
    },
    db,
  );
  return { paymentId: donation.paymentId, donationIds, refundStatus: result.refund.status, payment: result.payment };
}
