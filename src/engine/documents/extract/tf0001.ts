/**
 * Texas HHSC Form TF0001, "Notice of Case Action" (reference B4-B9, P2).
 *
 * Only the decision region is evidence: the text between "Notice about your case:" and the first of
 * "Other help you can get and your rights:" / "Your right to appeal:". The boilerplate pages of a
 * Medicaid-only notice mention SNAP and "can't get"; reading them would mislabel the notice (P2).
 *
 * Tables are rebuilt from item coordinates: one row per line that has a name cell and another cell; date
 * fragments printed above and below a row (the verified sample splits a date range that way, SRC TF L21-23)
 * join the nearest row. The SNAP and TANF headings are not verified (B5), so an approved SNAP or TANF row is
 * `layout_unverified` unless the policy flag `tf0001SnapTanf` is on.
 */
import { parseDocumentDate } from "../dates";
import { maskIdentifier } from "../redact";
import { flat, type LineRef, type TextItem } from "../text";
import type { ApprovalStatus, BenefitProgram, IsoDate, LookAlikeProgram } from "../types";
import { finishAward, mapProgramText, readLetterDate, recordNegativeWording } from "./award-common";
import { CONF_POSITIONAL, CONF_VERIFIED, ExtractionBuilder, findAddressee, isPlausibleName, type ExtractContext } from "./common";
import type { Extraction } from "../types";

