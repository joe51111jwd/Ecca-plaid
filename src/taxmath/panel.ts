/**
 * Turns a `CreditPreview` into the exact words and figures the tax-math panel displays.
 *
 * `previewCredit` returns ids; this renders them from the copy registry, so a component only lays the result
 * out and a checkout session can store precisely what the donor saw (`checkout_sessions.preview`) together
 * with the copy version and registry hash.
 */
import { formatUsd } from "@/lib/money";
import type { Authority } from "./authority";
import { COPY_VERSION, copySha256, getCopy, renderCopyDynamic, type CopyId, type CopyLocale } from "./copy";
import type { CreditPreview, PreviewLine, PreviewLineId, PreviewLineRole, TaxpayerRole } from "./credit";

export interface PanelLine {
  id: PreviewLineId;
  copyId: CopyId;
  label: string;
  amountCents: number;
  /** The amount as US dollars, for example "$1,700" or "$1,234.56". */
  amount: string;
  role: PreviewLineRole;
}

export interface PanelSection {
  key: TaxpayerRole | "joint_total" | "liability";
  heading: string;
  lines: PanelLine[];
}

export interface PanelNote {
  id: CopyId;
  text: string;
  authority: Authority;
  citation: string;
}

export interface CreditPanel {
  title: string;
  status: CreditPreview["status"];
  sections: PanelSection[];
  /** The caveats, in display order. Show all of them. */
  notes: PanelNote[];
  locale: CopyLocale;
  taxmathVersion: string;
  copyVersion: string;
  /** Hash of the whole copy registry the text was rendered from. */
  copyRegistrySha256: string;
}

export function renderCreditPanel(preview: CreditPreview, options: { locale?: CopyLocale } = {}): CreditPanel {
  const locale = options.locale ?? "en";
  const text = (id: CopyId, vars: Record<string, string> = {}) => renderCopyDynamic(id, vars, { locale });
  const lines = (source: readonly PreviewLine[]): PanelLine[] =>
    source.map((line) => ({
      id: line.id,
      copyId: line.copyId,
      label: text(line.copyId),
      amountCents: line.amountCents,
      amount: formatUsd(line.amountCents),
      role: line.role,
    }));

  const sections: PanelSection[] = preview.taxpayers.map((taxpayer) => ({
    key: taxpayer.role,
    heading: taxpayer.label ?? text(taxpayer.headingCopyId),
    lines: lines(taxpayer.lines),
  }));
  if (preview.totalLines.length > 0) sections.push({ key: "joint_total", heading: text("panel.heading.joint_total"), lines: lines(preview.totalLines) });
  if (preview.liability) sections.push({ key: "liability", heading: text("panel.heading.liability"), lines: lines(preview.liability.lines) });

  return {
    title: text("panel.title"),
    status: preview.status,
    sections,
    notes: preview.notes.map((note) => {
      const entry = getCopy(note.id);
      return { id: note.id, text: text(note.id, note.vars), authority: entry.authority, citation: entry.citation };
    }),
    locale,
    taxmathVersion: preview.taxmathVersion,
    copyVersion: COPY_VERSION,
    copyRegistrySha256: copySha256(),
  };
}
