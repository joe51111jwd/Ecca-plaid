/**
 * Form 1040, U.S. Individual Income Tax Return (reference G1-G5, P8).
 *
 * Lines are found by their printed label text (verified on the 2025 form, G1), not by position, and the
 * amount is the first amount after the label (the line number printed again beside the box is skipped).
 * The line map is per year (G3): 2024 has AGI on line 11; 2025 and the 2026 draft on 11a and 11b.
 * Filing status is a check box (G2): read only when a text-layer mark (`[X]`, `X`, `☒`) sits on exactly one
 * status; otherwise it is left empty with a warning (household size never comes from a return, item 12).
 */
import { flat, fullText, nextLine, nearestItem, type LineRef } from "../text";
import type { Extraction, IncomeAmount, IncomeDocumentSummary, IncomeMeasure, IncomePerson } from "../types";
import { allRefs, amountAfterLabel, CONF_VERIFIED, ExtractionBuilder, isPlausibleName, type ExtractContext } from "./common";

interface LineSpec {
  key: string;
  id: string;
  label: RegExp;
  measure: IncomeMeasure | null;
  category: string | null;
  allowNegative?: boolean;
}

const LINES: readonly LineSpec[] = [
  { key: "line_1a_cents", id: "1a", label: /Total amount from Form\(?s\)? W-2, box 1(?: \(see instructions\))?/i, measure: "f1040_wages_line_1a", category: "wages_salary" },
  { key: "line_1z_cents", id: "1z", label: /Add lines 1a through 1h/i, measure: "f1040_wages_line_1z", category: null },
  { key: "line_2a_cents", id: "2a", label: /Tax-exempt interest/i, measure: "f1040_tax_exempt_interest", category: null },
  { key: "line_2b_cents", id: "2b", label: /Taxable interest/i, measure: "f1040_taxable_interest", category: "interest_dividends" },
  { key: "line_3a_cents", id: "3a", label: /Qualified dividends/i, measure: null, category: null },
  { key: "line_3b_cents", id: "3b", label: /Ordinary dividends/i, measure: "f1040_ordinary_dividends", category: "interest_dividends" },
  { key: "line_4a_cents", id: "4a", label: /IRA distributions/i, measure: null, category: null },
  { key: "line_4b_cents", id: "4b", label: /(?<=IRA distributions.*)Taxable amount/i, measure: "f1040_ira_distributions_taxable", category: null },
  { key: "line_5a_cents", id: "5a", label: /Pensions and annuities/i, measure: null, category: null },
  { key: "line_5b_cents", id: "5b", label: /(?<=Pensions and annuities.*)Taxable amount/i, measure: "f1040_pensions_taxable", category: null },
  { key: "line_6a_cents", id: "6a", label: /Social security benefits/i, measure: "f1040_social_security_total", category: null },
  { key: "line_6b_cents", id: "6b", label: /(?<=Social security benefits.*)Taxable amount/i, measure: "f1040_social_security_taxable", category: null },
  { key: "line_7a_cents", id: "7a", label: /Capital gain or \(loss\)(?:\. Attach Schedule D if required)?/i, measure: "f1040_capital_gain", category: null, allowNegative: true },
  { key: "line_8_cents", id: "8", label: /Additional income from Schedule 1, line 10/i, measure: "f1040_additional_income_schedule_1", category: null, allowNegative: true },
  { key: "line_9_cents", id: "9", label: /This is your total income/i, measure: "f1040_total_income", category: null, allowNegative: true },
  { key: "line_10_cents", id: "10", label: /Adjustments to income from Schedule 1, line 26/i, measure: "f1040_adjustments", category: null },
  { key: "line_11a_cents", id: "11a", label: /Subtract line 10 from line 9\. This is your adjusted gross income/i, measure: "f1040_agi", category: null, allowNegative: true },
  { key: "line_11b_cents", id: "11b", label: /Amount from line 11a \(adjusted gross income\)/i, measure: null, category: null, allowNegative: true },
  { key: "line_15_cents", id: "15", label: /This is your taxable income/i, measure: null, category: null },
];

const FILING_STATUSES: ReadonlyArray<[string, RegExp]> = [
  ["single", /Single/],
  ["married_filing_jointly", /Married filing jointly/i],
  ["married_filing_separately", /Married filing separately/i],
  ["head_of_household", /Head of household/i],
  ["qualifying_surviving_spouse", /Qualifying surviving spouse/i],
];
const CHECKED = /(?:\[\s*[Xx✓✔]\s*\]|☒|☑|■)\s*$/;

