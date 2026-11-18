import { formatUsd, type Cents } from "@/lib/money";
import { cn } from "./cn";

export interface MoneyProps {
  /** Integer cents. null/undefined renders the placeholder. */
  cents: Cents | null | undefined;
  /** `auto` (default) shows cents only when they are not zero; true always; false never (rounds for display only). */
  showCents?: boolean | "auto";
  /** `display` = large serif figure for the number a donor or family cares about most. */
  variant?: "text" | "display";
  /** Negative amounts (refunds) as "−$25.00". Positive amounts get a "+" only with `signed`. */
  signed?: boolean;
  /** Shown for null/undefined. Default an em dash. */
  placeholder?: string;
  className?: string;
}

/** A dollar amount from integer cents, in tabular figures so columns of money line up. */
export function Money({ cents, showCents = "auto", variant = "text", signed, placeholder = "—", className }: MoneyProps) {
  if (cents === null || cents === undefined) {
    return <span className={cn("text-fg-subtle", className)}>{placeholder}</span>;
  }
  const abs = Math.abs(cents);
  const text = formatUsd(showCents === false ? Math.round(abs / 100) * 100 : abs, showCents === "auto" ? {} : { cents: showCents });
  const sign = cents < 0 ? "−" : signed && cents > 0 ? "+" : "";
  return <span className={cn("whitespace-nowrap nums", variant === "display" && "font-display text-display-md tracking-tight sm:text-display-lg", className)}>{`${sign}${text}`}</span>;
}
