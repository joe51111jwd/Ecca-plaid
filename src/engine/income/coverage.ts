/**
 * Coverage: is the household's income for the year documented well enough to decide on?
 *
 * The proposed direct method (Reg. 1.25F-3(c)(6)(iii)(A), REG-117199-25, not final) verifies income through
 * "pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income
 * not reflected on such documents (such as evidence of child support and alimony not reported as income)
 * or a certification that there is none, or ... other relevant data sources".
 *
 * PRODUCT POLICY built on that text (the text lists the documents after "including" and does not say in
 * terms what a complete file is; see docs/reference/sgo-verification-rules.md, engineering implication 11):
 *
 *  1. Every member whose income counts in full (aged 18 or older, or head of household or the head's spouse)
 *     needs EITHER a documented income item for the year (from a document, a data rail or a reviewer) OR a
 *     signed statement that the member had no income in the year.
 *  2. The household needs EITHER documented evidence of other income (a document of kind `other_income`
 *     behind an item) OR a signed certification that there is no other income, signed for the whole
 *     household or for each such member.
 *  3. An amount the household listed without proof (a self-reported item) needs its proof.
 *  4. Whether a member is 18 or older must be recorded: nothing is assumed from a missing answer.
 *
 * A file that is not complete is never decided "ineligible" and never decided "eligible" on income: the
 * decision stays pending and `missing` says exactly what to ask the household for.
 */
import { z } from "zod";
import { getIncomeCategory, incomeCategoryLabel } from "./categories";
import {
  householdMembersSchema,
  incomeCertificationSchema,
  incomeDocumentSourceSchema,
  incomeItemsSchema,
  incomeYearSchema,
  parseInput,
  type HouseholdMemberInput,
  type IncomeCertification,
  type IncomeDocumentSource,
  type IncomeItemInput,
  type IncomeReviewFlag,
  type MissingItem,
} from "./types";

export interface AssessCoverageInput {
  /** The calendar year before the application date. */
  incomeYear: number;
  members: HouseholdMemberInput[];
  items: IncomeItemInput[];
  certifications: IncomeCertification[];
  /** The documents behind the items. Without them, evidence of other income cannot be recognised. */
  sources?: IncomeDocumentSource[];
}

export type MemberCoverageStatus = "documented" | "certified_zero_income" | "missing" | "age_unknown" | "not_required";

export interface MemberCoverage {
  memberId: string;
  /** True when the member's income counts in full, so it has to be documented or certified as none. */
  required: boolean;
  status: MemberCoverageStatus;
  /** Income items for the year that document this member's income. */
  documentedByItemIds: string[];
  /** Why nothing is required, for `not_required`. */
  notRequiredReason: "under_18" | "income_excluded_role" | null;
}

export type OtherIncomeCoverage = "evidence_provided" | "certified_none" | "missing";

export interface CoverageAssessment {
  incomeYear: number;
  /** True when nothing is missing. */
  complete: boolean;
  members: MemberCoverage[];
  otherIncome: OtherIncomeCoverage;
  requiredMemberCount: number;
  documentedMemberCount: number;
  certifiedZeroIncomeMemberCount: number;
  /** Income items for the year that can count and are backed by a document, a data rail or a reviewer, for any member. */
  evidencedItemCount: number;
  /** What to ask the household for, in roster order. */
  missing: MissingItem[];
  /** Contradictions a reviewer must settle. */
  flags: IncomeReviewFlag[];
}

const coverageInputSchema = z.strictObject({
  incomeYear: incomeYearSchema,
  members: householdMembersSchema,
  items: incomeItemsSchema,
  certifications: z.array(incomeCertificationSchema).max(500),
  sources: z.array(incomeDocumentSourceSchema).max(500).optional(),
});

function displayName(member: HouseholdMemberInput): { en: string; es: string } {
  const name = member.firstName.trim();
  return name === "" ? { en: "a household member", es: "un miembro del hogar" } : { en: name, es: name };
}

