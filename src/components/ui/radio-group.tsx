import type { ReactNode } from "react";
import { cn } from "./cn";

export interface RadioOption {
  value: string;
  label: ReactNode;
  /** Secondary line: what choosing this means, in plain words. */
  description?: ReactNode;
  /** Cards only: shown at the start of the card. */
  icon?: ReactNode;
  /** Cards only: a small Badge at the end of the title row ("Fastest"). */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Form field name. Required: the group submits like native radios. */
  name: string;
  options: RadioOption[];
  /** Controlled value. Needs onChange, so only from a client component; server pages use defaultValue. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** `list` for short answers; `cards` for a decision with consequences (upload vs auto-submit, filing status). */
  variant?: "list" | "cards";
  /** Cards only: columns from the `sm` breakpoint up. Always one column on phones. */
  columns?: 1 | 2 | 3;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

const COLUMNS = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" } as const;

const RADIO =
  "size-5 shrink-0 appearance-none rounded-full border border-line-control bg-surface transition-[border-color,border-width] " +
  "checked:border-[6px] checked:border-action hover:border-ink-600 checked:hover:border-action-hover disabled:cursor-not-allowed";

/**
 * One choice from a few options. Wrap in `<Fieldset label=…>` (or `<Field as="group">`) for the question text.
 * Arrow keys move between options, as with native radios.
 */
export function RadioGroup({ name, options, value, defaultValue, onChange, variant = "list", columns = 1, required, disabled, className, id, ...aria }: RadioGroupProps) {
  const invalid = aria["aria-invalid"] === true || aria["aria-invalid"] === "true";
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      aria-describedby={aria["aria-describedby"]}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={cn(variant === "cards" ? cn("grid gap-3", COLUMNS[columns]) : "flex flex-col gap-1", className)}
    >
      {options.map((option) => {
        const isDisabled = disabled || option.disabled;
        const input = (
          <input
            type="radio"
            name={name}
            value={option.value}
            required={required}
            disabled={isDisabled}
            {...(value !== undefined ? { checked: value === option.value } : {})}
            {...(value === undefined && defaultValue !== undefined ? { defaultChecked: defaultValue === option.value } : {})}
            {...(onChange ? { onChange: () => onChange(option.value) } : {})}
            className={cn(RADIO, "mt-0.5", variant === "cards" && "focus-visible:outline-none")}
          />
        );
        if (variant === "cards") {
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex items-start gap-3 rounded-card border bg-surface p-4 transition-colors",
                "hover:border-ink-500 has-checked:border-action has-checked:bg-brand-surface has-checked:shadow-[inset_0_0_0_1px_var(--action)]",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
                invalid ? "border-danger-600" : "border-line-strong",
                isDisabled && "cursor-not-allowed opacity-60",
              )}
            >
              {input}
              {option.icon ? (
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-brand-700 [&>svg]:size-5">
                  {option.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base font-semibold text-fg">{option.label}</span>
                  {option.badge}
                </span>
                {option.description ? <span className="mt-1 block text-sm text-fg-muted">{option.description}</span> : null}
              </span>
            </label>
          );
        }
        return (
          <label
            key={option.value}
            className={cn("flex items-start gap-3 py-1.5 in-data-[density=touch]:min-h-11 in-data-[density=touch]:py-2.5 pointer-coarse:min-h-11 pointer-coarse:py-2.5", isDisabled && "cursor-not-allowed opacity-60")}
          >
            {input}
            <span className="min-w-0 text-sm in-data-[density=touch]:text-base">
              <span className="font-medium text-fg">{option.label}</span>
              {option.description ? <span className="mt-0.5 block text-fg-muted">{option.description}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
