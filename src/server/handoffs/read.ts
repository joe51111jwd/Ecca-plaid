import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { HandoffStatus, Mode, VendorType } from "@/db/schema";
import { badRequest, invalid, notFound } from "@/lib/errors";
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "./policy";
import { toApiHandoff, type ApiHandoff, type HandoffRelated, type HandoffRow } from "./serialize";
import { HANDOFF_STATUSES, isHandoffStatus, publicVerificationStatus, type PublicVerificationStatus } from "./state";

/**
 * Read models for the business portal, the business API and the SGO dashboard. Org-scoped reads: callers guard
 * access first (requireOrgMember / authenticateApiKey). Every query filters on the organization AND the mode, so
 * another tenant's handoff, or one of the other mode, is simply not found.
 */

export interface HandoffRecord {
  handoff: HandoffRow;
  related: HandoffRelated;
}

export interface ListHandoffsParams {
  mode: Mode;
  status?: HandoffStatus;
  /** 1 to LIST_LIMIT_MAX, default LIST_LIMIT_DEFAULT. */
  limit?: number;
  /** Cursor: the id of the last handoff of the previous page. */
  before?: string;
}

export interface HandoffPage {
  data: HandoffRecord[];
  hasMore: boolean;
  nextCursor: string | null;
}

function assertMode(mode: unknown): asserts mode is Mode {
  if (mode !== "test" && mode !== "live") throw invalid("mode must be test or live");
}

function limitOf(limit: number | undefined): number {
  if (limit === undefined) return LIST_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) throw invalid(`limit must be between 1 and ${LIST_LIMIT_MAX}`);
  return limit;
}

const h = schema.handoffs;

function selectRecords(db: DbOrTx) {
  return db
    .select({
      handoff: h,
      verificationStatus: schema.verifications.status,
      awardAmountCents: schema.awards.amountCents,
      awardPaymentMethod: schema.awards.paymentMethod,
      awardStatus: schema.awards.status,
      sgoName: schema.sgoProfiles.displayName,
    })
    .from(h)
    .leftJoin(schema.verifications, eq(schema.verifications.id, h.verificationId))
    .leftJoin(schema.awards, eq(schema.awards.id, h.awardId))
    .leftJoin(schema.sgoProfiles, eq(schema.sgoProfiles.orgId, h.sgoOrgId));
}

type RawRecord = Awaited<ReturnType<ReturnType<typeof selectRecords>["where"]>>[number];

function toRecord(r: RawRecord): HandoffRecord {
  return {
    handoff: r.handoff,
    related: {
      verificationStatus: r.verificationStatus ?? null,
      award: r.awardAmountCents !== null && r.awardPaymentMethod !== null && r.awardStatus !== null ? { amountCents: r.awardAmountCents, paymentMethod: r.awardPaymentMethod, status: r.awardStatus } : null,
      sgoName: r.sgoName ?? null,
    },
  };
}

async function page(db: DbOrTx, scope: SQL, params: ListHandoffsParams): Promise<HandoffPage> {
  assertMode(params.mode);
  const limit = limitOf(params.limit);
  if (params.status !== undefined && !isHandoffStatus(params.status)) throw invalid(`status must be one of ${HANDOFF_STATUSES.join(", ")}`);
  let cursor: SQL | undefined;
  if (params.before !== undefined) {
    const [c] = await db.select({ id: h.id, createdAt: h.createdAt }).from(h).where(and(scope, eq(h.id, params.before), eq(h.mode, params.mode))).limit(1);
    if (!c) throw badRequest("Unknown cursor: `before` must be the id of a handoff from the previous page");
    cursor = or(lt(h.createdAt, c.createdAt), and(eq(h.createdAt, c.createdAt), lt(h.id, c.id)));
  }
  const rows = await selectRecords(db)
    .where(and(scope, eq(h.mode, params.mode), params.status ? eq(h.status, params.status) : undefined, cursor))
    .orderBy(desc(h.createdAt), desc(h.id))
    .limit(limit + 1);
  const data = rows.slice(0, limit).map(toRecord);
  const hasMore = rows.length > limit;
  return { data, hasMore, nextCursor: hasMore ? data[data.length - 1].handoff.id : null };
}

