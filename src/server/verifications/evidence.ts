/**
 * The "evidence.generate" job: the decided verification is frozen into a signed JSON record and its PDF, both
 * stored encrypted (purposes "evidence_json" / "evidence_pdf"), and only THEN is `verification.decided` emitted,
 * so a webhook receiver can fetch the evidence as soon as it hears about the decision.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Decision } from "@/engine/decision";
import { describeThresholdSource, getTable } from "@/engine/ami";
import {
  buildSignedEvidence,
  EVIDENCE_JWKS_PATH,
  renderEvidencePdf,
  type EvidenceConsentInput,
  type EvidenceDocumentInput,
  type EvidenceExtractedFieldInput,
  type EvidenceIncomeItemInput,
  type EvidenceInput,
  type EvidenceMemberRole,
  type EvidenceRailInput,
  type EvidenceTimelineEntryInput,
} from "@/engine/evidence";
import { incomeCategoryLabel, INCOME_TAXONOMY_VERSION, type IncomeLine } from "@/engine/income";
import { BRAND } from "@/lib/brand";
import { now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { SYSTEM_ACTOR, audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { getHouseholdSnapshot } from "@/server/households";
import { enqueue } from "@/server/jobs";
import { getSgoProfile } from "@/server/sgos";
import { purgeObject, putObject } from "@/server/storage";
import { activeCertificationRows } from "./certifications";
import { readStoredExtraction } from "./documents";
import { emailFamily, requireDecision } from "./decide";
import { loadVerificationRow, recordVerificationEvent, type VerificationRow } from "./internal";
import { DECIDED_STATUSES } from "./policy";
import { toApiVerification } from "./serialize";

/** Job another module owns: tells the handoff that its verification changed. */
export const HANDOFF_VERIFICATION_UPDATED_JOB = "handoff.verification_updated";

const ROLE_OF: Record<string, EvidenceMemberRole> = { student: "student", adult: "adult", child: "child", other: "other" };

function humanize(code: string): string {
  const s = code.replace(/[_.]+/g, " ").trim();
  return s.length === 0 ? code : s[0]!.toUpperCase() + s.slice(1);
}

function extractedFields(stored: ReturnType<typeof readStoredExtraction>): EvidenceExtractedFieldInput[] {
  const fields = stored?.extraction?.fields ?? {};
  const out: EvidenceExtractedFieldInput[] = [];
  for (const [key, f] of Object.entries(fields)) {
    if (f.value === null) continue;
    const confidencePct = Math.max(0, Math.min(100, Math.round(f.confidence * 100)));
    if (typeof f.value === "number" && key.endsWith("_cents") && Number.isSafeInteger(f.value)) {
      out.push({ key, label: humanize(key.replace(/_cents$/, "")), amountCents: f.value, confidencePct });
    } else {
      out.push({ key, label: humanize(key), value: String(f.value).slice(0, 500), confidencePct });
    }
  }
  return out;
}

function incomeItems(lines: IncomeLine[], treatment: "counted" | "excluded" | "review"): EvidenceIncomeItemInput[] {
  return lines.map((l) => ({
    id: l.itemId,
    category: l.category,
    categoryLabel: incomeCategoryLabel(l.category),
    description: l.description,
    memberId: l.memberId,
    annualAmountCents: l.amountCents,
    treatment,
    basis: l.basis,
    source: l.source,
    documentId: l.documentId,
    railId: l.railConnectionId,
  }));
}

async function consentInput(db: DbOrTx, consentId: string, grantedBy: string): Promise<EvidenceConsentInput> {
  const [c] = await db.select().from(schema.consents).where(eq(schema.consents.id, consentId)).limit(1);
  if (!c) throw new AppError("internal", `Consent ${consentId} is missing`);
  return { id: c.id, kind: c.kind, copyVersion: c.copyVersion, copySha256: c.copySha256, locale: c.locale, grantedAt: c.grantedAt, grantedBy, scope: c.scope };
}

