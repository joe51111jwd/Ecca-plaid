/**
 * Fields an SGO reviewer keys (or corrects) for a document the reader could not read or read with low confidence.
 * Pure: validates the reviewer's input against the reader's own vocabulary (document subtypes, the five programs,
 * approval statuses, income measures) and builds the same `Extraction` shape the parsers produce, so the mapping
 * to decision inputs (evidence-mapping.ts) treats a keyed document exactly like a read one, with confidence 1.
 */
import { z } from "zod";
import type { DocumentKind } from "@/db/schema";
import {
  BENEFIT_PROGRAMS,
  SUBTYPE_KIND,
  type AwardLetterSummary,
  type BenefitProgram,
  type DocumentSubtype,
  type ExtractedFields,
  type Extraction,
  type IncomeAmount,
  type IncomeDocumentSummary,
  type IncomeMeasure,
  type LookAlikeProgram,
} from "@/engine/documents";
import { invalid } from "@/lib/errors";
import type { StoredExtraction } from "./evidence-mapping";

/** Version recorded in `extraction.parserVersion` for reviewer-keyed fields. */
export const REVIEWER_EXTRACTION_VERSION = "reviewer-keyed.v1";

/** Bounds on reviewer input: sanity limits, not rules from the sources. */
export const REVIEWER_EXTRACTION_LIMITS = Object.freeze({
  maxAmounts: 60,
  maxPeople: 10,
  maxStatements: 10,
  maxHouseholdMembers: 30,
  maxTextLength: 200,
  maxNotesLength: 2000,
  /** One figure on one document: $10,000,000,000.00. */
  maxAmountCents: 1_000_000_000_000,
});

// Exhaustive by construction: adding a measure to the reader's type fails to compile until it is listed here.
const MEASURE_SET: Record<IncomeMeasure, true> = {
  w2_box1_wages: true,
  w2_box3_social_security_wages: true,
  w2_box5_medicare_wages: true,
  f1040_wages_line_1a: true,
  f1040_wages_line_1z: true,
  f1040_taxable_interest: true,
  f1040_tax_exempt_interest: true,
  f1040_ordinary_dividends: true,
  f1040_ira_distributions_taxable: true,
  f1040_pensions_taxable: true,
  f1040_social_security_total: true,
  f1040_social_security_taxable: true,
  f1040_capital_gain: true,
  f1040_additional_income_schedule_1: true,
  f1040_total_income: true,
  f1040_adjustments: true,
  f1040_agi: true,
  transcript_wages: true,
  transcript_business_income: true,
  transcript_unemployment: true,
  transcript_social_security_total: true,
  transcript_pensions_total: true,
  transcript_ira_total: true,
  transcript_total_income: true,
  transcript_agi: true,
  wai_w2_wages: true,
  wai_1099_amount: true,
  paystub_gross_current: true,
  paystub_gross_ytd: true,
  paystub_net_current: true,
};
export const INCOME_MEASURES = Object.keys(MEASURE_SET) as [IncomeMeasure, ...IncomeMeasure[]];

const LOOK_ALIKE_SET: Record<LookAlikeProgram, true> = {
  MEDICAID: true,
  CHIP: true,
  OTHER_HEALTH_CARE: true,
  SSDI: true,
  SOCIAL_SECURITY_RETIREMENT_SURVIVORS: true,
  MEDICARE_EXTRA_HELP: true,
  SPECIAL_VETERANS_BENEFITS: true,
  SCHOOL_MEALS: true,
  UNEMPLOYMENT: true,
  PUBLIC_HOUSING: true,
};
const LOOK_ALIKES = Object.keys(LOOK_ALIKE_SET) as [LookAlikeProgram, ...LookAlikeProgram[]];
const SUBTYPES = Object.keys(SUBTYPE_KIND) as [DocumentSubtype, ...DocumentSubtype[]];

