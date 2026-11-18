import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DisclosureProps {
  /** The always-visible line. A question or a plain label ("What counts as income?"). */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Give several Disclosures the same name to make them exclusive (opening one closes the others). */
  name?: string;
  /** `plain` = a quiet link-like toggle inside text; `card` = a bordered row. */
  variant?: "plain" | "card";
  className?: string;
  id?: string;
}

/** Show/hide secondary detail. Native `<details>`: works without script, searchable in-page, keyboard-ready. */
export function Disclosure({ summary, children, defaultOpen, name, variant = "card", className, id }: DisclosureProps) {
  return (
    <details id={id} name={name} open={defaultOpen} className={cn("group/disclosure", variant === "card" && "rounded-card border border-line bg-surface", className)}>
      <summary
        className={cn(
          "flex items-center justify-between gap-3 font-medium text-fg",
          variant === "card" ? "min-h-12 rounded-card px-4 py-3 text-base hover:bg-canvas" : "inline-flex min-h-6 justify-start gap-1.5 rounded-sm text-sm text-link hover:text-link-hover in-data-[density=touch]:min-h-11 pointer-coarse:min-h-11",
        )}
      >
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted transition-transform group-open/disclosure:rotate-180" />
      </summary>
      <div className={cn("text-sm text-fg-muted", variant === "card" ? "border-t border-line px-4 py-4" : "mt-2")}>{children}</div>
    </details>
  );
}

export interface AccordionItem {
  id: string;
  title: ReactNode;
  content: ReactNode;
  defaultOpen?: boolean;
}

export interface AccordionProps {
  items: AccordionItem[];
  /** Only one item open at a time. Needs a `name` unique on the page. */
  exclusive?: boolean;
  name?: string;
  className?: string;
}

/** A stack of Disclosures in one bordered list — FAQs, "what you will need" lists. */
export function Accordion({ items, exclusive, name, className }: AccordionProps) {
  return (
    <div className={cn("divide-y divide-line rounded-card border border-line bg-surface", className)}>
      {items.map((item) => (
        <details key={item.id} id={item.id} name={exclusive ? (name ?? "accordion") : undefined} open={item.defaultOpen} className="group/disclosure">
          <summary className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-base font-medium text-fg hover:bg-canvas group-first/disclosure:rounded-t-card group-last/disclosure:not-group-open/disclosure:rounded-b-card">
            <span>{item.title}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted transition-transform group-open/disclosure:rotate-180" />
          </summary>
          <div className="px-4 pb-4 text-sm text-fg-muted">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
