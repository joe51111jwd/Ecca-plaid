/**
 * Pay stubs (reference I1-I4, P10 with the [FC] correction).
 *
 * There is no standard pay stub (I1) and no label here is sourced (I3): every label is a heuristic synonym.
 * A pay stub is never accepted on its own in v1 (item 33): the extractor pre-fills a reviewer's screen and
 * runs the pattern checks (dates in order, YTD ≥ current, net ≤ gross) as tamper and misread signals.
 */
import { addDays, daysBetween, parseDocumentDate } from "../dates";
import { findMoneyTokens } from "../money";
import { valueAfterLabel, type LineRef } from "../text";
import type { Extraction, IncomeAmount, IncomeDocumentSummary, IncomePerson, IsoDate } from "../types";
import { allRefs, CONF_HEURISTIC, ExtractionBuilder, isPlausibleName, readLabeledDate, type ExtractContext } from "./common";

/** How far after the period end a pay date may fall before it is a review signal (P10 `DATES_ORDERED`). */
export const PAY_DATE_AFTER_PERIOD_END_MAX_DAYS = 7;

/**
 * Heuristic, not a rule from the sources (P10 [FC]: a pay schedule is not printed on the stub): a December
 * stub is "likely final" when one more pay period after its pay date would fall in the next year.
 */
export function isLikelyFinalStubOfYear(payDate: IsoDate | null, period: { start: IsoDate | null; end: IsoDate | null } | null): boolean | null {
  if (!payDate) return null;
  if (payDate.slice(5, 7) !== "12") return false;
  if (!period?.start || !period.end) return null;
  const length = daysBetween(period.start, period.end) + 1;
  if (length < 1 || length > 31) return null;
  return addDays(payDate, length).slice(0, 4) !== payDate.slice(0, 4);
}

function rowAmounts(refs: LineRef[], label: RegExp): { current: number | null; ytd: number | null; ref: LineRef } | null {
  const header = refs.find((r) => /\bCurrent\b/i.test(r.line.text) && /\bYTD\b|Year[- ]to[- ]Date/i.test(r.line.text));
  const ytdFirst = header ? header.line.text.search(/\bYTD\b|Year[- ]to[- ]Date/i) < header.line.text.search(/\bCurrent\b/i) : false;
  for (const ref of refs) {
    const m = label.exec(ref.line.text);
    if (!m) continue;
    const tokens = findMoneyTokens(ref.line.text.slice((m.index ?? 0) + m[0].length));
    if (tokens.length === 0) continue;
    if (tokens.length === 1) return { current: header ? null : tokens[0].cents, ytd: null, ref };
    const [a, c] = [tokens[0].cents, tokens[1].cents];
    return ytdFirst ? { current: c, ytd: a, ref } : { current: a, ytd: c, ref };
  }
  return null;
}

