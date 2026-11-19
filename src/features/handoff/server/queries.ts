/**
 * Read models for the business portal that no service exposes as such: the directory of SGOs accepting handoffs
 * (to request a partnership), holds expiring soon, and a handoff's timeline. Org-scoped: callers have passed
 * requirePortalPage for `businessOrgId` first, and every query filters on it (and on the mode).
 */
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { HandoffStatus, Mode } from "@/db/schema";
import { listAuditLogs, AUDIT_PAGE_MAX } from "@/server/audit";
import { HOLDING_STATUSES } from "@/server/handoffs";
import { EXPIRING_LIST_LIMIT, EXPIRING_SOON_MS } from "../policy";
import { timelineFromAudit, type TimelineEntry } from "../portal";

export interface HandoffSgoOption {
  orgId: string;
  displayName: string;
  website: string | null;
}

/** Active scholarship organizations whose profile accepts applicants from booking handoffs, by name. */
export async function listSgosAcceptingHandoffs(dbOrTx?: DbOrTx): Promise<HandoffSgoOption[]> {
  const db = dbOrTx ?? (await getDb());
  const o = schema.organizations;
  const p = schema.sgoProfiles;
  return db
    .select({ orgId: p.orgId, displayName: p.displayName, website: p.website })
    .from(p)
    .innerJoin(o, eq(o.id, p.orgId))
    .where(and(eq(o.type, "sgo"), eq(o.status, "active"), eq(p.acceptsHandoffs, true)))
    .orderBy(asc(p.displayName), asc(p.orgId));
}

export interface ExpiringHold {
  id: string;
  status: HandoffStatus;
  bookingRef: string;
  bookingDescription: string | null;
  holdExpiresAt: Date;
}

/** The business's held reservations whose deadline falls within the next EXPIRING_SOON_MS, soonest first. */
export async function listExpiringHolds(businessOrgId: string, mode: Mode, at: Date, dbOrTx?: DbOrTx): Promise<ExpiringHold[]> {
  const db = dbOrTx ?? (await getDb());
  const h = schema.handoffs;
  const rows = await db
    .select({ id: h.id, status: h.status, bookingRef: h.bookingRef, bookingDescription: h.bookingDescription, holdExpiresAt: h.holdExpiresAt })
    .from(h)
    .where(and(eq(h.businessOrgId, businessOrgId), eq(h.mode, mode), inArray(h.status, [...HOLDING_STATUSES]), gt(h.holdExpiresAt, at), lte(h.holdExpiresAt, new Date(at.getTime() + EXPIRING_SOON_MS))))
    .orderBy(asc(h.holdExpiresAt), asc(h.id))
    .limit(EXPIRING_LIST_LIMIT);
  return rows.flatMap((r) => (r.holdExpiresAt ? [{ ...r, holdExpiresAt: r.holdExpiresAt }] : []));
}

/** The handoff's history from the audit trail, oldest first (the caller has already loaded the handoff in scope). */
export async function handoffTimeline(businessOrgId: string, handoffId: string, dbOrTx?: DbOrTx): Promise<TimelineEntry[]> {
  const page = await listAuditLogs({ orgId: businessOrgId, targetType: "handoff", targetId: handoffId, limit: AUDIT_PAGE_MAX }, dbOrTx);
  return timelineFromAudit(page.items);
}
