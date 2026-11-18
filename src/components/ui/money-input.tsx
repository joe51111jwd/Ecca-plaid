"use client";

import { useState, type ComponentProps } from "react";
import type { Cents } from "@/lib/money";
import { cn } from "./cn";
import { CONTROL_BOX, CONTROL_SIZE, type ControlSize } from "./input";
import { formatMoneyText, parseMoneyText, sanitizeMoneyText } from "./money-format";

export interface MoneyInputProps extends Omit<ComponentProps<"input">, "type" | "size" | "value" | "defaultValue" | "onChange" | "name" | "inputMode"> {
  /** Name of the hidden field that submits the amount as INTEGER CENTS ("170000"), or "" when empty/invalid. */
  name?: string;
  /** Controlled amount in cents. */
  valueCents?: Cents | null;
  defaultValueCents?: Cents | null;
  /** Called with integer cents, or null while the field is empty or not yet a valid amount. */
  onValueChange?: (cents: Cents | null) => void;
  /** false = whole dollars only. Default true. */
  allowCents?: boolean;
  size?: ControlSize;
  invalid?: boolean;
}

/**
 * Dollar amount field. Shows grouped dollars ("1,700"), emits integer cents, and opens the numeric keypad
 * with a decimal key on phones. Never does arithmetic in floats.
 */
export function MoneyInput({ name, valueCents, defaultValueCents, onValueChange, allowCents = true, size = "md", invalid, className, onFocus, onBlur, disabled, ...rest }: MoneyInputProps) {
  const controlled = valueCents !== undefined;
  const [text, setText] = useState(() => formatMoneyText(controlled ? valueCents : defaultValueCents, { allowCents }));
  const [focused, setFocused] = useState(false);
  const [lastSeen, setLastSeen] = useState<Cents | null | undefined>(valueCents);

  // A controlled value that changed from outside (not by typing here) replaces the text.
  if (controlled && valueCents !== lastSeen) {
    setLastSeen(valueCents);
    if (parseMoneyText(text) !== valueCents) setText(formatMoneyText(valueCents, { allowCents, grouping: !focused }));
  }

  const cents = parseMoneyText(text);

  return (
    <div className={cn("relative flex w-full items-center", className)}>
      <span aria-hidden="true" className={cn("pointer-events-none absolute left-3 text-fg-muted nums", size === "lg" ? "text-base" : "text-control")}>
        $
      </span>
      <input
        {...rest}
        type="text"
        inputMode={allowCents ? "decimal" : "numeric"}
        autoComplete={rest.autoComplete ?? "off"}
        disabled={disabled}
        value={text}
        aria-invalid={invalid ? true : rest["aria-invalid"]}
        onChange={(event) => {
          const next = sanitizeMoneyText(event.target.value, { allowCents });
          setText(next);
          const nextCents = parseMoneyText(next);
          if (controlled) setLastSeen(nextCents);
          onValueChange?.(nextCents);
        }}
        onFocus={(event) => {
          setFocused(true);
          // Edit without thousands separators so the caret never jumps over an inserted comma.
          setText(formatMoneyText(parseMoneyText(text), { allowCents, grouping: false }));
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          setText(formatMoneyText(parseMoneyText(text), { allowCents }));
          onBlur?.(event);
        }}
        className={cn(CONTROL_BOX, CONTROL_SIZE[size], "block w-full pl-7 nums")}
      />
      {name ? <input type="hidden" name={name} value={cents === null ? "" : String(cents)} disabled={disabled} /> : null}
    </div>
  );
}