/** Arithmetic tolerance: the reference allows one dollar for rounding (P8). */
const ARITHMETIC_TOLERANCE_CENTS = 100;

function readNames(b: ExtractionBuilder, refs: LineRef[], label: RegExp, key: string): string | null {
  for (const ref of refs) {
    const firstLabel = ref.line.items.find((it) => label.test(it.text));
    if (!firstLabel) continue;
    const lastLabel = ref.line.items.find((it) => it !== firstLabel && /^Last name$/i.test(it.text.trim()) && it.x > firstLabel.x);
    const below = nextLine(ref);
    if (!below) continue;
    const first = nearestItem(below.line, firstLabel.x);
    const last = lastLabel ? nearestItem(below.line, lastLabel.x) : null;
    const name = [first?.text, last && last !== first ? last.text : null].filter(Boolean).join(" ").trim();
    if (name && isPlausibleName(name)) {
      b.set(key, name, CONF_VERIFIED, below);
      return name;
    }
  }
  return null;
}

export function extractForm1040(ctx: ExtractContext, subtype: "form_1040" | "form_1040_variant"): Extraction {
  const b = new ExtractionBuilder(subtype, ctx.policy);
  const text = flat(fullText(ctx.doc));
  const refs = allRefs(ctx.doc);
  if (subtype === "form_1040_variant") {
    b.review("unsupported_form_variant", "Form 1040-X, 1040-SR and 1040-NR layouts are not in the sources; a person must read this return.");
  }
  if (/DRAFT\s*-\s*NOT FOR FILING|\bDRAFT\b/i.test(text)) {
    b.review("draft_form", "The return carries DRAFT marks; a filed return does not (G4 [FC]).");
  }

  const year = /1040\s+U\.S\. Individual Income Tax Return\s+(20\d\d)/i.exec(text) ?? /Form 1040 \((20\d\d)\)/i.exec(text);
  const taxYear = year ? Number(year[1]) : null;
  if (taxYear !== null) b.set("tax_year", taxYear, CONF_VERIFIED, refs.find((r) => /U\.S\. Individual Income Tax Return|Form 1040 \(/i.test(r.line.text)) ?? null);
  b.require("tax_year");
  if (taxYear !== null && taxYear >= 2026) b.review("layout_unverified", "Only a draft of the 2026 Form 1040 exists; its line map must be re-checked against the final form.");

  const filer = readNames(b, refs, /Your first name and middle initial/i, "filer_name");
  const spouse = readNames(b, refs, /If joint return, spouse's first name and middle initial/i, "spouse_name");
  b.require("filer_name");
  const ssn = /Your social security number\s+([0-9Xx*]{3}[- ]?[0-9Xx*]{2}[- ]?(\d{4}))/i.exec(text);
  if (ssn) b.set("filer_ssn_last4", ssn[2], CONF_VERIFIED, null);

  const checked = FILING_STATUSES.filter(([, re]) => refs.some((r) => r.line.items.some((it, i) => re.test(it.text) && i > 0 && CHECKED.test(r.line.items[i - 1].text))));
  const markedInline = FILING_STATUSES.filter(([, re]) => refs.some((r) => new RegExp(`(?:\\[\\s*[Xx✓✔]\\s*\\]|☒|☑)\\s*${re.source}`, "i").test(r.line.text)));
  const statuses = [...new Set([...checked, ...markedInline].map(([s]) => s))];
  if (statuses.length === 1) b.set("filing_status", statuses[0], 0.85, refs.find((r) => /Filing Status/i.test(r.line.text)) ?? null);
  else b.warn("Filing status is a check box and could not be read from the text; a person can confirm it if needed.");

  // Dependents grid: "(1) First name" and "(2) Last name" rows, one column per dependent.
  const firstRow = refs.find((r) => /\(1\) First name/i.test(r.line.text));
  const lastRow = refs.find((r) => /\(2\) Last name/i.test(r.line.text));
  const dependents: string[] = [];
  if (firstRow && lastRow) {
    const firsts = firstRow.line.items.filter((it) => !/\(1\) First name/i.test(it.text));
    for (const f of firsts) {
      const l = nearestItem(lastRow.line, f.x, 20);
      const name = `${f.text} ${l?.text ?? ""}`.trim();
      if (isPlausibleName(name)) dependents.push(name);
    }
    dependents.forEach((d, i) => b.set(`dependent_${i + 1}_name`, d, CONF_VERIFIED, firstRow));
  }

  for (const spec of LINES) {
    for (const ref of refs) {
      if (!spec.label.test(ref.line.text)) continue;
      // 2024 forms print AGI as line "11", later forms as "11a" (G3).
      const skipTokens = spec.id === "11a" ? ["11a", "11"] : [spec.id];
      const cents = amountAfterLabel(ref, spec.label, { skipTokens, allowNegative: spec.allowNegative });
      if (cents !== null) {
        b.set(spec.key, cents, CONF_VERIFIED, ref);
        break;
      }
    }
  }
  // 2024 returns put AGI on line 11 (G3).
  if (taxYear === 2024 && b.value("line_11a_cents") === null) {
    const ref = refs.find((r) => /This is your adjusted gross income/i.test(r.line.text));
    const cents = ref ? amountAfterLabel(ref, /This is your adjusted gross income/i, { skipTokens: ["11"], allowNegative: true }) : null;
    if (ref && cents !== null) b.set("line_11a_cents", cents, CONF_VERIFIED, ref);
  }
  b.require("line_9_cents", "line_11a_cents");

  // Arithmetic (P8): line 9 = 1z + 2b + 3b + 4b + 5b + 6b + 7a + 8; line 11a = 9 - 10; 11a = 11b.
  const v = (key: string) => b.value<number>(key);
  const line9 = v("line_9_cents");
  if (line9 !== null) {
    const parts = ["line_1z_cents", "line_2b_cents", "line_3b_cents", "line_4b_cents", "line_5b_cents", "line_6b_cents", "line_7a_cents", "line_8_cents"];
    const sum = parts.reduce((acc, key) => acc + (v(key) ?? 0), 0);
    if (Math.abs(sum - line9) > ARITHMETIC_TOLERANCE_CENTS) {
      b.review("arithmetic_mismatch", "Line 9 does not equal the sum of the income lines above it.");
      b.signal(`line 9 ${line9} vs component sum ${sum}`);
    } else b.signal("line 9 equals the sum of its components");
    const agi = v("line_11a_cents");
    if (agi !== null && Math.abs(line9 - (v("line_10_cents") ?? 0) - agi) > ARITHMETIC_TOLERANCE_CENTS) {
      b.review("arithmetic_mismatch", "Line 11a does not equal line 9 minus line 10.");
    }
  }
  const a = v("line_11a_cents");
  const bb = v("line_11b_cents");
  if (a !== null && bb !== null && a !== bb) b.review("arithmetic_mismatch", "Line 11b does not repeat line 11a.");

  const selfEmployment =
    /SCHEDULE C\b|Profit or Loss From Business|SCHEDULE SE\b|Self-Employment Tax/i.test(text) || /Business income or \(loss\)/i.test(text);
  b.set("self_employment_indicated", selfEmployment, 0.9, refs.find((r) => /SCHEDULE C\b|SCHEDULE SE\b|Profit or Loss From Business/i.test(r.line.text)) ?? null);
  if (selfEmployment) {
    b.review("self_employment_indicated", "The return includes self-employment (Schedule C or SE); net self-employment income needs a person.");
  }
  if (/\bSchedule E\b|Supplemental Income and Loss/i.test(text)) b.warn("Schedule E is attached; rental and pass-through income is not read.");

  const people: IncomePerson[] = [];
  if (filer) people.push({ name: filer, role: "filer", masked: false, ssnLast4: b.value<string>("filer_ssn_last4") });
  if (spouse) people.push({ name: spouse, role: "spouse", masked: false, ssnLast4: null });
  for (const d of dependents) people.push({ name: d, role: "dependent", masked: false, ssnLast4: null });
  const amounts: IncomeAmount[] = [];
  const joint = filer && spouse ? null : filer;
  for (const spec of LINES) {
    const f = b.fields[spec.key];
    if (!spec.measure || !f || typeof f.value !== "number") continue;
    amounts.push({ measure: spec.measure, amountCents: f.value, person: joint, payer: null, suggestedCategory: spec.category, fieldKey: spec.key, confidence: f.confidence });
  }
  const income: IncomeDocumentSummary = {
    taxYear,
    people,
    amounts,
    selfEmploymentIndicated: selfEmployment,
    payPeriod: null,
    payDate: null,
    likelyFinalStubOfYear: null,
    extractionConfidence: b.minConfidence(["tax_year", "filer_name", "line_9_cents", "line_11a_cents"]),
    extractedBy: "parser",
  };
  return b.build(null, income);
}
