import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Disclosure } from "@/components/ui";
import type { CopyText } from "./view-model";

export interface WhyDisclosureProps {
  /** The registry's explanation, shown when opened. Nothing renders when empty. */
  items: readonly CopyText[];
  /** The toggle's words. Default "Why?". */
  summary?: ReactNode;
  className?: string;
}

/**
 * A long explanation under a field, folded behind a quiet "Why?" toggle. The words inside stay the registry's,
 * verbatim, and remain in the page (native details: searchable, readable by assistive technology when opened).
 */
export function WhyDisclosure({ items, summary = "Why?", className }: WhyDisclosureProps) {
  if (items.length === 0) return null;
  return (
    <Disclosure
      variant="plain"
      className={cn("text-sm", className)}
      summary={
        <span className="inline-flex items-center gap-1">
          <HelpCircle aria-hidden="true" className="size-3.5" />
          {summary}
        </span>
      }
    >
      <div className="space-y-2 border-l-2 border-line pl-3 leading-6">
        {items.map((c) => (
          <p key={c.id} data-copy-id={c.id}>
            {c.text}
          </p>
        ))}
      </div>
    </Disclosure>
  );
}
