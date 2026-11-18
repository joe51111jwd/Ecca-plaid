"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";
import { cn } from "./cn";
import type { FormState } from "./form-helpers";
import { uiStrings, type UiLocale } from "./locale";

export interface FormErrorProps {
  /** The state returned by a server action (`ActionResult`). Nothing renders while it is null or ok. */
  state?: FormState;
  /** Or pass the pieces directly. */
  message?: ReactNode;
  fields?: Record<string, string>;
  /** Field name → the label people see, for the list of problems. Falls back to the message alone. */
  fieldLabels?: Record<string, string>;
  /** Field name → id of the control to jump to. Defaults to the field name. */
  fieldIds?: Record<string, string>;
  title?: string;
  locale?: UiLocale;
  /** Move keyboard focus to the summary when a new error arrives (default true), so it is read out and not missed. */
  focusOnError?: boolean;
  className?: string;
}

/**
 * Error summary for a form. Put it at the top of the form, above the first field.
 * It lists every field problem as a link to that field and takes focus when the action fails.
 */
export function FormError({ state, message, fields, fieldLabels, fieldIds, title, locale = "en", focusOnError = true, className }: FormErrorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const failed = state && !state.ok ? state.error : null;
  const text = message ?? failed?.message;
  const fieldErrors = fields ?? failed?.fields;
  const entries = fieldErrors ? Object.entries(fieldErrors) : [];
  const visible = Boolean(text) || entries.length > 0;

  useEffect(() => {
    if (visible && focusOnError) ref.current?.focus();
    // Re-run for every new action result, even when the message text is identical.
  }, [visible, focusOnError, state]);

  if (!visible) return null;
  const t = uiStrings(locale);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn("rounded-card border border-danger-line bg-danger-surface p-4 text-danger-fg", className)}
    >
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">{title ?? t.errorSummaryTitle}</p>
          {text ? <p className="mt-1 text-sm">{text}</p> : null}
          {entries.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {entries.map(([name, problem]) => (
                <li key={name}>
                  <a href={`#${fieldIds?.[name] ?? name}`} className="rounded-sm font-medium underline decoration-1 underline-offset-[3px] hover:decoration-2">
                    {fieldLabels?.[name] ? `${fieldLabels[name]}: ${problem}` : problem}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type SubmitButtonProps = Omit<Extract<ButtonProps, { href?: undefined }>, "type" | "loading" | "loadingText"> & {
  /** Label while the action runs ("Saving…"). The spinner shows either way. */
  pendingText?: ReactNode;
  /** Override the pending state (e.g. the third value of useActionState). Defaults to the enclosing form's status. */
  pending?: boolean;
};

/**
 * Submit button for `<form action={serverAction}>`: shows a spinner and blocks double submits while the
 * action is pending. Must be rendered inside the form.
 */
export function SubmitButton({ pendingText, pending, children, ...rest }: SubmitButtonProps) {
  const status = useFormStatus();
  return (
    <Button {...rest} type="submit" loading={pending ?? status.pending} loadingText={pendingText}>
      {children}
    </Button>
  );
}

export interface FormActionsProps {
  /** `end` (default): right-aligned, primary last — dialogs and dashboards. `start`: left-aligned, primary first — step flows. */
  align?: "start" | "end" | "between";
  className?: string;
  children: ReactNode;
}

/**
 * The row of buttons that ends a form. On phones the buttons stack full-width with the primary action on top.
 * Write the buttons in the order they read on desktop.
 */
export function FormActions({ align = "end", className, children }: FormActionsProps) {
  return (
    <div
      className={cn(
        "flex gap-3 *:w-full sm:items-center sm:*:w-auto",
        align === "start" && "flex-col sm:flex-row",
        align === "end" && "flex-col-reverse sm:flex-row sm:justify-end",
        align === "between" && "flex-col-reverse sm:flex-row sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}
