/**
 * Types shared by the document reader: classification, extraction, review reasons and policy.
 *
 * Pure data. Everything here can be stored as JSON (inside `documents.extraction_enc`) and re-read without
 * loss. Money is integer cents; dates are `YYYY-MM-DD` strings.
 *
 * Facts behind the rules are in docs/reference/documents-and-parsers.md (cited by section, e.g. "B4").
 */

/** Mirrors `DocumentKind` in src/db/schema/verification.ts (the engine may not import the schema). */
export type DocumentKind = "award_letter" | "tax_return" | "irs_transcript" | "w2" | "pay_stub" | "other_income" | "unknown";

export const DOCUMENT_KINDS: readonly DocumentKind[] = ["award_letter", "tax_return", "irs_transcript", "w2", "pay_stub", "other_income", "unknown"];

/** A calendar date written `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * The specific document type. Each subtype belongs to exactly one `DocumentKind` (see `SUBTYPE_KIND`).
 * Names follow the issuing agency's own form names where one exists.
 */
export type DocumentSubtype =
  // Texas HHSC (B1-B16)
  | "tx_hhsc_tf0001"
  | "tx_hhsc_h1009"
  | "tx_hhsc_h1017"
  | "tx_hhsc_h1020"
  | "tx_hhsc_h1718"
  | "tx_hhsc_renewal"
  | "tx_hhsc_other"
  | "benefit_card"
  // WIC (C1-C7)
  | "wic_certification"
  | "wic_ineligible"
  | "wic_benefit_list"
  // Section 8 (D1-D9)
  | "hcv_voucher"
  | "hud_hap_contract"
  | "hud_50058"
  | "pha_notice"
  // SSA (E1-E9)
  | "ssa_benefit_verification"
  | "ssa_ssi_notice"
  | "ssa_title2_notice"
  | "ssa_other"
  // Look-alikes that never qualify
  | "school_meals_notice"
  | "unemployment_notice"
  // IRS (F, G, H)
  | "irs_w2"
  | "irs_w2c"
  | "form_1040"
  | "form_1040_variant"
  | "irs_tax_return_transcript"
  | "irs_wage_income_transcript"
  | "irs_record_of_account"
  | "irs_account_transcript"
  | "irs_verification_of_nonfiling"
  // Pay stubs (I, P10)
  | "pay_stub"
  | "unknown";

export const SUBTYPE_KIND: Readonly<Record<DocumentSubtype, DocumentKind>> = Object.freeze({
  tx_hhsc_tf0001: "award_letter",
  tx_hhsc_h1009: "award_letter",
  tx_hhsc_h1017: "award_letter",
  tx_hhsc_h1020: "award_letter",
  tx_hhsc_h1718: "award_letter",
  tx_hhsc_renewal: "award_letter",
  tx_hhsc_other: "award_letter",
  benefit_card: "award_letter",
  wic_certification: "award_letter",
  wic_ineligible: "award_letter",
  wic_benefit_list: "award_letter",
  hcv_voucher: "award_letter",
  hud_hap_contract: "award_letter",
  hud_50058: "award_letter",
  pha_notice: "award_letter",
  ssa_benefit_verification: "award_letter",
  ssa_ssi_notice: "award_letter",
  ssa_title2_notice: "award_letter",
  ssa_other: "award_letter",
  school_meals_notice: "award_letter",
  unemployment_notice: "other_income",
  irs_w2: "w2",
  irs_w2c: "w2",
  form_1040: "tax_return",
  form_1040_variant: "tax_return",
  irs_tax_return_transcript: "irs_transcript",
  irs_wage_income_transcript: "irs_transcript",
  irs_record_of_account: "irs_transcript",
  irs_account_transcript: "irs_transcript",
  irs_verification_of_nonfiling: "irs_transcript",
  pay_stub: "pay_stub",
  unknown: "unknown",
});

/** The five programs the proposed categorical method lists (A3). Closed on purpose: there is no "other". */
export type BenefitProgram = "SNAP" | "TANF" | "WIC" | "SECTION_8" | "SSI";
export const BENEFIT_PROGRAMS: readonly BenefitProgram[] = ["SNAP", "TANF", "WIC", "SECTION_8", "SSI"];

/** Programs that look like a qualifying award but are not on the list (A3, B10, D6, E1, E6). */
export type LookAlikeProgram =
  | "MEDICAID"
  | "CHIP"
  | "OTHER_HEALTH_CARE"
  | "SSDI"
  | "SOCIAL_SECURITY_RETIREMENT_SURVIVORS"
  | "MEDICARE_EXTRA_HELP"
  | "SPECIAL_VETERANS_BENEFITS"
  | "SCHOOL_MEALS"
  | "UNEMPLOYMENT"
  | "PUBLIC_HOUSING";

