import { z } from "zod";
import { invalid } from "@/lib/errors";
import { isUsStateCode, type UsStateCode } from "@/server/sgos";
import { FILING_STATUSES, suggestDesignation, type FilingStatus, type TaxpayerRole } from "@/taxmath";
import { MAX_GIFT_CENTS, NON_INDIVIDUAL_NAME_WORDS } from "./policy";

/**
 * The donor checkout form: what the donor may enter, how a partial save is merged into what was saved before,
 * and how the entries resolve into one contribution per taxpayer. Pure (no database, no clock).
 *
 * Every object is strict, so a field this module does not define is refused rather than stored. That is how the
 * checkout guarantees it never accepts a Social Security number, a TIN, a free-text note or a student's name
 * (donor-credit-rules.md F9 and Engineering Implications 6): there is nowhere to put one.
 */

/* ------------------------------------------------------------------ field schemas */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function text(max: number, label: string) {
  return z
    .string(`${label} must be text.`)
    .trim()
    .min(1, `Enter ${label.toLowerCase()}.`)
    .max(max, `${label} is too long.`)
    .refine((v) => !CONTROL_CHARS.test(v), `${label} contains characters that are not allowed.`);
}

const personName = (label: string) =>
  text(100, label).refine((v) => /\p{L}/u.test(v), `${label} must contain letters.`);

const cents = z
  .number("Enter an amount in cents.")
  .int("Enter a whole number of cents.")
  .min(0, "The amount cannot be negative.")
  .max(MAX_GIFT_CENTS, "The amount is too large.");

const emailField = z
  .string("Enter an email address.")
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254, "The email address is too long."));

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const contributorSchema = z.strictObject({
  firstName: personName("First name").nullish(),
  middleName: personName("Middle name").nullish(),
  lastName: personName("Last name").nullish(),
  suffix: text(20, "Suffix").nullish(),
  /** The second spouse's own address for the acknowledgment. The first contributor uses the checkout email. */
  email: emailField.nullish(),
  /** This taxpayer's own share of the gift (joint returns). Defaults to an even split. */
  giftCents: cents.nullish(),
  /** How much of the share is designated. Defaults to the lesser of the share and what is left of the per-taxpayer cap. */
  designatedCents: cents.nullish(),
  /** Qualified contributions this taxpayer already made this tax year (to any SGO), for the preview. */
  otherQualifiedContributionsCents: cents.nullish(),
  /** State tax credit this taxpayer expects to be allowed for this gift, for the preview. */
  expectedStateCreditCents: cents.nullish(),
  /** Agrees to receive the official acknowledgment electronically. */
  eDeliveryConsent: z.boolean("Must be true or false.").nullish(),
});

const addressSchema = z.strictObject({
  line1: text(200, "Street address").nullish(),
  line2: text(200, "Address line 2").nullish(),
  city: text(100, "City").nullish(),
  state: z
    .string("Choose a State.")
    .trim()
    .toUpperCase()
    .refine(isUsStateCode, "Choose one of the 50 States or the District of Columbia.")
    .nullish(),
  zip: z
    .string("Enter a ZIP code.")
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code (or ZIP+4).")
    .nullish(),
});

const attestationsSchema = z.strictObject({
  individual: z.boolean("Must be true or false.").nullish(),
  usCitizenOrResident: z.boolean("Must be true or false.").nullish(),
  noEarmark: z.boolean("Must be true or false.").nullish(),
  notInExchangeForScholarship: z.boolean("Must be true or false.").nullish(),
  jointOnBehalfOfBoth: z.boolean("Must be true or false.").nullish(),
});

const liabilitySchema = z.strictObject({
  /** The donor's OWN estimate of federal income tax before the credits below. Never estimated by the product. */
  estimatedTaxCents: cents,
  otherCreditsCents: cents.nullish(),
});

export const CONTRIBUTOR_KEYS = ["primary", "spouse"] as const;
export type ContributorKey = (typeof CONTRIBUTOR_KEYS)[number];

