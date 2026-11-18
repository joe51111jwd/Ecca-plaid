import type { ReactNode } from "react";
import { Alert } from "@/components/ui";
import type { PaymentStatus } from "@/db/schema";

export interface PaymentOutcomeProps {
  status: Exclude<PaymentStatus, "requires_payment" | "failed">;
  /** Sandbox payments say so in every state. */
  sandbox: boolean;
  /** Buttons or links under the message ("Continue"). */
  actions?: ReactNode;
  className?: string;
}

const COPY: Record<PaymentOutcomeProps["status"], { tone: "success" | "info" | "neutral"; title: string; sandboxTitle: string; body: string; sandboxBody: string }> = {
  succeeded: {
    tone: "success",
    title: "Payment complete",
    sandboxTitle: "Sandbox payment complete",
    body: "Your payment went through.",
    sandboxBody: "The test payment went through. No money moved.",
  },
  processing: {
    tone: "info",
    title: "Payment pending",
    sandboxTitle: "Sandbox payment pending",
    body: "Your payment has started. Bank payments can take several business days to complete. There is nothing more you need to do right now.",
    sandboxBody: "The test payment is pending, the way a bank payment would be. The sandbox finishes it in a few seconds. No money moves.",
  },
  canceled: {
    tone: "neutral",
    title: "Payment canceled",
    sandboxTitle: "Sandbox payment canceled",
    body: "This payment was canceled and nothing was charged.",
    sandboxBody: "This test payment was canceled.",
  },
  refunded: {
    tone: "neutral",
    title: "Payment refunded",
    sandboxTitle: "Sandbox payment refunded",
    body: "This payment was refunded.",
    sandboxBody: "This test payment was refunded. No money moved.",
  },
};

/** Where a payment that can no longer be paid stands, in words. Announced politely when it replaces the form. */
export function PaymentOutcome({ status, sandbox, actions, className }: PaymentOutcomeProps) {
  const copy = COPY[status];
  return (
    <div data-testid="payment-outcome" data-status={status} className={className}>
      <Alert tone={copy.tone} role="status" title={sandbox ? copy.sandboxTitle : copy.title} actions={actions}>
        <p>{sandbox ? copy.sandboxBody : copy.body}</p>
      </Alert>
    </div>
  );
}
