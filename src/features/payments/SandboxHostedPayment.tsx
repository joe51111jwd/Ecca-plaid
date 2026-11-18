"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { PaymentStatus } from "@/db/schema";
import type { SandboxConfirmResult, SandboxPaymentView } from "@/server/payments";
import { PaymentOutcome } from "./PaymentOutcome";
import { SandboxPaymentForm } from "./SandboxPaymentForm";

export interface SandboxHostedPaymentProps {
  view: SandboxPaymentView;
  /** A same-origin path to continue to once the payment is complete or pending. Already validated by the page. */
  returnPath: string | null;
}

/** How often the hosted page asks the server whether a pending test payment has settled. */
const PENDING_REFRESH_MS = 2500;

const isPayable = (status: PaymentStatus): status is "requires_payment" | "failed" => status === "requires_payment" || status === "failed";

/**
 * The interactive part of the hosted sandbox pay page: the test-card form while the payment can be paid,
 * and afterwards where it stands. The page's server render is the source of truth; this component only
 * bridges the moment between an answer from the server action and the refreshed page.
 */
export function SandboxHostedPayment({ view, returnPath }: SandboxHostedPaymentProps) {
  const router = useRouter();
  const [submitted, setSubmitted] = useState<SandboxConfirmResult["status"] | null>(null);
  // Once the server-rendered status has moved past "payable", it wins over what the form last heard.
  const status: PaymentStatus = isPayable(view.status) && submitted && submitted !== "failed" ? submitted : view.status;

  const onResult = useCallback(
    (result: SandboxConfirmResult) => {
      setSubmitted(result.status);
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (status !== "processing") return;
    const timer = setInterval(() => router.refresh(), PENDING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [status, router]);

  if (isPayable(status)) {
    return (
      <SandboxPaymentForm
        paymentId={view.paymentId}
        clientSecret={view.clientSecret}
        amountCents={view.amountCents}
        testCards={view.testCards}
        testExpiry={view.testExpiry}
        lastFailure={view.failureReason}
        onResult={onResult}
        showNotice={false}
      />
    );
  }
  const continueTo = returnPath && (status === "succeeded" || status === "processing") ? `${returnPath}${returnPath.includes("?") ? "&" : "?"}${new URLSearchParams({ payment_id: view.paymentId, redirect_status: status })}` : null;
  return (
    <PaymentOutcome
      status={status}
      sandbox
      actions={
        continueTo ? (
          <Button href={continueTo} data-testid="sandbox-continue">
            Continue
          </Button>
        ) : undefined
      }
    />
  );
}
