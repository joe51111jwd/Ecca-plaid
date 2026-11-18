"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Field, fieldError, FormError, Input, SubmitButton } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import type { SandboxConfirmResult, SandboxTestCard } from "@/server/payments";
import { submitSandboxPaymentAction } from "./sandbox-actions";
import { SandboxNotice } from "./SandboxNotice";

export interface SandboxPaymentFormProps {
  paymentId: string;
  /** The payment's sandbox secret (`ClientPayment.clientSecret` / `SandboxPaymentView.clientSecret`). */
  clientSecret: string;
  amountCents: number;
  testCards: readonly SandboxTestCard[];
  /** A future expiry date (MM/YY) filled in by the "use this number" buttons. */
  testExpiry: string;
  /** Why an earlier attempt failed, shown until the next one. */
  lastFailure?: string | null;
  /** Called after every submitted attempt, whatever the outcome (succeeded, processing or failed). */
  onResult?: (result: SandboxConfirmResult) => void;
  /** Default "Pay $1,700.00 (sandbox)". */
  submitLabel?: ReactNode;
  /** The "Sandbox — no money moves" block above the form. Turn it off only when the page already shows the sandbox banner. */
  showNotice?: boolean;
}

/** Any 3 or 4 digits work; this is what the "use this number" buttons fill in. */
const TEST_SECURITY_CODE = "123";

const FIELD_IDS = { cardNumber: "sandbox-card-number", expiry: "sandbox-expiry", securityCode: "sandbox-security-code" };
const FIELD_LABELS = { cardNumber: "Test card number", expiry: "Expiry date", securityCode: "Security code" };

/** Groups digits in fours as they are typed. */
function groupDigits(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * The sandbox's card-style form. It looks like a card form so the checkout around it can be exercised end to
 * end, but it only accepts the documented test numbers, and the number typed decides what happens. Nothing
 * typed here is stored, and nothing is charged.
 */
export function SandboxPaymentForm({ paymentId, clientSecret, amountCents, testCards, testExpiry, lastFailure, onResult, submitLabel, showNotice = true }: SandboxPaymentFormProps) {
  const [state, formAction, pending] = useActionState(submitSandboxPaymentAction, null);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const numberInput = useRef<HTMLInputElement>(null);
  const declined = useRef<HTMLDivElement>(null);

  // The parent hears about each attempt once, after the server has answered.
  const reported = useRef<typeof state>(null);
  useEffect(() => {
    if (!state || state === reported.current) return;
    reported.current = state;
    if (!state.ok) return;
    if (state.data.status === "failed") declined.current?.focus();
    onResult?.(state.data);
  }, [state, onResult]);

  const failure = state?.ok ? state.data.failureReason : state ? null : (lastFailure ?? null);

  function fillTestCard(card: SandboxTestCard) {
    setCardNumber(card.display);
    setExpiry(testExpiry);
    setSecurityCode(TEST_SECURITY_CODE);
    numberInput.current?.focus();
  }

  return (
    <div className="space-y-5" data-testid="sandbox-payment-form">
      {showNotice ? <SandboxNotice /> : null}

      <form action={formAction} noValidate className="space-y-4">
        <input type="hidden" name="paymentId" value={paymentId} />
        <input type="hidden" name="clientSecret" value={clientSecret} />

        <FormError state={state} title="The test payment was not submitted" fieldIds={FIELD_IDS} fieldLabels={FIELD_LABELS} />
        {failure ? (
          <div ref={declined} tabIndex={-1} className="rounded-card outline-none focus-visible:ring-2 focus-visible:ring-focus" data-testid="sandbox-payment-failure">
            <Alert tone="danger" role="alert" title="The test payment did not go through">
              <p>{failure} You can try again with another test number.</p>
            </Alert>
          </div>
        ) : null}

        {/* autoComplete is off and the field names are unusual on purpose: a browser must not offer a saved real card here. */}
        <Field id={FIELD_IDS.cardNumber} label={FIELD_LABELS.cardNumber} hint="Use one of the test numbers below. Real card numbers are not accepted." error={fieldError(state, "cardNumber")}>
          <Input
            ref={numberInput}
            name="sandboxCardNumber"
            value={cardNumber}
            onChange={(event) => setCardNumber(groupDigits(event.target.value))}
            inputMode="numeric"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            placeholder="4242 4242 4242 4242"
            maxLength={23}
            className="font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 items-start gap-4">
          <Field id={FIELD_IDS.expiry} label={FIELD_LABELS.expiry} hint="Any future date" error={fieldError(state, "expiry")}>
            <Input name="sandboxExpiry" value={expiry} onChange={(event) => setExpiry(event.target.value.slice(0, 9))} inputMode="numeric" autoComplete="off" placeholder="MM/YY" className="font-mono" />
          </Field>
          <Field id={FIELD_IDS.securityCode} label={FIELD_LABELS.securityCode} hint="Any 3 digits" error={fieldError(state, "securityCode")}>
            <Input
              name="sandboxSecurityCode"
              value={securityCode}
              onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="123"
              className="font-mono"
            />
          </Field>
        </div>

        <SubmitButton size="lg" fullWidth pending={pending} pendingText="Submitting test payment…">
          {submitLabel ?? `Pay ${formatUsd(amountCents, { cents: true })} (sandbox)`}
        </SubmitButton>
      </form>

      <section aria-labelledby={`${FIELD_IDS.cardNumber}-tests`} className="rounded-card border border-line bg-canvas p-4">
        <h3 id={`${FIELD_IDS.cardNumber}-tests`} className="text-sm font-semibold text-fg">
          Test numbers
        </h3>
        <p className="mt-1 text-sm text-fg-muted">The number you use decides what happens to the test payment.</p>
        <ul className="mt-3 divide-y divide-line">
          {testCards.map((card) => (
            <li key={card.number} className="grid items-center gap-x-4 gap-y-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  <span className="font-mono">{card.display}</span>
                  <span className="mx-2 text-fg-subtle" aria-hidden="true">
                    ·
                  </span>
                  {card.label}
                </p>
                <p className="text-sm text-fg-muted">{card.description}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="justify-self-start"
                onClick={() => fillTestCard(card)}
                aria-label={`Use test number ${card.display}: ${card.label}`}
                data-testid={`sandbox-use-${card.outcome}`}
              >
                Use this number
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
