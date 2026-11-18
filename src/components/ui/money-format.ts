import { parseUsdToCents, type Cents } from "@/lib/money";

/** Largest whole-dollar part MoneyInput accepts (9 digits). Keeps every value far inside the safe-integer range. */
export const MONEY_INPUT_MAX_WHOLE_DIGITS = 9;

/**
 * Cleans what a person typed or pasted into a dollar field while they are still typing:
 * keeps digits and at most one decimal point (two decimals), drops "$", commas, spaces and anything else.
 * "$1,700.505" → "1700.50", "abc" → "", "1.2.3" → "1.23", ".5" → ".5".
 */
export function sanitizeMoneyText(raw: string, opts: { allowCents?: boolean } = {}): string {
  const allowCents = opts.allowCents ?? true;
  let whole = "";
  let frac = "";
  let seenPoint = false;
  for (const ch of raw.normalize("NFKC")) {
    if (ch >= "0" && ch <= "9") {
      if (seenPoint) {
        if (frac.length < 2) frac += ch;
      } else if (whole.length < MONEY_INPUT_MAX_WHOLE_DIGITS) {
        whole += ch;
      }
    } else if (ch === "." && allowCents && !seenPoint) {
      seenPoint = true;
    } else if (ch === "." && !allowCents) {
      // Whole-dollar fields ignore everything after a decimal point instead of gluing the cents on ("12.50" must not become 1250).
      break;
    }
  }
  // Leading zeros carry no meaning ("007" → "7") but a lone zero does.
  whole = whole.replace(/^0+(?=\d)/, "");
  return seenPoint ? `${whole}.${frac}` : whole;
}

/**
 * Text of a dollar field → integer cents, or null when it is empty or not an amount.
 * Accepts what sanitizeMoneyText produces plus formatted text ("1,700.50", "$25").
 */
export function parseMoneyText(raw: string): Cents | null {
  const text = sanitizeMoneyText(raw);
  if (text === "" || text === ".") return null;
  const [whole = "", frac = ""] = text.split(".");
  return parseUsdToCents(`${whole === "" ? "0" : whole}${frac ? `.${frac}` : ""}`);
}

/**
 * Integer cents → the text shown in the field when it is not being edited: grouped thousands, no "$"
 * (the field shows the symbol itself), cents only when there are any. 170000 → "1,700", 170050 → "1,700.50".
 */
export function formatMoneyText(cents: Cents | null | undefined, opts: { allowCents?: boolean; grouping?: boolean } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents < 0) return "";
  const allowCents = opts.allowCents ?? true;
  const grouping = opts.grouping ?? true;
  const rounded = Math.round(cents);
  const whole = Math.floor(rounded / 100);
  const frac = rounded % 100;
  const wholeText = grouping ? whole.toLocaleString("en-US") : String(whole);
  return allowCents && frac !== 0 ? `${wholeText}.${String(frac).padStart(2, "0")}` : wholeText;
}
