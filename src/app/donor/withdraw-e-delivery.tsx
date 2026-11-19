"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { withdrawEDeliveryAction } from "./actions";

/** "Mail it instead": withdraws consent to electronic delivery of one organization's acknowledgment. */
export function WithdrawEDeliveryButton({ consentId }: { consentId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(withdrawEDeliveryAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="consentId" value={consentId} />
      <Button type="submit" size="sm" variant="secondary" loading={pending} loadingText="Saving…">
        Mail my acknowledgment instead
      </Button>
      {state && !state.ok ? (
        <p role="alert" className="text-sm font-medium text-danger-fg">
          {state.error.message}
        </p>
      ) : null}
    </form>
  );
}
