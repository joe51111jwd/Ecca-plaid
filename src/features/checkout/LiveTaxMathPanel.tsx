"use client";

import { useCheckout } from "./CheckoutProvider";
import { TaxMathPanel } from "./TaxMathPanel";

/** The tax-math panel bound to the checkout in progress: it updates whenever a save returns a new view. */
export function LiveTaxMathPanel({ className, withBanner = false }: { className?: string; withBanner?: boolean }) {
  const { view, saving } = useCheckout();
  return <TaxMathPanel panel={view.panel} banner={withBanner ? view.banner : undefined} updating={saving} className={className} />;
}
