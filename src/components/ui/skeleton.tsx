import { cn } from "./cn";

export interface SkeletonProps {
  /** `text` is one line of copy, `block` fills the box you size with className, `circle` is an avatar. */
  shape?: "text" | "block" | "circle";
  /** For `text`: how many lines to draw. The last line is shorter. */
  lines?: number;
  className?: string;
}

/** Placeholder for content that is loading. Decorative: pair the region with aria-busy or a Spinner label. */
export function Skeleton({ shape = "text", lines = 1, className }: SkeletonProps) {
  const base = "animate-shimmer bg-ink-200";
  if (shape === "circle") return <span aria-hidden="true" className={cn(base, "block size-10 rounded-full", className)} />;
  if (shape === "block") return <span aria-hidden="true" className={cn(base, "block h-24 w-full rounded-control", className)} />;
  return (
    <span aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span key={i} className={cn(base, "block h-4 rounded-sm", lines > 1 && i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}
