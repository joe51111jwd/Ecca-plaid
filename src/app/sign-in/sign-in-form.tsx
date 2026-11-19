"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, FormError, Input, OtpInput, SubmitButton, fieldError, type UiLocale } from "@/components/ui";
import { requestSignInAction, verifyCodeAction } from "./actions";
import { signInCopy } from "./copy";

export interface SignInFormProps {
  locale: UiLocale;
  next: string | null;
  defaultEmail: string;
}

/**
 * Two steps in one window: ask for the email, then accept the 6-digit code from it (the link in the email
 * works too). Plain forms posting to server actions, so it works before JavaScript loads.
 */
export function SignInForm({ locale, next, defaultEmail }: SignInFormProps) {
  const t = signInCopy(locale);
  const [requestState, requestAction, requesting] = useActionState(requestSignInAction, null);
  const [verifyState, verifyAction, verifying] = useActionState(verifyCodeAction, null);
  const [editing, setEditing] = useState(false);
  const [sends, setSends] = useState(0);

  const sentTo = requestState?.ok && !editing ? requestState.data.email : null;

  const hidden = (
    <>
      <input type="hidden" name="lang" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
    </>
  );

  if (!sentTo) {
    return (
      <form action={requestAction} onSubmit={() => setEditing(false)} noValidate className="space-y-5">
        {hidden}
        <FormError state={requestState} locale={locale} />
        <Field label={t.emailLabel} hint={t.emailHint} error={fieldError(requestState, "email")} required locale={locale}>
          <Input type="email" name="email" autoComplete="email" inputMode="email" defaultValue={requestState?.ok ? requestState.data.email : defaultEmail} autoFocus required spellCheck={false} />
        </Field>
        <SubmitButton pending={requesting} pendingText={t.sending} fullWidth size="lg">
          {t.sendLink}
        </SubmitButton>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <Alert tone="success" title={t.checkTitle} role="status">
        <p className="wrap-anywhere">{t.checkBody(sentTo)}</p>
        {sends > 0 ? <p className="mt-2">{t.resent}</p> : null}
      </Alert>
      <form action={verifyAction} className="space-y-5">
        {hidden}
        <input type="hidden" name="email" value={sentTo} />
        <FormError state={verifyState} locale={locale} />
        <Field label={t.codeLabel} hint={t.codeHint} error={fieldError(verifyState, "code")} as="group" locale={locale}>
          <OtpInput name="code" length={6} autoFocus autoSubmit required locale={locale} />
        </Field>
        <SubmitButton pending={verifying} pendingText={t.verifying} fullWidth size="lg">
          {t.verify}
        </SubmitButton>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <form action={requestAction} onSubmit={() => setSends((n) => n + 1)}>
          {hidden}
          <input type="hidden" name="email" value={sentTo} />
          <SubmitButton variant="secondary" pending={requesting} pendingText={t.sending}>
            {t.resend}
          </SubmitButton>
        </form>
        <Button variant="link" type="button" onClick={() => setEditing(true)}>
          {t.useOtherEmail}
        </Button>
      </div>
    </div>
  );
}
