/**
 * SYNTHETIC sample files for tests. Each has the genuine signature and container header of its format
 * followed by filler that says so; none of them is, or is derived from, a real document or photo.
 */

const FILLER = Buffer.from(" SYNTHETIC TEST FILE - NOT A REAL DOCUMENT ", "ascii");

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function ftyp(major: string, compatible: string[]): Buffer {
  const body = Buffer.concat([Buffer.from(major, "ascii"), u32be(0), ...compatible.map((c) => Buffer.from(c, "ascii"))]);
  const box = Buffer.concat([u32be(8 + body.length), Buffer.from("ftyp", "ascii"), body]);
  const mdat = Buffer.concat([u32be(8 + FILLER.length), Buffer.from("mdat", "ascii"), FILLER]);
  return Buffer.concat([box, mdat]);
}

export type SyntheticFileKind = "pdf" | "jpeg" | "png" | "webp" | "heic" | "heif" | "avif" | "mp4" | "gif";

export function syntheticFile(kind: SyntheticFileKind): Buffer {
  switch (kind) {
    case "pdf":
      return Buffer.concat([Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%", "latin1"), FILLER, Buffer.from("\n%%EOF\n", "ascii")]);
    case "jpeg":
      return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0", "ascii"), Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), FILLER, Buffer.from([0xff, 0xd9])]);
    case "png":
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        u32be(13),
        Buffer.from("IHDR", "ascii"),
        u32be(1),
        u32be(1),
        Buffer.from([8, 2, 0, 0, 0]),
        u32be(0x907753de),
        FILLER,
      ]);
    case "webp":
      return Buffer.concat([Buffer.from("RIFF", "ascii"), u32le(4 + 8 + FILLER.length), Buffer.from("WEBP", "ascii"), Buffer.from("VP8L", "ascii"), u32le(FILLER.length), FILLER]);
    case "heic":
      return ftyp("heic", ["mif1", "heic"]);
    case "heif":
      return ftyp("mif1", ["mif1", "miaf"]);
    case "avif":
      return ftyp("avif", ["avif", "mif1", "miaf"]);
    case "mp4":
      return ftyp("isom", ["isom", "iso2", "mp41"]);
    case "gif":
      return Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([1, 0, 1, 0, 0x80, 0, 0]), FILLER]);
  }
}
