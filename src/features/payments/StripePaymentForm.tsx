"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, FormError, Spinner } from "@/components/ui";

/**
 * Stripe's Payment Element for one payment. This file is the only place that imports Stripe.js, and
 * PaymentForm loads it on demand, so a sandbox deployment never downloads it.
 *
 * The form reports what Stripe.js says happened in the browser so the page can move on. It is not the
 * record of the payment: that comes from Stripe's webhook (or `syncPaymentWithProcessor`) on the server.
 */

export type StripeFormResult = { status: "succeeded" | "processing" } | { status: "failed"; message: string };

export interface StripePaymentFormProps {
  clientSecret: string;
  publishableKey: string;
  /** Set for direct charges: the payment lives on this connected account and Stripe.js must be loaded for it. */
  connectedAccountId: string | null;
  /**
   * Where Stripe returns the payer when the payment method needs to leave the page: an in-app path or an
   * absolute URL. Null returns them to the page they are on.
   */
  returnUrl: string | null;
  submitLabel: ReactNode;
  onResult: (result: StripeFormResult) => void;
}

// loadStripe must run once per key and account, not on every render.
const loaded = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string, connectedAccountId: string | null): Promise<Stripe | null> {
  const cacheKey = `${publishableKey}|${connectedAccountId ?? ""}`;
  let promise = loaded.get(cacheKey);
  if (!promise) {
    promise = loadStripe(publishableKey, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined);
    loaded.set(cacheKey, promise);
  }
  return promise;
}

const NOT_COMPLETED = "The payment was not completed. Please try again, or use a different payment method.";
const NOT_LOADED = "The payment form could not be loaded. Check your connection and reload the page.";

function Inner({ returnUrl, submitLabel, onResult }: Pick<StripePaymentFormProps, "returnUrl" | "submitLabel" | "onResult">) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  function fail(message: string) {
    setError(message);
    setBusy(false);
    onResult({ status: "failed", message });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    // Validates the form and, for Apple Pay and Google Pay, collects the wallet details before confirming.
    const submitted = await elements.submit();
    if (submitted.error) return fail(submitted.error.message ?? "Please check your payment details.");

    // Stripe requires an absolute URL and adds its own query parameters to it.
    const absoluteReturnUrl = new URL(returnUrl ?? window.location.href, window.location.origin).toString();
    const confirmed = await stripe.confirmPayment({ elements, confirmParams: { return_url: absoluteReturnUrl }, redirect: "if_required" });
    if (confirmed.error) return fail(confirmed.error.message ?? NOT_COMPLETED);

    const status = confirmed.paymentIntent.status;
    if (status === "succeeded" || status === "processing") {
      onResult({ status });
      return;
    }
    fail(NOT_COMPLETED);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="stripe-payment-form">
      <FormError message={error} title="The payment did not go through" />
      {ready ? null : <Spinner label="Loading the secure payment form…" />}
      <PaymentElement onReady={() => setReady(true)} onLoadError={() => setError(NOT_LOADED)} />
      <Button type="submit" size="lg" fullWidth disabled={!stripe || !elements || !ready} loading={busy} loadingText="Processing…">
        {submitLabel}
      </Button>
    </form>
  );
}

export default function StripePaymentForm({ clientSecret, publishableKey, connectedAccountId, returnUrl, submitLabel, onResult }: StripePaymentFormProps) {
  return (
    <Elements stripe={stripeFor(publishableKey, connectedAccountId)} options={{ clientSecret }}>
      <Inner returnUrl={returnUrl} submitLabel={submitLabel} onResult={onResult} />
    </Elements>
  );
}
