import { z } from "zod";
import { EMPTY_SHA256, EVIDENCE_POLICY } from "./policy";
import { containsSsnPattern, ID_PATTERN, normalizeText } from "./text";

/**
 * Shape and format validation of `EvidenceInput`. Parsing also normalizes: text to its canonical spelling,
 * timestamps to ISO 8601 UTC, hashes to lower case. Unknown keys are not copied (zod's default), which is
 * what makes the input types an allow-list. Rules that span several fields live in record.ts.
 */

const L = EVIDENCE_POLICY.limits;

type Ctx = z.RefinementCtx;

function fail(ctx: Ctx, message: string): never {
  ctx.addIssue({ code: "custom", message });
  return z.NEVER;
}

/** Required text of at most `max` characters after normalization. */
function text(max: number, what: string) {
  return z.string({ error: (issue) => (issue.input === undefined ? `is required: ${what}` : `must be text: ${what}`) }).transform((value, ctx) => {
    const normalized = normalizeText(value);
    if (normalized === "") return fail(ctx, `is required: ${what}`);
    if (normalized.length > max) return fail(ctx, `is longer than ${max} characters`);
    return normalized;
  });
}

/** Optional text: missing, null and blank all become null. */
function optionalText(max: number) {
  return z
    .string({ error: "must be text or null" })
    .nullish()
    .transform((value, ctx) => {
      if (value === null || value === undefined) return null;
      const normalized = normalizeText(value);
      if (normalized === "") return null;
      if (normalized.length > max) return fail(ctx, `is longer than ${max} characters`);
      return normalized;
    });
}

const NOT_AN_IDENTIFIER = `is not a valid identifier (letters, digits, "_", "-", "." and ":" only, at most ${L.id} characters)`;
/* An identifier that is nothing but nine digits, with or without separators, is refused: free text is scrubbed
   of such tokens, identifiers cannot be without breaking references, so they must not carry one. */
const SSN_SHAPED_ID = /^\d{3}[-.:]?\d{2}[-.:]?\d{4}$/;

function checkId(value: string, ctx: Ctx): string {
  if (value.length > L.id || !ID_PATTERN.test(value)) return fail(ctx, NOT_AN_IDENTIFIER);
  if (SSN_SHAPED_ID.test(value)) return fail(ctx, "is shaped like a Social Security number; identifiers must not carry one");
  return value;
}

function id(what: string) {
  return z.string({ error: (issue) => (issue.input === undefined ? `is required: ${what}` : `must be text: ${what}`) }).transform((value, ctx) => {
    if (value.length === 0) return fail(ctx, `is required: ${what}`);
    return checkId(value, ctx);
  });
}

function optionalId() {
  return z
    .string({ error: "must be an identifier or null" })
    .nullish()
    .transform((value, ctx) => {
      if (value === null || value === undefined || value === "") return null;
      return checkId(value, ctx);
    });
}

/* setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_UTC_LENGTH = "2026-11-18T15:04:05.000Z".length;

function parseTimestamp(value: unknown, ctx: Ctx, what: string): string {
  if (value === undefined || value === null) return fail(ctx, `is required: ${what}`);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fail(ctx, "is not a valid date");
    const iso = value.toISOString();
    // Years outside 0000-9999 serialize with a sign and six digits, which would break ordering by string.
    if (iso.length !== ISO_UTC_LENGTH) return fail(ctx, "is outside the supported range of dates");
    return iso;
  }
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    return fail(ctx, "must be a Date or an ISO 8601 timestamp with an explicit offset, for example 2026-11-18T15:04:05Z");
  }
  // `new Date` rolls impossible fields over ("2026-02-30" becomes March 2, "24:00" the next day), which would
  // sign a different instant from the one written. Every field is checked against the calendar first.
  const [year, month, day, hour, minute] = [0, 5, 8, 11, 14].map((at) => Number(value.slice(at, at === 0 ? 4 : at + 2)));
  const second = value[16] === ":" ? Number(value.slice(17, 19)) : 0;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!isRealCalendarDate(year, month, day)) return fail(ctx, "is not a real calendar date");
  if (hour > 23 || minute > 59 || second > 59) return fail(ctx, "is not a real time of day");
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return fail(ctx, "has an impossible UTC offset");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fail(ctx, "is not a real point in time");
  const iso = parsed.toISOString();
  if (iso.length !== ISO_UTC_LENGTH) return fail(ctx, "is outside the supported range of dates");
  return iso;
}

/** Required instant, normalized to `YYYY-MM-DDTHH:mm:ss.sssZ`. */
function timestamp(what: string) {
  return z.unknown().transform((value, ctx) => parseTimestamp(value, ctx, what));
}