/** Document kinds a reviewer can key: the ones the engines read evidence from. */
export const KEYABLE_KINDS = ["award_letter", "w2", "pay_stub", "tax_return", "irs_transcript"] as const satisfies readonly DocumentKind[];
export type KeyableKind = (typeof KEYABLE_KINDS)[number];

/** Measures each income kind may carry (the reader produces the same families of measures per kind). */
const MEASURE_PREFIXES: Readonly<Record<Exclude<KeyableKind, "award_letter">, readonly string[]>> = {
  w2: ["w2_"],
  pay_stub: ["paystub_"],
  tax_return: ["f1040_"],
  irs_transcript: ["transcript_", "wai_"],
};

/** Subtype used when the reviewer does not choose one. */
const DEFAULT_SUBTYPE: Readonly<Record<Exclude<KeyableKind, "award_letter">, DocumentSubtype>> = {
  w2: "irs_w2",
  pay_stub: "pay_stub",
  tax_return: "form_1040",
  irs_transcript: "irs_tax_return_transcript",
};
const DEFAULT_LETTER_SUBTYPE: Readonly<Record<BenefitProgram, DocumentSubtype>> = {
  SNAP: "tx_hhsc_other",
  TANF: "tx_hhsc_other",
  WIC: "wic_certification",
  SECTION_8: "pha_notice",
  SSI: "ssa_ssi_notice",
};

const CONTROL = /[\u0000-\u001f\u007f]/;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .refine((v) => !CONTROL.test(v), "must not contain control characters");
const name = text(REVIEWER_EXTRACTION_LIMITS.maxTextLength).refine((v) => v.length > 0, "must not be empty");
const isoDate = z.iso.date({ error: "must be a date written YYYY-MM-DD" });
const cents = z
  .number()
  .int({ error: "must be a whole number of cents" })
  .min(-REVIEWER_EXTRACTION_LIMITS.maxAmountCents)
  .max(REVIEWER_EXTRACTION_LIMITS.maxAmountCents);

const awardSchema = z.strictObject({
  program: z.enum(BENEFIT_PROGRAMS as [BenefitProgram, ...BenefitProgram[]]).nullable(),
  lookAlikeProgram: z.enum(LOOK_ALIKES).nullable().default(null),
  letterDate: isoDate.nullable(),
  approvalStatus: z.enum(["approved", "denied", "terminated", "pending", "unclear"]),
  recipientName: name.nullable(),
  householdMembers: z.array(name).max(REVIEWER_EXTRACTION_LIMITS.maxHouseholdMembers).default([]),
  benefitPeriod: z.strictObject({ start: isoDate.nullable(), end: isoDate.nullable() }).nullable().default(null),
  issuingAgency: name.nullable().default(null),
});

const incomeSchema = z.strictObject({
  taxYear: z.number().int().min(2000).max(2100).nullable(),
  payDate: isoDate.nullable().default(null),
  people: z
    .array(z.strictObject({ name, role: z.enum(["employee", "filer", "spouse", "dependent", "taxpayer"]) }))
    .max(REVIEWER_EXTRACTION_LIMITS.maxPeople)
    .default([]),
  amounts: z
    .array(
      z.strictObject({
        measure: z.enum(INCOME_MEASURES),
        amountCents: cents,
        person: name.nullable().default(null),
        payer: name.nullable().default(null),
        /** Which W-2 statement on the document (1 for the first); other kinds have one. */
        statement: z.number().int().min(1).max(REVIEWER_EXTRACTION_LIMITS.maxStatements).default(1),
      }),
    )
    .min(1, "Key at least one amount.")
    .max(REVIEWER_EXTRACTION_LIMITS.maxAmounts),
  selfEmploymentIndicated: z.boolean().default(false),
});

