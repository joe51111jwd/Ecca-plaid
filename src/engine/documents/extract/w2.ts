/**
 * Form W-2, Wage and Tax Statement (reference F1-F5, P7).
 *
 * Anchored on box labels, not coordinates (F2 [FC]: positions shift between years): each value is read on
 * the label's own line or directly below the label. A document may hold several statements (one per page,
 * e.g. two jobs); fields are keyed `w2_<n>.<field>`. Box 1, 3 and 5 and every box 12 code are reported
 * without interpretation (F5: which box is "income" is the income engine's question).
 */
import { maskIdentifier, ssnLast4 } from "../redact";
import { flat, nearestItem, nextLine, valueAfterLabel, type DocumentText, type LineRef, type TextPage } from "../text";
import type { Extraction, IncomeAmount, IncomeDocumentSummary, IncomePerson } from "../types";
import { CONF_VERIFIED, ExtractionBuilder, isPlausibleName, money, type ExtractContext } from "./common";

const MONEY_CELL = /^\$?(\d{1,3}(,\d{3})+|\d+)(\.\d{2})?$/;
const NAME_CELL = /^[A-Za-zÀ-ÿ' .-]+$/;

const BOXES: ReadonlyArray<{ box: string; label: RegExp }> = [
  { box: "1", label: /\b1\s+Wages, tips, other compensation/i },
  { box: "2", label: /\b2\s+Federal income tax withheld/i },
  { box: "3", label: /\b3\s+Social security wages/i },
  { box: "4", label: /\b4\s+Social security tax withheld/i },
  { box: "5", label: /\b5\s+Medicare wages and tips/i },
  { box: "6", label: /\b6\s+Medicare tax withheld/i },
  { box: "7", label: /\b7\s+Social security tips/i },
  { box: "10", label: /\b10\s+Dependent care benefits/i },
  { box: "16", label: /\b16\s+State wages, tips, etc\./i },
];

function pageDoc(page: TextPage, source: DocumentText["source"]): DocumentText {
  return { pages: [page], source };
}

function readStatement(b: ExtractionBuilder, doc: DocumentText, n: number): { amounts: IncomeAmount[]; person: IncomePerson | null; employer: string | null; taxYear: number | null } {
  const k = (f: string) => `w2_${n}.${f}`;
  const text = flat(doc.pages[0].text);
  const pageRef = (re: RegExp): LineRef | null => {
    const page = doc.pages[0];
    const index = page.lines.findIndex((l) => re.test(l.text));
    return index >= 0 ? { page, line: page.lines[index], index } : null;
  };

  const year = /Wage and Tax Statement\s+(20\d\d)\b/i.exec(text) ?? /\bForm\s+W-2\b.{0,40}?\b(20\d\d)\b/i.exec(text);
  const taxYear = year ? Number(year[1]) : null;
  if (taxYear !== null) b.set(k("tax_year"), taxYear, CONF_VERIFIED, pageRef(/Wage and Tax Statement|Form\s+W-2/i));
  b.require(k("tax_year"));

  const copy = /\bCopy\s+(B|C|2|1|A|D)\b/.exec(text);
  if (copy) b.set(k("copy"), copy[1], CONF_VERIFIED, pageRef(/\bCopy\s+(B|C|2|1|A|D)\b/));

  const ssn = valueAfterLabel(doc, /a\s+Employee's social security number/i, /^[0-9Xx*]{3}[- ]?[0-9Xx*]{2}[- ]?\d{4}$/);
  const last4 = ssn ? ssnLast4(ssn.value) : null;
  if (ssn && last4) b.set(k("employee_ssn_last4"), last4, CONF_VERIFIED, ssn.ref);

  const ein = valueAfterLabel(doc, /b\s+Employer identification number \(EIN\)/i, /^[0-9Xx*]{2}-?[0-9Xx*]{7}$/);
  if (ein) b.set(k("employer_ein_masked"), `XX-XXX${ein.value.slice(-4)}`, CONF_VERIFIED, ein.ref);

  const employer = valueAfterLabel(doc, /c\s+Employer's name, address, and ZIP code/i, /^[A-Za-z0-9&'.,\- ]{2,80}$/);
  if (employer) b.set(k("employer_name"), employer.value, CONF_VERIFIED, employer.ref);
  b.require(k("employer_name"));

  const control = valueAfterLabel(doc, /d\s+Control number/i, /^[A-Za-z0-9-]{1,30}$/);
  if (control) b.set(k("control_number_masked"), maskIdentifier(control.value), CONF_VERIFIED, control.ref);

  // Box e: first name and initial, then "Last name" in its own column, value below each label.
  let employeeName: string | null = null;
  const eRef = pageRef(/e\s+Employee's first name and initial/i);
  if (eRef) {
    const firstLabel = eRef.line.items.find((it) => /Employee's first name and initial/i.test(it.text));
    const lastLabel = eRef.line.items.find((it) => /^Last name$/i.test(it.text.trim()));
    const below = nextLine(eRef);
    if (below && firstLabel) {
      const first = nearestItem(below.line, firstLabel.x);
      const last = lastLabel ? nearestItem(below.line, lastLabel.x) : null;
      const joined = [first?.text, last && last !== first ? last.text : null].filter(Boolean).join(" ").trim();
      if (joined && NAME_CELL.test(joined) && isPlausibleName(joined)) {
        employeeName = joined;
        b.set(k("employee_name"), joined, CONF_VERIFIED, below);
      }
    }
  }
  b.require(k("employee_name"));

  const amounts: IncomeAmount[] = [];
  for (const { box, label } of BOXES) {
    const v = valueAfterLabel(doc, label, MONEY_CELL);
    if (!v) continue;
    const cents = money(v.value);
    if (cents === null) {
      b.review("field_missing", `Box ${box} is not a readable amount.`);
      continue;
    }
    b.set(k(`box_${box}_cents`), cents, CONF_VERIFIED, v.ref);
  }
  b.require(k("box_1_cents"));

  // Box 12a-12d: a code (one or two letters) and an amount, printed below the box label.
  const page = doc.pages[0];
  page.lines.forEach((line, index) => {
    for (const item of line.items) {
      const m = /^12([a-d])\b/i.exec(item.text.trim());
      if (!m) continue;
      const below = nextLine({ page, line, index });
      if (!below) continue;
      const cells = below.line.items.filter((it) => it.x >= item.x - 10 && it.x <= item.x + 120);
      const code = cells.find((c) => /^[A-Z]{1,2}$/.test(c.text.trim()));
      const amount = cells.find((c) => MONEY_CELL.test(c.text.trim()));
      if (code && amount) {
        const cents = money(amount.text);
        if (cents === null) continue;
        b.set(k(`box_12${m[1].toLowerCase()}_code`), code.text.trim(), CONF_VERIFIED, below);
        b.set(k(`box_12${m[1].toLowerCase()}_cents`), cents, CONF_VERIFIED, below);
      }
    }
  });

  const person: IncomePerson | null = employeeName ? { name: employeeName, role: "employee", masked: false, ssnLast4: last4 } : null;
  const payer = b.value<string>(k("employer_name"));
  const push = (field: string, measure: IncomeAmount["measure"], suggestedCategory: string | null) => {
    const f = b.fields[k(field)];
    if (f && typeof f.value === "number") {
      amounts.push({ measure, amountCents: f.value, person: employeeName, payer, suggestedCategory, fieldKey: k(field), confidence: f.confidence });
    }
  };
  push("box_1_cents", "w2_box1_wages", "wages_salary");
  push("box_3_cents", "w2_box3_social_security_wages", null);
  push("box_5_cents", "w2_box5_medicare_wages", null);
  return { amounts, person, employer: payer, taxYear };
}

export function extractW2(ctx: ExtractContext, subtype: "irs_w2" | "irs_w2c"): Extraction {
  const b = new ExtractionBuilder(subtype, ctx.policy);
  if (subtype === "irs_w2c") b.review("corrected_form", "This is a corrected W-2 (W-2c); a person must compare it with the original.");
  const statementPages = ctx.doc.pages.filter((p) => /Wage and Tax Statement/i.test(p.text));
  for (const p of statementPages) {
    if ((p.text.match(/Wage and Tax Statement/gi) ?? []).length > 1) {
      b.review("review_required_by_policy", "A page holds more than one W-2 panel; a person must check which copies they are.");
    }
  }
  if (statementPages.length === 0) b.review("field_missing", "No W-2 statement panel could be found.");
  const all = statementPages.map((p, i) => readStatement(b, pageDoc(p, ctx.doc.source), i + 1));
  b.set("statement_count", all.length, CONF_VERIFIED, null);
  b.signal(`${all.length} W-2 statement(s) found`);

  const years = [...new Set(all.map((s) => s.taxYear).filter((y): y is number => y !== null))];
  if (years.length > 1) b.review("multiple_outcomes", "The W-2 statements in this file are for different tax years.");
  const amounts = all.flatMap((s) => s.amounts);
  const people = all.map((s) => s.person).filter((p): p is IncomePerson => p !== null);
  const uniquePeople = people.filter((p, i) => people.findIndex((q) => q.name === p.name) === i);
  const keys = Object.keys(b.fields).filter((key) => /\.(tax_year|employee_name|employer_name|box_1_cents)$/.test(key));
  b.warn("Box 13 check boxes and box 14 are not read.");

  const income: IncomeDocumentSummary = {
    taxYear: years.length === 1 ? years[0] : null,
    people: uniquePeople,
    amounts,
    selfEmploymentIndicated: false,
    payPeriod: null,
    payDate: null,
    likelyFinalStubOfYear: null,
    extractionConfidence: keys.length > 0 ? b.minConfidence(keys) : 0,
    extractedBy: "parser",
  };
  return b.build(null, income);
}
