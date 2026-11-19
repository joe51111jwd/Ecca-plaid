"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, ConfirmDialog, Form, FormError, SubmitButton, TextLink, cn, type ButtonSize, type ButtonVariant } from "@/components/ui";
import type { AdminActionState } from "../types";

export interface AdminActionFormProps {
  /** A server action taking (previous state, FormData) and returning an AdminActionState. */
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  submitLabel: ReactNode;
  pendingText?: ReactNode;
  submitVariant?: ButtonVariant;
  submitSize?: ButtonSize;
  /** Ask before running: required for destructive or legally significant actions. */
  confirm?: { title: ReactNode; description?: ReactNode; confirmLabel: ReactNode; tone?: "default" | "danger" };
  /** Field name → label, for the error summary. */
  fieldLabels?: Record<string, string>;
  /** Clear the fields after a successful submission (create forms). */
  resetOnSuccess?: boolean;
  /** `stack` (default): fields above the button. `inline`: one row, for table-row actions. */
  layout?: "stack" | "inline";
  /** Accessible name of the form (row actions have no visible heading). */
  "aria-label"?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * The form every admin screen uses: runs a server action without discarding what was typed, shows the error summary
 * or the outcome, and (with `confirm`) asks a yes/no question in a ConfirmDialog before anything is sent.
 */
export function AdminActionForm({
  action,
  submitLabel,
  pendingText,
  submitVariant = "primary",
  submitSize = "md",
  confirm,
  fieldLabels,
  resetOnSuccess = false,
  layout = "stack",
  className,
  children,
  ...rest
}: AdminActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const pendingData = useRef<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const inline = layout === "inline";
  const body = (
    <>
      <FormError state={state} fieldLabels={fieldLabels} focusOnError={!inline} className={inline ? "w-full" : undefined} />
      {inline ? (
        <div className="flex flex-wrap items-end gap-2">
          {children}
          <SubmitButton variant={submitVariant} size={submitSize} pending={pending} pendingText={pendingText}>
            {submitLabel}
          </SubmitButton>
        </div>
      ) : (
        <>
          {children}
          <div className="flex justify-end">
            <SubmitButton variant={submitVariant} size={submitSize} pending={pending} pendingText={pendingText}>
              {submitLabel}
            </SubmitButton>
          </div>
        </>
      )}
      {state?.ok ? (
        <Alert tone="success" role="status" className={inline ? "w-full" : undefined}>
          <p>{state.data.message}</p>
          {state.data.details && state.data.details.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
              {state.data.details.map((d) => (
                <div key={d.label} className="contents">
                  <dt className="font-medium">{d.label}</dt>
                  <dd className="wrap-anywhere nums">{d.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {state.data.link ? (
            <p className="mt-2">
              <TextLink href={state.data.link.href}>{state.data.link.label}</TextLink>
            </p>
          ) : null}
        </Alert>
      ) : null}
    </>
  );

  const classes = cn(inline ? "flex flex-col gap-2" : "space-y-4", className);

  if (!confirm) {
    return (
      <Form ref={formRef} action={dispatch} className={classes} aria-label={rest["aria-label"]}>
        {body}
      </Form>
    );
  }

  return (
    <>
      <form
        ref={formRef}
        className={classes}
        aria-label={rest["aria-label"]}
        onSubmit={(event) => {
          event.preventDefault();
          pendingData.current = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
          setConfirming(true);
        }}
      >
        {body}
      </form>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          const data = pendingData.current;
          if (data) startTransition(() => dispatch(data));
        }}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        tone={confirm.tone ?? "default"}
      />
    </>
  );
}
