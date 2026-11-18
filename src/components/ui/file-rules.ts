/** Why a chosen file was not accepted. The caller turns these into its own (translated) messages. */
export type FileRejectionReason = "type" | "too_large" | "empty" | "too_many";

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export interface FileRules {
  /** Same syntax as the HTML `accept` attribute: ".pdf,image/*,application/pdf". Empty/undefined accepts anything. */
  accept?: string;
  maxSizeBytes?: number;
  /** How many more files may be added (max files minus files already listed). */
  remainingSlots?: number;
}

export interface FileRejection<F extends FileLike = FileLike> {
  file: F;
  reason: FileRejectionReason;
}

/**
 * Does a file match an `accept` list? Each entry is an extension (".pdf"), an exact MIME type
 * ("application/pdf") or a wildcard ("image/*"). Extension and type are compared case-insensitively.
 * Phone cameras often report an empty MIME type, so an extension match is enough on its own.
 */
export function matchesAccept(file: Pick<FileLike, "name" | "type">, accept: string | undefined): boolean {
  if (!accept || accept.trim() === "") return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry.startsWith(".")) return name.endsWith(entry);
      if (entry.endsWith("/*")) return type !== "" && type.startsWith(entry.slice(0, -1));
      return type === entry;
    });
}

/**
 * Splits newly chosen files into the ones to hand to the uploader and the ones to refuse, with the reason.
 * Order is preserved; once `remainingSlots` is used up, the rest are refused as "too_many".
 * This is a convenience for the person — the server must enforce the same limits again.
 */
export function partitionFiles<F extends FileLike>(files: readonly F[], rules: FileRules = {}): { accepted: F[]; rejected: Array<FileRejection<F>> } {
  const accepted: F[] = [];
  const rejected: Array<FileRejection<F>> = [];
  const slots = rules.remainingSlots === undefined ? Infinity : Math.max(0, rules.remainingSlots);
  for (const file of files) {
    if (!matchesAccept(file, rules.accept)) rejected.push({ file, reason: "type" });
    else if (file.size === 0) rejected.push({ file, reason: "empty" });
    else if (rules.maxSizeBytes !== undefined && file.size > rules.maxSizeBytes) rejected.push({ file, reason: "too_large" });
    else if (accepted.length >= slots) rejected.push({ file, reason: "too_many" });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/** 1536 → "1.5 KB", 5 242 880 → "5 MB". Binary units, at most one decimal, none from 10 up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  // Rounding can land exactly on the next unit (1023.96 KB → 1024 KB).
  if (rounded >= 1024 && unit < units.length - 1) return `1 ${units[unit + 1]}`;
  return `${rounded} ${units[unit]}`;
}
