/**
 * One serializable object that drives every family screen: where the family is, what is done, what is still
 * missing (in English and Spanish), each document's plain-language status, data connections, whether an earlier
 * result can be reused, the outcome with its explanation and provisional note, and what happens next. Never an
 * income figure; never another household member's data beyond the names the family itself entered.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { DocumentKind, Mode, PathPreference, VerificationLocale, VerificationStage, VerificationStatus } from "@/db/schema";
import { describeThresholdSource, getTable } from "@/engine/ami";
import { explainDecision, type Decision } from "@/engine/decision";
import { listConnections, RAIL_STATUS_LABELS, type RailConnectionView } from "@/server/rails";
import { toCertificationView, type CertificationView } from "./certifications";
import { FAMILY_DOCUMENT_STATE_LABELS, FAMILY_STEP_LABELS, familyNextSteps, type Bilingual, type FamilyDocumentState, type FamilyStep } from "./copy";
import { familyLocale, orgNameOf } from "./family";
import { requireFamilyAccess, type DocumentRow, type FamilyActor, type VerificationRow } from "./internal";
import { findReusableResult, type ReusableResult } from "./passport";
import { CLOSED_STATUSES, FAMILY_EDITABLE_STAGES } from "./policy";

export interface FamilyViewDocument {
  id: string;
  filename: string;
  declaredKind: DocumentKind;
  memberId: string | null;
  state: FamilyDocumentState;
  label: Bilingual;
  carriedOver: boolean;
  uploadedAt: Date;
}

export interface FamilyViewRail {
  id: string;
  providerName: string;
  kind: string;
  status: string;
  label: Bilingual;
  sandbox: boolean;
  waiting: boolean;
  offerUpload: boolean;
  failureMessage: Bilingual | null;
}

export interface FamilyView {
  verificationId: string;
  orgName: string;
  /** Test-mode verifications are sandbox: never a real result. */
  sandbox: boolean;
  mode: Mode;
  locale: VerificationLocale;
  status: VerificationStatus;
  stage: VerificationStage;
  /** "closed" once canceled or expired. */
  currentStep: FamilyStep | "closed";
  steps: Array<{ step: FamilyStep; label: Bilingual; done: boolean; current: boolean }>;
  completedSteps: FamilyStep[];
  /** True while the family may still add or change what it provided. */
  canEdit: boolean;
  pathPreference: PathPreference | null;
  /** What is still needed, from the latest decision (pending only). */
  missing: Bilingual[];
  /** What a reviewer asked for, as they wrote it. */
  request: { message: string; items: string[]; requestedAt: string } | null;
  documents: FamilyViewDocument[];
  rails: FamilyViewRail[];
  certifications: CertificationView[];
  /** An earlier result with another organization that can be reused (only offered before submitting). */
  reusableResult: Pick<ReusableResult, "verificationId" | "orgName" | "decidedAt" | "validUntil"> | null;
  outcome: {
    status: "eligible" | "ineligible";
    headline: string;
    paragraphs: string[];
    provisional: boolean;
    /** The provisional-limit note in the family's language, while the limit is HUD-derived. */
    provisionalNote: string | null;
    expiresAt: Date | null;
    decidedByReviewer: boolean;
    reusedEarlierResult: boolean;
  } | null;
  /** Plain-language explanation of where things stand when there is no outcome yet (review, more information). */
  explanation: { headline: string; paragraphs: string[] } | null;
  whatHappensNext: Bilingual;
  provisional: boolean;
  returnUrl: string | null;
}

function documentState(d: DocumentRow): FamilyDocumentState {
  if (d.removedAt) return "removed";
  if (d.purgedAt || d.status === "purged") return "deleted_after_decision";
  if (d.sourceDocumentId) return "carried_over";
  if (d.extractedBy === "reviewer") return "checked_by_person";
  switch (d.status) {
    case "uploaded":
    case "extracting":
      return "reading";
    case "extracted":
      return "received";
    case "needs_review":
      return "needs_person";
    case "rejected":
      return "cannot_use";
  }
}

function currentStepOf(v: VerificationRow): FamilyStep | "closed" {
  if (CLOSED_STATUSES.has(v.status)) return "closed";
  if (v.status === "eligible" || v.status === "ineligible") return "outcome";
  if (!v.consentId) return "consent";
  if (!v.householdCompletedAt) return "household";
  if (v.status === "pending" && FAMILY_EDITABLE_STAGES.has(v.stage)) return "evidence";
  return "waiting";
}

const STEP_ORDER: readonly FamilyStep[] = ["consent", "household", "evidence", "waiting", "outcome"];

function provisionalNoteOf(decision: Decision, locale: VerificationLocale): string | null {
  if (!decision.thresholdTable.provisional) return null;
  try {
    return describeThresholdSource(getTable(decision.thresholdTable.tableVersion), locale).familyNote;
  } catch {
    // The table of an old decision may no longer be installed; `provisional: true` still labels the result.
    return null;
  }
}

