/**
 * Pure mapping from what the document reader stored to what the income engine and the decision engine take:
 * award letters to `AwardLetterInput`, income documents to `IncomeEvidence` for `reconcileIncomeEvidence`, and the
 * household roster to `HouseholdMemberInput`.
 *
 * Rule 1 of the lifecycle ("a failed or low-confidence parse goes to needs_review, never a silent yes") is kept
 * here in two ways:
 *  - a document the reader sent to review contributes extraction confidence 0, so the decision engine can never
 *    rest an automatic decision on it (it routes the file to a person); a reviewer-keyed document is trusted;
 *  - anything that cannot be turned into evidence without guessing (who a W-2 belongs to, whether a tax record's
 *    other income lines were all read) becomes an "unread document" or `otherIncome: not_read`, which the engines
 *    send to a person.
 */
import type { DocumentKind, MemberKind, DocumentStatus } from "@/db/schema";
import type { AwardLetterInput } from "@/engine/decision";
import { matchNameToHousehold, type Extraction, type IncomeAmount, type IncomeMeasure, type LookAlikeProgram } from "@/engine/documents";
import {
  RECONCILIATION_POLICY,
  type HouseholdMemberInput,
  type IncomeDocumentSource,
  type IncomeEvidence,
  type TaxRecordEvidence,
  type TaxRecordLine,
  type TaxRecordOtherIncome,
} from "@/engine/income";
import { ADULT_AGE_YEARS, UNDATED_MEMBER_AGE_BAND } from "./policy";

/* ---------------------------------------------------------------------------------------- roster */

export interface RosterMember {
  id: string;
  kind: MemberKind;
  firstName: string;
  lastName: string;
  relationship: string | null;
  isOwner: boolean;
  /** YYYY-MM-DD when stored. */
  dob?: string | null;
}

/** Whole years between a date of birth and a reference date (both YYYY-MM-DD). */
export function ageOnDate(dob: string, onDate: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ry, rm, rd] = onDate.split("-").map(Number);
  let age = ry! - by!;
  if (rm! < bm! || (rm === bm && rd! < bd!)) age -= 1;
  return age;
}

/**
 * The roster in the income engine's terms. Age band: from the date of birth on `referenceDate` when stored,
 * otherwise UNDATED_MEMBER_AGE_BAND by kind. The household owner is the head of household. An "unrelated"
 * member is someone residing with the student who is not part of the family (the income engine counts their
 * income only in the upper bound).
 */
export function toHouseholdMembers(roster: readonly RosterMember[], referenceDate: string): HouseholdMemberInput[] {
  return roster.map((m) => {
    const ageBand = m.dob ? (ageOnDate(m.dob, referenceDate) >= ADULT_AGE_YEARS ? "adult" : "minor") : UNDATED_MEMBER_AGE_BAND[m.kind];
    return {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      kind: m.kind,
      ageBand,
      headOrSpouse: m.isOwner,
      role: m.relationship === "unrelated" ? "unrelated" : "family",
    };
  });
}

/* ------------------------------------------------------------------------------------- documents */

/** What the extraction job stores (encrypted) for one document. */
export interface StoredExtraction {
  readerStatus: "extracted" | "needs_review" | "unreadable";
  detectedKind: DocumentKind;
  extraction: Extraction | null;
  extractedBy: "parser" | "model" | null;
  synthetic: boolean;
  model: { id: string; readerVersion: string } | null;
  pageCount: number | null;
  textSource: "pdf_text" | "plain" | "none";
}

export interface MappableDocument {
  id: string;
  /** Household member the family said the document is about. */
  memberId: string | null;
  status: DocumentStatus;
  declaredKind: DocumentKind;
  detectedKind: DocumentKind | null;
  extractedBy: "parser" | "model" | "reviewer" | null;
  stored: StoredExtraction | null;
}

export interface MappedDocument {
  documentId: string;
  kind: DocumentKind;
  letter: AwardLetterInput | null;
  evidence: IncomeEvidence[];
  source: IncomeDocumentSource | null;
  /** True when the document is (wholly or partly) income evidence that could not be used without a person. */
  unread: boolean;
  /** Why, for the timeline (no values). */
  notes: string[];
}

