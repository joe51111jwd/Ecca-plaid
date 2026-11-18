import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { syntheticFile, type SyntheticFileKind } from "./testing";
import { ALLOWED_UPLOAD_CONTENT_TYPES, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT_ATTRIBUTE, sanitizeFilename, sniffContentType, sniffDangerousContent, validateUpload } from "./upload-validation";

const text = (s: string) => Buffer.from(s, "utf8");
const cp = (...codes: number[]) => String.fromCodePoint(...codes);

function rejection(fn: () => unknown): { code: string; status: number; reason: string; message: string } {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    return { code: err.code, status: err.status, reason: (err.details as { reason: string }).reason, message: err.message };
  }
  throw new Error("expected the upload to be rejected");
}

describe("validateUpload", () => {
  describe("accepts the five document/photo formats by their real magic bytes", () => {
    const cases: Array<[SyntheticFileKind, string, string, string]> = [
      ["pdf", "application/pdf", "application/pdf", "pdf"],
      ["jpeg", "image/jpeg", "image/jpeg", "jpg"],
      ["png", "image/png", "image/png", "png"],
      ["webp", "image/webp", "image/webp", "webp"],
      ["heic", "image/heic", "image/heic", "heic"],
      ["heif", "image/heif", "image/heif", "heif"],
    ];
    it.each(cases)("%s declared as %s", (kind, declared, detected, extension) => {
      const bytes = syntheticFile(kind);
      expect(validateUpload({ bytes, contentType: declared, filename: `scan.${extension}` })).toEqual({
        contentType: detected,
        extension,
        filename: `scan.${extension}`,
        size: bytes.length,
      });
    });

    it.each(cases)("%s with no usable declared type (browsers often send none for HEIC)", (kind, _declared, detected) => {
      const bytes = syntheticFile(kind);
      for (const contentType of [undefined, null, "", "application/octet-stream", "binary/octet-stream", " Application/Octet-Stream "]) {
        expect(validateUpload({ bytes, contentType }).contentType).toBe(detected);
      }
    });

    it("tolerates aliases, casing and parameters in the declared type", () => {
      expect(validateUpload({ bytes: syntheticFile("jpeg"), contentType: "image/jpg" }).contentType).toBe("image/jpeg");
      expect(validateUpload({ bytes: syntheticFile("jpeg"), contentType: "IMAGE/PJPEG" }).contentType).toBe("image/jpeg");
      expect(validateUpload({ bytes: syntheticFile("pdf"), contentType: "application/pdf; charset=binary" }).contentType).toBe("application/pdf");
      expect(validateUpload({ bytes: syntheticFile("pdf"), contentType: "application/x-pdf" }).contentType).toBe("application/pdf");
      expect(validateUpload({ bytes: syntheticFile("png"), contentType: "image/x-png" }).contentType).toBe("image/png");
    });

    it("treats HEIC and HEIF labels as one family, reporting what the container says", () => {
      expect(validateUpload({ bytes: syntheticFile("heic"), contentType: "image/heif" }).contentType).toBe("image/heic");
      expect(validateUpload({ bytes: syntheticFile("heif"), contentType: "image/heic" }).contentType).toBe("image/heif");
    });

    it("accepts a Uint8Array view as well as a Buffer", () => {
      const src = syntheticFile("png");
      const padded = new Uint8Array(src.length + 10);
      padded.set(src, 5);
      expect(validateUpload({ bytes: padded.subarray(5, 5 + src.length) }).contentType).toBe("image/png");
    });
  });

  describe("size limits", () => {
    it("rejects empty files", () => {
      expect(rejection(() => validateUpload({ bytes: new Uint8Array(0), contentType: "application/pdf" }))).toMatchObject({ code: "validation_failed", status: 422, reason: "empty" });
    });

    it("accepts exactly 15 MB and rejects one byte more", () => {
      const exact = Buffer.alloc(MAX_UPLOAD_BYTES);
      syntheticFile("pdf").copy(exact);
      expect(validateUpload({ bytes: exact, contentType: "application/pdf" }).size).toBe(15 * 1024 * 1024);
      const over = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
      syntheticFile("pdf").copy(over);
      const r = rejection(() => validateUpload({ bytes: over, contentType: "application/pdf" }));
      expect(r).toMatchObject({ code: "validation_failed", reason: "too_large" });
      expect(r.message).toContain("15 MB");
    });

    it("only accepts bytes", () => {
      expect(() => validateUpload({ bytes: "%PDF-1.7" as unknown as Uint8Array })).toThrow(TypeError);
    });
  });

  describe("does not trust the declared type", () => {
    it("rejects a real file declared as a different accepted type", () => {
      expect(rejection(() => validateUpload({ bytes: syntheticFile("pdf"), contentType: "image/png", filename: "x.png" })).reason).toBe("type_mismatch");
      expect(rejection(() => validateUpload({ bytes: syntheticFile("png"), contentType: "image/jpeg" })).reason).toBe("type_mismatch");
      expect(rejection(() => validateUpload({ bytes: syntheticFile("jpeg"), contentType: "application/pdf" })).reason).toBe("type_mismatch");
      expect(rejection(() => validateUpload({ bytes: syntheticFile("webp"), contentType: "image/heic" })).reason).toBe("type_mismatch");
      expect(rejection(() => validateUpload({ bytes: syntheticFile("heic"), contentType: "image/jpeg" })).reason).toBe("type_mismatch");
    });

    it("rejects a real file declared as something we would never serve", () => {
      for (const declared of ["text/html", "image/svg+xml", "application/x-msdownload", "application/javascript", "text/plain", "nonsense"]) {
        expect(rejection(() => validateUpload({ bytes: syntheticFile("pdf"), contentType: declared })).reason, declared).toBe("type_mismatch");
      }
    });

    const spoofs: Array<[string, Buffer]> = [
      ["HTML", text("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>")],
      ["HTML without doctype", text("<html><head></head></html>")],
      ["bare script", text("<script>fetch('/api')</script>")],
      ["HTML after whitespace", text("\n\n   \t<HTML><BODY onload=alert(1)>")],
      ["HTML with UTF-8 BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), text("<html>")])],
      ["HTML in UTF-16LE", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<html><script>", "utf16le")])],
      ["SVG", text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')],
      ["SVG with XML prolog", text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      ["Windows executable", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64), text("This program cannot be run in DOS mode")])],
      ["ELF executable", Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(32)])],
      ["Mach-O executable", Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(32)])],
      ["Java class", Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.alloc(32)])],
      ["shell script", text("#!/bin/sh\nrm -rf /\n")],
      ["ZIP / Office document / APK", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)])],
      ["WebAssembly", Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.alloc(8)])],
    ];
    it.each(spoofs)("rejects %s whatever type and name it claims", (_label, bytes) => {
      for (const [contentType, filename] of [
        ["application/pdf", "award-letter.pdf"],
        ["image/png", "photo.png"],
        ["image/jpeg", "photo.jpg"],
        ["", "photo.heic"],
        ["application/octet-stream", "file"],
      ]) {
        expect(rejection(() => validateUpload({ bytes, contentType, filename })).reason).toBe("dangerous_type");
      }
    });

    it("rejects other formats as unsupported", () => {
      const others: Array<[string, Buffer]> = [
        ["GIF", syntheticFile("gif")],
        ["AVIF", syntheticFile("avif")],
        ["MP4 video", syntheticFile("mp4")],
        ["plain text", text("Household income: 42000 (synthetic)")],
        ["JSON", text('{"synthetic":true}')],
        ["TIFF", Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(16)])],
        ["BMP", Buffer.concat([Buffer.from("BM"), Buffer.alloc(16)])],
        ["random bytes", Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09])],
        ["a single byte", Buffer.from([0xff])],
      ];
      for (const [label, bytes] of others) {
        expect(rejection(() => validateUpload({ bytes, contentType: "application/pdf", filename: "a.pdf" })).reason, label).toBe("unsupported_type");
      }
    });

    it("requires the signature at offset 0 (no polyglots with something in front)", () => {
      const pdf = syntheticFile("pdf");
      expect(rejection(() => validateUpload({ bytes: Buffer.concat([text("<html><script>alert(1)</script></html>\n"), pdf]), contentType: "application/pdf" })).reason).toBe("dangerous_type");
      expect(rejection(() => validateUpload({ bytes: Buffer.concat([text("junk junk junk\n"), pdf]), contentType: "application/pdf" })).reason).toBe("unsupported_type");
      expect(rejection(() => validateUpload({ bytes: Buffer.concat([Buffer.from([0x00]), syntheticFile("jpeg")]), contentType: "image/jpeg" })).reason).toBe("unsupported_type");
    });

    it("rejects look-alike headers", () => {
      expect(rejection(() => validateUpload({ bytes: text("%PDF-") })).reason).toBe("unsupported_type");
      expect(rejection(() => validateUpload({ bytes: text("%PDF-x.y pretend") })).reason).toBe("unsupported_type");
      expect(rejection(() => validateUpload({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) })).reason).toBe("unsupported_type");
      expect(rejection(() => validateUpload({ bytes: Buffer.concat([text("RIFF"), Buffer.alloc(4), text("WAVEfmt ")]) })).reason).toBe("unsupported_type");
      expect(rejection(() => validateUpload({ bytes: Buffer.concat([text("RIFF"), Buffer.alloc(4), text("WEBPJUNK")]) })).reason).toBe("unsupported_type");
    });

    it("rejects HEIF containers that are video, sequences, AVIF or malformed", () => {
      const box = (size: number, major: string, compat: string[]) => {
        const b = Buffer.concat([Buffer.alloc(4), text("ftyp"), text(major), Buffer.alloc(4), ...compat.map(text), Buffer.alloc(16)]);
        b.writeUInt32BE(size);
        return b;
      };
      expect(sniffContentType(box(24, "heic", ["mif1", "heic"]))).toBe("image/heic");
      expect(sniffContentType(box(24, "heix", ["mif1", "heic"]))).toBe("image/heic");
      expect(sniffContentType(box(24, "mif1", ["mif1", "heic"]))).toBe("image/heic");
      expect(sniffContentType(box(24, "mif1", ["mif1", "miaf"]))).toBe("image/heif");
      expect(sniffContentType(box(24, "hevc", ["msf1", "hevc"]))).toBeNull();
      expect(sniffContentType(box(24, "msf1", ["msf1", "hevc"]))).toBeNull();
      expect(sniffContentType(box(24, "mif1", ["mif1", "avif"]))).toBeNull();
      expect(sniffContentType(box(24, "qt  ", ["qt  ", "    "]))).toBeNull();
      expect(sniffContentType(box(8, "heic", ["mif1", "heic"]))).toBeNull();
      expect(sniffContentType(box(22, "heic", ["mif1", "heic"]))).toBeNull();
      expect(sniffContentType(box(0xffffff00, "heic", ["mif1", "heic"]))).toBeNull();
      expect(sniffContentType(box(1, "heic", ["mif1", "heic"]))).toBeNull();
    });

    it("explains the rejection without revealing how detection works", () => {
      const r = rejection(() => validateUpload({ bytes: text("<html>"), contentType: "application/pdf" }));
      expect(r.message).toBe("This file type is not supported. Please upload a PDF or a photo (JPEG, PNG, HEIC or WebP).");
      expect(rejection(() => validateUpload({ bytes: syntheticFile("pdf"), contentType: "image/png" })).message).toMatch(/do not match/);
    });
  });

  describe("file names", () => {
    const pdf = syntheticFile("pdf");
    const name = (filename: string | null | undefined, bytes: Buffer = pdf) => validateUpload({ bytes, filename }).filename;

    it("gives the name an extension that matches the real type", () => {
      expect(name("letter.html")).toBe("letter.pdf");
      expect(name("letter.pdf.exe")).toBe("letter.pdf");
      expect(name("photo.png")).toBe("photo.pdf");
      expect(name("SCAN.PDF")).toBe("SCAN.pdf");
      expect(name("award letter")).toBe("award letter.pdf");
      expect(name("W-2 form.2026")).toBe("W-2 form.2026.pdf");
      expect(name("my.tax.return")).toBe("my.tax.return.pdf");
      expect(name("x.svg.html.js")).toBe("x.pdf");
      expect(name("IMG_0001.JPEG", syntheticFile("jpeg"))).toBe("IMG_0001.jpeg");
      expect(name("IMG_0001.jpg", syntheticFile("jpeg"))).toBe("IMG_0001.jpg");
      expect(name("IMG_0002.HEIC", syntheticFile("heic"))).toBe("IMG_0002.heic");
      expect(name("IMG_0002.heif", syntheticFile("heic"))).toBe("IMG_0002.heif");
      expect(name("IMG_0003.jpg", syntheticFile("png"))).toBe("IMG_0003.png");
    });

    it("falls back to a neutral name", () => {
      expect(name(undefined)).toBe("upload.pdf");
      expect(name(null)).toBe("upload.pdf");
      expect(name("")).toBe("upload.pdf");
      expect(name("   ")).toBe("upload.pdf");
      expect(name("....")).toBe("upload.pdf");
      expect(name("/")).toBe("upload.pdf");
    });

    it("drops directory parts, so a name can never be a path", () => {
      expect(name("C:\\Users\\Maria\\Documents\\taxes 2026.pdf")).toBe("taxes 2026.pdf");
      expect(name("../../../etc/passwd")).toBe("passwd.pdf");
      expect(name("/var/tmp/.hidden.pdf")).toBe("hidden.pdf");
      expect(name("..\\..\\boot.ini")).toBe("boot.pdf");
    });

    it("removes control and invisible characters, including the right-to-left override used to fake extensions", () => {
      expect(name("a\r\nSet-Cookie: x=1.pdf")).toBe("aSet-Cookie_ x=1.pdf");
      expect(name("tab\there\u0000.pdf")).toBe("tabhere.pdf");
      expect(name(`invoice${cp(0x202e)}fdp.exe`)).toBe("invoicefdp.pdf");
      expect(name(`zero${cp(0x200b)}width${cp(0xfeff)}.pdf`)).toBe("zerowidth.pdf");
      expect(name(`sep${cp(0x2028)}arator.pdf`)).toBe("separator.pdf");
    });

    it("neutralizes characters that are special to shells, HTML and filesystems", () => {
      expect(name('<img src=x onerror="alert(1)">.pdf')).toBe("_img src=x onerror=_alert(1)__.pdf");
      expect(name("what?*|.pdf")).toBe("what___.pdf");
      expect(name("CON.pdf")).toBe("_CON.pdf");
      expect(name("lpt1")).toBe("_lpt1.pdf");
      expect(name("console.pdf")).toBe("console.pdf");
    });

    it("keeps letters from any language", () => {
      const spanish = `declaraci${cp(0xf3)}n de impuestos 2026.pdf`;
      expect(name(spanish)).toBe(spanish);
      // Decomposed input (o + combining acute) is normalized to the composed form.
      expect(name(`declaracio${cp(0x301)}n.pdf`)).toBe(`declaraci${cp(0xf3)}n.pdf`);
      const cjk = `${cp(0x7a0e, 0x52a1)}.pdf`;
      expect(name(cjk)).toBe(cjk);
    });

    it("bounds the length and keeps the extension", () => {
      const long = name(`${"a".repeat(400)}.pdf`);
      expect(Array.from(long)).toHaveLength(120);
      expect(long.endsWith(".pdf")).toBe(true);
      const emoji = sanitizeFilename(`${cp(0x1f600).repeat(200)}.pdf`);
      expect(Array.from(emoji)).toHaveLength(120);
      expect(emoji.endsWith(".pdf")).toBe(true);
      expect(emoji.isWellFormed()).toBe(true);
    });
  });

  describe("helpers", () => {
    it("lists the accepted types and an accept attribute that agrees with them", () => {
      expect([...ALLOWED_UPLOAD_CONTENT_TYPES].sort()).toEqual(["application/pdf", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp"]);
      for (const type of ALLOWED_UPLOAD_CONTENT_TYPES) expect(UPLOAD_ACCEPT_ATTRIBUTE.split(",")).toContain(type);
      expect(UPLOAD_ACCEPT_ATTRIBUTE).not.toMatch(/svg|html|\*/);
    });

    it("sniffDangerousContent is quiet for accepted and merely unknown files", () => {
      for (const kind of ["pdf", "jpeg", "png", "webp", "heic", "gif"] as const) expect(sniffDangerousContent(syntheticFile(kind))).toBeNull();
      expect(sniffDangerousContent(text("a < b, plain text"))).toBeNull();
      expect(sniffDangerousContent(text("<svg/>"))).toBe("SVG or XML document");
      expect(sniffDangerousContent(text("<!-- comment --><p>hi</p>"))).toBe("HTML document");
    });

    it("sanitizeFilename uses the given fallback", () => {
      expect(sanitizeFilename(null)).toBe("file");
      expect(sanitizeFilename("  ", "evidence.pdf")).toBe("evidence.pdf");
      expect(sanitizeFilename("ok name.csv")).toBe("ok name.csv");
    });
  });
});
