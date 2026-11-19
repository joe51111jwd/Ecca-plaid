import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode, OrgStatus, OrgType, SgoListSource, VerificationStatus } from "@/db/schema";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { isPlatformAdmin, type Organization } from "@/server/auth";
import { OPEN_RAIL_STATUSES } from "@/server/consents";
import type { AdminActor } from "../types";
import { ORG_STATUS_REASON_LIMITS, type OrgFilter } from "../forms";

/**
 * Read models (and one audited mutation) for the admin console that no domain service exposes: cross-tenant
 * counts, the organization directory, organization suspension, and the lookups behind the privacy and refund
 * screens. Platform-admin only: every caller has passed `requireAdminPage` / `requireAdminActor`.
 */

const ORG_TYPES: readonly OrgType[] = ["sgo", "business", "platform"];
const ORG_STATUSES: readonly OrgStatus[] = ["pending", "active", "suspended"];
const VERIFICATION_STATUSES: readonly VerificationStatus[] = ["pending", "eligible", "ineligible", "needs_review", "expired", "canceled"];
const MODES: readonly Mode[] = ["test", "live"];

/* ------------------------------------------------------------------------------------------- overview */

export interface OverviewCounts {
  orgs: Record<OrgType, Record<OrgStatus, number>>;
  households: number;
  verifications: Record<Mode, Record<VerificationStatus, number>>;
  openReviewTasks: number;
  succeededDonations: Record<Mode, { count: number; designatedCents: number }>;
  failedEmails: number;
}

const zeroStatuses = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export async function getOverviewCounts(dbOrTx?: DbOrTx): Promise<OverviewCounts> {
  const db = dbOrTx ?? (await getDb());
  const o = schema.organizations;
  const v = schema.verifications;
  const d = schema.donations;

  const [orgRows, [households], verRows, [reviews], donRows, [emails]] = await Promise.all([
    db.select({ type: o.type, status: o.status, n: count() }).from(o).groupBy(o.type, o.status),
    db.select({ n: count() }).from(schema.households),
    db.select({ mode: v.mode, status: v.status, n: count() }).from(v).groupBy(v.mode, v.status),
    db.select({ n: count() }).from(schema.reviewTasks).where(eq(schema.reviewTasks.status, "open")),
    db
      .select({ mode: d.mode, n: count(), cents: sql<string>`coalesce(sum(${d.designatedAmountCents}), 0)` })
      .from(d)
      .where(eq(d.status, "succeeded"))
      .groupBy(d.mode),
    db.select({ n: count() }).from(schema.emails).where(eq(schema.emails.status, "failed")),
  ]);

  const orgs = Object.fromEntries(ORG_TYPES.map((t) => [t, zeroStatuses(ORG_STATUSES)])) as OverviewCounts["orgs"];
  for (const r of orgRows) if (ORG_TYPES.includes(r.type) && ORG_STATUSES.includes(r.status)) orgs[r.type][r.status] += r.n;

  const verifications = Object.fromEntries(MODES.map((m) => [m, zeroStatuses(VERIFICATION_STATUSES)])) as OverviewCounts["verifications"];
  for (const r of verRows) if (MODES.includes(r.mode) && VERIFICATION_STATUSES.includes(r.status)) verifications[r.mode][r.status] += r.n;

  const succeededDonations: OverviewCounts["succeededDonations"] = { test: { count: 0, designatedCents: 0 }, live: { count: 0, designatedCents: 0 } };
  for (const r of donRows) if (MODES.includes(r.mode)) succeededDonations[r.mode] = { count: r.n, designatedCents: Number(r.cents) };

  return { orgs, households: households?.n ?? 0, verifications, openReviewTasks: reviews?.n ?? 0, succeededDonations, failedEmails: emails?.n ?? 0 };
}

