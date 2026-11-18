/**
 * File type from the bytes themselves. The declared content type is only a tie-breaker for plain text:
 * a browser's content type is the family's claim, not evidence.
 */
import { isPdfBytes } from "./pdf-text";

export type FileType = "pdf" | "jpeg" | "png" | "heic" | "webp" | "text" | "unknown";

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
}

export function detectFileType(bytes: Uint8Array, contentType = ""): FileType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(ascii(bytes, 8, 12))) return "heic";
  if (bytes.length > 0 && isPdfBytes(bytes)) return "pdf";
  if (/^text\/plain\b/i.test(contentType.trim()) && bytes.length > 0) {
    const sample = bytes.subarray(0, 4096);
    // Plain text has no NUL bytes and few control characters.
    let control = 0;
    for (const b of sample) {
      if (b === 0) return "unknown";
      if (b < 9 || (b > 13 && b < 32)) control++;
    }
    if (control / sample.length < 0.01) return "text";
  }
  return "unknown";
}
