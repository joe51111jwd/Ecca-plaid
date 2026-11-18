import { invalid } from "@/lib/errors";

/**
 * Gatekeeper for files that people upload (award letters, tax returns, W-2s, pay stubs).
 *
 * The declared content type and the file name come from the uploader's device and are not trusted: the type
 * is decided from the file's own leading bytes, and only document and photo formats are let through.
 */

/** Largest accepted upload. Phone photos and multi-page scans of a tax return fit comfortably. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type UploadContentType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

interface TypeRule {
  /** Extension given to files that arrive without a usable one. */
  extension: string;
  /** Extensions that are left as they are. */
  extensions: readonly string[];
  /** Declared content types that are consistent with this detected type. */
  declaredAs: readonly string[];
}

const HEIF_FAMILY = ["image/heic", "image/heif"] as const;

const TYPE_RULES: Record<UploadContentType, TypeRule> = {
  "application/pdf": { extension: "pdf", extensions: ["pdf"], declaredAs: ["application/pdf", "application/x-pdf"] },
  "image/jpeg": { extension: "jpg", extensions: ["jpg", "jpeg"], declaredAs: ["image/jpeg", "image/jpg", "image/pjpeg"] },
  "image/png": { extension: "png", extensions: ["png"], declaredAs: ["image/png", "image/x-png"] },
  "image/webp": { extension: "webp", extensions: ["webp"], declaredAs: ["image/webp"] },
  // Devices label the same HEIF container either way, so the two are one family for mismatch purposes.
  "image/heic": { extension: "heic", extensions: ["heic", "heif"], declaredAs: HEIF_FAMILY },
  "image/heif": { extension: "heif", extensions: ["heif", "heic"], declaredAs: HEIF_FAMILY },
};

export const ALLOWED_UPLOAD_CONTENT_TYPES = Object.keys(TYPE_RULES) as UploadContentType[];

/** Value for an `<input type="file" accept="…">` attribute. */
export const UPLOAD_ACCEPT_ATTRIBUTE = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

/** Browsers send these (or nothing) when they do not recognize a file, which is common for HEIC. */
const UNDECLARED = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export type UploadRejectionReason = "empty" | "too_large" | "unsupported_type" | "dangerous_type" | "type_mismatch";

const MESSAGES: Record<UploadRejectionReason, string> = {
  empty: "This file is empty. Please choose a different file.",
  too_large: "This file is too large. The limit is 15 MB.",
  unsupported_type: "This file type is not supported. Please upload a PDF or a photo (JPEG, PNG, HEIC or WebP).",
  dangerous_type: "This file type is not supported. Please upload a PDF or a photo (JPEG, PNG, HEIC or WebP).",
  type_mismatch: "This file's contents do not match its type. Please upload the original PDF or photo.",
};

function reject(reason: UploadRejectionReason, extra: Record<string, unknown> = {}): never {
  throw invalid(MESSAGES[reason], { reason, ...extra });
}

/* ------------------------------------------------------------------------------------------ sniffing */

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[offset + i] !== signature[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** ISO-BMFF `ftyp` box → HEIC/HEIF still image, or null (video, AVIF, image sequences and malformed boxes are not accepted). */
function sniffHeif(bytes: Uint8Array): "image/heic" | "image/heif" | null {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  if (boxSize < 16 || boxSize > bytes.length || boxSize % 4 !== 0) return null;
  const major = ascii(bytes, 8, 12);
  const compatible: string[] = [];
  for (let offset = 16; offset + 4 <= boxSize && compatible.length < 64; offset += 4) compatible.push(ascii(bytes, offset, offset + 4));
  if (AVIF_BRANDS.has(major) || compatible.some((b) => AVIF_BRANDS.has(b))) return null;
  if (HEIC_BRANDS.has(major)) return "image/heic";
  if (major === "mif1") return compatible.some((b) => HEIC_BRANDS.has(b)) ? "image/heic" : "image/heif";
  return null;
}

/**
 * Identifies a file by its magic bytes. Returns one of the accepted types or null. Signatures must sit at
 * offset 0: a file with anything in front of its header (the classic polyglot trick) is not accepted.
 */
export function sniffContentType(bytes: Uint8Array): UploadContentType | null {
  if (/^%PDF-\d\.\d/.test(ascii(bytes, 0, 8))) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && ascii(bytes, 12, 16) === "IHDR") return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 16))) return "image/webp";
  return sniffHeif(bytes);
}

const MARKUP_START = /^<(?:!doctype|html|head|body|script|svg|\?xml|!--|iframe|img|a\s|math|style|link|meta|object|embed)/;

