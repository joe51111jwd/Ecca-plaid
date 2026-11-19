import type { ReactNode } from "react";
import { Badge, CodeBlock, type Tone } from "@/components/ui";
import { renderCurl, type HttpSample } from "@/server/api";

/** Page title block of a docs page. */
export function DocsHeader({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: ReactNode }) {
  return (
    <header className="space-y-3 border-b border-line pb-8">
      <p className="font-mono text-xs font-semibold tracking-[0.08em] text-brand-700 uppercase">{eyebrow}</p>
      <h1 className="font-display text-display-md text-fg">{title}</h1>
      <div className="max-w-2xl text-lg text-fg-muted">{lead}</div>
    </header>
  );
}

/** A titled section with an anchor link target. */
export function DocsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-4">
      <h2 id={`${id}-title`} className="text-xl font-semibold text-fg">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
      </h2>
      <div className="space-y-4 leading-7 text-fg [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </section>
  );
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.8125rem] text-fg">{children}</code>;
}

const METHOD_TONE: Record<string, Tone> = { GET: "info", POST: "success", PATCH: "warning", DELETE: "danger" };

/** "POST /api/v1/verifications" as a compact label. */
export function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone={METHOD_TONE[method] ?? "neutral"} size="sm" className="font-mono">
        {method}
      </Badge>
      <code className="font-mono text-sm break-all text-fg">{path}</code>
    </span>
  );
}

/** One documented HTTP call: the curl command exactly as tests execute it. */
export function Sample({ sample, title }: { sample: HttpSample; title?: string }) {
  return <CodeBlock code={renderCurl(sample)} title={title ?? sample.title} language="bash" />;
}

export interface FieldRow {
  name: string;
  type: string;
  description: ReactNode;
}

/** A field-by-field reference table. */
export function FieldTable({ rows, caption }: { rows: FieldRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-canvas text-xs tracking-wide text-fg-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Field
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Type
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Meaning
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.name} className="align-top">
              <td className="px-4 py-3 font-mono text-[0.8125rem] whitespace-nowrap text-fg">{r.name}</td>
              <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-fg-muted">{r.type}</td>
              <td className="px-4 py-3 text-fg">{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A plain reference table with arbitrary columns. */
export function RefTable({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-canvas text-xs tracking-wide text-fg-muted uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "px-4 py-3 font-mono text-[0.8125rem] text-fg" : "px-4 py-3 text-fg"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Numbered step of a walkthrough. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative pl-12">
      <span aria-hidden="true" className="absolute top-0 left-0 inline-flex size-8 items-center justify-center rounded-full bg-brand-700 font-mono text-sm font-semibold text-white">
        {n}
      </span>
      <h3 className="pt-1 text-base font-semibold text-fg">{title}</h3>
      <div className="mt-3 space-y-4 leading-7 text-fg">{children}</div>
    </li>
  );
}