function optionalTimestamp() {
  return z
    .unknown()
    .optional()
    .transform((value, ctx) => (value === undefined || value === null ? null : parseTimestamp(value, ctx, "timestamp")));
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCalendarDate(value: unknown, ctx: Ctx, what: string): string {
  if (value === undefined || value === null) return fail(ctx, `is required: ${what}`);
  const match = typeof value === "string" ? CALENDAR_DATE.exec(value) : null;
  if (!match) return fail(ctx, "must be a calendar date written YYYY-MM-DD");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isRealCalendarDate(year, month, day)) return fail(ctx, "is not a real calendar date");
  return value as string;
}

function calendarDate(what: string) {
  return z.unknown().transform((value, ctx) => parseCalendarDate(value, ctx, what));
}

function optionalCalendarDate() {
  return z
    .unknown()
    .optional()
    .transform((value, ctx) => (value === undefined || value === null ? null : parseCalendarDate(value, ctx, "date")));
}

const SHA256 = /^[0-9a-f]{64}$/;

function sha256(what: string) {
  return z.unknown().transform((value, ctx) => {
    if (value === undefined || value === null || value === "") return fail(ctx, `is required: ${what}`);
    const lower = typeof value === "string" ? value.toLowerCase() : "";
    if (!SHA256.test(lower)) return fail(ctx, "must be a SHA-256 hash written as 64 hexadecimal digits");
    if (lower === EMPTY_SHA256) return fail(ctx, "is the SHA-256 of empty content, which is not evidence");
    return lower;
  });
}

function cents(what: string) {
  return z.int({ error: (issue) => (issue.input === undefined ? `is required: ${what}` : "must be a whole number of cents") });
}

function positiveCents(what: string) {
  return cents(what).refine((value) => value > 0, { error: "must be greater than zero" });
}

function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .enum(values, { error: `must be one of ${values.join(", ")} or null` })
    .nullish()
    .transform((value) => value ?? null);
}

function optionalBoolean() {
  return z
    .boolean({ error: "must be true, false or null" })
    .nullish()
    .transform((value) => value ?? null);
}

/** Optional whole number in a closed range; missing and null both become null. */
function optionalInt(min: number, max: number, what: string) {
  const message = `must be ${what}, or null`;
  return z
    .int({ error: message })
    .min(min, { error: message })
    .max(max, { error: message })
    .nullish()
    .transform((value) => value ?? null);
}

function requiredEnum<const T extends readonly [string, ...string[]]>(values: T, what: string) {
  return z.enum(values, { error: (issue) => (issue.input === undefined ? `is required: ${what}` : `must be one of ${values.join(", ")}`) });
}

function list<T extends z.ZodType>(item: T, max: number, what: string) {
  return z.array(item, { error: (issue) => (issue.input === undefined ? `is required: ${what} (use an empty list when there are none)` : "must be a list") }).max(max, { error: `has more than ${max} entries` });
}

/* ---------------------------------------------------------------------------------------- sections */

function optionalIdList() {
  return z
    .array(id("an identifier"), { error: "must be a list of identifiers or null" })
    .max(L.documents, { error: `has more than ${L.documents} entries` })
    .nullish()
    .transform((value) => value ?? []);
}