const REGION_START = /Notice about your case:/i;
const REGION_END = /Other help you can get and your rights:|Your right to appeal:/i;
const TABLE_TITLE = /^Who (gets|can't get|cannot get|can not get)\s+(.+)$/i;

/** Negative wording inside the decision region (B4, B7, B10). Recorded as signals; tables decide. */
const NEGATIVE = [
  /Who can't get/i,
  /You are not eligible for benefits/i,
  /has not shown that they are either a citizen or a non-citizen who is qualified to receive benefits/i,
  /The income a person gets is more than allowed for this program/i,
  /did not provide proof showing that they live in Texas/i,
  /\bdenied\b/i,
  /\bterminated\b/i,
  /\blowered\b/i,
  /will not be eligible for/i,
  /did not give us the information we needed or did not keep your appointment/i,
];

interface Row {
  name: string;
  programText: string | null;
  dateFragments: Array<{ y: number; text: string }>;
  y: number;
  ref: LineRef;
}

interface Table {
  status: "gets" | "cant_get";
  title: string;
  section: string | null;
  columns: { name: number; edg: number | null; program: number | null; date: number | null } | null;
  rows: Row[];
  /** Date-only lines (the halves of a range printed above and below a row); joined to the nearest row. */
  fragments: Array<{ y: number; text: string }>;
  ref: LineRef;
}

interface ParsedRow {
  table: Table;
  row: Row;
  program: BenefitProgram | null;
  lookAlike: LookAlikeProgram | null;
  oneTimeTanf: boolean;
  start: IsoDate | null;
  end: IsoDate | null;
  dateProblem: "ambiguous" | "invalid" | null;
}

function columnOf(item: TextItem, cols: NonNullable<Table["columns"]>): keyof NonNullable<Table["columns"]> | null {
  let best: keyof NonNullable<Table["columns"]> | null = null;
  let bestDist = Infinity;
  for (const key of ["name", "edg", "program", "date"] as const) {
    const x = cols[key];
    if (x === null) continue;
    const d = Math.abs(item.x - x);
    if (d < bestDist) {
      best = key;
      bestDist = d;
    }
  }
  return bestDist <= 45 ? best : null;
}

function parseTables(region: LineRef[]): { tables: Table[]; reasonText: string; notesText: string } {
  const tables: Table[] = [];
  let section: string | null = null;
  let table: Table | null = null;
  let mode: "none" | "reason" | "notes" = "none";
  let reasonText = "";
  let notesText = "";

  for (const ref of region) {
    const text = ref.line.text.trim();
    const title = TABLE_TITLE.exec(text);
    if (title) {
      table = {
        status: /^gets$/i.test(title[1]) ? "gets" : "cant_get",
        title: title[2].trim(),
        section,
        columns: null,
        rows: [],
        fragments: [],
        ref,
      };
      tables.push(table);
      mode = "none";
      continue;
    }
    if (/^Reason:/i.test(text)) {
      mode = "reason";
      reasonText += ` ${text.replace(/^Reason:\s*/i, "")}`;
      continue;
    }
    if (/^Notes:/i.test(text)) {
      mode = "notes";
      notesText += ` ${text.replace(/^Notes:\s*/i, "")}`;
      continue;
    }
    if (table && !table.columns) {
      const items = ref.line.items;
      const find = (re: RegExp) => items.find((it) => re.test(it.text.trim()))?.x ?? null;
      const name = find(/^Name$/i);
      if (name !== null && find(/^Program$/i) !== null) {
        table.columns = { name, edg: find(/^EDG number$/i), program: find(/^Program$/i), date: find(/^Date$/i) };
        continue;
      }
    }
    if (table?.columns && mode === "none") {
      const cells: Partial<Record<"name" | "edg" | "program" | "date", string>> = {};
      let stray = false;
      for (const it of ref.line.items) {
        const col = columnOf(it, table.columns);
        if (!col) stray = true;
        else cells[col] = cells[col] ? `${cells[col]} ${it.text}` : it.text;
      }
      const otherCells = (cells.program ? 1 : 0) + (cells.date ? 1 : 0) + (cells.edg ? 1 : 0);
      if (!stray && cells.name && otherCells > 0 && isPlausibleName(cells.name)) {
        const row: Row = { name: cells.name.trim(), programText: cells.program?.trim() ?? null, dateFragments: [], y: ref.line.y, ref };
        if (cells.date) row.dateFragments.push({ y: ref.line.y, text: cells.date });
        table.rows.push(row);
        continue;
      }
      if (!stray && !cells.name && cells.date && otherCells === 1) {
        table.fragments.push({ y: ref.line.y, text: cells.date });
        continue;
      }
    }
    if (mode === "reason") {
      reasonText += ` ${text}`;
      continue;
    }
    if (mode === "notes") {
      notesText += ` ${text}`;
      continue;
    }
    // Anything else is a section heading (e.g. "SNAP Food Benefits", "Health Care Benefits").
    section = text;
    table = null;
  }
  for (const t of tables) {
    for (const f of t.fragments) {
      let best: Row | null = null;
      for (const r of t.rows) if (!best || Math.abs(r.y - f.y) < Math.abs(best.y - f.y)) best = r;
      if (best && Math.abs(best.y - f.y) <= MAX_FRAGMENT_DISTANCE) best.dateFragments.push(f);
    }
  }
  return { tables, reasonText: reasonText.trim(), notesText: notesText.trim() };
}

/** Farthest a date fragment may sit from its row's baseline (points; plain text rows are 1 apart). */
const MAX_FRAGMENT_DISTANCE = 18;

function parseRow(table: Table, row: Row): ParsedRow {
  const program = mapProgramText(row.programText ?? "") ?? mapProgramText(table.title) ?? mapProgramText(table.section ?? "");
  const dateText = row.dateFragments
    .sort((a, b) => b.y - a.y)
    .map((f) => f.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  let start: IsoDate | null = null;
  let end: IsoDate | null = null;
  let dateProblem: ParsedRow["dateProblem"] = null;
  if (dateText) {
    const [a, b] = dateText.split(/\s*-\s*(?=\d)|\s+-\s*$/).map((s) => s.trim()).filter(Boolean);
    const pa = a ? parseDocumentDate(a) : null;
    const pb = b ? parseDocumentDate(b) : null;
    if (pa && !pa.ok) dateProblem = pa.reason === "ambiguous" ? "ambiguous" : "invalid";
    if (pb && !pb.ok) dateProblem = pb.reason === "ambiguous" ? "ambiguous" : "invalid";
    start = pa?.ok ? pa.date : null;
    end = pb?.ok ? pb.date : null;
  }
  return {
    table,
    row,
    program: program?.program ?? null,
    lookAlike: program?.lookAlike ?? null,
    oneTimeTanf: program?.oneTimeTanf ?? false,
    start,
    end,
    dateProblem,
  };
}

export function extractTf0001(ctx: ExtractContext): Extraction {
  const { doc, policy } = ctx;
  const b = new ExtractionBuilder("tx_hhsc_tf0001", policy);
  const agency = "Texas Health and Human Services Commission";

  const startRef = (() => {
    for (const page of doc.pages) {
      const index = page.lines.findIndex((l) => REGION_START.test(l.text));
      if (index >= 0) return { page, line: page.lines[index], index } satisfies LineRef;
    }
    return null;
  })();

  if (!startRef && doc.pages.some((p) => /Aviso sobre su caso/i.test(p.text))) {
    // B11: the Spanish TF0001 wording is not in the sources. Nothing is read; a person reads it.
    b.review("language_unsupported", "The notice is in Spanish; a person must read it.");
    return b.build(
      finishAward(b, {
        program: null,
        lookAlikeProgram: null,
        approvalStatus: "unclear",
        recipientName: null,
        householdMembers: [],
        benefitPeriod: null,
        caseNumberMasked: null,
        issuingAgency: agency,
      }),
      null,
    );
  }
  b.set("page_one_present", startRef !== null, CONF_VERIFIED, startRef);
  if (!startRef) {
    b.signal('the page carrying "Notice about your case:" is not in the upload');
    b.reject("not_a_decision", 'The decision page of the notice (the page that says "Notice about your case:") is missing; ask for page 1.');
    return b.build(
      finishAward(b, {
        program: null,
        lookAlikeProgram: null,
        approvalStatus: "unclear",
        recipientName: null,
        householdMembers: [],
        benefitPeriod: null,
        caseNumberMasked: null,
        issuingAgency: agency,
      }),
      null,
    );
  }

  // Header (above the decision region on the decision page).
  const headerRefs = startRef.page.lines.slice(0, startRef.index).map((line, index): LineRef => ({ page: startRef.page, line, index }));
  readLetterDate(ctx, b, /\bDate:/i, CONF_VERIFIED, headerRefs);
  let caseNumberMasked: string | null = null;
  for (const ref of headerRefs) {
    const m = /Case Number:\s*(\d{6,12})\b/i.exec(ref.line.text);
    if (m) {
      caseNumberMasked = maskIdentifier(m[1]);
      b.set("case_number_masked", caseNumberMasked, CONF_VERIFIED, ref);
      break;
    }
  }
  const addressee = findAddressee({ pages: [{ ...startRef.page, lines: startRef.page.lines.slice(0, startRef.index) }], source: doc.source });
  if (addressee) b.set("addressee_name", addressee.name, CONF_POSITIONAL, addressee.ref);

  // Decision region.
  const region: LineRef[] = [];
  outer: for (const page of doc.pages.filter((p) => p.number >= startRef.page.number)) {
    for (let index = page.number === startRef.page.number ? startRef.index + 1 : 0; index < page.lines.length; index++) {
      const line = page.lines[index];
      if (REGION_END.test(line.text)) break outer;
      if (/^Form\s+TF0001\b|^Page \d+ of \d+$|^\d{2}\/\d{4}$/i.test(line.text.trim())) continue;
      region.push({ page, line, index });
    }
  }
  const regionText = flat(region.map((r) => r.line.text).join(" "));
  const negative = recordNegativeWording(b, regionText, NEGATIVE);
  if (negative.some((n) => /lowered/i.test(n))) b.review("approval_unclear", "The notice says a benefit was lowered; the benefit continues, so a person must confirm.");

  const { tables, reasonText, notesText } = parseTables(region);
  if (reasonText) b.signal(`reason text present (${reasonText.length} characters)`);
  const parsed = tables.flatMap((t) => t.rows.map((r) => parseRow(t, r)));
  for (const t of tables) b.signal(`table "${t.status === "gets" ? "Who gets" : "Who can't get"} ${t.title}" with ${t.rows.length} row(s)`);
  if (parsed.some((p) => p.dateProblem === "ambiguous")) b.review("date_ambiguous", "A benefit date in the table can be read more than one way.");
  if (parsed.some((p) => p.dateProblem === "invalid")) b.review("field_missing", "A benefit date in the table is not a valid date.");

  const qualifying = parsed.filter((p) => p.program !== null);
  const reportedProgram: BenefitProgram | null =
    qualifying.find((p) => p.table.status === "gets")?.program ?? qualifying[0]?.program ?? null;

  let approvalStatus: ApprovalStatus = "unclear";
  let lookAlike: LookAlikeProgram | null = null;
  let members: ParsedRow[] = [];

  if (reportedProgram) {
    const gets = qualifying.filter((p) => p.program === reportedProgram && p.table.status === "gets");
    const cant = qualifying.filter((p) => p.program === reportedProgram && p.table.status === "cant_get");
    const otherApproved = [...new Set(qualifying.filter((p) => p.table.status === "gets" && p.program !== reportedProgram).map((p) => p.program))];
    for (const other of otherApproved) b.warn(`The notice also approves ${other}; only ${reportedProgram} is reported.`);
    if (gets.length > 0 && cant.length === 0) {
      approvalStatus = "approved";
      members = gets;
    } else if (gets.length > 0 && cant.length > 0) {
      const ends = cant.some((c) => gets.some((g) => g.row.name === c.row.name && c.start !== null && g.start !== null && c.start > g.start));
      approvalStatus = ends ? "terminated" : "unclear";
      members = gets;
      b.review("multiple_outcomes", `The notice both approves and ends ${reportedProgram} for the same household.`);
    } else {
      approvalStatus = /terminat|will (stop|end)|no longer/i.test(`${regionText} ${reasonText}`) ? "terminated" : "denied";
      members = cant;
      b.reject("denial_or_termination", `The notice says the household cannot get ${reportedProgram}.`);
    }
    if (qualifying.some((p) => p.oneTimeTanf)) b.review("program_needs_review", "One-Time TANF is not ongoing assistance; a person must decide whether it counts.");
  } else {
    const other = parsed.find((p) => p.lookAlike !== null);
    if (other) {
      lookAlike = other.lookAlike;
      const approvedOther = parsed.filter((p) => p.lookAlike === lookAlike && p.table.status === "gets");
      approvalStatus = approvedOther.length > 0 ? "approved" : "denied";
      members = approvedOther.length > 0 ? approvedOther : parsed.filter((p) => p.lookAlike === lookAlike);
      b.reject("program_not_listed", `The notice is about ${lookAlike === "CHIP" ? "CHIP" : "health care (Medicaid)"}, which is not one of the listed programs.`);
    } else {
      b.review("approval_unclear", "No benefit table could be read from the decision section of the notice.");
      b.review("layout_unverified", "The notice does not follow the verified TF0001 layout.");
    }
  }

  const first = members[0];
  if (reportedProgram || lookAlike) {
    const programRef = first?.row.ref ?? startRef;
    b.set("program", reportedProgram ?? lookAlike, CONF_VERIFIED, programRef);
    b.set("approval_status", approvalStatus, CONF_VERIFIED, first?.table.ref ?? startRef);
  }
  b.require("program", "approval_status");
  const names = [...new Set(members.map((m) => m.row.name))];
  names.forEach((n, i) => b.set(`household_member_${i + 1}`, n, CONF_VERIFIED, members.find((m) => m.row.name === n)!.row.ref));
  const recipient = addressee?.name ?? names[0] ?? null;
  if (addressee) b.set("recipient_name", addressee.name, CONF_POSITIONAL, addressee.ref);
  else if (first) b.set("recipient_name", first.row.name, CONF_VERIFIED, first.row.ref);
  b.require("recipient_name");

  const period = first ? { start: first.start, end: first.end } : null;
  if (first?.start) b.set("benefit_start", first.start, CONF_VERIFIED, first.row.ref);
  if (first?.end) b.set("benefit_end", first.end, CONF_VERIFIED, first.row.ref);

  // Amount location is unverified for SNAP/TANF (B5): read only an explicit "Monthly amount" note.
  const amount = /Monthly amount:\s*(\$?[\d,]+\.\d{2})/i.exec(notesText);
  if (amount) {
    const cents = Number(amount[1].replace(/[$,]/g, "").replace(".", ""));
    if (Number.isSafeInteger(cents)) b.set("monthly_amount_cents", cents, 0.75, null);
  }
  b.set("issuing_agency", agency, CONF_VERIFIED, null);

  if (approvalStatus === "approved" && reportedProgram && !policy.autoAcceptUnverifiedLayouts.tf0001SnapTanf) {
    b.review("layout_unverified", `The ${reportedProgram} section layout of the TF0001 has not been confirmed on a real notice; a person must confirm the pre-filled fields.`);
  }

  return b.build(
    finishAward(b, {
      program: reportedProgram,
      lookAlikeProgram: lookAlike,
      approvalStatus,
      recipientName: recipient,
      householdMembers: names,
      benefitPeriod: period,
      caseNumberMasked,
      issuingAgency: agency,
    }),
    null,
  );
}