/** The business's handoffs, newest first. */
export async function listHandoffs(businessOrgId: string, params: ListHandoffsParams, dbOrTx?: DbOrTx): Promise<HandoffPage> {
  const db = dbOrTx ?? (await getDb());
  return page(db, eq(h.businessOrgId, businessOrgId), params);
}

/** One of the business's handoffs; `not_found` for another business's or the other mode's. */
export async function getHandoff(businessOrgId: string, handoffId: string, opts: { mode: Mode }, dbOrTx?: DbOrTx): Promise<HandoffRecord> {
  assertMode(opts.mode);
  if (typeof handoffId !== "string" || handoffId.length === 0 || handoffId.length > 128) throw notFound("Handoff");
  const db = dbOrTx ?? (await getDb());
  const [row] = await selectRecords(db)
    .where(and(eq(h.id, handoffId), eq(h.businessOrgId, businessOrgId), eq(h.mode, opts.mode)))
    .limit(1);
  if (!row) throw notFound("Handoff");
  return toRecord(row);
}

/** Convenience: the API representation of a record. */
export function recordToApi(record: HandoffRecord): ApiHandoff {
  return toApiHandoff(record.handoff, record.related);
}

/* ------------------------------------------------------------------------------------------ SGO side */

/**
 * What an SGO sees about a handoff routed to it: the booking it may fund (business, vendor type, reference,
 * description, amount and whether the business confirmed it), the hold, and the linked verification and award.
 * The family's contact details stay on the SGO's own verification record.
 */
export interface SgoHandoffView {
  id: string;
  mode: Mode;
  status: HandoffStatus;
  business: { orgId: string; displayName: string; vendorType: VendorType; website: string | null };
  booking: { ref: string; description: string | null; amountCents: number | null; amountConfirmed: boolean };
  holdExpiresAt: Date | null;
  verificationId: string | null;
  verificationStatus: PublicVerificationStatus;
  award: HandoffRelated["award"] & { id: string } | null;
  createdAt: Date;
}

function selectSgoViews(db: DbOrTx) {
  return db
    .select({
      handoff: h,
      business: { orgId: schema.businessProfiles.orgId, displayName: schema.businessProfiles.displayName, vendorType: schema.businessProfiles.vendorType, website: schema.businessProfiles.website },
      verificationStatus: schema.verifications.status,
      awardId: schema.awards.id,
      awardAmountCents: schema.awards.amountCents,
      awardPaymentMethod: schema.awards.paymentMethod,
      awardStatus: schema.awards.status,
    })
    .from(h)
    .innerJoin(schema.businessProfiles, eq(schema.businessProfiles.orgId, h.businessOrgId))
    .leftJoin(schema.verifications, eq(schema.verifications.id, h.verificationId))
    .leftJoin(schema.awards, eq(schema.awards.id, h.awardId));
}

type RawSgoView = Awaited<ReturnType<ReturnType<typeof selectSgoViews>["where"]>>[number];

function toSgoView(r: RawSgoView): SgoHandoffView {
  return {
    id: r.handoff.id,
    mode: r.handoff.mode,
    status: r.handoff.status,
    business: r.business,
    booking: { ref: r.handoff.bookingRef, description: r.handoff.bookingDescription, amountCents: r.handoff.bookingAmountCents, amountConfirmed: r.handoff.bookingAmountConfirmed },
    holdExpiresAt: r.handoff.holdExpiresAt,
    verificationId: r.handoff.verificationId,
    verificationStatus: publicVerificationStatus(r.verificationStatus),
    award:
      r.awardId !== null && r.awardAmountCents !== null && r.awardPaymentMethod !== null && r.awardStatus !== null
        ? { id: r.awardId, amountCents: r.awardAmountCents, paymentMethod: r.awardPaymentMethod, status: r.awardStatus }
        : null,
    createdAt: r.handoff.createdAt,
  };
}