/** Optional whole number of cents; missing and null both become null. */
function optionalCents() {
  return z
    .int({ error: "must be a whole number of cents or null" })
    .nullish()
    .transform((value) => value ?? null);
}

const reasonSchema = z.object({
  code: text(L.shortText, "the reason code"),
  message: text(L.longText, "the reason in words"),
  memberIds: optionalIdList(),
  sourceIds: optionalIdList(),
});

const decidedBySchema = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("engine") }),
    z.object({
      type: z.literal("reviewer"),
      reviewerId: id("the reviewer's user id"),
      reviewerName: text(L.name, "the reviewer's name"),
      notes: text(L.notes, "the reviewer's notes explaining the decision"),
    }),
  ],
  { error: 'is required: who made the decision ({ type: "engine" } or { type: "reviewer", reviewerId, reviewerName, notes })' },
);

const decisionSchema = z.object({
  status: requiredEnum(["eligible", "ineligible", "needs_review"], "the decision status"),
  method: z
    .union([z.enum(["direct", "categorical"]), z.null()], { error: (issue) => (issue.input === undefined ? "is required: the verification method (null only while in review)" : "must be direct, categorical or null") }),
  reasons: list(reasonSchema, L.reasons, "the decision reasons"),
  decidedAt: timestamp("when the decision was made"),
  decidedBy: decidedBySchema,
  applicationDate: calendarDate("the date of the scholarship application"),
  incomeYear: z.int({ error: (issue) => (issue.input === undefined ? "is required: the income year" : "must be a calendar year") }).min(2000, { error: "must be a calendar year" }).max(2200, { error: "must be a calendar year" }),
  expiresAt: optionalTimestamp(),
});

const memberSchema = z.object({
  id: id("the household member id"),
  role: requiredEnum(["student", "adult", "child", "other"], "the member's role"),
  firstName: z.string({ error: "is required: the member's first name (may be empty when only a last name is known)" }).transform((value, ctx) => {
    const normalized = normalizeText(value);
    return normalized.length > L.name ? fail(ctx, `is longer than ${L.name} characters`) : normalized;
  }),
  lastName: z.string({ error: "is required: the member's last name (may be empty when only a first name is known)" }).transform((value, ctx) => {
    const normalized = normalizeText(value);
    return normalized.length > L.name ? fail(ctx, `is longer than ${L.name} characters`) : normalized;
  }),
  relationship: optionalText(L.shortText),
});

const custodySchema = z.object({
  livesInMultipleHouseholds: z.boolean({ error: "is required: whether the student lives in more than one household" }),
  monthsInThisHousehold: optionalInt(0, 12, "a whole number of months from 0 to 12"),
  equalTime: optionalBoolean(),
  thisHouseholdHasHigherIncome: optionalEnum(["yes", "no", "unknown"]),
  notes: optionalText(L.longText),
  outcome: optionalText(L.shortText),
});

const householdSchema = z.object({
  id: optionalId(),
  size: z.int({ error: (issue) => (issue.input === undefined ? "is required: the household size" : "must be a whole number of persons") }).min(1, { error: "must be at least 1" }),
  members: list(memberSchema, L.members, "the household roster"),
  custody: custodySchema.nullish().transform((value) => value ?? null),
});

const geographySchema = z.object({
  state: z.string({ error: "is required: the two-letter state abbreviation" }).transform((value, ctx) => {
    const upper = value.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(upper) ? upper : fail(ctx, "must be a two-letter state abbreviation, for example TX");
  }),
  countyFips: z.string({ error: "is required: the 5-digit county FIPS code" }).regex(/^\d{5}$/, { error: "must be a 5-digit county FIPS code" }),
  countyName: text(L.shortText, "the county name"),
  areaCode: text(L.shortText, "the income-limit area code"),
  areaName: text(L.shortText, "the income-limit area name"),
  zip: z
    .string({ error: "must be a 5-digit ZIP code or null" })
    .regex(/^\d{5}$/, { error: "must be a 5-digit ZIP code or null" })
    .nullish()
    .transform((value) => value ?? null),
  countyResolution: optionalEnum(["geocoder", "zip_unique", "self_selected"]),
});

