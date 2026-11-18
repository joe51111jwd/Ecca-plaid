import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { now } from "@/lib/clock";
import { invalid, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { assertPlatformAdmin } from "@/server/auth";
import { OPEN_RAIL_STATUSES } from "@/server/consents";
import { purgeObject } from "@/server/storage";
import { loadActorUser, requirePermission, type HouseholdActor } from "./access";
import { addressOf, countyOf } from "./households";
import { decryptDob } from "./members";

/* ------------------------------------------------------------------------------------------ export */

export const HOUSEHOLD_EXPORT_FORMAT = "passport.household-export.v1";

export interface HouseholdExport {
  format: typeof HOUSEHOLD_EXPORT_FORMAT;
  exportedAt: string;
  household: {
    id: string;
    locale: string;
    address: ReturnType<typeof addressOf>;
    county: ReturnType<typeof countyOf>;
    createdAt: string;
    updatedAt: string;
  };
  members: Array<{
    id: string;
    kind: string;
    firstName: string;
    lastName: string;
    relationship: string | null;
    dateOfBirth: string | null;
    isOwner: boolean;
    signInEmail: string | null;
    addedAt: string;
    removedAt: string | null;
  }>;
  consents: Array<{
    id: string;
    kind: string;
    copyVersion: string;
    copySha256: string;
    locale: string;
    recipientOrgId: string | null;
    verificationId: string | null;
    scope: Record<string, unknown>;
    grantedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  verifications: Array<{
    id: string;
    organization: string | null;
    status: string;
    stage: string;
    householdSize: number | null;
    countyName: string | null;
    provisional: boolean;
    createdAt: string;
    decidedAt: string | null;
    expiresAt: string | null;
  }>;
  documents: Array<{
    id: string;
    verificationId: string;
    filename: string;
    declaredKind: string;
    status: string;
    sha256: string;
    uploadedAt: string;
    purgedAt: string | null;
  }>;
  dataConnections: Array<{ id: string; verificationId: string; provider: string; kind: string; status: string; connectedAt: string }>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Everything we hold about a household, as JSON for the family (owner only). Dates of birth are decrypted:
 * it is the family's own data. Provider credentials, encrypted extraction payloads and rail reports are
 * listed by identifier and status only. Audited as "household.export".
 */
export async function exportHouseholdData(householdId: string, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdExport> {
  const db = dbOrTx ?? (await getDb());
  const access = await requirePermission(db, householdId, actor, "export_data");
  const h = access.household;

  const hm = schema.householdMembers;
  const members = await db
    .select({ member: hm, email: schema.users.email })
    .from(hm)
    .leftJoin(schema.users, eq(schema.users.id, hm.userId))
    .where(eq(hm.householdId, h.id))
    .orderBy(asc(hm.createdAt), asc(hm.id));
  const consents = await db.select().from(schema.consents).where(eq(schema.consents.householdId, h.id)).orderBy(asc(schema.consents.grantedAt), asc(schema.consents.id));
  const v = schema.verifications;
  const verifications = await db
    .select({ v, orgName: schema.organizations.name })
    .from(v)
    .leftJoin(schema.organizations, eq(schema.organizations.id, v.orgId))
    .where(eq(v.householdId, h.id))
    .orderBy(asc(v.createdAt), asc(v.id));
  const documents = await db.select().from(schema.documents).where(eq(schema.documents.householdId, h.id)).orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
  const rails = await db.select().from(schema.railConnections).where(eq(schema.railConnections.householdId, h.id)).orderBy(asc(schema.railConnections.createdAt), asc(schema.railConnections.id));

  const out: HouseholdExport = {
    format: HOUSEHOLD_EXPORT_FORMAT,
    exportedAt: now().toISOString(),
    household: { id: h.id, locale: h.locale, address: addressOf(h), county: countyOf(h), createdAt: h.createdAt.toISOString(), updatedAt: h.updatedAt.toISOString() },
    members: members.map(({ member: m, email }) => ({
      id: m.id,
      kind: m.kind,
      firstName: m.firstName,
      lastName: m.lastName,
      relationship: m.relationship,
      dateOfBirth: m.dobEnc ? decryptDob(m.dobEnc) : null,
      isOwner: m.isOwner,
      signInEmail: email ?? null,
      addedAt: m.createdAt.toISOString(),
      removedAt: iso(m.removedAt),
    })),
    consents: consents.map((c) => ({
      id: c.id,
      kind: c.kind,
      copyVersion: c.copyVersion,
      copySha256: c.copySha256,
      locale: c.locale,
      recipientOrgId: c.recipientOrgId,
      verificationId: c.verificationId,
      scope: c.scope,
      grantedAt: c.grantedAt.toISOString(),
      expiresAt: iso(c.expiresAt),
      revokedAt: iso(c.revokedAt),
    })),
    verifications: verifications.map(({ v: r, orgName }) => ({
      id: r.id,
      organization: orgName ?? null,
      status: r.status,
      stage: r.stage,
      householdSize: r.householdSize,
      countyName: r.countyName,
      provisional: r.provisional,
      createdAt: r.createdAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      expiresAt: iso(r.expiresAt),
    })),
    documents: documents.map((d) => ({
      id: d.id,
      verificationId: d.verificationId,
      filename: d.filename,
      declaredKind: d.declaredKind,
      status: d.status,
      sha256: d.sha256,
      uploadedAt: d.createdAt.toISOString(),
      purgedAt: iso(d.purgedAt),
    })),
    dataConnections: rails.map((r) => ({ id: r.id, verificationId: r.verificationId, provider: r.provider, kind: r.kind, status: r.status, connectedAt: r.createdAt.toISOString() })),
  };
  await audit(
    {
      actor: { type: "user", id: actor.userId },
      action: "household.export",
      target: { type: "household", id: h.id },
      metadata: { members: out.members.length, consents: out.consents.length, verifications: out.verifications.length, documents: out.documents.length },
      request: actor.request,
    },
    db,
  );
  return out;
}

/* ----------------------------------------------------------------------------------------- deletion */

/** Reason recorded on every object purged by a deletion request (objects.delete_reason). */
export const DELETION_REQUEST_PURGE_REASON = "household deletion request";
const MAX_REASON_LENGTH = 500;

/** Verification states in which work may still be in progress and must be stopped by the verifications service. */
const OPEN_VERIFICATION_STATUSES = ["pending", "needs_review"] as const;

export interface DeletionReport {
  householdId: string;
  processedAt: string;
  /** Raw uploads whose bytes and data keys were destroyed by this request. */
  purgedObjectIds: string[];
  /** Raw uploads that were already purged (for example by the retention job). */
  alreadyPurgedObjectIds: string[];
  /** Document rows newly marked "purged" (their hashes and extracted fields are kept). */
  documentIdsMarkedPurged: string[];
  membersDobCleared: number;
  phonesCleared: number;
  /** Consents revoked by this request (they were still active). The consent records themselves are kept. */
  revokedConsentIds: string[];
  /** Must be disconnected at the provider by the rails service (this module does not touch provider state). */
  railConnectionIdsToClose: string[];
  /** Verifications still open; the verifications service must cancel them (their consents are now revoked). */
  openVerificationIds: string[];
}

/**
 * Processes a family's request to delete their data. Platform admins only; the request itself arrives through
 * support, so the person asking has been identified outside this function.
 *
 * Policy (conservative; the written deletion policy cites this function):
 *  1. Raw uploaded files of the household are purged at once: bytes deleted from the object store and their
 *     data keys destroyed (storage purgeObject, each audited as "object.purge"). The object index rows stay
 *     with their SHA-256, because evidence packs already given to SGOs refer to those hashes.
 *  2. Personal details not needed for any record are cleared: the street address, city, ZIP and county on
 *     the household; every member's date of birth; the phone number of each linked sign-in.
 *  3. Kept, because they are the scholarship organization's audit records of a decision it made: the
 *     verification rows (decision, threshold, county and household size used), document rows with their
 *     hashes and extracted fields, income lines, evidence PDFs and signed JSON, member names (the evidence
 *     names who was counted), and the consent records (proof the family authorized the share). The spec's
 *     data-security row: "Keep the decision, extracted fields, and file hashes; delete raw uploads".
 *  4. Every still-active consent is revoked, so no further collection or sharing can happen
 *     (assertActiveConsent fails from now on). Open rail connections and open verifications are returned for
 *     the rails and verifications services to close; this function does not change their state.
 *  5. One audit entry "household.deletion_processed" records who, when, why and what was done. Audit logs are
 *     never deleted.
 * Re-running it is safe: already-purged files and cleared fields are reported, not touched again.
 * Files are purged before the database changes, outside the transaction, so a failure part-way leaves no
 * bytes behind a row that claims they are gone; re-run to finish.
 */
export async function processDeletionRequest(householdId: string, actor: HouseholdActor, input: { reason: string }, dbOrTx?: DbOrTx): Promise<DeletionReport> {
  const reason = typeof input?.reason === "string" ? input.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) throw invalid(`Give a reason of at most ${MAX_REASON_LENGTH} characters.`, { fields: { reason: "Required." } });
  const db = dbOrTx ?? (await getDb());
  const admin = await loadActorUser(db, actor.userId);
  await assertPlatformAdmin(admin, db);

  const [household] = typeof householdId === "string" && householdId ? await db.select().from(schema.households).where(eq(schema.households.id, householdId)).limit(1) : [];
  if (!household) throw notFound("Household");

  const o = schema.objects;
  const docObjectIds = (await db.select({ id: schema.documents.objectId }).from(schema.documents).where(eq(schema.documents.householdId, household.id))).map((r) => r.id);
  const uploads = await db
    .select({ id: o.id, deletedAt: o.deletedAt })
    .from(o)
    .where(and(eq(o.purpose, "upload"), docObjectIds.length > 0 ? or(eq(o.householdId, household.id), inArray(o.id, docObjectIds)) : eq(o.householdId, household.id)))
    .orderBy(asc(o.id));

  const purgedObjectIds: string[] = [];
  const alreadyPurgedObjectIds: string[] = [];
  for (const obj of uploads) {
    if (obj.deletedAt) {
      alreadyPurgedObjectIds.push(obj.id);
      continue;
    }
    await purgeObject(obj.id, DELETION_REQUEST_PURGE_REASON, { actor: { type: "user", id: admin.id }, request: actor.request }, db);
    purgedObjectIds.push(obj.id);
  }

  return db.transaction(async (tx) => {
    const at = now();
    const d = schema.documents;
    const marked = await tx
      .update(d)
      .set({ status: "purged", purgedAt: at })
      .where(and(eq(d.householdId, household.id), isNull(d.purgedAt)))
      .returning({ id: d.id });

    const hm = schema.householdMembers;
    const dobCleared = await tx
      .update(hm)
      .set({ dobEnc: null })
      .where(and(eq(hm.householdId, household.id), isNotNull(hm.dobEnc)))
      .returning({ id: hm.id });

    const linkedUserIds = [
      ...new Set([household.ownerUserId, ...(await tx.select({ userId: hm.userId }).from(hm).where(eq(hm.householdId, household.id))).map((r) => r.userId).filter((id): id is string => id !== null)]),
    ];
    const phones = await tx
      .update(schema.users)
      .set({ phone: null })
      .where(and(inArray(schema.users.id, linkedUserIds), isNotNull(schema.users.phone)))
      .returning({ id: schema.users.id });

    await tx
      .update(schema.households)
      .set({ addressLine1: null, addressLine2: null, city: null, zip: null, countyFips: null, countyName: null, countyResolution: null, updatedAt: at })
      .where(eq(schema.households.id, household.id));

    const c = schema.consents;
    const revoked = await tx
      .update(c)
      .set({ revokedAt: at })
      .where(and(eq(c.householdId, household.id), isNull(c.revokedAt)))
      .returning({ id: c.id });

    const rc = schema.railConnections;
    const rails = await tx
      .select({ id: rc.id })
      .from(rc)
      .where(and(eq(rc.householdId, household.id), inArray(rc.status, [...OPEN_RAIL_STATUSES])));
    const v = schema.verifications;
    const openVers = await tx
      .select({ id: v.id })
      .from(v)
      .where(and(eq(v.householdId, household.id), inArray(v.status, [...OPEN_VERIFICATION_STATUSES])));

    const report: DeletionReport = {
      householdId: household.id,
      processedAt: at.toISOString(),
      purgedObjectIds,
      alreadyPurgedObjectIds,
      documentIdsMarkedPurged: marked.map((r) => r.id).sort(),
      membersDobCleared: dobCleared.length,
      phonesCleared: phones.length,
      revokedConsentIds: revoked.map((r) => r.id).sort(),
      railConnectionIdsToClose: rails.map((r) => r.id).sort(),
      openVerificationIds: openVers.map((r) => r.id).sort(),
    };
    await audit(
      {
        actor: { type: "user", id: admin.id },
        action: "household.deletion_processed",
        target: { type: "household", id: household.id },
        metadata: {
          reason,
          purgedObjects: purgedObjectIds.length,
          alreadyPurgedObjects: alreadyPurgedObjectIds.length,
          documentsMarkedPurged: report.documentIdsMarkedPurged.length,
          membersDobCleared: report.membersDobCleared,
          phonesCleared: report.phonesCleared,
          revokedConsentIds: report.revokedConsentIds,
          railConnectionIdsToClose: report.railConnectionIdsToClose,
          openVerificationIds: report.openVerificationIds,
        },
        request: actor.request,
      },
      tx,
    );
    return report;
  });
}

