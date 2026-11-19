/**
 * Reads the family's form posts into the shapes the services take. Only the shape is checked here (what was
 * chosen, what is blank); the services validate the content (names, dates, Texas, custody rules) and their field
 * errors are localized by ./errors. Pure: FormData in, plain data out.
 */
import { z } from "zod";
import type { DocumentKind, MemberKind } from "@/db/schema";
import { getDictionary, isLocale, type Locale } from "@/i18n";

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; data: T } | { ok: false; fields: FieldErrors };

/** The text of a form field; files and missing fields read as "". */
export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export function localeOf(form: FormData): Locale {
  const v = text(form, "lang");
  return isLocale(v) ? v : "en";
}

/* ------------------------------------------------------------------------------------- members */

/** What the family may choose for a person (the household service's MemberKind values). */
export const MEMBER_KIND_CHOICES = ["adult", "student", "child", "other"] as const satisfies readonly MemberKind[];

/** Relationships in the order the form lists them (the households service's RELATIONSHIPS). */
export const RELATIONSHIP_CHOICES = [
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
export type RelationshipChoice = (typeof RELATIONSHIP_CHOICES)[number];

/**
 * Whether the form asks for this person's date of birth. Only when the age is not known from who they are: the
 * income rules count adults (18 or older) in full, so a person listed as "someone else" needs a date of birth to
 * know which side of 18 they are on. Nobody else is asked.
 */
export function asksDateOfBirth(kind: MemberKind): boolean {
  return kind === "other";
}

export interface MemberFormData {
  kind: MemberKind;
  firstName: string;
  lastName: string;
  relationship: RelationshipChoice;
  /** Present only for a person whose date of birth is asked for. */
  dob?: string;
}

export function parseMemberForm(form: FormData, locale: Locale): Parsed<MemberFormData> {
  const t = getDictionary(locale).errors.fields;
  const fields: FieldErrors = {};
  const kind = text(form, "kind");
  const relationship = text(form, "relationship");
  const firstName = text(form, "firstName").trim();
  const lastName = text(form, "lastName").trim();
  if (!(MEMBER_KIND_CHOICES as readonly string[]).includes(kind)) fields.kind = t.kind;
  if (!(RELATIONSHIP_CHOICES as readonly string[]).includes(relationship)) fields.relationship = t.relationship;
  if (!firstName) fields.firstName = t.firstName;
  if (!lastName) fields.lastName = t.lastName;
  const dob = text(form, "dob").trim();
  if (kind === "other" && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) fields.dob = t.dob;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const memberKind = kind as MemberKind;
  return {
    ok: true,
    data: { kind: memberKind, firstName, lastName, relationship: relationship as RelationshipChoice, ...(asksDateOfBirth(memberKind) ? { dob } : {}) },
  };
}

export function parseOwnerForm(form: FormData, locale: Locale): Parsed<Omit<MemberFormData, "kind" | "dob">> {
  const t = getDictionary(locale).errors.fields;
  const fields: FieldErrors = {};
  const relationship = text(form, "relationship");
  const firstName = text(form, "firstName").trim();
  const lastName = text(form, "lastName").trim();
  if (!(RELATIONSHIP_CHOICES as readonly string[]).includes(relationship) || relationship === "self") fields.relationship = t.relationship;
  if (!firstName) fields.firstName = t.firstName;
  if (!lastName) fields.lastName = t.lastName;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, data: { firstName, lastName, relationship: relationship as RelationshipChoice } };
}

/* ------------------------------------------------------------------------------------- address */

export interface AddressFormData {
  line1: string;
  line2: string | null;
  city: string;
  /** The form only serves Texas households; the geography service checks the ZIP is a Texas one. */
  state: "TX";
  zip: string;
}

