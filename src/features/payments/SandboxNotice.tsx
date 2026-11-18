import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import { Banner, cn } from "@/components/ui";

/** The words that mark every sandbox payment surface. One constant, so the pages, the form and the tests agree. */
export const SANDBOX_HEADLINE = "Sandbox — no money moves";
export const SANDBOX_EXPLANATION = "This is a test payment. Nothing is charged and no real card or bank account is used.";

/** Full-width strip for the top of a sandbox page. */
export function SandboxBanner({ children }: { children?: ReactNode }) {
  return (
    <Banner tone="sandbox" className="py-3 text-base">
      <strong className="font-semibold tracking-wide uppercase" data-testid="sandbox-banner">
        {SANDBOX_HEADLINE}
      </strong>
      <span className="ml-2 font-normal">{children ?? SANDBOX_EXPLANATION}</span>
    </Banner>
  );
}

/** The same message as a block, for a sandbox form embedded in another page (which has its own page banner or none). */
export function SandboxNotice({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div role="note" className={cn("hatch rounded-card border-2 border-dashed border-caution-line bg-caution-surface p-4 text-caution-fg", className)}>
      <p className="flex items-center gap-2 text-base font-semibold tracking-wide uppercase" data-testid="sandbox-notice">
        <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
        {SANDBOX_HEADLINE}
      </p>
      <p className="mt-1 text-sm">{children ?? SANDBOX_EXPLANATION}</p>
    </div>
  );
}
