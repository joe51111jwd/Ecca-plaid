import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "caution";

/** Tinted surface + border + text for each tone. Shared by Badge, Alert, Banner, Stat and friends. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: "border-neutral-line bg-neutral-surface text-neutral-fg",
  brand: "border-brand-line bg-brand-surface text-brand-fg",
  info: "border-info-line bg-info-surface text-info-fg",
  success: "border-success-line bg-success-surface text-success-fg",
  warning: "border-warning-line bg-warning-surface text-warning-fg",
  danger: "border-danger-line bg-danger-surface text-danger-fg",
  caution: "border-dashed border-caution-line bg-caution-surface text-caution-fg",
};

export const TONE_SOLID: Record<Tone, string> = {
  neutral: "border-transparent bg-neutral-solid text-neutral-solid-fg",
  brand: "border-transparent bg-brand-solid text-brand-solid-fg",
  info: "border-transparent bg-info-solid text-info-solid-fg",
  success: "border-transparent bg-success-solid text-success-solid-fg",
  warning: "border-transparent bg-warning-solid text-warning-solid-fg",
  danger: "border-transparent bg-danger-solid text-danger-solid-fg",
  caution: "border-transparent bg-caution-solid text-caution-solid-fg",
};

export const TONE_OUTLINE: Record<Tone, string> = {
  neutral: "border-neutral-line bg-surface text-neutral-fg",
  brand: "border-brand-line bg-surface text-brand-fg",
  info: "border-info-line bg-surface text-info-fg",
  success: "border-success-line bg-surface text-success-fg",
  warning: "border-warning-line bg-surface text-warning-fg",
  danger: "border-danger-line bg-surface text-danger-fg",
  caution: "border-dashed border-caution-line bg-surface text-caution-fg",
};

export interface BadgeProps {
  tone?: Tone;
  variant?: "soft" | "solid" | "outline";
  size?: "sm" | "md";
  /** Decorative icon before the text. The text must carry the meaning on its own. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  title?: string;
}

/**
 * A short label: a count, a category, a mode. For the state of a domain record use StatusBadge, which
 * owns the wording, colour and icon of every status.
 */
export function Badge({ tone = "neutral", variant = "soft", size = "md", icon, className, children, title }: BadgeProps) {
  const palette = variant === "solid" ? TONE_SOLID : variant === "outline" ? TONE_OUTLINE : TONE_SOFT;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-px text-xs" : "px-2.5 py-0.5 text-[0.8125rem] leading-5",
        palette[tone],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className={cn("inline-flex shrink-0", size === "sm" ? "[&>svg]:size-3" : "[&>svg]:size-3.5")}>
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
