/**
 * Reads the upload route's answer into what the file list shows. Pure, so every failure shape can be tested: a
 * localized message from the server, a network failure, a body that is not ours, or a duplicate file.
 */
import { getDictionary, type Locale } from "@/i18n";

export interface UploadOutcome {
  /** HTTP status; 0 when the request never completed (offline, aborted). */
  status: number;
  body: unknown;
}

export type UploadVerdict = { kind: "ok" } | { kind: "duplicate"; message: string } | { kind: "error"; message: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readUploadOutcome(outcome: UploadOutcome, locale: Locale): UploadVerdict {
  const t = getDictionary(locale).errors;
  if (outcome.status === 0) return { kind: "error", message: t.network };
  const body = record(outcome.body);
  if (body?.ok === true && outcome.status >= 200 && outcome.status < 300) {
    const data = record(body.data);
    return data?.duplicate === true ? { kind: "duplicate", message: t.files.duplicate } : { kind: "ok" };
  }
  const error = record(body?.error);
  const message = typeof error?.message === "string" && error.message.trim().length > 0 ? error.message : null;
  if (message) return { kind: "error", message };
  if (outcome.status === 413) return { kind: "error", message: t.files.tooLarge };
  if (outcome.status === 401) return { kind: "error", message: t.signInAgain };
  return { kind: "error", message: t.generic };
}
