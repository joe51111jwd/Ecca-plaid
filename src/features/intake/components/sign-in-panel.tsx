"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Form, FormError, Input, OtpInput, SubmitButton, fieldError } from "@/components/ui";
import { getDictionary, type Locale } from "@/i18n";
import { requestCodeAction, verifyCodeAction } from "../actions";
import type { Surface } from "../flow";
import { HiddenFields } from "./hidden-fields";

export interface SignInPanelProps {
  locale: Locale;
  /** The verification link's base path (`/v/{token}` or `/embed/verify/{token}`). */
  base: string;
  surface: Surface;
  defaultEmail?: string;
}

/**
 * Sign-in inside the verification flow: email, then the 6-digit code typed on the same screen, so the family
 * never leaves the page (or the partner's frame). On the page the email's link works too.
 */
export function SignInPanel({ locale, base, surface, defaultEmail = "" }: SignInPanelProps) {
  const t = getDictionary(locale).signIn;
  const [requestState, requestAction, requesting] = useActionState(requestCodeAction, null);
  const [verifyState, verifyAction, verifying] = useActionState(verifyCodeAction, null);
  const [editing, setEditing] = useState(false);
  const [sends, setSends] = useState(0);
  const sentTo = requestState?.ok && !editing ? requestState.data.email : null;
  const hidden = <HiddenFields values={{ base, lang: locale }} />;

  if (!sentTo) {
    return (
      <Form action={requestAction} onSubmit={() => setEditing(false)} noValidate className="space-y-5">
        {hidden}
        <FormError state={requestState} locale={locale} />
        <Field label={t.emailLabel} hint={t.emailHint} error={fieldError(requestState, "email")} required locale={locale} id="email">
          <Input type="email" name="email" autoComplete="email" inputMode="email" defaultValue={requestState?.ok ? requestState.data.email : defaultEmail} required spellCheck={false} />
        </Field>
        <SubmitButton pending={requesting} pendingText={t.sending} fullWidth size="lg">
          {t.send}
        </SubmitButton>
      </Form>
    );
  }

  return (
    <div className="space-y-5">
      <Alert tone="success" title={t.checkTitle} role="status">
        <p>{t.checkBody(sentTo)}</p>
        {surface === "page" ? <p className="mt-1">{t.checkBodyLink}</p> : null}
        {sends > 0 ? <p className="mt-2">{t.resent}</p> : null}
      </Alert>
      <Form action={verifyAction} className="space-y-5">
        {hidden}
        <input type="hidden" name="email" value={sentTo} />
        <FormError state={verifyState} locale={locale} />
        <Field label={t.codeLabel} hint={t.codeHint} error={fieldError(verifyState, "code")} as="group" locale={locale} id="code">
          <OtpInput name="code" length={6} autoFocus autoSubmit required locale={locale} />
        </Field>
        <SubmitButton pending={verifying} pendingText={t.verifying} fullWidth size="lg">
          {t.verify}
        </SubmitButton>
      </Form>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Form action={requestAction} onSubmit={() => setSends((n) => n + 1)}>
          {hidden}
          <input type="hidden" name="email" value={sentTo} />
          <SubmitButton variant="secondary" pending={requesting} pendingText={t.sending}>
            {t.resend}
          </SubmitButton>
        </Form>
        <Button variant="link" type="button" onClick={() => setEditing(true)}>
          {t.otherEmail}
        </Button>
      </div>
    </div>
  );
}
