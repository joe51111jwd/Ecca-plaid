import { cn } from "./cn";

export interface ProgressBarProps {
  /** Completed amount, 0…max. Clamped. */
  value: number;
  max?: number;
  /** Accessible name: what is progressing. */
  label: string;
  tone?: "brand" | "success" | "danger";
  size?: "sm" | "md";
  className?: string;
}

const BAR_TONE = { brand: "bg-action", success: "bg-success-solid", danger: "bg-danger-solid" } as const;

/** Determinate progress (an upload, steps completed). For unknown duration use Spinner. */
export function ProgressBar({ value, max = 1, label, tone = "brand", size = "md", className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), safeMax);
  const percent = Math.round((clamped / safeMax) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("w-full overflow-hidden rounded-full bg-ink-200", size === "sm" ? "h-1.5" : "h-2", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-300", BAR_TONE[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}