/** Everything the evidence engine needs about a decided verification. Reads only. */
export async function assembleEvidenceInput(db: DbOrTx, v: VerificationRow, generatedAt: Date): Promise<EvidenceInput> {
  const decision: Decision = requireDecision(v);
  if (!decision.threshold) throw new AppError("internal", `Verification ${v.id} was decided without a threshold`);
  if (!v.householdId || !v.consentId) throw new AppError("internal", `Verification ${v.id} is decided without a household or consent`);
  const [sgo, snapshot, household] = await Promise.all([
    getSgoProfile(v.orgId, db),
    getHouseholdSnapshot(v.householdId, {}, db),
    db.select().from(schema.households).where(eq(schema.households.id, v.householdId)).limit(1),
  ]);
  const nameOf = (memberId: string | null): string => {
    const m = snapshot.members.find((x) => x.id === memberId);
    return m ? `${m.firstName} ${m.lastName}` : "Household adult";
  };
  const owner = snapshot.members.find((m) => m.isOwner);

  const docs = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.verificationId, v.id), isNull(schema.documents.removedAt)))
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
  const objects = docs.length > 0 ? await db.select({ id: schema.objects.id, deletedAt: schema.objects.deletedAt }).from(schema.objects).where(inArray(schema.objects.id, docs.map((d) => d.objectId))) : [];
  const documents: EvidenceDocumentInput[] = docs.map((d) => ({
    id: d.id,
    kind: d.detectedKind && d.detectedKind !== "unknown" ? d.detectedKind : d.declaredKind,
    sha256: d.sha256,
    filename: d.filename,
    sizeBytes: d.size,
    contentType: d.contentType,
    uploadedAt: d.createdAt,
    extractedBy: d.extractedBy ?? "none",
    extractedFields: extractedFields(readStoredExtraction(d)),
    memberId: d.memberId,
    purgedAt: objects.find((o) => o.id === d.objectId)?.deletedAt ?? d.purgedAt ?? null,
  }));

  const railRows = await db
    .select()
    .from(schema.railConnections)
    .where(and(eq(schema.railConnections.verificationId, v.id), eq(schema.railConnections.status, "ready")))
    .orderBy(asc(schema.railConnections.createdAt));
  const rails: EvidenceRailInput[] = railRows
    .filter((r) => r.reportSha256)
    .map((r) => ({ id: r.id, provider: r.provider, kind: r.kind, reportSha256: r.reportSha256!, connectedAt: r.createdAt, retrievedAt: r.updatedAt, memberId: r.memberId, consentId: r.consentId }));

  const additionalConsents: EvidenceConsentInput[] = [];
  for (const r of railRows) if (r.consentId && r.consentId !== v.consentId && !additionalConsents.some((c) => c.id === r.consentId)) additionalConsents.push(await consentInput(db, r.consentId, nameOf(r.memberId)));
  for (const c of await activeCertificationRows(db, v.id)) {
    additionalConsents.push({
      id: c.id,
      kind: `income_certification_${c.kind}`,
      copyVersion: c.copyVersion,
      copySha256: c.copySha256,
      locale: c.locale,
      grantedAt: c.signedAt,
      grantedBy: nameOf(c.signedByMemberId),
      scope: { kind: c.kind, incomeYear: c.incomeYear, memberId: c.memberId, signedByMemberId: c.signedByMemberId },
    });
  }

  const events = await db.select().from(schema.verificationEvents).where(eq(schema.verificationEvents.verificationId, v.id)).orderBy(asc(schema.verificationEvents.createdAt), asc(schema.verificationEvents.id));
  const timeline: EvidenceTimelineEntryInput[] = events.map((e) => ({ at: e.createdAt, event: humanize(e.type), actor: { type: e.actorType === "system" && e.type === "decision.made" ? "engine" : e.actorType, id: e.actorType === "family" ? null : e.actorId } }));

  const t = decision.threshold;
  const table = getTable(t.tableVersion);
  const income = decision.income;
  const letter = decision.awardLetterDocumentId ? decision.letters.find((l) => l.documentId === decision.awardLetterDocumentId) : undefined;
  const letterDoc = letter ? docs.find((d) => d.id === letter.documentId) : undefined;

  return {
    verificationId: v.id,
    mode: v.mode,
    sgo: { id: sgo.org.id, name: sgo.profile.legalName || sgo.profile.displayName || sgo.org.name, ein: sgo.profile.ein },
    externalRef: v.externalRef,
    reusedFromVerificationId: v.passportSourceId,
    decision: {
      status: v.status as "eligible" | "ineligible",
      method: decision.method,
      reasons: decision.reasons.map((r) => ({ code: r.code, message: r.message, memberIds: r.memberIds, sourceIds: r.sourceIds })),
      decidedAt: v.decidedAt ?? generatedAt,
      decidedBy: { type: "engine" },
      applicationDate: decision.applicationDate,
      incomeYear: decision.incomeYear,
      expiresAt: v.expiresAt,
    },
    household: {
      id: snapshot.householdId,
      size: snapshot.size,
      members: snapshot.members.map((m) => ({ id: m.id, role: ROLE_OF[m.kind] ?? "other", firstName: m.firstName, lastName: m.lastName, relationship: m.relationship ? humanize(m.relationship) : null })),
      custody: v.custody ? { ...v.custody, outcome: decision.custody.outcome } : null,
    },
    geography: {
      state: "TX",
      countyFips: t.county.fips,
      countyName: t.county.name,
      areaCode: t.area.code,
      areaName: t.area.name,
      zip: household[0]?.zip ?? null,
      countyResolution: household[0]?.countyResolution ?? null,
    },
    threshold: { ...t, label: describeThresholdSource(table) },
    income: income
      ? {
          year: income.incomeYear,
          totalCountedCents: income.totalCountedCents,
          lowerBoundCents: income.lowerBoundCents,
          upperBoundCents: income.upperBoundCents,
          items: [...incomeItems(income.counted, "counted"), ...incomeItems(income.excluded, "excluded"), ...incomeItems(income.needsReview, "review")],
        }
      : null,
    categorical: letter
      ? {
          program: letter.program,
          letterDate: letter.letterDate,
          approvalStatus: letter.approvalStatus,
          issuingAgency: readStoredExtraction(letterDoc ?? { extractionEnc: null })?.extraction?.award?.issuingAgency ?? null,
          namedMemberId: letter.matchedMemberId,
          benefitPeriodEnd: letter.benefitPeriodEnd,
          documentId: letter.documentId,
        }
      : null,
    documents,
    rails,
    consent: await consentInput(db, v.consentId, owner ? `${owner.firstName} ${owner.lastName}` : nameOf(null)),
    additionalConsents,
    reviewTrail: [],
    timeline,
    generatedAt,
    versions: { engine: decision.engineVersion, taxonomy: income?.taxonomyVersion ?? INCOME_TAXONOMY_VERSION, ruleSet: decision.ruleSet.id },
  };
}