/** Names what a rejected file actually is when it is something that can run or script a browser. Purely for a clearer rejection. */
export function sniffDangerousContent(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x4d, 0x5a])) return "Windows executable";
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "ELF executable";
  for (const magic of [
    [0xfe, 0xed, 0xfa, 0xce],
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
    [0xca, 0xfe, 0xba, 0xbe],
  ]) {
    if (startsWith(bytes, magic)) return "Mach-O executable or Java class";
  }
  if (startsWith(bytes, [0x23, 0x21])) return "script";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "ZIP archive (including Office documents and app packages)";
  if (startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) return "WebAssembly module";
  // Text formats: skip a byte-order mark and leading whitespace, then look at how the text opens.
  let head = ascii(bytes, 0, 1024);
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) head = head.slice(3);
  else if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) head = head.slice(2).replace(/\u0000/g, "");
  head = head.replace(/^\s+/, "").toLowerCase();
  if (MARKUP_START.test(head)) return /^<(?:svg|\?xml)/.test(head) || head.includes("<svg") ? "SVG or XML document" : "HTML document";
  return null;
}

/* ----------------------------------------------------------------------------------------- file names */

const MAX_FILENAME_LENGTH = 120;
/** C0/C1 controls, DEL, zero-width and bidirectional-override characters (used to disguise extensions), BOM, line separators. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * Makes an uploader-supplied file name safe to store, show and send back in a download header: no directory
 * parts, no control or invisible characters, no characters that are special on any filesystem, no leading
 * dots, bounded length. Letters in any language are kept.
 */
export function sanitizeFilename(raw: string | null | undefined, fallback = "file"): string {
  let name = (raw ?? "").normalize("NFC");
  name = name.split(/[\\/]/).pop() ?? "";
  name = name
    .replace(INVISIBLE, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  const chars = Array.from(name);
  if (chars.length > MAX_FILENAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 11 ? Array.from(name.slice(dot)) : [];
    name = (chars.slice(0, MAX_FILENAME_LENGTH - ext.length).join("").replace(/[. ]+$/, "") + ext.join("")).trim();
  }
  return name.length > 0 ? name : fallback;
}

/**
 * Gives the name an extension that matches what the file really is, so a PDF uploaded as "letter.html" is
 * stored (and later downloaded) as "letter.pdf" and can never be opened as something else.
 */
function withMatchingExtension(name: string, type: UploadContentType): string {
  const rule = TYPE_RULES[type];
  let stem = name;
  for (let i = 0; i < 3; i++) {
    const dot = stem.lastIndexOf(".");
    if (dot <= 0) break;
    const ext = stem.slice(dot + 1).toLowerCase();
    if (rule.extensions.includes(ext)) return `${stem.slice(0, dot)}.${ext}`;
    // Only strip things that look like file extensions ("html", "exe", "docx"), not "2026" or a word.
    if (!/^(?=.*[a-z])[a-z0-9]{1,5}$/.test(ext)) break;
    stem = stem.slice(0, dot);
  }
  return `${stem}.${rule.extension}`;
}

/* ---------------------------------------------------------------------------------------- validation */

export interface UploadInput {
  bytes: Uint8Array;
  /** As declared by the uploader's browser. Not trusted. */
  contentType?: string | null;
  /** As named on the uploader's device. Not trusted. */
  filename?: string | null;
}

export interface ValidatedUpload {
  /** Detected from the bytes. Store and serve this, never the declared type. */
  contentType: UploadContentType;
  /** Canonical extension for the detected type, without the dot. */
  extension: string;
  /** Sanitized name whose extension matches the detected type. */
  filename: string;
  size: number;
}

/**
 * Validates an upload or throws `validation_failed` whose `details.reason` is an {@link UploadRejectionReason}
 * (use it to pick a translated message):
 *
 *  - at most 15 MB and not empty;
 *  - really a PDF, JPEG, PNG, WebP or HEIC/HEIF image, judged by magic bytes;
 *  - the declared content type, when one was given, agrees with the bytes;
 *  - executables, scripts, archives, HTML and SVG are refused whatever they claim to be.
 */
export function validateUpload(input: UploadInput): ValidatedUpload {
  const { bytes } = input;
  if (!(bytes instanceof Uint8Array)) throw new TypeError("validateUpload: bytes must be a Uint8Array");
  if (bytes.byteLength === 0) reject("empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) reject("too_large", { maxBytes: MAX_UPLOAD_BYTES, size: bytes.byteLength });

  const detected = sniffContentType(bytes);
  if (!detected) {
    if (sniffDangerousContent(bytes)) reject("dangerous_type");
    reject("unsupported_type");
  }

  const declared = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!UNDECLARED.has(declared) && !TYPE_RULES[detected].declaredAs.includes(declared)) {
    reject("type_mismatch", { detected });
  }

  const rule = TYPE_RULES[detected];
  return {
    contentType: detected,
    extension: rule.extension,
    filename: withMatchingExtension(sanitizeFilename(input.filename, "upload"), detected),
    size: bytes.byteLength,
  };
}
