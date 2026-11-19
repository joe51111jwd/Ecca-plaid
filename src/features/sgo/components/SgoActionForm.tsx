"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, ConfirmDialog, CopyField, Form, FormError, SubmitButton, TextLink, cn, type ButtonSize, type ButtonVariant } from "@/components/ui";
import type { Mode } from "@/db/schema";
import type { SgoActionState } from "../types";

export interface SgoActionFormProps {
  /** A server action taking (previous state, FormData) and returning an SgoActionState. */
  action: (previous: SgoActionState, formData: FormData) => Promise<SgoActionState>;
  /**
   * The organization the page was rendered for; sent as a hidden field so a stale tab cannot act on another one.
   * Omitted only on the signup form, which acts before there is an organization.
   */
  orgId: string | null;
  /**
   * The test/live mode the page was rendered in; sent as a hidden field so a tab left open in one mode cannot act in
   * the other after the switch was flipped elsewhere (the server reads the mode from a cookie shared by every tab).
   */
  mode?: Mode | null;
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
  "aria-label"?: string;
  className?: string;
  encType?: "multipart/form-data";
  children?: ReactNode;
}

/**
 * The form every dashboard screen uses: runs a server action without discarding what was typed, shows the error
 * summary or the outcome (including a value shown only once, such as an API key or a family link), and with
 * `confirm` asks a yes/no question before anything is sent.
 */
export function SgoActionForm({
  action,
  orgId,
  mode,
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
}: SgoActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const pendingData = useRef<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const inline = layout === "inline";
  const notice = state?.ok ? state.data : null;
  const body = (
    <>
      {orgId ? <input type="hidden" name="orgId" value={orgId} /> : null}
      {mode ? <input type="hidden" name="mode" value={mode} /> : null}
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
      {notice ? (
        <Alert tone={notice.notes && notice.notes.length > 0 && !notice.shownOnce ? "warning" : "success"} role="status" className={inline ? "w-full" : undefined}>
          <p>{notice.message}</p>
          {notice.notes && notice.notes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {notice.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {notice.details && notice.details.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
              {notice.details.map((d) => (
                <div key={d.label} className="contents">
                  <dt className="font-medium">{d.label}</dt>
                  <dd className="wrap-anywhere nums">{d.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {notice.shownOnce ? <CopyField className="mt-3" label={notice.shownOnce.label} value={notice.shownOnce.value} secret={notice.shownOnce.secret} hint={notice.shownOnce.hint} /> : null}
          {notice.link ? (
            <p className="mt-2">
              <TextLink href={notice.link.href}>{notice.link.label}</TextLink>
            </p>
          ) : null}
        </Alert>
      ) : null}
    </>
  );

  const classes = cn(inline ? "flex flex-col gap-2" : "space-y-4", className);

  if (!confirm) {
    return (
      <Form ref={formRef} action={dispatch} className={classes} aria-label={rest["aria-label"]} encType={rest.encType}>
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
        encType={rest.encType}
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
