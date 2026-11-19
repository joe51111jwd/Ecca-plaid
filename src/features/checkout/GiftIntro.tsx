"use client";

import { useActionState, useRef } from "react";
import { Alert, Button, Field, MoneyInput } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { startGiftAction } from "./actions";

export interface GiftIntroProps {
  slug: string;
  surface: "hosted" | "widget";
  /** False when the organization cannot take a gift right now (shown as such by the page). */
  canStart: boolean;
}

/**
 * The first step: the amount, then "Start your gift" creates the checkout on the server (a POST, never a page
 * load, so a prefetch or a crawler cannot create checkouts).
 */
export function GiftIntro({ slug, surface, canStart }: GiftIntroProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(startGiftAction, null);
  const tz = useRef<HTMLInputElement>(null);
  const fieldError = state && !state.ok ? (state.error.fields?.giftCents ?? null) : null;
  const formError = state && !state.ok && !fieldError ? state.error.message : null;
  return (
    <form
      action={action}
      className="space-y-5"
      data-testid="gift-intro"
      onSubmit={() => {
        if (tz.current) {
          try {
            tz.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
          } catch {
            tz.current.value = "";
          }
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="surface" value={surface} />
      <input type="hidden" name="donorTimeZone" ref={tz} defaultValue="" />
      <Field label="Gift amount" hint="You can change it on the next step." error={fieldError}>
        <MoneyInput name="giftCents" size="lg" disabled={!canStart} data-testid="intro-amount" />
      </Field>
      {formError ? (
        <Alert tone="danger" role="alert">
          <p>{formError}</p>
        </Alert>
      ) : null}
      <Button type="submit" size="lg" fullWidth loading={pending} loadingText="Starting…" disabled={!canStart} data-testid="start-gift">
        Start your gift
      </Button>
    </form>
  );
}
