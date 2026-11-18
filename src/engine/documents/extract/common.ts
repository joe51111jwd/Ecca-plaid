/**
 * Shared building blocks for extractors: a result builder that records fields with provenance and turns
 * low confidence into review reasons, plus label/amount/date readers on the line model.
 */
import { findDates, parseDocumentDate, type DateParseResult } from "../dates";
import { findMoneyTokens, parseMoneyCents } from "../money";
import { redactText } from "../redact";
import { nearestItem, nextLine, snippetOf, type DocumentText, type LineRef } from "../text";
import {
  DEFAULT_DOCUMENT_POLICY,
  PARSER_VERSION,
  type AwardLetterSummary,
  type DocumentReaderPolicy,
  type DocumentSubtype,
  type Extraction,
  type ExtractedField,
  type FieldValue,
  type IncomeDocumentSummary,
  type IsoDate,
  type NotAcceptableCode,
  type ReviewReasonCode,
} from "../types";

/** Confidence for a value read at a verified label on a verified layout (official form, B4/F1/G1). */
export const CONF_VERIFIED = 0.95;
/** A verified label on a layout whose details are from a secondary or old sample (E6, H4). */
export const CONF_SECONDARY = 0.9;
/** A label the reference marks as invented or heuristic (WIC, PHA, pay stubs, WAI). */
export const CONF_HEURISTIC = 0.75;
/** Position-based guesses (an addressee block found by its address lines). */
export const CONF_POSITIONAL = 0.85;

export interface ExtractContext {
  doc: DocumentText;
  policy: DocumentReaderPolicy;
}

export function defaultContext(doc: DocumentText, policy?: Partial<DocumentReaderPolicy>): ExtractContext {
  return { doc, policy: { ...DEFAULT_DOCUMENT_POLICY, ...policy } };
}

export class ExtractionBuilder {
  readonly fields: Record<string, ExtractedField> = {};
  readonly warnings: string[] = [];
  readonly signals: string[] = [];
  private readonly reviews = new Map<ReviewReasonCode, string>();
  private readonly rejections = new Map<NotAcceptableCode, string>();
  /** Field keys that must be present and confident for the document to be usable. */
  private readonly required = new Set<string>();

  constructor(
    readonly subtype: DocumentSubtype,
    private readonly policy: DocumentReaderPolicy,
  ) {}

  set(key: string, value: FieldValue, confidence: number, ref: LineRef | null, snippetText?: string): void {
    this.fields[key] = {
      value: typeof value === "string" ? redactText(value) : value,
      confidence: round(confidence),
      page: ref?.page.number ?? null,
      snippet: ref ? snippetOf(snippetText ?? ref.line.text) : null,
    };
  }

  /** Records `toKey` as the same value and provenance as `fromKey` (e.g. letter_date = certification date). */
  alias(toKey: string, fromKey: string): void {
    const f = this.fields[fromKey];
    if (f) this.fields[toKey] = { ...f };
  }

  /** Marks a field as required: missing → `field_missing`; low confidence → `low_confidence`. */
  require(...keys: string[]): void {
    for (const k of keys) this.required.add(k);
  }

  value<T extends FieldValue>(key: string): T | null {
    const f = this.fields[key];
    return f ? (f.value as T) : null;
  }

  /** Messages can quote document text (a heading, a raw date), so they are redacted like every other output. */
  review(code: ReviewReasonCode, message: string): void {
    if (!this.reviews.has(code)) this.reviews.set(code, safeMessage(message));
  }

  reject(code: NotAcceptableCode, message: string): void {
    if (!this.rejections.has(code)) this.rejections.set(code, safeMessage(message));
  }

  hasReview(code: ReviewReasonCode): boolean {
    return this.reviews.has(code);
  }

  signal(s: string): void {
    this.signals.push(redactText(s));
  }

  warn(s: string): void {
    const safe = safeMessage(s);
    if (!this.warnings.includes(safe)) this.warnings.push(safe);
  }

  /** Lowest confidence among the given keys that are present (1 when none is). */
  minConfidence(keys: readonly string[]): number {
    const present = keys.map((k) => this.fields[k]).filter((f): f is ExtractedField => f !== undefined && f.value !== null);
    return present.length === 0 ? 0 : round(Math.min(...present.map((f) => f.confidence)));
  }

  build(award: AwardLetterSummary | null, income: IncomeDocumentSummary | null): Extraction {
    for (const key of this.required) {
      const f = this.fields[key];
      if (!f || f.value === null) this.review("field_missing", `A required field could not be read: ${key}.`);
      else if (f.confidence < this.policy.minFieldConfidence) this.review("low_confidence", `A required field was read with low confidence: ${key}.`);
    }
    return {
      parserVersion: PARSER_VERSION,
      subtype: this.subtype,
      fields: this.fields,
      warnings: this.warnings,
      reviewReasons: [...this.reviews].map(([code, message]) => ({ code, message })),
      notAcceptable: [...this.rejections].map(([code, message]) => ({ code, message })),
      signals: this.signals,
      award,
      income,
    };
  }
}

/** Longest message kept; document text quoted in a message is cut, never the reader's own wording. */
const MAX_MESSAGE_LENGTH = 300;

function safeMessage(message: string): string {
  const clean = redactText(message);
  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : clean;
}

export function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/* --------------------------------------------------------------------------------- readers */

