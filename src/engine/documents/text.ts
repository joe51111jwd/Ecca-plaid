/**
 * The text model every classifier and extractor works on, and the helpers to search it.
 *
 * A document is pages of lines; a line keeps its items with horizontal positions so table columns can be
 * rebuilt from coordinates (P2 "Table reconstruction"). Plain text (tests, model output) is turned into the
 * same shape: items are runs separated by two or more spaces, positioned by character column.
 */
import { redactText } from "./redact";

export interface TextItem {
  /** Left edge in points (PDF) or character column × `PLAIN_CHAR_WIDTH` (plain text). */
  x: number;
  width: number;
  text: string;
}

export interface TextLine {
  /** Normalised text of the whole line; items are joined with one space, or two across a wide gap. */
  text: string;
  /** Baseline, top of page = largest (PDF convention). Plain text counts down from 0. */
  y: number;
  items: TextItem[];
}

export interface TextPage {
  number: number;
  text: string;
  lines: TextLine[];
}

export interface DocumentText {
  pages: TextPage[];
  source: "pdf_text" | "plain";
}

/** Width given to one character of plain text, so plain columns and PDF columns use similar scales. */
export const PLAIN_CHAR_WIDTH = 6;

/** The banner every synthetic fixture carries (reference "Rules for every fixture"), after normalisation. */
export const SYNTHETIC_BANNER = "SYNTHETIC SAMPLE - NOT A REAL DOCUMENT";
export const SYNTHETIC_BANNER_PATTERN = /SYNTHETIC\s+SAMPLE\s*-\s*NOT\s+A\s+REAL\s+DOCUMENT/i;
export const SYNTHETIC_LAYOUT_LINE = "Layout is a test invention, not a copy of an agency form";

/**
 * Normalises curly quotes to straight ones, every dash to `-`, non-breaking and other odd spaces to a space,
 * and compatibility characters (ligatures) to their plain form. Matching is then done on this text.
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[  -   　\t]/g, " ")
    .replace(/[​-‍﻿]/g, "");
}

/** Builds the line model from plain text. Pages are separated by form feeds (`\f`). */
export function documentTextFromString(input: string): DocumentText {
  const pages = normalizeText(input)
    .replace(/\r\n?/g, "\n")
    .split("\f")
    .map((pageText, i): TextPage => {
      const lines: TextLine[] = [];
      pageText.split("\n").forEach((raw, row) => {
        const items: TextItem[] = [];
        for (const m of raw.matchAll(/\S+(?: \S+)*/g)) {
          items.push({ x: (m.index ?? 0) * PLAIN_CHAR_WIDTH, width: m[0].length * PLAIN_CHAR_WIDTH, text: m[0] });
        }
        if (items.length === 0) return;
        lines.push({ text: joinItems(items), y: -row, items });
      });
      return { number: i + 1, text: lines.map((l) => l.text).join("\n"), lines };
    });
  return { pages, source: "plain" };
}

/** Joins a line's items: two spaces across a gap wider than ~3 characters (a column break), else one. */
export function joinItems(items: TextItem[]): string {
  let out = "";
  let prevEnd: number | null = null;
  let charWidth = PLAIN_CHAR_WIDTH;
  for (const item of items) {
    if (prevEnd !== null) {
      const gap = item.x - prevEnd;
      out += gap > charWidth * 2.5 ? "  " : gap > charWidth * 0.15 ? " " : "";
    }
    out += item.text;
    prevEnd = item.x + item.width;
    if (item.text.length > 0 && item.width > 0) charWidth = item.width / item.text.length;
  }
  return out;
}

export function fullText(doc: DocumentText): string {
  return doc.pages.map((p) => p.text).join("\n\f\n");
}

export function hasSyntheticBanner(doc: DocumentText): boolean {
  return SYNTHETIC_BANNER_PATTERN.test(fullText(doc));
}

/** Removes the fixture banner lines so they cannot be read as names or headings. */
export function stripSyntheticBanner(doc: DocumentText): DocumentText {
  const isBanner = (t: string) => SYNTHETIC_BANNER_PATTERN.test(t) || t.trim() === SYNTHETIC_LAYOUT_LINE;
  return {
    source: doc.source,
    pages: doc.pages.map((p) => {
      const lines = p.lines
        .map((l) => {
          if (!isBanner(l.text)) return l;
          const items = l.items.filter((it) => !isBanner(it.text));
          return items.length > 0 ? { ...l, items, text: joinItems(items) } : null;
        })
        .filter((l): l is TextLine => l !== null);
      return { number: p.number, lines, text: lines.map((l) => l.text).join("\n") };
    }),
  };
}

/* ------------------------------------------------------------------------------------ language */

