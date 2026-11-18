import type { ReactNode } from "react";
import { cn } from "./cn";

export interface StatProps {
  label: ReactNode;
  /** The figure. Pass `<Money cents=… />`, a count, or text. */
  value: ReactNode;
  /** One line under the figure: what it covers, a comparison, a caveat. */
  hint?: ReactNode;
  /** Sits beside the label: a ProvisionalBadge, a StatusBadge, a DefinitionTooltip. */
  badge?: ReactNode;
  /** `display` = serif figure for donor/family pages; `compact` = dashboard tiles. */
  variant?: "compact" | "display";
  className?: string;
}

/** One number with its label. Rendered as a definition (dt/dd), so put Stats inside StatGrid or a `<dl>`. */
export function Stat({ label, value, hint, badge, variant = "compact", className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg-muted">
        {label}
        {badge}
      </dt>
      <dd className="mt-1">
        <span className={cn("block text-fg nums", variant === "display" ? "font-display text-display-md sm:text-display-lg" : "text-2xl font-semibold tracking-tight")}>{value}</span>
        {hint ? <span className="mt-1 block text-sm text-fg-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}

const STAT_COLUMNS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" } as const;

export interface StatGridProps {
  columns?: keyof typeof STAT_COLUMNS;
  /** Draws each Stat in its own bordered tile (dashboard overview). Without it, Stats sit in an open row. */
  tiles?: boolean;
  className?: string;
  children: ReactNode;
}

/** The `<dl>` that lays out Stats. */
export function StatGrid({ columns = 3, tiles, className, children }: StatGridProps) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-6", STAT_COLUMNS[columns], tiles && "gap-4 *:rounded-card *:border *:border-line *:bg-surface *:p-5", className)}>{children}</dl>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Small note under the value. */
  hint?: ReactNode;
}

export interface KeyValueListProps {
  /** Either pass `items` or `<KeyValue>` children. */
  items?: KeyValueItem[];
  /**
   * `rows` (default): label left, value right, divided — detail panes.
   * `stacked`: label above value — narrow cards and phones.
   * `grid`: label above value in two or three columns — record summaries.
   */
  layout?: "rows" | "stacked" | "grid";
  columns?: 2 | 3;
  /** Tighter rows for dashboards. */
  dense?: boolean;
  className?: string;
  children?: ReactNode;
}

const KV_GRID = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" } as const;

/** Label/value facts about one record, as a real description list. */
export function KeyValueList({ items, layout = "rows", columns = 2, dense, className, children }: KeyValueListProps) {
  return (
    <dl
      data-layout={layout}
      data-dense={dense || undefined}
      className={cn(
        "group/kv text-sm",
        layout === "rows" && "divide-y divide-line",
        layout === "stacked" && (dense ? "space-y-3" : "space-y-4"),
        layout === "grid" && cn("grid grid-cols-1 gap-x-8", dense ? "gap-y-3" : "gap-y-5", KV_GRID[columns]),
        className,
      )}
    >
      {items?.map((item, index) => (
        <KeyValue key={index} label={item.label} hint={item.hint}>
          {item.value}
        </KeyValue>
      ))}
      {children}
    </dl>
  );
}

export interface KeyValueProps {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  /** The value. Empty values should render an em dash, not nothing. */
  children: ReactNode;
}

/** One row of a KeyValueList. */
export function KeyValue({ label, hint, className, children }: KeyValueProps) {
  return (
    <div
      className={cn(
        "min-w-0",
        "group-data-[layout=rows]/kv:grid group-data-[layout=rows]/kv:grid-cols-1 group-data-[layout=rows]/kv:gap-x-6 group-data-[layout=rows]/kv:gap-y-0.5 group-data-[layout=rows]/kv:py-3 group-data-[layout=rows]/kv:sm:grid-cols-[minmax(8rem,2fr)_3fr]",
        "group-data-[layout=rows]/kv:group-data-[dense=true]/kv:py-2",
        className,
      )}
    >
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 font-medium break-words text-fg group-data-[layout=grid]/kv:mt-1 group-data-[layout=stacked]/kv:mt-0.5">
        {children}
        {hint ? <span className="mt-0.5 block text-sm font-normal text-fg-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}