export function parseAddressForm(form: FormData, locale: Locale): Parsed<AddressFormData> {
  const t = getDictionary(locale).errors.fields;
  const fields: FieldErrors = {};
  const line1 = text(form, "line1").trim();
  const line2 = text(form, "line2").trim();
  const city = text(form, "city").trim();
  const zip = text(form, "zip").trim();
  if (!line1) fields.line1 = t.line1;
  if (!city) fields.city = t.city;
  if (!/^\d{5}(-?\d{4})?$/.test(zip)) fields.zip = t.zip;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, data: { line1, line2: line2 || null, city, state: "TX", zip } };
}

export function parseCountyForm(form: FormData, locale: Locale): Parsed<{ fips: string }> {
  const fips = text(form, "fips").trim();
  if (!/^48\d{3}$/.test(fips)) return { ok: false, fields: { fips: getDictionary(locale).errors.fields.county } };
  return { ok: true, data: { fips } };
}

/* ------------------------------------------------------------------------------------- custody */

/** The households service's CustodyInput. */
export interface CustodyFormData {
  livesInMultipleHouseholds: boolean | "unknown";
  monthsInThisHousehold?: number | null;
  equalTime?: boolean | "unknown" | null;
  thisHouseholdHasHigherIncome?: "yes" | "no" | "unknown" | null;
  notes?: string | null;
}

const triState = z.enum(["yes", "no", "unsure"]);

function tri(value: string): boolean | "unknown" | null {
  const parsed = triState.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data === "yes" ? true : parsed.data === "no" ? false : "unknown";
}

/**
 * The living-arrangement answers. "Not sure" is passed on as "unknown" (the service then flags the case for a
 * reviewer); follow-up answers are only read when the student lives in more than one home, because the form
 * hides them otherwise and a hidden stale answer must not create a contradiction.
 */
export function parseCustodyForm(form: FormData, locale: Locale): Parsed<CustodyFormData> {
  const t = getDictionary(locale).errors.fields;
  const lives = tri(text(form, "lives"));
  if (lives === null) return { ok: false, fields: { lives: t.livesInMultipleHouseholds } };
  const notes = text(form, "notes").trim() || null;
  if (lives === false) return { ok: true, data: { livesInMultipleHouseholds: false, ...(notes ? { notes } : {}) } };

  const monthsRaw = text(form, "months").trim();
  let months: number | null = null;
  if (monthsRaw !== "") {
    if (!/^\d{1,2}$/.test(monthsRaw) || Number(monthsRaw) > 12) return { ok: false, fields: { months: t.months } };
    months = Number(monthsRaw);
  }
  const higher = text(form, "higher");
  const higherIncome = higher === "yes" || higher === "no" ? higher : higher === "unsure" ? "unknown" : null;
  return {
    ok: true,
    data: { livesInMultipleHouseholds: lives, monthsInThisHousehold: months, equalTime: tri(text(form, "equal")), thisHouseholdHasHigherIncome: higherIncome, notes },
  };
}

/* ----------------------------------------------------------------------------------- documents */

/** What the family can say a file is (the documents service also accepts "unknown", which the form never offers). */
export const UPLOAD_KIND_CHOICES = ["award_letter", "tax_return", "irs_transcript", "w2", "pay_stub", "other_income"] as const satisfies readonly DocumentKind[];
export type UploadKindChoice = (typeof UPLOAD_KIND_CHOICES)[number];

export function isUploadKind(value: unknown): value is UploadKindChoice {
  return typeof value === "string" && (UPLOAD_KIND_CHOICES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------------------- misc */

/** A checkbox that must be ticked: browsers send "on" (or the given value) only when it is. */
export function isChecked(form: FormData, name: string): boolean {
  const v = form.get(name);
  return typeof v === "string" && v.length > 0;
}

/** A 64-character lowercase hex SHA-256 (the hash of the words that were shown), or null. */
export function shownSha(form: FormData, name = "sha"): string | null {
  const v = text(form, name);
  return /^[0-9a-f]{64}$/.test(v) ? v : null;
}
