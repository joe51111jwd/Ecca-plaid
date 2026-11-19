import { Calculator } from "lucide-react";
import { Badge, cn, Money } from "@/components/ui";
import { CreditBanner } from "./CreditBanner";
import type { ClientPanel, CreditBanner as CreditBannerData } from "./view-model";

export interface TaxMathPanelProps {
  panel: ClientPanel;
  banner?: CreditBannerData;
  /** True while a save is recomputing the figures. */
  updating?: boolean;
  className?: string;
}

const ROLE_CLASS: Record<string, string> = {
  amount: "text-fg",
  addition: "text-fg",
  subtraction: "text-fg-muted",
  subtotal: "border-t border-line pt-2 font-medium text-fg",
  result: "border-t-2 border-fg pt-2 text-base font-semibold text-fg",
  information: "text-fg-muted",
};

/**
 * The tax-math panel: the figures from taxmath's preview and every caveat that applies, in the registry's
 * words. It never computes or words anything itself; an empty panel still carries the standing caveats.
 */
export function TaxMathPanel({ panel, banner, updating, className }: TaxMathPanelProps) {
  return (
    <section id="tax-math-panel" aria-labelledby="tax-math-panel-title" aria-busy={updating || undefined} data-testid="tax-math-panel" data-status={panel.status} className={cn("rounded-panel border border-line bg-surface p-5 shadow-sm", className)}>
      <header className="flex items-start justify-between gap-3">
        <h2 id="tax-math-panel-title" className="flex items-center gap-2 text-lg font-semibold text-fg">
          <Calculator aria-hidden="true" className="size-5 text-brand-700" />
          {panel.title}
        </h2>
        <Badge tone="neutral" size="sm">
          Preview
        </Badge>
      </header>

      {banner ? <CreditBanner banner={banner} compact className="mt-4" /> : null}

      <div className={cn("mt-4 space-y-5 transition-opacity", updating && "opacity-60")} aria-live="polite">
        {panel.sections.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="tax-math-panel-empty">
            Enter the amount of your gift to see the figures.
          </p>
        ) : (
          panel.sections.map((section) => (
            <div key={section.key} data-section={section.key}>
              <h3 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">{section.heading}</h3>
              <dl className="mt-2 space-y-2 text-sm">
                {section.lines.map((line) => (
                  <div key={line.id} data-line={line.id} className={cn("flex items-start justify-between gap-4", ROLE_CLASS[line.role] ?? "text-fg")}>
                    <dt className="min-w-0">{line.label}</dt>
                    <dd className="shrink-0 nums">
                      <Money cents={line.amountCents} showCents="auto" />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        )}
      </div>

      <ul className="mt-5 space-y-2 border-t border-line pt-4 text-xs leading-5 text-fg-muted" data-testid="tax-math-notes">
        {panel.notes.map((note) => (
          <li key={note.id} data-copy-id={note.id}>
            {note.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
