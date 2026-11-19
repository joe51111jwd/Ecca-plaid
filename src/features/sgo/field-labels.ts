import { DEFAULT_DOCUMENT_POLICY, type FieldValue, type IncomeMeasure } from "@/engine/documents/types";
import { APPROVAL_STATUS_LABELS, PROGRAM_LABELS } from "./labels";

/**
 * Reviewer-facing names and formatting for the fields the document reader (src/engine/documents/extract) and the
 * reviewer keying form (src/server/verifications/reviewer-extraction.ts) store. Pure: no clock, no locale state.
 *
 * Field keys come in a few shapes:
 *   - plain keys:              `tax_year`, `letter_date`, `gross_ytd_cents`
 *   - W-2 statements:          `w2_<n>.<field>`         (reader: `box_1_cents`; reviewer: `<measure>_cents`)
 *   - wage and income forms:   `form_<n>.<field>`
 *   - return transcript lines: `item.<slug of the printed label>_cents`
 *   - reviewer-keyed figures:  `<measure>_<n>_cents`
 *   - numbered names:          `household_member_<n>`, `dependent_<n>_name`
 * A key nothing here knows falls back to a tidied version of itself, so a new reader field never breaks the page.
 */

export type FieldDisplay = { kind: "money"; cents: number } | { kind: "date"; iso: string } | { kind: "text"; text: string } | { kind: "missing" };

export interface FieldName {
  label: string;
  /** "W-2 statement 2", "Form 1 on the transcript"; null for a document-level field. */
  group: string | null;
  /** Sort position of the group (statement number); 0 for document-level fields. */
  groupOrder: number;
  /** Reader bookkeeping a reviewer rarely needs (counters, section flags, headings): shown behind "Show all fields". */
  internal: boolean;
  /** Position within its group; known fields follow FIELD_ORDER, unknown ones come after in stored order. */
  rank: number;
  /** False when the label is the tidied-key fallback for a key this module does not know. */
  known: boolean;
}

export interface PresentedField extends FieldName {
  key: string;
  display: FieldDisplay;
  confidence: number;
}

export interface PresentedFields {
  /** Shown by default, ordered by group then rank. */
  primary: PresentedField[];
  /** Behind "Show all fields". */
  internal: PresentedField[];
  /** More than one group (two W-2s on one file, several forms on a transcript): render group headings. */
  grouped: boolean;
}

/** One income figure's family and its name inside a document of that family. */
export const MEASURE_LABELS: Readonly<Record<IncomeMeasure, { family: string; short: string }>> = Object.freeze({
  w2_box1_wages: { family: "W-2", short: "Wages (box 1)" },
  w2_box3_social_security_wages: { family: "W-2", short: "Social security wages (box 3)" },
  w2_box5_medicare_wages: { family: "W-2", short: "Medicare wages (box 5)" },
  f1040_wages_line_1a: { family: "Form 1040", short: "Wages from Forms W-2 (line 1a)" },
  f1040_wages_line_1z: { family: "Form 1040", short: "Total wages (line 1z)" },
  f1040_tax_exempt_interest: { family: "Form 1040", short: "Tax-exempt interest (line 2a)" },
  f1040_taxable_interest: { family: "Form 1040", short: "Taxable interest (line 2b)" },
  f1040_ordinary_dividends: { family: "Form 1040", short: "Ordinary dividends (line 3b)" },
  f1040_ira_distributions_taxable: { family: "Form 1040", short: "IRA distributions, taxable (line 4b)" },
  f1040_pensions_taxable: { family: "Form 1040", short: "Pensions and annuities, taxable (line 5b)" },
  f1040_social_security_total: { family: "Form 1040", short: "Social security benefits (line 6a)" },
  f1040_social_security_taxable: { family: "Form 1040", short: "Social security benefits, taxable (line 6b)" },
  f1040_capital_gain: { family: "Form 1040", short: "Capital gain or loss (line 7a)" },
  f1040_additional_income_schedule_1: { family: "Form 1040", short: "Additional income from Schedule 1 (line 8)" },
  f1040_total_income: { family: "Form 1040", short: "Total income (line 9)" },
  f1040_adjustments: { family: "Form 1040", short: "Adjustments to income (line 10)" },
  f1040_agi: { family: "Form 1040", short: "Adjusted gross income (line 11a)" },
  transcript_wages: { family: "Return transcript", short: "Wages, salaries, tips" },
  transcript_business_income: { family: "Return transcript", short: "Business income or loss" },
  transcript_unemployment: { family: "Return transcript", short: "Unemployment compensation" },
  transcript_social_security_total: { family: "Return transcript", short: "Total social security benefits" },
  transcript_pensions_total: { family: "Return transcript", short: "Total pensions and annuities" },
  transcript_ira_total: { family: "Return transcript", short: "Total IRA distributions" },
  transcript_total_income: { family: "Return transcript", short: "Total income" },
  transcript_agi: { family: "Return transcript", short: "Adjusted gross income" },
  wai_w2_wages: { family: "Wage and income transcript", short: "W-2 wages" },
  wai_1099_amount: { family: "Wage and income transcript", short: "Form 1099 amount" },
  paystub_gross_current: { family: "Pay stub", short: "Gross pay this period" },
  paystub_gross_ytd: { family: "Pay stub", short: "Gross pay year to date" },
  paystub_net_current: { family: "Pay stub", short: "Net pay this period" },
});