function railLabel(c: RailConnectionView): FamilyViewRail {
  return {
    id: c.id,
    providerName: c.providerName,
    kind: c.kind,
    status: c.status,
    label: { en: RAIL_STATUS_LABELS[c.status].en, es: RAIL_STATUS_LABELS[c.status].es },
    sandbox: c.sandbox,
    waiting: c.waiting,
    offerUpload: c.offerUpload,
    failureMessage: c.failureMessage,
  };
}

/** Everything the family's screens show for one verification. The person must belong to its household. */
export async function getFamilyView(verificationId: string, userId: string): Promise<FamilyView> {
  const db = await getDb();
  const actor: FamilyActor = { userId };
  const { verification: v } = await requireFamilyAccess(db, verificationId, actor);
  const [locale, orgName, docs, certRows] = await Promise.all([
    familyLocale(db, v),
    orgNameOf(db, v.orgId),
    db.select().from(schema.documents).where(eq(schema.documents.verificationId, v.id)).orderBy(asc(schema.documents.createdAt), asc(schema.documents.id)),
    db
      .select()
      .from(schema.verificationCertifications)
      .where(and(eq(schema.verificationCertifications.verificationId, v.id), isNull(schema.verificationCertifications.withdrawnAt)))
      .orderBy(asc(schema.verificationCertifications.signedAt)),
  ]);
  const rails = (await listConnections(v.id, { userId })).map(railLabel);

  const current = currentStepOf(v);
  const currentIndex = current === "closed" ? -1 : STEP_ORDER.indexOf(current);
  const done = (step: FamilyStep): boolean => {
    if (step === "consent") return v.consentId !== null;
    if (step === "household") return v.householdCompletedAt !== null;
    if (step === "evidence") return v.submittedAt !== null && !(v.status === "pending" && v.stage === "awaiting_family");
    if (step === "waiting") return v.status === "eligible" || v.status === "ineligible";
    return v.status === "eligible" || v.status === "ineligible";
  };
  const steps = STEP_ORDER.map((step, i) => ({ step, label: FAMILY_STEP_LABELS[step], done: done(step), current: i === currentIndex }));

  const decision = (v.decision as unknown as Decision | null) ?? null;
  const canEdit = v.status === "pending" && FAMILY_EDITABLE_STAGES.has(v.stage);
  const awaiting = v.status === "pending" && v.stage === "awaiting_family";
  const missing: Bilingual[] = awaiting && decision ? decision.missing.map((m) => ({ en: m.message.en, es: m.message.es })) : [];

  let reusableResult: FamilyView["reusableResult"] = null;
  if (canEdit && !v.submittedAt && !v.evidenceCopiedFromId && v.householdId) {
    const found = await findReusableResult(v.householdId, v.orgId, { mode: v.mode }, db);
    if (found) reusableResult = { verificationId: found.verificationId, orgName: found.orgName, decidedAt: found.decidedAt, validUntil: found.validUntil };
  }

  let outcome: FamilyView["outcome"] = null;
  let explanation: FamilyView["explanation"] = null;
  if (decision && (v.status === "eligible" || v.status === "ineligible")) {
    const e = explainDecision(decision, locale).family;
    outcome = {
      status: v.status,
      headline: e.headline,
      paragraphs: e.paragraphs,
      provisional: v.provisional,
      provisionalNote: provisionalNoteOf(decision, locale),
      expiresAt: v.expiresAt,
      decidedByReviewer: v.decidedBy !== null && v.decidedBy !== "engine",
      reusedEarlierResult: v.passportSourceId !== null,
    };
  } else if (decision && (v.status === "needs_review" || awaiting)) {
    const e = explainDecision(decision, locale).family;
    explanation = { headline: e.headline, paragraphs: e.paragraphs };
  }

  const nextState =
    current === "closed"
      ? "closed"
      : v.status === "eligible" || v.status === "ineligible"
        ? v.status
        : v.status === "needs_review"
          ? "in_review"
          : awaiting
            ? "awaiting_family"
            : canEdit
              ? "evidence"
              : "waiting";

  return {
    verificationId: v.id,
    orgName,
    sandbox: v.mode === "test",
    mode: v.mode,
    locale,
    status: v.status,
    stage: v.stage,
    currentStep: current,
    steps,
    completedSteps: steps.filter((s) => s.done).map((s) => s.step),
    canEdit,
    pathPreference: v.pathPreference,
    missing,
    request: v.familyRequest ? { message: v.familyRequest.message, items: [...v.familyRequest.items], requestedAt: v.familyRequest.requestedAt } : null,
    documents: docs.map((d) => {
      const state = documentState(d);
      return { id: d.id, filename: d.filename, declaredKind: d.declaredKind, memberId: d.memberId, state, label: FAMILY_DOCUMENT_STATE_LABELS[state], carriedOver: d.sourceDocumentId !== null, uploadedAt: d.createdAt };
    }),
    rails,
    certifications: certRows.map(toCertificationView),
    reusableResult,
    outcome,
    explanation,
    whatHappensNext: familyNextSteps(nextState, orgName),
    provisional: v.provisional,
    returnUrl: v.returnUrl,
  };
}
