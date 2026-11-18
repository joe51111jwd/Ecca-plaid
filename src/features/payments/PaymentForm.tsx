"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { Alert, Banner, LineItems, Spinner } from "@/components/ui";
import type { PaymentStatus } from "@/db/schema";
import { formatUsd } from "@/lib/money";
import type { ClientPayment, SandboxConfirmResult } from "@/server/payments";
import { PaymentOutcome } from "./PaymentOutcome";
import { SandboxPaymentForm } from "./SandboxPaymentForm";
import type { StripeFormResult } from "./StripePaymentForm";

// Stripe.js and the Payment Element are fetched only when a Stripe payment is actually shown.
const StripePaymentForm = dynamic(() => import("./StripePaymentForm"), {
  ssr: false,
  loading: () => <Spinner label="Loading the secure payment form…" />,
});

export type PaymentFormResult =
  | { paymentId: string; status: "succeeded" | "processing" }
  /** The attempt did not go through; the payer can try again on the same form. `message` is safe to show. */
  | { paymentId: string; status: "failed"; message: string };

export interface PaymentFormProps {
  /** From `createDonationPayment(...).client` or `getPaymentForClient(paymentId)`. */
  payment: ClientPayment;
  /**
   * Where the payer goes once the payment has succeeded or is pending: an in-app path ("/give/thanks") or an
   * absolute http(s) URL. `payment_id` and `redirect_status` (succeeded | processing) are added to its query.
   * The page there must read the payment's real state on the server; the query is only a hint.
   */
  returnUrl?: string;
  /** Called after every attempt. With a `returnUrl`, it runs just before the redirect. */
  onResult?: (result: PaymentFormResult) => void;
  /** Default "Pay $1,700.00". The checkout decides its own verb. */
  submitLabel?: ReactNode;
  /** Show what the total is made of above the form (default: only when there is more than one line). */
  showLines?: boolean;
  className?: string;
}

function isSafeReturnUrl(url: string): boolean {
  if (url.startsWith("/")) return !url.startsWith("//") && !url.startsWith("/\\");
  return /^https?:\/\//i.test(url);
}

function withResult(url: string, paymentId: string, status?: "succeeded" | "processing"): string {
  const [beforeHash, hash = ""] = url.split("#", 2);
  const params = new URLSearchParams({ payment_id: paymentId, ...(status ? { redirect_status: status } : {}) });
  return `${beforeHash}${beforeHash.includes("?") ? "&" : "?"}${params.toString()}${hash ? `#${hash}` : ""}`;
}

/**
 * The payment step of a checkout. Give it what the server said about the payment and it shows the right
 * form: Stripe's Payment Element, or the sandbox card form with its "no money moves" notice. When the
 * payment is finished, pending, canceled or refunded it shows that instead.
 */
export function PaymentForm({ payment, returnUrl, onResult, submitLabel, showLines, className }: PaymentFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>(payment.status);
  const sandbox = payment.provider === "sandbox";
  const target = returnUrl && isSafeReturnUrl(returnUrl) ? returnUrl : null;

  const finish = useCallback(
    (result: PaymentFormResult) => {
      setStatus(result.status);
      onResult?.(result);
      if (result.status === "failed") return;
      if (!target) {
        // No redirect: let the server components around the form pick up the new state.
        router.refresh();
        return;
      }
      const destination = withResult(target, result.paymentId, result.status);
      if (destination.startsWith("/")) router.push(destination);
      else window.location.assign(destination);
    },
    [onResult, router, target],
  );

  const onSandboxResult = useCallback(
    (result: SandboxConfirmResult) => {
      if (result.status === "failed") finish({ paymentId: result.paymentId, status: "failed", message: result.failureReason ?? "The test payment did not go through." });
      else finish({ paymentId: result.paymentId, status: result.status });
    },
    [finish],
  );

  const onStripeResult = useCallback((result: StripeFormResult) => finish({ paymentId: payment.paymentId, ...result }), [finish, payment.paymentId]);

  const total = formatUsd(payment.amountCents, { cents: true });
  const lines = showLines ?? payment.lines.length > 1;
  const payable = status === "requires_payment" || status === "failed";

  return (
    <div className={className} data-testid="payment-form" data-provider={payment.provider} data-status={status}>
      <div className="space-y-5">
        {!sandbox && payment.mode === "test" ? (
          <Banner tone="sandbox" className="rounded-card">
            Test mode: this payment uses the processor&rsquo;s test environment. No money moves.
          </Banner>
        ) : null}

        {lines ? (
          <LineItems
            label="What you are paying"
            showCents
            items={payment.lines.map((line) => ({ label: line.description, amountCents: line.amountCents }))}
            total={{ label: sandbox ? "Total (sandbox, not charged)" : "Total", amountCents: payment.amountCents }}
          />
        ) : (
          <p className="flex items-baseline justify-between gap-4 text-base">
            <span className="font-medium text-fg">{sandbox ? "Amount (sandbox, not charged)" : "Amount"}</span>
            <span className="text-lg font-semibold text-fg nums" data-testid="payment-amount">
              {total}
            </span>
          </p>
        )}

        {!payable ? (
          <PaymentOutcome status={status} sandbox={sandbox} />
        ) : payment.provider === "sandbox" ? (
          <SandboxPaymentForm
            paymentId={payment.paymentId}
            clientSecret={payment.clientSecret}
            amountCents={payment.amountCents}
            testCards={payment.testCards}
            testExpiry={payment.testExpiry}
            lastFailure={payment.failureReason}
            onResult={onSandboxResult}
            submitLabel={submitLabel}
          />
        ) : payment.clientSecret ? (
          <StripePaymentForm
            clientSecret={payment.clientSecret}
            publishableKey={payment.publishableKey}
            connectedAccountId={payment.connectedAccountId}
            // Stripe needs an absolute URL for payment methods that leave the page; it adds its own query parameters.
            returnUrl={new URL(withResult(target ?? window.location.pathname + window.location.search, payment.paymentId), window.location.origin).toString()}
            submitLabel={submitLabel ?? `Pay ${total}`}
            onResult={onStripeResult}
          />
        ) : (
          <Alert tone="danger" role="alert" title="This payment cannot be completed here">
            <p>Go back and start the payment again.</p>
          </Alert>
        )}
      </div>
    </div>
  );
}
