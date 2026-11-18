/**
 * The family side of a verification: the link, signing in and binding it to the household, the sharing consent,
 * the household facts and the path preference. Every function takes the acting person and checks household
 * access itself; a verification of another household is reported as not found.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { CustodyInfo, PathPreference, VerificationLocale, VerificationStage, VerificationStatus } from "@/db/schema";
import { explainDecision, type Decision, type DecisionExplanation } from "@/engine/decision";
import { centralYear, now } from "@/lib/clock";
import { hashToken, safeEqual } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { assertHouseholdAccess } from "@/server/auth";
import { assertActiveConsent, grantConsent, renderConsent, type ConsentLocale, type RenderedConsent } from "@/server/consents";
import { emitEvent } from "@/server/events";
import { getHouseholdSnapshot, getOrCreateHouseholdForUser, householdCan, validateCustodyInfo, type CustodyValidation } from "@/server/households";
import { getSgoPolicy, getSgoProfile } from "@/server/sgos";
import {
  addVerificationFlag,
  assertFamilyEditable,
  familyAuditActor,
  laterStage,
  loadUser,
  recordVerificationEvent,
  requireFamilyAccess,
  type FamilyActor,
  type VerificationRow,
} from "./internal";
import { PATH_PREFERENCES, SHARE_CONSENT_YEARS_AFTER } from "./policy";
import { toApiVerification } from "./serialize";

/* ----------------------------------------------------------------------------------------- views */

/** What the family link page may show before anyone signs in. No names, no household data. */
export interface FamilyLinkView {
  id: string;
  orgName: string;
  mode: "test" | "live";
  status: VerificationStatus;
  stage: VerificationStage;
  locale: VerificationLocale;
  /** Someone already opened the link and bound it to a household. */
  started: boolean;
  linkExpiresAt: Date;
}

export type FamilyLinkState =
  | { state: "invalid" }
  | { state: "expired"; orgName: string }
  | { state: "canceled"; orgName: string }
  | { state: "active"; verification: FamilyLinkView };

/** The verification as the signed-in family sees it. */
export interface FamilyVerificationView {
  id: string;
  orgId: string;
  orgName: string;
  mode: "test" | "live";
  status: VerificationStatus;
  stage: VerificationStage;
  locale: VerificationLocale;
  householdId: string;
  pathPreference: PathPreference | null;
  consent: { id: string; version: string; grantedAt: Date } | null;
  household: { size: number; countyFips: string; countyName: string | null; studentMemberIds: string[]; custody: CustodyInfo | null; completedAt: Date } | null;
  applicationDate: string | null;
  incomeYear: number | null;
  provisional: boolean;
  /** Plain-language explanation of the latest decision step, in the family's language (never shows an income figure). */
  explanation: DecisionExplanation["family"] | null;
  expiresAt: Date | null;
  returnUrl: string | null;
}

async function orgNameOf(db: DbOrTx, orgId: string): Promise<string> {
  try {
    const sgo = await getSgoProfile(orgId, db);
    return sgo.profile.displayName || sgo.org.name;
  } catch (e) {
    if (!(e instanceof AppError && e.code === "not_found")) throw e;
    const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
    return org?.name ?? "";
  }
}

async function familyLocale(db: DbOrTx, v: VerificationRow): Promise<VerificationLocale> {
  if (!v.householdId) return v.locale;
  const [h] = await db.select({ locale: schema.households.locale }).from(schema.households).where(eq(schema.households.id, v.householdId)).limit(1);
  return h?.locale ?? v.locale;
}

export async function buildFamilyView(db: DbOrTx, v: VerificationRow): Promise<FamilyVerificationView> {
  if (!v.householdId) throw notFound("Verification");
  const locale = await familyLocale(db, v);
  const decision = v.decision as unknown as Decision | null;
  return {
    id: v.id,
    orgId: v.orgId,
    orgName: await orgNameOf(db, v.orgId),
    mode: v.mode,
    status: v.status,
    stage: v.stage,
    locale,
    householdId: v.householdId,
    pathPreference: v.pathPreference,
    consent: v.consentId && v.consentVersion && v.consentGrantedAt ? { id: v.consentId, version: v.consentVersion, grantedAt: v.consentGrantedAt } : null,
    household:
      v.householdCompletedAt && v.householdSize !== null && v.countyFips
        ? { size: v.householdSize, countyFips: v.countyFips, countyName: v.countyName, studentMemberIds: [...v.studentMemberIds], custody: v.custody, completedAt: v.householdCompletedAt }
        : null,
    applicationDate: v.applicationDate,
    incomeYear: v.incomeYear,
    provisional: v.provisional,
    explanation: decision && (v.status !== "pending" || v.stage === "awaiting_family") ? explainDecision(decision, locale).family : null,
    expiresAt: v.expiresAt,
    returnUrl: v.returnUrl,
  };
}