/** A partial save. Omitted fields keep their saved value; `null` clears one. Nested objects merge field by field. */
export const checkoutPatchSchema = z.strictObject({
  /** The whole gift (both spouses together), before any fee on top. */
  giftCents: cents.nullish(),
  filingStatus: z.enum(FILING_STATUSES, "Choose a filing status.").nullish(),
  /** Joint return: false when only the first spouse is giving. Default true. */
  bothSpousesContribute: z.boolean("Must be true or false.").nullish(),
  /** Where receipts go and the first contributor's address for the acknowledgment. */
  email: emailField.nullish(),
  /** The mailing address as it appears on the federal income tax return (shared by spouses). */
  address: addressSchema.nullish(),
  contributors: z.strictObject({ primary: contributorSchema.nullish(), spouse: contributorSchema.nullish() }).nullish(),
  attestations: attestationsSchema.nullish(),
  /** Confirms the section 25F designation statement exactly as currently rendered. */
  designationConfirmed: z.boolean("Must be true or false.").nullish(),
  liability: liabilitySchema.nullish(),
  donorTimeZone: z.string("Must be a time zone.").trim().max(64).refine(isTimeZone, "Unknown time zone.").nullish(),
  locale: z.enum(["en", "es"], "Unsupported language.").nullish(),
});

export type CheckoutPatch = z.input<typeof checkoutPatchSchema>;
type ParsedPatch = z.output<typeof checkoutPatchSchema>;
type ContributorInput = z.output<typeof contributorSchema>;

export interface ContributorForm {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  email?: string | null;
  giftCents?: number | null;
  designatedCents?: number | null;
  otherQualifiedContributionsCents?: number | null;
  expectedStateCreditCents?: number | null;
  /** SHA-256 of the consent words the donor agreed to; null or absent when not given. */
  eDeliveryConsentTextSha256?: string | null;
}

/** What is stored in `checkout_sessions.form`. */
export interface CheckoutForm {
  giftCents?: number | null;
  filingStatus?: FilingStatus | null;
  bothSpousesContribute?: boolean | null;
  email?: string | null;
  address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; zip?: string | null };
  contributors?: { primary?: ContributorForm; spouse?: ContributorForm };
  attestations?: {
    individual?: boolean | null;
    usCitizenOrResident?: boolean | null;
    noEarmark?: boolean | null;
    notInExchangeForScholarship?: boolean | null;
    jointOnBehalfOfBoth?: boolean | null;
  };
  /** SHA-256 of the designation words the donor confirmed; a confirmation lapses when the words change. */
  designationConfirmedTextSha256?: string | null;
  liability?: { estimatedTaxCents: number; otherCreditsCents?: number | null } | null;
  donorTimeZone?: string | null;
  locale?: "en" | "es" | null;
}

const storedContributor = contributorSchema.omit({ eDeliveryConsent: true }).extend({ eDeliveryConsentTextSha256: z.string().regex(/^[0-9a-f]{64}$/).nullish() });

/** Validates what was stored, so a corrupted or outdated row can never reach the order code. */
export const storedFormSchema = checkoutPatchSchema
  .omit({ designationConfirmed: true, contributors: true })
  .extend({
    contributors: z.strictObject({ primary: storedContributor.optional(), spouse: storedContributor.optional() }).optional(),
    designationConfirmedTextSha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
  });

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "form";
    if (issue.code === "unrecognized_keys") {
      for (const name of issue.keys) fields[[...issue.path.map(String), name].join(".")] ??= "This field is not part of the checkout.";
      continue;
    }
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Parses an untrusted patch. Throws `validation_failed` with one message per field (unknown fields included). */
export function parseCheckoutPatch(raw: unknown): ParsedPatch {
  const parsed = checkoutPatchSchema.safeParse(raw ?? {});
  if (!parsed.success) throw invalid("Check the highlighted fields.", { fields: fieldErrors(parsed.error) });
  return parsed.data;
}

export function parseStoredForm(raw: unknown): CheckoutForm {
  const parsed = storedFormSchema.safeParse(raw ?? {});
  if (!parsed.success) throw invalid("The saved checkout could not be read. Start a new checkout.", { fields: fieldErrors(parsed.error) });
  return parsed.data as CheckoutForm;
}

/* ------------------------------------------------------------------ merging */

/** Copies the keys present in `patch` onto `base` (undefined = keep, null = clear). */
function mergeFlat<T extends object>(base: T | undefined | null, patch: Partial<Record<keyof T, unknown>> | undefined | null): T {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out as T;
}

function mergeContributor(base: ContributorForm | undefined, patch: ContributorInput | null | undefined): ContributorForm | undefined {
  if (patch === undefined) return base;
  if (patch === null) return undefined;
  const rest: Partial<ContributorInput> = { ...patch };
  delete rest.eDeliveryConsent;
  return mergeFlat<ContributorForm>(base, rest);
}

/**
 * The form after applying a parsed patch. Confirmations (the designation and each e-delivery consent) are not
 * merged here: they are bound to the exact words shown, which the caller renders after merging, then records with
 * `applyConfirmations`.
 */