/** What the document says about the program it reports. `unclear` unless positively established. */
export type ApprovalStatus = "approved" | "denied" | "terminated" | "pending" | "unclear";

export type ExtractedBy = "parser" | "model";

/** A primitive field value. Structured data (rows, statements) lives in the typed summaries. */
export type FieldValue = string | number | boolean | null;

/** One extracted value with its provenance. `snippet` is redacted (no SSN, long identifiers masked). */
export interface ExtractedField {
  value: FieldValue;
  /** 0..1. How sure the reader is that `value` is what the document says. */
  confidence: number;
  /** 1-based page the value was read from; null when not tied to a page (derived values, model output). */
  page: number | null;
  snippet: string | null;
}

export type ExtractedFields = Record<string, ExtractedField>;

/** Reasons a person must look at the document before it is used. */
export const REVIEW_REASON_CODES = [
  "no_text_layer",
  "partial_text_layer",
  "pages_truncated",
  "unreadable_file",
  "encrypted_pdf",
  "unsupported_file_type",
  "unknown_document",
  "kind_mismatch",
  "low_confidence",
  "field_missing",
  "date_missing",
  "date_ambiguous",
  "language_unsupported",
  "layout_unverified",
  "review_required_by_policy",
  "checkbox_form",
  "multiple_outcomes",
  "approval_unclear",
  "not_a_decision",
  "no_ongoing_payment",
  "section8_not_yet_participating",
  "benefit_period_ended",
  "stale_document",
  "future_dated",
  "boundary_date",
  "name_not_in_household",
  "name_weak_match",
  "arithmetic_mismatch",
  "corrected_form",
  "draft_form",
  "unsupported_form_variant",
  "program_needs_review",
  "self_employment_indicated",
  "supports_nonfiler_statement",
  "pay_stub_review",
  "suspicious_instructions",
  "synthetic_fixture",
  "model_suggestion",
] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

/**
 * Reasons the document, though read, cannot serve as the proof asked for. These do not need a reviewer to
 * read the document again; the family is asked for another document (P2-P9). The decision service decides
 * what to do with them; a reviewer can always override.
 */
export const NOT_ACCEPTABLE_CODES = [
  "program_not_listed",
  "denial_or_termination",
  "ssa_not_ssi",
  "not_a_decision",
  "public_housing_not_section8",
  "return_on_file",
  "no_return_on_file",
] as const;
export type NotAcceptableCode = (typeof NOT_ACCEPTABLE_CODES)[number];

export interface DocumentIssue<C extends string> {
  code: C;
  /** One sentence for an SGO reviewer. Never contains an SSN or a full case number. */
  message: string;
}
export type ReviewReason = DocumentIssue<ReviewReasonCode>;
export type NotAcceptableReason = DocumentIssue<NotAcceptableCode>;

/* --------------------------------------------------------------------------------- summaries */

export interface BenefitPeriod {
  start: IsoDate | null;
  end: IsoDate | null;
}

/**
 * What the categorical decision needs from a benefits document. A document qualifies only when
 * `program` is non-null, `approvalStatus` is `approved`, the read status is `extracted` and no
 * not-acceptable reason is present; the 12-month window and household match are the decision's checks.
 */
export interface AwardLetterSummary {
  /** The listed program the document is about, or null when it is about none of the five. */
  program: BenefitProgram | null;
  /** Set when the document is about a program that is not on the list. */
  lookAlikeProgram: LookAlikeProgram | null;
  /** Notice or letter date: the date the document bears (P0 date rules). */
  letterDate: IsoDate | null;
  approvalStatus: ApprovalStatus;
  /** Addressee, case head or participant named as receiving the benefit. */
  recipientName: string | null;
  /** Every person the document lists as covered by the reported program. */
  householdMembers: string[];
  benefitPeriod: BenefitPeriod | null;
  /** Case, claim, voucher or EDG number masked to its last four characters, e.g. `******0001`. */
  caseNumberMasked: string | null;
  issuingAgency: string | null;
  /** Lowest confidence among the fields above that were read. */
  extractionConfidence: number;
  extractedBy: ExtractedBy;
}