/** Handoffs routed to this SGO, newest first. An SGO never sees handoffs routed elsewhere or not yet routed. */
export async function listHandoffsForSgo(sgoOrgId: string, params: { mode: Mode; status?: HandoffStatus; limit?: number }, dbOrTx?: DbOrTx): Promise<SgoHandoffView[]> {
  assertMode(params.mode);
  const limit = limitOf(params.limit);
  if (params.status !== undefined && !isHandoffStatus(params.status)) throw invalid(`status must be one of ${HANDOFF_STATUSES.join(", ")}`);
  const db = dbOrTx ?? (await getDb());
  const rows = await selectSgoViews(db)
    .where(and(eq(h.sgoOrgId, sgoOrgId), eq(h.mode, params.mode), params.status ? eq(h.status, params.status) : undefined))
    .orderBy(desc(h.createdAt), desc(h.id))
    .limit(limit);
  return rows.map(toSgoView);
}

/** One handoff routed to this SGO; `not_found` otherwise. */
export async function getHandoffForSgo(sgoOrgId: string, handoffId: string, opts: { mode: Mode }, dbOrTx?: DbOrTx): Promise<SgoHandoffView> {
  assertMode(opts.mode);
  if (typeof handoffId !== "string" || handoffId.length === 0 || handoffId.length > 128) throw notFound("Handoff");
  const db = dbOrTx ?? (await getDb());
  const [row] = await selectSgoViews(db)
    .where(and(eq(h.id, handoffId), eq(h.sgoOrgId, sgoOrgId), eq(h.mode, opts.mode)))
    .limit(1);
  if (!row) throw notFound("Handoff");
  return toSgoView(row);
}

/* ------------------------------------------------------------------------------------------ stats */

export interface HandoffConversionStats {
  mode: Mode;
  since: Date | null;
  total: number;
  byStatus: Record<HandoffStatus, number>;
  /** Handoffs whose household verified eligible at some point (eligible, awarded or completed). */
  reachedEligible: number;
  /** Bookings completed with scholarship funds. */
  completed: number;
  /** completed / total, in basis points (integer; 0 when there are none). */
  completionRateBps: number;
  /** completed / reachedEligible, in basis points. */
  eligibleToCompletedBps: number;
}

function ratioBps(num: number, den: number): number {
  return den === 0 ? 0 : Math.floor((num * 10_000) / den);
}

/** Funnel counts for the business portal. `since` limits to handoffs created at or after it. */
export async function handoffConversionStats(businessOrgId: string, opts: { mode: Mode; since?: Date }, dbOrTx?: DbOrTx): Promise<HandoffConversionStats> {
  assertMode(opts.mode);
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select({ status: h.status, n: sql<number>`count(*)::int` })
    .from(h)
    .where(and(eq(h.businessOrgId, businessOrgId), eq(h.mode, opts.mode), opts.since ? gte(h.createdAt, opts.since) : undefined))
    .groupBy(h.status);
  const byStatus = Object.fromEntries(HANDOFF_STATUSES.map((s) => [s, 0])) as Record<HandoffStatus, number>;
  for (const r of rows) byStatus[r.status] = Number(r.n);
  const total = HANDOFF_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);
  const reachedEligible = byStatus.eligible + byStatus.awarded + byStatus.completed;
  return {
    mode: opts.mode,
    since: opts.since ?? null,
    total,
    byStatus,
    reachedEligible,
    completed: byStatus.completed,
    completionRateBps: ratioBps(byStatus.completed, total),
    eligibleToCompletedBps: ratioBps(byStatus.completed, reachedEligible),
  };
}
