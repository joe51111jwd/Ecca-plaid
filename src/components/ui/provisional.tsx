import { CircleDashed } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./badge";
import { cn } from "./cn";
import { uiStrings, type UiLocale } from "./locale";

export interface ProvisionalBadgeProps {
  size?: "sm" | "md";
  locale?: UiLocale;
  /** Replace the word "Provisional" (e.g. "Provisional list"). */
  children?: ReactNode;
  className?: string;
}

/**
 * The marker for anything that is not final: a HUD-derived income limit, a decision made with one, the
 * curated SGO list. Dashed border + hatch is reserved for this meaning across the product.
 */
export function ProvisionalBadge({ size = "md", locale = "en", children, className }: ProvisionalBadgeProps) {
  return (
    <Badge tone="caution" size={size} icon={<CircleDashed />} className={cn("hatch", className)}>
      {children ?? uiStrings(locale).provisional}
    </Badge>
  );
}

export interface ProvisionalNoticeProps {
  /** Default: "This income limit is provisional". */
  title?: ReactNode;
  /**
   * Replaces the default explanation, which is about HUD-derived income limits. For any other provisional
   * thing (the SGO list) pass the title and body from the owning copy module.
   */
  children?: ReactNode;
  /** Appended under the explanation: table version, effective date, a link to the source. */
  details?: ReactNode;
  locale?: UiLocale;
  /** One-line form for tight spots (under a figure, in a table footer). */
  compact?: boolean;
  className?: string;
}

/**
 * The explanation that accompanies a provisional number. Required wherever a threshold or a decision based
 * on the HUD-derived table is shown to anyone: family screen, dashboard, API docs, evidence views.
 */
export function ProvisionalNotice({ title, children, details, locale = "en", compact, className }: ProvisionalNoticeProps) {
  const t = uiStrings(locale);
  if (compact) {
    return (
      <p className={cn("flex items-start gap-2 text-sm text-caution-fg", className)}>
        <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="font-semibold">{title ?? t.provisional}.</strong> {children ?? t.provisionalBody}
          {details ? <> {details}</> : null}
        </span>
      </p>
    );
  }
  return (
    <div role="note" className={cn("hatch rounded-card border border-dashed border-caution-line bg-caution-surface p-4 text-caution-fg", className)}>
      <div className="flex items-start gap-3">
        <CircleDashed aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{title ?? t.provisionalTitle}</p>
          <div className="mt-1">{children ?? t.provisionalBody}</div>
          {details ? <div className="mt-2 text-caution-fg/90">{details}</div> : null}
        </div>
      </div>
    </div>
  );
}
