"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "./cn";
import { CONTROL_BOX } from "./input";
import { uiStrings, type UiLocale, type UiStrings } from "./locale";
import { applyOtpBackspace, applyOtpClear, applyOtpText, isOtpComplete, otpDigitsFrom, otpValue } from "./otp-logic";

export interface OtpInputProps {
  /** Name of the hidden field that submits the code as one string ("482913"); partial while incomplete. */
  name?: string;
  /** Number of digits. Default 6. */
  length?: number;
  value?: string;
  defaultValue?: string;
  onChange?: (code: string) => void;
  /** Called once each time the last empty box is filled. */
  onComplete?: (code: string) => void;
  /** Submit the surrounding form as soon as the code is complete. */
  autoSubmit?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  locale?: UiLocale;
  labels?: Partial<Pick<UiStrings, "otpDigit">>;
  className?: string;
  id?: string;
  required?: boolean;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

/**
 * One-time code entry: one box per digit, auto-advance, Backspace walks back, paste and SMS/email autofill
 * fill every box. Wrap in `<Fieldset label="Enter the 6-digit code">`.
 */
export function OtpInput({ name, length = 6, value, defaultValue, onChange, onComplete, autoSubmit, autoFocus, disabled, locale = "en", labels, className, id, required, ...aria }: OtpInputProps) {
  const generated = useId();
  const baseId = id ?? `o${generated}`;
  const t = uiStrings(locale, labels);
  const controlled = value !== undefined;
  const [digits, setDigits] = useState<string[]>(() => otpDigitsFrom(controlled ? value : defaultValue, length));
  const [lastSeen, setLastSeen] = useState<string | undefined>(value);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const hidden = useRef<HTMLInputElement | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const completedCode = useRef<string | null>(null);

  if (controlled && value !== lastSeen) {
    setLastSeen(value);
    if (otpValue(digits) !== value) setDigits(otpDigitsFrom(value, length));
  }

  const code = otpValue(digits);
  const complete = isOtpComplete(digits);

  useEffect(() => {
    if (pendingFocus.current !== null) {
      const target = inputs.current[pendingFocus.current];
      pendingFocus.current = null;
      target?.focus();
      target?.select();
    }
  });

  useEffect(() => {
    if (!complete) {
      completedCode.current = null;
      return;
    }
    if (completedCode.current === code) return;
    completedCode.current = code;
    onComplete?.(code);
    if (autoSubmit) hidden.current?.form?.requestSubmit();
    // onComplete is intentionally not a dependency: a new callback identity must not re-fire for the same code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, code, autoSubmit]);

  const commit = (next: string[], focusIndex: number) => {
    setDigits(next);
    pendingFocus.current = focusIndex;
    const nextCode = otpValue(next);
    if (controlled) setLastSeen(nextCode);
    if (nextCode !== code) onChange?.(nextCode);
  };

  const invalid = aria["aria-invalid"] === true || aria["aria-invalid"] === "true";

  return (
    <div
      role="group"
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      aria-describedby={aria["aria-describedby"]}
      className={cn("flex gap-2 sm:gap-3", className)}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          id={index === 0 ? baseId : `${baseId}-${index + 1}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // Autofill delivers the whole code to the first box; applyOtpText spreads it across the rest.
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          required={required}
          value={digit}
          aria-label={t.otpDigit(index + 1, length)}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const typed = event.target.value;
            if (typed === "") {
              const cleared = applyOtpClear(digits, index);
              commit(cleared.digits, cleared.focusIndex);
              return;
            }
            // A box that already holds a digit reports old+new; keep only what was just entered.
            const text = digit !== "" && typed.length === 2 && typed.startsWith(digit) ? typed.slice(1) : digit !== "" && typed.length === 2 && typed.endsWith(digit) ? typed.slice(0, 1) : typed;
            const edit = applyOtpText(digits, index, text);
            commit(edit.digits, edit.focusIndex);
          }}
          onPaste={(event) => {
            event.preventDefault();
            const edit = applyOtpText(digits, index, event.clipboardData.getData("text"));
            commit(edit.digits, edit.focusIndex);
          }}
          onKeyDown={(event) => {
            if (event.key === "Delete") {
              event.preventDefault();
              const edit = applyOtpClear(digits, index);
              commit(edit.digits, edit.focusIndex);
            } else if (event.key === "Backspace") {
              event.preventDefault();
              const edit = applyOtpBackspace(digits, index);
              commit(edit.digits, edit.focusIndex);
            } else if (event.key === "ArrowLeft" && index > 0) {
              event.preventDefault();
              inputs.current[index - 1]?.focus();
            } else if (event.key === "ArrowRight" && index < length - 1) {
              event.preventDefault();
              inputs.current[index + 1]?.focus();
            } else if (event.key === "Home") {
              event.preventDefault();
              inputs.current[0]?.focus();
            } else if (event.key === "End") {
              event.preventDefault();
              inputs.current[length - 1]?.focus();
            }
          }}
          onFocus={(event) => event.target.select()}
          className={cn(CONTROL_BOX, "h-14 w-full max-w-12 min-w-0 flex-1 p-0 text-center font-display text-2xl nums")}
        />
      ))}
      {name ? <input ref={hidden} type="hidden" name={name} value={code} disabled={disabled} /> : <input ref={hidden} type="hidden" disabled />}
    </div>
  );
}