export function mergeCheckoutForm(base: CheckoutForm, patch: ParsedPatch): CheckoutForm {
  const out: CheckoutForm = { ...base };
  const scalar = ["giftCents", "filingStatus", "bothSpousesContribute", "email", "donorTimeZone", "locale"] as const;
  for (const key of scalar) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else (out as Record<string, unknown>)[key] = value;
  }
  if (patch.address !== undefined) out.address = patch.address === null ? undefined : mergeFlat(base.address, patch.address);
  if (patch.attestations !== undefined) out.attestations = patch.attestations === null ? undefined : mergeFlat(base.attestations, patch.attestations);
  if (patch.liability !== undefined) out.liability = patch.liability === null ? null : { ...patch.liability };
  if (patch.contributors !== undefined) {
    if (patch.contributors === null) {
      out.contributors = undefined;
    } else {
      const primary = mergeContributor(base.contributors?.primary, patch.contributors.primary);
      const spouse = mergeContributor(base.contributors?.spouse, patch.contributors.spouse);
      out.contributors = { ...(primary ? { primary } : {}), ...(spouse ? { spouse } : {}) };
    }
  }
  return stripEmpty(out);
}

function stripEmpty(form: CheckoutForm): CheckoutForm {
  const out = { ...form } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined) delete out[key];
    else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) delete out[key];
  }
  return out as CheckoutForm;
}

export interface Confirmations {
  /** Patch value of `designationConfirmed` (undefined = untouched). */
  designationConfirmed: boolean | null | undefined;
  /** SHA-256 of the designation words as rendered after the merge, or null when they cannot be rendered yet. */
  designationTextSha256: string | null;
  consents: Record<ContributorKey, { requested: boolean | null | undefined; textSha256: string | null }>;
}

/** Records (or clears) confirmations against the words rendered from the merged form. */
export function applyConfirmations(form: CheckoutForm, c: Confirmations): CheckoutForm {
  const out: CheckoutForm = { ...form, contributors: { ...form.contributors } };
  if (c.designationConfirmed === true) {
    if (!c.designationTextSha256) {
      throw invalid("The designation cannot be confirmed until the amount and every contributor's name are entered.", {
        fields: { designationConfirmed: "Enter the amount and names first." },
      });
    }
    out.designationConfirmedTextSha256 = c.designationTextSha256;
  } else if (c.designationConfirmed === false || c.designationConfirmed === null) {
    delete out.designationConfirmedTextSha256;
  }
  for (const key of CONTRIBUTOR_KEYS) {
    const { requested, textSha256 } = c.consents[key];
    if (requested === undefined) continue;
    const current: ContributorForm = { ...(out.contributors?.[key] ?? {}) };
    if (requested === true) {
      if (!textSha256) {
        throw invalid("Electronic delivery needs an email address for this contributor.", {
          fields: { [`contributors.${key}.eDeliveryConsent`]: "Enter an email address first." },
        });
      }
      current.eDeliveryConsentTextSha256 = textSha256;
    } else {
      delete current.eDeliveryConsentTextSha256;
    }
    const next = { ...out.contributors };
    if (Object.keys(current).length > 0) next[key] = current;
    else delete next[key];
    out.contributors = next;
  }
  return stripEmpty({ ...out, contributors: out.contributors && Object.keys(out.contributors).length > 0 ? out.contributors : undefined });
}

/* ------------------------------------------------------------------ resolution */

export interface ResolvedContributor {
  key: ContributorKey;
  role: TaxpayerRole;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
  /** Full legal name as entered ("First Middle Last Suffix"), or null while first or last name is missing. */
  fullName: string | null;
  /** The address the acknowledgment would be emailed to (the second spouse falls back to the checkout email). */
  email: string | null;
  giftCents: number;
  designatedCents: number;
  nonDesignatedCents: number;
  giftDefaulted: boolean;
  designatedDefaulted: boolean;
  otherQualifiedContributionsCents: number;
  expectedStateCreditCents: number;
  eDeliveryConsentTextSha256: string | null;
}

export interface ResolvedOrder {
  filingStatus: FilingStatus | null;
  joint: boolean;
  /** One per contributing taxpayer: one, or two on a joint return where both spouses give. */
  contributors: ResolvedContributor[];
  giftCents: number | null;
  designatedCents: number;
  nonDesignatedCents: number;
  /** Amount problems found while resolving, by field. */
  errors: Record<string, string>;
}

function fullName(c: ContributorForm | undefined): string | null {
  if (!c?.firstName || !c.lastName) return null;
  return [c.firstName, c.middleName, c.lastName, c.suffix].filter((part): part is string => Boolean(part)).join(" ");
}

/**
 * Words in a name that mark it as an organization's (whole-word match). Returns the first offending word or null.
 */
