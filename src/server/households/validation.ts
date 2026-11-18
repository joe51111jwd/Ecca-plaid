import { z } from "zod";
import type { CustodyInfo, MemberKind } from "@/db/schema/verification";
import { invalid } from "@/lib/errors";

/**
 * Pure validation for the household intake: person names, member kinds and relationships, dates of birth,
 * and the shared-custody facts the proposed household rule needs. No database, no clock (today is a
 * parameter), so the rules can be tested as tables.
 */

/* --------------------------------------------------------------------------------------- policies */

/**
 * Policy (sources are silent): longest accepted first or last name, in Unicode code points. Long enough for
 * compound Hispanic surnames ("de la Garza Villarreal"), short enough to keep forms and evidence packs tidy.
 */
export const MAX_NAME_LENGTH = 60;
/** Policy: oldest accepted date of birth, in years before today. A typo guard, not an eligibility rule. */
export const MAX_AGE_YEARS = 120;
/** Policy: a member recorded as "adult" whose date of birth is given must be at least this old. */
export const ADULT_MIN_AGE_YEARS = 18;
/** Policy: longest free-text custody note a family can leave for the reviewer. */
export const MAX_CUSTODY_NOTES_LENGTH = 1000;

export const MEMBER_KINDS = ["adult", "student", "child", "other"] as const satisfies readonly MemberKind[];

/**
 * Relationship of a member to the student the household is being verified for. "self" is the student. The
 * proposed household is everyone residing with the student, related or not (sgo-verification-rules F19, F23),
 * so the list only describes people; it never decides who counts.
 */
