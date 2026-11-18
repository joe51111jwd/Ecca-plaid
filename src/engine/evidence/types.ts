/**
 * Types for the evidence pack: what the verification service hands the engine (`EvidenceInput`, camelCase),
 * the record an auditor or a machine reads (`EvidenceRecord`, snake_case), and the signed envelope.
 *
 * DATA-MINIMIZATION RULE (`EVIDENCE_POLICY.dataMinimizationRuleVersion`). The pack must let an auditor tie a
 * file to a scholarship applicant and test the decision, and nothing more:
 *  - Students are identified by full name and household-member id. An auditor has to match the file to the
 *    student the SGO awarded.
 *  - Every other household member appears as initials, role (adult, child, other) and relationship to the
 *    student, with a member id the SGO can resolve in its own records.
 *  - The adult who gave consent is named in the consent record, because a consent has to be attributable.
 *  - SGO staff who reviewed an exception are named. Family members acting in the timeline are not.
 *  - Never present: dates of birth, Social Security numbers (not even masked), street addresses, email
 *    addresses, phone numbers, bank or card numbers, raw files. The input types have no field for them, the
 *    builder copies only the fields declared here (an allow-list), drops extracted fields whose key names a
 *    birth date or an identity or account number, and removes any text shaped like a Social Security number.
 *  - Geography is the county, the income-limit area and the 5-digit ZIP code: what is needed to check that
 *    the right limit was applied.
 *  - Under the categorical method no income detail is carried. Proposed rules (REG-117199-25, preamble): the
 *    categorical method is intended to avoid collecting "more sensitive household-income information than is
 *    necessary".
 *
 * VALUES. Every leaf of an `EvidenceRecord` is a string, a safe integer, a boolean or null. There are no
 * floats: money is integer cents, the family-size multiplier is a decimal string, timestamps are ISO 8601
 * UTC strings (`2026-11-18T15:04:05.000Z`) and calendar dates are `YYYY-MM-DD`. That keeps the canonical
 * form, and so the signature, independent of number formatting.
 */

import type { KeyObject } from "node:crypto";

export const EVIDENCE_SCHEMA_VERSION = "1" as const;
export const EVIDENCE_RECORD_TYPE = "income_verification_evidence" as const;
/** RFC 8785 (JCS) restricted to objects, arrays, strings, safe integers, booleans and null: `canonicalJson` in src/lib/crypto. */
export const EVIDENCE_CANONICALIZATION = "ecca-jcs-1" as const;
export const EVIDENCE_SIGNATURE_ALG = "EdDSA" as const;
/** Where the public keys that verify evidence signatures are served. */
export const EVIDENCE_JWKS_PATH = "/.well-known/jwks.json" as const;

/** An instant: a `Date` or an ISO 8601 string with an explicit offset. The record stores it as UTC. */
export type TimestampInput = string | Date;

export type EvidenceMode = "test" | "live";
/** `needs_review` packs are interim: they document what is known while a reviewer works. */
export type EvidenceStatus = "eligible" | "ineligible" | "needs_review";
export type EvidenceMethod = "direct" | "categorical";
export type EvidenceThresholdSource = "hud_provisional" | "irs_published";
export type EvidenceMemberRole = "student" | "adult" | "child" | "other";
export type EvidenceCountyResolution = "geocoder" | "zip_unique" | "self_selected";
export type EvidenceDocumentKind = "award_letter" | "tax_return" | "irs_transcript" | "w2" | "pay_stub" | "other_income" | "unknown";
/** `none`: nothing was extracted from the file (for example an unreadable scan). */
export type EvidenceExtractor = "parser" | "model" | "reviewer" | "none";
export type EvidenceRailKind = "payroll" | "bank" | "transcript";
export type EvidenceIncomeSource = "document" | "rail" | "self_reported" | "reviewer";
/** The closed program list of the proposed categorical method. */
export type EvidenceProgram = "SNAP" | "TANF" | "WIC" | "SECTION_8" | "SSI";
export type EvidenceApprovalStatus = "current" | "not_current" | "unclear";
export type EvidenceActorType = "engine" | "system" | "reviewer" | "user" | "family" | "api_key";

/* ------------------------------------------------------------------------------------------- input */

export interface EvidenceReason {
  code: string;
  message: string;
}

export type EvidenceDecidedByInput =
  | { type: "engine" }
  /** A person resolved the verification. Identity and notes are mandatory: the pack must say who reviewed an exception and why. */
  | { type: "reviewer"; reviewerId: string; reviewerName: string; notes: string };

