/**
 * Strict money parsing for printed amounts → integer cents.
 *
 * Accepts `$41,250.00`, `41250.00`, `41,250`, `41250`, `$0.00`, and (with `allowNegative`) `-1,234.00`,
 * `-$1,234.00`, `$-1,234.00` and `(1,234.00)`. Rejects anything a reader could misread: misplaced thousands
 * separators (`1,23,456`), one decimal digit (`12.5`), three or more (`12.505`), letters (`1O0.00`, an OCR
 * O for a zero), embedded spaces, more than one sign, and values beyond `MAX_DOCUMENT_AMOUNT_CENTS`.
 */

/** $10 billion: above any household figure; larger values are misreads. Matches the income engine's cap. */
export const MAX_DOCUMENT_AMOUNT_CENTS = 1_000_000_000_000;

export interface ParseMoneyOptions {
  allowNegative?: boolean;
}

const BODY = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/;

export function parseMoneyCents(input: string, opts: ParseMoneyOptions = {}): number | null {
  let s = input.trim();
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith("$")) s = s.slice(1);
  if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1);
  }
  if (!BODY.test(s)) return null;
  if (negative && !opts.allowNegative) return null;
  const [whole, frac = "00"] = s.replace(/,/g, "").split(".");
  // Safe-integer guard before multiplying: whole dollars above the cap are rejected anyway.
  if (whole.length > 13) return null;
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents) || cents > MAX_DOCUMENT_AMOUNT_CENTS) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Matches a money-looking token inside a line (validated afterwards with `parseMoneyCents`). */
export const MONEY_TOKEN_SOURCE = String.raw`\(?-?\$?-?\d[\d,]*(?:\.\d+)?\)?`;

/** Every token in `text` that parses as money, in order. */
export function findMoneyTokens(text: string, opts: ParseMoneyOptions = {}): Array<{ raw: string; cents: number; index: number }> {
  const re = new RegExp(`(?<![\\w.,/-])${MONEY_TOKEN_SOURCE}(?![\\w/])`, "g");
  const out: Array<{ raw: string; cents: number; index: number }> = [];
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[.,]$/, "");
    const cents = parseMoneyCents(raw, opts);
    if (cents !== null) out.push({ raw, cents, index: m.index ?? 0 });
  }
  return out;
}

/** `4125000` → `41,250.00` (for messages; never used for parsing). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}
