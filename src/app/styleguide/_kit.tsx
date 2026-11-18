import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banner } from "@/components/ui/alert";
import { cn } from "@/components/ui/cn";
import { Logo } from "@/components/ui/logo";
import { Tabs } from "@/components/ui/tabs";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";

/** Shared by every style-guide page: it is internal documentation, not a public page. */
export const GUIDE_METADATA: Metadata = { robots: { index: false, follow: false } };

const GUIDE_TABS = [
  { href: "/styleguide", label: "Foundations", match: "exact" as const },
  { href: "/styleguide/components", label: "Components" },
  { href: "/styleguide/forms", label: "Forms" },
  { href: "/styleguide/shells", label: "Shells" },
];

/** Chrome of the style-guide pages (the full-page shell demos under /styleguide/shells/* do not use it). */
export function GuideChrome({ title, lead, toc, children }: { title: string; lead: ReactNode; toc?: Array<{ id: string; label: string }>; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <Banner tone="info">Style guide. Every person, organization and amount on these pages is fictional sample data.</Banner>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-page px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Logo href="/" size="sm" />
              <span className="border-l border-line pl-3 text-sm font-semibold text-fg-muted">Style guide</span>
            </div>
            <code className="rounded bg-sunken px-2 py-1 font-mono text-xs text-fg-muted">import {"{ … }"} from &quot;@/components/ui&quot;</code>
          </div>
          <Tabs items={GUIDE_TABS} label="Style guide sections" divider={false} className="mt-4" />
        </div>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto max-w-page px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="font-display text-display-sm text-fg sm:text-display-md">{title}</h1>
          <div className="mt-3 max-w-reading text-lg text-fg-muted">{lead}</div>
          {toc && toc.length > 0 ? (
            <nav aria-label="On this page" className="mt-6 rounded-card border border-line bg-surface p-4">
              <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">On this page</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <a href={`#${entry.id}`} className="inline-flex min-h-6 items-center rounded-sm text-sm text-link underline decoration-1 underline-offset-[3px] hover:text-link-hover">
                      {entry.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="mt-12 space-y-16">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** A named group of specimens ("Actions", "Status"). */
export function GuideSection({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <h2 id={`${id}-title`} className="font-display text-display-sm text-fg">
        {title}
      </h2>
      {lead ? <div className="mt-2 max-w-reading text-base text-fg-muted">{lead}</div> : null}
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  );
}

/** One component: its name, import line, when to use it, and every state rendered. */
export function Specimen({ id, name, importLine, note, children }: { id: string; name: string; importLine: string; note: ReactNode; children: ReactNode }) {
  return (
    <article id={id} aria-labelledby={`${id}-name`} className="scroll-mt-6 rounded-card border border-line bg-surface">
      <header className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={`${id}-name`} className="text-lg font-semibold text-fg">
            {name}
          </h3>
          <code className="font-mono text-xs break-all text-fg-muted">{importLine}</code>
        </div>
        <div className="mt-2 max-w-reading text-sm text-fg-muted">{note}</div>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </article>
  );
}

const EXAMPLE_SURFACE = {
  surface: "bg-surface",
  canvas: "bg-canvas",
  inverse: "bg-brand-900",
} as const;

/** One state of a component, with a caption saying which. */
export function Example({ label, children, surface = "surface", className, bleed }: { label: ReactNode; children: ReactNode; surface?: keyof typeof EXAMPLE_SURFACE; className?: string; bleed?: boolean }) {
  return (
    <div data-surface={surface === "inverse" ? "inverse" : undefined} className={cn("last:rounded-b-card", EXAMPLE_SURFACE[surface])}>
      <p className={cn("px-5 pt-4 text-xs font-semibold sm:px-6", surface === "inverse" ? "text-brand-200" : "text-fg-subtle")}>{label}</p>
      <div className={cn(bleed ? "pt-3" : "px-5 pt-3 pb-5 sm:px-6", className)}>{children}</div>
    </div>
  );
}

/** A horizontal row of small things (buttons, badges). */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)}>{children}</div>;
}

/** Paired guidance. Keep each line to one concrete instruction. */
export function DoDont({ dos, donts }: { dos: string[]; donts: string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-card border border-success-line bg-success-surface p-4">
        <p className="text-sm font-semibold text-success-fg">Do</p>
        <ul className="mt-2 space-y-2">
          {dos.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-fg">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-card border border-danger-line bg-danger-surface p-4">
        <p className="text-sm font-semibold text-danger-fg">Don’t</p>
        <ul className="mt-2 space-y-2">
          {donts.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-fg">
              <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Inline code in guide prose. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.8125em] text-fg">{children}</code>;
}