const LOOK_ALIKE_PROGRAM: Readonly<Record<LookAlikeProgram, string>> = {
  MEDICAID: "MEDICAID",
  CHIP: "CHIP",
  OTHER_HEALTH_CARE: "OTHER",
  SSDI: "SSDI",
  SOCIAL_SECURITY_RETIREMENT_SURVIVORS: "RSDI",
  MEDICARE_EXTRA_HELP: "OTHER",
  SPECIAL_VETERANS_BENEFITS: "OTHER",
  SCHOOL_MEALS: "SCHOOL_MEALS",
  UNEMPLOYMENT: "OTHER",
  PUBLIC_HOUSING: "OTHER",
};

/** Subtypes that document participation without being an award or approval letter. */
const NON_LETTER_SUBTYPES: ReadonlySet<string> = new Set(["benefit_card", "wic_benefit_list"]);

function effectiveKind(doc: MappableDocument): DocumentKind {
  const detected = doc.stored?.detectedKind ?? doc.detectedKind;
  return detected && detected !== "unknown" ? detected : doc.declaredKind;
}

function trusted(doc: MappableDocument): boolean {
  return doc.extractedBy === "reviewer" || (doc.status === "extracted" && doc.stored?.readerStatus === "extracted");
}

function extractor(doc: MappableDocument): "parser" | "model" | "reviewer" {
  return doc.extractedBy ?? doc.stored?.extractedBy ?? "parser";
}

interface MatchResult {
  memberId: string | null;
  confidence: number;
}

function matchName(printed: string | null, roster: readonly RosterMember[]): MatchResult {
  if (!printed) return { memberId: null, confidence: 0 };
  const m = matchNameToHousehold(
    printed,
    roster.map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName })),
  );
  if (m.ambiguous || (m.grade !== "exact" && m.grade !== "strong") || !m.memberId) return { memberId: null, confidence: m.ambiguous ? 0 : m.confidence };
  return { memberId: m.memberId, confidence: m.confidence };
}

/** The member a single-person document is about: the printed name when it matches, else the family's tag. */
function attribute(printed: string | null, doc: MappableDocument, roster: readonly RosterMember[]): string | null {
  const byName = matchName(printed, roster).memberId;
  if (byName) return byName;
  if (doc.memberId && roster.some((r) => r.id === doc.memberId)) return doc.memberId;
  return null;
}

function mapLetter(doc: MappableDocument, roster: readonly RosterMember[]): AwardLetterInput {
  const award = doc.stored?.extraction?.award ?? null;
  if (!award) {
    return {
      documentId: doc.id,
      program: "UNKNOWN",
      letterDate: null,
      approvalStatus: "unclear",
      recipientName: null,
      matchedMemberId: null,
      nameMatchConfidence: 0,
      extractionConfidence: 0,
      extractedBy: extractor(doc),
      benefitPeriodEnd: null,
      documentType: "award_letter",
    };
  }
  const match = matchName(award.recipientName, roster);
  const subtype = doc.stored?.extraction?.subtype ?? "unknown";
  return {
    documentId: doc.id,
    program: award.program ?? (award.lookAlikeProgram ? LOOK_ALIKE_PROGRAM[award.lookAlikeProgram] : "UNKNOWN"),
    letterDate: award.letterDate,
    approvalStatus: award.approvalStatus,
    recipientName: award.recipientName,
    matchedMemberId: match.memberId,
    nameMatchConfidence: match.memberId ? match.confidence : 0,
    extractionConfidence: trusted(doc) ? award.extractionConfidence : 0,
    extractedBy: extractor(doc),
    benefitPeriodEnd: award.benefitPeriod?.end ?? null,
    documentType: NON_LETTER_SUBTYPES.has(subtype) ? "other" : "award_letter",
  };
}

const amountOf = (amounts: readonly IncomeAmount[], measure: IncomeMeasure): IncomeAmount | undefined => amounts.find((a) => a.measure === measure);
const within = (a: number, b: number): boolean => Math.abs(a - b) <= RECONCILIATION_POLICY.sameFigureToleranceCents;

/**
 * Form 1040 other income. The lines are listed only when the record proves they were all read: line 9 (total
 * income) must equal wages plus the lines read. IRA distributions, pensions and Schedule 1 income are printed as
 * taxable amounts (or as one combined figure), not the amounts received that household income counts, so any of
 * them leaves the other lines `not_read` for a reviewer.
 */
