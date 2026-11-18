import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

/**
 * A small flow-layout writer on top of pdf-lib: wrapped paragraphs, tables that break across pages with
 * their header repeated, boxed callouts, and a header and footer on every page.
 *
 * It uses only the standard Helvetica and Courier fonts, which every PDF reader has built in. Those fonts
 * cover the WinAnsi character set, so text passes through `PdfTextEncoder` first: characters the fonts
 * cannot print are transliterated or replaced and counted, never thrown on.
 */

/* ------------------------------------------------------------------------------------------- page */

export const PAGE = Object.freeze({ width: 612, height: 792 }); // US Letter, in points
export const MARGIN_X = 54;
export const CONTENT_LEFT = MARGIN_X;
export const CONTENT_RIGHT = PAGE.width - MARGIN_X;
export const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const CONTENT_TOP = PAGE.height - 70;
const CONTENT_BOTTOM = 60;
const HEADER_BASELINE = PAGE.height - 40;
const HEADER_RULE_Y = PAGE.height - 50;
const FOOTER_RULE_Y = 46;
const FOOTER_BASELINE = 32;

export const COLOR = Object.freeze({
  ink: rgb(0.09, 0.11, 0.15),
  muted: rgb(0.36, 0.4, 0.46),
  faint: rgb(0.55, 0.58, 0.63),
  rule: rgb(0.82, 0.84, 0.87),
  panel: rgb(0.955, 0.96, 0.97),
  accent: rgb(0.1, 0.23, 0.4),
  green: rgb(0.08, 0.4, 0.22),
  red: rgb(0.62, 0.12, 0.12),
  amber: rgb(0.64, 0.38, 0.02),
  amberPanel: rgb(1, 0.975, 0.91),
  redPanel: rgb(0.995, 0.945, 0.945),
  watermark: rgb(0.945, 0.92, 0.92),
  white: rgb(1, 1, 1),
});

export type FontKey = "regular" | "bold" | "italic" | "mono";

export interface TextStyle {
  font: FontKey;
  size: number;
  color: RGB;
}

export const STYLE = Object.freeze({
  body: { font: "regular", size: 9.5, color: COLOR.ink } as TextStyle,
  bodyBold: { font: "bold", size: 9.5, color: COLOR.ink } as TextStyle,
  small: { font: "regular", size: 8.5, color: COLOR.ink } as TextStyle,
  smallBold: { font: "bold", size: 8.5, color: COLOR.ink } as TextStyle,
  smallMuted: { font: "regular", size: 8.5, color: COLOR.muted } as TextStyle,
  note: { font: "italic", size: 8.5, color: COLOR.muted } as TextStyle,
  label: { font: "regular", size: 8.5, color: COLOR.muted } as TextStyle,
  mono: { font: "mono", size: 8, color: COLOR.ink } as TextStyle,
  tableHeader: { font: "bold", size: 7.5, color: COLOR.muted } as TextStyle,
});

const LINE_FACTOR = 1.36;

/* ------------------------------------------------------------------------------------------- text */

/* Characters the standard fonts lack that have an obvious plain equivalent. Anything else is decomposed
   (accented Latin letters lose the accent) or shown as "?". */
const PLAIN_EQUIVALENT: ReadonlyMap<number, string> = new Map([
  [0x2010, "-"],
  [0x2011, "-"],
  [0x2012, "-"],
  [0x2015, "-"],
  [0x2212, "-"],
  [0x2032, "'"],
  [0x2033, '"'],
  [0x00d7, "x"],
  [0x2264, "<="],
  [0x2265, ">="],
  [0x2192, "->"],
  [0x0141, "L"],
  [0x0142, "l"],
  [0x0110, "D"],
  [0x0111, "d"],
  [0x0131, "i"],
  [0x0126, "H"],
  [0x0127, "h"],
  [0x014a, "N"],
  [0x014b, "n"],
]);

const COMBINING_MARKS = /\p{M}/gu;
const IS_COMBINING_MARK = /^\p{M}$/u;
const UNPRINTABLE = "?";

/** Maps arbitrary text to what the standard fonts can print, and counts every character it had to change. */
export class PdfTextEncoder {
  private readonly supported: ReadonlySet<number>;
  /** Characters transliterated or replaced so far. */
  substituted = 0;

