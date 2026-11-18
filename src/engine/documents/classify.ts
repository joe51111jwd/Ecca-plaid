/**
 * Document classification (reference table P1, with the fact-check corrections).
 *
 * Rules are tested in a fixed order: specific forms before the generic ones they resemble (H1017/H1020
 * before "other HHSC"; the Benefit Verification Letter before SSA notices; transcripts before the W-2 they
 * quote; HUD form numbers before the generic PHA notice). Each rule records the strings it matched in
 * `signals`, so a reviewer can see why a document was put where it was.
 *
 * Confidence: 0.95 when the required identifier and at least one corroborating string match; 0.85 for the
 * required identifier alone; 0.7 for heuristic types whose strings are not from any source (pay stubs, PHA
 * notices, WIC benefit lists, school-meal and unemployment letters).
 */
import { SUBTYPE_KIND, type DocumentKind, type DocumentSubtype } from "./types";
import { detectLanguage, documentTextFromString, flat, fullText, stripSyntheticBanner, type DocumentText } from "./text";

export interface Classification {
  kind: DocumentKind;
  subtype: DocumentSubtype;
  confidence: number;
  signals: string[];
  language: "en" | "es" | "unknown";
}

interface Rule {
  subtype: DocumentSubtype;
  /** All must match (whole-document, whitespace-flattened, case-insensitive). */
  require: RegExp[];
  /** Any of these corroborates. */
  any?: RegExp[];
  /** None of these may match. */
  not?: RegExp[];
  heuristic?: boolean;
  /** Extra test on the structured text (e.g. heading lines on page 1). */
  test?: (doc: DocumentText) => string | null;
}

const SSA = /Social Security Administration/i;

/** Lines 1-3 of the SSA heading block on page 1 (E1 [FC]: match at the top of page 1 only). */
export function ssaHeading(doc: DocumentText): { program: string | null; subject: string | null } | null {
  const page = doc.pages[0];
  if (!page) return null;
  const lines = page.lines.slice(0, 12).map((l) => l.items[0]?.text.trim() ?? "");
  const i = lines.findIndex((t) => /^Social Security Administration$/i.test(t));
  if (i < 0) return null;
  const programs = /^(Supplemental Security Income|Retirement, Survivors,? and Disability Insurance|Extra Help With Medicare Prescription Drug Plan Costs|Special Veterans Benefits)$/i;
  for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
    if (programs.test(lines[k])) return { program: lines[k], subject: lines[k + 1] ?? null };
  }
  return { program: null, subject: lines[i + 1] ?? null };
}

