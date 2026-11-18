/**
 * The sandbox processor's test numbers and card-field parsing. Pure: no database, no clock, no environment.
 *
 * The first three numbers are the ones Stripe documents for the same outcomes in its own test mode
 * (docs/reference/payments-and-rails.md, fact 48), so muscle memory carries over. The two "processing"
 * numbers are specific to this sandbox: they stand in for payment methods that settle later (ACH debit).
 * Only these numbers are accepted, so a real card number typed here by mistake is refused, not used.
 */

export type SandboxOutcome = "succeeded" | "declined" | "insufficient_funds" | "processing_then_succeeded" | "processing_then_failed";

export interface SandboxTestCard {
  /** Digits only. */
  number: string;
  /** Grouped for display. */
  display: string;
  outcome: SandboxOutcome;
  label: string;
  description: string;
}

function card(number: string, outcome: SandboxOutcome, label: string, description: string): SandboxTestCard {
  return { number, display: formatCardNumber(number), outcome, label, description };
}

export const SANDBOX_TEST_CARDS: readonly SandboxTestCard[] = [
  card("4242424242424242", "succeeded", "Payment succeeds", "The payment completes right away."),
  card("4000000000000002", "declined", "Card declined", "The payment is refused. You can try another number."),
  card("4000000000009995", "insufficient_funds", "Insufficient funds", "The payment is refused for insufficient funds."),
  card("4242424242420000", "processing_then_succeeded", "Processing, then succeeds", "The payment stays pending for a few seconds, like a bank debit, and then completes."),
  card("4242424242420018", "processing_then_failed", "Processing, then fails", "The payment stays pending for a few seconds, like a bank debit, and is then returned unpaid."),
];

/** What the payer is told when a sandbox payment is refused. */
export const SANDBOX_FAILURE_MESSAGES: Record<"declined" | "insufficient_funds" | "processing_then_failed", { code: string; message: string }> = {
  declined: { code: "card_declined", message: "The test card was declined." },
  insufficient_funds: { code: "insufficient_funds", message: "The test card has insufficient funds." },
  processing_then_failed: { code: "debit_returned", message: "The test payment was returned unpaid." },
};

/** Removes the spaces and dashes people type. Returns null unless 12 to 19 digits remain. */
export function normalizeCardNumber(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{12,19}$/.test(digits) ? digits : null;
}

export function formatCardNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The test card for a typed number, or null when the number is not one of the documented test numbers. */
export function resolveSandboxCard(input: string): SandboxTestCard | null {
  const digits = normalizeCardNumber(input);
  if (!digits) return null;
  return SANDBOX_TEST_CARDS.find((c) => c.number === digits) ?? null;
}

export interface CardExpiry {
  /** 1 to 12. */
  month: number;
  /** Four digits. */
  year: number;
}

/** Accepts "MM/YY", "MM / YY", "MMYY", "MM/YYYY" and "MM-YY". */
export function parseExpiry(input: string): CardExpiry | null {
  const m = /^\s*(\d{1,2})\s*[/-]?\s*(\d{2}|\d{4})\s*$/.exec(input);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return { month, year };
}

/** A card is good through the last day of its expiry month. `today` is passed in (this module has no clock). */
export function isExpired(expiry: CardExpiry, today: Date): boolean {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  return expiry.year < year || (expiry.year === year && expiry.month < month);
}

export function isValidSecurityCode(input: string): boolean {
  return /^\d{3,4}$/.test(input.trim());
}

/** An expiry date that is safely in the future for the given day, as MM/YY: what the "use this number" buttons fill in. */
export function sandboxTestExpiry(today: Date): string {
  return `12/${String((today.getUTCFullYear() + 4) % 100).padStart(2, "0")}`;
}
