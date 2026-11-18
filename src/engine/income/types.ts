/**
 * Input and output types shared by the income computation, the coverage assessment, the evidence
 * reconciliation and the decision service, with the zod schemas that validate them at the boundary.
 *
 * Everything here is plain data (strings, safe integers, booleans, null, arrays, objects), so a result can
 * be stored as JSON and re-read without loss. Money is integer cents.
 */
import { z } from "zod";
import { invalid } from "@/lib/errors";
import { isIsoDate, type IsoDate } from "./calendar";

/** $10 billion. With at most `MAX_INCOME_ITEMS` lines, any sum of amounts stays a safe integer. */
export const MAX_AMOUNT_CENTS = 1_000_000_000_000;
export const MAX_INCOME_ITEMS = 1000;
export const MAX_HOUSEHOLD_MEMBERS = 60;

/* -------------------------------------------------------------------------------------- members */

/** `adult` means 18 or older. `unknown` is never treated as either: it is asked for. */
export type AgeBand = "adult" | "minor" | "unknown";

/**
 * A member's place in the household when it changes how income is treated.
 *  - `foster`, `live_in_aide`: their income is excluded (24 CFR 5.609(b)(8)).
 *  - `unrelated`: a person residing with the student who is not part of the student's family (a roommate
 *    or boarder). 24 CFR 5.609 speaks of "each member of the family" while the proposed section 25F rule
 *    measures the household; whether such a person's income counts is not settled by the sources, so it
 *    enters the upper bound of household income only.
 */
export type HouseholdRole = "family" | "foster" | "live_in_aide" | "unrelated";

/** Mirrors `MemberKind` in src/db/schema/verification.ts. Informational: the rules use the fields below. */
export type HouseholdMemberKind = "adult" | "student" | "child" | "other";

export interface HouseholdMemberInput {
  id: string;
  /** Name as the household entered it. Used only in messages shown to the household itself. */
  firstName: string;
  lastName?: string;
  kind?: HouseholdMemberKind;
  /** Whether the member is 18 or older. */
  ageBand: AgeBand;
  /** Head of household or the head's spouse: all of their income counts at any age (24 CFR 5.609(a)(1)). */
  headOrSpouse?: boolean;
  /** A dependent full-time student. Only matters for a member aged 18 or older who is not head or spouse. */
  fullTimeStudent?: boolean;
  /** Defaults to `family`. */
  role?: HouseholdRole;
}

/* ---------------------------------------------------------------------------------------- items */

/** Mirrors `IncomeSource` in src/db/schema/verification.ts. */
export type IncomeItemSource = "document" | "rail" | "self_reported" | "reviewer";

/** One line of household income for one calendar year. Mirrors a row of `income_items`. */
export interface IncomeItemInput {
  /** Unique within the list. */
  id: string;
  /** Member the income belongs to; null when it is not attributable to one member. */
  memberId: string | null;
  /** Other members the same figure covers, e.g. the second adult on a joint tax return. */
  alsoCoversMemberIds?: string[];
  /** Key from the income taxonomy (categories.ts). An unknown key is sent to review, never dropped. */
  category: string;
  incomeYear: number;
  /** The recorded figure for the year, in cents. Negative only for a net loss in a category that allows one. */
  annualAmountCents: number;
  /**
   * Bounds when the evidence supports more than one figure for the same income (for example Form W-2
   * box 1 against year-end gross pay). Default: both equal `annualAmountCents`. `lowCents` may not exceed
   * the recorded figure and `highCents` may not be below it.
   */
  lowCents?: number;
  highCents?: number;
  source: IncomeItemSource;
  /** Required for `document` items to count as documented. */
  documentId?: string | null;
  /** Required for `rail` items to count as documented. */
  railConnectionId?: string | null;
  description?: string | null;
}

/** Document kinds the direct method names. Mirrors the relevant values of `DocumentKind` in the schema. */
export type IncomeDocumentKind = "pay_stub" | "tax_return" | "irs_transcript" | "w2" | "other_income";

/** How one document behind the income items was read. */
export interface IncomeDocumentSource {
  documentId: string;
  kind: IncomeDocumentKind;
  extractedBy: "parser" | "model" | "reviewer";
  /** Lowest confidence among the fields used, from 0 to 1. Not applied to reviewer-keyed documents. */
  extractionConfidence: number;
}

