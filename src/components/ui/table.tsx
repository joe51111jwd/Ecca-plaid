import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TableColumn<T> {
  /** Stable id of the column; also the sort key. */
  key: string;
  header: ReactNode;
  /** Plain-text column name for the stacked layout. Defaults to `header` when that is a string. */
  label?: string;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Money, counts, dates: right-aligned tabular figures. */
  numeric?: boolean;
  /** The column that names the row. It becomes the card title when stacked and carries the row link. One per table. */
  primary?: boolean;
  sortable?: boolean;
  /** Leave this column out of the stacked (narrow) layout. */
  hideWhenStacked?: boolean;
  /** CSS width for the column, e.g. "12rem" or "30%". */
  width?: string;
  /** Allow the cell to wrap. Cells are single-line by default so rows scan. */
  wrap?: boolean;
}

export interface TableSort {
  key: string;
  direction: "asc" | "desc";
}

export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  /** Names the table for screen readers ("Verifications awaiting review"). Required. */
  caption: string;
  /** Show the caption above the table instead of keeping it for screen readers only. */
  showCaption?: boolean;
  /** Makes the whole row open this URL (through a link in the primary cell). Links and buttons in other cells still work. */
  rowHref?: (row: T) => string | null | undefined;
  /** The current sort, read from the URL by the page. */
  sort?: TableSort | null;
  /** URL-driven sorting (server pages): return the href for sorting by `key` in `direction`. */
  sortHref?: (key: string, direction: "asc" | "desc") => string;
  /** Callback sorting (client components). Use one of sortHref / onSort. */
  onSort?: (key: string, direction: "asc" | "desc") => void;
  /** Shown instead of rows when `rows` is empty. Pass an `<EmptyState>`. */
  empty?: ReactNode;
  /** `compact` for long operational lists. */
  density?: "comfortable" | "compact";
  /** Turn rows into stacked cards when the table's container is narrow (the header row, and with it sorting, is hidden there). Default true. */
  stack?: boolean;
  /** Highlights one row (the record open in a Drawer). */
  selectedKey?: string | null;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

function columnLabel<T>(column: TableColumn<T>): string {
  return column.label ?? (typeof column.header === "string" ? column.header : "");
}

/**
 * Data table: a real `<table>` when there is room, stacked cards when its container is narrow.
 * Put it in `<Card padding="none">`. Sorting and paging are URL-driven so the page stays a server component.
 */
export function Table<T>({ columns, rows, rowKey, caption, showCaption, rowHref, sort, sortHref, onSort, empty, density = "comfortable", stack = true, selectedKey, className }: TableProps<T>) {
  // The first and last cells line up with CardHeader / CardFooter padding (px-5 sm:px-6).
  const pad = cn(density === "compact" ? "px-3 py-2" : "px-4 py-3", "first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6");
  const hasRows = rows.length > 0;
  return (
    <div className={cn("ui-table-wrap", className)}>
      <div className="overflow-x-auto">
        <table role="table" data-stack={stack && hasRows ? "true" : "false"} className="ui-table w-full border-collapse text-left text-sm">
          <caption className={showCaption ? "px-4 py-3 text-left text-sm font-semibold text-fg" : "sr-only"}>{caption}</caption>
          <thead role="rowgroup">
            <tr role="row" className="border-b border-line bg-canvas">
              {columns.map((column) => {
                const active = sort && sort.key === column.key ? sort.direction : null;
                const next = active === "asc" ? "desc" : "asc";
                const align = column.align ?? (column.numeric ? "right" : "left");
                const SortIcon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ChevronsUpDown;
                const sortInner = (
                  <>
                    <span>{column.header}</span>
                    <SortIcon aria-hidden="true" className={cn("size-3.5 shrink-0", active ? "text-fg" : "text-fg-disabled group-hover/sort:text-fg-muted")} />
                  </>
                );
                const sortClasses = cn("group/sort -mx-1 inline-flex min-h-6 items-center gap-1 rounded-sm px-1 hover:text-fg", align === "right" && "flex-row-reverse", active && "text-fg");
                return (
                  <th
                    key={column.key}
                    role="columnheader"
                    scope="col"
                    aria-sort={column.sortable ? (active === "asc" ? "ascending" : active === "desc" ? "descending" : "none") : undefined}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(pad, "text-xs font-semibold whitespace-nowrap text-fg-muted", ALIGN[align])}
                  >
                    {column.sortable && sortHref ? (
                      <Link href={sortHref(column.key, next)} scroll={false} className={sortClasses}>
                        {sortInner}
                      </Link>
                    ) : column.sortable && onSort ? (
                      <button type="button" onClick={() => onSort(column.key, next)} className={sortClasses}>
                        {sortInner}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {hasRows ? (
              rows.map((row, index) => {
                const key = rowKey(row, index);
                const href = rowHref?.(row) ?? null;
                return (
                  <tr
                    key={key}
                    role="row"
                    aria-current={selectedKey === key ? "true" : undefined}
                    className={cn("border-b border-line last:border-b-0", href && "relative", selectedKey === key ? "bg-brand-surface" : href && "hover:bg-canvas")}
                  >
                    {columns.map((column) => {
                      const align = column.align ?? (column.numeric ? "right" : "left");
                      const content = column.cell(row, index);
                      return (
                        <td
                          key={column.key}
                          role="cell"
                          data-label={columnLabel(column)}
                          data-primary={column.primary ? "true" : undefined}
                          data-mobile={column.hideWhenStacked ? "hidden" : undefined}
                          className={cn(
                            pad,
                            "align-middle text-fg",
                            ALIGN[align],
                            column.numeric && "nums",
                            !column.wrap && "whitespace-nowrap *:flex-nowrap",
                            column.primary && "font-medium",
                            // Links and buttons in ordinary cells sit above the row-wide link.
                            href && !column.primary && "[&_a]:relative [&_a]:z-raised [&_button]:relative [&_button]:z-raised",
                          )}
                        >
                          {column.primary && href ? (
                            <Link href={href} className="rounded-sm after:absolute after:inset-0 hover:underline focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus">
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr role="row">
                <td role="cell" colSpan={columns.length} className="p-0">
                  {empty ?? <p className="px-4 py-10 text-center text-sm text-fg-muted">Nothing to show.</p>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
