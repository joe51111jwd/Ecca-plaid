/**
 * PDF reading and robustness: random bytes, truncated PDFs, empty files, huge text, oversized and
 * password-protected files. Every case must end in a typed outcome, never an escaped exception, and never
 * "extracted".
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildLines, DocumentReadError, extractPdfText, hasEofMarker, toReadError } from "./pdf-text";
import { detectFileType, findFullSsns, readDocument, readDocumentText } from "./index";
import { generateSyntheticDocument } from "./synthetic";

const FIXTURES = resolve(__dirname, "../../../tests/fixtures/synthetic");
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** Deterministic pseudo-random bytes (no Math.random, so failures reproduce). */
function lcgBytes(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

async function pdfWithPages(n: number, text = "Hello"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) doc.addPage().drawText(`${text} page ${i + 1} with enough characters to count as a text layer`, { x: 50, y: 700, size: 10, font });
  return doc.save();
}

describe("extractPdfText", () => {
  it("reads lines top to bottom and joins columns with a wide gap", async () => {
    const r = await extractPdfText(fixture("SYNTHETIC_tf0001_snap_approved.pdf"));
    expect(r).toMatchObject({ hasTextLayer: true, pageCount: 3, pagesRead: 3, truncated: false, pagesWithoutText: [] });
    const lines = r.pages[0].lines.map((l) => l.text);
    expect(lines).toContain("Date: 09/15/2026  Need help?");
    expect(lines.indexOf("Notice about your case:")).toBeGreaterThan(lines.indexOf("Date: 09/15/2026  Need help?"));
    // The diagonal watermark is not part of any line.
    expect(r.pages.flatMap((p) => p.lines).filter((l) => /SYNTHETIC/.test(l.text))).toHaveLength(6);
  });

  it("reports a PDF without a text layer instead of guessing", async () => {
    const r = await extractPdfText(fixture("SYNTHETIC_tf0001_scan_image_only.pdf"));
    expect(r.hasTextLayer).toBe(false);
    expect(r.pagesWithoutText).toEqual([1]);
    expect(r.pages[0].lines).toEqual([]);
  });

  it("caps pages and bytes", async () => {
    const bytes = await pdfWithPages(5);
    const r = await extractPdfText(bytes, { maxPages: 2 });
    expect([r.pageCount, r.pagesRead, r.pages.length]).toEqual([5, 2, 2]);
    await expect(extractPdfText(bytes, { maxBytes: 100 })).rejects.toMatchObject({ reason: "too_large" });
    const read = await readDocument({ bytes, contentType: "application/pdf", policy: { maxPdfPages: 2 } });
    expect(read.reviewReasons.map((x) => x.code)).toContain("pages_truncated");
  });

  it("throws typed errors for empty, non-PDF and corrupt input", async () => {
    await expect(extractPdfText(new Uint8Array())).rejects.toMatchObject({ reason: "empty" });
    await expect(extractPdfText(new TextEncoder().encode("hello"))).rejects.toMatchObject({ reason: "not_pdf" });
    await expect(extractPdfText(fixture("SYNTHETIC_corrupt.pdf"))).rejects.toBeInstanceOf(DocumentReadError);
  });

  it("maps a pdfjs password exception to `encrypted`", async () => {
    const { PasswordException } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(toReadError(new PasswordException("need password", 1)).reason).toBe("encrypted");
    expect(toReadError(new Error("boom")).reason).toBe("corrupt");
    expect(toReadError("weird").reason).toBe("corrupt");
  });

  it("drops rotated runs and merges touching runs into one item", () => {
    const lines = buildLines([
      { str: "Name", transform: [10, 0, 0, 10, 50, 700], width: 22 },
      { str: "SAM", transform: [10, 0, 0, 10, 100, 700.5], width: 18 },
      { str: "PLE", transform: [10, 0, 0, 10, 118, 700], width: 18 },
      { str: "WATERMARK", transform: [7, 7, -7, 7, 50, 600], width: 80 },
      { str: "   ", transform: [10, 0, 0, 10, 300, 650], width: 5 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["Name  SAMPLE"]);
  });

  it("detects a missing end-of-file marker", () => {
    expect(hasEofMarker(new TextEncoder().encode("%PDF-1.7 ... %%EOF\n"))).toBe(true);
    expect(hasEofMarker(new TextEncoder().encode("%PDF-1.7 ... trailer"))).toBe(false);
  });
});

describe("file types", () => {
  it.each([
    [[0xff, 0xd8, 0xff, 0xe0], "", "jpeg"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "", "png"],
    [[...new TextEncoder().encode("RIFF\0\0\0\0WEBP")], "", "webp"],
    [[0, 0, 0, 24, ...new TextEncoder().encode("ftypheic")], "", "heic"],
    [[...new TextEncoder().encode("%PDF-1.7")], "image/png", "pdf"],
    [[...new TextEncoder().encode("hello world")], "text/plain", "text"],
    [[...new TextEncoder().encode("hello world")], "application/pdf", "unknown"],
    [[0, 1, 2], "text/plain", "unknown"],
  ] as const)("%j %s → %s", (bytes, ct, type) => {
    expect(detectFileType(new Uint8Array(bytes), ct)).toBe(type);
  });

  it.each(["jpeg", "png", "heic", "webp"] as const)("%s images go to review with no_text_layer", async (kind) => {
    const heads: Record<typeof kind, number[]> = {
      jpeg: [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3],
      png: [...fixture("SYNTHETIC_tf0001_snap_photo.png")],
      heic: [0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0],
      webp: [...new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")],
    };
    const r = await readDocument({ bytes: new Uint8Array(heads[kind]), contentType: `image/${kind}` });
    expect(r).toMatchObject({ status: "needs_review", fileType: kind, extraction: null });
    expect(r.reviewReasons.map((x) => x.code)).toEqual(["no_text_layer"]);
  });

  it("plain-text uploads are not accepted (anyone can type a W-2)", async () => {
    const r = await readDocument({ bytes: new TextEncoder().encode("Form W-2 Wage and Tax Statement 2025"), contentType: "text/plain" });
    expect(r.status).toBe("unreadable");
    expect(r.reviewReasons.map((x) => x.code)).toEqual(["unsupported_file_type"]);
  });
});

describe("fuzz: never throws, never 'extracted'", () => {
  it("0-byte file", async () => {
    const r = await readDocument({ bytes: new Uint8Array(), contentType: "application/pdf" });
    expect(r.status).toBe("unreadable");
  });

  it("random bytes, with and without a PDF header", async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const noise = lcgBytes(seed, 64 + seed * 97);
      const withHeader = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\n"), ...noise]);
      for (const bytes of [noise, withHeader]) {
        const r = await readDocument({ bytes, contentType: "application/pdf", declaredKind: "w2" });
        expect(["unreadable", "needs_review"]).toContain(r.status);
        expect(r.reviewReasons.length).toBeGreaterThan(0);
      }
    }
  });

  it("every text fixture truncated at several points", async () => {
    const files = ["SYNTHETIC_tf0001_snap_approved.pdf", "SYNTHETIC_w2_2025_copyB.pdf", "SYNTHETIC_ssa_bevl_ssi_only.pdf", "SYNTHETIC_f1040_2025_mfj.pdf"];
    for (const name of files) {
      const full = fixture(name);
      for (const frac of [0.05, 0.25, 0.5, 0.75, 0.9, 0.98]) {
        const cut = full.subarray(0, Math.floor(full.length * frac));
        const r = await readDocument({ bytes: cut, contentType: "application/pdf" });
        expect(r.status, `${name} at ${frac}`).not.toBe("extracted");
        expect(findFullSsns(r)).toEqual([]);
      }
    }
  });

  it("flipped bytes in the middle of a valid PDF", async () => {
    const full = fixture("SYNTHETIC_w2_2025_copyB.pdf");
    for (let k = 0; k < 10; k++) {
      const bad = new Uint8Array(full);
      const at = Math.floor((bad.length * (k + 1)) / 12);
      for (let i = at; i < Math.min(bad.length - 10, at + 200); i++) bad[i] = bad[i] ^ 0x5a;
      const r = await readDocument({ bytes: bad, contentType: "application/pdf", declaredKind: "w2" });
      expect(["extracted", "needs_review", "unreadable"]).toContain(r.status);
      // A damaged W-2 may still be read; if so, it must have read the same box 1 figure.
      if (r.status === "extracted") expect(r.extraction?.fields["w2_1.box_1_cents"]?.value).toBe(4_125_000);
    }
  });

  it("huge and hostile text does not hang or throw", () => {
    const big = `${"Gross Pay $1.00 ".repeat(20_000)}\n${"a".repeat(200_000)}\n${"1/".repeat(50_000)}`;
    const t0 = Date.now();
    const r = readDocumentText(big);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.status).not.toBe("extracted");
    const ssns = readDocumentText(Array.from({ length: 500 }, (_, i) => `SSN 000-00-${String(i).padStart(4, "0")} 123456789`).join("\n"));
    expect(findFullSsns(ssns)).toEqual([]);
  });

  it("rejects non-byte input at the boundary", async () => {
    await expect(readDocument({ bytes: "not bytes" as never, contentType: "application/pdf" })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("synthetic generator", () => {
  it("is deterministic", async () => {
    const p = { date: "2026-10-02", addressee: "RILEY SAMPLE", ssi: { beginning: "2026-01-01", amountCents: 50_000, type: "a disabled child" } };
    const a = await generateSyntheticDocument("ssa_benefit_verification", p);
    const b = await generateSyntheticDocument("ssa_benefit_verification", p);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const meta = await PDFDocument.load(a, { updateMetadata: false });
    expect(meta.getTitle()).toMatch(/^SYNTHETIC /);
    expect(meta.getCreationDate()?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });

  it("rejects malformed dates instead of printing them", async () => {
    await expect(generateSyntheticDocument("ssa_benefit_verification", { date: "10/02/2026", addressee: "X Y" })).rejects.toThrow(RangeError);
  });
});