/* ------------------------------------------------------------------------------------------- link */

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

async function findByToken(db: DbOrTx, token: unknown, forUpdate = false): Promise<VerificationRow | null> {
  const raw = typeof token === "string" ? token.trim() : "";
  // Hash whatever arrived so a malformed token costs the same as a well-formed one.
  const hash = hashToken(raw);
  if (!TOKEN_SHAPE.test(raw)) return null;
  const q = db.select().from(schema.verifications).where(eq(schema.verifications.familyTokenHash, hash)).limit(1);
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row || !safeEqual(row.familyTokenHash, hash)) return null;
  return row;
}

function linkExpired(v: VerificationRow): boolean {
  return v.familyTokenExpiresAt.getTime() <= now().getTime();
}

/**
 * What the family link points at. Never throws for a bad, expired or canceled link: each is a typed state the page
 * renders. The lookup is by the token's hash, compared again in constant time.
 */
export async function getVerificationByFamilyToken(token: string, dbOrTx?: DbOrTx): Promise<FamilyLinkState> {
  const db = dbOrTx ?? (await getDb());
  const v = await findByToken(db, token);
  if (!v) return { state: "invalid" };
  const orgName = await orgNameOf(db, v.orgId);
  if (v.status === "canceled") return { state: "canceled", orgName };
  if (v.status === "expired" || (linkExpired(v) && !v.householdId)) return { state: "expired", orgName };
  return {
    state: "active",
    verification: { id: v.id, orgName, mode: v.mode, status: v.status, stage: v.stage, locale: v.locale, started: v.householdId !== null, linkExpiresAt: v.familyTokenExpiresAt },
  };
}

/**
 * The signed-in person opens the link: the verification is bound to their household (created on first use), the
 * stage becomes "started" and `verification.started` is emitted. Idempotent for the same household. A link
 * already bound to another household is refused (conflict "link_used"); an unknown link is not_found; an expired
 * or canceled one is gone. An applicant-email mismatch is recorded as a reviewer-visible flag, never a block.
 */
export async function startVerification(token: string, userId: string, opts: { request?: FamilyActor["request"] } = {}, dbOrTx?: DbOrTx): Promise<FamilyVerificationView> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const v = await findByToken(tx, token, true);
    if (!v) throw notFound("Verification link");
    const user = await loadUser(tx, userId);
    if (v.status === "canceled") throw new AppError("gone", "This verification was canceled.", { reason: "verification_canceled" });
    if (v.status === "expired") throw new AppError("gone", "This verification has expired.", { reason: "verification_expired" });

    if (v.householdId) {
      try {
        await assertHouseholdAccess(user, v.householdId, tx);
      } catch (e) {
        if (e instanceof AppError && e.code === "not_found") throw conflict("This link has already been used by another household.", { reason: "link_used" });
        throw e;
      }
      return buildFamilyView(tx, v);
    }
    if (linkExpired(v)) throw new AppError("gone", "This link has expired. Ask the scholarship organization for a new one.", { reason: "link_expired" });

    const { household } = await getOrCreateHouseholdForUser(user.id, { locale: v.locale }, tx);
    const at = now();
    const [updated] = await tx
      .update(schema.verifications)
      .set({ householdId: household.id, stage: laterStage(v.stage, "started"), startedAt: at, startedByUserId: user.id, updatedAt: at })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    if (v.applicantEmail && v.applicantEmail !== user.email) {
      await addVerificationFlag(tx, updated, "applicant_email_mismatch", "The person who opened the family link signed in with a different email address than the one the organization gave for the applicant.");
    }
    await recordVerificationEvent(tx, v.id, "started", { type: "family", id: user.id }, { householdId: household.id, householdAccess: household.access });
    await emitEvent({ orgId: v.orgId, type: "verification.started", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: v.mode }, tx);
    await audit({ actor: { type: "user", id: user.id }, orgId: v.orgId, action: "verification.start", target: { type: "verification", id: v.id }, metadata: { householdId: household.id }, request: opts.request }, tx);
    const [fresh] = await tx.select().from(schema.verifications).where(eq(schema.verifications.id, v.id)).limit(1);
    return buildFamilyView(tx, fresh);
  });
}

