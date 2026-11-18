import { cn } from "./cn";

const SIZE = { sm: "size-4", md: "size-5", lg: "size-8" } as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE;
  /** Announced to screen readers. Omit when the spinner sits next to visible text that already says what is happening. */
  label?: string;
  className?: string;
}

/** Indeterminate activity indicator. Inherits the text colour. */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const svg = (
    <svg className={cn("ui-spinner animate-spin", SIZE[size], !label && className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-fg-muted", className)}>
      {svg}
      <span>{label}</span>
    </span>
  );
}
