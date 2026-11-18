/** Result of an edit to the one-time-code boxes: the new digits and which box should hold focus next. */
export interface OtpEdit {
  digits: string[];
  focusIndex: number;
}

/** Pulls the code out of pasted or autofilled text: "123 456", "123-456" and "Your code is 123456." all → "123456". */
export function extractOtpDigits(text: string, length: number): string {
  return text
    .normalize("NFKC")
    .replace(/[^0-9]/g, "")
    .slice(0, Math.max(0, length));
}

/** An all-empty row of boxes, or one pre-filled from a (possibly partial) code. */
export function otpDigitsFrom(value: string | null | undefined, length: number): string[] {
  const clean = extractOtpDigits(value ?? "", length);
  return Array.from({ length }, (_, i) => clean[i] ?? "");
}

export function otpValue(digits: readonly string[]): string {
  return digits.join("");
}

export function isOtpComplete(digits: readonly string[]): boolean {
  return digits.length > 0 && digits.every((d) => d.length === 1);
}

/**
 * Applies text entered into box `index`.
 *  - one digit typed: replaces that box and moves to the next;
 *  - several digits (paste, SMS/email autofill, fast typing): fills from `index` onward;
 *  - a paste of the full code into any box fills all boxes from the first one;
 *  - no digits at all (a letter, a space): nothing changes.
 * Focus lands on the first empty box after the filled run, or stays on the last box when the code is complete.
 */
export function applyOtpText(current: readonly string[], index: number, text: string): OtpEdit {
  const length = current.length;
  const at = Math.min(Math.max(index, 0), length - 1);
  const incoming = extractOtpDigits(text, length);
  if (incoming.length === 0) return { digits: [...current], focusIndex: at };

  const start = incoming.length >= length ? 0 : at;
  const digits = [...current];
  let last = start;
  for (let i = 0; i < incoming.length && start + i < length; i++) {
    digits[start + i] = incoming[i];
    last = start + i;
  }
  return { digits, focusIndex: Math.min(last + 1, length - 1) };
}

/**
 * Backspace in box `index`: clears that box if it has a digit; otherwise clears the previous box and moves there.
 * (So holding Backspace walks back through the code, as people expect.)
 */
export function applyOtpBackspace(current: readonly string[], index: number): OtpEdit {
  const digits = [...current];
  const at = Math.min(Math.max(index, 0), digits.length - 1);
  if (digits[at] !== "") {
    digits[at] = "";
    return { digits, focusIndex: at };
  }
  if (at === 0) return { digits, focusIndex: 0 };
  digits[at - 1] = "";
  return { digits, focusIndex: at - 1 };
}

/** Delete (or cutting the box's content): clears box `index` and keeps focus there. */
export function applyOtpClear(current: readonly string[], index: number): OtpEdit {
  const digits = [...current];
  const at = Math.min(Math.max(index, 0), digits.length - 1);
  digits[at] = "";
  return { digits, focusIndex: at };
}
