/**
 * IRS transcripts (reference H1-H9, P9).
 *
 * Tax Return Transcript: labels are upper case, followed by a colon, dot leaders and an amount (H4). Where
 * an item has both a "per return" and a "PER COMPUTER" value, the PER COMPUTER (IRS-corrected) value is
 * reported, following federal student aid practice (H5); both are kept as fields. Every TRT string except
 * the H5 item names is from one 2019 mock-up, so a TRT is `layout_unverified` unless `taxReturnTranscript`
 * is on. Wage and Income, Record of Account and Account transcripts have no layout in the sources and are
 * always reviewed (H7). Names on masked transcripts are four-letter prefixes (H2); SSNs are masked again
 * here because unmasked Wage and Income transcripts exist (H2 [FC]).
 */
import { parseDocumentDate } from "../dates";
import { maskIdentifier, ssnLast4 } from "../redact";
import { flat, fullText, type LineRef } from "../text";
import type { DocumentSubtype, Extraction, IncomeAmount, IncomeDocumentSummary, IncomeMeasure, IncomePerson } from "../types";
import { allRefs, CONF_HEURISTIC, CONF_SECONDARY, ExtractionBuilder, money, type ExtractContext } from "./common";

/** `LABEL:.......$1,234.00` (H4). The dollar sign is required, so identifiers are never read as amounts. */
const LABEL_LINE = /^\s*([A-Z0-9][A-Z0-9 ,/&:().'-]*?[A-Z)]):[.\s]*(-?\$-?[\d,]+(?:\.\d{2})?)\s*$/i;

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(schedule c\)|sch c|sch b/g, (m) => m.replace(/[()]/g, ""))
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface ItemSpec {
  measure: IncomeMeasure;
  /** Normalised label of the per-return value, and its PER COMPUTER variant when one exists. */
  labels: RegExp;
  category: string | null;
}

const TRT_ITEMS: readonly ItemSpec[] = [
  { measure: "transcript_wages", labels: /^WAGES, SALARIES, TIPS, ETC$/i, category: "wages_salary" },
  { measure: "transcript_business_income", labels: /^BUSINESS INCOME OR LOSS(?: \(Schedule C\)|: SCH C)?(?: PER COMPUTER)?$/i, category: "self_employment_net" },
  { measure: "transcript_unemployment", labels: /^UNEMPLOYMENT COMPENSATION$/i, category: "unemployment" },
  { measure: "transcript_social_security_total", labels: /^TOTAL SOCIAL SECURITY BENEFITS$/i, category: null },
  { measure: "transcript_pensions_total", labels: /^TOTAL PENSIONS AND ANNUITIES$/i, category: null },
  { measure: "transcript_ira_total", labels: /^TOTAL IRA DISTRIBUTIONS$/i, category: null },
  { measure: "transcript_total_income", labels: /^TOTAL INCOME(?: PER COMPUTER)?$/i, category: null },
  { measure: "transcript_agi", labels: /^ADJUSTED GROSS INCOME(?: PER COMPUTER)?$/i, category: null },
];

interface LabeledAmount {
  label: string;
  cents: number;
  ref: LineRef;
}

function labeledAmounts(refs: LineRef[]): LabeledAmount[] {
  const out: LabeledAmount[] = [];
  for (const ref of refs) {
    const m = LABEL_LINE.exec(ref.line.text);
    if (!m) continue;
    const cents = money(m[2], true);
    if (cents === null) continue;
    out.push({ label: m[1].replace(/\s+/g, " ").trim(), cents, ref });
  }
  return out;
}

function headerValue(refs: LineRef[], label: RegExp): { value: string; ref: LineRef } | null {
  for (const ref of refs) {
    const m = label.exec(ref.line.text);
    if (m) return { value: ref.line.text.slice((m.index ?? 0) + m[0].length).trim(), ref };
  }
  return null;
}

function readTaxYear(b: ExtractionBuilder, refs: LineRef[]): number | null {
  const h = headerValue(refs, /Tax Period (?:Ending|Requested):\s*/i);
  if (!h) return null;
  const d = parseDocumentDate(h.value);
  const year = d.ok ? Number(d.date.slice(0, 4)) : Number(/\b(20\d\d)\b/.exec(h.value)?.[1] ?? NaN);
  if (!Number.isInteger(year)) return null;
  b.set("tax_year", year, CONF_SECONDARY, h.ref);
  return year;
}

function readHeader(b: ExtractionBuilder, refs: LineRef[]): void {
  for (const [key, label] of [
    ["request_date", /Request Date:\s*/i],
    ["response_date", /Response Date:\s*/i],
  ] as const) {
    const h = headerValue(refs, label);
    const d = h ? parseDocumentDate(h.value.split(/\s{2,}/)[0]) : null;
    if (h && d?.ok) b.set(key, d.date, CONF_SECONDARY, h.ref);
    else if (h && d && !d.ok && d.reason === "ambiguous") b.review("date_ambiguous", `The ${key.replace("_", " ")} can be read more than one way.`);
  }
  const tracking = headerValue(refs, /Tracking Number:\s*/i);
  if (tracking && /\d/.test(tracking.value)) b.set("tracking_number_masked", maskIdentifier(tracking.value), CONF_SECONDARY, tracking.ref);
  const cfn = headerValue(refs, /Customer File Number:\s*/i);
  if (cfn && /^\d{1,10}$/.test(cfn.value)) b.set("customer_file_number", cfn.value, CONF_SECONDARY, cfn.ref);
  const ssn = headerValue(refs, /SSN Provided:\s*|^SSN:\s*/i);
  const last4 = ssn ? ssnLast4(ssn.value) : null;
  if (ssn && last4) b.set("ssn_last4", last4, CONF_SECONDARY, ssn.ref);
  const spouse = headerValue(refs, /SPOUSE SSN:\s*/i);
  const spouseLast4 = spouse ? ssnLast4(spouse.value) : null;
  if (spouse && spouseLast4) b.set("spouse_ssn_last4", spouseLast4, CONF_SECONDARY, spouse.ref);
  const names = headerValue(refs, /NAME\(S\) SHOWN ON RETURN:\s*/i);
  if (names && names.value) b.set("names_shown", names.value, CONF_SECONDARY, names.ref);
  const status = headerValue(refs, /FILING STATUS:\s*/i);
  if (status && status.value) b.set("filing_status", status.value, CONF_SECONDARY, status.ref);
  const form = headerValue(refs, /FORM NUMBER:\s*/i);
  if (form && form.value) b.set("form_number", form.value, CONF_SECONDARY, form.ref);
}

function people(b: ExtractionBuilder): IncomePerson[] {
  const shown = b.value<string>("names_shown");
  if (!shown) return [];
  return shown
    .split(/\s*(?:&|\bAND\b)\s*/i)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name, i) => ({ name, role: "taxpayer" as const, masked: true, ssnLast4: i === 0 ? b.value<string>("ssn_last4") : b.value<string>("spouse_ssn_last4") }));
}