export function extractPayStub(ctx: ExtractContext): Extraction {
  const b = new ExtractionBuilder("pay_stub", ctx.policy);
  const refs = allRefs(ctx.doc);

  const employer = valueAfterLabel(ctx.doc, /^(?:Employer|Company)(?: Name)?:/i, /^[A-Za-z0-9&'.,\- ]{2,80}$/, { below: false });
  if (employer) b.set("employer_name", employer.value, CONF_HEURISTIC, employer.ref);
  else {
    const top = refs.slice(0, 6).find((r) => /\b(LLC|Inc\.?|Corp\.?|Corporation|Company|Co\.)$/i.test(r.line.items[0]?.text ?? ""));
    if (top) b.set("employer_name", top.line.items[0].text, 0.6, top);
  }
  const employee = valueAfterLabel(ctx.doc, /Employee(?: Name)?:/i, /^[A-Za-zÀ-ÿ' .,-]+$/, { below: false });
  if (employee && isPlausibleName(employee.value)) b.set("employee_name", employee.value, CONF_HEURISTIC, employee.ref);
  b.require("employer_name", "employee_name");

  let period: { start: IsoDate | null; end: IsoDate | null } | null = null;
  const range = refs.find((r) => /Pay Period:/i.test(r.line.text));
  if (range) {
    const m = /Pay Period:\s*(\S+)\s*(?:-|to|through)\s*(\S+)/i.exec(range.line.text);
    const s = m ? parseDocumentDate(m[1]) : null;
    const e = m ? parseDocumentDate(m[2]) : null;
    if (s?.ok && e?.ok) {
      period = { start: s.date, end: e.date };
      b.set("period_start", s.date, CONF_HEURISTIC, range);
      b.set("period_end", e.date, CONF_HEURISTIC, range);
    } else if ((s && !s.ok && s.reason === "ambiguous") || (e && !e.ok && e.reason === "ambiguous")) {
      b.review("date_ambiguous", "The pay period dates can be read more than one way.");
    }
  } else {
    const s = readLabeledDate(ctx.doc, /Period (?:Beginning|Start)(?: Date)?:|Pay Begin Date:/i);
    const e = readLabeledDate(ctx.doc, /Period (?:Ending|End)(?: Date)?:|Pay End Date:/i);
    if (s?.date) b.set("period_start", s.date, CONF_HEURISTIC, s.ref);
    if (e?.date) b.set("period_end", e.date, CONF_HEURISTIC, e.ref);
    if (s?.date || e?.date) period = { start: s?.date ?? null, end: e?.date ?? null };
    if (s?.ambiguous || e?.ambiguous) b.review("date_ambiguous", "The pay period dates can be read more than one way.");
  }
  const pay = readLabeledDate(ctx.doc, /Pay Date:|Check Date:|Advice Date:|Payment Date:/i);
  const payDate = pay?.date ?? null;
  if (pay?.ambiguous) b.review("date_ambiguous", "The pay date can be read more than one way.");
  if (pay && payDate) b.set("pay_date", payDate, CONF_HEURISTIC, pay.ref);
  b.require("pay_date");

  const gross = rowAmounts(refs, /\b(?:Gross Pay|Gross Earnings|Total Gross|Total Earnings)\b/i);
  if (gross?.current != null) b.set("gross_current_cents", gross.current, CONF_HEURISTIC, gross.ref);
  if (gross?.ytd != null) b.set("gross_ytd_cents", gross.ytd, CONF_HEURISTIC, gross.ref);
  const net = rowAmounts(refs, /\b(?:Net Pay|Net Check|Take Home)\b/i);
  if (net?.current != null) b.set("net_current_cents", net.current, CONF_HEURISTIC, net.ref);
  b.require("gross_current_cents");

  // Pattern checks: signals of a misread or an edited stub, never proof (P10 [FC]).
  if (period?.start && period.end && period.start > period.end) b.review("arithmetic_mismatch", "The pay period starts after it ends.");
  if (period?.end && payDate && daysBetween(period.end, payDate) > PAY_DATE_AFTER_PERIOD_END_MAX_DAYS) {
    b.warn("The pay date is more than a week after the period end.");
  }
  if (period?.end && payDate && payDate < (period.start ?? period.end)) b.warn("The pay date is before the pay period; some employers pay in advance.");
  if (gross?.current != null && gross.ytd != null && gross.ytd < gross.current) {
    b.review("arithmetic_mismatch", "Year-to-date gross is smaller than this period's gross.");
  }
  if (gross?.current != null && net?.current != null && net.current > gross.current) b.review("arithmetic_mismatch", "Net pay is larger than gross pay.");

  const likelyFinal = isLikelyFinalStubOfYear(payDate, period);
  if (likelyFinal !== null) b.set("likely_final_stub_of_year", likelyFinal, 0.6, pay?.ref ?? null);
  if (payDate?.slice(5, 7) === "12" && gross?.ytd != null) b.warn("December stub, year-to-date gross shown.");
  b.review("pay_stub_review", "A pay stub is never accepted on its own in v1; a person decides how its figures are used (P10 [FC]).");

  const employeeName = b.value<string>("employee_name");
  const employerName = b.value<string>("employer_name");
  const amounts: IncomeAmount[] = [];
  for (const [key, measure] of [
    ["gross_current_cents", "paystub_gross_current"],
    ["gross_ytd_cents", "paystub_gross_ytd"],
    ["net_current_cents", "paystub_net_current"],
  ] as const) {
    const f = b.fields[key];
    if (f && typeof f.value === "number") {
      amounts.push({ measure, amountCents: f.value, person: employeeName, payer: employerName, suggestedCategory: null, fieldKey: key, confidence: f.confidence });
    }
  }
  const ppl: IncomePerson[] = employeeName ? [{ name: employeeName, role: "employee", masked: false, ssnLast4: null }] : [];
  const income: IncomeDocumentSummary = {
    taxYear: payDate ? Number(payDate.slice(0, 4)) : null,
    people: ppl,
    amounts,
    selfEmploymentIndicated: false,
    payPeriod: period,
    payDate,
    likelyFinalStubOfYear: likelyFinal,
    extractionConfidence: b.minConfidence(["employer_name", "employee_name", "pay_date", "gross_current_cents"]),
    extractedBy: "parser",
  };
  return b.build(null, income);
}
