import type { z } from "zod";
import { invalid } from "@/lib/errors";

/**
 * Reading admin form submissions. Every admin form posts plain FormData; these helpers turn it into the plain
 * objects the zod schemas in ./forms validate, so the schemas never see `File` or `null` surprises.
 */

/** A text field's value; "" for a missing field or a file. */
export function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** A checkbox or switch: true only when it was submitted ticked. */
export function readFlag(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

/** An uploaded file, or null when none was chosen (browsers send an empty, nameless file for an empty input). */
export function readFile(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  if (value === null || typeof value === "string") return null;
  if (value.size === 0 && value.name === "") return null;
  return value;
}

/** First message per field of a zod error, keyed by the top-level field name (the form control's `name`). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "form";
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
