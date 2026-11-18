/**
 * Input validation shared by the tax-math functions. Every public function parses its argument with a zod
 * schema and rejects anything else with `AppError("validation_failed")`, so a NaN, a float, a negative amount
 * or a misspelled field can never reach the arithmetic.
 */
import { z } from "zod";
import { invalid } from "@/lib/errors";

/** Integer US cents, zero or more, within the safe-integer range (rejects NaN, floats, infinities, strings). */
export const centsSchema = z.number("Must be a whole number of cents").int("Must be a whole number of cents").min(0, "Must not be negative");

/** Basis points of a whole: 0 to 10,000. */
export const bpsSchema = z
  .number("Must be a whole number of basis points")
  .int("Must be a whole number of basis points")
  .min(0, "Must not be negative")
  .max(10_000, "Must not exceed 10,000 basis points");

/** A real calendar date written YYYY-MM-DD. */
export const isoDateSchema = z.iso.date("Must be a calendar date in YYYY-MM-DD form");

/** A valid `Date` instant. */
export const instantSchema = z.date("Must be a valid date and time");

/**
 * Years accepted for tax years and carryforward origin years. Sanity bounds on input only (they stop a
 * mistyped year from producing a confident-looking answer); they are not legal rules.
 */
export const TAX_YEAR_INPUT_RANGE = Object.freeze({ min: 2000, max: 2200 });

export const taxYearSchema = z
  .number("Must be a four-digit year")
  .int("Must be a four-digit year")
  .min(TAX_YEAR_INPUT_RANGE.min, `Must be ${TAX_YEAR_INPUT_RANGE.min} or later`)
  .max(TAX_YEAR_INPUT_RANGE.max, `Must be ${TAX_YEAR_INPUT_RANGE.max} or earlier`);

/** Parses `input` or throws `validation_failed` with one message per offending field in `details.fields`. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown, what: string): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  const [firstKey, firstMessage] = Object.entries(fields)[0];
  throw invalid(`Invalid ${what}: ${firstKey === "_" ? "" : `${firstKey}: `}${firstMessage}`, { fields });
}

/** Adds cents amounts, refusing a total outside the safe-integer range instead of silently losing precision. */
export function sumCents(field: string, ...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) total += amount;
  if (!Number.isSafeInteger(total)) {
    throw invalid(`${field} is too large to compute exactly`, { fields: { [field]: "Amount is too large" } });
  }
  return total;
}
