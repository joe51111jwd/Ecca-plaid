import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { BRAND } from "@/lib/brand";
import { fill, LETTER_COPY } from "./letter-copy";
import type { LetterContent } from "./letter";

/**
 * Renders an acknowledgment letter (src/server/acknowledgments/letter.ts) as a formal US Letter PDF with pdf-lib.
 * Pure and deterministic: the same letter and issue time always give the same bytes (no clock, no random ids), so
 * the stored SHA-256 identifies the document. Only the standard Helvetica fonts are used; characters they cannot
 * print are transliterated (accents dropped) or shown as "?", never thrown on.
 */

export const ACKNOWLEDGMENT_PDF_RENDERER = `${BRAND.name.toLowerCase()}-acknowledgment-pdf/1`;

const PAGE = { width: 612, height: 792 };
const LEFT = 64;
const RIGHT = PAGE.width - 64;
const WIDTH = RIGHT - LEFT;
const TOP = PAGE.height - 64;
const BOTTOM = 72;
const INK = rgb(0.1, 0.11, 0.14);
const MUTED = rgb(0.38, 0.41, 0.46);
const RULE = rgb(0.8, 0.82, 0.85);
const PANEL = rgb(0.96, 0.965, 0.97);
const WATERMARK = rgb(0.9, 0.55, 0.55);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

class Encoder {
  private readonly supported: Set<number>;
  constructor(font: PDFFont) {
    this.supported = new Set(font.getCharacterSet());
  }
  encode(text: string): string {
    let out = "";
    for (const char of text) {
      const cp = char.codePointAt(0) ?? 0;
      if (cp >= 0x20 && cp !== 0x7f && this.supported.has(cp)) {
        out += char;
      } else if (/\s/u.test(char)) {
        out += " ";
      } else {
        const base = char.normalize("NFKD").replace(/\p{M}/gu, "");
        out += base && Array.from(base).every((c) => this.supported.has(c.codePointAt(0) ?? 0)) ? base : /^\p{M}$/u.test(char) ? "" : "?";
      }
    }
    return out;
  }
}

class Layout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = TOP;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
    private readonly enc: Encoder,
    private readonly watermark: string | null,
  ) {
    this.newPage();
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = TOP;
    if (this.watermark) {
      const text = this.enc.encode(this.watermark);
      const size = 40;
      const w = this.fonts.bold.widthOfTextAtSize(text, size);
      this.page.drawText(text, { x: PAGE.width / 2 - (w / 2) * Math.cos(Math.PI / 4), y: PAGE.height / 2 - (w / 2) * Math.sin(Math.PI / 4), size, font: this.fonts.bold, color: WATERMARK, rotate: degrees(45), opacity: 0.35 });
    }
  }

  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = this.enc.encode(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the line (a long id) is broken by characters.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  }

  paragraph(text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; after?: number } = {}): void {
    const font = opts.font ?? this.fonts.regular;
    const size = opts.size ?? 10;
    const lead = size * 1.4;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(text, font, size, WIDTH - indent)) {
      this.ensure(lead);
      this.page.drawText(line, { x: LEFT + indent, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lead;
    }
    this.y -= opts.after ?? 6;
  }

  rule(): void {
    this.ensure(8);
    this.page.drawLine({ start: { x: LEFT, y: this.y - 2 }, end: { x: RIGHT, y: this.y - 2 }, thickness: 0.6, color: RULE });
    this.y -= 10;
  }

  /** A shaded box holding paragraphs (kept on one page). */
  box(heading: string, paragraphs: string[]): void {
    const size = 10;
    const lead = size * 1.4;
    const pad = 10;
    const lines = paragraphs.map((p) => this.wrap(p, this.fonts.regular, size, WIDTH - pad * 2));
    const height = pad * 2 + lead + lines.reduce((s, l) => s + l.length * lead + 5, 0);
    this.ensure(height);
    this.page.drawRectangle({ x: LEFT, y: this.y - height, width: WIDTH, height, color: PANEL, borderColor: RULE, borderWidth: 0.6 });
    let y = this.y - pad;
    this.page.drawText(this.enc.encode(heading), { x: LEFT + pad, y: y - size, size, font: this.fonts.bold, color: INK });
    y -= lead + 2;
    for (const block of lines) {
      for (const line of block) {
        this.page.drawText(line, { x: LEFT + pad, y: y - size, size, font: this.fonts.regular, color: INK });
        y -= lead;
      }
      y -= 5;
    }
    this.y -= height + 12;
  }

  /** A table whose header repeats after a page break. Column widths are fractions of the content width. */
  table(columns: readonly string[], rows: ReadonlyArray<readonly string[]>, total: readonly string[], fractions: readonly number[], rightAligned: readonly boolean[]): void {
    const size = 9;
    const lead = 15;
    const widths = fractions.map((f) => f * WIDTH);
    const drawRow = (cells: readonly string[], font: PDFFont, color = INK) => {
      this.ensure(lead);
      let x = LEFT;
      cells.forEach((cell, i) => {
        let text = this.enc.encode(cell);
        while (text.length > 1 && font.widthOfTextAtSize(text, size) > widths[i] - 6) text = text.slice(0, -1);
        const w = font.widthOfTextAtSize(text, size);
        this.page.drawText(text, { x: rightAligned[i] ? x + widths[i] - 4 - w : x + 2, y: this.y - size - 2, size, font, color });
        x += widths[i];
      });
      this.y -= lead;
    };
    const header = () => {
      drawRow(columns, this.fonts.bold, MUTED);
      this.page.drawLine({ start: { x: LEFT, y: this.y + 2 }, end: { x: RIGHT, y: this.y + 2 }, thickness: 0.6, color: RULE });
    };
    this.ensure(lead * 3);
    header();
    for (const row of rows) {
      if (this.y - lead < BOTTOM) {
        this.newPage();
        header();
      }
      drawRow(row, this.fonts.regular);
    }
    this.ensure(lead + 4);
    this.page.drawLine({ start: { x: LEFT, y: this.y + 2 }, end: { x: RIGHT, y: this.y + 2 }, thickness: 0.6, color: RULE });
    drawRow(total, this.fonts.bold);
    this.y -= 6;
  }

  text(line: string, x: number, y: number, font: PDFFont, size: number, color = INK, page = this.page): void {
    page.drawText(this.enc.encode(line), { x, y, size, font, color });
  }

  get cursor(): number {
    return this.y;
  }
  set cursor(value: number) {
    this.y = value;
  }
  get current(): PDFPage {
    return this.page;
  }
}

