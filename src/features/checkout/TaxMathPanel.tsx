"use client";

import { Calculator, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Badge, cn, Disclosure, Money } from "@/components/ui";
import { CreditBanner } from "./CreditBanner";
import { groupPanelNotes, panelHeadline } from "./panel-layout";
import type { ClientPanel, CreditBanner as CreditBannerData } from "./view-model";

export interface TaxMathPanelProps {
  panel: ClientPanel;
  banner?: CreditBannerData;
  /** True while a save is recomputing the figures. */
  updating?: boolean;
  /**
   * When the body folds into a summary bar: "mobile" (default) below the lg breakpoint only, the full card beside
   * the form on wide screens; "always" for narrow surfaces such as the widget.
   */
  collapse?: "mobile" | "always";
  className?: string;
}

const ROLE_CLASS: Record<string, string> = {
  amount: "text-fg",
  addition: "text-fg",
  subtraction: "text-fg-muted",
  subtotal: "border-t border-line pt-2 font-medium text-fg",
  result: "border-t-2 border-fg pt-2 font-semibold text-fg",
  information: "text-fg-muted",
};

/**
 * The tax-math panel, compact: the figures that matter in large tabular type, the eligibility state, the preview and
 * proposed-rules labels, then the full breakdown and the remaining caveats behind disclosures. Every figure and
 * sentence is taxmath's (through the checkout view); this only lays them out. Nothing is left out of the page:
 * folded content stays in the DOM.
 */
export function TaxMathPanel({ panel, banner, updating, collapse = "mobile", className }: TaxMathPanelProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const headline = panelHeadline(panel);
  const notes = groupPanelNotes(panel.notes);
  const empty = panel.sections.length === 0;
  const bar = collapse === "always" ? "" : "lg:hidden";
  const hiddenUntilOpen = open ? "block" : collapse === "always" ? "hidden" : "hidden lg:block";

  return (
    <section
      id="tax-math-panel"
      aria-labelledby={`${bodyId}-title`}
      aria-busy={updating || undefined}
      data-testid="tax-math-panel"
      data-status={panel.status}
      data-collapse={collapse}
      className={cn("rounded-panel border border-line bg-surface shadow-sm", className)}
    >
      {/* The summary bar: the panel's title and the estimated credit, opening the rest. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className={cn("flex min-h-14 w-full items-center gap-3 rounded-panel px-4 py-2 text-left", bar)}
        data-testid="tax-math-panel-toggle"
      >
        <Calculator aria-hidden="true" className="size-5 shrink-0 text-brand-700" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{panel.title}</span>
          {banner ? <span className="block truncate text-xs text-fg-muted">{banner.title}</span> : null}
        </span>
        {headline.credit ? (
          <span className={cn("text-lg font-semibold text-fg transition-opacity", updating && "opacity-60")}>
            <Money cents={headline.credit.amountCents} showCents="auto" />
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" className={cn("size-5 shrink-0 text-fg-muted transition-transform", open && "rotate-180")} />
      </button>

      <div id={bodyId} className={cn("border-t border-line p-5", collapse === "mobile" && "max-lg:max-h-[70dvh] max-lg:overflow-y-auto lg:border-t-0", hiddenUntilOpen)}>
        <header className="flex items-start justify-between gap-3">
          <h2 id={`${bodyId}-title`} className="flex items-center gap-2 text-base font-semibold text-fg">
            <Calculator aria-hidden="true" className="size-5 text-brand-700" />
            {panel.title}
          </h2>
          <Badge tone="neutral" size="sm">
            Preview
          </Badge>
        </header>

        {banner ? <CreditBanner banner={banner} compact className="mt-4" /> : null}

        <div className={cn("mt-5 transition-opacity", updating && "opacity-60")} aria-live="polite">
          {empty ? (
            <p className="text-sm text-fg-muted" data-testid="tax-math-panel-empty">
              Enter the amount of your gift to see the figures.
            </p>
          ) : (
            <dl className="space-y-4" data-testid="tax-math-headline">
              {headline.credit ? (
                <div data-figure={headline.credit.id}>
                  <dt className="text-sm text-fg-muted">{headline.credit.label}</dt>
                  <dd className="mt-0.5 text-4xl leading-tight font-semibold tracking-tight text-fg">
                    <Money cents={headline.credit.amountCents} showCents="auto" />
                  </dd>
                </div>
              ) : null}
              {headline.designated ? (
                <div data-figure={headline.designated.id} className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
                  <dt className="min-w-0 text-sm text-fg-muted">{headline.designated.label}</dt>
                  <dd className="shrink-0 text-xl font-semibold text-fg">
                    <Money cents={headline.designated.amountCents} showCents="auto" />
                  </dd>
                </div>
              ) : null}
              {headline.notCreditable.map((f) => (
                <div key={f.id} data-figure={f.id} className="flex items-baseline justify-between gap-4">
                  <dt className="min-w-0 text-sm text-fg-muted">{f.label}</dt>
                  <dd className="shrink-0 text-base font-medium text-fg-muted">
                    <Money cents={f.amountCents} showCents="auto" />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {notes.visible.length > 0 ? (
          <ul className="mt-5 space-y-2 text-xs leading-5 text-fg-muted" data-testid="tax-math-labels">
            {notes.visible.map((note) => (
              <li key={note.id} data-copy-id={note.id}>
                {note.text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 divide-y divide-line border-t border-line" data-testid="tax-math-notes">
          {empty ? null : (
            <Disclosure variant="plain" summary="Full breakdown" className="py-2">
              <div className="space-y-4 pt-1">
                {panel.sections.map((section) => (
                  <div key={section.key} data-section={section.key}>
                    <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{section.heading}</h3>
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
                ))}
              </div>
            </Disclosure>
          )}
          {notes.groups.map((group) => (
            <Disclosure key={group.key} variant="plain" summary={group.title} className="py-2" id={`tax-math-notes-${group.key}`}>
              <ul className="space-y-2 pt-1 text-xs leading-5">
                {group.notes.map((note) => (
                  <li key={note.id} data-copy-id={note.id}>
                    {note.text}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))}
        </div>
      </div>
    </section>
  );
}