  constructor(font: PDFFont) {
    this.supported = new Set(font.getCharacterSet());
  }

  private printable(codePoint: number): boolean {
    return codePoint >= 0x20 && codePoint !== 0x7f && this.supported.has(codePoint);
  }

  encode(text: string): string {
    let out = "";
    for (const char of text) {
      const codePoint = char.codePointAt(0) ?? 0;
      if (this.printable(codePoint)) {
        out += char;
        continue;
      }
      if (/\s/u.test(char)) {
        out += " ";
        continue;
      }
      this.substituted += 1;
      const plain = PLAIN_EQUIVALENT.get(codePoint);
      if (plain !== undefined) {
        out += plain;
        continue;
      }
      const base = char.normalize("NFKD").replace(COMBINING_MARKS, "");
      if (base !== "" && Array.from(base).every((part) => this.printable(part.codePointAt(0) ?? 0))) {
        out += base;
        continue;
      }
      // A combining mark with nothing to attach to prints as nothing; any other unprintable character as "?".
      out += IS_COMBINING_MARK.test(char) ? "" : UNPRINTABLE;
    }
    return out;
  }
}

/* ------------------------------------------------------------------------------------------ table */

export interface CellPart {
  text: string;
  style?: TextStyle;
}

/** A cell is one piece of text or several parts, each starting on its own line. */
export type Cell = string | readonly CellPart[];

export interface Column {
  header: string;
  /** Width in points. The widths of a table's columns add up to `CONTENT_WIDTH`. */
  width: number;
  align?: "left" | "right";
  style?: TextStyle;
}

export interface TableOptions {
  /** Draw the header row (and repeat it after a page break). Default true. */
  header?: boolean;
}

interface PlacedLine {
  text: string;
  style: TextStyle;
}

interface CalloutOptions {
  border: RGB;
  background: RGB;
  title?: { text: string; style: TextStyle };
  /** Draw a thick bar on the left instead of a full border. */
  bar?: boolean;
}

export interface HeaderFooter {
  headerLeft: string;
  headerRight: string;
  footerLeft: string;
}

const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;

/* ----------------------------------------------------------------------------------------- writer */

export class PdfWriter {
  private readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  /** Top of the next thing to be drawn. */
  private y = CONTENT_TOP;

  private constructor(
    readonly doc: PDFDocument,
    private readonly fonts: Readonly<Record<FontKey, PDFFont>>,
    readonly encoder: PdfTextEncoder,
    private readonly watermark: string | null,
  ) {}

