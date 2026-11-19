import { CopyButton, cn } from "@/components/ui";
import { shortHash } from "../display";

export interface HashValueProps {
  value: string;
  /** What the value is, for the copy button's accessible name: "SHA-256 of synthetic-w2.pdf". */
  label: string;
  className?: string;
}

/** A long hash or identifier, shortened to scan, with the full value in its tooltip and a copy button. */
export function HashValue({ value, label, className }: HashValueProps) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}>
      <code title={value} className="truncate font-mono text-xs text-fg-muted">
        {shortHash(value)}
      </code>
      <CopyButton value={value} iconOnly variant="ghost" size="sm" label={`Copy ${label}`} />
    </span>
  );
}
