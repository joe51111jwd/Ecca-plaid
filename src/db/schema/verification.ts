import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, bigint } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt, type Mode } from "./_shared";
import { objects, organizations, users } from "./core";

/* Households (the durable "passport" identity) -------------------------------------------------------- */

/** How the county was determined from the address. Self-selection is kept visible for reviewers. */
export type CountyResolution = "geocoder" | "zip_unique" | "self_selected";

export const households = pgTable(
  "households",
  {
    id: pk(),
    /** The adult who owns consent for this household. */
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    /** 5-digit county FIPS, e.g. "48201" (Harris). */
    countyFips: text("county_fips"),
    countyName: text("county_name"),
    countyResolution: text("county_resolution").$type<CountyResolution>(),
    locale: text("locale").$type<"en" | "es">().notNull().default("en"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("households_owner_idx").on(t.ownerUserId)],
);

export type MemberKind = "adult" | "student" | "child" | "other";

/** Every person residing with the student (the proposed-rule household). Family size = count of active rows. */
export const householdMembers = pgTable(
  "household_members",
  {
    id: pk(),
    householdId: text("household_id").notNull().references(() => households.id),
    kind: text("kind").$type<MemberKind>().notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Date of birth (YYYY-MM-DD), encrypted with encryptField(purpose "dob"). Collected only when the SGO application needs it. */
    dobEnc: text("dob_enc"),
    relationship: text("relationship"), // relationship to the student, free text / enum in UI
    /** Adults with their own sign-in (more than one adult may be on a household). */
    userId: text("user_id").references(() => users.id),
    isOwner: boolean("is_owner").notNull().default(false),
    createdAt: createdAt(),
    removedAt: ts("removed_at"),
  },
  (t) => [index("household_members_household_idx").on(t.householdId)],
);

export type ConsentKind = "verification_share" | "electronic_delivery" | "rail_connect" | "passport_reuse" | "donor_e_delivery";

/** Immutable record that a person agreed to a specific version of specific words at a specific time. */
export const consents = pgTable(
  "consents",
  {
    id: pk(),
    kind: text("kind").$type<ConsentKind>().notNull(),
    userId: text("user_id").references(() => users.id),
    householdId: text("household_id").references(() => households.id),
    verificationId: text("verification_id"),
    /** Organization that receives the data under this consent. */
    recipientOrgId: text("recipient_org_id").references(() => organizations.id),
    /** Version id of the consent copy shown (src/i18n consent copy registry) and the SHA-256 of the exact text. */
    copyVersion: text("copy_version").notNull(),
    copySha256: text("copy_sha256").notNull(),
    locale: text("locale").notNull().default("en"),
    /** Who receives what, for what purpose, for how long — the structured form of the plain-language text. */
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    grantedAt: ts("granted_at").notNull(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("consents_household_idx").on(t.householdId), index("consents_verification_idx").on(t.verificationId)],
);

/* Verifications --------------------------------------------------------------------------------------- */

/** Public status. `pending` covers everything before a decision; `stage` says where it is. */
export type VerificationStatus = "pending" | "eligible" | "ineligible" | "needs_review" | "expired" | "canceled";
export type VerificationStage =
  | "created" // SGO created it; family has not opened the link
  | "started" // family opened the link
  | "consented"
  | "household" // household form complete
  | "collecting" // uploading documents or connecting a rail
  | "submitted" // family pressed submit
  | "processing" // extraction + decision jobs running
  | "awaiting_family" // more information needed from the family
  | "in_review" // waiting on an SGO reviewer
  | "decided";
export type VerificationMethod = "direct" | "categorical";
export type ThresholdSource = "hud_provisional" | "irs_published";
export type PathPreference = "upload" | "auto_submit";
export type VerificationLocale = "en" | "es";

/**
 * Something a reviewer should see that does not block the family, e.g. the person who opened the link signed in
 * with a different email than the SGO gave. Appended, never silently removed.
 */
export interface VerificationFlag {
  code: string;
  /** One sentence for SGO staff. Never contains a household member's name or an email address. */
  message: string;
  /** ISO 8601 UTC timestamp. */
  at: string;
}

/** Shared-custody facts needed to apply the proposed household rule. Anything other than a clear answer is flagged for review. */
export interface CustodyInfo {
  livesInMultipleHouseholds: boolean;
  /** Months of the income year the student lived in THIS household (0-12), when known. */
  monthsInThisHousehold?: number | null;
  equalTime?: boolean;
  /** Only relevant when time is equal: is this the household with the higher income? */
  thisHouseholdHasHigherIncome?: "yes" | "no" | "unknown";
  notes?: string;
}

export const verifications = pgTable(
  "verifications",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id), // the SGO
    mode: text("mode").$type<Mode>().notNull().default("test"),
    status: text("status").$type<VerificationStatus>().notNull().default("pending"),
    stage: text("stage").$type<VerificationStage>().notNull().default("created"),
    method: text("method").$type<VerificationMethod>(),
    pathPreference: text("path_preference").$type<PathPreference>(),

    /* What the SGO told us when creating it */
    externalRef: text("external_ref"), // the SGO's own applicant/application id
    applicantEmail: text("applicant_email"),
    applicantName: text("applicant_name"),
    studentFirstName: text("student_first_name"),
    studentLastName: text("student_last_name"),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    returnUrl: text("return_url"),
    createdByType: text("created_by_type").$type<"api_key" | "user" | "handoff" | "passport">().notNull().default("user"),
    createdById: text("created_by_id"),

    /* Family access */
    familyTokenHash: text("family_token_hash").notNull(),
    familyTokenExpiresAt: ts("family_token_expires_at").notNull(),
    /** Language for the invitation and for messages sent before a household exists (the household's own locale wins afterwards). */
    locale: text("locale").$type<VerificationLocale>().notNull().default("en"),
    /** The signed-in person who first opened the family link and bound it to their household. */
    startedAt: ts("started_at"),
    startedByUserId: text("started_by_user_id").references(() => users.id),
    /** Reviewer-visible, non-blocking observations (see VerificationFlag). */
    flags: jsonb("flags").$type<VerificationFlag[]>().notNull().default([]),

    /* Links */
    householdId: text("household_id").references(() => households.id),
    consentId: text("consent_id").references(() => consents.id),
    /** Denormalized from the sharing consent so the API can show `consent.version` / `consent.granted_at` without a join. */
    consentVersion: text("consent_version"),
    consentGrantedAt: ts("consent_granted_at"),
    /** When the household facts (size, county, students, custody) were last snapshotted onto this verification. */
    householdCompletedAt: ts("household_completed_at"),
    handoffId: text("handoff_id"),
    /** Passport reuse: the earlier verification whose still-valid result this one reuses (with a fresh consent). */
    passportSourceId: text("passport_source_id"),
    /** When the reused result was decided (denormalized for the API's `passport.source_decided_at`). */
    passportSourceDecidedAt: ts("passport_source_decided_at"),
    studentMemberIds: jsonb("student_member_ids").$type<string[]>().notNull().default([]),
    custody: jsonb("custody").$type<CustodyInfo>(),

    /* Decision inputs + outputs (denormalized from `decision` for querying and the API) */
    applicationDate: text("application_date"), // YYYY-MM-DD the family submitted
    incomeYear: integer("income_year"), // the calendar year before the application
    householdSize: integer("household_size"),
    countyFips: text("county_fips"),
    countyName: text("county_name"),
    hudAreaCode: text("hud_area_code"),
    areaName: text("area_name"),
    medianIncomeCents: bigint("median_income_cents", { mode: "number" }),
    thresholdCents: bigint("threshold_cents", { mode: "number" }),
    thresholdSource: text("threshold_source").$type<ThresholdSource>(),
    thresholdTableVersion: text("threshold_table_version"),
    thresholdEffectiveDate: text("threshold_effective_date"),
    incomeCapPct: integer("income_cap_pct"),
    householdIncomeCents: bigint("household_income_cents", { mode: "number" }),
    awardProgram: text("award_program"), // SNAP | TANF | WIC | SECTION_8 | SSI (categorical)
    awardLetterDate: text("award_letter_date"), // YYYY-MM-DD
    /** True while the threshold comes from the HUD-derived provisional table. Every surface must show this. */
    provisional: boolean("provisional").notNull().default(true),
    /** Full engine output (src/engine/decision types). */
    decision: jsonb("decision").$type<Record<string, unknown>>(),
    decisionReasons: jsonb("decision_reasons").$type<Array<{ code: string; message: string }>>().notNull().default([]),
    decidedAt: ts("decided_at"),
    decidedBy: text("decided_by"), // "engine" or a reviewer's user id
    /** When the result stops being reusable. */
    expiresAt: ts("expires_at"),

    /* Evidence */
    evidencePdfObjectId: text("evidence_pdf_object_id").references(() => objects.id),
    evidenceJsonObjectId: text("evidence_json_object_id").references(() => objects.id),

    submittedAt: ts("submitted_at"),
    canceledAt: ts("canceled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("verifications_family_token_uq").on(t.familyTokenHash),
    index("verifications_org_idx").on(t.orgId, t.mode, t.createdAt),
    index("verifications_org_status_idx").on(t.orgId, t.status),
    index("verifications_household_idx").on(t.householdId),
    index("verifications_external_ref_idx").on(t.orgId, t.externalRef),
  ],
);

/** Timeline of a verification: every state change and notable action, shown in the dashboard and summarized in the evidence pack. */
export const verificationEvents = pgTable(
  "verification_events",
  {
    id: pk(),
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    type: text("type").notNull(), // e.g. "created", "consent.granted", "document.uploaded", "decision.made", "review.resolved"
    actorType: text("actor_type").$type<"family" | "user" | "api_key" | "system">().notNull(),
    actorId: text("actor_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("verification_events_ver_idx").on(t.verificationId, t.createdAt)],
);

/* Documents ------------------------------------------------------------------------------------------- */

export type DocumentKind = "award_letter" | "tax_return" | "irs_transcript" | "w2" | "pay_stub" | "other_income" | "unknown";
export type DocumentStatus = "uploaded" | "extracting" | "extracted" | "needs_review" | "rejected" | "purged";

export const documents = pgTable(
  "documents",
  {
    id: pk(),
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    householdId: text("household_id").notNull().references(() => households.id),
    /** What the parent said it was vs. what the classifier concluded. */
    declaredKind: text("declared_kind").$type<DocumentKind>().notNull(),
    detectedKind: text("detected_kind").$type<DocumentKind>(),
    /** Household member the document is about, when known. */
    memberId: text("member_id").references(() => householdMembers.id),
    objectId: text("object_id").notNull().references(() => objects.id),
    sha256: text("sha256").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    status: text("status").$type<DocumentStatus>().notNull().default("uploaded"),
    /** Extracted fields + per-field confidence + parser id/version, encrypted with encryptJson(purpose "extraction"). */
    extractionEnc: text("extraction_enc"),
    extractedBy: text("extracted_by").$type<"parser" | "model" | "reviewer">(),
    /** Reasons this document needs a human (failed parse, low confidence, mismatch). Never a silent yes. */
    reviewReasons: jsonb("review_reasons").$type<Array<{ code: string; message: string }>>().notNull().default([]),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    /** When the raw bytes are due to be purged (set at decision time from the SGO's retention window). */
    purgeAfter: ts("purge_after"),
    purgedAt: ts("purged_at"),
    /** When the parser or model finished reading the file. */
    extractedAt: ts("extracted_at"),
    /** The family took the document back before a decision. It no longer counts; its bytes are purged, its hash kept. */
    removedAt: ts("removed_at"),
    removedBy: text("removed_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("documents_verification_idx").on(t.verificationId),
    index("documents_purge_idx").on(t.purgeAfter),
    index("documents_verification_sha_idx").on(t.verificationId, t.sha256),
  ],
);

/* Income certifications ---------------------------------------------------------------------------------- */

/**
 * `zero_income`: the named member had no income in the income year. `no_other_income`: the household (or the named
 * member) had no income in the year beyond what the documents and data connections show. Proposed
 * Reg. 1.25F-3(c)(6)(iii)(A): "evidence of other income not reflected on such documents ... or a certification that
 * there is none".
 */
export type CertificationKind = "zero_income" | "no_other_income";

/**
 * A household adult's signed statement, stored like a consent: the exact versioned words (by version id and
 * SHA-256), the locale, the signer and the time. Immutable except `withdrawnAt`.
 */
export const verificationCertifications = pgTable(
  "verification_certifications",
  {
    id: pk(),
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    householdId: text("household_id").notNull().references(() => households.id),
    kind: text("kind").$type<CertificationKind>().notNull(),
    /** Member the statement is about; null for a household-wide no-other-income statement. */
    memberId: text("member_id").references(() => householdMembers.id),
    incomeYear: integer("income_year").notNull(),
    signedByUserId: text("signed_by_user_id").notNull().references(() => users.id),
    /** The signer's own household-member row (an adult). */
    signedByMemberId: text("signed_by_member_id").notNull().references(() => householdMembers.id),
    copyVersion: text("copy_version").notNull(),
    copySha256: text("copy_sha256").notNull(),
    locale: text("locale").$type<VerificationLocale>().notNull(),
    /** The variables the words were rendered with, so the text can be re-rendered and its hash re-checked. */
    vars: jsonb("vars").$type<Record<string, string | number>>().notNull().default({}),
    signedAt: ts("signed_at").notNull(),
    withdrawnAt: ts("withdrawn_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("verification_certifications_ver_idx").on(t.verificationId)],
);

/* Income ---------------------------------------------------------------------------------------------- */

export type IncomeSource = "document" | "rail" | "self_reported" | "reviewer";

/** One line of prior-year household cash income. The decision engine sums the `counted` rows. */
export const incomeItems = pgTable(
  "income_items",
  {
    id: pk(),
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    memberId: text("member_id").references(() => householdMembers.id),
    source: text("source").$type<IncomeSource>().notNull(),
    /** Category key from src/engine/income/categories.ts (wages, self_employment, child_support, ...). */
    category: text("category").notNull(),
    description: text("description"),
    incomeYear: integer("income_year").notNull(),
    annualAmountCents: bigint("annual_amount_cents", { mode: "number" }).notNull(),
    /** False for non-cash or disregarded items (kept for the audit trail, excluded from the total). */
    counted: boolean("counted").notNull().default(true),
    basis: text("basis"), // short citation / reason for counted or not
    documentId: text("document_id").references(() => documents.id),
    railConnectionId: text("rail_connection_id"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("income_items_verification_idx").on(t.verificationId)],
);

/* Data rails (auto-submit) ---------------------------------------------------------------------------- */

export type RailStatus = "created" | "connecting" | "connected" | "syncing" | "ready" | "failed" | "declined" | "revoked";

export const railConnections = pgTable(
  "rail_connections",
  {
    id: pk(),
    householdId: text("household_id").notNull().references(() => households.id),
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    memberId: text("member_id").references(() => householdMembers.id),
    provider: text("provider").$type<"simulated" | "plaid" | "irs_transcript">().notNull(),
    kind: text("kind").$type<"payroll" | "bank" | "transcript">().notNull().default("payroll"),
    status: text("status").$type<RailStatus>().notNull().default("created"),
    externalId: text("external_id"),
    /** Provider access credential, encrypted with encryptField(purpose "rail-token"). */
    accessTokenEnc: text("access_token_enc"),
    /** Normalized income report (src/server/rails types), encrypted with encryptJson(purpose "rail-report"). */
    reportEnc: text("report_enc"),
    reportSha256: text("report_sha256"),
    consentId: text("consent_id").references(() => consents.id),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rail_connections_verification_idx").on(t.verificationId)],
);

/* Human review ---------------------------------------------------------------------------------------- */

export const reviewTasks = pgTable(
  "review_tasks",
  {
    id: pk(),
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    orgId: text("org_id").notNull().references(() => organizations.id),
    status: text("status").$type<"open" | "resolved">().notNull().default("open"),
    reasons: jsonb("reasons").$type<Array<{ code: string; message: string }>>().notNull().default([]),
    assignedTo: text("assigned_to").references(() => users.id),
    resolution: text("resolution").$type<"eligible" | "ineligible" | "request_more_info" | "canceled">(),
    resolutionNotes: text("resolution_notes"),
    resolvedBy: text("resolved_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("review_tasks_org_idx").on(t.orgId, t.status), index("review_tasks_verification_idx").on(t.verificationId)],
);

/* Scholarship awards (an SGO decision; never automatic after verification) ----------------------------- */

export type AwardStatus = "offered" | "accepted" | "paid" | "declined" | "revoked";

export const awards = pgTable(
  "awards",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id), // the SGO
    verificationId: text("verification_id").notNull().references(() => verifications.id),
    handoffId: text("handoff_id"),
    studentMemberId: text("student_member_id").references(() => householdMembers.id),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: text("status").$type<AwardStatus>().notNull().default("offered"),
    /** How the SGO intends to pay the qualified expense. */
    paymentMethod: text("payment_method").$type<"direct_to_vendor" | "qualified_digital_wallet" | "other">().notNull().default("direct_to_vendor"),
    notes: text("notes"),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: ts("decided_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("awards_org_idx").on(t.orgId), index("awards_verification_idx").on(t.verificationId), index("awards_handoff_idx").on(t.handoffId)],
);
