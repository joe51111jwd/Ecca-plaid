"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { FormError, SubmitButton } from "@/components/ui";
import { paySandboxInvoiceAction } from "./sandbox-actions";

export interface SandboxInvoicePayButtonProps {
  invoiceId: string;
  /** The invoice's sandbox secret (`SandboxInvoiceView.key`). */
  invoiceKey: string;
}

/** The "Mark paid (sandbox)" button on the hosted sandbox invoice. Pressing it reports the invoice as paid; no money moves. */
export function SandboxInvoicePayButton({ invoiceId, invoiceKey }: SandboxInvoicePayButtonProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(paySandboxInvoiceAction, null);

  useEffect(() => {
    // The page is rendered on the server: ask for it again so it shows the invoice as paid.
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-3" data-testid="sandbox-invoice-pay">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="key" value={invoiceKey} />
      <FormError state={state} title="The invoice could not be marked paid" />
      <SubmitButton size="lg" pending={pending} pendingText="Marking paid…">
        Mark paid (sandbox)
      </SubmitButton>
      <p className="text-sm text-fg-muted">Nothing is charged. This stands in for the business paying the invoice.</p>
    </form>
  );
}
