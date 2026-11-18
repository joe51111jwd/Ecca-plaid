import { cn } from "./cn";
import { formatDateTime, formatFullTimestamp, isDateOnly, toDate, type DateTimeFormat, type DateTimeOptions } from "./date-format";

export interface DateTimeProps extends DateTimeOptions {
  /** A Date, an ISO timestamp, epoch milliseconds, or a date-only string ("2026-05-01"). */
  value: Date | string | number | null | undefined;
  /** Default `date`. `relative` needs `now` (from `now()` in src/lib/clock) and falls back to `date` without it. */
  format?: DateTimeFormat;
  /** Shown for a missing or invalid value. Default an em dash. */
  placeholder?: string;
  className?: string;
}

/**
 * A date or time, formatted one way everywhere, in a `<time>` element whose tooltip is the full timestamp.
 * Times are shown in US Central unless `timeZone` is given, so server and browser output always match.
 */
export function DateTime({ value, format = "date", placeholder = "—", className, ...opts }: DateTimeProps) {
  const text = formatDateTime(value, format, opts);
  if (!text) return <span className={cn("text-fg-subtle", className)}>{placeholder}</span>;
  const machine = isDateOnly(value) ? value : toDate(value)?.toISOString();
  return (
    <time dateTime={machine} title={formatFullTimestamp(value, opts)} className={cn("whitespace-nowrap nums", className)}>
      {text}
    </time>
  );
}
