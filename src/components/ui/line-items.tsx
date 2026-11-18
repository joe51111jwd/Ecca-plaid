import type { ReactNode } from "react";
import type { Cents } from "@/lib/money";
import { cn } from "./cn";
import { Money } from "./money";

export interface LineItem {
  label: ReactNode;
  /** Integer cents. Negative for credits and refunds. */
  amountCents: Cents | null;
  /** Plain-language note under the label (what the line is, why it is separate). */
  hint?: ReactNode;
  /** A Badge beside the label, e.g. "Not part of your contribution". */
  badge?: ReactNode;
  /** `muted` for lines that explain but do not add up (previews, already-paid amounts). */
  emphasis?: "normal" | "muted";
}

export interface LineItemsProps {
  items: LineItem[];
  /** The summed row, visually separated. Supply the total yourself (computed in cents by the service). */
  total?: { label: ReactNode; amountCents: Cents | null; hint?: ReactNode };
  /** Always show cents (receipts, invoices). Default: only when a line has cents. */
  showCents?: boolean | "auto";
  /** Accessible caption for the list. */
  label?: string;
  className?: string;
}

/**
 * Lines of money that add up: a gift and its separate fee, an invoice, a receipt.
 * Each amount is its own line by construction — a platform fee is never folded into the designated amount.
 */
export function LineItems({ items, total, showCents = "auto", label, className }: LineItemsProps) {
  return (
    <dl aria-label={label} className={cn("text-sm", className)}>
      {items.map((item, index) => (
        <div key={index} className={cn("flex items-start justify-between gap-6 py-2.5", index > 0 && "border-t border-line")}>
          <dt className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className={cn(item.emphasis === "muted" ? "text-fg-muted" : "text-fg")}>{item.label}</span>
              {item.badge}
            </span>
            {item.hint ? <span className="mt-0.5 block text-fg-muted">{item.hint}</span> : null}
          </dt>
          <dd className={cn("shrink-0 font-medium", item.emphasis === "muted" ? "text-fg-muted" : "text-fg")}>
            <Money cents={item.amountCents} showCents={showCents} />
          </dd>
        </div>
      ))}
      {total ? (
        <div className="flex items-start justify-between gap-6 border-t-2 border-fg pt-3 pb-1">
          <dt className="min-w-0">
            <span className="text-base font-semibold text-fg">{total.label}</span>
            {total.hint ? <span className="mt-0.5 block text-fg-muted">{total.hint}</span> : null}
          </dt>
          <dd className="shrink-0 text-base font-semibold text-fg">
            <Money cents={total.amountCents} showCents={showCents} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