function finishIncome(b: ExtractionBuilder, taxYear: number | null, ppl: IncomePerson[], amounts: IncomeAmount[], selfEmployment: boolean): IncomeDocumentSummary {
  return {
    taxYear,
    people: ppl,
    amounts,
    selfEmploymentIndicated: selfEmployment,
    payPeriod: null,
    payDate: null,
    likelyFinalStubOfYear: null,
    extractionConfidence: b.minConfidence(["tax_year", ...amounts.map((a) => a.fieldKey)]),
    extractedBy: "parser",
  };
}

export function extractTaxReturnTranscript(ctx: ExtractContext): Extraction {
  const b = new ExtractionBuilder("irs_tax_return_transcript", ctx.policy);
  const refs = allRefs(ctx.doc);
  const text = flat(fullText(ctx.doc));
  readHeader(b, refs);
  const taxYear = readTaxYear(b, refs);
  b.require("tax_year");

  if (/No record of return filed/i.test(text)) {
    b.reject("no_return_on_file", "The transcript says no return is on file; it is not income evidence and not proof of non-filing (H8).");
    return b.build(null, finishIncome(b, taxYear, people(b), [], false));
  }

  const items = labeledAmounts(refs);
  for (const it of items) b.set(`item.${slug(it.label)}_cents`, it.cents, CONF_SECONDARY, it.ref);
  const amounts: IncomeAmount[] = [];
  for (const spec of TRT_ITEMS) {
    const matches = items.filter((it) => spec.labels.test(it.label));
    if (matches.length === 0) continue;
    const perComputer = matches.find((it) => /PER COMPUTER$/i.test(it.label));
    const chosen = perComputer ?? matches[0];
    const fieldKey = `item.${slug(chosen.label)}_cents`;
    if (perComputer && matches.some((m) => m !== perComputer && m.cents !== perComputer.cents)) {
      b.signal(`${spec.measure}: PER COMPUTER value used (differs from the per-return value)`);
    }
    amounts.push({ measure: spec.measure, amountCents: chosen.cents, person: null, payer: null, suggestedCategory: spec.category, fieldKey, confidence: CONF_SECONDARY });
  }
  const agi = amounts.find((a) => a.measure === "transcript_agi");
  if (agi) b.alias("agi_cents", agi.fieldKey);
  const total = amounts.find((a) => a.measure === "transcript_total_income");
  if (total) b.alias("total_income_cents", total.fieldKey);
  const wages = amounts.find((a) => a.measure === "transcript_wages");
  if (wages) b.alias("wages_cents", wages.fieldKey);
  b.require("agi_cents");
  const business = amounts.find((a) => a.measure === "transcript_business_income");
  const selfEmployment = business !== undefined && business.amountCents !== 0;
  if (selfEmployment) b.review("self_employment_indicated", "The return reports business income (Schedule C); net self-employment income needs a person.");
  if (!ctx.policy.autoAcceptUnverifiedLayouts.taxReturnTranscript) {
    b.review("layout_unverified", "The Tax Return Transcript layout comes from a 2019 sample; a person must confirm the pre-filled figures.");
  }
  b.warn("A Tax Return Transcript does not show amended returns and lists at most four dependents (H6).");
  return b.build(null, finishIncome(b, taxYear, people(b), amounts, selfEmployment));
}

