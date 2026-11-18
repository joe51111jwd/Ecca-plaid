import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { uiStrings, type UiLocale, type UiStrings } from "./locale";

export interface PaginationProps {
  /** Href of the previous page, or null/undefined on the first page (the button is shown disabled). */
  prevHref?: string | null;
  /** Href of the next page, or null/undefined on the last page. */
  nextHref?: string | null;
  /** What is on screen: "Showing 1–25 of 312", "25 verifications". */
  summary?: ReactNode;
  locale?: UiLocale;
  labels?: Partial<Pick<UiStrings, "previous" | "next">>;
  className?: string;
}

/** Cursor-style paging: previous / next links built by the page from its cursors. */
export function Pagination({ prevHref, nextHref, summary, locale = "en", labels, className }: PaginationProps) {
  const t = uiStrings(locale, labels);
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-sm text-fg-muted nums">{summary}</p>
      <div className="flex items-center gap-2">
        <Button href={prevHref ?? "#"} disabled={!prevHref} variant="secondary" size="sm" leadingIcon={<ChevronLeft />} scroll={false}>
          {t.previous}
        </Button>
        <Button href={nextHref ?? "#"} disabled={!nextHref} variant="secondary" size="sm" trailingIcon={<ChevronRight />} scroll={false}>
          {t.next}
        </Button>
      </div>
    </nav>
  );
}
