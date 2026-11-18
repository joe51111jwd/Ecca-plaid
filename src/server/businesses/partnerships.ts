import { and, asc, desc, eq, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { VendorType } from "@/db/schema";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { auditContextOf, authorizeManage, type BusinessActor } from "./access";
import { loadBusiness } from "./profiles";

/**
 * Partnerships: which SGOs accept applicants from which business's point-of-booking handoff.
 *
 *   pending ──(SGO accepts)──→ active ──(either side ends)──→ ended
 *      └──(SGO declines, or either side withdraws)──→ ended ──(business requests again)──→ pending
 *
 * The business asks; the SGO's owners/admins decide. Either side can end it at any time. One row per
 * (business, SGO) pair: asking again after an ending reopens that row. A family can only be handed to an SGO whose
 * partnership is active, whose profile still accepts handoffs, and whose organization (and the business's) is active.
 *
 * Every change is audited once for each of the two organizations, so both dashboards' audit views show it.
 */

export type PartnershipStatus = "pending" | "active" | "ended";
export type Partnership = typeof schema.partnerships.$inferSelect;

export interface PartnershipSummary {
  partnership: Partnership;
  business: { orgId: string; displayName: string; vendorType: VendorType; website: string | null };
  sgo: { orgId: string; displayName: string; website: string | null; logoUrl: string | null; acceptsHandoffs: boolean };
}

/** An SGO a family can be handed to from this business's booking flow. */
export interface PartnerSgo {
  partnershipId: string;
  sgoOrgId: string;
  displayName: string;
  website: string | null;
  logoUrl: string | null;
}

/** ID_PREFIX in src/lib/ids has no partnership entry yet; this keeps the same alphabet and length under "prt_". */
function newPartnershipId(): string {
  return newId("org").replace(/^org_/, "prt_");
}

const orgIdSchema = z.string().min(1).max(100);
const requestSchema = z.object({ businessOrgId: orgIdSchema, sgoOrgId: orgIdSchema });

const NOT_ACCEPTING = "This scholarship organization is not accepting applicants from booking handoffs right now.";

async function loadSgoForPartnership(db: DbOrTx, sgoOrgId: string): Promise<{ status: string; acceptsHandoffs: boolean; displayName: string }> {
  if (typeof sgoOrgId !== "string" || sgoOrgId.length === 0) throw notFound("SGO");
  const [row] = await db
    .select({ status: schema.organizations.status, acceptsHandoffs: schema.sgoProfiles.acceptsHandoffs, displayName: schema.sgoProfiles.displayName })
    .from(schema.sgoProfiles)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.sgoProfiles.orgId))
    .where(and(eq(schema.sgoProfiles.orgId, sgoOrgId), eq(schema.organizations.type, "sgo")))
    .limit(1);
  if (!row) throw notFound("SGO");
  return row;
}

async function auditBothSides(
  tx: DbOrTx,
  actor: BusinessActor,
  action: string,
  p: Pick<Partnership, "id" | "businessOrgId" | "sgoOrgId">,
  metadata: Record<string, unknown>,
): Promise<void> {
  const ctx = auditContextOf(actor);
  for (const orgId of [p.businessOrgId, p.sgoOrgId]) {
    await audit(
      {
        actor: ctx.actor,
        orgId,
        action,
        target: { type: "partnership", id: p.id },
        metadata: { businessOrgId: p.businessOrgId, sgoOrgId: p.sgoOrgId, ...metadata, ...ctx.extra },
        request: ctx.request,
      },
      tx,
    );
  }
}

/**
 * The business asks an SGO to accept its applicants. Owners/admins of the business, or a platform admin. The SGO
 * must accept handoffs and be active. A pending or active partnership is a `conflict`; an ended one is reopened as
 * pending. Audited as "partnership.request".
 */