export type IncomeCertificationKind = "zero_income" | "no_other_income";

/**
 * A signed statement by the household. Proposed Reg. 1.25F-3(c)(6)(iii)(A): "evidence of other income not
 * reflected on such documents ... or a certification that there is none".
 *  - `zero_income`: the named member had no income in the year.
 *  - `no_other_income`: there was no income in the year beyond what the documents and listed amounts show,
 *    for the named member or, with `memberId` null, for the whole household.
 */
export interface IncomeCertification {
  kind: IncomeCertificationKind;
  memberId: string | null;
  incomeYear: number;
  /** User or member id of the adult who signed. */
  signedBy: string;
  signedOn: IsoDate;
  /** Version of the exact certification wording that was signed. */
  copyVersion: string;
}

/* ---------------------------------------------------------------------------------------- flags */

/**
 * Something about the income picture a person may need to look at.
 *  - `bounded`: the uncertainty is captured by the lower and upper bounds of household income. It needs a
 *    person only when the limit falls between the bounds.
 *  - `blocking`: the uncertainty cannot be bounded, or the evidence itself is in doubt. The direct method
 *    never decides automatically while one is present.
 */
export type IncomeFlagSeverity = "bounded" | "blocking";

export const INCOME_FLAG_CODES = [
  "self_employment_income",
  "income_item_unknown_member",
  "category_member_mismatch",
  "unknown_income_category",
  "income_category_needs_review",
  "amount_basis_unsettled",
  "net_loss_not_offset",
  "dependent_deduction_amount_unconfirmed",
  "minor_head_or_spouse_income",
  "member_age_unknown",
  "unrelated_member_income",
  "income_figures_conflict",
  "pay_stub_projection_only",
  "wages_from_pay_stub_only",
  "tax_record_incompletely_read",
  "schedule_e_income_needs_review",
  "tax_records_overlap",
  "zero_income_certification_contradicted",
  "document_not_read",
  "document_read_by_model",
  "document_low_confidence",
  "evidence_source_unknown",
  "rail_bank_net_deposits",
] as const;
export type IncomeFlagCode = (typeof INCOME_FLAG_CODES)[number];

export interface IncomeReviewFlag {
  code: IncomeFlagCode;
  severity: IncomeFlagSeverity;
  /** One sentence for an SGO reviewer. Never contains a household member's name. */
  message: string;
  itemId: string | null;
  memberIds: string[];
  /** Documents or rail connections the flag is about. */
  sourceIds: string[];
}

/* -------------------------------------------------------------------------------------- missing */

/** Something the household still has to provide before a decision can be made. */
export const MISSING_CODES = [
  "household_size",
  "county",
  "household_roster",
  "household_adult",
  "shared_custody_answers",
  "member_age_band",
  "member_income_evidence",
  "declared_income_evidence",
  "other_income_evidence_or_certification",
  "evidence_for_any_method",
] as const;
export type MissingCode = (typeof MISSING_CODES)[number];

/** What would satisfy a missing item, so the family UI can offer the right action. */
export type MissingAccepts =
  | "household_details"
  | "income_document"
  | "zero_income_certification"
  | "other_income_evidence"
  | "no_other_income_certification"
  | "award_letter";

export interface MissingItem {
  code: MissingCode;
  /** Member the item is about, when it is about one. */
  memberId: string | null;
  /** Income item the household listed without proof, for `declared_income_evidence`. */
  itemId: string | null;
  incomeYear: number | null;
  accepts: MissingAccepts[];
  /**
   * A complete sentence for a list under a heading such as "We still need". Written for the household
   * itself and for the SGO staff working the file: it may use the names the household entered, so it does
   * not belong in an evidence pack or anywhere a third party reads.
   */
  message: { en: string; es: string };
}

/* -------------------------------------------------------------------------------------- schemas */

const id = z.string().min(1).max(128);
const year = z.number().int().min(2000).max(2999);
const isoDate = z.string().refine(isIsoDate, "must be a calendar date written YYYY-MM-DD");
const signedCents = z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS);

