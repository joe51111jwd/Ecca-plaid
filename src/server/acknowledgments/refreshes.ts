import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { invalid } from "@/lib/errors";

/**
 * Refresh requests: donor/SGO/year combinations whose acknowledgment must be (re)generated because the year's total
 * or the data it prints changed (a gift, a refund, a donor number). Element (B) is the calendar-year total, so the
 * document is generated from the donations ledger at generation time and regenerated whenever the total changes.
 */

const { acknowledgmentRefreshes } = schema;

export type AcknowledgmentRefreshReason = "gift_succeeded" | "gift_refunded" | "correction";

export interface MarkAcknowledgmentStaleInput {
  orgId: string;
  donorId: string;
  taxYear: number;
  mode: Mode;
  reason: AcknowledgmentRefreshReason;
  /** The donation whose change prompted the request. */
  donationId?: string | null;
}

const markSchema = z.strictObject({
  orgId: z.string().min(1).max(100),
  donorId: z.string().min(1).max(100),
  taxYear: z.number().int().min(2000).max(2200),
  mode: z.enum(["test", "live"]),
  reason: z.enum(["gift_succeeded", "gift_refunded", "correction"]),
  donationId: z.string().min(1).max(100).nullish(),
});

/**
 * Records that the acknowledgment for this donor, SGO and calendar year must be generated or regenerated. Safe to
 * call repeatedly: one pending request per donor/SGO/year/mode, with the latest reason and time.
 */
export async function markAcknowledgmentStale(input: MarkAcknowledgmentStaleInput, dbOrTx?: DbOrTx): Promise<void> {
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid acknowledgment refresh request", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "input", i.message])) });
  const data = parsed.data;
  const at = now();
  const db = dbOrTx ?? (await getDb());
  await db
    .insert(acknowledgmentRefreshes)
    .values({ orgId: data.orgId, donorId: data.donorId, taxYear: data.taxYear, mode: data.mode, reason: data.reason, lastDonationId: data.donationId ?? null, requestedAt: at, resolvedAt: null })
    .onConflictDoUpdate({
      target: [acknowledgmentRefreshes.orgId, acknowledgmentRefreshes.donorId, acknowledgmentRefreshes.taxYear, acknowledgmentRefreshes.mode],
      set: { reason: data.reason, lastDonationId: data.donationId ?? null, requestedAt: at, resolvedAt: null },
    });
}

export type AcknowledgmentRefresh = typeof acknowledgmentRefreshes.$inferSelect;

/** Requests not yet resolved, oldest first (the generator's work list). */
export async function listPendingAcknowledgmentRefreshes(params: { mode: Mode; orgId?: string; taxYear?: number; limit?: number }, dbOrTx?: DbOrTx): Promise<AcknowledgmentRefresh[]> {
  const db = dbOrTx ?? (await getDb());
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 5000);
  const where = [eq(acknowledgmentRefreshes.mode, params.mode), isNull(acknowledgmentRefreshes.resolvedAt)];
  if (params.orgId) where.push(eq(acknowledgmentRefreshes.orgId, params.orgId));
  if (params.taxYear !== undefined) where.push(eq(acknowledgmentRefreshes.taxYear, params.taxYear));
  return db.select().from(acknowledgmentRefreshes).where(and(...where)).orderBy(asc(acknowledgmentRefreshes.requestedAt)).limit(limit);
}

/**
 * Marks a request resolved, but only if no newer request arrived after `requestedAt` (the time the generator read
 * it). Returns false when a newer request is pending, so the generator runs again.
 */
export async function resolveAcknowledgmentRefresh(key: { orgId: string; donorId: string; taxYear: number; mode: Mode; requestedAt: Date }, dbOrTx?: DbOrTx): Promise<boolean> {
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .update(acknowledgmentRefreshes)
    .set({ resolvedAt: now() })
    .where(
      and(
        eq(acknowledgmentRefreshes.orgId, key.orgId),
        eq(acknowledgmentRefreshes.donorId, key.donorId),
        eq(acknowledgmentRefreshes.taxYear, key.taxYear),
        eq(acknowledgmentRefreshes.mode, key.mode),
        eq(acknowledgmentRefreshes.requestedAt, key.requestedAt),
        isNull(acknowledgmentRefreshes.resolvedAt),
      ),
    )
    .returning({ donorId: acknowledgmentRefreshes.donorId });
  return rows.length > 0;
}

