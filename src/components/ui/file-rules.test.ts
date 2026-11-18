import { describe, expect, it } from "vitest";
import { formatBytes, matchesAccept, partitionFiles } from "./file-rules";

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("matchesAccept", () => {
  const accept = "application/pdf,image/*,.heic";

  it("accepts everything when there is no accept list", () => {
    expect(matchesAccept(file("a.exe", "application/x-msdownload"), undefined)).toBe(true);
    expect(matchesAccept(file("a.exe", ""), "")).toBe(true);
    expect(matchesAccept(file("a.exe", ""), "  ")).toBe(true);
  });

  it("matches exact MIME types, wildcards and extensions, case-insensitively", () => {
    expect(matchesAccept(file("letter.pdf", "application/pdf"), accept)).toBe(true);
    expect(matchesAccept(file("photo.jpg", "image/jpeg"), accept)).toBe(true);
    expect(matchesAccept(file("PHOTO.PNG", "IMAGE/PNG"), accept)).toBe(true);
    expect(matchesAccept(file("IMG_0042.HEIC", ""), accept)).toBe(true);
    expect(matchesAccept(file("scan.pdf", ""), ".PDF, .jpg")).toBe(true);
  });

  it("rejects other types", () => {
    expect(matchesAccept(file("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), accept)).toBe(false);
    expect(matchesAccept(file("archive.zip", "application/zip"), accept)).toBe(false);
    expect(matchesAccept(file("noextension", ""), accept)).toBe(false);
  });

  it("is not fooled by look-alike names or types", () => {
    // Extension must be at the end of the name.
    expect(matchesAccept(file("letter.pdf.exe", "application/x-msdownload"), ".pdf")).toBe(false);
    // A wildcard needs a real type; an empty type does not match "image/*".
    expect(matchesAccept(file("mystery", ""), "image/*")).toBe(false);
    // "image/*" must not match "imagex/…" or "application/image".
    expect(matchesAccept(file("x", "imagex/png"), "image/*")).toBe(false);
    expect(matchesAccept(file("x", "application/image"), "image/*")).toBe(false);
    // Exact types are exact.
    expect(matchesAccept(file("x", "application/pdfx"), "application/pdf")).toBe(false);
  });
});

describe("partitionFiles", () => {
  const rules = { accept: "application/pdf,image/*", maxSizeBytes: 5_000 };

  it("splits accepted from rejected and keeps order", () => {
    const files = [file("a.pdf", "application/pdf"), file("b.zip", "application/zip"), file("c.jpg", "image/jpeg")];
    const result = partitionFiles(files, rules);
    expect(result.accepted.map((f) => f.name)).toEqual(["a.pdf", "c.jpg"]);
    expect(result.rejected).toEqual([{ file: files[1], reason: "type" }]);
  });

  it("rejects empty files and files over the size limit; the limit itself is allowed", () => {
    const files = [file("empty.pdf", "application/pdf", 0), file("exact.pdf", "application/pdf", 5_000), file("big.pdf", "application/pdf", 5_001)];
    const result = partitionFiles(files, rules);
    expect(result.accepted.map((f) => f.name)).toEqual(["exact.pdf"]);
    expect(result.rejected.map((r) => [r.file.name, r.reason])).toEqual([
      ["empty.pdf", "empty"],
      ["big.pdf", "too_large"],
    ]);
  });

  it("stops accepting once the remaining slots are used", () => {
    const files = [file("1.pdf", "application/pdf"), file("2.pdf", "application/pdf"), file("3.pdf", "application/pdf")];
    const result = partitionFiles(files, { ...rules, remainingSlots: 2 });
    expect(result.accepted.map((f) => f.name)).toEqual(["1.pdf", "2.pdf"]);
    expect(result.rejected).toEqual([{ file: files[2], reason: "too_many" }]);
  });

  it("a file refused for its type does not use up a slot", () => {
    const files = [file("x.zip", "application/zip"), file("1.pdf", "application/pdf")];
    const result = partitionFiles(files, { ...rules, remainingSlots: 1 });
    expect(result.accepted.map((f) => f.name)).toEqual(["1.pdf"]);
  });

  it("treats zero or negative remaining slots as full", () => {
    const files = [file("1.pdf", "application/pdf")];
    expect(partitionFiles(files, { remainingSlots: 0 }).rejected[0]?.reason).toBe("too_many");
    expect(partitionFiles(files, { remainingSlots: -3 }).rejected[0]?.reason).toBe("too_many");
  });

  it("accepts everything non-empty when there are no rules", () => {
    const files = [file("anything.bin", "application/octet-stream", 10 ** 9)];
    expect(partitionFiles(files).accepted).toEqual(files);
    expect(partitionFiles([])).toEqual({ accepted: [], rejected: [] });
  });
});

describe("formatBytes", () => {
  it("uses binary units with at most one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(482_113)).toBe("471 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(2_310_400)).toBe("2.2 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });

  it("rolls over to the next unit instead of printing 1024 KB", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1 MB");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("stays in GB for very large values and is empty for nonsense", () => {
    expect(formatBytes(5000 * 1024 ** 3)).toBe("5000 GB");
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
  });
});