export const reviewerExtractionSchema = z
  .strictObject({
    kind: z.enum(KEYABLE_KINDS),
    subtype: z.enum(SUBTYPES).optional(),
    /** Household member the document is about, when the reviewer attributes it. */
    memberId: z.string().min(1).max(128).nullish(),
    /** Why the fields were keyed or corrected. */
    notes: text(REVIEWER_EXTRACTION_LIMITS.maxNotesLength).nullish(),
    award: awardSchema.nullish(),
    income: incomeSchema.nullish(),
  })
  .superRefine((input, ctx) => {
    if (input.subtype && SUBTYPE_KIND[input.subtype] !== input.kind) {
      ctx.addIssue({ code: "custom", path: ["subtype"], message: `is a ${SUBTYPE_KIND[input.subtype].replace(/_/g, " ")} type, not a ${input.kind.replace(/_/g, " ")}` });
    }
    if (input.kind === "award_letter") {
      if (!input.award) ctx.addIssue({ code: "custom", path: ["award"], message: "is required for an award letter" });
      if (input.income) ctx.addIssue({ code: "custom", path: ["income"], message: "must be left out for an award letter" });
      if (input.award && input.award.program !== null && input.award.lookAlikeProgram !== null) {
        ctx.addIssue({ code: "custom", path: ["award", "lookAlikeProgram"], message: "must be null when the program is one of the five listed programs" });
      }
      return;
    }
    if (input.award) ctx.addIssue({ code: "custom", path: ["award"], message: "must be left out for an income document" });
    if (!input.income) {
      ctx.addIssue({ code: "custom", path: ["income"], message: "is required for an income document" });
      return;
    }
    const prefixes = MEASURE_PREFIXES[input.kind];
    input.income.amounts.forEach((a, i) => {
      if (!prefixes.some((p) => a.measure.startsWith(p))) ctx.addIssue({ code: "custom", path: ["income", "amounts", i, "measure"], message: `is not a figure a ${input.kind.replace(/_/g, " ")} reports` });
      if (input.kind !== "w2" && a.statement !== 1) ctx.addIssue({ code: "custom", path: ["income", "amounts", i, "statement"], message: "only W-2 documents have more than one statement" });
    });
    if (input.kind === "pay_stub" && input.income.payDate === null) ctx.addIssue({ code: "custom", path: ["income", "payDate"], message: "is required for a pay stub" });
    if (input.kind !== "pay_stub" && input.income.taxYear === null) ctx.addIssue({ code: "custom", path: ["income", "taxYear"], message: "is required" });
    if (input.kind === "irs_transcript") {
      const subtype = input.subtype ?? DEFAULT_SUBTYPE.irs_transcript;
      const wageIncome = subtype === "irs_wage_income_transcript";
      input.income.amounts.forEach((a, i) => {
        if (wageIncome !== a.measure.startsWith("wai_")) {
          ctx.addIssue({ code: "custom", path: ["income", "amounts", i, "measure"], message: wageIncome ? "a wage and income transcript reports wai_ figures" : "a return transcript reports transcript_ figures" });
        }
      });
    }
  });

export type ReviewerExtractionInput = z.input<typeof reviewerExtractionSchema>;
export type ReviewerExtraction = z.output<typeof reviewerExtractionSchema>;

/** Parses reviewer input; throws validation_failed with `details.fields` keyed by path. */
export function parseReviewerExtraction(raw: unknown): ReviewerExtraction {
  const parsed = reviewerExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "fields"] ??= issue.message;
    throw invalid("The keyed fields are not valid.", { fields });
  }
  return parsed.data;
}

const field = (value: string | number | boolean | null): ExtractedFields[string] => ({ value, confidence: 1, page: null, snippet: null });

/**
 * Builds the stored extraction for reviewer-keyed fields. Every value has confidence 1: a person read it from the
 * document. The reader's earlier extraction is kept in `replacedExtraction`.
 */