const thresholdLabelSchema = z.object(
  {
    copyVersion: text(L.shortText, "the version of the threshold wording"),
    badge: text(L.shortText, "the short status label of the limit"),
    limitLabel: text(L.shortText, "the field label of the limit"),
    sourceLine: text(L.longText, "the one-line description of the source of the limit"),
    explanation: text(L.notes, "the full explanation of where the limit comes from"),
    readingsNote: optionalText(L.notes),
  },
  { error: "is required: the exact wording shown next to the limit" },
);

const readingSchema = z.object({
  id: id("the reading id"),
  label: text(L.shortText, "the reading's label"),
  thresholdCents: positiveCents("the limit under this reading"),
  statutoryThresholdCents: z
    .int({ error: "must be a whole number of cents or null" })
    .min(1, { error: "must be greater than zero" })
    .nullish()
    .transform((value) => value ?? null),
  formula: text(L.longText, "the arithmetic of this reading"),
});

const thresholdSchema = z.object(
  {
    thresholdCents: positiveCents("the income limit"),
    statutoryThresholdCents: positiveCents("the income limit at the statutory 300 percent"),
    medianIncomeCents: z.union([positiveCents("the area median income"), z.null()], { error: "is required: the area median income in cents, or null when the table does not print it" }),
    multiplier: z
      .union([z.string().regex(/^\d{1,2}\.\d{2,4}$/), z.null()], { error: 'is required: the family-size multiplier as a decimal string such as "1.08", or null for tables with explicit limits' }),
    capPct: z.int({ error: (issue) => (issue.input === undefined ? "is required: the percent of area median the limit is set at" : "must be a whole percent") }).min(1, { error: "must be from 1 to 300" }).max(300, { error: "must be from 1 to 300" }),
    source: requiredEnum(["hud_provisional", "irs_published"], "the source of the income-limit table"),
    tableVersion: text(L.shortText, "the version of the income-limit table"),
    effectiveDate: calendarDate("the date the income-limit table took effect"),
    method: optionalText(L.shortText),
    formula: text(L.longText, "the arithmetic of the limit"),
    provisional: z.boolean({ error: "is required: whether the limit is provisional" }),
    label: thresholdLabelSchema,
    readings: list(readingSchema, L.thresholdReadings, "the readings of the limit").min(1, { error: "is required: at least one reading of the limit" }),
    lowerBoundCents: positiveCents("the smallest reading of the limit"),
    upperBoundCents: positiveCents("the largest reading of the limit"),
    readingsAgree: z.boolean({ error: "is required: whether every reading gives the same limit" }),
    statutoryUpperBoundCents: z
      .int({ error: "must be a whole number of cents or null" })
      .min(1, { error: "must be greater than zero" })
      .nullish()
      .transform((value) => value ?? null),
  },
  { error: "is required: the income limit and its source" },
);

const incomeItemSchema = z.object({
  id: id("the income item id"),
  category: text(L.shortText, "the income category key"),
  categoryLabel: text(L.shortText, "the income category name"),
  description: optionalText(L.longText),
  memberId: optionalId(),
  annualAmountCents: cents("the annual amount"),
  treatment: optionalEnum(["counted", "excluded", "review"]),
  counted: optionalBoolean(),
  basis: optionalText(L.longText),
  source: requiredEnum(["document", "rail", "self_reported", "reviewer"], "where the income figure comes from"),
  documentId: optionalId(),
  railId: optionalId(),
});

const incomeSchema = z.object({
  year: z.int({ error: (issue) => (issue.input === undefined ? "is required: the income year" : "must be a calendar year") }),
  totalCountedCents: cents("the total counted household income"),
  lowerBoundCents: optionalCents(),
  upperBoundCents: optionalCents(),
  items: list(incomeItemSchema, L.incomeItems, "the income items"),
});

