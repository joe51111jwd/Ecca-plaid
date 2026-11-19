import type { z } from "zod";
import { invalid } from "@/lib/errors";
import { parseUsdToCents } from "@/lib/money";

/**
 * Reading dashboard form submissions. Every form posts plain FormData; these helpers turn it into plain values so
 * the zod schemas in ./forms never see `File` or `null` surprises.
 */

/** A text field's value, trimmed; "" for a missing field or a file. */
export function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** A text field's value, or null when blank. */
export function readOptional(formData: FormData, name: string): string | null {
  const value = readText(formData, name);
  return value === "" ? null : value;
}

/** A checkbox or switch: true only when it was submitted ticked. */
export function readFlag(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

/** Every value of a multi-select or checkbox group, strings only. */
export function readAll(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

/** Non-empty lines of a textarea, trimmed. */
export function readLines(formData: FormData, name: string): string[] {
  return readText(formData, name)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** An uploaded file, or null when none was chosen (browsers send an empty, nameless file for an empty input). */
export function readFile(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  if (value === null || typeof value === "string") return null;
  if (value.size === 0 && value.name === "") return null;
  return value;
}

/**
 * A dollar amount typed by a person ("1,700", "$1,700.50") as integer cents, or the given error. Negative amounts
 * are accepted only with `allowNegative` (a reviewer keying a net loss).
 */
export function readMoney(formData: FormData, name: string, opts: { allowNegative?: boolean; label: string }): number {
  const raw = readText(formData, name);
  if (raw === "") throw invalid(`Enter ${opts.label}.`, { fields: { [name]: `Enter ${opts.label}.` } });
  const negative = /^-/.test(raw) || /^\(.*\)$/.test(raw);
  const cents = parseUsdToCents(raw.replace(/^-|^\(|\)$/g, ""));
  if (cents === null) throw invalid(`Enter ${opts.label} as a dollar amount.`, { fields: { [name]: "Enter a dollar amount, for example 41,250.00." } });
  if (negative && !opts.allowNegative) throw invalid(`${opts.label.charAt(0).toUpperCase()}${opts.label.slice(1)} cannot be negative.`, { fields: { [name]: "Must be zero or more." } });
  return negative ? -cents : cents;
}

/** A whole number field, or null when blank; a non-integer is a validation error. */
export function readInt(formData: FormData, name: string, label: string): number | null {
  const raw = readText(formData, name);
  if (raw === "") return null;
  if (!/^-?\d{1,9}$/.test(raw)) throw invalid(`Enter ${label} as a whole number.`, { fields: { [name]: "Enter a whole number." } });
  return Number(raw);
}

/** First message per field of a zod error, keyed by the dotted path. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "form";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Parses `input` with `schema` or throws AppError `validation_failed` carrying per-field messages. */
export function parseForm<S extends z.ZodType>(schema: S, input: unknown, message = "Check the highlighted fields."): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid(message, { fields: zodFieldErrors(parsed.error) });
  return parsed.data;
}