function form1040OtherIncome(amounts: readonly IncomeAmount[], wagesCents: number | null): TaxRecordOtherIncome {
  const nonZero = (m: IncomeMeasure) => (amountOf(amounts, m)?.amountCents ?? 0) !== 0;
  if (wagesCents === null || nonZero("f1040_ira_distributions_taxable") || nonZero("f1040_pensions_taxable") || nonZero("f1040_additional_income_schedule_1")) return { status: "not_read" };
  const total = amountOf(amounts, "f1040_total_income");
  if (!total) return { status: "not_read" };
  const v = (m: IncomeMeasure) => amountOf(amounts, m)?.amountCents ?? 0;
  const expected = wagesCents + v("f1040_taxable_interest") + v("f1040_ordinary_dividends") + v("f1040_social_security_taxable") + v("f1040_capital_gain");
  if (!within(total.amountCents, expected)) return { status: "not_read" };
  const lines: TaxRecordLine[] = [];
  const add = (line: TaxRecordLine["line"], m: IncomeMeasure) => {
    const a = amountOf(amounts, m);
    if (a && a.amountCents !== 0) lines.push({ line, amountCents: a.amountCents });
  };
  add("taxable_interest", "f1040_taxable_interest");
  add("tax_exempt_interest", "f1040_tax_exempt_interest");
  add("ordinary_dividends", "f1040_ordinary_dividends");
  add("social_security_benefits", "f1040_social_security_total");
  add("capital_gain", "f1040_capital_gain");
  return lines.length === 0 ? { status: "none" } : { status: "itemized", lines };
}

/**
 * Tax return transcript other income. The reader extracts business income, unemployment and the totals of
 * Social Security, pensions and IRA distributions. Total income includes only the taxable part of the last three,
 * so with any of them present the lines stay `not_read`; otherwise total income must equal wages plus business
 * income plus unemployment.
 */
function transcriptOtherIncome(amounts: readonly IncomeAmount[], wagesCents: number | null): TaxRecordOtherIncome {
  const present = (m: IncomeMeasure) => (amountOf(amounts, m)?.amountCents ?? 0) !== 0;
  if (wagesCents === null || present("transcript_social_security_total") || present("transcript_pensions_total") || present("transcript_ira_total")) return { status: "not_read" };
  const total = amountOf(amounts, "transcript_total_income");
  if (!total) return { status: "not_read" };
  const business = amountOf(amounts, "transcript_business_income")?.amountCents ?? 0;
  const unemployment = amountOf(amounts, "transcript_unemployment")?.amountCents ?? 0;
  if (!within(total.amountCents, wagesCents + business + unemployment)) return { status: "not_read" };
  const lines: TaxRecordLine[] = [];
  if (business !== 0) lines.push({ line: "business_income", amountCents: business });
  if (unemployment !== 0) lines.push({ line: "unemployment_compensation", amountCents: unemployment });
  return lines.length === 0 ? { status: "none" } : { status: "itemized", lines };
}

function taxRecordMembers(extraction: Extraction, doc: MappableDocument, roster: readonly RosterMember[]): string[] {
  const people = extraction.income?.people.filter((p) => p.role === "filer" || p.role === "spouse" || p.role === "taxpayer") ?? [];
  const matched = [...new Set(people.map((p) => matchName(p.name, roster).memberId).filter((id): id is string => id !== null))];
  if (matched.length > 0) return matched;
  return doc.memberId && roster.some((r) => r.id === doc.memberId) ? [doc.memberId] : [];
}