/** Listed (not removed) entries per list source. */
export async function countListedEntriesBySource(dbOrTx?: DbOrTx): Promise<Record<SgoListSource, number>> {
  const db = dbOrTx ?? (await getDb());
  const t = schema.sgoListEntries;
  const rows = await db.select({ source: t.source, n: count() }).from(t).where(eq(t.status, "listed")).groupBy(t.source);
  const out: Record<SgoListSource, number> = { provisional_curated: 0, irs_published: 0 };
  for (const r of rows) if (r.source in out) out[r.source] = r.n;
  return out;
}

/** One list entry, or null. */
export async function getListEntry(entryId: string, dbOrTx?: DbOrTx): Promise<typeof schema.sgoListEntries.$inferSelect | null> {
  const db = dbOrTx ?? (await getDb());
  const [row] = await db.select().from(schema.sgoListEntries).where(eq(schema.sgoListEntries.id, entryId)).limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------------------- organizations */

export const ORG_LIST_LIMIT = 200;

export interface OrgListRow {
  org: Organization;
  memberCount: number;
  /** SGO profile facts (null for other types). */
  sgo: { ein: string | null; state: string; listEntryId: string | null } | null;
  /** Business profile facts (null for other types). */
  business: { vendorType: string; successFeeFlatCents: number; successFeeBps: number } | null;
}

/** Escapes LIKE wildcards so a search for "100%" matches the text "100%". */
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Organizations newest first, filtered by type, status and a name/slug search. */
export async function listOrganizations(filter: OrgFilter = {}, dbOrTx?: DbOrTx): Promise<OrgListRow[]> {
  const db = dbOrTx ?? (await getDb());
  const o = schema.organizations;
  const where: SQL[] = [];
  if (filter.type) where.push(eq(o.type, filter.type));
  if (filter.status) where.push(eq(o.status, filter.status));
  if (filter.q) where.push(or(ilike(o.name, likeContains(filter.q)), ilike(o.slug, likeContains(filter.q)))!);

  const members = db
    .select({ orgId: schema.memberships.orgId, n: count().as("n") })
    .from(schema.memberships)
    .groupBy(schema.memberships.orgId)
    .as("member_counts");
  const sp = schema.sgoProfiles;
  const bp = schema.businessProfiles;
  const rows = await db
    .select({
      org: o,
      memberCount: members.n,
      sgoEin: sp.ein,
      sgoState: sp.state,
      sgoListEntryId: sp.listEntryId,
      sgoOrgId: sp.orgId,
      vendorType: bp.vendorType,
      feeFlat: bp.successFeeFlatCents,
      feeBps: bp.successFeeBps,
      bizOrgId: bp.orgId,
    })
    .from(o)
    .leftJoin(members, eq(members.orgId, o.id))
    .leftJoin(sp, eq(sp.orgId, o.id))
    .leftJoin(bp, eq(bp.orgId, o.id))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(o.createdAt), desc(o.id))
    .limit(ORG_LIST_LIMIT);

  return rows.map((r) => ({
    org: r.org,
    memberCount: Number(r.memberCount ?? 0),
    sgo: r.sgoOrgId ? { ein: r.sgoEin, state: r.sgoState ?? "", listEntryId: r.sgoListEntryId } : null,
    business: r.bizOrgId ? { vendorType: r.vendorType ?? "", successFeeFlatCents: r.feeFlat ?? 0, successFeeBps: r.feeBps ?? 0 } : null,
  }));
}

export async function getOrganization(orgId: string, dbOrTx?: DbOrTx): Promise<Organization | null> {
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 100) return null;
  const db = dbOrTx ?? (await getDb());
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  return org ?? null;
}

/**
 * Suspends or reinstates an SGO or business. A suspended SGO takes no gifts (assertGiftAllowed) and a suspended
 * business's publishable key resolves to nothing (resolvePublishableKey). The platform organization cannot be
 * suspended. Audited as "org.suspend" / "org.reactivate" with the reason, in the same transaction.
 */