/** The item is backed by a document, a data rail or a reviewer, not only by the household's own statement. */
function isEvidenced(item: IncomeItemInput): boolean {
  if (item.source === "document") return typeof item.documentId === "string";
  if (item.source === "rail") return typeof item.railConnectionId === "string";
  return item.source === "reviewer";
}

/** The item can add to household income (its category counts or is unsettled), so it is evidence of income. */
function canCount(item: IncomeItemInput): boolean {
  return getIncomeCategory(item.category)?.treatment !== "excluded";
}

function covers(item: IncomeItemInput, memberId: string): boolean {
  return item.memberId === memberId || (item.alsoCoversMemberIds?.includes(memberId) ?? false);
}

/**
 * Which household members have documented income for the year or a signed statement that they had none,
 * whether the other-income requirement is met, and the precise list of what is still missing.
 *
 * Throws a `validation_failed` AppError for malformed input.
 */
export function assessCoverage(input: AssessCoverageInput): CoverageAssessment {
  const { incomeYear, members, items, certifications, sources } = parseInput(coverageInputSchema, input, "coverage input");
  const inYear = items.filter((item) => item.incomeYear === incomeYear);
  const yearCertifications = certifications.filter((certification) => certification.incomeYear === incomeYear);
  const sourceKind = new Map((sources ?? []).map((source) => [source.documentId, source.kind]));

  const missing: MissingItem[] = [];
  const flags: IncomeReviewFlag[] = [];
  const coverage: MemberCoverage[] = [];

  for (const member of members) {
    const excludedRole = member.role === "foster" || member.role === "live_in_aide";
    const countsInFull = member.ageBand === "adult" || member.headOrSpouse === true;
    const documentedBy = inYear.filter((item) => covers(item, member.id) && isEvidenced(item) && canCount(item));
    const base = { memberId: member.id, documentedByItemIds: documentedBy.map((item) => item.id), notRequiredReason: null };

    if (excludedRole) {
      coverage.push({ ...base, required: false, status: "not_required", notRequiredReason: "income_excluded_role" });
      continue;
    }
    if (!countsInFull && member.ageBand === "unknown") {
      coverage.push({ ...base, required: false, status: "age_unknown" });
      const name = displayName(member);
      missing.push({
        code: "member_age_band",
        memberId: member.id,
        itemId: null,
        incomeYear,
        accepts: ["household_details"],
        message: { en: `Whether ${name.en} is 18 or older.`, es: `Si ${name.es} tiene 18 años o más.` },
      });
      continue;
    }
    if (!countsInFull) {
      coverage.push({ ...base, required: false, status: "not_required", notRequiredReason: "under_18" });
      continue;
    }

    const certifiedZero = yearCertifications.some((certification) => certification.kind === "zero_income" && certification.memberId === member.id);
    if (certifiedZero) {
      const contradicting = inYear.filter((item) => covers(item, member.id) && canCount(item) && item.annualAmountCents > 0);
      if (contradicting.length > 0) {
        flags.push({
          code: "zero_income_certification_contradicted",
          severity: "blocking",
          message: `A household member signed a statement of no income for ${incomeYear}, but income is recorded for that member for the same year.`,
          itemId: contradicting[0].id,
          memberIds: [member.id],
          sourceIds: contradicting.flatMap((item) => [item.documentId, item.railConnectionId]).filter((sourceId): sourceId is string => typeof sourceId === "string"),
        });
      }
    }

    if (documentedBy.length > 0) {
      coverage.push({ ...base, required: true, status: "documented" });
    } else if (certifiedZero) {
      coverage.push({ ...base, required: true, status: "certified_zero_income" });
    } else {
      coverage.push({ ...base, required: true, status: "missing" });
      const name = displayName(member);
      missing.push({
        code: "member_income_evidence",
        memberId: member.id,
        itemId: null,
        incomeYear,
        accepts: ["income_document", "zero_income_certification"],
        message: {
          en: `Proof of ${incomeYear} income for ${name.en} (a ${incomeYear} tax return, IRS transcript, Form W-2 or year-end pay stub), or a signed statement that ${name.en} had no income in ${incomeYear}.`,
          es: `Comprobante de los ingresos de ${incomeYear} de ${name.es} (una declaración de impuestos de ${incomeYear}, una transcripción del IRS, un Formulario W-2 o un talón de pago de fin de año), o una declaración firmada de que ${name.es} no tuvo ingresos en ${incomeYear}.`,
        },
      });
    }
  }

  const required = coverage.filter((entry) => entry.required);
  if (required.length === 0) {
    missing.unshift({
      code: "household_adult",
      memberId: null,
      itemId: null,
      incomeYear,
      accepts: ["household_details"],
      message: {
        en: "The adults in the household. Add each person aged 18 or older who lives with the student.",
        es: "Los adultos del hogar. Agregue a cada persona de 18 años o más que vive con el estudiante.",
      },
    });
  }

  // Amounts the household listed without proof. A member already asked for income proof is not asked twice.
  const memberById = new Map(members.map((member) => [member.id, member]));
  const alreadyAsked = new Set(coverage.filter((entry) => entry.status === "missing").map((entry) => entry.memberId));
  for (const item of inYear) {
    if (isEvidenced(item) || !canCount(item) || item.annualAmountCents <= 0) continue;
    if (item.memberId !== null && alreadyAsked.has(item.memberId)) continue;
    const member = item.memberId === null ? undefined : memberById.get(item.memberId);
    const name = member ? displayName(member) : null;
    missing.push({
      code: "declared_income_evidence",
      memberId: member?.id ?? null,
      itemId: item.id,
      incomeYear,
      accepts: ["income_document", "other_income_evidence"],
      message: {
        en: `Proof of income you listed for ${incomeYear}: ${incomeCategoryLabel(item.category, "en")}${name ? ` (${name.en})` : ""}.`,
        es: `Comprobante de un ingreso que usted indicó para ${incomeYear}: ${incomeCategoryLabel(item.category, "es")}${name ? ` (${name.es})` : ""}.`,
      },
    });
  }

  const householdCertified = yearCertifications.some((certification) => certification.kind === "no_other_income" && certification.memberId === null);
  const eachMemberCertified =
    required.length > 0 &&
    required.every((entry) => yearCertifications.some((certification) => certification.kind === "no_other_income" && certification.memberId === entry.memberId));
  const otherIncomeEvidence = inYear.some((item) => item.source === "document" && typeof item.documentId === "string" && sourceKind.get(item.documentId) === "other_income" && canCount(item));
  const otherIncome: OtherIncomeCoverage = householdCertified || eachMemberCertified ? "certified_none" : otherIncomeEvidence ? "evidence_provided" : "missing";
  if (otherIncome === "missing") {
    missing.push({
      code: "other_income_evidence_or_certification",
      memberId: null,
      itemId: null,
      incomeYear,
      accepts: ["other_income_evidence", "no_other_income_certification"],
      message: {
        en: `Proof of any other income your household received in ${incomeYear} that is not shown on your documents (such as child support or alimony), or a signed statement that there was none.`,
        es: `Comprobante de cualquier otro ingreso que su hogar haya recibido en ${incomeYear} y que no aparezca en sus documentos (como manutención de menores o pensión alimenticia), o una declaración firmada de que no hubo ninguno.`,
      },
    });
  }

  return {
    incomeYear,
    complete: missing.length === 0,
    members: coverage,
    otherIncome,
    requiredMemberCount: required.length,
    documentedMemberCount: required.filter((entry) => entry.status === "documented").length,
    certifiedZeroIncomeMemberCount: required.filter((entry) => entry.status === "certified_zero_income").length,
    evidencedItemCount: inYear.filter((item) => isEvidenced(item) && canCount(item)).length,
    missing,
    flags,
  };
}
