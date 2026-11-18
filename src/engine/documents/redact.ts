/**
 * Redaction of identifiers before anything leaves the document reader.
 *
 * Rule (architecture "Never stored"; reference items 23-25): Social Security numbers and ITINs are reduced to
 * their last four digits at extraction time, and never appear in a snippet, a field, a warning or a log line.
 * Case, claim, EDG and voucher numbers are stored as the last four characters only.
 */

/**
 * Nine digits in the SSN/ITIN shape: `123-45-6789`, `123 45 6789` or `123456789`, not inside a longer run of
 * digits. Deliberately broad: a nine-digit EDG number is masked too, which costs nothing. Letters next to
 * the number do not protect it: SSA prints claim numbers as the SSN plus a beneficiary code
 * (`123-45-6789A`), and text layers often lose the space after a label (`SSN123-45-6789`).
 */
const SSN_PATTERN = /(?<!\d)(\d{3})[-‐-― ]?(\d{2})[-‐-― ]?(\d{4})(?!\d)/g;

/** Any run of seven or more digits (case numbers, account numbers, unhyphenated identifiers). */
const LONG_DIGIT_RUN = /(?<![\d.,])\d{7,}(?![\d.,])/g;

/** Employer identification number `12-3456789`. */
const EIN_PATTERN = /(?<![\dA-Za-z])\d{2}-\d{7}(?![\dA-Za-z])/g;

/** Replaces every SSN/ITIN-shaped number with `XXX-XX-` plus its last four digits. */
export function redactSsns(text: string): string {
  return text.replace(SSN_PATTERN, (_m, _a: string, _b: string, last4: string) => `XXX-XX-${last4}`);
}

/** Masks EINs to `XX-XXX` plus the last four digits (the IRS's own masked form, H2). */
export function redactEins(text: string): string {
  return text.replace(EIN_PATTERN, (m) => `XX-XXX${m.slice(-4)}`);
}

/** Masks runs of seven or more digits to their last four. */
export function maskLongNumbers(text: string): string {
  return text.replace(LONG_DIGIT_RUN, (m) => `${"*".repeat(m.length - 4)}${m.slice(-4)}`);
}

/** Every redaction applied to text that is returned or logged. */
export function redactText(text: string): string {
  return maskLongNumbers(redactEins(redactSsns(text)));
}

/** True when the text still contains something shaped like a full SSN/ITIN. Used by tests and assertions. */
export function containsFullSsn(text: string): boolean {
  SSN_PATTERN.lastIndex = 0;
  const found = SSN_PATTERN.test(text);
  SSN_PATTERN.lastIndex = 0;
  return found;
}

/** `9990000001` → `******0001`. Keeps only the last four letters or digits; returns null for an empty id. */
export function maskIdentifier(id: string, keep = 4): string | null {
  const compact = id.replace(/[^0-9A-Za-z]/g, "");
  if (compact.length === 0) return null;
  if (compact.length <= keep) return "*".repeat(compact.length);
  return `${"*".repeat(compact.length - keep)}${compact.slice(-keep)}`;
}

/** Last four digits of an SSN-like value (masked or not), or null when four digits are not present. */
export function ssnLast4(value: string): string | null {
  const m = /(\d{4})\s*$/.exec(value.trim());
  return m ? m[1] : null;
}

/** Deep-scans a JSON-like value and returns the paths of strings that contain a full SSN. */
export function findFullSsns(value: unknown, path = "$"): string[] {
  if (typeof value === "string") return containsFullSsn(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findFullSsns(v, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(containsFullSsn(k) ? [`${path}.<key>`] : []),
      ...findFullSsns(v, `${path}.${k}`),
    ]);
  }
  return [];
}