/**
 * Generates and stores the evidence pack of a decided verification, then emits `verification.decided`, emails the
 * family the outcome and, for a handoff, queues "handoff.verification_updated". Idempotent: a verification that
 * already has its evidence is left alone, and two concurrent runs keep only the first run's files.
 */
export async function generateEvidenceJob(verificationId: string): Promise<void> {
  const db = await getDb();
  const v = await loadVerificationRow(db, verificationId);
  if (!v || !DECIDED_STATUSES.has(v.status) || (v.evidencePdfObjectId && v.evidenceJsonObjectId)) return;

  const generatedAt = now();
  const signed = buildSignedEvidence(await assembleEvidenceInput(db, v, generatedAt));
  const pdf = await renderEvidencePdf(signed, { verifyUrl: appUrl(EVIDENCE_JWKS_PATH), brand: { name: BRAND.name } });
  const jsonObject = await putObject({ bytes: Buffer.from(JSON.stringify(signed), "utf8"), contentType: "application/json", purpose: "evidence_json", filename: `evidence-${v.id}.json`, orgId: v.orgId, householdId: v.householdId });
  const pdfObject = await putObject({ bytes: pdf, contentType: "application/pdf", purpose: "evidence_pdf", filename: `evidence-${v.id}.pdf`, orgId: v.orgId, householdId: v.householdId });

  const kept = await db.transaction(async (tx) => {
    const current = await loadVerificationRow(tx, v.id, { forUpdate: true });
    if (!current || !DECIDED_STATUSES.has(current.status) || current.evidencePdfObjectId || current.evidenceJsonObjectId || current.decidedAt?.getTime() !== v.decidedAt?.getTime()) return false;
    const [updated] = await tx
      .update(schema.verifications)
      .set({ evidencePdfObjectId: pdfObject.id, evidenceJsonObjectId: jsonObject.id, updatedAt: now() })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    await recordVerificationEvent(tx, v.id, "evidence.generated", { type: "system", id: null }, { recordSha256: signed.signature.record_sha256, kid: signed.signature.kid, pdfSha256: pdfObject.sha256, jsonSha256: jsonObject.sha256 });
    await audit({ actor: SYSTEM_ACTOR, orgId: v.orgId, action: "evidence.generate", target: { type: "verification", id: v.id }, metadata: { pdfObjectId: pdfObject.id, jsonObjectId: jsonObject.id, recordSha256: signed.signature.record_sha256 } }, tx);
    await emitEvent({ orgId: v.orgId, type: "verification.decided", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: v.mode }, tx);
    await emailFamily(tx, updated, requireDecision(updated), "outcome");
    if (updated.handoffId) {
      await enqueue(HANDOFF_VERIFICATION_UPDATED_JOB, { handoffId: updated.handoffId, verificationId: v.id }, { dedupeKey: `${HANDOFF_VERIFICATION_UPDATED_JOB}:${v.id}:${updated.decidedAt?.toISOString() ?? "decided"}` }, tx);
    }
    return true;
  });
  if (!kept) {
    await purgeObject(jsonObject.id, "evidence_superseded");
    await purgeObject(pdfObject.id, "evidence_superseded");
  }
}
