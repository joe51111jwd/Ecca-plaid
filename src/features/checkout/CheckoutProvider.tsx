"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ClientPayment } from "@/server/payments";
import { placeOrderAction, saveCheckoutAction } from "./actions";
import { isEmptyPatch, mergePatch, patchPaths, withoutPaths, type Patch } from "./form-state";
import type { CheckoutClientView } from "./view-model";

/** What identifies the checkout to the server actions. The hosted page never sees its token (it is in an HttpOnly cookie). */
export type ClientAccess = { kind: "hosted"; slug: string } | { kind: "widget"; slug: string; token: string };

/** How long typing pauses before the form is saved and the panel recomputed. */
export const SAVE_DEBOUNCE_MS = 450;

interface CheckoutState {
  access: ClientAccess;
  view: CheckoutClientView;
  payment: ClientPayment | null;
  /** "payment" once an order has been placed and the donor has not gone back to change it. */
  stage: "form" | "payment";
  saving: boolean;
  placing: boolean;
  /** Rejections of typed values by field (shown at once). */
  rejected: Record<string, string>;
  /** A message about the whole form (network failure, expired checkout). */
  formError: string | null;
  touched: ReadonlySet<string>;
  showAll: boolean;
  /** A choice the donor just made, shown until the server's view (which may overrule it) arrives. */
  optimistic: (path: string, serverValue: boolean | string | null) => boolean | string | null;
  returnUrl: string;
  /** Queue part of the form for saving. `immediate` saves now (checkboxes, choices). */
  queue: (patch: Patch, options?: { immediate?: boolean }) => void;
  touch: (path: string) => void;
  /** Saves anything queued, then places the order. Returns false when the form still has problems. */
  placeOrder: () => Promise<boolean>;
  backToForm: () => void;
  revealAllErrors: () => void;
}

const CheckoutContext = createContext<CheckoutState | null>(null);

export function useCheckout(): CheckoutState {
  const value = useContext(CheckoutContext);
  if (!value) throw new Error("useCheckout must be used inside <CheckoutProvider>");
  return value;
}

export interface CheckoutProviderProps {
  access: ClientAccess;
  initialView: CheckoutClientView;
  initialPayment: ClientPayment | null;
  /** Where the payment form sends the donor afterwards (the confirmation page). */
  returnUrl: string;
  children: ReactNode;
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function CheckoutProvider({ access, initialView, initialPayment, returnUrl, children }: CheckoutProviderProps) {
  const [view, setView] = useState(initialView);
  const [payment, setPayment] = useState<ClientPayment | null>(initialPayment);
  const [stage, setStage] = useState<"form" | "payment">(initialView.status === "awaiting_payment" && initialPayment ? "payment" : "form");
  const [saving, setSaving] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [pendingChoices, setPendingChoices] = useState<Record<string, boolean | string | null>>({});

  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);
  const sentTimeZone = useRef(false);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    let patch = pending.current;
    pending.current = {};
    if (!sentTimeZone.current) {
      const tz = browserTimeZone();
      // The donor's own time zone decides the tax year of a gift near midnight on December 31.
      if (tz) patch = mergePatch({ donorTimeZone: tz }, patch);
    }
    if (isEmptyPatch(patch)) return true;
    const sentPaths = patchPaths(patch);
    const settle = () => setPendingChoices((prev) => withoutPaths(prev, sentPaths));
    inFlight.current += 1;
    setSaving(true);
    try {
      const result = await saveCheckoutAction(access, patch);
      if (result.ok) {
        sentTimeZone.current = true;
        setView(result.data);
        setRejected((prev) => withoutPaths(prev, patchPaths(patch)));
        setFormError(null);
        // A change voids a placed order (the service cancels its payment); the donor reviews again.
        if (result.data.status === "open") setPayment(null);
        return true;
      }
      if (result.error.fields) {
        const fields = result.error.fields;
        // A rejected time zone is not the donor's to fix: drop it and keep the rest of the form working.
        if (fields.donorTimeZone) sentTimeZone.current = true;
        setRejected((prev) => ({ ...withoutPaths(prev, patchPaths(patch)), ...fields }));
      } else {
        setFormError(result.error.message);
      }
      return false;
    } catch {
      setFormError("Your changes could not be saved. Check your connection and try again.");
      pending.current = mergePatch(patch, pending.current);
      return false;
    } finally {
      settle();
      inFlight.current -= 1;
      if (inFlight.current === 0) setSaving(false);
    }
  }, [access]);

  const queue = useCallback(
    (patch: Patch, options: { immediate?: boolean } = {}) => {
      pending.current = mergePatch(pending.current, patch);
      if (options.immediate) {
        const choices: Record<string, boolean | string | null> = {};
        const walk = (node: Patch, prefix: string) => {
          for (const [k, v] of Object.entries(node)) {
            const path = prefix ? `${prefix}.${k}` : k;
            if (v !== null && typeof v === "object") walk(v, path);
            else if (typeof v !== "number") choices[path] = v;
          }
        };
        walk(patch, "");
        setPendingChoices((prev) => ({ ...prev, ...choices }));
      }
      setTouched((prev) => {
        const next = new Set(prev);
        for (const path of patchPaths(patch)) next.add(path);
        return next;
      });
      if (stage === "payment") setStage("form");
      if (timer.current) clearTimeout(timer.current);
      if (options.immediate) void flush();
      else timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush, stage],
  );

  // Save what is queued when the donor leaves the page.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && !isEmptyPatch(pending.current)) void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  const touch = useCallback((path: string) => {
    setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
  }, []);

  const revealAllErrors = useCallback(() => setShowAll(true), []);

  const shownStatementSha256 = view.designation.statement?.textSha256 ?? null;
  const placeOrder = useCallback(async (): Promise<boolean> => {
    const saved = await flush();
    if (!saved) {
      setShowAll(true);
      return false;
    }
    setPlacing(true);
    try {
      const result = await placeOrderAction(access, shownStatementSha256);
      if (result.ok) {
        setView(result.data.view);
        setPayment(result.data.payment);
        setStage("payment");
        setFormError(null);
        return true;
      }
      setShowAll(true);
      if (result.error.fields) setRejected((prev) => ({ ...prev, ...result.error.fields }));
      setFormError(result.error.message);
      return false;
    } catch {
      setFormError("The order could not be placed. Check your connection and try again.");
      return false;
    } finally {
      setPlacing(false);
    }
  }, [access, flush, shownStatementSha256]);

  const backToForm = useCallback(() => setStage("form"), []);
  const optimistic = useCallback((path: string, serverValue: boolean | string | null) => (path in pendingChoices ? pendingChoices[path] : serverValue), [pendingChoices]);

  const value = useMemo<CheckoutState>(
    () => ({ access, view, payment, stage, saving, placing, rejected, formError, touched, showAll, optimistic, returnUrl, queue, touch, placeOrder, backToForm, revealAllErrors }),
    [access, view, payment, stage, saving, placing, rejected, formError, touched, showAll, optimistic, returnUrl, queue, touch, placeOrder, backToForm, revealAllErrors],
  );
  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
}