function isMeasure(value: string): value is IncomeMeasure {
  return Object.hasOwn(MEASURE_LABELS, value);
}

/** "W-2: Wages (box 1)". Unknown measures are tidied rather than refused. */
export function measureFullLabel(measure: string): string {
  if (isMeasure(measure)) {
    const m = MEASURE_LABELS[measure];
    return `${m.family}: ${m.short}`;
  }
  return tidyKey(measure);
}

const FORM_1040_LINES: Readonly<Record<string, string>> = Object.freeze({
  "1a": "Wages from Forms W-2 (line 1a)",
  "1z": "Total wages (line 1z)",
  "2a": "Tax-exempt interest (line 2a)",
  "2b": "Taxable interest (line 2b)",
  "3a": "Qualified dividends (line 3a)",
  "3b": "Ordinary dividends (line 3b)",
  "4a": "IRA distributions (line 4a)",
  "4b": "IRA distributions, taxable (line 4b)",
  "5a": "Pensions and annuities (line 5a)",
  "5b": "Pensions and annuities, taxable (line 5b)",
  "6a": "Social security benefits (line 6a)",
  "6b": "Social security benefits, taxable (line 6b)",
  "7a": "Capital gain or loss (line 7a)",
  "8": "Additional income from Schedule 1 (line 8)",
  "9": "Total income (line 9)",
  "10": "Adjustments to income (line 10)",
  "11a": "Adjusted gross income (line 11a)",
  "11b": "Adjusted gross income, page 2 (line 11b)",
  "15": "Taxable income (line 15)",
});

const W2_BOXES: Readonly<Record<string, string>> = Object.freeze({
  "1": "Wages (box 1)",
  "2": "Federal tax withheld (box 2)",
  "3": "Social security wages (box 3)",
  "4": "Social security tax withheld (box 4)",
  "5": "Medicare wages (box 5)",
  "6": "Medicare tax withheld (box 6)",
  "7": "Social security tips (box 7)",
  "10": "Dependent care benefits (box 10)",
  "16": "State wages (box 16)",
});

/** Return-transcript and wage-and-income labels the reader slugs (`slug()` in extract/transcripts.ts). */
const TRANSCRIPT_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  wages_salaries_tips_etc: "Wages, salaries, tips",
  business_income_or_loss: "Business income or loss",
  business_income_or_loss_schedule_c: "Business income or loss (Schedule C)",
  business_income_or_loss_sch_c: "Business income or loss (Schedule C)",
  unemployment_compensation: "Unemployment compensation",
  total_social_security_benefits: "Total social security benefits",
  total_pensions_and_annuities: "Total pensions and annuities",
  total_ira_distributions: "Total IRA distributions",
  total_income: "Total income",
  adjusted_gross_income: "Adjusted gross income",
  taxable_interest_income_sch_b: "Taxable interest (Schedule B)",
  wages_tips_and_other_compensation: "Wages, tips and other compensation",
  nonemployee_compensation: "Nonemployee compensation",
  gross_distribution: "Gross distribution",
});

