import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./badge";
import { cn } from "./cn";
import type { UiLocale } from "./locale";
import { ProvisionalBadge } from "./provisional";
import { statusLabel, statusSpec, type StatusKind, type StatusKinds } from "./status-map";

type StatusPair = { [K in StatusKind]: { kind: K; status: StatusKinds[K] } }[StatusKind];

export type StatusBadgeProps = StatusPair & {
  size?: "sm" | "md";
  /** Spanish labels exist for the kinds families see (verification, stage, document, rail, award, handoff, mode). */
  locale?: UiLocale;
  /** Replace the wording (the colour and icon stay). */
  label?: ReactNode;
  /** Hide the icon in very dense tables. The label always stays. */
  showIcon?: boolean;
  /**
   * Set from `verification.provisional`: appends the Provisional marker to a decided result.
   * Every surface that shows an eligible/ineligible result while the threshold is HUD-derived must pass it.
   */
  provisional?: boolean;
  className?: string;
};

/**
 * The single source of wording, colour and icon for every status in the data model.
 * `<StatusBadge kind="verification" status={v.status} provisional={v.provisional} />`
 * The kind/status pair is type-checked; an unknown value at runtime renders neutrally instead of crashing.
 */
export function StatusBadge({ kind, status, size = "md", locale = "en", label, showIcon = true, provisional, className }: StatusBadgeProps) {
  const spec = statusSpec(kind, status);
  const Icon = spec?.icon ?? CircleHelp;
  const badge = (
    <Badge tone={spec?.tone ?? "neutral"} size={size} icon={showIcon ? <Icon /> : undefined} title={spec?.description} className={provisional ? undefined : className}>
      {label ?? statusLabel(kind, status, locale)}
    </Badge>
  );
  if (!provisional) return badge;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {badge}
      <ProvisionalBadge size={size} locale={locale} />
    </span>
  );
}