const categoricalSchema = z.object({
  program: optionalEnum(["SNAP", "TANF", "WIC", "SECTION_8", "SSI"]),
  letterDate: optionalCalendarDate(),
  approvalStatus: requiredEnum(["approved", "denied", "terminated", "pending", "unclear"], "the approval status read from the documentation"),
  issuingAgency: optionalText(L.shortText),
  namedMemberId: optionalId(),
  benefitPeriodEnd: optionalCalendarDate(),
  documentId: optionalId(),
});

const extractedFieldSchema = z.object({
  key: text(L.shortText, "the field key"),
  label: text(L.shortText, "the field label"),
  value: optionalText(L.longText),
  amountCents: optionalCents(),
  confidencePct: optionalInt(0, 100, "a whole percent from 0 to 100"),
});

const documentSchema = z.object({
  id: id("the document id"),
  kind: requiredEnum(["award_letter", "tax_return", "irs_transcript", "w2", "pay_stub", "other_income", "unknown"], "the document kind"),
  sha256: sha256("the SHA-256 of the stored file"),
  filename: text(1000, "the file name"),
  sizeBytes: z.int({ error: (issue) => (issue.input === undefined ? "is required: the file size in bytes" : "must be a whole number of bytes") }).min(1, { error: "must be at least 1 byte" }),
  contentType: optionalText(L.shortText),
  uploadedAt: timestamp("when the file was uploaded"),
  extractedBy: optionalEnum(["parser", "model", "reviewer", "none"]).transform((value) => value ?? "none"),
  extractedFields: list(extractedFieldSchema, L.extractedFieldsPerDocument, "the fields read from the document"),
  memberId: optionalId(),
  purgedAt: optionalTimestamp(),
});

const railSchema = z.object({
  id: id("the data connection id"),
  provider: text(L.shortText, "the data provider"),
  kind: requiredEnum(["payroll", "bank", "transcript"], "the kind of data connection"),
  reportSha256: sha256("the SHA-256 of the report the connection returned"),
  connectedAt: timestamp("when the connection was made"),
  retrievedAt: optionalTimestamp(),
  memberId: optionalId(),
  consentId: optionalId(),
});

type ScopeValue = string | number | boolean | null | ScopeValue[] | { [key: string]: ScopeValue };