export async function requestPartnership(input: { businessOrgId: string; sgoOrgId: string }, actor: BusinessActor, dbOrTx?: DbOrTx): Promise<Partnership> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw invalid("Choose a scholarship organization.", { fields: { sgoOrgId: "Choose a scholarship organization." } });
  const { businessOrgId, sgoOrgId } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorizeManage(tx, actor, businessOrgId);
    await loadBusiness(tx, businessOrgId);
    const sgo = await loadSgoForPartnership(tx, sgoOrgId);
    if (sgo.status !== "active" || !sgo.acceptsHandoffs) throw conflict(NOT_ACCEPTING);

    const p = schema.partnerships;
    const [existing] = await tx
      .select()
      .from(p)
      .where(and(eq(p.businessOrgId, businessOrgId), eq(p.sgoOrgId, sgoOrgId)))
      .limit(1)
      .for("update");

    let row: Partnership;
    let reopened = false;
    if (existing) {
      if (existing.status === "pending") throw conflict(`A request to ${sgo.displayName} is already waiting for their answer.`);
      if (existing.status === "active") throw conflict(`You are already partnered with ${sgo.displayName}.`);
      [row] = await tx.update(p).set({ status: "pending" }).where(and(eq(p.id, existing.id), eq(p.status, "ended"))).returning();
      reopened = true;
    } else {
      const inserted = await tx
        .insert(p)
        .values({ id: newPartnershipId(), businessOrgId, sgoOrgId, status: "pending" })
        .onConflictDoNothing({ target: [p.businessOrgId, p.sgoOrgId] })
        .returning();
      // A concurrent request for the same pair won the insert.
      if (!inserted[0]) throw conflict(`A request to ${sgo.displayName} is already waiting for their answer.`);
      row = inserted[0];
    }
    await auditBothSides(tx, actor, "partnership.request", row, { reopened });
    return row;
  });
}

/**
 * The SGO answers a pending request: "active" accepts, "ended" declines. Owners/admins of the SGO, or a platform
 * admin. Accepting requires the SGO to accept handoffs at that moment. Audited as "partnership.respond".
 */
export async function respondToPartnership(sgoOrgId: string, partnershipId: string, decision: "active" | "ended", actor: BusinessActor, dbOrTx?: DbOrTx): Promise<Partnership> {
  if (decision !== "active" && decision !== "ended") throw invalid("Choose whether to accept or decline the request.", { fields: { decision: "Choose accept or decline." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorizeManage(tx, actor, sgoOrgId);
    const sgo = await loadSgoForPartnership(tx, sgoOrgId);
    const p = schema.partnerships;
    const [existing] = await tx
      .select()
      .from(p)
      .where(and(eq(p.id, typeof partnershipId === "string" ? partnershipId : ""), eq(p.sgoOrgId, sgoOrgId)))
      .limit(1)
      .for("update");
    if (!existing) throw notFound("Partnership");
    if (existing.status !== "pending") {
      throw conflict(existing.status === "active" ? "This partnership is already active." : "This request has ended. The business can send a new one.");
    }
    if (decision === "active" && (sgo.status !== "active" || !sgo.acceptsHandoffs)) {
      throw conflict("Turn on accepting applicants from booking handoffs in your profile before accepting a partnership.");
    }
    const [row] = await tx.update(p).set({ status: decision }).where(and(eq(p.id, existing.id), eq(p.status, "pending"))).returning();
    await auditBothSides(tx, actor, "partnership.respond", row, { from: existing.status, to: decision });
    return row;
  });
}

/**
 * Ends a pending or active partnership from either side (`orgId` is the acting side's organization: the business or
 * the SGO). Owners/admins of that side, or a platform admin. Ending an already-ended partnership changes nothing.
 * Handoffs already in progress are not touched here. Audited as "partnership.end".
 */
export async function endPartnership(orgId: string, partnershipId: string, actor: BusinessActor, dbOrTx?: DbOrTx): Promise<Partnership> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorizeManage(tx, actor, orgId);
    const p = schema.partnerships;
    const [existing] = await tx
      .select()
      .from(p)
      .where(and(eq(p.id, typeof partnershipId === "string" ? partnershipId : ""), or(eq(p.businessOrgId, orgId), eq(p.sgoOrgId, orgId))))
      .limit(1)
      .for("update");
    if (!existing) throw notFound("Partnership");
    if (existing.status === "ended") return existing;
    const [row] = await tx.update(p).set({ status: "ended" }).where(eq(p.id, existing.id)).returning();
    await auditBothSides(tx, actor, "partnership.end", row, { from: existing.status, endedBy: existing.businessOrgId === orgId ? "business" : "sgo" });
    return row;
  });
}

/* ---------------------------------------------------------------------------------------------- reads */

const businessOrg = alias(schema.organizations, "business_org");
const sgoOrg = alias(schema.organizations, "sgo_org");