  static async create(options: { watermark: string | null }): Promise<PdfWriter> {
    // updateMetadata: false keeps pdf-lib from stamping the current time; the caller sets every date.
    const doc = await PDFDocument.create({ updateMetadata: false });
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
      mono: await doc.embedFont(StandardFonts.Courier),
    };
    const writer = new PdfWriter(doc, fonts, new PdfTextEncoder(fonts.regular), options.watermark);
    writer.addPage();
    return writer;
  }

  /* -- measuring ------------------------------------------------------------------------------- */

  private widthOf(text: string, style: TextStyle): number {
    return this.fonts[style.font].widthOfTextAtSize(text, style.size);
  }

  private lineHeight(style: TextStyle): number {
    return style.size * LINE_FACTOR;
  }

  /** Breaks a token that is wider than the line, preferring a cut after punctuation that often separates parts of ids and paths. */
  private breakToken(token: string, style: TextStyle, maxWidth: number): string[] {
    const pieces: string[] = [];
    let rest = token;
    while (rest.length > 1 && this.widthOf(rest, style) > maxWidth) {
      let fit = 1;
      while (fit < rest.length && this.widthOf(rest.slice(0, fit + 1), style) <= maxWidth) fit += 1;
      let cut = fit;
      for (let i = fit; i > Math.floor(fit / 2); i -= 1) {
        if ("/_-:,;".includes(rest[i - 1])) {
          cut = i;
          break;
        }
      }
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    pieces.push(rest);
    return pieces;
  }

  /** Word-wraps already-encoded text. Always returns at least one line. */
  private wrap(encoded: string, style: TextStyle, maxWidth: number): string[] {
    const lines: string[] = [];
    let current = "";
    for (const word of encoded.split(" ")) {
      if (word === "") continue;
      const candidate = current === "" ? word : `${current} ${word}`;
      if (this.widthOf(candidate, style) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      if (this.widthOf(word, style) <= maxWidth) {
        current = word;
        continue;
      }
      const pieces = this.breakToken(word, style, maxWidth);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1];
    }
    if (current !== "") lines.push(current);
    return lines.length > 0 ? lines : [""];
  }

  private linesOf(text: string, style: TextStyle, maxWidth: number): PlacedLine[] {
    return this.wrap(this.encoder.encode(text), style, maxWidth).map((line) => ({ text: line, style }));
  }

  /* -- pages ----------------------------------------------------------------------------------- */

  private addPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = CONTENT_TOP;
    if (this.watermark !== null) this.drawWatermark(this.watermark);
  }

  /* Drawn first so that everything else prints over it. */
  private drawWatermark(text: string): void {
    const style: TextStyle = { font: "bold", size: 92, color: COLOR.watermark };
    const encoded = this.encoder.encode(text);
    const width = this.widthOf(encoded, style);
    const capHeight = style.size * 0.72;
    const angle = Math.PI / 4;
    // Place the centre of the rotated text box on the centre of the page.
    const x = PAGE.width / 2 - (width / 2) * Math.cos(angle) + (capHeight / 2) * Math.sin(angle);
    const y = PAGE.height / 2 - (width / 2) * Math.sin(angle) - (capHeight / 2) * Math.cos(angle);
    this.page.drawText(encoded, { x, y, size: style.size, font: this.fonts.bold, color: style.color, rotate: degrees(45) });
  }

  /** Starts a new page unless the current one is still empty. */
  pageBreak(): void {
    if (this.y < CONTENT_TOP) this.addPage();
  }

  /** Makes sure `height` points are free below the cursor, moving to a new page when they are not. */
  ensure(height: number): void {
    if (this.y - height < CONTENT_BOTTOM) this.addPage();
  }

  gap(points: number): void {
    // White space is never carried to the top of a new page.
    if (this.y < CONTENT_TOP) this.y = Math.max(CONTENT_BOTTOM, this.y - points);
  }

  private drawLine(line: PlacedLine, x: number, top: number, lineHeight: number, align: "left" | "right" = "left", rightEdge = CONTENT_RIGHT): void {
    if (line.text === "") return;
    const baseline = top - lineHeight + (lineHeight - line.style.size) / 2 + line.style.size * 0.22;
    const drawX = align === "right" ? rightEdge - this.widthOf(line.text, line.style) : x;
    this.page.drawText(line.text, { x: drawX, y: baseline, size: line.style.size, font: this.fonts[line.style.font], color: line.style.color });
  }

  /* -- blocks ---------------------------------------------------------------------------------- */

  title(text: string): void {
    const style: TextStyle = { font: "bold", size: 20, color: COLOR.accent };
    for (const line of this.linesOf(text, style, CONTENT_WIDTH)) {
      const height = this.lineHeight(style);
      this.ensure(height);
      this.drawLine(line, CONTENT_LEFT, this.y, height);
      this.y -= height;
    }
  }

  /** A numbered section heading with a rule under it. Stays with at least `keepWithNext` points of what follows. */
  heading(text: string, keepWithNext = 72): void {
    const style: TextStyle = { font: "bold", size: 13, color: COLOR.accent };
    const lines = this.linesOf(text, style, CONTENT_WIDTH);
    const height = this.lineHeight(style);
    this.gap(18);
    this.ensure(lines.length * height + 8 + keepWithNext);
    for (const line of lines) {
      this.drawLine(line, CONTENT_LEFT, this.y, height);
      this.y -= height;
    }
    this.y -= 2;
    this.page.drawLine({ start: { x: CONTENT_LEFT, y: this.y }, end: { x: CONTENT_RIGHT, y: this.y }, thickness: 0.8, color: COLOR.accent });
    this.y -= 8;
  }

  subheading(text: string, keepWithNext = 40): void {
    const style: TextStyle = { font: "bold", size: 10, color: COLOR.ink };
    const lines = this.linesOf(text, style, CONTENT_WIDTH);
    const height = this.lineHeight(style);
    this.gap(10);
    this.ensure(lines.length * height + 3 + keepWithNext);
    for (const line of lines) {
      this.drawLine(line, CONTENT_LEFT, this.y, height);
      this.y -= height;
    }
    this.y -= 3;
  }

  paragraph(text: string, style: TextStyle = STYLE.body, options: { indent?: number; gapAfter?: number } = {}): void {
    const indent = options.indent ?? 0;
    const height = this.lineHeight(style);
    for (const line of this.linesOf(text, style, CONTENT_WIDTH - indent)) {
      this.ensure(height);
      this.drawLine(line, CONTENT_LEFT + indent, this.y, height);
      this.y -= height;
    }
    this.y -= options.gapAfter ?? 5;
  }

  /** A numbered or bulleted list. `marker(index)` returns the text hung to the left of each item. */
  list(items: readonly string[], marker: (index: number) => string, style: TextStyle = STYLE.body): void {
    const indent = 16;
    const height = this.lineHeight(style);
    items.forEach((item, index) => {
      const lines = this.linesOf(item, style, CONTENT_WIDTH - indent);
      lines.forEach((line, lineIndex) => {
        this.ensure(height);
        if (lineIndex === 0) this.drawLine({ text: this.encoder.encode(marker(index)), style }, CONTENT_LEFT, this.y, height);
        this.drawLine(line, CONTENT_LEFT + indent, this.y, height);
        this.y -= height;
      });
      this.y -= 2;
    });
    this.y -= 3;
  }

  /**
   * A shaded box of paragraphs. When it does not fit on the page it continues on the next one, each part
   * with its own box.
   */
  callout(paragraphs: ReadonlyArray<{ text: string; style?: TextStyle }>, options: CalloutOptions): void {
    const padX = 10;
    const padY = 8;
    const inner = CONTENT_WIDTH - 2 * padX - (options.bar ? 4 : 0);
    const textLeft = CONTENT_LEFT + padX + (options.bar ? 4 : 0);
    const lines: Array<PlacedLine & { height: number }> = [];
    if (options.title) {
      for (const line of this.linesOf(options.title.text, options.title.style, inner)) lines.push({ ...line, height: this.lineHeight(options.title.style) + 1 });
    }
    paragraphs.forEach((paragraph, index) => {
      const style = paragraph.style ?? STYLE.small;
      const wrapped = this.linesOf(paragraph.text, style, inner);
      wrapped.forEach((line, lineIndex) => {
        const last = lineIndex === wrapped.length - 1 && index < paragraphs.length - 1;
        lines.push({ ...line, height: this.lineHeight(style) + (last ? 4 : 0) });
      });
    });

    // A box that fits on one page is never split; only a box taller than a page continues on the next.
    const totalHeight = lines.reduce((sum, line) => sum + line.height, 0) + 2 * padY;
    if (totalHeight <= CONTENT_TOP - CONTENT_BOTTOM) this.ensure(totalHeight);

    let start = 0;
    while (start < lines.length) {
      this.ensure(2 * padY + lines[start].height * Math.min(3, lines.length - start));
      let available = this.y - CONTENT_BOTTOM - 2 * padY;
      let end = start;
      while (end < lines.length && lines[end].height <= available) {
        available -= lines[end].height;
        end += 1;
      }
      if (end === start) end = start + 1; // a single line always fits on a fresh page
      const boxHeight = lines.slice(start, end).reduce((sum, line) => sum + line.height, 0) + 2 * padY;
      const bottom = this.y - boxHeight;
      this.page.drawRectangle({ x: CONTENT_LEFT, y: bottom, width: CONTENT_WIDTH, height: boxHeight, color: options.background, borderColor: options.bar ? undefined : options.border, borderWidth: options.bar ? 0 : 0.8 });
      if (options.bar) this.page.drawRectangle({ x: CONTENT_LEFT, y: bottom, width: 4, height: boxHeight, color: options.border });
      let top = this.y - padY;
      for (const line of lines.slice(start, end)) {
        this.drawLine(line, textLeft, top, line.height);
        top -= line.height;
      }
      this.y = bottom;
      start = end;
      if (start < lines.length) this.addPage();
    }
    this.y -= 10;
  }

  private static keyValueColumns(labelWidth: number): Column[] {
    return [
      { header: "", width: labelWidth, style: STYLE.label },
      { header: "", width: CONTENT_WIDTH - labelWidth, style: STYLE.body },
    ];
  }

  /** Label and value pairs. Values may be multi-part cells. */
  keyValues(rows: ReadonlyArray<readonly [label: string, value: Cell]>, labelWidth = 150): void {
    this.table(PdfWriter.keyValueColumns(labelWidth), rows, { header: false });
  }

  /** Height `keyValues` would take on one page. Lets a heading stay with a short block that follows it. */
  keyValuesHeight(rows: ReadonlyArray<readonly [label: string, value: Cell]>, labelWidth = 150): number {
    return this.tableHeight(PdfWriter.keyValueColumns(labelWidth), rows, { header: false });
  }

  private cellLines(columns: readonly Column[], row: readonly Cell[]): PlacedLine[][] {
    return columns.map((column, index) => {
      const cell = row[index] ?? "";
      const parts: readonly CellPart[] = typeof cell === "string" ? [{ text: cell }] : cell;
      return parts.flatMap((part) => this.linesOf(part.text, part.style ?? column.style ?? STYLE.small, column.width - 2 * CELL_PAD_X));
    });
  }

  private rowLineHeight(cells: readonly PlacedLine[][]): number {
    return Math.max(...cells.flat().map((line) => this.lineHeight(line.style)), this.lineHeight(STYLE.small));
  }

  private headerHeight(columns: readonly Column[]): number {
    const lineCounts = columns.map((column) => this.wrap(column.header, STYLE.tableHeader, column.width - 2 * CELL_PAD_X).length);
    return Math.max(...lineCounts) * this.lineHeight(STYLE.tableHeader) + 2 * CELL_PAD_Y;
  }

  /** Height `table` would take if it were drawn on one page. Measuring does not count character substitutions twice. */
  tableHeight(columns: readonly Column[], rows: ReadonlyArray<readonly Cell[]>, options: TableOptions = {}): number {
    const substituted = this.encoder.substituted;
    let height = (options.header ?? true) ? this.headerHeight(columns) : 0;
    for (const row of rows) {
      const cells = this.cellLines(columns, row);
      height += Math.max(...cells.map((lines) => lines.length)) * this.rowLineHeight(cells) + 2 * CELL_PAD_Y;
    }
    this.encoder.substituted = substituted;
    return height + 8;
  }

  table(columns: readonly Column[], rows: ReadonlyArray<readonly Cell[]>, options: TableOptions = {}): void {
    const showHeader = options.header ?? true;
    const headerStyle = STYLE.tableHeader;
    const headerLines = columns.map((column) => this.linesOf(column.header, headerStyle, column.width - 2 * CELL_PAD_X));
    const headerLineHeight = this.lineHeight(headerStyle);
    const headerHeight = this.headerHeight(columns);
    const columnLeft: number[] = [];
    columns.reduce((x, column) => {
      columnLeft.push(x);
      return x + column.width;
    }, CONTENT_LEFT);

    const drawHeader = () => {
      if (!showHeader) {
        this.page.drawLine({ start: { x: CONTENT_LEFT, y: this.y }, end: { x: CONTENT_RIGHT, y: this.y }, thickness: 0.5, color: COLOR.rule });
        return;
      }
      this.page.drawRectangle({ x: CONTENT_LEFT, y: this.y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: COLOR.panel });
      columns.forEach((column, index) => {
        let top = this.y - CELL_PAD_Y;
        for (const line of headerLines[index]) {
          this.drawLine(line, columnLeft[index] + CELL_PAD_X, top, headerLineHeight, column.align, columnLeft[index] + column.width - CELL_PAD_X);
          top -= headerLineHeight;
        }
      });
      this.y -= headerHeight;
      this.page.drawLine({ start: { x: CONTENT_LEFT, y: this.y }, end: { x: CONTENT_RIGHT, y: this.y }, thickness: 0.8, color: COLOR.muted });
    };

    // The header never sits alone at the bottom of a page.
    this.ensure((showHeader ? headerHeight : 0) + 30);
    drawHeader();

    for (const row of rows) {
      const cells = this.cellLines(columns, row);
      const lineHeight = this.rowLineHeight(cells);
      const lineCount = Math.max(...cells.map((lines) => lines.length));
      const fullPage = CONTENT_TOP - CONTENT_BOTTOM - (showHeader ? headerHeight : 0) - 2 * CELL_PAD_Y;

      let from = 0;
      while (from < lineCount) {
        const remaining = lineCount - from;
        let fits = Math.floor((this.y - CONTENT_BOTTOM - 2 * CELL_PAD_Y) / lineHeight);
        // A row moves to the next page whole when it fits there; only a row taller than a page is split.
        if (fits < remaining && (remaining * lineHeight <= fullPage || fits < 3)) {
          this.addPage();
          drawHeader();
          fits = Math.floor((this.y - CONTENT_BOTTOM - 2 * CELL_PAD_Y) / lineHeight);
        }
        const count = Math.max(1, Math.min(remaining, fits));
        const height = count * lineHeight + 2 * CELL_PAD_Y;
        columns.forEach((column, index) => {
          let top = this.y - CELL_PAD_Y;
          for (const line of cells[index].slice(from, from + count)) {
            this.drawLine(line, columnLeft[index] + CELL_PAD_X, top, lineHeight, column.align, columnLeft[index] + column.width - CELL_PAD_X);
            top -= lineHeight;
          }
        });
        this.y -= height;
        this.page.drawLine({ start: { x: CONTENT_LEFT, y: this.y }, end: { x: CONTENT_RIGHT, y: this.y }, thickness: 0.5, color: COLOR.rule });
        from += count;
      }
    }
    this.y -= 8;
  }

  /* -- finishing ------------------------------------------------------------------------------- */

  /** Draws the header and footer on every page, now that the page count is known. */
  finish(text: HeaderFooter): number {
    const total = this.pages.length;
    const headerStyle: TextStyle = { font: "bold", size: 8.5, color: COLOR.accent };
    const idStyle: TextStyle = { font: "mono", size: 8, color: COLOR.muted };
    const footerStyle: TextStyle = { font: "regular", size: 7.5, color: COLOR.muted };
    const fitted = (value: string, style: TextStyle, maxWidth: number): string => {
      let encoded = this.encoder.encode(value);
      if (this.widthOf(encoded, style) <= maxWidth) return encoded;
      while (encoded.length > 1 && this.widthOf(`${encoded}...`, style) > maxWidth) encoded = encoded.slice(0, -1);
      return `${encoded}...`;
    };
    const headerLeft = fitted(text.headerLeft, headerStyle, CONTENT_WIDTH * 0.5);
    const headerRight = fitted(text.headerRight, idStyle, CONTENT_WIDTH * 0.48);
    const footerLeft = fitted(text.footerLeft, footerStyle, CONTENT_WIDTH * 0.84);

    this.pages.forEach((page, index) => {
      page.drawText(headerLeft, { x: CONTENT_LEFT, y: HEADER_BASELINE, size: headerStyle.size, font: this.fonts.bold, color: headerStyle.color });
      page.drawText(headerRight, { x: CONTENT_RIGHT - this.widthOf(headerRight, idStyle), y: HEADER_BASELINE, size: idStyle.size, font: this.fonts.mono, color: idStyle.color });
      page.drawLine({ start: { x: CONTENT_LEFT, y: HEADER_RULE_Y }, end: { x: CONTENT_RIGHT, y: HEADER_RULE_Y }, thickness: 0.5, color: COLOR.rule });

      page.drawLine({ start: { x: CONTENT_LEFT, y: FOOTER_RULE_Y }, end: { x: CONTENT_RIGHT, y: FOOTER_RULE_Y }, thickness: 0.5, color: COLOR.rule });
      const pageLabel = `Page ${index + 1} of ${total}`;
      page.drawText(footerLeft, { x: CONTENT_LEFT, y: FOOTER_BASELINE, size: footerStyle.size, font: this.fonts.regular, color: footerStyle.color });
      page.drawText(pageLabel, { x: CONTENT_RIGHT - this.widthOf(pageLabel, footerStyle), y: FOOTER_BASELINE, size: footerStyle.size, font: this.fonts.regular, color: footerStyle.color });
    });
    return total;
  }
}