export async function renderAcknowledgmentPdf(letter: LetterContent, issuedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const enc = new Encoder(fonts.regular);
  const l = new Layout(doc, fonts, enc, letter.watermark);

  // Letterhead: the SGO, then the document's title and its identifying details on the right.
  l.paragraph(letter.sgo.name, { font: fonts.bold, size: 15, after: 2 });
  if (letter.sgo.legalName) l.paragraph(letter.sgo.legalName, { size: 9.5, color: MUTED, after: 1 });
  if (letter.sgo.location) l.paragraph(letter.sgo.location, { size: 9.5, color: MUTED, after: 1 });
  l.gap(4);
  l.rule();
  l.paragraph(letter.title, { font: fonts.bold, size: 13, after: 8 });
  if (letter.testNotice) l.paragraph(letter.testNotice, { font: fonts.bold, size: 9.5, color: rgb(0.62, 0.12, 0.12), after: 8 });

  // Donor address block (left) and document details (right), side by side.
  const top = l.cursor;
  let yLeft = top;
  l.text(letter.donor.label, LEFT, yLeft - 9, fonts.regular, 9, MUTED, l.current);
  yLeft -= 14;
  for (const line of letter.donor.lines) {
    l.text(line, LEFT, yLeft - 10, fonts.regular, 10.5, INK, l.current);
    yLeft -= 14;
  }
  let yRight = top;
  const metaX = LEFT + WIDTH * 0.58;
  for (const m of letter.meta) {
    l.text(m.label, metaX, yRight - 9, fonts.regular, 9, MUTED, l.current);
    l.text(m.value, metaX + 78, yRight - 9, fonts.regular, 9, INK, l.current);
    yRight -= 14;
  }
  l.cursor = Math.min(yLeft, yRight) - 14;

  l.box(letter.requiredHeading, letter.required);
  if (letter.replaces) l.paragraph(letter.replaces, { font: fonts.italic, size: 9.5, color: MUTED, after: 10 });

  l.paragraph(letter.gifts.heading, { font: fonts.bold, size: 11, after: 4 });
  l.table(letter.gifts.columns, letter.gifts.rows, letter.gifts.total, [0.27, 0.2, 0.2, 0.33], [false, true, true, false]);
  l.paragraph(letter.gifts.note, { size: 8.5, color: MUTED, after: 12 });

  l.paragraph(letter.notesHeading, { font: fonts.bold, size: 11, after: 4 });
  for (const note of letter.notes) l.paragraph(note, { size: 9, after: 5 });

  // Footer on every page: the document id and version, page numbers, and the test watermark text in test mode.
  const pages = l.pages;
  pages.forEach((page, i) => {
    page.drawLine({ start: { x: LEFT, y: 50 }, end: { x: RIGHT, y: 50 }, thickness: 0.6, color: RULE });
    const footer = `${letter.watermark ? `${letter.watermark}  |  ` : ""}${letter.footer}`;
    l.text(footer, LEFT, 38, fonts.regular, 7.5, MUTED, page);
    const pageLabel = enc.encode(fill(LETTER_COPY.page, { page: i + 1, pages: pages.length }));
    page.drawText(pageLabel, { x: RIGHT - fonts.regular.widthOfTextAtSize(pageLabel, 7.5), y: 38, size: 7.5, font: fonts.regular, color: MUTED });
  });

  doc.setTitle(enc.encode(`${letter.title} - ${letter.meta.find((m) => m.label === LETTER_COPY.calendarYearLabel)?.value ?? ""}`));
  doc.setAuthor(enc.encode(letter.sgo.name));
  doc.setSubject(enc.encode(letter.title));
  doc.setCreator(BRAND.name);
  doc.setProducer(ACKNOWLEDGMENT_PDF_RENDERER);
  doc.setKeywords([letter.meta.find((m) => m.label === LETTER_COPY.documentLabel)?.value ?? "", letter.watermark ? "mode:test" : "mode:live"]);
  doc.setLanguage("en-US");
  doc.setCreationDate(issuedAt);
  doc.setModificationDate(issuedAt);
  return doc.save({ useObjectStreams: false });
}