export function extractOtherTranscript(
  ctx: ExtractContext,
  subtype: Extract<DocumentSubtype, "irs_wage_income_transcript" | "irs_record_of_account" | "irs_account_transcript" | "irs_verification_of_nonfiling">,
): Extraction {
  const b = new ExtractionBuilder(subtype, ctx.policy);
  const refs = allRefs(ctx.doc);
  const text = flat(fullText(ctx.doc));
  readHeader(b, refs);
  const taxYear = readTaxYear(b, refs);
  const amounts: IncomeAmount[] = [];

  if (subtype === "irs_verification_of_nonfiling") {
    if (/no record of a processed tax return/i.test(text)) {
      b.set("nonfiler_supported", true, CONF_SECONDARY, refs.find((r) => /no record of a processed tax return/i.test(r.line.text)) ?? null);
      b.review("supports_nonfiler_statement", "The letter supports a statement that no return was processed; it gives no income figure (H8).");
    } else if (/couldn'?t honor the request|could not honor the request/i.test(text)) {
      b.set("nonfiler_supported", false, CONF_SECONDARY, refs.find((r) => /honor the request/i.test(r.line.text)) ?? null);
      b.reject("return_on_file", "The letter says a return was processed; ask for the Tax Return Transcript instead.");
    } else {
      b.review("approval_unclear", "The letter carries neither of the two IRS wordings for a non-filing letter.");
    }
    b.review("layout_unverified", "The printed layout of the non-filing letter is not in the sources.");
    return b.build(null, finishIncome(b, taxYear, [], [], false));
  }

  if (/No record of return filed/i.test(text)) {
    b.reject("no_return_on_file", "The transcript says no record is on file yet; it is not income evidence.");
  }

  if (subtype === "irs_wage_income_transcript") {
    // Layout NOT IN SOURCES (H7): read form blocks heuristically, for the reviewer only.
    let block: { form: string; payer: string | null; ref: LineRef } | null = null;
    let n = 0;
    for (const ref of refs) {
      const t = ref.line.text.trim();
      const formHeader = /^Form (W-2|1099-[A-Z]+|SSA-1099|1098|5498)\b/i.exec(t);
      if (formHeader) {
        block = { form: formHeader[1].toUpperCase(), payer: null, ref };
        n++;
        b.set(`form_${n}.type`, `Form ${block.form}`, CONF_HEURISTIC, ref);
        continue;
      }
      if (!block) continue;
      const payer = /^(?:Employer|Payer):\s*(.+)$/i.exec(t);
      if (payer) {
        block.payer = payer[1].trim();
        b.set(`form_${n}.payer`, block.payer, CONF_HEURISTIC, ref);
        continue;
      }
      const amount = /^(Wages, Tips and Other Compensation|Nonemployee Compensation|Unemployment Compensation|Gross Distribution):\s*(\$?[\d,]+\.\d{2})$/i.exec(t);
      if (amount) {
        const cents = money(amount[2]);
        if (cents === null) continue;
        const key = `form_${n}.${slug(amount[1])}_cents`;
        b.set(key, cents, CONF_HEURISTIC, ref);
        const measure: IncomeMeasure = block.form === "W-2" ? "wai_w2_wages" : "wai_1099_amount";
        amounts.push({ measure, amountCents: cents, person: null, payer: block.payer, suggestedCategory: block.form === "W-2" ? "wages_salary" : null, fieldKey: key, confidence: CONF_HEURISTIC });
      }
    }
    b.set("form_count", n, CONF_HEURISTIC, null);
    b.warn("A Wage and Income Transcript may not list every information return and shows no State withholding (H7).");
  } else {
    for (const it of labeledAmounts(refs)) b.set(`item.${slug(it.label)}_cents`, it.cents, CONF_HEURISTIC, it.ref);
  }
  b.review("layout_unverified", "This transcript type has no verified layout; the fields are pre-filled for a reviewer (H7).");
  return b.build(null, finishIncome(b, taxYear, people(b), amounts, false));
}