/** A figure an income document reports. The income engine decides what counts; this only reports. */
export type IncomeMeasure =
  | "w2_box1_wages"
  | "w2_box3_social_security_wages"
  | "w2_box5_medicare_wages"
  | "f1040_wages_line_1a"
  | "f1040_wages_line_1z"
  | "f1040_taxable_interest"
  | "f1040_tax_exempt_interest"
  | "f1040_ordinary_dividends"
  | "f1040_ira_distributions_taxable"
  | "f1040_pensions_taxable"
  | "f1040_social_security_total"
  | "f1040_social_security_taxable"
  | "f1040_capital_gain"
  | "f1040_additional_income_schedule_1"
  | "f1040_total_income"
  | "f1040_adjustments"
  | "f1040_agi"
  | "transcript_wages"
  | "transcript_business_income"
  | "transcript_unemployment"
  | "transcript_social_security_total"
  | "transcript_pensions_total"
  | "transcript_ira_total"
  | "transcript_total_income"
  | "transcript_agi"
  | "wai_w2_wages"
  | "wai_1099_amount"
  | "paystub_gross_current"
  | "paystub_gross_ytd"
  | "paystub_net_current";

export interface IncomeAmount {
  measure: IncomeMeasure;
  /** Integer cents. Negative only for a reported loss. */
  amountCents: number;
  /** Person the figure belongs to, as printed (may be truncated on a transcript). Null when joint/unknown. */
  person: string | null;
  /** Payer or employer, as printed, when the figure is per payer. */
  payer: string | null;
  /** Category key from src/engine/income/categories.ts when the mapping is unambiguous; else null. */
  suggestedCategory: string | null;
  /** Which field in `fields` holds this figure. */
  fieldKey: string;
  confidence: number;
}

export interface IncomePerson {
  name: string;
  role: "employee" | "filer" | "spouse" | "dependent" | "taxpayer";
  /** True when the name is printed truncated/masked (IRS transcripts, H2). */
  masked: boolean;
  ssnLast4: string | null;
}

export interface IncomeDocumentSummary {
  taxYear: number | null;
  /** Pay stubs: the pay date year; the decision checks it against the income year. */
  people: IncomePerson[];
  amounts: IncomeAmount[];
  selfEmploymentIndicated: boolean;
  /** Pay stubs only. */
  payPeriod: BenefitPeriod | null;
  payDate: IsoDate | null;
  /** Pay stubs only: heuristic, see `isLikelyFinalStubOfYear`. Null when it cannot be told. */
  likelyFinalStubOfYear: boolean | null;
  extractionConfidence: number;
  extractedBy: ExtractedBy;
}

/** Result of one extractor. */
export interface Extraction {
  /** Version of the parser rules, recorded with every stored extraction. */
  parserVersion: string;
  subtype: DocumentSubtype;
  fields: ExtractedFields;
  /** Non-blocking observations for the reviewer (e.g. "box 13 check boxes are not read"). */
  warnings: string[];
  reviewReasons: ReviewReason[];
  notAcceptable: NotAcceptableReason[];
  /** Deterministic trail of what the extractor matched, for the reviewer and the evidence pack. */
  signals: string[];
  award: AwardLetterSummary | null;
  income: IncomeDocumentSummary | null;
}

/* ------------------------------------------------------------------------------------- policy */

/**
 * Policy knobs. Every number here is an engineering choice the sources do not fix; they are configurable so
 * an SGO or counsel decision can change them without code changes.
 */
export interface DocumentReaderPolicy {
  /** Fields below this confidence send the document to review. */
  minFieldConfidence: number;
  /**
   * Automatic acceptance of layouts no one has verified on a real current document (P2, P6, P9 [FC], item 31).
   * Off by default: with a flag off the document is `needs_review / layout_unverified` with fields pre-filled.
   */
  autoAcceptUnverifiedLayouts: {
    tf0001SnapTanf: boolean;
    ssiNoticeOfAward: boolean;
    taxReturnTranscript: boolean;
  };
  /** Days around the 12-month lower boundary that go to review (P0 date rules: "3 days", author's choice). */
  boundaryMarginDays: number;
  /** "tag": synthetic fixtures are read and marked; "reject": they go to review (production). */
  syntheticPolicy: "tag" | "reject";
  /** Byte and page caps for PDF reading. */
  maxPdfBytes: number;
  maxPdfPages: number;
  /** A page with fewer non-space characters than this has no usable text layer. */
  minTextCharsPerPage: number;
}

export const DEFAULT_DOCUMENT_POLICY: Readonly<DocumentReaderPolicy> = Object.freeze({
  minFieldConfidence: 0.8,
  autoAcceptUnverifiedLayouts: Object.freeze({ tf0001SnapTanf: false, ssiNoticeOfAward: false, taxReturnTranscript: false }),
  boundaryMarginDays: 3,
  syntheticPolicy: "tag",
  maxPdfBytes: 25 * 1024 * 1024,
  maxPdfPages: 40,
  minTextCharsPerPage: 25,
}) as Readonly<DocumentReaderPolicy>;

/** Bump when any extraction rule changes, so stored extractions can be re-run. */
export const PARSER_VERSION = "documents-parser.2026-11-18.v1";