export interface EvidenceDecisionInput {
  status: EvidenceStatus;
  method: EvidenceMethod;
  reasons: EvidenceReason[];
  /** When the decision (or, for `needs_review`, the routing to review) was made. */
  decidedAt: TimestampInput;
  decidedBy: EvidenceDecidedByInput;
  /** Date of the scholarship application, YYYY-MM-DD. */
  applicationDate: string;
  /** The calendar year before the application date. */
  incomeYear: number;
  /** When the result stops being reusable; null or omitted when no expiry was set. */
  expiresAt?: TimestampInput | null;
}

export interface EvidenceHouseholdMemberInput {
  id: string;
  role: EvidenceMemberRole;
  firstName: string;
  lastName: string;
  /** Relationship to the student, as entered at intake. */
  relationship?: string | null;
}

/** Shared-custody facts, the same shape as `CustodyInfo` in src/db/schema/verification.ts. */
export interface EvidenceCustodyInput {
  livesInMultipleHouseholds: boolean;
  monthsInThisHousehold?: number | null;
  equalTime?: boolean | null;
  thisHouseholdHasHigherIncome?: "yes" | "no" | "unknown" | null;
  notes?: string | null;
}

export interface EvidenceHouseholdInput {
  /** The durable household id, when the SGO may see it. */
  id?: string | null;
  /** Family size: the number of persons in the household, including the student. Must equal `members.length`. */
  size: number;
  /** Everyone residing with the student, including at least one member with role `student`. */
  members: EvidenceHouseholdMemberInput[];
  custody?: EvidenceCustodyInput | null;
}

export interface EvidenceGeographyInput {
  /** Two-letter postal abbreviation of the state of residence, e.g. "TX". */
  state: string;
  /** 5-digit state + county FIPS code, e.g. "48201". */
  countyFips: string;
  countyName: string;
  /** Income-limit area code: the HUD area code while the table is HUD-derived. */
  areaCode: string;
  areaName: string;
  /** 5-digit ZIP code of the residence, when known. */
  zip?: string | null;
  /** How the county was determined from the address. */
  countyResolution?: EvidenceCountyResolution | null;
}

/** The exact wording shown next to the limit. `ThresholdSourceDescription` from src/engine/ami can be passed as is. */
export interface EvidenceThresholdLabelInput {
  copyVersion: string;
  badge: string;
  limitLabel: string;
  sourceLine: string;
  explanation: string;
  /** The sentence that explains why there is more than one reading and how decisions treat the gap, when the table has one. */
  readingsNote?: string | null;
}

/** One way of computing the limit from the table in use. `ThresholdReading` from src/engine/ami can be passed as is. */
export interface EvidenceThresholdReadingInput {
  id: string;
  label: string;
  /** The limit under this reading at `capPct`, in cents. */
  thresholdCents: number;
  /** The limit under this reading at the statutory 300 percent, in cents, when known. */
  statutoryThresholdCents?: number | null;
  /** The arithmetic in words and numbers. */
  formula: string;
}

/**
 * The limit and where it comes from. A `ThresholdResult` from src/engine/ami plus
 * `label: describeThresholdSource(table)` satisfies this type; fields this type does not declare are ignored.
 */
export interface EvidenceThresholdInput {
  /** The limit the decision reports, in cents, at `capPct`. Must equal the limit of one of `readings`. */
  thresholdCents: number;
  /** The same limit at the statutory 300 percent. */
  statutoryThresholdCents: number;
  /** Area median (four-person basis) in cents; null when the table does not print it. */
  medianIncomeCents: number | null;
  /** Family-size multiplier as a decimal string ("1.08"); null for tables with explicit limits. */
  multiplier: string | null;
  /** Percent of area median the limit is set at: 300, or an SGO's stricter cap. */
  capPct: number;
  source: EvidenceThresholdSource;
  tableVersion: string;
  /** Date the table took effect, YYYY-MM-DD. */
  effectiveDate: string;
  /** Method id of the table (`ThresholdMethod` in src/engine/ami), when known. */
  method?: string | null;
  formula: string;
  /** True while the table is HUD-derived. Must be true exactly when `source` is `hud_provisional`. */
  provisional: boolean;
  label: EvidenceThresholdLabelInput;
  /**
   * Every reading of the limit that was computed, at least one. While the table is HUD-derived the proposed
   * rule can be read two ways (docs/reference/sgo-verification-rules.md, F34), so there are usually two.
   */
  readings: EvidenceThresholdReadingInput[];
  /** The smallest reading. */
  lowerBoundCents: number;
  /** The largest reading. */
  upperBoundCents: number;
  /** True when every reading gives the same limit. */
  readingsAgree: boolean;
}