function mapIncome(doc: MappableDocument, kind: DocumentKind, roster: readonly RosterMember[]): Omit<MappedDocument, "documentId" | "kind" | "letter"> {
  const extraction = doc.stored?.extraction ?? null;
  const income = extraction?.income ?? null;
  const unread = (note: string) => ({ evidence: [], source: null, unread: true, notes: [note] });
  if (!extraction || !income) return unread("nothing was read from the document");
  const origin = "document" as const;
  const evidence: IncomeEvidence[] = [];
  const notes: string[] = [];
  let partlyUnread = false;
  const sourceKind = kind === "w2" || kind === "pay_stub" || kind === "tax_return" || kind === "irs_transcript" ? kind : null;
  if (!sourceKind) return unread("the document is not one of the income documents the direct method names");

  if (kind === "w2") {
    const statements = new Map<string, IncomeAmount[]>();
    for (const a of income.amounts) {
      if (!a.measure.startsWith("w2_")) continue;
      const prefix = a.fieldKey.includes(".") ? a.fieldKey.slice(0, a.fieldKey.indexOf(".")) : "w2";
      statements.set(prefix, [...(statements.get(prefix) ?? []), a]);
    }
    for (const [prefix, amounts] of statements) {
      const box1 = amountOf(amounts, "w2_box1_wages");
      const yearField = extraction.fields[`${prefix}.tax_year`]?.value;
      const taxYear = typeof yearField === "number" ? yearField : income.taxYear;
      const memberId = attribute(box1?.person ?? null, doc, roster);
      if (!box1 || taxYear === null || !memberId) {
        partlyUnread = true;
        notes.push(!box1 ? "a W-2 statement without box 1" : taxYear === null ? "a W-2 statement without a tax year" : "a W-2 statement that could not be matched to a household member");
        continue;
      }
      evidence.push({
        kind: "w2",
        sourceId: doc.id,
        origin,
        memberId,
        taxYear,
        employerName: box1.payer,
        wagesCents: box1.amountCents,
        medicareWagesCents: amountOf(amounts, "w2_box5_medicare_wages")?.amountCents ?? null,
      });
    }
    if (statements.size === 0) return unread("no W-2 statement was read");
  } else if (kind === "pay_stub") {
    const ytd = amountOf(income.amounts, "paystub_gross_ytd");
    const memberId = attribute(ytd?.person ?? income.people[0]?.name ?? null, doc, roster);
    if (!income.payDate || !memberId) return unread(!income.payDate ? "the pay date was not read" : "the pay stub could not be matched to a household member");
    evidence.push({ kind: "pay_stub", sourceId: doc.id, origin, memberId, employerName: ytd?.payer ?? null, payDate: income.payDate, payFrequency: null, grossYtdCents: ytd?.amountCents ?? null, markedFinal: false });
  } else {
    const subtype = extraction.subtype;
    const form: TaxRecordEvidence["form"] | null =
      kind === "tax_return"
        ? "filed_return"
        : subtype === "irs_tax_return_transcript" || subtype === "irs_record_of_account"
          ? "irs_return_transcript"
          : subtype === "irs_wage_income_transcript"
            ? "irs_wage_income_transcript"
            : null;
    if (!form) return unread("the IRS record does not report income");
    if (income.taxYear === null) return unread("the tax year was not read");
    const memberIds = form === "irs_wage_income_transcript" ? [attribute(income.people[0]?.name ?? null, doc, roster)].filter((id): id is string => id !== null) : taxRecordMembers(extraction, doc, roster);
    if (memberIds.length === 0) return unread("the tax record could not be matched to a household member");
    let wagesCents: number | null;
    let otherIncome: TaxRecordOtherIncome;
    if (form === "filed_return") {
      wagesCents = (amountOf(income.amounts, "f1040_wages_line_1z") ?? amountOf(income.amounts, "f1040_wages_line_1a"))?.amountCents ?? null;
      otherIncome = form1040OtherIncome(income.amounts, wagesCents);
    } else if (form === "irs_return_transcript") {
      wagesCents = amountOf(income.amounts, "transcript_wages")?.amountCents ?? null;
      otherIncome = transcriptOtherIncome(income.amounts, wagesCents);
    } else {
      const w2s = income.amounts.filter((a) => a.measure === "wai_w2_wages");
      wagesCents = w2s.reduce((sum, a) => sum + a.amountCents, 0);
      otherIncome = income.amounts.some((a) => a.measure === "wai_1099_amount") ? { status: "not_read" } : { status: "none" };
    }
    evidence.push({ kind: "tax_record", sourceId: doc.id, origin, form, memberIds, taxYear: income.taxYear, wagesCents, otherIncome });
  }

  const source: IncomeDocumentSource | null =
    evidence.length > 0 ? { documentId: doc.id, kind: sourceKind, extractedBy: extractor(doc), extractionConfidence: trusted(doc) ? income.extractionConfidence : 0 } : null;
  return { evidence, source, unread: partlyUnread || evidence.length === 0, notes };
}

/** Maps one stored document to decision inputs. Pure. */
export function mapDocument(doc: MappableDocument, roster: readonly RosterMember[]): MappedDocument {
  const kind = effectiveKind(doc);
  if (kind === "award_letter") return { documentId: doc.id, kind, letter: mapLetter(doc, roster), evidence: [], source: null, unread: false, notes: [] };
  const mapped = mapIncome(doc, kind, roster);
  return { documentId: doc.id, kind, letter: null, ...mapped };
}
