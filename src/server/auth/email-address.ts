import { z } from "zod";
import { invalid } from "@/lib/errors";

/** Sign-in email addresses: trimmed, lower-cased (one `users` row per address), RFC-shaped, at most 254 characters. */
export const emailAddressSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Normalises an email address or throws `validation_failed` with a `fields.email` message a person can act on. */
export function normalizeEmail(raw: unknown): string {
  const parsed = emailAddressSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Enter a valid email address.", { fields: { email: "Enter a valid email address." } });
  return parsed.data;
}
