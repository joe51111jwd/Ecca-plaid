/**
 * How the compact tax-math panel arranges what the checkout view gives it: the few figures shown large, and the
 * caveats grouped behind disclosures. Pure and client-safe (types only from the server side). It never words or
 * computes anything: every label and sentence is the taxmath registry's, carried through the view; this only
 * decides where each one sits. Nothing is dropped: a caveat this file does not know goes into the first group.
 */
import type { CopyId } from "@/taxmath";
import type { ClientPanel, CopyText } from "./view-model";

/**
 * Caveats that stay in view, never behind a disclosure: the preview-not-tax-advice label, the proposed-rules label,
 * and the reasons a figure would not become a credit (a gift before the credit start, designating above the cap).
 * A product policy following the build spec's "label the panel as a preview" and "based on proposed regulations".
 */
export const ALWAYS_VISIBLE_NOTES: ReadonlySet<CopyId> = new Set<CopyId>(["note.preview_not_tax_advice", "note.proposed_rules_not_final", "note.before_credit_start", "note.over_cap_designation"]);

export type NoteGroupKey = "how" | "limits" | "keep";

export const NOTE_GROUP_TITLES: Readonly<Record<NoteGroupKey, string>> = {
  how: "How the credit works",
  limits: "Limits and carryforward",
  keep: "What to keep for your return",
};

const NOTE_GROUP_ORDER: readonly NoteGroupKey[] = ["how", "limits", "keep"];

/** Which disclosure a caveat sits in. Ids not listed fall into "how" (see groupPanelNotes). */
const NOTE_GROUP: Readonly<Partial<Record<CopyId, NoteGroupKey>>> = {
  "note.cap_is_annual_total": "limits",
  "note.liability_not_estimated": "limits",
  "note.liability_limit": "limits",
  "note.liability_estimate_basis": "limits",
  "note.carryforward": "limits",
  "note.carryforward_before_current": "limits",
  "note.carryforward_expired": "limits",
  "note.carryforward_expiring": "limits",
  "note.joint_combined_limit": "limits",
  "note.joint_carryforward_pool": "limits",
  "note.carried_forward_not_deductible": "limits",
  "note.what_to_keep": "keep",
  "note.claim_form": "keep",
  "note.claim_form_availability": "keep",
  "note.recordkeeping": "keep",
};

export interface GroupedNotes {
  /** Shown under the figures, always. */
  visible: CopyText[];
  /** Behind disclosures, in a fixed order; empty groups are left out. */
  groups: Array<{ key: NoteGroupKey; title: string; notes: CopyText[] }>;
}

/** Splits the panel's caveats into the always-visible ones and the grouped ones, keeping their order within each. */
export function groupPanelNotes(notes: readonly CopyText[]): GroupedNotes {
  const visible: CopyText[] = [];
  const byGroup: Record<NoteGroupKey, CopyText[]> = { how: [], limits: [], keep: [] };
  for (const note of notes) {
    if (ALWAYS_VISIBLE_NOTES.has(note.id)) visible.push(note);
    else byGroup[NOTE_GROUP[note.id] ?? "how"].push(note);
  }
  return {
    visible,
    groups: NOTE_GROUP_ORDER.filter((key) => byGroup[key].length > 0).map((key) => ({ key, title: NOTE_GROUP_TITLES[key], notes: byGroup[key] })),
  };
}

export interface PanelFigure {
  /** The preview line id the figure comes from. */
  id: string;
  /** The line's label, as the registry words it. */
  label: string;
  amountCents: number;
}

export interface PanelHeadline {
  /** Designated as a section 25F qualified contribution (both spouses' together on a joint gift). */
  designated: PanelFigure | null;
  /** The estimated federal credit: the joint total when there is one, otherwise the taxpayer's estimate. */
  credit: PanelFigure | null;
  /** Amounts that do not become credit (above the cap, not designated, offset by a State credit), when above zero. */
  notCreditable: PanelFigure[];
}

/** Preview lines that are money the credit does not cover, in the order they are listed. */
const NOT_CREDITABLE_LINES = ["over_cap", "non_designated", "state_credit_reduction"] as const;

const TAXPAYER_SECTION_EXCLUDED = new Set(["joint_total", "liability"]);

function sumLines(sections: ClientPanel["sections"], id: string): PanelFigure | null {
  let total = 0;
  let label: string | null = null;
  for (const section of sections) {
    if (TAXPAYER_SECTION_EXCLUDED.has(section.key)) continue;
    for (const line of section.lines) {
      if (line.id !== id) continue;
      total += line.amountCents;
      label ??= line.label;
    }
  }
  return label === null ? null : { id, label, amountCents: total };
}

/**
 * The two or three numbers that matter, read from the panel's own lines (never recomputed): each taxpayer's lines
 * are added up, which is how the joint total is formed too, and the joint total line is used when present.
 */
export function panelHeadline(panel: ClientPanel): PanelHeadline {
  const sections = panel.sections;
  const jointLine = sections.find((s) => s.key === "joint_total")?.lines.find((l) => l.id === "joint_total_credit");
  const credit = jointLine ? { id: jointLine.id, label: jointLine.label, amountCents: jointLine.amountCents } : sumLines(sections, "estimated_credit");
  const notCreditable = NOT_CREDITABLE_LINES.map((id) => sumLines(sections, id)).filter((f): f is PanelFigure => f !== null && f.amountCents > 0);
  return { designated: sumLines(sections, "designated"), credit, notCreditable };
}
