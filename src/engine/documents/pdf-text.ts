/**
 * PDF text-layer extraction with pdfjs-dist (legacy build, which runs in Node).
 *
 * No worker thread (pdfjs falls back to its in-process "fake worker" in Node) and no network (no URL
 * loading, no remote fonts or CMaps). Encrypted, corrupt and oversized files become a typed
 * `DocumentReadError`. A PDF without a usable text layer (a scan or a photo) is reported as such with
 * `hasTextLayer: false`; nothing is guessed from it.
 */
import { AppError } from "@/lib/errors";
import { DEFAULT_DOCUMENT_POLICY } from "./types";
import { joinItems, normalizeText, type DocumentText, type TextItem, type TextLine, type TextPage } from "./text";

export type DocumentReadFailure = "empty" | "not_pdf" | "too_large" | "encrypted" | "corrupt" | "timeout";

/** A document that cannot be read at all. `reason` is stable; `message` is safe to show a reviewer. */
export class DocumentReadError extends AppError {
  readonly reason: DocumentReadFailure;
  constructor(reason: DocumentReadFailure, message: string) {
    super("bad_request", message, { reason });
    this.reason = reason;
  }
}

export function isDocumentReadError(e: unknown): e is DocumentReadError {
  return e instanceof DocumentReadError;
}

export interface PdfTextResult extends DocumentText {
  source: "pdf_text";
  /** True when enough pages carry real text to read the document. */
  hasTextLayer: boolean;
  /** Pages in the file. */
  pageCount: number;
  /** Pages actually read (≤ `maxPages`). */
  pagesRead: number;
  /** 1-based numbers of read pages whose text layer is missing or too thin. */
  pagesWithoutText: number[];
}

export interface ExtractPdfTextOptions {
  maxBytes?: number;
  maxPages?: number;
  minTextCharsPerPage?: number;
  timeoutMs?: number;
}

/** Baselines closer than this (points) belong to one line. */
const LINE_TOLERANCE = 2.5;
const DEFAULT_TIMEOUT_MS = 20_000;

export function isPdfBytes(bytes: Uint8Array): boolean {
  // "%PDF-" may be preceded by a little junk (the spec tolerates up to 1024 bytes).
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  return head.includes("%PDF-");
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/** Maps a pdfjs failure to a typed error. Exported for tests. */
export function toReadError(e: unknown): DocumentReadError {
  if (e instanceof DocumentReadError) return e;
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === "PasswordException") return new DocumentReadError("encrypted", "The PDF is password-protected and cannot be read.");
  return new DocumentReadError("corrupt", "The PDF file is damaged or not a valid PDF.");
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new DocumentReadError("timeout", "Reading the PDF took too long."));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
}

function isRawItem(v: unknown): v is RawItem {
  return typeof v === "object" && v !== null && typeof (v as RawItem).str === "string" && Array.isArray((v as RawItem).transform);
}

/** Groups positioned text runs into lines (top to bottom, left to right). Rotated runs (watermarks) are dropped. */
export function buildLines(raw: readonly RawItem[]): TextLine[] {
  const items: Array<TextItem & { y: number }> = [];
  for (const r of raw) {
    const [a, b, c, , e, f] = r.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue;
    const text = normalizeText(r.str).replace(/\s+/g, " ");
    if (text.trim() === "") continue;
    items.push({ x: e, y: f, width: r.width, text: text.trim() });
  }
  items.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: Array<{ y: number; items: TextItem[] }> = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= LINE_TOLERANCE);
    if (line) line.items.push({ x: it.x, width: it.width, text: it.text });
    else lines.push({ y: it.y, items: [{ x: it.x, width: it.width, text: it.text }] });
  }
  return lines
    .sort((p, q) => q.y - p.y)
    .map((l) => {
      const sorted = mergeAdjacent(l.items.sort((p, q) => p.x - q.x));
      return { y: l.y, items: sorted, text: joinItems(sorted) };
    });
}

/** Runs that touch (a word split across runs) are merged, so an item is a word group within one column. */
function mergeAdjacent(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev) {
      const charWidth = prev.text.length > 0 ? prev.width / prev.text.length : 5;
      const gap = it.x - (prev.x + prev.width);
      if (gap <= charWidth * 1.5) {
        const sep = gap > charWidth * 0.15 ? " " : "";
        prev.text = `${prev.text}${sep}${it.text}`;
        prev.width = it.x + it.width - prev.x;
        continue;
      }
    }
    out.push({ ...it });
  }
  return out;
}

export async function extractPdfText(bytes: Uint8Array, opts: ExtractPdfTextOptions = {}): Promise<PdfTextResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_DOCUMENT_POLICY.maxPdfBytes;
  const maxPages = opts.maxPages ?? DEFAULT_DOCUMENT_POLICY.maxPdfPages;
  const minChars = opts.minTextCharsPerPage ?? DEFAULT_DOCUMENT_POLICY.minTextCharsPerPage;
  if (bytes.length === 0) throw new DocumentReadError("empty", "The file is empty.");
  if (bytes.length > maxBytes) throw new DocumentReadError("too_large", `The file is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  if (!isPdfBytes(bytes)) throw new DocumentReadError("not_pdf", "The file is not a PDF.");

  const pdfjs = await loadPdfJs();
  // pdfjs takes ownership of (and may detach) the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const destroy = () => {
    void task.destroy().catch(() => undefined);
  };
  try {
    return await withTimeout(
      (async (): Promise<PdfTextResult> => {
        const pdf = await task.promise;
        const pageCount = pdf.numPages;
        const pagesRead = Math.min(pageCount, maxPages);
        const pages: TextPage[] = [];
        const pagesWithoutText: number[] = [];
        for (let n = 1; n <= pagesRead; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          const lines = buildLines((content.items as unknown[]).filter(isRawItem));
          const text = lines.map((l) => l.text).join("\n");
          if (text.replace(/\s/g, "").length < minChars) pagesWithoutText.push(n);
          pages.push({ number: n, text, lines });
          page.cleanup();
        }
        const textPages = pagesRead - pagesWithoutText.length;
        return {
          source: "pdf_text",
          pages,
          pageCount,
          pagesRead,
          pagesWithoutText,
          hasTextLayer: textPages > 0,
        };
      })(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      destroy,
    );
  } catch (e) {
    throw toReadError(e);
  } finally {
    destroy();
  }
}