export async function setOrganizationStatus(
  input: { orgId: string; status: "active" | "suspended"; reason: string },
  actor: AdminActor,
  dbOrTx?: DbOrTx,
): Promise<Organization> {
  const reason = input.reason.trim();
  if (reason.length < ORG_STATUS_REASON_LIMITS.min || reason.length > ORG_STATUS_REASON_LIMITS.max) {
    throw invalid("Give a reason for the change.", { fields: { reason: `Between ${ORG_STATUS_REASON_LIMITS.min} and ${ORG_STATUS_REASON_LIMITS.max} characters.` } });
  }
  if (input.status !== "active" && input.status !== "suspended") throw invalid("Choose active or suspended.", { fields: { status: "Required." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    if (!(await isPlatformAdmin(actor.userId, tx))) throw forbidden();
    const o = schema.organizations;
    const [org] = await tx.select().from(o).where(eq(o.id, input.orgId)).for("update").limit(1);
    if (!org) throw notFound("Organization");
    if (org.type === "platform") throw conflict("The platform organization cannot be suspended.");
    if (org.status === input.status) throw conflict(input.status === "suspended" ? "This organization is already suspended." : "This organization is already active.");
    const [updated] = await tx.update(o).set({ status: input.status }).where(eq(o.id, org.id)).returning();
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        orgId: org.id,
        action: input.status === "suspended" ? "org.suspend" : "org.reactivate",
        target: { type: "organization", id: org.id },
        metadata: { from: org.status, to: input.status, reason },
        request: actor.request,
      },
      tx,
    );
    return updated;
  });
}

/* ------------------------------------------------------------------------------------------- privacy */

export interface HouseholdMatch {
  householdId: string;
  ownerEmail: string;
  createdAt: Date;
  countyName: string | null;
  /** Address, county and dates of birth have already been cleared (a deletion was processed). */
  addressCleared: boolean;
  members: number;
  documents: number;
  /** Documents whose raw upload has not been purged yet. */
  documentsWithFiles: number;
  openVerifications: number;
  activeConsents: number;
  openRailConnections: number;
}

export const HOUSEHOLD_SEARCH_LIMIT = 20;

/** Households by id (exact) or by the owner's sign-in email (exact, case-insensitive). Never a partial match. */
export async function findHouseholds(query: string, dbOrTx?: DbOrTx): Promise<HouseholdMatch[]> {
  const q = query.trim();
  if (q === "" || q.length > 320) return [];
  const db = dbOrTx ?? (await getDb());
  const h = schema.households;
  const u = schema.users;
  const where = q.includes("@") ? eq(u.email, q.toLowerCase()) : eq(h.id, q);
  const base = await db
    .select({ id: h.id, ownerEmail: u.email, createdAt: h.createdAt, countyName: h.countyName, addressLine1: h.addressLine1, zip: h.zip })
    .from(h)
    .innerJoin(u, eq(u.id, h.ownerUserId))
    .where(where)
    .orderBy(asc(h.createdAt), asc(h.id))
    .limit(HOUSEHOLD_SEARCH_LIMIT);
  if (base.length === 0) return [];
  const ids = base.map((b) => b.id);

  const per = async (rows: PromiseLike<Array<{ householdId: string | null; n: number }>>) => new Map((await rows).map((r) => [r.householdId, r.n]));
  const hm = schema.householdMembers;
  const doc = schema.documents;
  const v = schema.verifications;
  const c = schema.consents;
  const rc = schema.railConnections;
  const [members, documents, withFiles, openVers, consents, rails] = await Promise.all([
    per(db.select({ householdId: hm.householdId, n: count() }).from(hm).where(and(inArray(hm.householdId, ids), isNull(hm.removedAt))).groupBy(hm.householdId)),
    per(db.select({ householdId: doc.householdId, n: count() }).from(doc).where(inArray(doc.householdId, ids)).groupBy(doc.householdId)),
    per(db.select({ householdId: doc.householdId, n: count() }).from(doc).where(and(inArray(doc.householdId, ids), isNull(doc.purgedAt))).groupBy(doc.householdId)),
    per(db.select({ householdId: v.householdId, n: count() }).from(v).where(and(inArray(v.householdId, ids), inArray(v.status, ["pending", "needs_review"]))).groupBy(v.householdId)),
    per(db.select({ householdId: c.householdId, n: count() }).from(c).where(and(inArray(c.householdId, ids), isNull(c.revokedAt))).groupBy(c.householdId)),
    per(db.select({ householdId: rc.householdId, n: count() }).from(rc).where(and(inArray(rc.householdId, ids), inArray(rc.status, [...OPEN_RAIL_STATUSES]))).groupBy(rc.householdId)),
  ]);

  return base.map((b) => ({
    householdId: b.id,
    ownerEmail: b.ownerEmail,
    createdAt: b.createdAt,
    countyName: b.countyName,
    addressCleared: b.addressLine1 === null && b.zip === null && b.countyName === null,
    members: members.get(b.id) ?? 0,
    documents: documents.get(b.id) ?? 0,
    documentsWithFiles: withFiles.get(b.id) ?? 0,
    openVerifications: openVers.get(b.id) ?? 0,
    activeConsents: consents.get(b.id) ?? 0,
    openRailConnections: rails.get(b.id) ?? 0,
  }));
}

