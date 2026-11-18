/**
 * Passport reuse: a household verified with one SGO starts a verification with a second SGO and, with a fresh
 * "passport_reuse" consent naming that SGO and the owner's statement that the household has not changed, reuses
 * the earlier result's evidence instead of starting over.
 *
 * Nothing is trusted from the earlier decision itself. Its evidence INPUTS are copied (document rows as references
 * to the same files and hashes, the fields read from them, reviewer-keyed income lines, signed statements and
 * data-connection reports) and decide() runs again under the NEW SGO's policy and today's date, so a stricter cap
 * or an award letter that has aged out is honoured. Raw files are never shared again (they may already be purged):
 * a carried-over document refers to the earlier file and is never shown to the new SGO's reviewers.
 *
 * If the re-run is not "eligible" the verification falls back to the normal flow with everything copied kept.
 */
import { and, asc, desc, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode, VerificationLocale, VerificationMethod } from "@/db/schema";
import { decide, explainDecision, type Decision } from "@/engine/decision";
import { centralDateString, now } from "@/lib/clock";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { SYSTEM_ACTOR, audit } from "@/server/audit";
import { endOfCentralDay, grantConsent, renderConsent, type ConsentLocale, type RenderedConsent } from "@/server/consents";
import { getHouseholdSnapshot, householdCan, type HouseholdSnapshot } from "@/server/households";
import { getRailSummaryForDecision } from "@/server/rails";
import { activeCertificationRows } from "./certifications";
import { AGE_BAND_DOB_PURPOSE, assembleDecisionInput, decisionColumns, replaceDocumentIncomeItems, requireDecision, scheduleDecidedFollowUps } from "./decide";
import { buildFamilyView, consentOrganizationName, familyLocale, orgNameOf, type FamilyVerificationView } from "./family";
import { assertFamilyEditable, familyAuditActor, laterStage, newCertificationId, recordVerificationEvent, requireFamilyAccess, type FamilyActor, type VerificationRow } from "./internal";

/* ------------------------------------------------------------------------------------------- find */

export interface ReusableResult {
  verificationId: string;
  orgId: string;
  orgName: string;
  mode: Mode;
  method: VerificationMethod | null;
  decidedAt: Date;
  expiresAt: Date;
  /** Last day the result can be used (YYYY-MM-DD). */
  validUntil: string | null;
  provisional: boolean;
}

/**
 * The household's most recent eligible, unexpired, non-canceled verification with another SGO, in the same mode
 * (sandbox results never cross into live and vice versa), whose evidence pack exists. Null when there is none.
 * No access check: for services that already checked access to the household.
 */
export async function findReusableResult(householdId: string, forOrgId: string, opts: { mode: Mode }, dbOrTx?: DbOrTx): Promise<ReusableResult | null> {
  if (typeof householdId !== "string" || householdId.length === 0 || typeof forOrgId !== "string" || forOrgId.length === 0) return null;
  if (opts.mode !== "test" && opts.mode !== "live") throw invalid("Unknown mode.");
  const db = dbOrTx ?? (await getDb());
  const v = schema.verifications;
  const [row] = await db
    .select()
    .from(v)
    .where(and(eq(v.householdId, householdId), ne(v.orgId, forOrgId), eq(v.mode, opts.mode), eq(v.status, "eligible"), gt(v.expiresAt, now()), isNotNull(v.decidedAt), isNotNull(v.evidenceJsonObjectId)))
    .orderBy(desc(v.decidedAt), desc(v.id))
    .limit(1);
  if (!row || !row.decidedAt || !row.expiresAt) return null;
  const decision = row.decision as unknown as Decision | null;
  return {
    verificationId: row.id,
    orgId: row.orgId,
    orgName: await orgNameOf(db, row.orgId),
    mode: row.mode,
    method: row.method,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    validUntil: decision?.validUntil ?? null,
    provisional: row.provisional,
  };
}

/* ---------------------------------------------------------------------------------------- consent */