export interface EvidenceIncomeItemInput {
  id: string;
  /** Category key from the income taxonomy (src/engine/income). */
  category: string;
  categoryLabel: string;
  description?: string | null;
  /** Household member the income belongs to. */
  memberId?: string | null;
  annualAmountCents: number;
  /** False for items kept for the audit trail but left out of the total (non-cash or disregarded). */
  counted: boolean;
  /** Short reason or citation for counting or not counting the item. */
  basis?: string | null;
  source: EvidenceIncomeSource;
  /** Required when `source` is `document`; must be the id of an entry in `documents`. */
  documentId?: string | null;
  /** Required when `source` is `rail`; must be the id of an entry in `rails`. */
  railId?: string | null;
}

export interface EvidenceIncomeInput {
  /** Must equal `decision.incomeYear`. */
  year: number;
  /** Must equal the sum of the items with `counted: true`. */
  totalCountedCents: number;
  items: EvidenceIncomeItemInput[];
}

export interface EvidenceCategoricalInput {
  /** Null only while the verification needs review and the program could not be read. */
  program: EvidenceProgram | null;
  /** Date on the award letter, YYYY-MM-DD. Null only while the verification needs review. */
  letterDate: string | null;
  approvalStatus: EvidenceApprovalStatus;
  issuingAgency?: string | null;
  /** Household member the documentation names. */
  namedMemberId?: string | null;
  /** End of the certification or benefit period shown on the document, YYYY-MM-DD. */
  benefitPeriodEnd?: string | null;
  /** The entry in `documents` that carries the documentation. Required for an eligible decision. */
  documentId?: string | null;
}

/** One field read from a document. Give `value` (text, already redacted) or `amountCents` (money), never both. */
export interface EvidenceExtractedFieldInput {
  key: string;
  label: string;
  value?: string | null;
  amountCents?: number | null;
  /** Extraction confidence, whole percent 0 to 100. */
  confidencePct?: number | null;
}

export interface EvidenceDocumentInput {
  id: string;
  kind: EvidenceDocumentKind;
  /** SHA-256 of the stored bytes, computed server-side, 64 hex digits. */
  sha256: string;
  filename: string;
  sizeBytes: number;
  contentType?: string | null;
  uploadedAt: TimestampInput;
  /** Null is treated as `none`. */
  extractedBy: EvidenceExtractor | null;
  extractedFields: EvidenceExtractedFieldInput[];
  /** Household member the document is about. */
  memberId?: string | null;
  /** When the raw file was deleted. The hash and the extracted fields are kept. */
  purgedAt?: TimestampInput | null;
}

export interface EvidenceRailInput {
  id: string;
  provider: string;
  kind: EvidenceRailKind;
  /** SHA-256 of the normalized report the rail returned, 64 hex digits. */
  reportSha256: string;
  connectedAt: TimestampInput;
  /** When the report was retrieved. */
  retrievedAt?: TimestampInput | null;
  memberId?: string | null;
  /** The consent (in `consent` or `additionalConsents`) under which the connection was made. */
  consentId?: string | null;
}

export interface EvidenceConsentInput {
  id: string;
  /** Consent kind, e.g. `verification_share`, `rail_connect`, `passport_reuse`. */
  kind: string;
  copyVersion: string;
  /** SHA-256 of the exact words shown, 64 hex digits. */
  copySha256: string;
  locale: string;
  grantedAt: TimestampInput;
  /** Name of the adult who gave the consent. */
  grantedBy: string;
  /** Who receives what, for what purpose, for how long. Plain JSON without floats, at most four levels deep. */
  scope: Record<string, unknown>;
}

export interface EvidenceActorInput {
  type: EvidenceActorType;
  id?: string | null;
  /** Kept only for `reviewer` and `user` (SGO staff). Dropped for every other actor type. */
  name?: string | null;
}

export interface EvidenceReviewEntryInput {
  at: TimestampInput;
  actor: EvidenceActorInput;
  action: string;
  notes?: string | null;
}

export interface EvidenceTimelineEntryInput {
  at: TimestampInput;
  event: string;
  actor?: EvidenceActorInput | null;
  detail?: string | null;
}

export interface EvidenceVersionsInput {
  /** Decision engine version. */
  engine: string;
  /** Income taxonomy version. */
  taxonomy: string;
  /** Rule-set id the decision was made under, when the decision engine provides one. */
  ruleSet?: string | null;
}