export interface DateRead {
  date: IsoDate | null;
  ambiguous: boolean;
  raw: string;
  ref: LineRef;
}

/**
 * Reads the date after a label (`Date: 09/15/2026`). Reports an ambiguous date instead of guessing.
 * The label must be followed by the date on the same line or as the item directly below.
 */
export function readLabeledDate(doc: DocumentText, label: RegExp, refs?: readonly LineRef[]): DateRead | null {
  const candidates = refs ?? allRefs(doc);
  for (const ref of candidates) {
    const m = label.exec(ref.line.text);
    if (!m) continue;
    const rest = ref.line.text.slice((m.index ?? 0) + m[0].length);
    const found = findDates(rest)[0];
    if (found) return toDateRead(found.raw, found.result, ref);
    const loose = /^[\s:]*(\S+(?: \S+)?)/.exec(rest);
    if (loose && /\d/.test(loose[1])) {
      const r = parseDocumentDate(loose[1].replace(/[,;]$/, ""));
      if (!r.ok && r.reason === "ambiguous") return toDateRead(loose[1], r, ref);
    }
    // Boxed forms print the date in the box below its label.
    if (/^[\s:.]*$/.test(rest) || !/\d/.test(rest)) {
      const labelItem = ref.line.items.find((it) => label.test(it.text)) ?? ref.line.items[0];
      const below = nextLine(ref);
      const item = below ? nearestItem(below.line, labelItem.x, 12) : null;
      const found = item ? findDates(item.text)[0] : undefined;
      if (below && found && found.raw.length >= item!.text.trim().length - 2) return toDateRead(found.raw, found.result, below);
    }
  }
  return null;
}

function toDateRead(raw: string, r: DateParseResult, ref: LineRef): DateRead {
  return { date: r.ok ? r.date : null, ambiguous: !r.ok && r.reason === "ambiguous", raw, ref };
}

export function allRefs(doc: DocumentText): LineRef[] {
  const out: LineRef[] = [];
  for (const page of doc.pages) page.lines.forEach((line, index) => out.push({ page, line, index }));
  return out;
}

/**
 * The first amount printed after a label on the same line, skipping a repeated line number (forms print
 * the line number again beside the entry box) and dot leaders. Returns null when no amount follows.
 */
export function amountAfterLabel(
  ref: LineRef,
  label: RegExp,
  opts: { skipTokens?: readonly string[]; allowNegative?: boolean } = {},
): number | null {
  const m = label.exec(ref.line.text);
  if (!m) return null;
  let rest = ref.line.text.slice((m.index ?? 0) + m[0].length).replace(/(\s*\.)+\s/g, " ");
  for (const skip of opts.skipTokens ?? []) {
    rest = rest.replace(new RegExp(`^[\\s.:]*${skip}(?=\\s|$)`, "i"), "");
  }
  const token = findMoneyTokens(rest, { allowNegative: opts.allowNegative })[0];
  if (!token) return null;
  // The amount must be the next thing on the line (leaders and punctuation aside), not a number in later text.
  const before = rest.slice(0, token.index);
  if (/[A-Za-z]{2,}/.test(before)) return null;
  return token.cents;
}

/** Strictly parses the whole of `raw` as money. */
export function money(raw: string, allowNegative = false): number | null {
  return parseMoneyCents(raw.trim(), { allowNegative });
}

/** Line refs whose text matches. */
export function refsMatching(doc: DocumentText, re: RegExp): LineRef[] {
  return allRefs(doc).filter((r) => re.test(r.line.text));
}

/**
 * Addressee of a mailed letter: the name printed directly above a street line and a "CITY ST 12345" line,
 * in the same column. Window-envelope letters (HHSC, SSA) put it there. Returns null when not found.
 */
export function findAddressee(doc: DocumentText, beforeLine?: RegExp): { name: string; ref: LineRef } | null {
  for (const page of doc.pages.slice(0, 2)) {
    const lines = page.lines;
    const stop = beforeLine ? lines.findIndex((l) => beforeLine.test(l.text)) : -1;
    const end = stop >= 0 ? stop : lines.length;
    for (let i = 1; i < end - 1; i++) {
      for (const street of lines[i].items) {
        if (!/^\d{1,6} [A-Z0-9][A-Za-z0-9 .'#-]+$/.test(street.text)) continue;
        const city = lines[i + 1].items.find((it) => Math.abs(it.x - street.x) < 12 && /\b[A-Z]{2},? \d{5}(-\d{4})?$/.test(it.text));
        if (!city) continue;
        const above = lines[i - 1].items.find((it) => Math.abs(it.x - street.x) < 12);
        if (above && isPlausibleName(above.text)) {
          return { name: above.text.trim(), ref: { page, line: lines[i - 1], index: i - 1 } };
        }
      }
    }
  }
  return null;
}

/** Two to five alphabetic words, no digits, no colon, not a known label. */
export function isPlausibleName(s: string): boolean {
  const t = s.trim();
  if (t.length < 3 || t.length > 80 || /[\d:@/$]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  if (/\b(Administration|Commission|Department|Authority|Service|Clinic|Program|Notice|Letter|Benefits?|Box|Street|Lane|Texas|LLC|Inc)\b/i.test(t)) return false;
  return words.every((w) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.,-]*$/.test(w));
}
