import { EVIDENCE_POLICY } from "./policy";

/**
 * Text hygiene for everything that enters an evidence record. Pure string functions.
 *
 * Character classes are written as code-point ranges and compiled once, so this file contains no invisible
 * characters of its own.
 */

type CodePointRange = readonly [from: number, to: number];

function charClass(ranges: readonly CodePointRange[]): string {
  return ranges.map(([from, to]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`).join("");
}

/* C0 and C1 controls (tab, line feed and carriage return are treated as white space instead), DEL, the soft
   hyphen, zero-width and bidirectional formatting characters, and the byte-order mark. The bidirectional
   controls can make a line read differently from its bytes, which has no place in a record a person signs
   off on. */
const INVISIBLE_RANGES: readonly CodePointRange[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];
/* Line separator and paragraph separator: white space that `\s` already covers, listed so the intent is explicit. */
const SEPARATOR_RANGES: readonly CodePointRange[] = [[0x2028, 0x2029]];
/* Hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar. */
const DASH_RANGES: readonly CodePointRange[] = [[0x2010, 0x2015]];

const INVISIBLE = new RegExp(`[${charClass(INVISIBLE_RANGES)}]`, "gu");
const WHITESPACE_RUN = new RegExp(`[\\s${charClass(SEPARATOR_RANGES)}]+`, "gu");
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/**
 * One canonical spelling for a piece of text: NFC, no control or invisible formatting characters, single
 * spaces, trimmed. NFC matters twice: the same name always signs to the same bytes, and "n" + combining
 * tilde becomes the single letter the PDF fonts can print.
 */
export function normalizeText(input: string): string {
  return input.replace(LONE_SURROGATE, REPLACEMENT_CHARACTER).normalize("NFC").replace(INVISIBLE, "").replace(WHITESPACE_RUN, " ").trim();
}

/* 3-2-4 digits with a separator, or exactly nine digits in a row. Digits on either side disqualify a match,
   so longer numbers (phone numbers, cents, byte counts written as text) are left alone. */
const SSN_SEPARATOR = `[-. ${charClass(DASH_RANGES)}]`;
const SSN_SEPARATED = new RegExp(`(?<!\\d)\\d{3}${SSN_SEPARATOR}\\d{2}${SSN_SEPARATOR}\\d{4}(?!\\d)`, "gu");
const SSN_BARE = /(?<!\d)\d{9}(?!\d)/g;

/** Removes anything shaped like a Social Security number from free text. Returns the text and how many tokens went. */
export function removeSsnPatterns(text: string): { text: string; removed: number } {
  let removed = 0;
  const replace = () => {
    removed += 1;
    return EVIDENCE_POLICY.ssnReplacement;
  };
  const cleaned = text.replace(SSN_SEPARATED, replace).replace(SSN_BARE, replace);
  return { text: cleaned, removed };
}

/** True when text contains something shaped like a Social Security number. */
export function containsSsnPattern(text: string): boolean {
  return removeSsnPatterns(text).removed > 0;
}

/* Field names that identify a birth date, a government identity number or a financial account. Matched on
   lower-case words so "Social Security benefits" (an income line) passes and "social security number" does not. */
const SENSITIVE_FIELD =
  /\b(dob|birth\w*|born|ssn|ssns|itin|tin|social security (number|no|num|nbr)\w*|taxpayer id\w*|(account|acct|card|routing) ?(number|no|num|nbr)\w*|routing|passport\w*|driver\w* licen[cs]e\w*)\b/;

/* Straight and typographic apostrophes, so that "driver's" reads as one word. */
const APOSTROPHE = new RegExp(`['${charClass([[0x2019, 0x2019]])}]`, "gu");

function words(name: string): string {
  return name
    .replace(APOSTROPHE, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when an extracted field's key or label names something the pack never carries. */
export function isSensitiveFieldName(key: string, label: string): boolean {
  return SENSITIVE_FIELD.test(words(key)) || SENSITIVE_FIELD.test(words(label));
}

/**
 * A file name safe to print: the last path segment, no characters that are reserved in file systems, at most
 * `EVIDENCE_POLICY.limits.filename` characters with the extension kept. The name is a convenience for the
 * reader; the SHA-256 identifies the file.
 */
export function sanitizeFilename(name: string): string {
  const normalized = normalizeText(name);
  const lastSegment = normalized.split(/[\\/]/).pop() ?? "";
  const cleaned = lastSegment
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const safe = cleaned === "" ? "unnamed" : cleaned;
  const max = EVIDENCE_POLICY.limits.filename;
  const chars = Array.from(safe);
  if (chars.length <= max) return safe;
  const dot = safe.lastIndexOf(".");
  const extension = dot > 0 && safe.length - dot <= 10 ? Array.from(safe.slice(dot)) : [];
  return [...chars.slice(0, max - extension.length - 1), "~", ...extension].join("");
}

function initial(part: string): string {
  const first = Array.from(part.trim())[0];
  return first ? `${first.toUpperCase()}.` : "";
}

/** First letters of the two names, each with a period. Works on code points, so a name that starts outside the BMP keeps a whole character. */
export function initialsOf(firstName: string, lastName: string): string {
  return `${initial(firstName)}${initial(lastName)}`;
}

/** "ver_abc" stays; anything with spaces, control characters or path punctuation is not an identifier. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