function parseScopeValue(value: unknown, ctx: Ctx, depth: number, path: string): ScopeValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    // Refused, not cut: a cut could change what the family agreed to, and could split a character in two.
    const normalized = normalizeText(value);
    return normalized.length > L.longText ? fail(ctx, `${path} is longer than ${L.longText} characters`) : normalized;
  }
  if (typeof value === "number") {
    // The record holds no floats. A fraction in a scope (for example a number of years) is kept as its decimal text.
    return Number.isSafeInteger(value) ? value : String(value);
  }
  if (depth >= L.scopeDepth) return fail(ctx, `${path} is nested more than ${L.scopeDepth} levels deep`);
  if (Array.isArray(value)) {
    if (value.length > L.scopeEntries) return fail(ctx, `${path} has more than ${L.scopeEntries} entries`);
    return value.map((entry, index) => parseScopeValue(entry === undefined ? null : entry, ctx, depth + 1, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined);
    if (entries.length > L.scopeEntries) return fail(ctx, `${path} has more than ${L.scopeEntries} entries`);
    const out: { [key: string]: ScopeValue } = {};
    for (const [key, entry] of entries) {
      const cleanKey = normalizeText(key);
      if (cleanKey === "" || cleanKey.length > L.shortText) return fail(ctx, `${path} has an empty or overlong key`);
      if (containsSsnPattern(cleanKey)) return fail(ctx, `${path} has a key shaped like a Social Security number`);
      // Assigning "__proto__" would set the prototype instead of a property; defineProperty keeps it data.
      Object.defineProperty(out, cleanKey, { value: parseScopeValue(entry, ctx, depth + 1, `${path}.${cleanKey}`), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return fail(ctx, `${path} is not plain JSON`);
}

const scopeSchema = z
  .unknown()
  .optional()
  .transform((value, ctx): { [key: string]: ScopeValue } => {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) return fail(ctx, "must be an object describing who receives what, for what purpose and for how long");
    return parseScopeValue(value, ctx, 0, "scope") as { [key: string]: ScopeValue };
  });

const consentSchema = z.object(
  {
    id: id("the consent id"),
    kind: text(L.shortText, "the kind of consent"),
    copyVersion: text(L.shortText, "the version of the consent text"),
    copySha256: sha256("the SHA-256 of the exact consent text shown"),
    locale: text(35, "the language the consent text was shown in"),
    grantedAt: timestamp("when consent was given"),
    grantedBy: text(L.name * 2, "the name of the adult who gave consent"),
    scope: scopeSchema,
  },
  { error: "is required: the consent record" },
);

const actorSchema = z.object(
  {
    type: requiredEnum(["engine", "system", "reviewer", "user", "family", "api_key"], "the kind of actor"),
    id: optionalId(),
    name: optionalText(L.name * 2),
  },
  { error: "is required: who or what acted" },
);

const reviewEntrySchema = z.object({
  at: timestamp("when the review action happened"),
  actor: actorSchema,
  action: text(L.shortText, "the review action"),
  notes: optionalText(L.notes),
});

const timelineEntrySchema = z.object({
  at: timestamp("when the event happened"),
  event: text(L.shortText, "the event"),
  actor: actorSchema.nullish().transform((value) => value ?? null),
  detail: optionalText(L.longText),
});

const sgoSchema = z.object(
  {
    id: id("the SGO's organization id"),
    name: text(L.shortText, "the SGO's name"),
    ein: z
      .string({ error: "must be an EIN or null" })
      .nullish()
      .transform((value, ctx) => {
        if (value === null || value === undefined || value.trim() === "") return null;
        const digits = value.trim().replace(/^(\d{2})-(\d{7})$/, "$1$2");
        if (!/^\d{9}$/.test(digits)) return fail(ctx, "must be an EIN written NN-NNNNNNN");
        return `${digits.slice(0, 2)}-${digits.slice(2)}`;
      }),
  },
  { error: "is required: the SGO this pack is for" },
);

const versionsSchema = z.object(
  {
    engine: text(L.shortText, "the decision engine version"),
    taxonomy: text(L.shortText, "the income taxonomy version"),
    ruleSet: optionalText(L.shortText),
  },
  { error: "is required: the engine and taxonomy versions" },
);

export const evidenceInputSchema = z.object(
  {
    verificationId: id("the verification id"),
    mode: requiredEnum(["test", "live"], "the mode (test or live)"),
    sgo: sgoSchema,
    externalRef: optionalText(L.shortText),
    reusedFromVerificationId: optionalId(),
    decision: z.object(decisionSchema.shape, { error: "is required: the decision" }),
    household: z.object(householdSchema.shape, { error: "is required: the household" }),
    geography: z.object(geographySchema.shape, { error: "is required: the county and income-limit area" }),
    threshold: thresholdSchema,
    income: incomeSchema.nullish().transform((value) => value ?? null),
    categorical: categoricalSchema.nullish().transform((value) => value ?? null),
    documents: list(documentSchema, L.documents, "the documents"),
    rails: list(railSchema, L.rails, "the data connections"),
    consent: consentSchema,
    additionalConsents: list(consentSchema, L.consents, "the additional consents")
      .nullish()
      .transform((value) => value ?? []),
    reviewTrail: list(reviewEntrySchema, L.reviewEntries, "the review trail"),
    timeline: list(timelineEntrySchema, L.timelineEntries, "the timeline"),
    generatedAt: timestamp("when the pack is generated"),
    versions: versionsSchema,
  },
  { error: "must be an object" },
);

export type ParsedEvidenceInput = z.output<typeof evidenceInputSchema>;
