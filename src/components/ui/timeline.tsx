import type { ReactNode } from "react";
import type { Tone } from "./badge";
import { cn } from "./cn";
import { DateTime } from "./date-time";
import type { DateTimeFormat } from "./date-format";

export interface TimelineItem {
  id: string;
  /** What happened, as a short sentence in the past tense: "Family submitted documents". */
  title: ReactNode;
  /** Detail under the title: the reason, the reviewer's note, the file name. */
  description?: ReactNode;
  at: Date | string | number;
  /** Who or what did it: "Maria Alvarez", "Reviewer · D. Okafor", "System". */
  actor?: ReactNode;
  tone?: Tone;
  /** A lucide icon element for the marker. Default: a dot. */
  icon?: ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  /** How to print each time. Default dateTime. */
  format?: DateTimeFormat;
  /** Needed when format is "relative". */
  now?: Date;
  /** Names the list for screen readers ("Verification history"). */
  label: string;
  className?: string;
}

const MARKER: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface text-fg-muted",
  brand: "border-brand-line bg-brand-surface text-brand-fg",
  info: "border-info-line bg-info-surface text-info-fg",
  success: "border-success-line bg-success-surface text-success-fg",
  warning: "border-warning-line bg-warning-surface text-warning-fg",
  danger: "border-danger-line bg-danger-surface text-danger-fg",
  caution: "border-dashed border-caution-line bg-caution-surface text-caution-fg",
};

/** An ordered history of events on one record, oldest or newest first as the caller sorts it. */
export function Timeline({ items, format = "dateTime", now, label, className }: TimelineProps) {
  return (
    <ol aria-label={label} className={cn("relative", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-6 last:pb-0">
          {index < items.length - 1 ? <span aria-hidden="true" className="absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2 bg-line" /> : null}
          <span aria-hidden="true" className={cn("relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border [&>svg]:size-3.5", MARKER[item.tone ?? "neutral"])}>
            {item.icon ?? <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-fg">{item.title}</p>
            {item.description ? <div className="mt-0.5 text-sm text-fg-muted">{item.description}</div> : null}
            <p className="mt-1 text-xs text-fg-muted">
              <DateTime value={item.at} format={format} now={now} />
              {item.actor ? <span> · {item.actor}</span> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
