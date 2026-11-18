"use client";

import { useId, useState } from "react";
import { cn } from "./cn";
import { checkDateParts, digitsOnly, isoFromParts, parsePastedDate, partsFromIso, type DateParts } from "./date-parts";
import { CONTROL_BOX, CONTROL_SIZE, type ControlSize } from "./input";
import { uiStrings, type UiLocale, type UiStrings } from "./locale";

export interface DateInputProps {
  /** Name of the hidden field that submits the date as "YYYY-MM-DD", or "" while it is incomplete or not a real date. */
  name?: string;
  /** Controlled ISO date ("2015-03-09") or null. */
  value?: string | null;
  defaultValue?: string | null;
  /** Called on every edit with the ISO date (null while incomplete/invalid) and the raw parts. */
  onChange?: (iso: string | null, parts: DateParts) => void;
  /** Inclusive ISO bounds. A date outside them is reported as invalid (hidden field stays empty). */
  min?: string;
  max?: string;
  /** "bday" lets browsers offer a saved date of birth. Default "off". */
  autoComplete?: "bday" | "off";
  size?: ControlSize;
  disabled?: boolean;
  locale?: UiLocale;
  labels?: Partial<Pick<UiStrings, "month" | "day" | "year" | "monthPlaceholder" | "dayPlaceholder" | "yearPlaceholder">>;
  className?: string;
  id?: string;
  required?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

const FIELDS = [
  { key: "month", maxLength: 2, width: "w-16", auto: "bday-month" },
  { key: "day", maxLength: 2, width: "w-16", auto: "bday-day" },
  { key: "year", maxLength: 4, width: "w-24", auto: "bday-year" },
] as const;

/**
 * Month / day / year as three labelled fields — the reliable way to enter a date of birth on a phone.
 * Never a calendar popup. Wrap in `<Fieldset label="Date of birth">`.
 */
export function DateInput({ name, value, defaultValue, onChange, min, max, autoComplete = "off", size = "md", disabled, locale = "en", labels, className, id, required, ...aria }: DateInputProps) {
  const generated = useId();
  const baseId = id ?? `d${generated}`;
  const t = uiStrings(locale, labels);
  const controlled = value !== undefined;
  const [parts, setParts] = useState<DateParts>(() => partsFromIso(controlled ? value : defaultValue));
  const [lastSeen, setLastSeen] = useState<string | null | undefined>(value);

  if (controlled && value !== lastSeen) {
    setLastSeen(value);
    if (isoFromParts(parts) !== (value ?? null)) setParts(partsFromIso(value));
  }

  const check = checkDateParts(parts, { min, max });
  const groupInvalid = aria["aria-invalid"] === true || aria["aria-invalid"] === "true";
  const touched = parts.month !== "" && parts.day !== "" && parts.year.length === 4;
  // Highlight the specific field only once all three are filled in, so a half-typed date is never shown as wrong.
  const badField = touched && !check.ok ? check.field : null;

  const commit = (next: DateParts) => {
    setParts(next);
    const iso = isoFromParts(next, { min, max });
    if (controlled) setLastSeen(iso);
    onChange?.(iso, next);
  };
  const update = (key: keyof DateParts, raw: string, maxLength: number) => commit({ ...parts, [key]: digitsOnly(raw, maxLength) });

  return (
    <div role="group" aria-labelledby={aria["aria-labelledby"]} aria-describedby={aria["aria-describedby"]} className={cn("flex flex-wrap gap-3", className)}>
      {FIELDS.map((field, index) => {
        const inputId = index === 0 ? baseId : `${baseId}-${field.key}`;
        return (
          <div key={field.key} className={field.width}>
            <label htmlFor={inputId} className="mb-1 block text-sm text-fg-muted">
              {t[field.key]}
            </label>
            <input
              id={inputId}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              // No maxLength attribute: it would truncate a paste before the digits are picked out of it.
              autoComplete={autoComplete === "bday" ? field.auto : "off"}
              placeholder={t[`${field.key}Placeholder`]}
              value={parts[field.key]}
              disabled={disabled}
              required={required}
              aria-invalid={groupInvalid || badField === field.key || (touched && !check.ok && check.field === null) || undefined}
              onChange={(event) => update(field.key, event.target.value, field.maxLength)}
              onPaste={(event) => {
                // A whole date pasted into any one field fills all three.
                const pasted = parsePastedDate(event.clipboardData.getData("text"));
                if (!pasted) return;
                event.preventDefault();
                commit(pasted);
              }}
              className={cn(CONTROL_BOX, CONTROL_SIZE[size], "block w-full text-center nums")}
            />
          </div>
        );
      })}
      {name ? <input type="hidden" name={name} value={check.ok ? check.iso : ""} disabled={disabled} /> : null}
    </div>
  );
}