/** The verification as the signed-in family member sees it. */
export async function getFamilyVerification(verificationId: string, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<FamilyVerificationView> {
  const db = dbOrTx ?? (await getDb());
  const { verification } = await requireFamilyAccess(db, verificationId, actor);
  return buildFamilyView(db, verification);
}

/* ---------------------------------------------------------------------------------------- consent */

function shareUntil(): string {
  return `${centralYear(now()) + SHARE_CONSENT_YEARS_AFTER}-12-31`;
}

async function sharingVars(db: DbOrTx, v: VerificationRow) {
  const policy = await getSgoPolicy(v.orgId, db);
  return { organizationName: await orgNameOf(db, v.orgId), shareUntil: shareUntil(), uploadRetentionDays: policy.rawRetentionDays };
}

/** The exact sharing-consent words to show: who receives what, for what purpose and for how long. */
export async function previewSharingConsent(verificationId: string, actor: FamilyActor, locale: ConsentLocale, dbOrTx?: DbOrTx): Promise<RenderedConsent> {
  const db = dbOrTx ?? (await getDb());
  const { verification } = await requireFamilyAccess(db, verificationId, actor);
  return renderConsent("verification_share", locale, await sharingVars(db, verification));
}

const consentInput = z.strictObject({
  locale: z.enum(["en", "es"]),
  /** SHA-256 of the text the person saw (from previewSharingConsent). Refused if the wording changed since. */
  shownSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

/**
 * The household owner instructs the share in writing: a `verification_share` consent naming the SGO and the
 * retention window. Stage becomes "consented". Only the owner may give it (consents service: forbidden otherwise).
 */
export async function recordSharingConsent(verificationId: string, actor: FamilyActor, input: { locale: ConsentLocale; shownSha256?: string | null }, dbOrTx?: DbOrTx): Promise<FamilyVerificationView> {
  const parsed = consentInput.safeParse(input);
  if (!parsed.success) throw invalid("The consent request is not valid.", { fields: { locale: "Choose English or Spanish." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { verification: v } = await requireFamilyAccess(tx, verificationId, actor, { forUpdate: true });
    assertFamilyEditable(v);
    const vars = await sharingVars(tx, v);
    const { consent } = await grantConsent(
      {
        kind: "verification_share",
        userId: actor.userId,
        householdId: v.householdId,
        verificationId: v.id,
        recipientOrgId: v.orgId,
        locale: parsed.data.locale,
        vars: { shareUntil: vars.shareUntil, uploadRetentionDays: vars.uploadRetentionDays },
        shownSha256: parsed.data.shownSha256 ?? null,
        request: actor.request,
      },
      tx,
    );
    const [updated] = await tx
      .update(schema.verifications)
      .set({ consentId: consent.id, consentVersion: consent.copyVersion, consentGrantedAt: consent.grantedAt, stage: laterStage(v.stage, "consented"), updatedAt: now() })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    await recordVerificationEvent(tx, v.id, "consent.granted", { type: "family", id: actor.userId }, { consentId: consent.id, copyVersion: consent.copyVersion, locale: consent.locale });
    return buildFamilyView(tx, updated);
  });
}

/* -------------------------------------------------------------------------------------- household */

export interface CompleteHouseholdInput {
  /** Shared-custody answers (households.validateCustodyInfo input). */
  custody: unknown;
  /** The students this verification is for; default every student on the roster. */
  studentMemberIds?: string[] | null;
}

export interface CompleteHouseholdResult {
  verification: FamilyVerificationView;
  /** What a reviewer will be asked about the living arrangement (never a block for the family). */
  custody: CustodyValidation;
}

const GAP_FIELDS: Record<string, string> = {
  owner_member: "Add yourself to the household.",
  student: "Add at least one student.",
  address: "Enter the home address.",
  county: "Choose the Texas county where the household lives.",
};

/**
 * Validates the household through the households service (a resolved Texas county with an income-limit area, at
 * least one student, the roster) and the custody answers through validateCustodyInfo, then snapshots size,
 * county, HUD area, students and custody onto the verification. Stage becomes "household". Owner only; requires
 * the sharing consent.
 */
export async function completeHousehold(verificationId: string, actor: FamilyActor, input: CompleteHouseholdInput, dbOrTx?: DbOrTx): Promise<CompleteHouseholdResult> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { verification: v, access } = await requireFamilyAccess(tx, verificationId, actor, { forUpdate: true });
    if (!householdCan(access.access, "edit_household")) throw forbidden("Only the adult in charge of this household can do this.");
    assertFamilyEditable(v);
    await assertActiveConsent(v.id, "verification_share", tx);

    const snapshot = await getHouseholdSnapshot(v.householdId!, {}, tx);
    if (snapshot.missing.length > 0) {
      const fields: Record<string, string> = {};
      for (const gap of snapshot.missing) fields[gap] = GAP_FIELDS[gap] ?? "Missing.";
      throw invalid("The household is not complete yet.", { fields, missing: snapshot.missing });
    }
    const county = snapshot.county!;
    if (!county.fips.startsWith("48") || !county.hudArea) throw invalid("The county must be a Texas county with a published income limit.", { fields: { county: GAP_FIELDS.county } });

    const requested = input.studentMemberIds ?? null;
    let students: string[];
    if (requested === null || requested.length === 0) {
      students = snapshot.studentIds;
    } else {
      const unique = [...new Set(requested)];
      if (unique.some((id) => !snapshot.studentIds.includes(id))) throw invalid("Choose students from the household.", { fields: { studentMemberIds: "Not a student in this household." } });
      students = unique;
    }

    const custody = validateCustodyInfo(input.custody);
    const at = now();
    const [updated] = await tx
      .update(schema.verifications)
      .set({
        householdSize: snapshot.size,
        countyFips: county.fips,
        countyName: county.name,
        hudAreaCode: county.hudArea.code,
        areaName: county.hudArea.name,
        studentMemberIds: students,
        custody: custody.custody,
        householdCompletedAt: at,
        stage: laterStage(v.stage, "household"),
        updatedAt: at,
      })
      .where(eq(schema.verifications.id, v.id))
      .returning();
    await recordVerificationEvent(tx, v.id, "household.completed", { type: "family", id: actor.userId }, {
      householdSize: snapshot.size,
      countyFips: county.fips,
      countyResolution: county.resolution,
      students: students.length,
      custodyFlags: custody.flags.map((f) => f.code),
    });
    await audit({ actor: familyAuditActor(actor), orgId: v.orgId, action: "verification.household_complete", target: { type: "verification", id: v.id }, metadata: { householdSize: snapshot.size, countyFips: county.fips }, request: actor.request }, tx);
    return { verification: await buildFamilyView(tx, updated), custody };
  });
}

/* ------------------------------------------------------------------------------------------- path */

/**
 * Upload or auto-submit. A preference, never a trap: switching keeps every document, certification and data
 * connection already provided. Requires the sharing consent.
 */
export async function setPathPreference(verificationId: string, actor: FamilyActor, preference: PathPreference, dbOrTx?: DbOrTx): Promise<FamilyVerificationView> {
  if (!PATH_PREFERENCES.includes(preference)) throw invalid("Choose upload or auto-submit.", { fields: { preference: "Must be upload or auto_submit." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { verification: v, access } = await requireFamilyAccess(tx, verificationId, actor, { forUpdate: true });
    if (!householdCan(access.access, "add_documents")) throw forbidden();
    assertFamilyEditable(v);
    await assertActiveConsent(v.id, "verification_share", tx);
    if (v.pathPreference === preference) return buildFamilyView(tx, v);
    const [updated] = await tx.update(schema.verifications).set({ pathPreference: preference, updatedAt: now() }).where(eq(schema.verifications.id, v.id)).returning();
    await recordVerificationEvent(tx, v.id, "path.changed", { type: "family", id: actor.userId }, { from: v.pathPreference, to: preference });
    return buildFamilyView(tx, updated);
  });
}