async function listSummaries(db: DbOrTx, scope: SQL, status?: PartnershipStatus): Promise<PartnershipSummary[]> {
  const p = schema.partnerships;
  const bp = schema.businessProfiles;
  const sp = schema.sgoProfiles;
  const rows = await db
    .select({
      partnership: p,
      business: { orgId: bp.orgId, displayName: bp.displayName, vendorType: bp.vendorType, website: bp.website },
      sgo: { orgId: sp.orgId, displayName: sp.displayName, website: sp.website, logoUrl: sp.logoUrl, acceptsHandoffs: sp.acceptsHandoffs },
    })
    .from(p)
    .innerJoin(bp, eq(bp.orgId, p.businessOrgId))
    .innerJoin(sp, eq(sp.orgId, p.sgoOrgId))
    .where(status ? and(scope, eq(p.status, status)) : scope)
    .orderBy(desc(p.createdAt), asc(p.id));
  return rows;
}

/** The business's partnerships, newest first, optionally of one status. Org-scoped read: callers guard access first. */
export async function listPartnershipsForBusiness(businessOrgId: string, opts: { status?: PartnershipStatus } = {}, dbOrTx?: DbOrTx): Promise<PartnershipSummary[]> {
  const db = dbOrTx ?? (await getDb());
  return listSummaries(db, eq(schema.partnerships.businessOrgId, businessOrgId), opts.status);
}

/** The SGO's partnerships (requests included), newest first. Org-scoped read: callers guard access first. */
export async function listPartnershipsForSgo(sgoOrgId: string, opts: { status?: PartnershipStatus } = {}, dbOrTx?: DbOrTx): Promise<PartnershipSummary[]> {
  const db = dbOrTx ?? (await getDb());
  return listSummaries(db, eq(schema.partnerships.sgoOrgId, sgoOrgId), opts.status);
}

function activePartnerConditions(businessOrgId: string): SQL {
  const p = schema.partnerships;
  return and(
    eq(p.businessOrgId, businessOrgId),
    eq(p.status, "active"),
    eq(businessOrg.type, "business"),
    eq(businessOrg.status, "active"),
    eq(sgoOrg.type, "sgo"),
    eq(sgoOrg.status, "active"),
    eq(schema.sgoProfiles.acceptsHandoffs, true),
  )!;
}

function activePartnerQuery(db: DbOrTx, where: SQL) {
  const p = schema.partnerships;
  const sp = schema.sgoProfiles;
  return db
    .select({ partnershipId: p.id, sgoOrgId: sp.orgId, displayName: sp.displayName, website: sp.website, logoUrl: sp.logoUrl })
    .from(p)
    .innerJoin(businessOrg, eq(businessOrg.id, p.businessOrgId))
    .innerJoin(sgoOrg, eq(sgoOrg.id, p.sgoOrgId))
    .innerJoin(sp, eq(sp.orgId, p.sgoOrgId))
    .where(where);
}

/**
 * The SGOs a family at this business can be handed to, by display name. Empty when the business itself is not
 * active. Public data only (names, website, logo), so the handoff page may show it.
 */
export async function getActivePartnerSgos(businessOrgId: string, dbOrTx?: DbOrTx): Promise<PartnerSgo[]> {
  if (typeof businessOrgId !== "string" || businessOrgId.length === 0) return [];
  const db = dbOrTx ?? (await getDb());
  return activePartnerQuery(db, activePartnerConditions(businessOrgId)).orderBy(asc(schema.sgoProfiles.displayName), asc(schema.sgoProfiles.orgId));
}

/**
 * Throws `forbidden` unless a family at this business may be handed to this SGO right now (same rules as
 * getActivePartnerSgos). Call it whenever an SGO id arrives from a browser or an API caller.
 */
export async function assertActivePartnership(businessOrgId: string, sgoOrgId: string, dbOrTx?: DbOrTx): Promise<PartnerSgo> {
  if (typeof businessOrgId !== "string" || businessOrgId.length === 0 || typeof sgoOrgId !== "string" || sgoOrgId.length === 0) throw forbidden(NOT_ACCEPTING);
  const db = dbOrTx ?? (await getDb());
  const [row] = await activePartnerQuery(db, and(activePartnerConditions(businessOrgId), eq(schema.partnerships.sgoOrgId, sgoOrgId))!).limit(1);
  if (!row) throw forbidden(NOT_ACCEPTING);
  return row;
}
