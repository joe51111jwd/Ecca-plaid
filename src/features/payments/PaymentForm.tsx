"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Banner, Button, LineItems, Spinner } from "@/components/ui";
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
   * Without it the form stays on the page, shows the outcome and refreshes the server components around it.
   */
  returnUrl?: string;
  /** Called after every attempt. With a `returnUrl`, it runs just before the redirect. */
  onResult?: (result: PaymentFormResult) => void;
  /** Default "Pay $1,700.00" (sandbox: "Pay $1,700.00 (sandbox)"). The checkout decides its own verb. */
  submitLabel?: ReactNode;
  /** Show what the total is made of above the form (default: only when there is more than one line). */
  showLines?: boolean;
  /** The "Sandbox — no money moves" block above the sandbox form. Turn it off only on a page that already shows the sandbox banner. */
  showSandboxNotice?: boolean;
  /**
   * While the payment is pending, ask the server for the page again every few seconds so it shows the
   * outcome when it arrives. For flows that finish in seconds (the sandbox); a real bank payment takes days.
   */
  refreshWhilePending?: boolean;
  className?: string;
}

/** How often a pending payment is looked up again when `refreshWhilePending` is set. */
const PENDING_REFRESH_MS = 2500;

const isPayable = (status: PaymentStatus): status is "requires_payment" | "failed" => status === "requires_payment" || status === "failed";

function isSafeReturnUrl(url: string): boolean {
  if (url.startsWith("/")) return !url.startsWith("//") && !url.includes("\\");
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
 *
 * What the form reports (through `onResult` and the redirect) is what the browser saw. The record of the
 * payment is the server's: the processor's event, or `syncPaymentWithProcessor`.
 */
export function PaymentForm({ payment, returnUrl, onResult, submitLabel, showLines, showSandboxNotice = true, refreshWhilePending = false, className }: PaymentFormProps) {
  const router = useRouter();
  const [submitted, setSubmitted] = useState<PaymentFormResult["status"] | null>(null);
  // The server's word wins: what the form last heard only bridges the moment until the page is rendered again.
  const status: PaymentStatus = isPayable(payment.status) && submitted && submitted !== "failed" ? submitted : payment.status;
  const sandbox = payment.provider === "sandbox";
  const target = returnUrl && isSafeReturnUrl(returnUrl) ? returnUrl : null;

  const finish = useCallback(
    (result: PaymentFormResult) => {
      setSubmitted(result.status);
      onResult?.(result);
      if (result.status === "failed" || !target) {
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

  useEffect(() => {
    if (!refreshWhilePending || status !== "processing") return;
    const timer = setInterval(() => router.refresh(), PENDING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshWhilePending, status, router]);

  const total = formatUsd(payment.amountCents, { cents: true });
  const continueTo = target && (status === "succeeded" || status === "processing") ? withResult(target, payment.paymentId, status) : null;

  return (
    <div className={className} data-testid="payment-form" data-provider={payment.provider} data-status={status}>
      <div className="space-y-5">
        {!sandbox && payment.mode === "test" ? (
          <Banner tone="sandbox" className="rounded-card">
            Test mode: this payment uses the processor&rsquo;s test environment. No money moves.
          </Banner>
        ) : null}

        {(showLines ?? payment.lines.length > 1) ? (
          <LineItems
            label="What this payment is made of"
            showCents
            items={payment.lines.map((line) => ({ label: line.description, amountCents: line.amountCents }))}
            total={{ label: sandbox ? "Total (sandbox, not charged)" : "Total", amountCents: payment.amountCents }}
          />
        ) : (
          <p className="flex items-baseline justify-between gap-4 border-y border-line py-4">
            <span className="text-base font-medium text-fg">{sandbox ? "Amount (sandbox, not charged)" : "Amount"}</span>
            <span className="text-2xl font-semibold text-fg nums" data-testid="payment-amount">
              {total}
            </span>
          </p>
        )}

        {!isPayable(status) ? (
          <PaymentOutcome
            status={status}
            sandbox={sandbox}
            actions={
              continueTo ? (
                <Button href={continueTo} data-testid="payment-continue">
                  Continue
                </Button>
              ) : undefined
            }
          />
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
            showNotice={showSandboxNotice}
          />
        ) : payment.clientSecret ? (
          <StripePaymentForm
            clientSecret={payment.clientSecret}
            publishableKey={payment.publishableKey}
            connectedAccountId={payment.connectedAccountId}
            returnUrl={target ? withResult(target, payment.paymentId) : null}
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