async function loadSource(db: DbOrTx, target: VerificationRow, sourceVerificationId: string): Promise<VerificationRow> {
  const [source] =
    typeof sourceVerificationId === "string" && sourceVerificationId.length > 0 && sourceVerificationId.length <= 128
      ? await db.select().from(schema.verifications).where(eq(schema.verifications.id, sourceVerificationId)).limit(1)
      : [];
  // Another household's verification is reported exactly like a missing one.
  if (!source || source.householdId === null || source.householdId !== target.householdId || source.id === target.id) throw notFound("Earlier result");
  if (source.mode !== target.mode || source.orgId === target.orgId) throw notFound("Earlier result");
  if (source.status !== "eligible" || !source.decidedAt || !source.expiresAt || source.expiresAt.getTime() <= now().getTime() || !source.evidenceJsonObjectId) {
    throw conflict("The earlier result can no longer be reused.", { reason: "source_not_reusable" });
  }
  return source;
}

/** The variables of the passport consent, rendered exactly as the consents service will render them. */
async function passportVars(db: DbOrTx, target: VerificationRow, source: VerificationRow) {
  const decision = requireDecision(source);
  return {
    organizationName: await consentOrganizationName(db, target.orgId),
    decidedDate: centralDateString(source.decidedAt!),
    resultValidUntil: centralDateString(source.expiresAt!),
    // PASSPORT_SHARE_UNTIL_POLICY: sharing lasts as long as the earlier result is valid.
    shareUntil: decision.validUntil ?? centralDateString(source.expiresAt!),
  };
}

/** The exact words of the passport consent for this verification and earlier result. */
export async function previewPassportConsent(verificationId: string, sourceVerificationId: string, actor: FamilyActor, locale: ConsentLocale, dbOrTx?: DbOrTx): Promise<RenderedConsent> {
  const db = dbOrTx ?? (await getDb());
  const { verification } = await requireFamilyAccess(db, verificationId, actor);
  const source = await loadSource(db, verification, sourceVerificationId);
  return renderConsent("passport_reuse", locale, await passportVars(db, verification, source));
}

/* ------------------------------------------------------------------------------------------ reuse */

export interface ReuseResultInput {
  /** The household owner states that the people in the household and the address have not changed. Must be true. */
  attestsNothingChanged: true;
  /** Language of the consent; defaults to the household's language. */
  locale?: ConsentLocale;
  /** SHA-256 of the consent words shown (previewPassportConsent). Refused if the wording changed since. */
  shownSha256?: string | null;
}

export type ReuseOutcome =
  | { outcome: "reused"; verification: FamilyVerificationView }
  | {
      outcome: "fallback";
      verification: FamilyVerificationView;
      /** What the re-run under the new organization's rules concluded (never persisted as a decision). */
      rerun: { status: Decision["status"]; reasonCodes: string[]; explanation: ReturnType<typeof explainDecision>["family"] };
    };

