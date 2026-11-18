import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { invalid } from "@/lib/errors";

/**
 * Acknowledgments: the SGO's official written acknowledgment to each donor, per SGO, per calendar year
 * (Temp. Treas. Reg. 1.25F-4T(c)(1); acknowledgment-reporting.md E1), and the unique donor numbers it carries.
 *
 * This file is the domain's public API. Today it holds the hooks the donations service needs: marking a
 * donor/SGO/year as needing a (re)generated acknowledgment after money arrives or is returned, and the status reads
 * the SGO dashboard and the donor's page show. Element (B) of the acknowledgment is the calendar-year total, so the
 * document is generated from the donations ledger at generation time and regenerated whenever the total changes.
 */

const { acknowledgmentRefreshes, acknowledgments, donorNumbers } = schema;

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

/* ------------------------------------------------------------------ status reads */

export type AcknowledgmentStatus = "not_generated" | "draft" | "issued" | "superseded" | "blocked";

export interface AcknowledgmentSummary {
  status: AcknowledgmentStatus;
  /** Latest version's id and number, when one exists. */
  acknowledgmentId: string | null;
  version: number | null;
  issuedAt: Date | null;
  deliveredAt: Date | null;
  delivery: "email" | "paper_required" | null;
  blockedReason: string | null;
  pdfObjectId: string | null;
  /** A gift or refund changed the year's total after the latest version (or no version exists yet). */
  needsRegeneration: boolean;
}

export interface StatusScope {
  orgId: string;
  mode: Mode;
  taxYear: number;
  donorIds: readonly string[];
}

/** The latest acknowledgment of each donor for one SGO and calendar year. */
export async function acknowledgmentSummaries(scope: StatusScope, dbOrTx?: DbOrTx): Promise<Map<string, AcknowledgmentSummary>> {
  const out = new Map<string, AcknowledgmentSummary>();
  if (scope.donorIds.length === 0) return out;
  const db = dbOrTx ?? (await getDb());
  const ids = [...new Set(scope.donorIds)];
  const rows = await db
    .select()
    .from(acknowledgments)
    .where(and(eq(acknowledgments.orgId, scope.orgId), eq(acknowledgments.mode, scope.mode), eq(acknowledgments.taxYear, scope.taxYear), inArray(acknowledgments.donorId, ids)))
    .orderBy(desc(acknowledgments.version));
  const pending = await db
    .select({ donorId: acknowledgmentRefreshes.donorId })
    .from(acknowledgmentRefreshes)
    .where(
      and(
        eq(acknowledgmentRefreshes.orgId, scope.orgId),
        eq(acknowledgmentRefreshes.mode, scope.mode),
        eq(acknowledgmentRefreshes.taxYear, scope.taxYear),
        inArray(acknowledgmentRefreshes.donorId, ids),
        isNull(acknowledgmentRefreshes.resolvedAt),
      ),
    );
  const stale = new Set(pending.map((p) => p.donorId));
  for (const donorId of ids) {
    const latest = rows.find((r) => r.donorId === donorId);
    out.set(donorId, {
      status: latest?.status ?? "not_generated",
      acknowledgmentId: latest?.id ?? null,
      version: latest?.version ?? null,
      issuedAt: latest?.issuedAt ?? null,
      deliveredAt: latest?.deliveredAt ?? null,
      delivery: latest?.delivery ?? null,
      blockedReason: latest?.blockedReason ?? null,
      pdfObjectId: latest?.pdfObjectId ?? null,
      needsRegeneration: stale.has(donorId),
    });
  }
  return out;
}

/**
 * - assigned:                 a number entered or imported from the IRS SGO portal.
 * - sandbox:                  a test-mode number, not valid for filing.
 * - pending_sgo_registration: the SGO has not registered in the IRS SGO portal, so it cannot create numbers yet.
 * - not_assigned:             the SGO is registered but has not recorded this donor's number.
 */
export type DonorNumberStatus = "assigned" | "sandbox" | "pending_sgo_registration" | "not_assigned";

export interface DonorNumberSummary {
  status: DonorNumberStatus;
  number: string | null;
  source: "irs_portal_entered" | "irs_portal_import" | "sandbox_generated" | null;
  assignedAt: Date | null;
}

/** Each donor's unique donor number for one SGO and calendar year. Never invents one. */
export async function donorNumberSummaries(scope: StatusScope & { sgoPortalRegistered: boolean }, dbOrTx?: DbOrTx): Promise<Map<string, DonorNumberSummary>> {
  const out = new Map<string, DonorNumberSummary>();
  if (scope.donorIds.length === 0) return out;
  const db = dbOrTx ?? (await getDb());
  const ids = [...new Set(scope.donorIds)];
  const rows = await db
    .select()
    .from(donorNumbers)
    .where(and(eq(donorNumbers.orgId, scope.orgId), eq(donorNumbers.mode, scope.mode), eq(donorNumbers.taxYear, scope.taxYear), inArray(donorNumbers.donorId, ids)));
  for (const donorId of ids) {
    const row = rows.find((r) => r.donorId === donorId);
    if (row) {
      out.set(donorId, { status: row.source === "sandbox_generated" ? "sandbox" : "assigned", number: row.number, source: row.source, assignedAt: row.assignedAt });
    } else {
      out.set(donorId, { status: scope.sgoPortalRegistered ? "not_assigned" : "pending_sgo_registration", number: null, source: null, assignedAt: null });
    }
  }
  return out;
}