/** Organization and mode of each verification, for cancelling the ones a deletion request leaves open. */
export async function getVerificationScopes(ids: readonly string[], dbOrTx?: DbOrTx): Promise<Array<{ id: string; orgId: string; mode: Mode; status: VerificationStatus }>> {
  if (ids.length === 0) return [];
  const db = dbOrTx ?? (await getDb());
  const v = schema.verifications;
  return db.select({ id: v.id, orgId: v.orgId, mode: v.mode, status: v.status }).from(v).where(inArray(v.id, [...ids])).orderBy(asc(v.id));
}

/* ------------------------------------------------------------------------------------------- refunds */

export interface RefundCandidate {
  donationId: string;
  orgId: string;
  orgName: string;
  mode: Mode;
  status: (typeof schema.donations.$inferSelect)["status"];
  designatedAmountCents: number;
  nonDesignatedAmountCents: number;
  donorServiceFeeCents: number;
  taxpayerRole: string;
  contributedAt: Date | null;
  paymentId: string | null;
  /** Every donation carried by the same payment (a joint gift has two); a refund returns them all. */
  siblingDonationIds: string[];
  refundedAt: Date | null;
}

export async function getRefundCandidate(donationId: string, dbOrTx?: DbOrTx): Promise<RefundCandidate | null> {
  const id = donationId.trim();
  if (id === "" || id.length > 100) return null;
  const db = dbOrTx ?? (await getDb());
  const d = schema.donations;
  const [row] = await db
    .select({ d, orgName: schema.organizations.name })
    .from(d)
    .innerJoin(schema.organizations, eq(schema.organizations.id, d.orgId))
    .where(eq(d.id, id))
    .limit(1);
  if (!row) return null;
  const siblings = row.d.paymentId ? await db.select({ id: d.id }).from(d).where(eq(d.paymentId, row.d.paymentId)).orderBy(asc(d.id)) : [{ id: row.d.id }];
  return {
    donationId: row.d.id,
    orgId: row.d.orgId,
    orgName: row.orgName,
    mode: row.d.mode,
    status: row.d.status,
    designatedAmountCents: row.d.designatedAmountCents,
    nonDesignatedAmountCents: row.d.nonDesignatedAmountCents,
    donorServiceFeeCents: row.d.donorServiceFeeCents,
    taxpayerRole: row.d.taxpayerRole,
    contributedAt: row.d.contributedAt,
    paymentId: row.d.paymentId,
    siblingDonationIds: siblings.map((s) => s.id),
    refundedAt: row.d.refundedAt,
  };
}