const reuseSchema = z.strictObject({
  attestsNothingChanged: z.literal(true, { error: "Confirm that the people in your household and your address have not changed." }),
  locale: z.enum(["en", "es"]).optional(),
  shownSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

function sameHousehold(snapshot: HouseholdSnapshot, source: VerificationRow): boolean {
  if (snapshot.missing.length > 0 || !snapshot.county?.hudArea) return false;
  if (snapshot.size !== source.householdSize || snapshot.county.fips !== source.countyFips) return false;
  return source.studentMemberIds.every((id) => snapshot.studentIds.includes(id));
}

/** Copies the earlier verification's evidence inputs onto the new one. Returns how many documents were carried over. */
async function copyEvidenceInputs(tx: DbOrTx, target: VerificationRow, source: VerificationRow): Promise<{ documents: number; incomeItems: number; certifications: number; rails: number }> {
  const at = now();
  const sourceDocs = await tx
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.verificationId, source.id), isNull(schema.documents.removedAt)))
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
  const existing = await tx.select({ sha256: schema.documents.sha256 }).from(schema.documents).where(and(eq(schema.documents.verificationId, target.id), isNull(schema.documents.removedAt)));
  const have = new Set(existing.map((d) => d.sha256));
  const docMap = new Map<string, string>();
  for (const d of sourceDocs) {
    if (have.has(d.sha256)) continue;
    const id = newId("document");
    docMap.set(d.id, id);
    have.add(d.sha256);
    // The original upload time is kept: the evidence record checks that a file was purged after it was uploaded.
    await tx.insert(schema.documents).values({
      id,
      verificationId: target.id,
      householdId: d.householdId,
      declaredKind: d.declaredKind,
      detectedKind: d.detectedKind,
      memberId: d.memberId,
      objectId: d.objectId,
      sha256: d.sha256,
      filename: d.filename,
      contentType: d.contentType,
      size: d.size,
      status: d.status,
      extractionEnc: d.extractionEnc,
      extractedBy: d.extractedBy,
      reviewReasons: d.reviewReasons,
      reviewedBy: d.reviewedBy,
      reviewedAt: d.reviewedAt,
      purgeAfter: null,
      purgedAt: d.purgedAt,
      extractedAt: d.extractedAt,
      sourceDocumentId: d.sourceDocumentId ?? d.id,
      createdAt: d.createdAt,
    });
  }

  const items = await tx
    .select()
    .from(schema.incomeItems)
    .where(and(eq(schema.incomeItems.verificationId, source.id), eq(schema.incomeItems.source, "reviewer")))
    .orderBy(asc(schema.incomeItems.createdAt));
  const selfReported = await tx
    .select()
    .from(schema.incomeItems)
    .where(and(eq(schema.incomeItems.verificationId, source.id), eq(schema.incomeItems.source, "self_reported")))
    .orderBy(asc(schema.incomeItems.createdAt));
  for (const r of [...items, ...selfReported]) {
    await tx.insert(schema.incomeItems).values({
      id: newId("incomeItem"),
      verificationId: target.id,
      memberId: r.memberId,
      source: r.source,
      category: r.category,
      description: r.description,
      incomeYear: r.incomeYear,
      annualAmountCents: r.annualAmountCents,
      counted: r.counted,
      basis: r.basis,
      documentId: r.documentId ? (docMap.get(r.documentId) ?? null) : null,
      railConnectionId: null,
      createdBy: r.createdBy,
      createdAt: at,
    });
  }

  const certs = await activeCertificationRows(tx, source.id);
  for (const c of certs) {
    await tx.insert(schema.verificationCertifications).values({
      id: newCertificationId(),
      verificationId: target.id,
      householdId: c.householdId,
      kind: c.kind,
      memberId: c.memberId,
      incomeYear: c.incomeYear,
      signedByUserId: c.signedByUserId,
      signedByMemberId: c.signedByMemberId,
      copyVersion: c.copyVersion,
      copySha256: c.copySha256,
      locale: c.locale,
      vars: c.vars,
      signedAt: c.signedAt,
      ip: c.ip,
      userAgent: c.userAgent,
      sourceCertificationId: c.sourceCertificationId ?? c.id,
    });
  }

  const rails = await tx
    .select()
    .from(schema.railConnections)
    .where(and(eq(schema.railConnections.verificationId, source.id), eq(schema.railConnections.status, "ready"), isNotNull(schema.railConnections.reportEnc)))
    .orderBy(asc(schema.railConnections.createdAt));
  for (const r of rails) {
    // The report is carried over as retrieved; no provider credential is copied, so nothing can be fetched again.
    await tx.insert(schema.railConnections).values({
      id: newId("railConnection"),
      householdId: r.householdId,
      verificationId: target.id,
      memberId: r.memberId,
      provider: r.provider,
      kind: r.kind,
      status: "ready",
      externalId: null,
      accessTokenEnc: null,
      reportEnc: r.reportEnc,
      reportSha256: r.reportSha256,
      consentId: r.consentId,
      failureReason: null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }
  return { documents: docMap.size, incomeItems: items.length + selfReported.length, certifications: certs.length, rails: rails.length };
}

/** The SHA-256 of the earlier verification's signed evidence record, from its "evidence.generated" timeline entry. */
async function sourceRecordSha256(db: DbOrTx, sourceId: string): Promise<string | null> {
  const [e] = await db
    .select({ data: schema.verificationEvents.data })
    .from(schema.verificationEvents)
    .where(and(eq(schema.verificationEvents.verificationId, sourceId), eq(schema.verificationEvents.type, "evidence.generated")))
    .orderBy(desc(schema.verificationEvents.createdAt), desc(schema.verificationEvents.id))
    .limit(1);
  const sha = e?.data.recordSha256;
  return typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
}

/**
 * Reuses an earlier eligible result of the same household with another SGO for this verification. Owner only.
 * Grants the "passport_reuse" consent naming this verification's SGO, copies the evidence inputs, snapshots the
 * (unchanged) household, and re-runs the decision under this SGO's policy and today's date:
 *  - eligible → decided now by the engine, `passport` recorded (source id, its decision time and its evidence
 *    record hash), the evidence pack generated (citing the source and the new consent), `verification.decided`;
 *  - anything else → the verification stays with the family (normal flow), keeping everything copied.
 */
export async function reuseResult(verificationId: string, sourceVerificationId: string, input: ReuseResultInput, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<ReuseOutcome> {
  const parsed = reuseSchema.safeParse(input);
  if (!parsed.success) throw invalid("Confirm that nothing has changed to reuse your earlier result.", { fields: { attestsNothingChanged: "Must be true." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { verification: v, access } = await requireFamilyAccess(tx, verificationId, actor, { forUpdate: true });
    if (!householdCan(access.access, "edit_household")) throw forbidden("Only the adult in charge of this household can reuse an earlier result.");
    assertFamilyEditable(v);
    if (v.stage === "awaiting_family" || v.submittedAt) throw conflict("This verification was already submitted; continue it instead.", { reason: "already_submitted" });
    if (v.evidenceCopiedFromId) throw conflict("An earlier result was already used for this verification.", { reason: "already_reused" });
    const source = await loadSource(tx, v, sourceVerificationId);

    const snapshot = await getHouseholdSnapshot(v.householdId!, { includeDob: { purpose: AGE_BAND_DOB_PURPOSE, actor: SYSTEM_ACTOR } }, tx);
    if (!sameHousehold(snapshot, source)) {
      throw conflict("Your household or address is different from your earlier verification. Continue with the usual steps instead.", { reason: "household_changed" });
    }
    const county = snapshot.county!;
    const hudArea = county.hudArea!;

    // The consents service requires the reuse to be recorded on the verification before the consent names it.
    await tx.update(schema.verifications).set({ passportSourceId: source.id, evidenceCopiedFromId: source.id, updatedAt: now() }).where(eq(schema.verifications.id, v.id));
    const locale: VerificationLocale = parsed.data.locale ?? (await familyLocale(tx, v));
    const vars = await passportVars(tx, v, source);
    const { consent } = await grantConsent(
      {
        kind: "passport_reuse",
        userId: actor.userId,
        householdId: v.householdId,
        verificationId: v.id,
        recipientOrgId: v.orgId,
        locale,
        vars: { shareUntil: vars.shareUntil },
        shownSha256: parsed.data.shownSha256 ?? null,
        request: actor.request,
      },
      tx,
    );
    await recordVerificationEvent(tx, v.id, "consent.granted", { type: "family", id: actor.userId }, { consentId: consent.id, kind: "passport_reuse", copyVersion: consent.copyVersion, locale: consent.locale });

    const copied = await copyEvidenceInputs(tx, v, source);
    const at = now();
    const students = source.studentMemberIds.filter((id) => snapshot.studentIds.includes(id));
    const [prepared] = await tx
      .update(schema.verifications)
      .set({
        householdSize: snapshot.size,
        countyFips: county.fips,
        countyName: county.name,
        hudAreaCode: hudArea.code,
        areaName: hudArea.name,
        studentMemberIds: students,
        custody: source.custody,
        householdCompletedAt: at,
        updatedAt: at,
      })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    await recordVerificationEvent(tx, v.id, "passport.evidence_copied", { type: "family", id: actor.userId }, { sourceVerificationId: source.id, attestsNothingChanged: true, ...copied });

    // Re-run under this SGO's policy and today's date. Nothing from the earlier decision is carried over.
    const today = centralDateString(at);
    const docs = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.verificationId, v.id), isNull(schema.documents.removedAt)))
      .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
    const rails = await getRailSummaryForDecision(v.id, tx);
    const { input: decisionInput, documentItems } = await assembleDecisionInput(tx, { ...prepared, applicationDate: null }, { docs, rails, snapshot, today });
    const decision = decide(decisionInput);
    const reasonCodes = [...new Set([...decision.reviewReasons, ...decision.reasons].map((r) => r.code))];

    if (decision.status === "eligible") {
      const recordSha = await sourceRecordSha256(tx, source.id);
      const [updated] = await tx
        .update(schema.verifications)
        .set({
          status: "eligible",
          stage: "decided",
          ...decisionColumns(prepared, decision, { fips: county.fips, name: county.name, hudAreaCode: hudArea.code, hudAreaName: hudArea.name }),
          applicationDate: decision.applicationDate,
          submittedAt: at,
          consentId: consent.id,
          consentVersion: consent.copyVersion,
          consentGrantedAt: consent.grantedAt,
          decidedAt: at,
          decidedBy: "engine",
          expiresAt: decision.validUntil ? endOfCentralDay(decision.validUntil) : null,
          passportSourceDecidedAt: source.decidedAt,
          passportSourceRecordSha256: recordSha,
          updatedAt: at,
        })
        .where(eq(schema.verifications.id, v.id))
        .returning();
      await replaceDocumentIncomeItems(tx, v.id, documentItems, at);
      await recordVerificationEvent(tx, v.id, "decision.made", { type: "system", id: null }, { status: "eligible", method: decision.method, reasonCodes, missingCodes: [], engineVersion: decision.engineVersion, passport: true });
      await recordVerificationEvent(tx, v.id, "passport.reused", { type: "family", id: actor.userId }, { sourceVerificationId: source.id, sourceRecordSha256: recordSha, consentId: consent.id });
      await audit(
        {
          actor: familyAuditActor(actor),
          orgId: v.orgId,
          action: "verification.passport_reuse",
          target: { type: "verification", id: v.id },
          metadata: { outcome: "reused", sourceVerificationId: source.id, consentId: consent.id, method: decision.method, ...copied },
          request: actor.request,
        },
        tx,
      );
      await scheduleDecidedFollowUps(tx, updated, at);
      return { outcome: "reused", verification: await buildFamilyView(tx, updated) };
    }

    // Fall back to the normal flow: the reuse did not stand, so no passport is recorded, and everything copied stays.
    const [fallback] = await tx
      .update(schema.verifications)
      .set({ passportSourceId: null, passportSourceDecidedAt: null, passportSourceRecordSha256: null, stage: laterStage(v.stage, copied.documents > 0 ? "collecting" : "household"), updatedAt: at })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    await recordVerificationEvent(tx, v.id, "passport.fallback", { type: "system", id: null }, { sourceVerificationId: source.id, rerunStatus: decision.status, reasonCodes, missingCodes: decision.missing.map((m) => m.code) });
    await audit(
      {
        actor: familyAuditActor(actor),
        orgId: v.orgId,
        action: "verification.passport_reuse",
        target: { type: "verification", id: v.id },
        metadata: { outcome: "fallback", sourceVerificationId: source.id, consentId: consent.id, rerunStatus: decision.status, reasonCodes, ...copied },
        request: actor.request,
      },
      tx,
    );
    return { outcome: "fallback", verification: await buildFamilyView(tx, fallback), rerun: { status: decision.status, reasonCodes, explanation: explainDecision(decision, locale).family } };
  });
}