export function buildReviewerExtraction(
  input: ReviewerExtraction,
  ctx: { reviewerId: string; keyedAt: Date; previous: StoredExtraction | null; previousExtractedBy: "parser" | "model" | "reviewer" | null },
): StoredExtraction {
  const fields: ExtractedFields = {};
  let award: AwardLetterSummary | null = null;
  let income: IncomeDocumentSummary | null = null;
  let subtype: DocumentSubtype;
  const signals = [`keyed by reviewer ${ctx.reviewerId}`];

  if (input.kind === "award_letter") {
    const a = input.award!;
    subtype = input.subtype ?? (a.program ? DEFAULT_LETTER_SUBTYPE[a.program] : "tx_hhsc_other");
    award = {
      program: a.program,
      lookAlikeProgram: a.lookAlikeProgram,
      letterDate: a.letterDate,
      approvalStatus: a.approvalStatus,
      recipientName: a.recipientName,
      householdMembers: a.householdMembers,
      benefitPeriod: a.benefitPeriod,
      caseNumberMasked: null,
      issuingAgency: a.issuingAgency,
      extractionConfidence: 1,
      // The reader's vocabulary has no "reviewer"; documents.extracted_by = "reviewer" is what the engines read.
      extractedBy: "parser",
    };
    fields.program = field(a.program ?? a.lookAlikeProgram ?? null);
    fields.letter_date = field(a.letterDate);
    fields.approval_status = field(a.approvalStatus);
    fields.recipient_name = field(a.recipientName);
    if (a.issuingAgency) fields.issuing_agency = field(a.issuingAgency);
    if (a.benefitPeriod?.start) fields.benefit_period_start = field(a.benefitPeriod.start);
    if (a.benefitPeriod?.end) fields.benefit_period_end = field(a.benefitPeriod.end);
  } else {
    const i = input.income!;
    subtype = input.subtype ?? DEFAULT_SUBTYPE[input.kind];
    const amounts: IncomeAmount[] = i.amounts.map((a, n) => {
      // W-2 statements are grouped by the part of the field key before the dot, with the tax year at `<prefix>.tax_year`.
      const fieldKey = input.kind === "w2" ? `w2_${a.statement}.${a.measure}_cents` : `${a.measure}_${n + 1}_cents`;
      fields[fieldKey] = field(a.amountCents);
      return { measure: a.measure, amountCents: a.amountCents, person: a.person, payer: a.payer, suggestedCategory: null, fieldKey, confidence: 1 };
    });
    if (input.kind === "w2") {
      for (const statement of new Set(i.amounts.map((a) => a.statement))) fields[`w2_${statement}.tax_year`] = field(i.taxYear);
    } else if (i.taxYear !== null) {
      fields.tax_year = field(i.taxYear);
    }
    if (i.payDate) fields.pay_date = field(i.payDate);
    income = {
      taxYear: i.taxYear,
      people: i.people.map((p) => ({ name: p.name, role: p.role, masked: false, ssnLast4: null })),
      amounts,
      selfEmploymentIndicated: i.selfEmploymentIndicated,
      payPeriod: null,
      payDate: i.payDate,
      likelyFinalStubOfYear: null,
      extractionConfidence: 1,
      extractedBy: "parser",
    };
  }

  const extraction: Extraction = {
    parserVersion: REVIEWER_EXTRACTION_VERSION,
    subtype,
    fields,
    warnings: ["Fields keyed by an SGO reviewer from the document."],
    reviewReasons: [],
    notAcceptable: [],
    signals,
    award,
    income,
  };
  return {
    readerStatus: "extracted",
    detectedKind: input.kind,
    extraction,
    extractedBy: null,
    synthetic: ctx.previous?.synthetic ?? false,
    model: null,
    pageCount: ctx.previous?.pageCount ?? null,
    textSource: ctx.previous?.textSource ?? "none",
    reviewerKeyed: { reviewerId: ctx.reviewerId, keyedAt: ctx.keyedAt.toISOString(), notes: input.notes ?? null, replacedExtractedBy: ctx.previousExtractedBy },
    replacedExtraction: ctx.previous?.reviewerKeyed ? (ctx.previous.replacedExtraction ?? null) : (ctx.previous?.extraction ?? null),
  };
}