const RULES: readonly Rule[] = [
  // ---- Texas HHSC (B4, B10, B16)
  { subtype: "tx_hhsc_tf0001", require: [/Form\s+TF0001/i], any: [/Notice about your case:/i, /TEXAS HEALTH AND HUMAN SERVICES COMMISSION/i, /Aviso sobre su caso/i] },
  { subtype: "tx_hhsc_h1017", require: [/Notice of Benefit Denial or Reduction/i], any: [/Form\s+H1017/i] },
  { subtype: "tx_hhsc_h1020", require: [/we need more facts from you/i], any: [/Form\s+H?1020/i] },
  { subtype: "tx_hhsc_h1009", require: [/Form\s+H1009|TANF\/SNAP Benefits Notice of Eligibility/i], any: [/Only the checked boxes apply to you/i] },
  { subtype: "tx_hhsc_h1718", require: [/Notice of Benefit Denial(?! or Reduction)/i], any: [/H1718/i] },
  {
    subtype: "tx_hhsc_renewal",
    require: [/It is time to renew your (Health Care )?benefits|Your Texas Benefits:\s*Renewal Form/i],
    any: [/H1830-R/i, /H-?1010R/i, /H1211/i],
  },
  { subtype: "benefit_card", require: [/Lone Star Card|WIC card|Medicaid card|Here is your Lone Star Card/i], not: [/Notice about your case:/i] },
  { subtype: "tx_hhsc_other", require: [/HEALTH AND HUMAN SERVICES COMMISSION/i] },
  // ---- WIC (C1, C2, C6); layouts unverified
  { subtype: "wic_ineligible", require: [/WIC Notification of Ineligibility\s*\/\s*Termination/i] },
  { subtype: "wic_certification", require: [/Verification of Certification/i], any: [/\bWIC\b/i, /Certification End Date/i] },
  { subtype: "wic_benefit_list", require: [/\bWIC\b/i, /shopping list|benefit list|benefit balance/i], heuristic: true },
  // ---- Section 8 (D2, D3, D6, D4/D5)
  { subtype: "hcv_voucher", require: [/form HUD-52646/i], any: [/Voucher/i, /Housing Choice Voucher Program/i] },
  { subtype: "hud_hap_contract", require: [/form HUD-52641|Housing Assistance Payments \(HAP\) Contract/i], any: [/Part A of the HAP Contract/i] },
  { subtype: "hud_50058", require: [/form HUD-50058|Family Report/i], any: [/Type of action/i] },
  {
    subtype: "pha_notice",
    require: [/Housing Authority|Housing Choice Voucher|Section 8/i, /tenant rent|rent portion|family share|\bHAP\b|housing assistance payment/i],
    heuristic: true,
  },
  // ---- SSA (E1, E6)
  { subtype: "ssa_benefit_verification", require: [/Benefit Verification Letter/i], any: [SSA] },
  {
    subtype: "ssa_ssi_notice",
    require: [SSA],
    test: (doc) => (/^Supplemental Security Income$/i.test(ssaHeading(doc)?.program ?? "") ? "SSA heading line 2: Supplemental Security Income" : null),
    any: [/SSA-L8\d{3}/i],
  },
  {
    subtype: "ssa_title2_notice",
    require: [SSA],
    test: (doc) => {
      const program = ssaHeading(doc)?.program ?? "";
      return program && !/^Supplemental Security Income$/i.test(program) ? `SSA heading line 2: ${program}` : null;
    },
  },
  // ---- IRS transcripts before the forms they quote (H1, H4, H7, H8)
  { subtype: "irs_tax_return_transcript", require: [/Tax Return Transcript/i], any: [/This Product Contains Sensitive Taxpayer Data/i, /Tax Period Ending/i] },
  { subtype: "irs_wage_income_transcript", require: [/Wage and Income Transcript/i], any: [/This Product Contains Sensitive Taxpayer Data/i] },
  { subtype: "irs_record_of_account", require: [/Record of Account/i], any: [/This Product Contains Sensitive Taxpayer Data/i] },
  { subtype: "irs_account_transcript", require: [/Account Transcript/i], any: [/This Product Contains Sensitive Taxpayer Data/i] },
  { subtype: "irs_verification_of_nonfiling", require: [/Verification of Non-?filing/i] },
  { subtype: "ssa_other", require: [SSA] },
  // ---- Form 1040 (G2) and W-2 (F1, F3)
  { subtype: "form_1040_variant", require: [/\b1040-?(X|SR|NR)\b/i], any: [/U\.S\. Individual Income Tax Return|Amended U\.S\. Individual Income Tax Return/i] },
  { subtype: "form_1040", require: [/1040\s+U\.S\. Individual Income Tax Return/i], any: [/Form 1040 \(20\d\d\)/i, /OMB No\. 1545-0074/i] },
  { subtype: "irs_w2c", require: [/Corrected Wage and Tax Statement|Form\s+W-2c\b/i] },
  { subtype: "irs_w2", require: [/Wage and Tax Statement/i], any: [/Form\s+W-2/i, /OMB No\. 1545-0029/i, /Wages, tips, other compensation/i] },
  // ---- Look-alikes with no source strings (heuristics)
  {
    subtype: "school_meals_notice",
    require: [/free (or|and) reduced[- ]price (meals|lunch)|National School Lunch Program|school meal benefits/i],
    heuristic: true,
  },
  { subtype: "unemployment_notice", require: [/unemployment (benefits|insurance|compensation)/i, /Texas Workforce Commission|weekly benefit amount/i], heuristic: true },
];

const PAYSTUB_LABELS: ReadonlyArray<[string, RegExp]> = [
  ["Pay Period", /Pay Period|Period (Beginning|Ending|Start|End)|Pay (Begin|End) Date/i],
  ["Pay Date", /Pay Date|Check Date|Advice Date|Payment Date/i],
  ["Gross Pay", /Gross (Pay|Earnings)|Total Gross|Total Earnings/i],
  ["Net Pay", /Net (Pay|Check)|Take Home/i],
  ["YTD", /\bYTD\b|Year[- ]to[- ]Date/i],
  ["Earnings", /\bEarnings\b/i],
  ["Deductions", /\bDeductions\b/i],
];

/** Classifies a document. Accepts raw text or the line model. */
export function classifyDocument(input: string | DocumentText): Classification {
  const doc = stripSyntheticBanner(typeof input === "string" ? documentTextFromString(input) : input);
  const text = flat(fullText(doc));
  const language = detectLanguage(text);

  for (const rule of RULES) {
    if (!rule.require.every((re) => re.test(text))) continue;
    if (rule.not?.some((re) => re.test(text))) continue;
    const signals = rule.require.map((re) => `matched ${matchedText(text, re)}`);
    if (rule.test) {
      const s = rule.test(doc);
      if (!s) continue;
      signals.push(s);
    }
    const corroborating = (rule.any ?? []).filter((re) => re.test(text));
    for (const re of corroborating) signals.push(`corroborated by ${matchedText(text, re)}`);
    const confidence = rule.heuristic ? 0.7 : corroborating.length > 0 || rule.test ? 0.95 : 0.85;
    return { kind: SUBTYPE_KIND[rule.subtype], subtype: rule.subtype, confidence, signals, language };
  }

  const stubHits = PAYSTUB_LABELS.filter(([, re]) => re.test(text)).map(([label]) => label);
  if (stubHits.length >= 2 && /Gross/i.test(text)) {
    return {
      kind: "pay_stub",
      subtype: "pay_stub",
      confidence: stubHits.length >= 4 ? 0.8 : 0.7,
      signals: stubHits.map((l) => `pay-stub label: ${l}`),
      language,
    };
  }
  return { kind: "unknown", subtype: "unknown", confidence: 0, signals: ["no identifying form, agency or label found"], language };
}

function matchedText(text: string, re: RegExp): string {
  const m = re.exec(text);
  return m ? JSON.stringify(m[0].slice(0, 80)) : re.source;
}