export const householdMemberSchema: z.ZodType<HouseholdMemberInput> = z.strictObject({
  id,
  firstName: z.string().max(100),
  lastName: z.string().max(100).optional(),
  kind: z.enum(["adult", "student", "child", "other"]).optional(),
  ageBand: z.enum(["adult", "minor", "unknown"]),
  headOrSpouse: z.boolean().optional(),
  fullTimeStudent: z.boolean().optional(),
  role: z.enum(["family", "foster", "live_in_aide", "unrelated"]).optional(),
});

export const householdMembersSchema = z
  .array(householdMemberSchema)
  .max(MAX_HOUSEHOLD_MEMBERS)
  .superRefine((members, ctx) => {
    const seen = new Set<string>();
    members.forEach((member, index) => {
      if (seen.has(member.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `duplicate member id ${member.id}` });
      seen.add(member.id);
    });
  });

export const incomeItemSchema: z.ZodType<IncomeItemInput> = z
  .strictObject({
    id,
    memberId: id.nullable(),
    alsoCoversMemberIds: z.array(id).max(MAX_HOUSEHOLD_MEMBERS).optional(),
    category: z.string().min(1).max(100),
    incomeYear: year,
    annualAmountCents: signedCents,
    lowCents: signedCents.optional(),
    highCents: signedCents.optional(),
    source: z.enum(["document", "rail", "self_reported", "reviewer"]),
    documentId: id.nullable().optional(),
    railConnectionId: id.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.lowCents !== undefined && item.lowCents > item.annualAmountCents) {
      ctx.addIssue({ code: "custom", path: ["lowCents"], message: "must not be greater than annualAmountCents" });
    }
    if (item.highCents !== undefined && item.highCents < item.annualAmountCents) {
      ctx.addIssue({ code: "custom", path: ["highCents"], message: "must not be less than annualAmountCents" });
    }
    if (item.memberId !== null && item.alsoCoversMemberIds?.includes(item.memberId)) {
      ctx.addIssue({ code: "custom", path: ["alsoCoversMemberIds"], message: "must not repeat memberId" });
    }
  });

export const incomeItemsSchema = z
  .array(incomeItemSchema)
  .max(MAX_INCOME_ITEMS)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `duplicate income item id ${item.id}` });
      seen.add(item.id);
    });
  });

export const incomeDocumentSourceSchema: z.ZodType<IncomeDocumentSource> = z.strictObject({
  documentId: id,
  kind: z.enum(["pay_stub", "tax_return", "irs_transcript", "w2", "other_income"]),
  extractedBy: z.enum(["parser", "model", "reviewer"]),
  extractionConfidence: z.number().min(0).max(1),
});

export const incomeCertificationSchema: z.ZodType<IncomeCertification> = z
  .strictObject({
    kind: z.enum(["zero_income", "no_other_income"]),
    memberId: id.nullable(),
    incomeYear: year,
    signedBy: id,
    signedOn: isoDate,
    copyVersion: z.string().min(1).max(100),
  })
  .superRefine((certification, ctx) => {
    if (certification.kind === "zero_income" && certification.memberId === null) {
      ctx.addIssue({ code: "custom", path: ["memberId"], message: "a zero-income certification must name the member it is about" });
    }
  });

export const incomeReviewFlagSchema: z.ZodType<IncomeReviewFlag> = z.strictObject({
  code: z.enum(INCOME_FLAG_CODES),
  severity: z.enum(["bounded", "blocking"]),
  message: z.string().min(1).max(1000),
  itemId: id.nullable(),
  memberIds: z.array(id).max(MAX_HOUSEHOLD_MEMBERS),
  sourceIds: z.array(id).max(200),
});

export const incomeYearSchema = year;
export const isoDateSchema = isoDate;
export const idSchema = id;

/**
 * Validates boundary input and returns the parsed value, or throws a `validation_failed` AppError whose
 * `details.fields` maps each offending path to its message.
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
  const summary = Object.entries(fields)
    .slice(0, 5)
    .map(([path, message]) => `${path}: ${message}`)
    .join("; ");
  throw invalid(`Invalid ${what}: ${summary}`, { fields });
}