/** Everything the verification service knows about one verification at the moment the pack is produced. */
export interface EvidenceInput {
  verificationId: string;
  mode: EvidenceMode;
  sgo: { id: string; name: string; ein?: string | null };
  /** The SGO's own applicant or application reference. */
  externalRef?: string | null;
  /** Passport reuse: the earlier verification whose result this one reuses. */
  reusedFromVerificationId?: string | null;
  decision: EvidenceDecisionInput;
  household: EvidenceHouseholdInput;
  geography: EvidenceGeographyInput;
  threshold: EvidenceThresholdInput;
  /** Required for the direct method; must be null or omitted for the categorical method. */
  income?: EvidenceIncomeInput | null;
  /** Required for the categorical method; must be null or omitted for the direct method. */
  categorical?: EvidenceCategoricalInput | null;
  documents: EvidenceDocumentInput[];
  rails: EvidenceRailInput[];
  /** The consent to share the verification with the SGO. */
  consent: EvidenceConsentInput;
  /** Other consents and attestations that belong to this verification (rail connection, passport reuse, certifications). */
  additionalConsents?: EvidenceConsentInput[];
  reviewTrail: EvidenceReviewEntryInput[];
  timeline: EvidenceTimelineEntryInput[];
  /** When the pack is produced. Passed in: the engine has no clock. */
  generatedAt: TimestampInput;
  versions: EvidenceVersionsInput;
}

/* ------------------------------------------------------------------------------------------ record */

/** Which figure a decided verification compared household income with. */
export type EvidenceReliedOn = "single_limit" | "lower_bound" | "upper_bound" | "none";

/** How the direct or categorical method was satisfied. */
export type EvidenceMethodBasis =
  | "written_documentation"
  | "other_relevant_data_sources"
  | "written_documentation_and_other_relevant_data_sources"
  | "categorical_documentation"
  | "none_recorded";

/** JSON value allowed inside a consent scope. */
export type EvidenceScopeValue = string | number | boolean | null | EvidenceScopeValue[] | { [key: string]: EvidenceScopeValue };

export interface EvidenceRecordActor {
  type: EvidenceActorType;
  id: string | null;
  name: string | null;
}

export interface EvidenceRecordConsent {
  id: string;
  kind: string;
  copy_version: string;
  copy_sha256: string;
  locale: string;
  granted_at: string;
  granted_by: string;
  scope: { [key: string]: EvidenceScopeValue };
}

export interface EvidenceRecordExtractedField {
  key: string;
  label: string;
  value: string | null;
  amount_cents: number | null;
  confidence_pct: number | null;
}

export interface EvidenceRecordDocument {
  id: string;
  kind: EvidenceDocumentKind;
  sha256: string;
  filename: string;
  size_bytes: number;
  content_type: string | null;
  uploaded_at: string;
  extracted_by: EvidenceExtractor;
  member_id: string | null;
  raw_file_status: "retained" | "purged";
  purged_at: string | null;
  extracted_fields: EvidenceRecordExtractedField[];
}

export interface EvidenceRecordRail {
  id: string;
  provider: string;
  kind: EvidenceRailKind;
  report_sha256: string;
  connected_at: string;
  retrieved_at: string | null;
  member_id: string | null;
  consent_id: string | null;
}

export interface EvidenceRecordIncomeItem {
  id: string;
  category: string;
  category_label: string;
  description: string | null;
  member_id: string | null;
  annual_amount_cents: number;
  counted: boolean;
  basis: string | null;
  source: EvidenceIncomeSource;
  document_id: string | null;
  rail_id: string | null;
}