export function nonIndividualNameWord(name: string): string | null {
  const words = name.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return words.find((word) => (NON_INDIVIDUAL_NAME_WORDS as readonly string[]).includes(word)) ?? null;
}

/**
 * The per-taxpayer contributions the form describes, with defaults filled in (an even joint split, and the lesser
 * of each share and what is left of the per-taxpayer cap as the designated amount, both from taxmath).
 */
export function resolveOrder(form: CheckoutForm): ResolvedOrder {
  const errors: Record<string, string> = {};
  const filingStatus = form.filingStatus ?? null;
  const joint = filingStatus === "married_joint";
  const both = joint && form.bothSpousesContribute !== false;
  const keys: ContributorKey[] = both ? ["primary", "spouse"] : ["primary"];
  const roles: TaxpayerRole[] = joint ? (both ? ["spouse_1", "spouse_2"] : ["spouse_1"]) : ["individual"];
  const entered = keys.map((key) => form.contributors?.[key]);
  const giftCents = form.giftCents ?? null;

  // Each taxpayer's share of the gift: explicit amounts win; otherwise the taxmath default (even split, odd cent first).
  let shares: Array<{ cents: number; defaulted: boolean }>;
  if (giftCents === null) {
    shares = keys.map(() => ({ cents: 0, defaulted: true }));
  } else if (keys.length === 1) {
    shares = [{ cents: giftCents, defaulted: true }];
  } else {
    const explicit = entered.map((c) => c?.giftCents ?? null);
    const suggested = suggestDesignation({ giftCents, filingStatus: "married_joint", bothSpousesContribute: true });
    if (explicit[0] !== null && explicit[1] !== null) {
      shares = [
        { cents: explicit[0], defaulted: false },
        { cents: explicit[1], defaulted: false },
      ];
      if (explicit[0] + explicit[1] !== giftCents) errors["contributors.spouse.giftCents"] = "Each spouse's amount must add up to the gift.";
    } else if (explicit[0] !== null || explicit[1] !== null) {
      const fixedIndex = explicit[0] !== null ? 0 : 1;
      const fixed = explicit[fixedIndex] as number;
      const rest = giftCents - fixed;
      if (rest < 0) errors[`contributors.${keys[fixedIndex]}.giftCents`] = "One spouse's amount cannot be more than the gift.";
      shares = keys.map((_, index) => (index === fixedIndex ? { cents: fixed, defaulted: false } : { cents: Math.max(0, rest), defaulted: true }));
    } else {
      shares = suggested.map((s) => ({ cents: s.giftCents, defaulted: true }));
    }
  }

  const contributors: ResolvedContributor[] = keys.map((key, index) => {
    const c = entered[index];
    const share = shares[index].cents;
    const other = c?.otherQualifiedContributionsCents ?? 0;
    const explicitDesignated = c?.designatedCents ?? null;
    const designatedDefault = suggestDesignation({ giftCents: share, filingStatus: "single", otherQualifiedContributionsCents: [other] })[0].designatedCents;
    const designatedCents = explicitDesignated ?? designatedDefault;
    if (explicitDesignated !== null && explicitDesignated > share) {
      errors[`contributors.${key}.designatedCents`] = "The designated amount cannot be more than this person's share of the gift.";
    }
    return {
      key,
      role: roles[index],
      firstName: c?.firstName ?? null,
      middleName: c?.middleName ?? null,
      lastName: c?.lastName ?? null,
      suffix: c?.suffix ?? null,
      fullName: fullName(c),
      email: key === "primary" ? (form.email ?? null) : (c?.email ?? form.email ?? null),
      giftCents: share,
      designatedCents: Math.min(designatedCents, share),
      nonDesignatedCents: Math.max(0, share - designatedCents),
      giftDefaulted: shares[index].defaulted,
      designatedDefaulted: explicitDesignated === null,
      otherQualifiedContributionsCents: other,
      expectedStateCreditCents: c?.expectedStateCreditCents ?? 0,
      eDeliveryConsentTextSha256: c?.eDeliveryConsentTextSha256 ?? null,
    };
  });

  return {
    filingStatus,
    joint,
    contributors,
    giftCents,
    designatedCents: contributors.reduce((sum, c) => sum + c.designatedCents, 0),
    nonDesignatedCents: contributors.reduce((sum, c) => sum + c.nonDesignatedCents, 0),
    errors,
  };
}

/** The State code of the saved address, or null. */
export function addressState(form: CheckoutForm): UsStateCode | null {
  const state = form.address?.state;
  return state && isUsStateCode(state) ? state : null;
}
