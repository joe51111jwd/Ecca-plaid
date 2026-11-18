import { EVIDENCE_POLICY } from "./policy";

/**
 * Text hygiene for everything that enters an evidence record. Pure string functions.
 */

/* C0 and C1 controls, DEL, zero-width and bidirectional formatting characters, BOM. The bidi controls can make
   a line read differently from its bytes, which has no place in a record a person signs off on. */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁩﻿]/g;
const WHITESPACE_RUN = /[\s  ]+/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * One canonical spelling for a piece of text: NFC, no control or invisible formatting characters, single
 * spaces, trimmed. NFC matters twice: the same name always signs to the same bytes, and "n" + combining
 * tilde becomes the single letter the PDF fonts can print.
 */
export function normalizeText(input: string): string {
  return input.replace(LONE_SURROGATE, "�").normalize("NFC").replace(INVISIBLE, "").replace(WHITESPACE_RUN, " ").trim();
}

/* 3-2-4 digits with a separator, or exactly nine digits in a row. Digits on either side disqualify a match,
   so longer numbers (phone numbers, cents, byte counts written as text) are left alone. */
const SSN_SEPARATED = /(?<!\d)\d{3}[-‐-― .]\d{2}[-‐-― .]\d{4}(?!\d)/g;
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

/** True when text still contains something shaped like a Social Security number. */
export function containsSsnPattern(text: string): boolean {
  SSN_SEPARATED.lastIndex = 0;
  SSN_BARE.lastIndex = 0;
  return SSN_SEPARATED.test(text) || SSN_BARE.test(text);
}

/* Field names that identify a birth date, a government identity number or a financial account. Matched on
   lower-case words so "Social Security benefits" (an income line) passes and "social security number" does not. */
const SENSITIVE_FIELD =
  /\b(dob|birth\w*|born|ssn|ssns|itin|tin|social security (number|no|num|nbr)\w*|taxpayer id\w*|(account|acct|card|routing) ?(number|no|num|nbr)\w*|routing|passport\w*|driver\w* licen[cs]e\w*)\b/;

function words(name: string): string {
  return name
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

/** "María", "Peña" -> "M.P.". Works on code points, so a name that starts outside the BMP keeps a whole character. */
export function initialsOf(firstName: string, lastName: string): string {
  return `${initial(firstName)}${initial(lastName)}`;
}

/** "ver_abc" stays; anything with spaces, control characters or path punctuation is not an identifier. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