/** Plain field keys, in the order a reviewer reads them. Position here is the rank. */
const FIELD_ORDER: ReadonlyArray<[string, string]> = [
  // Who and when
  ["tax_year", "Tax year"],
  ["program", "Program"],
  ["look_alike_program", "Program (not one of the five listed)"],
  ["approval_status", "What the letter shows"],
  ["letter_date", "Letter date"],
  ["issue_date", "Issued on"],
  ["effective_date", "Effective date"],
  ["recipient_name", "Recipient"],
  ["addressee_name", "Addressed to"],
  ["claimant_name", "Claimant"],
  ["participant_name", "Participant"],
  ["family_representative", "Family representative"],
  ["head_of_household", "Head of household"],
  ["tenant", "Tenant"],
  ["employer_name", "Employer"],
  ["employee_name", "Employee"],
  ["filer_name", "Filer"],
  ["spouse_name", "Spouse"],
  ["filing_status", "Filing status"],
  ["names_shown", "Name as shown"],
  // Pay stubs
  ["pay_date", "Pay date"],
  ["period_start", "Pay period start"],
  ["period_end", "Pay period end"],
  ["gross_current_cents", "Gross pay this period"],
  ["gross_ytd_cents", "Gross pay year to date"],
  ["net_current_cents", "Net pay this period"],
  // Return transcripts (summary figures)
  ["wages_cents", "Wages"],
  ["total_income_cents", "Total income"],
  ["agi_cents", "Adjusted gross income"],
  // Benefits
  ["benefit_start", "Benefit period start"],
  ["benefit_end", "Benefit period end"],
  ["benefit_period_start", "Benefit period start"],
  ["benefit_period_end", "Benefit period end"],
  ["benefit_month", "Benefit month"],
  ["monthly_amount_cents", "Monthly amount"],
  ["ssi_monthly_amount_cents", "SSI monthly amount"],
  ["ssi_effective_month", "SSI effective month"],
  ["ssi_payment_type", "SSI paid as"],
  ["title2_benefit_type", "Social Security benefit type"],
  ["no_benefits", "Says no benefits are paid now"],
  ["payment_through", "Paid through"],
  ["certification_start_date", "Certification start"],
  ["certification_end_date", "Certification end"],
  ["income_determination_date", "Income determined on"],
  ["expiration_date", "Expires on"],
  ["extension_expires", "Extension expires"],
  ["hap_amount_cents", "Housing assistance payment"],
  ["hap_to_owner_cents", "Payment to the owner"],
  ["contract_rent_cents", "Contract rent"],
  ["tenant_rent_cents", "Tenant rent"],
  ["next_reexam_date", "Next reexamination"],
  ["reexamination_type", "Reexamination type"],
  ["issuing_agency", "Issuing agency"],
  ["pha_name", "Housing authority"],
  ["local_agency", "Local agency"],
  // Identifiers (masked by the reader)
  ["case_number_masked", "Case number (masked)"],
  ["voucher_number_masked", "Voucher number (masked)"],
  ["claim_number_last4", "Claim number (last 4)"],
  ["tracking_number_masked", "Tracking number (masked)"],
  ["customer_file_number", "Customer file number"],
  ["voc_id", "VOC ID"],
  ["program_code", "Program code"],
  ["action_code", "Action code"],
  ["employer_ein_masked", "Employer EIN (masked)"],
  ["employee_ssn_last4", "Employee SSN (last 4)"],
  ["filer_ssn_last4", "Filer SSN (last 4)"],
  ["spouse_ssn_last4", "Spouse SSN (last 4)"],
  ["ssn_last4", "SSN (last 4)"],
  ["request_date", "Requested on"],
  ["response_date", "Response date"],
  // Flags
  ["self_employment_indicated", "Shows self-employment income"],
  ["nonfiler_supported", "Supports a statement of no return filed"],
  ["likely_final_stub_of_year", "Looks like the year's final pay stub"],
  // Reader bookkeeping
  ["copy", "Form copy"],
  ["control_number_masked", "Control number (masked)"],
  ["form_number", "Form number"],
  ["heading_program", "Heading: program"],
  ["heading_subject", "Heading: subject"],
  ["has_ssi_section", "Has an SSI section"],
  ["has_title2_section", "Has a Social Security section"],
  ["page_one_present", "Page 1 present"],
  ["lease_begin_raw", "Lease begins (as printed)"],
  ["statement_count", "W-2 statements in the file"],
  ["form_count", "Information returns listed"],
];

const PLAIN: ReadonlyMap<string, { label: string; rank: number }> = new Map(FIELD_ORDER.map(([key, label], rank) => [key, { label, rank }]));

/**
 * Policy (presentation only; the sources say nothing about it): fields the reader keeps for its own checks — counters,
 * section-presence flags, printed headings, the W-2 copy letter and control number — are collapsed behind "Show all
 * fields". They stay one click away and are always shown when the reader was unsure of them (see presentFields).
 */
export const INTERNAL_FIELD_KEYS: ReadonlySet<string> = new Set([
  "statement_count",
  "form_count",
  "page_one_present",
  "has_ssi_section",
  "has_title2_section",
  "heading_program",
  "heading_subject",
  "copy",
  "control_number_masked",
  "form_number",
  "lease_begin_raw",
]);