export const RELATIONSHIPS = [
  "self",
  "parent",
  "stepparent",
  "foster_parent",
  "legal_guardian",
  "grandparent",
  "sibling",
  "aunt_or_uncle",
  "other_relative",
  "parent_partner",
  "unrelated",
  "other",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/* ------------------------------------------------------------------------------------------- names */

const APOSTROPHES = /[‘’ʼ`´]/g;
// Letters (any script, any accent) in runs, joined by a single apostrophe, hyphen or space. Each run starts
// with a letter: a combining mark only ever decorates the letter before it, so a "name" made of bare marks
// (invisible or stacked "Zalgo" text) is refused.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:['\- ]\p{L}[\p{L}\p{M}]*)*$/u;

export type NameCheck = { ok: true; value: string } | { ok: false; message: string };

/**
 * Normalizes a person's name: Unicode NFC, typographic apostrophes to "'", whitespace collapsed, spaces
 * around hyphens removed, trimmed. Accepts letters with accents, hyphens, apostrophes and single spaces,
 * e.g. "María-José O'Connor Peña".
 */
export function checkPersonName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, message: "Enter a name." };
  const value = raw.normalize("NFC").replace(APOSTROPHES, "'").replace(/\s+/g, " ").replace(/ ?- ?/g, "-").trim();
  if (value.length === 0) return { ok: false, message: "Enter a name." };
  if (Array.from(value).length > MAX_NAME_LENGTH) return { ok: false, message: `Use at most ${MAX_NAME_LENGTH} letters.` };
  if (!NAME_PATTERN.test(value)) return { ok: false, message: "Use letters only. Hyphens, apostrophes and spaces are fine between letters." };
  return { ok: true, value };
}

export const personNameSchema = z.string().transform((raw, ctx) => {
  const r = checkPersonName(raw);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.message });
    return z.NEVER;
  }
  return r.value;
});

/* ---------------------------------------------------------------------------------- dates of birth */

export type DobCheck = { ok: true; value: string } | { ok: false; message: string };

function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Whole years between a date of birth and `today` (both YYYY-MM-DD). */
export function ageOn(dob: string, today: string): number {
  const b = parseIsoDate(dob);
  const t = parseIsoDate(today);
  if (!b || !t) throw new Error("ageOn needs two YYYY-MM-DD dates");
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age;
}

/**
 * A date of birth as YYYY-MM-DD: a real calendar date, not after `today` and not more than
 * MAX_AGE_YEARS before it. `today` is the caller's calendar date (US Central for this product).
 */
export function checkDateOfBirth(raw: unknown, today: string): DobCheck {
  if (typeof raw !== "string") return { ok: false, message: "Enter a date of birth." };
  const value = raw.trim();
  if (!parseIsoDate(value)) return { ok: false, message: "Enter a real date as YYYY-MM-DD." };
  if (!parseIsoDate(today)) throw new Error("checkDateOfBirth needs today as YYYY-MM-DD");
  if (value > today) return { ok: false, message: "The date of birth cannot be in the future." };
  if (ageOn(value, today) > MAX_AGE_YEARS) return { ok: false, message: "Please check the year of birth." };
  return { ok: true, value };
}

/* ----------------------------------------------------------------------------------------- members */

export interface MemberInput {
  kind: MemberKind;
  firstName: string;
  lastName: string;
  relationship: Relationship;
  /** YYYY-MM-DD, or null/absent when not collected. */
  dob?: string | null;
}

export interface MemberPatch {
  kind?: MemberKind;
  firstName?: string;
  lastName?: string;
  relationship?: Relationship;
  /** A date sets it, null clears it, absent keeps it. */
  dob?: string | null;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) fields[key] ??= "Not a field of this form.";
    else fields[String(issue.path[0] ?? "member")] ??= issue.message;
  }
  return fields;
}

function memberShape(today: string) {
  const dob = z
    .string()
    .nullable()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === null) return raw;
      if (raw.trim() === "") return null;
      const r = checkDateOfBirth(raw, today);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.message });
        return z.NEVER;
      }
      return r.value;
    });
  return {
    kind: z.enum(MEMBER_KINDS, { error: "Choose who this person is." }),
    firstName: personNameSchema,
    lastName: personNameSchema,
    relationship: z.enum(RELATIONSHIPS, { error: "Choose how this person is related to the student." }),
    dob,
  };
}

function assertAdultAge(kind: MemberKind | undefined, dob: string | null | undefined, today: string): void {
  if (kind === "adult" && dob && ageOn(dob, today) < ADULT_MIN_AGE_YEARS) {
    throw invalid("Please check this person's details.", { fields: { kind: `An adult must be ${ADULT_MIN_AGE_YEARS} or older. Choose "child" or "other" for someone younger.` } });
  }
}

/** Validates and normalizes a new member. Throws validation_failed with per-field messages. */
export function parseMemberInput(input: unknown, today: string): MemberInput {
  const parsed = z.object(memberShape(today)).strict().safeParse(input);
  if (!parsed.success) throw invalid("Please check this person's details.", { fields: fieldErrors(parsed.error) });
  const out: MemberInput = { ...parsed.data, dob: parsed.data.dob ?? null };
  assertAdultAge(out.kind, out.dob, today);
  return out;
}

/**
 * Validates a partial update. `current` supplies the stored kind/date of birth so the adult-age rule is
 * checked against the member as it will be after the update.
 */
export function parseMemberPatch(input: unknown, today: string, current: { kind: MemberKind; dob: string | null }): MemberPatch {
  const parsed = z.object(memberShape(today)).partial().strict().safeParse(input);
  if (!parsed.success) throw invalid("Please check this person's details.", { fields: fieldErrors(parsed.error) });
  const patch: MemberPatch = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  const kind = patch.kind ?? current.kind;
  const dob = "dob" in patch ? patch.dob : current.dob;
  assertAdultAge(kind, dob, today);
  return patch;
}

/* ----------------------------------------------------------------------------------------- address */

export interface NormalizedAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
}

/** Trims and collapses whitespace in free-text address parts. State/ZIP normalization is the geo service's. */
export function tidyAddressText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length > 0 ? v : null;
}

/* ------------------------------------------------------------------------------------ shared custody */

export type CustodyFlagCode =
  | "shared_custody"
  | "custody_unknown"
  | "months_unknown"
  | "months_invalid"
  | "student_not_resident"
  | "months_inconsistent"
  | "longest_household_unclear"
  | "equal_time_unknown"
  | "equal_time_months_mismatch"
  | "higher_income_unknown"
  | "other_household_higher_income";

export interface CustodyFlag {
  code: CustodyFlagCode;
  message: string;
}

/** What the family told us. Everything except the first question may be left unanswered. */
export interface CustodyInput {
  /** Did the student live in more than one household during the income year? */
  livesInMultipleHouseholds: boolean | "unknown";
  monthsInThisHousehold?: number | null;
  equalTime?: boolean | "unknown" | null;
  thisHouseholdHasHigherIncome?: "yes" | "no" | "unknown" | null;
  notes?: string | null;
}

export interface CustodyValidation {
  custody: CustodyInfo;
  /** Review reasons in the `{ code, message }` shape used by verifications.decisionReasons and review_tasks. */
  flags: CustodyFlag[];
  needsReview: boolean;
  /**
   * The household the proposed rule points to, as far as the answers show. "this" for a student who lives
   * only here; for shared custody it is a suggestion for the reviewer, never a decision.
   */
  suggestedRelevantHousehold: "this" | "other" | "undetermined";
}

const MONTHS_IN_YEAR = 12;

const custodyInputSchema = z
  .object({
    livesInMultipleHouseholds: z.union([z.boolean(), z.literal("unknown")], { error: "Tell us if the student lived in more than one home." }),
    monthsInThisHousehold: z.number().nullable().optional(),
    equalTime: z.union([z.boolean(), z.literal("unknown")]).nullable().optional(),
    thisHouseholdHasHigherIncome: z.enum(["yes", "no", "unknown"]).nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

function tidyNotes(notes: string | null | undefined): string | undefined {
  const v = tidyAddressText(notes);
  if (!v) return undefined;
  return Array.from(v).slice(0, MAX_CUSTODY_NOTES_LENGTH).join("");
}

/**
 * Normalizes the shared-custody answers and lists what a reviewer must look at.
 *
 * Rule being applied (proposed 1.25F-3(c)(6)(ii)(B), sgo-verification-rules F20/F22): when the student lives
 * in more than one household during the year, the relevant household is the one where the student lived
 * "for the longest period of time"; if time is equal, the household with the highest income. The text says
 * "longest", not "majority": with three homes the longest stay can be under half the year, so only a stay of
 * more than half the year proves this home is the longest. The spec says shared custody is flagged for
 * review rather than guessed, so every multiple-household answer carries `shared_custody`; the other flags
 * say what is missing or points away from this household. An "unknown" first answer is recorded as
 * `livesInMultipleHouseholds: true` (the conservative reading that sends the case to a person) together with
 * `custody_unknown`.
 */
export function validateCustodyInfo(input: unknown): CustodyValidation {
  const parsed = custodyInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Please check the living-arrangement answers.", { fields: fieldErrors(parsed.error) });
  const data = parsed.data;
  const notes = tidyNotes(data.notes);
  const flags: CustodyFlag[] = [];
  const flag = (code: CustodyFlagCode, message: string) => flags.push({ code, message });

  const rawMonths = data.monthsInThisHousehold;
  if (rawMonths !== undefined && rawMonths !== null && (!Number.isInteger(rawMonths) || rawMonths < 0 || rawMonths > MONTHS_IN_YEAR)) {
    throw invalid("Please check the living-arrangement answers.", { fields: { monthsInThisHousehold: "Enter a whole number of months from 0 to 12." } });
  }

  if (data.livesInMultipleHouseholds === false) {
    // "Only this home" contradicted by fewer than 12 months here or by an equal split is not resolved by
    // picking one answer: it goes to a reviewer like any other unclear custody answer.
    const partYear = rawMonths !== undefined && rawMonths !== null && rawMonths < MONTHS_IN_YEAR;
    if (partYear) flag("months_inconsistent", `The family said the student lived only in this household but gave ${rawMonths} months here.`);
    else if (data.equalTime === true) flag("months_inconsistent", "The family said the student lived only in this household but also that time was split equally between households.");
    const custody: CustodyInfo = {
      livesInMultipleHouseholds: false,
      ...(rawMonths !== undefined && rawMonths !== null ? { monthsInThisHousehold: rawMonths } : {}),
      ...(notes ? { notes } : {}),
    };
    return { custody, flags, needsReview: flags.length > 0, suggestedRelevantHousehold: flags.length > 0 ? "undetermined" : "this" };
  }

  flag("shared_custody", "The student lived in more than one household during the year. A reviewer must confirm which household counts.");
  if (data.livesInMultipleHouseholds === "unknown") flag("custody_unknown", "The family did not know whether the student lived in more than one household.");

  let months: number | null = null;
  if (rawMonths === undefined || rawMonths === null) {
    flag("months_unknown", "The family did not say how many months the student lived in this household.");
  } else {
    months = rawMonths;
  }

  const equalTime = data.equalTime === true ? true : data.equalTime === false ? false : undefined;
  const higher = data.thisHouseholdHasHigherIncome ?? undefined;
  // More than half the year here proves this is the longest stay, whatever the other answers say.
  const majorityHere = months !== null && months * 2 > MONTHS_IN_YEAR && months < MONTHS_IN_YEAR;
  let suggestion: CustodyValidation["suggestedRelevantHousehold"] = majorityHere ? "this" : "undetermined";

  if (months === 0) {
    suggestion = "other";
    flag("student_not_resident", "The family said the student lived 0 months in this household.");
  }
  if (months === MONTHS_IN_YEAR) flag("months_inconsistent", "The family said the student lived in more than one household but all 12 months in this one.");

  if (equalTime === true) {
    // Equal shares of a year are 12/N months for N homes (6, 4, 3, ...); any other count contradicts "equal".
    if (months !== null && (months === 0 || months * 2 > MONTHS_IN_YEAR || MONTHS_IN_YEAR % months !== 0)) {
      flag("equal_time_months_mismatch", `The family said time was split equally but gave ${months} months in this household.`);
    } else if (higher === "yes") {
      suggestion = "this";
    }
    if (higher === "no") {
      if (suggestion !== "this") suggestion = "other";
      flag("other_household_higher_income", "Time was split equally and the other household has the higher income, so the other household may be the relevant one.");
    } else if (higher !== "yes") {
      flag("higher_income_unknown", "Time was split equally but the family did not know which household has the higher income.");
    }
  } else if (equalTime === false) {
    // Not equal and exactly half here: every other home had less than half, so this one is the longest.
    if (months !== null && months * 2 === MONTHS_IN_YEAR) suggestion = "this";
    else if (months !== null && months > 0 && months * 2 < MONTHS_IN_YEAR) {
      flag("longest_household_unclear", "The student lived in this household for less than half the year. Another household may be where the student lived longest.");
    }
  } else if (!majorityHere && months !== MONTHS_IN_YEAR && months !== 0) {
    flag("equal_time_unknown", "The family did not say whether the student's time was split equally between households.");
  }

  const custody: CustodyInfo = {
    livesInMultipleHouseholds: true,
    monthsInThisHousehold: months,
    ...(equalTime !== undefined ? { equalTime } : {}),
    ...(equalTime === true ? { thisHouseholdHasHigherIncome: higher ?? "unknown" } : {}),
    ...(notes ? { notes } : {}),
  };
  return { custody, flags, needsReview: true, suggestedRelevantHousehold: suggestion };
}