const SPANISH_WORDS = new Set([
  "su", "sus", "usted", "caso", "beneficios", "fecha", "aviso", "para", "quien", "quién", "recibe", "reciben",
  "nombre", "número", "numero", "programa", "los", "las", "del", "por", "sobre", "puede", "tiene", "ayuda",
  "derecho", "razón", "razon", "notas", "comida", "alimentos", "pagina", "página", "de", "la", "el", "y", "que",
]);
const ENGLISH_WORDS = new Set([
  "the", "your", "you", "of", "and", "for", "who", "benefits", "date", "name", "this", "is", "are", "to", "will",
  "get", "can", "with", "from", "page", "number", "income", "notice", "have", "if",
]);

/** Spanish or English by function-word counts. `unknown` when there is too little prose to tell. */
export function detectLanguage(text: string): "en" | "es" | "unknown" {
  let es = 0;
  let en = 0;
  for (const w of text.toLowerCase().match(/[a-záéíóúñü]+/g) ?? []) {
    if (SPANISH_WORDS.has(w)) es++;
    if (ENGLISH_WORDS.has(w)) en++;
  }
  if (es + en < 8) return "unknown";
  return es > en * 1.2 ? "es" : "en";
}

/* --------------------------------------------------------------------------------------- search */

export interface LineRef {
  page: TextPage;
  line: TextLine;
  /** Index within `page.lines`. */
  index: number;
}

export function* iterLines(doc: DocumentText): Generator<LineRef> {
  for (const page of doc.pages) {
    for (let index = 0; index < page.lines.length; index++) yield { page, line: page.lines[index], index };
  }
}

/** First line whose text matches. */
export function findLine(doc: DocumentText, re: RegExp, from?: LineRef): LineRef | null {
  let started = !from;
  for (const ref of iterLines(doc)) {
    if (!started) {
      if (ref.page.number === from!.page.number && ref.index === from!.index) started = true;
      continue;
    }
    if (re.test(ref.line.text)) return ref;
  }
  return null;
}

export function findAllLines(doc: DocumentText, re: RegExp): LineRef[] {
  const out: LineRef[] = [];
  for (const ref of iterLines(doc)) if (re.test(ref.line.text)) out.push(ref);
  return out;
}

/** The line after `ref` on the same page, if any. */
export function nextLine(ref: LineRef, offset = 1): LineRef | null {
  const index = ref.index + offset;
  if (index < 0 || index >= ref.page.lines.length) return null;
  return { page: ref.page, line: ref.page.lines[index], index };
}

/**
 * Value printed after a label: on the same line (`Label: value`), else the item directly below the label.
 * `valuePattern` must match the whole value candidate.
 */
export function valueAfterLabel(
  doc: DocumentText,
  label: RegExp,
  valuePattern: RegExp,
  opts: { below?: boolean; maxBelow?: number } = {},
): { value: string; ref: LineRef } | null {
  for (const ref of findAllLines(doc, label)) {
    const m = label.exec(ref.line.text);
    if (!m) continue;
    const rest = ref.line.text.slice((m.index ?? 0) + m[0].length).replace(/^[\s:.]+/, "");
    // Same line: try the whole rest, then the first column-separated chunk.
    for (const candidate of [rest.trim(), rest.split(/\s{2,}/)[0]?.trim() ?? ""]) {
      if (candidate && valuePattern.test(candidate)) return { value: candidate, ref };
    }
    if (opts.below === false) continue;
    const labelItem = ref.line.items.find((it) => label.test(it.text)) ?? ref.line.items[0];
    for (let k = 1; k <= (opts.maxBelow ?? 2); k++) {
      const below = nextLine(ref, k);
      if (!below) break;
      const item = nearestItem(below.line, labelItem.x);
      if (item && valuePattern.test(item.text.trim())) return { value: item.text.trim(), ref: below };
    }
  }
  return null;
}

/** The item on `line` whose left edge is closest to `x`, within `tolerance` points. */
export function nearestItem(line: TextLine, x: number, tolerance = 40): TextItem | null {
  let best: TextItem | null = null;
  let bestDist = Infinity;
  for (const it of line.items) {
    const d = Math.abs(it.x - x);
    if (d < bestDist) {
      best = it;
      bestDist = d;
    }
  }
  return best && bestDist <= tolerance ? best : null;
}

/** Redacted, length-capped snippet of a line, for provenance. */
export function snippetOf(text: string, max = 160): string {
  const clean = redactText(text.replace(/\s+/g, " ").trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Text of the lines between two markers (exclusive), across pages. Returns refs for provenance. */
export function linesBetween(doc: DocumentText, start: RegExp, end: RegExp | null): LineRef[] {
  const out: LineRef[] = [];
  let inside = false;
  for (const ref of iterLines(doc)) {
    if (!inside) {
      if (start.test(ref.line.text)) inside = true;
      continue;
    }
    if (end && end.test(ref.line.text)) break;
    out.push(ref);
  }
  return out;
}

/** Collapses whitespace for whole-document phrase matching. */
export function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}