const AFTER_KNOWN = 1_000;

const LOOK_ALIKE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  MEDICAID: "Medicaid",
  CHIP: "CHIP",
  OTHER_HEALTH_CARE: "Other health care",
  SSDI: "SSDI",
  SOCIAL_SECURITY_RETIREMENT_SURVIVORS: "Social Security retirement or survivors",
  MEDICARE_EXTRA_HELP: "Medicare Extra Help",
  SPECIAL_VETERANS_BENEFITS: "Special veterans benefits",
  SCHOOL_MEALS: "School meals",
  UNEMPLOYMENT: "Unemployment",
  PUBLIC_HOUSING: "Public housing",
});

const ACRONYMS: Readonly<Record<string, string>> = Object.freeze({
  ssn: "SSN",
  ein: "EIN",
  ssi: "SSI",
  snap: "SNAP",
  tanf: "TANF",
  wic: "WIC",
  hap: "HAP",
  pha: "PHA",
  ira: "IRA",
  agi: "AGI",
  ytd: "year to date",
  irs: "IRS",
  hud: "HUD",
  voc: "VOC",
  w2: "W-2",
  f1040: "Form 1040",
  id: "ID",
});

/** "employee_ssn_last4" → "Employee SSN last4"; "w2_1.box_9_cents" → "W2 1 box 9". Never empty. */
export function tidyKey(key: string): string {
  const words = key
    .replace(/_cents$/, "")
    .split(/[._\s]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase());
  if (words.length === 0) return key.trim() || "Field";
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function sentenceCase(text: string): string {
  const t = text.replace(/_/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The label within a group (or at document level) for a key with any group prefix removed. */
function baseName(base: string, inW2: boolean): { label: string; rank: number } {
  const plain = PLAIN.get(base);
  if (plain) return plain;
  const box = /^box_(\d+)_cents$/.exec(base);
  if (box) return { label: W2_BOXES[box[1]!] ?? `Box ${box[1]}`, rank: 200 + Number(box[1]) };
  const box12 = /^box_12([a-d])_(code|cents)$/.exec(base);
  if (box12) return { label: `Box 12${box12[1]} ${box12[2] === "code" ? "code" : "amount"}`, rank: 240 + (box12[1]!.charCodeAt(0) - 97) * 2 + (box12[2] === "code" ? 0 : 1) };
  const line = /^line_(\w+?)_cents$/.exec(base);
  if (line) {
    const id = line[1]!;
    const order = Number.parseInt(id, 10);
    return { label: FORM_1040_LINES[id] ?? `Line ${id}`, rank: 300 + (Number.isFinite(order) ? order * 2 : 99) + (/[b-z]$/.test(id) ? 1 : 0) };
  }
  // Reviewer-keyed W-2 figure: `<measure>_cents` inside a w2_<n> group.
  const w2Measure = /^(.+)_cents$/.exec(base)?.[1];
  if (inW2 && w2Measure && isMeasure(w2Measure)) return { label: MEASURE_LABELS[w2Measure].short, rank: 200 + measureOrder(w2Measure) };
  // Reviewer-keyed figure elsewhere: `<measure>_<n>_cents`.
  const keyed = /^(.+)_(\d+)_cents$/.exec(base);
  const keyedMeasure = keyed?.[1];
  if (keyed && keyedMeasure && isMeasure(keyedMeasure)) {
    const n = Number(keyed[2]);
    return { label: `${MEASURE_LABELS[keyedMeasure].short}${n > 1 ? ` (${n})` : ""}`, rank: 400 + n };
  }
  const member = /^household_member_(\d+)$/.exec(base);
  if (member) return { label: `Household member ${member[1]}`, rank: 150 + Number(member[1]) };
  const dependent = /^dependent_(\d+)_name$/.exec(base);
  if (dependent) return { label: `Dependent ${dependent[1]}`, rank: 170 + Number(dependent[1]) };
  if (base === "type") return { label: "Form", rank: 0 };
  if (base === "payer") return { label: "Payer", rank: 1 };
  const slugCents = /^(.+?)(_per_computer)?_cents$/.exec(base);
  if (slugCents && TRANSCRIPT_SLUGS[slugCents[1]!]) {
    return { label: `${TRANSCRIPT_SLUGS[slugCents[1]!]}${slugCents[2] ? " (per computer)" : ""}`, rank: 500 };
  }
  return { label: tidyKey(base), rank: AFTER_KNOWN };
}

function measureOrder(measure: IncomeMeasure): number {
  return Object.keys(MEASURE_LABELS).indexOf(measure);
}

/** Label, group and visibility for one stored field key. */
export function fieldName(key: string): FieldName {
  const w2 = /^w2_(\d+)\.(.+)$/.exec(key);
  if (w2) {
    const n = Number(w2[1]);
    const base = baseName(w2[2]!, true);
    return { ...base, known: base.rank !== AFTER_KNOWN, group: `W-2 statement ${n}`, groupOrder: n, internal: INTERNAL_FIELD_KEYS.has(w2[2]!) };
  }
  const form = /^form_(\d+)\.(.+)$/.exec(key);
  if (form) {
    const n = Number(form[1]);
    const base = baseName(form[2]!, false);
    return { ...base, known: base.rank !== AFTER_KNOWN, group: `Form ${n} on the transcript`, groupOrder: n, internal: false };
  }
  const item = /^item\.(.+)$/.exec(key);
  if (item) {
    const named = baseName(item[1]!, false);
    const known = named.rank !== AFTER_KNOWN;
    // A transcript line the slug table does not know: tidy the printed label rather than show the key.
    return { label: known ? named.label : sentenceCase(item[1]!.replace(/_cents$/, "")) || "Transcript line", rank: 500, known, group: null, groupOrder: 0, internal: false };
  }
  const base = baseName(key, false);
  return { ...base, known: base.rank !== AFTER_KNOWN, group: null, groupOrder: 0, internal: INTERNAL_FIELD_KEYS.has(key) };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= days;
}

function enumText(key: string, value: string): string | null {
  const base = key.replace(/^(w2|form)_\d+\./, "");
  if (base === "approval_status") return APPROVAL_STATUS_LABELS[value] ?? null;
  if (base === "program" || base === "look_alike_program") return PROGRAM_LABELS[value] ?? LOOK_ALIKE_LABELS[value] ?? null;
  if (base === "filing_status" || base === "title2_benefit_type") return /^[a-z_]+$/.test(value) ? sentenceCase(value) : null;
  return null;
}

/** How one stored value reads: dollars for cents, dates as dates, enums in words. */
export function formatFieldValue(key: string, value: FieldValue): FieldDisplay {
  if (value === null || value === undefined) return { kind: "missing" };
  if (typeof value === "boolean") return { kind: "text", text: value ? "Yes" : "No" };
  if (typeof value === "number") {
    if (/_cents$/.test(key) && Number.isSafeInteger(value)) return { kind: "money", cents: value };
    // Years, counts and codes: never grouped ("2025", not "2,025").
    return { kind: "text", text: Number.isFinite(value) ? String(value) : "—" };
  }
  const text = value.trim();
  if (text === "") return { kind: "missing" };
  const d = ISO_DATE.exec(text);
  if (d && isRealDate(Number(d[1]), Number(d[2]), Number(d[3]))) return { kind: "date", iso: text };
  const m = ISO_MONTH.exec(text);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { kind: "text", text: `${MONTHS[Number(m[2]) - 1]} ${m[1]}` };
  return { kind: "text", text: enumText(key, text) ?? text };
}

export interface StoredField {
  key: string;
  value: FieldValue;
  confidence: number;
}

/**
 * Every field of one document, labelled, formatted and ordered (group, then reading order, then stored order),
 * split into what is shown by default and what waits behind "Show all fields". An internal field the reader was
 * unsure of (below the reader's own minimum confidence) is shown by default: an uncertain value is never hidden.
 */
export function presentFields(fields: readonly StoredField[], opts: { minConfidence?: number } = {}): PresentedFields {
  const min = opts.minConfidence ?? DEFAULT_DOCUMENT_POLICY.minFieldConfidence;
  const rows = fields
    .map((f, index) => {
      const name = fieldName(f.key);
      const rank = name.rank === AFTER_KNOWN ? AFTER_KNOWN + index : name.rank;
      return { index, row: { ...name, rank, internal: name.internal && f.confidence >= min, key: f.key, display: formatFieldValue(f.key, f.value), confidence: f.confidence } satisfies PresentedField };
    })
    .sort((a, b) => a.row.groupOrder - b.row.groupOrder || a.row.rank - b.row.rank || a.index - b.index)
    .map((r) => r.row);
  const groups = new Set(rows.flatMap((r) => (r.group === null ? [] : [r.group])));
  return { primary: rows.filter((r) => !r.internal), internal: rows.filter((r) => r.internal), grouped: groups.size > 1 };
}