/** The record that is canonicalized and signed. Schema policy: fields are only added within a schema version. */
export interface EvidenceRecord {
  schema_version: typeof EVIDENCE_SCHEMA_VERSION;
  record_type: typeof EVIDENCE_RECORD_TYPE;
  /** Version of the sentences the builder wrote into this record (`decision.summary`, `threshold.relied_on_statement`). */
  copy_version: string;
  verification_id: string;
  mode: EvidenceMode;
  generated_at: string;
  reused_from_verification_id: string | null;
  sgo: { id: string; name: string; ein: string | null; external_ref: string | null };
  decision: {
    status: EvidenceStatus;
    method: EvidenceMethod;
    method_label: string;
    method_basis: EvidenceMethodBasis;
    method_citation: string;
    /** The decision in words. The PDF prints this sentence unchanged. */
    summary: string;
    reasons: EvidenceReason[];
    application_date: string;
    income_year: number;
    decided_at: string;
    decided_by: { type: "engine" | "reviewer"; reviewer_id: string | null; reviewer_name: string | null; reviewer_notes: string | null };
    expires_at: string | null;
  };
  household: {
    id: string | null;
    size: number;
    students: Array<{ member_id: string; name: string }>;
    members: Array<{ member_id: string; role: EvidenceMemberRole; initials: string; relationship: string | null }>;
    custody: {
      lives_in_multiple_households: boolean;
      months_in_this_household: number | null;
      equal_time: boolean | null;
      this_household_has_higher_income: "yes" | "no" | "unknown" | null;
      notes: string | null;
    } | null;
  };
  geography: {
    state: string;
    county_fips: string;
    county_name: string;
    area_code: string;
    area_name: string;
    zip: string | null;
    county_resolution: EvidenceCountyResolution | null;
  };
  threshold: {
    limit_cents: number;
    statutory_limit_cents: number;
    median_income_cents: number | null;
    family_size_multiplier: string | null;
    cap_pct: number;
    source: EvidenceThresholdSource;
    table_version: string;
    effective_date: string;
    method: string | null;
    formula: string;
    provisional: boolean;
    label: { copy_version: string; badge: string; limit_label: string; source_line: string; explanation: string; readings_note: string | null };
    readings: Array<{ id: string; label: string; limit_cents: number; statutory_limit_cents: number | null; formula: string }>;
    lower_bound_cents: number;
    upper_bound_cents: number;
    readings_agree: boolean;
    relied_on: EvidenceReliedOn;
    /** The figure household income was compared with; null when no comparison decided the outcome. */
    relied_on_limit_cents: number | null;
    relied_on_statement: string;
  };
  income: { year: number; total_counted_cents: number; items: EvidenceRecordIncomeItem[] } | null;
  categorical: {
    program: EvidenceProgram | null;
    program_label: string | null;
    letter_date: string | null;
    approval_status: EvidenceApprovalStatus;
    issuing_agency: string | null;
    named_member_id: string | null;
    benefit_period_end: string | null;
    document_id: string | null;
  } | null;
  documents: EvidenceRecordDocument[];
  rails: EvidenceRecordRail[];
  consent: EvidenceRecordConsent;
  additional_consents: EvidenceRecordConsent[];
  review_trail: Array<{ at: string; actor: EvidenceRecordActor; action: string; notes: string | null }>;
  timeline: Array<{ at: string; event: string; actor: EvidenceRecordActor | null; detail: string | null }>;
  data_minimization: {
    rule_version: string;
    /** Social-Security-number-shaped tokens removed from free text while building the record. */
    ssn_patterns_removed: number;
    /** Extracted fields dropped because their key names a birth date or an identity or account number. */
    extracted_fields_removed: number;
  };
  versions: { engine: string; taxonomy: string; rule_set: string | null };
}

/* ------------------------------------------------------------------------------------------ signed */

export interface EvidenceSignature {
  alg: typeof EVIDENCE_SIGNATURE_ALG;
  /** Id of the signing key, matched against `kid` in the published key set. */
  kid: string;
  /** Ed25519 signature over the canonical bytes of `record`, base64url without padding. */
  value: string;
  canonicalization: typeof EVIDENCE_CANONICALIZATION;
  /** SHA-256 of the canonical bytes of `record`, lower-case hex. */
  record_sha256: string;
}

export interface SignedEvidence {
  record: EvidenceRecord;
  signature: EvidenceSignature;
}

/** Why a signed record did not verify. */
export type EvidenceVerifyFailure =
  | "malformed"
  | "unsupported_alg"
  | "unsupported_canonicalization"
  | "unsupported_schema"
  | "not_canonicalizable"
  | "record_hash_mismatch"
  | "unknown_kid"
  | "unsupported_key"
  | "malformed_signature"
  | "bad_signature";

export interface EvidenceVerification {
  valid: boolean;
  /** Present when `valid` is false. */
  reason?: EvidenceVerifyFailure;
  /** One sentence for a person, present when `valid` is false. */
  message?: string;
  /** The key id the record names; null when the envelope is too malformed to say. */
  kid: string | null;
}

/** A public key as published in a JWKS document. */
export type EvidenceJwk = Record<string, unknown>;
export interface EvidenceJwks {
  keys: EvidenceJwk[];
}

/** The private half used to sign. `SigningKey` from src/lib/crypto satisfies this. */
export interface EvidenceSigningKey {
  kid: string;
  privateKey: KeyObject;
}

/** A public key in memory. `SigningKey` from src/lib/crypto satisfies this. */
export interface EvidencePublicKey {
  kid: string;
  publicKey: KeyObject;
}

/* --------------------------------------------------------------------------------------------- pdf */

export interface EvidencePdfOptions {
  /** Absolute URL of the public key set, e.g. `https://example.org/.well-known/jwks.json`. Printed on the integrity page. */
  verifyUrl: string;
  /** Product identity printed in the page header and the document metadata (`BRAND.name` from src/lib/brand). */
  brand: { name: string };
}
