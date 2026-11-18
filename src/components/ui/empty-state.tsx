import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  /** A lucide icon element. Decorative. */
  icon?: ReactNode;
  title: ReactNode;
  /** What this place is for and what to do next, in one or two sentences. */
  description?: ReactNode;
  /** The one thing to do next (a Button), plus an optional secondary link. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** `sm` inside tables and cards; `md` for a whole page. */
  size?: "sm" | "md";
  /** Heading level of the title. Default h3. */
  level?: 2 | 3 | 4;
  className?: string;
}

/** What to show when a list is empty. Say why it is empty and offer the next step — never just "No data". */
export function EmptyState({ icon, title, description, action, secondaryAction, size = "md", level = 3, className }: EmptyStateProps) {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center text-center", size === "sm" ? "px-4 py-8" : "px-6 py-14", className)}>
      {icon ? (
        <span aria-hidden="true" className={cn("mb-4 inline-flex items-center justify-center rounded-full bg-sunken text-fg-muted", size === "sm" ? "size-10 [&>svg]:size-5" : "size-12 [&>svg]:size-6")}>
          {icon}
        </span>
      ) : null}
      <Heading className={cn("font-semibold text-fg", size === "sm" ? "text-sm" : "text-base")}>{title}</Heading>
      {description ? <p className="mt-1.5 text-sm text-fg-muted">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
