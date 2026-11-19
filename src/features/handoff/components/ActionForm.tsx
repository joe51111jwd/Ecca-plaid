"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, ConfirmDialog, CopyField, Form, FormError, SubmitButton, TextLink, cn, type ButtonSize, type ButtonVariant } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { PortalNotice } from "../types";

type State = ActionResult<PortalNotice> | null;

export interface ActionFormProps {
  /** A server action taking (previous state, FormData) and returning an ActionResult. */
  action: (previous: State, formData: FormData) => Promise<State>;
  submitLabel: ReactNode;
  pendingText?: ReactNode;
  submitVariant?: ButtonVariant;
  submitSize?: ButtonSize;
  /** Extra classes for the submit button (e.g. letting a long link-style label wrap). */
  submitClassName?: string;
  /** Ask before running (destructive or consequential actions). */
  confirm?: { title: ReactNode; description?: ReactNode; confirmLabel: ReactNode; tone?: "default" | "danger" };
  /** Field name → label, for the error summary. */
  fieldLabels?: Record<string, string>;
  /** Title of the error summary. */
  errorTitle?: string;
  resetOnSuccess?: boolean;
  /** Hide the success message (the page itself shows the new state). */
  quietSuccess?: boolean;
  /** `stack` (default): fields above the button. `inline`: one row. */
  layout?: "stack" | "inline";
  "aria-label"?: string;
  className?: string;
  locale?: "en" | "es";
  children?: ReactNode;
}

/**
 * The form every portal (and family-page) action uses: runs a server action without discarding what was typed, shows
 * the error summary or the outcome, shows a one-time secret when the action returns one, and (with `confirm`) asks
 * first in a ConfirmDialog.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingText,
  submitVariant = "primary",
  submitSize = "md",
  submitClassName,
  confirm,
  fieldLabels,
  errorTitle,
  resetOnSuccess = false,
  quietSuccess = false,
  layout = "stack",
  className,
  locale = "en",
  children,
  ...rest
}: ActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const pendingData = useRef<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const inline = layout === "inline";
  const button = (
    <SubmitButton variant={submitVariant} size={submitSize} pending={pending} pendingText={pendingText} className={submitClassName}>
      {submitLabel}
    </SubmitButton>
  );
  const body = (
    <>
      <FormError state={state} fieldLabels={fieldLabels} title={errorTitle} focusOnError={!inline} locale={locale} className={inline ? "w-full" : undefined} />
      {inline ? (
        <div className="flex flex-wrap items-end gap-2">
          {children}
          {button}
        </div>
      ) : (
        <>
          {children}
          <div className="flex justify-start">{button}</div>
        </>
      )}
      {state?.ok && !quietSuccess ? (
        <Alert tone="success" role="status" className={inline ? "w-full" : undefined}>
          <p>{state.data.message}</p>
          {state.data.secret ? <CopyField className="mt-3" label={state.data.secret.label} value={state.data.secret.value} hint={state.data.secret.hint} secret /> : null}
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
        locale={locale}
      />
    </>
  );
}
