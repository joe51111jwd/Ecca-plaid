/**
 * Product policy of the verification lifecycle. None of these values comes from section 25F or the proposed
 * regulations (REG-117199-25); where the sources are silent the behaviour is a named constant here so it can be
 * found, questioned and changed in one place.
 */
import { MS } from "@/lib/clock";
import type { MemberKind, PathPreference, VerificationStage, VerificationStatus } from "@/db/schema";

/** How long a family link works after the SGO creates the verification. */
export const FAMILY_LINK_TTL_DAYS = 30;
export const FAMILY_LINK_TTL_MS = FAMILY_LINK_TTL_DAYS * MS.day;
/** Bytes of randomness in a family link token (256 bits). Only its hash is stored. */
export const FAMILY_TOKEN_BYTES = 32;
/** Path of the family link; the token follows it. */
export const FAMILY_LINK_PATH = "/v";

/** Limits on what the SGO may attach when creating a verification. */
export const METADATA_LIMITS = Object.freeze({
  maxKeys: 20,
  maxKeyLength: 40,
  maxValueLength: 500,
  /** Bytes of the metadata object serialized as JSON. */
  maxTotalBytes: 8 * 1024,
});
export const MAX_EXTERNAL_REF_LENGTH = 200;
export const MAX_RETURN_URL_LENGTH = 2000;
export const MAX_APPLICANT_NAME_LENGTH = 200;
export const MAX_STUDENT_NAME_LENGTH = 100;

/** Per-verification upload limits (each file is also capped by storage.validateUpload at 15 MB). */
export const DOCUMENT_LIMITS = Object.freeze({
  maxActiveDocuments: 25,
  maxTotalBytes: 150 * 1024 * 1024,
});

/**
 * The sharing consent runs to the end of the calendar year after the day it is given (US Central). That covers
 * every validity period a decision can have (at most December 31 of the application year) even when the family
 * consents in December and submits in January, and it stays under CONSENT_MAX_PERIOD_DAYS (731).
 */
export const SHARE_CONSENT_YEARS_AFTER = 1;

/**
 * The application date is the day the family first submits; resubmitting after being asked for more keeps it.
 * The proposed rules do not define "the date of the application" (sgo-verification-rules.md, open question 7).
 */
export const APPLICATION_DATE_POLICY = "first_submission" as const;

/**
 * Age bands for members without a date of birth, by the kind the family chose. The household form defines
 * "adult" as 18 or older (households/validation.ts refuses a younger adult and tells families to choose "child" or
 * "other"), so "child" and "student" are read as under 18; "other" is asked about.
 * With a date of birth the age on the application date decides.
 */
export const UNDATED_MEMBER_AGE_BAND: Readonly<Record<MemberKind, "adult" | "minor" | "unknown">> = Object.freeze({
  adult: "adult",
  student: "minor",
  child: "minor",
  other: "unknown",
});
export const ADULT_AGE_YEARS = 18;

/** How long the decide job waits for documents still being read or data connections still syncing. */
export const DECIDE_WAIT = Object.freeze({
  delayMs: 30 * MS.second,
  /** After this many waits the decision is made with what is on file (a stuck extraction goes to review). */
  maxWaits: 60,
});

/** Where SGO staff open a verification in the dashboard (linked from reviewer emails). */
export const SGO_VERIFICATION_PATH = (id: string): string => `/sgo/verifications/${encodeURIComponent(id)}`;
/** Where the family sees its verification after signing in (linked from family emails). */
export const FAMILY_VERIFICATION_PATH = (id: string): string => `/family/verifications/${encodeURIComponent(id)}`;
/** API paths of the two evidence files. The API module serves them with `getEvidenceObject`. */
export const EVIDENCE_PDF_PATH = (id: string): string => `/api/v1/verifications/${encodeURIComponent(id)}/evidence.pdf`;
export const EVIDENCE_JSON_PATH = (id: string): string => `/api/v1/verifications/${encodeURIComponent(id)}/evidence.json`;

/** Roles whose members are emailed when a verification needs review. */
export const REVIEWER_ROLES = ["owner", "admin", "reviewer"] as const;

export const PATH_PREFERENCES: readonly PathPreference[] = ["upload", "auto_submit"];

/** Stages in lifecycle order; the family-side steps only ever move a verification forward through them. */
export const STAGE_ORDER: readonly VerificationStage[] = ["created", "started", "consented", "household", "collecting", "submitted", "processing", "awaiting_family", "in_review", "decided"];

/** Stages in which the family may still change what it provided. */
export const FAMILY_EDITABLE_STAGES: ReadonlySet<VerificationStage> = new Set(["started", "consented", "household", "collecting", "awaiting_family"]);

/** Statuses that end a verification. */
export const CLOSED_STATUSES: ReadonlySet<VerificationStatus> = new Set(["expired", "canceled"]);
export const DECIDED_STATUSES: ReadonlySet<VerificationStatus> = new Set(["eligible", "ineligible"]);

/* ------------------------------------------------------------------------------------------- review */

/**
 * Minimum SGO role for each kind of review access. The sharing consent tells the family that "if a person at
 * {organization} needs to review your case, they can also see the documents you uploaded", so raw files and
 * every change to the file are for reviewers; the detail page (names, extracted fields, decision) is for any
 * staff member. API keys get neither: the API surface carries no names, documents or extracted values.
 */
export const REVIEW_ACCESS = Object.freeze({
  detail: "viewer",
  viewDocument: "reviewer",
  act: "reviewer",
} as const);

export const REVIEW_QUEUE_LIMIT_DEFAULT = 25;
export const REVIEW_QUEUE_LIMIT_MAX = 100;

/** Limits on what a reviewer may send the family with requestMoreInfo. */
export const FAMILY_REQUEST_LIMITS = Object.freeze({
  maxMessageLength: 2000,
  maxItems: 20,
  maxItemLength: 300,
});

/** Upper bound for one reviewer-keyed income line: a sanity bound on input, not a rule from the sources. */
export const MAX_REVIEWER_INCOME_CENTS = 100_000_000_000;

/* ------------------------------------------------------------------------------------- retention */

/**
 * Uploads of a verification the family stopped working on before submitting (or after being asked for more and
 * never answering) are purged this many days after the verification last changed. The rows, hashes and
 * extracted fields stay; the documents stop counting, so the family uploads again if it comes back. No source
 * fixes a window: this keeps "no state without a retention rule" (emmy-reference-design.md 4b item 23).
 */
export const ABANDONED_UPLOAD_RETENTION_DAYS = 60;
/** Stages that count as abandoned when untouched for ABANDONED_UPLOAD_RETENTION_DAYS (status pending). */
export const ABANDONABLE_STAGES: readonly VerificationStage[] = ["started", "consented", "household", "collecting", "awaiting_family"];

/* -------------------------------------------------------------------------------------- passport */

/**
 * A passport reuse shares the earlier result until the last day that result is valid (`decision.validUntil` of
 * the source), the longest the consents service allows for a reuse.
 */
export const PASSPORT_SHARE_UNTIL_POLICY = "source_result_valid_until" as const;

/* --------------------------------------------------------------------------------- notifications */

/** Key in `sgo_profiles.settings` that holds the SGO's verification email preferences. */
export const SGO_NOTIFICATION_SETTINGS_KEY = "verificationEmails";
/** Defaults when the SGO has not chosen: reviewers hear about files that need them and about finished decisions. */
export const SGO_NOTIFICATION_DEFAULTS = Object.freeze({ needsReview: true, decided: true });
