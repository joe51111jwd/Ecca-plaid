import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type ControlSize = "sm" | "md" | "lg";

/** Shared look of every text-like control (Input, Textarea, Select, MoneyInput, DateInput, OtpInput). */
export const CONTROL_BOX =
  "rounded-control border border-line-control bg-surface text-fg shadow-xs transition-[border-color,box-shadow,background-color] " +
  "placeholder:text-fg-subtle hover:border-ink-600 focus-visible:border-focus " +
  "disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-sunken disabled:text-fg-disabled disabled:shadow-none " +
  // Attribute selector, not :read-only — that pseudo-class also matches every <select>.
  "[&[readonly]]:bg-sunken " +
  "aria-invalid:border-danger-600 aria-invalid:shadow-[inset_0_0_0_1px_var(--color-danger-600)]";

export const CONTROL_SIZE: Record<ControlSize, string> = {
  sm: "h-control-sm px-2.5 text-control",
  md: "h-control-md px-3 text-control",
  lg: "h-control-lg px-3.5 text-base",
};

export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  size?: ControlSize;
  /** Marks the control invalid without a Field (Field sets aria-invalid for you). */
  invalid?: boolean;
  /** Shown inside the box before the text: an icon, "$", "https://". Decorative — the label must still say what to enter. */
  leading?: ReactNode;
  /** Shown inside the box after the text: a unit, an icon. */
  trailing?: ReactNode;
}

/** Single-line text input. Wrap it in Field for the label, hint and error. */
export function Input({ size = "md", invalid, leading, trailing, className, ...rest }: InputProps) {
  const ariaInvalid = invalid ? true : rest["aria-invalid"];
  if (!leading && !trailing) {
    return <input {...rest} aria-invalid={ariaInvalid} className={cn(CONTROL_BOX, CONTROL_SIZE[size], "block w-full", className)} />;
  }
  return (
    <div className={cn("relative flex w-full items-center", className)}>
      {leading ? (
        <span aria-hidden="true" className="pointer-events-none absolute left-3 flex items-center text-fg-muted [&>svg]:size-4">
          {leading}
        </span>
      ) : null}
      <input {...rest} aria-invalid={ariaInvalid} className={cn(CONTROL_BOX, CONTROL_SIZE[size], "block w-full", leading && "pl-9", trailing && "pr-9")} />
      {trailing ? (
        <span aria-hidden="true" className="pointer-events-none absolute right-3 flex items-center text-fg-muted [&>svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

/** Multi-line text input. Resizes vertically. */
export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      rows={rows}
      aria-invalid={invalid ? true : rest["aria-invalid"]}
      className={cn(CONTROL_BOX, "block min-h-20 w-full resize-y px-3 py-2 text-control", className)}
    />
  );
}

export interface SelectProps extends Omit<ComponentProps<"select">, "size"> {
  size?: ControlSize;
  invalid?: boolean;
  /** Adds a disabled first option shown while nothing is chosen. */
  placeholder?: string;
}

/** Native select, styled. Native on purpose: it is the most reliable picker on phones and with assistive technology. */
export function Select({ size = "md", invalid, placeholder, className, children, ...rest }: SelectProps) {
  const needsEmptyDefault = placeholder !== undefined && rest.value === undefined && rest.defaultValue === undefined;
  return (
    <div className={cn("relative w-full", className)}>
      <select
        {...rest}
        {...(needsEmptyDefault ? { defaultValue: "" } : {})}
        aria-invalid={invalid ? true : rest["aria-invalid"]}
        className={cn(CONTROL_BOX, CONTROL_SIZE[size], "block w-full appearance-none pr-9")}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted" />
    </div>
  );
}
