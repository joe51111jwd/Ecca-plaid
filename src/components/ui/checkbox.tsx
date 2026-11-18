import { Check } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type" | "size"> {
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  /** Validation message shown under the row and announced with the checkbox. */
  error?: ReactNode | null | false;
  /** `card` draws a bordered row — use it for a consent or a designation the person must actively tick. */
  variant?: "plain" | "card";
}

/** A labelled checkbox. The whole row is the click target. Works in plain forms (name/value/defaultChecked). */
export function Checkbox({ label, description, error, variant = "plain", className, id, disabled, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `c${generated}`;
  const descId = description ? `${inputId}-desc` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [rest["aria-describedby"], descId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className={cn(
          "flex items-start gap-3 in-data-[density=touch]:min-h-11",
          variant === "card"
            ? "rounded-card border bg-surface p-4 transition-colors has-checked:border-action has-checked:bg-brand-surface has-checked:shadow-[inset_0_0_0_1px_var(--action)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            : "in-data-[density=touch]:py-2",
          // One border colour at a time: two colour utilities on one element do not resolve by order of appearance.
          variant === "card" && (error ? "border-danger-600" : "border-line-strong"),
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="relative mt-0.5 inline-flex size-5 shrink-0">
          <input
            {...rest}
            id={inputId}
            type="checkbox"
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={error ? true : rest["aria-invalid"]}
            className={cn(
              "peer size-5 appearance-none rounded-[5px] border border-line-control bg-surface transition-colors",
              "checked:border-action checked:bg-action hover:border-ink-600 checked:hover:border-action-hover checked:hover:bg-action-hover",
              "aria-invalid:border-danger-600 disabled:cursor-not-allowed",
              variant === "card" && "focus-visible:outline-none",
            )}
          />
          <Check aria-hidden="true" strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto size-3.5 text-action-fg opacity-0 peer-checked:opacity-100" />
        </span>
        <span className="min-w-0 text-sm in-data-[density=touch]:text-base">
          <span className="font-medium text-fg">{label}</span>
          {description ? (
            <span id={descId} className="mt-0.5 block text-fg-muted">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SwitchProps extends Omit<ComponentProps<"input">, "type" | "size" | "role"> {
  label: ReactNode;
  description?: ReactNode;
  /** Put the switch after the text (settings lists) instead of before it. */
  align?: "start" | "end";
}

/**
 * An on/off setting that takes effect as a setting, not as a form answer.
 * It is a native checkbox with role="switch", so it submits in plain forms without script.
 */
export function Switch({ label, description, align = "start", className, id, disabled, ...rest }: SwitchProps) {
  const generated = useId();
  const inputId = id ?? `s${generated}`;
  const descId = description ? `${inputId}-desc` : undefined;
  const control = (
    <span className="relative inline-flex h-6 w-10 shrink-0">
      <input
        {...rest}
        id={inputId}
        type="checkbox"
        role="switch"
        disabled={disabled}
        aria-describedby={[rest["aria-describedby"], descId].filter(Boolean).join(" ") || undefined}
        className="peer h-6 w-10 appearance-none rounded-full border border-line-control bg-ink-300 transition-colors checked:border-action checked:bg-action disabled:cursor-not-allowed"
      />
      <span aria-hidden="true" className="pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </span>
  );
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex items-start gap-3 in-data-[density=touch]:min-h-11 in-data-[density=touch]:py-2",
        align === "end" && "justify-between",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {align === "start" ? control : null}
      <span className="min-w-0 text-sm in-data-[density=touch]:text-base">
        <span className="font-medium text-fg">{label}</span>
        {description ? (
          <span id={descId} className="mt-0.5 block text-fg-muted">
            {description}
          </span>
        ) : null}
      </span>
      {align === "end" ? control : null}
    </label>
  );
}
