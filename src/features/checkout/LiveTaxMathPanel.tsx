"use client";

import { useCheckout } from "./CheckoutProvider";
import { TaxMathPanel, type TaxMathPanelProps } from "./TaxMathPanel";

export interface LiveTaxMathPanelProps {
  className?: string;
  /** Show the credit-eligibility state at the top of the panel. Default true. */
  withBanner?: boolean;
  collapse?: TaxMathPanelProps["collapse"];
}

/** The tax-math panel bound to the checkout in progress: it updates whenever a save returns a new view. */
export function LiveTaxMathPanel({ className, withBanner = true, collapse }: LiveTaxMathPanelProps) {
  const { view, saving } = useCheckout();
  return <TaxMathPanel panel={view.panel} banner={withBanner ? view.banner : undefined} updating={saving} collapse={collapse} className={className} />;
}
