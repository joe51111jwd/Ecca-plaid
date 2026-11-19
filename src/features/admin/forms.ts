import { z } from "zod";
import type { JobStatus, MemberRole, OrgStatus, OrgType, SgoListEntryStatus, SgoListSource } from "@/db/schema";
import { parseUsdToCents } from "@/lib/money";
import { readFlag, readText } from "./form-data";

/**
 * Validation of every admin form and filter. Each `*FromForm` turns FormData into a plain object for the matching
 * schema; the schemas trim, coerce and give the operator plain-language messages. The services re-validate
 * everything (they are the authority): these schemas exist so a typo is answered next to the field it came from.
 */

/* ------------------------------------------------------------------------------------------ primitives */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD form. */
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const trimmed = (max: number, label: string) => z.string().trim().max(max, `${label} can be at most ${max} characters.`);
const requiredText = (max: number, label: string, message: string) => trimmed(max, label).min(1, message);
/** "" becomes null. */
const optionalText = (max: number, label: string) =>
  trimmed(max, label).transform((v) => (v === "" ? null : v));
const calendarDate = (message: string) => z.string().trim().refine(isCalendarDate, message);
const id = (message: string) => z.string().trim().min(1, message).max(100, message).regex(/^[A-Za-z0-9_-]+$/, message);

/** Parses "2.5", "2.5%" or "0" into basis points (250, 0). Null when it is not a percentage with at most two decimals. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** 250 → "2.5", 1 → "0.01", 0 → "0". The inverse of parsePercentToBps, for form default values. */
export function bpsToPercentInput(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid basis points: ${bps}`);
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Cents → "12.50" / "12" for a dollars input's default value. */
export function centsToDollarsInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

const percent = (label: string, maxBps: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const bps = v === "" ? 0 : parsePercentToBps(v);
      if (bps === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} as a percentage with at most two decimals, like 2.5.` });
        return z.NEVER;
      }
      if (bps > maxBps) {
        ctx.addIssue({ code: "custom", message: `${label} can be at most ${bpsToPercentInput(maxBps)}%.` });
        return z.NEVER;
      }
      return bps;
    });

const dollars = (label: string, maxCents: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = v === "" ? 0 : parseUsdToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} in dollars, like 25 or 25.50.` });
        return z.NEVER;
      }
      if (cents > maxCents) {
        ctx.addIssue({ code: "custom", message: `${label} can be at most $${centsToDollarsInput(maxCents)}.` });
        return z.NEVER;
      }
      return cents;
    });

/* -------------------------------------------------------------------------------------- gates and fees */

/** Highest platform fee rate the settings registry accepts (src/server/settings/definitions: bps(1000)). */
export const MAX_PLATFORM_FEE_BPS = 1000;

export const FEE_STRUCTURE_VALUES = ["none", "sgo_invoiced", "donor_service_fee"] as const;

/**
 * POLICY (admin console): moving the fee structure off "none" requires both the counsel memo reference (the
 * settings service enforces this too) and the date of that memo, recorded as `approvedAt` at midnight UTC of
 * that date. Sources say only that a written memo must exist first; requiring its date is this console's choice
 * so the audit trail says which memo was relied on.
 */
export function feeStructureSchema(today: string) {
  return z
    .object({
      active: z.enum(FEE_STRUCTURE_VALUES, "Choose a fee structure."),
      sgoFeePercent: percent("The SGO-invoiced fee", MAX_PLATFORM_FEE_BPS),
      donorServiceFeePercent: percent("The donor service fee", MAX_PLATFORM_FEE_BPS),
      counselMemoRef: optionalText(500, "The counsel memo reference"),
      approvedOn: z.string().trim(),
    })
    .superRefine((v, ctx) => {
      if (v.approvedOn !== "" && !isCalendarDate(v.approvedOn)) ctx.addIssue({ code: "custom", path: ["approvedOn"], message: "Enter the memo date as a full date." });
      else if (v.approvedOn !== "" && v.approvedOn > today) ctx.addIssue({ code: "custom", path: ["approvedOn"], message: "The memo date cannot be in the future." });
      if (v.active !== "none") {
        if (v.counselMemoRef === null) ctx.addIssue({ code: "custom", path: ["counselMemoRef"], message: "Record the reference of counsel's written memo before choosing a fee structure other than none." });
        if (v.approvedOn === "") ctx.addIssue({ code: "custom", path: ["approvedOn"], message: "Enter the date of counsel's memo." });
        if (v.active === "sgo_invoiced" && v.sgoFeePercent === 0) ctx.addIssue({ code: "custom", path: ["sgoFeePercent"], message: "Enter the fee rate the SGO will be invoiced." });
        if (v.active === "donor_service_fee" && v.donorServiceFeePercent === 0) ctx.addIssue({ code: "custom", path: ["donorServiceFeePercent"], message: "Enter the service fee rate the donor will pay." });
      }
    })
    .transform((v) => ({
      active: v.active,
      sgoFeeBps: v.sgoFeePercent,
      donorServiceFeeBps: v.donorServiceFeePercent,
      counselMemoRef: v.counselMemoRef,
      approvedAt: v.approvedOn === "" ? null : `${v.approvedOn}T00:00:00.000Z`,
    }));
}

export function feeStructureFromForm(formData: FormData) {
  return {
    active: readText(formData, "active"),
    sgoFeePercent: readText(formData, "sgoFeePercent"),
    donorServiceFeePercent: readText(formData, "donorServiceFeePercent"),
    counselMemoRef: readText(formData, "counselMemoRef"),
    approvedOn: readText(formData, "approvedOn"),
  };
}

/**
 * POLICY (admin console): turning live section 25F gifts ON requires the operator to tick an acknowledgment and
 * record the reference of counsel's sign-off, which is written to the audit log next to the settings change. The
 * spec requires a written counsel memo before any live 25F gift is accepted; the settings service stores only the
 * boolean, so the reference travels in the audit entry. Turning live gifts OFF never needs anything.
 */
export const liveGiftsSchema = z
  .object({
    enabled: z.boolean(),
    acknowledged: z.boolean(),
    counselReference: optionalText(500, "The counsel reference"),
  })
  .superRefine((v, ctx) => {
    if (!v.enabled) return;
    if (!v.acknowledged) ctx.addIssue({ code: "custom", path: ["acknowledged"], message: "Confirm that counsel has signed off before live gifts are accepted." });
    if (v.counselReference === null || v.counselReference.length < 3) ctx.addIssue({ code: "custom", path: ["counselReference"], message: "Record the reference of counsel's written sign-off." });
  });

export function liveGiftsFromForm(formData: FormData) {
  return { enabled: readText(formData, "enabled") === "on", acknowledged: readFlag(formData, "acknowledged"), counselReference: readText(formData, "counselReference") };
}

export const creditStartDateSchema = z.object({ date: calendarDate("Enter the date as YYYY-MM-DD.") });

export const LIST_SOURCE_VALUES = ["provisional_curated", "irs_published"] as const satisfies readonly SgoListSource[];

export const listSourceSchema = z.object({ source: z.enum(LIST_SOURCE_VALUES, "Choose a list source.") });

/* ------------------------------------------------------------------------------------------ SGO list */

/** Largest list file the import form accepts, in bytes (Next.js server actions accept a 1 MB request body by default). */
export const LIST_UPLOAD_MAX_BYTES = 900 * 1024;

export const importListSchema = z.object({
  source: z.enum(LIST_SOURCE_VALUES, "Choose which list this file is."),
  sourceUrl: optionalText(2000, "The source address"),
  retrievedOn: calendarDate("Enter the date the list was downloaded."),
});

export function importListFromForm(formData: FormData) {
  return { source: readText(formData, "source"), sourceUrl: readText(formData, "sourceUrl"), retrievedOn: readText(formData, "retrievedOn") };
}

export const removeListEntrySchema = z.object({
  entryId: id("Choose a list entry."),
  removedOn: calendarDate("Enter the removal's effective date."),
  learnedOn: calendarDate("Enter the date the removal was confirmed at the source."),
  sourceUrl: optionalText(2000, "The source address"),
});

export function removeListEntryFromForm(formData: FormData) {
  return { entryId: readText(formData, "entryId"), removedOn: readText(formData, "removedOn"), learnedOn: readText(formData, "learnedOn"), sourceUrl: readText(formData, "sourceUrl") };
}

export const linkEntrySchema = z.object({
  orgId: id("Missing organization."),
  /** "" unlinks. */
  entryId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(id("Choose a list entry.").nullable()),
});

/* ---------------------------------------------------------------------------------------- organizations */

export const MEMBER_ROLE_VALUES = ["owner", "admin", "reviewer", "viewer"] as const satisfies readonly MemberRole[];

export const createSgoFormSchema = z.object({
  name: requiredText(200, "The name", "Enter the organization's name."),
  ein: optionalText(20, "The EIN"),
  city: optionalText(100, "The city"),
  state: requiredText(2, "The State", "Enter the two-letter State code.").transform((v) => v.toUpperCase()),
  ownerEmail: requiredText(320, "The owner's email", "Enter the owner's email address."),
});

export function createSgoFromForm(formData: FormData) {
  return { name: readText(formData, "name"), ein: readText(formData, "ein"), city: readText(formData, "city"), state: readText(formData, "state") || "TX", ownerEmail: readText(formData, "ownerEmail") };
}

export const createBusinessFormSchema = z.object({
  name: requiredText(200, "The name", "Enter the business's name."),
  vendorType: requiredText(40, "The kind of business", "Choose the kind of business."),
  website: optionalText(2000, "The website"),
  billingEmail: requiredText(320, "The billing email", "Enter the billing email address."),
  ownerEmail: requiredText(320, "The owner's email", "Enter the owner's email address."),
});

export function createBusinessFromForm(formData: FormData) {
  return {
    name: readText(formData, "name"),
    vendorType: readText(formData, "vendorType"),
    website: readText(formData, "website"),
    billingEmail: readText(formData, "billingEmail"),
    ownerEmail: readText(formData, "ownerEmail"),
  };
}

/** POLICY: a suspension or reinstatement must say why (5–500 characters); the reason goes to the audit log. */
export const ORG_STATUS_REASON_LIMITS = { min: 5, max: 500 } as const;

export const orgStatusSchema = z.object({
  orgId: id("Missing organization."),
  status: z.enum(["active", "suspended"] as const satisfies readonly OrgStatus[], "Choose active or suspended."),
  reason: z
    .string()
    .trim()
    .min(ORG_STATUS_REASON_LIMITS.min, `Give a reason of at least ${ORG_STATUS_REASON_LIMITS.min} characters.`)
    .max(ORG_STATUS_REASON_LIMITS.max, `Keep the reason under ${ORG_STATUS_REASON_LIMITS.max} characters.`),
});

export const addMemberSchema = z.object({
  orgId: id("Missing organization."),
  email: requiredText(320, "The email", "Enter the person's email address."),
  role: z.enum(MEMBER_ROLE_VALUES, "Choose a role."),
});

export const changeRoleSchema = z.object({ orgId: id("Missing organization."), userId: id("Missing member."), role: z.enum(MEMBER_ROLE_VALUES, "Choose a role.") });

export const removeMemberSchema = z.object({ orgId: id("Missing organization."), userId: id("Missing member.") });

/** Mirrors SUCCESS_FEE_LIMITS in src/server/businesses (which re-validates): $10,000 flat, 20%. */
export const SUCCESS_FEE_FORM_LIMITS = { maxFlatCents: 1_000_000, maxBps: 2000 } as const;

export const successFeeSchema = z.object({
  orgId: id("Missing organization."),
  flatDollars: dollars("The flat fee", SUCCESS_FEE_FORM_LIMITS.maxFlatCents),
  percent: percent("The percentage fee", SUCCESS_FEE_FORM_LIMITS.maxBps),
});

/* --------------------------------------------------------------------------------- jobs, privacy, refunds */

export const retryJobSchema = z.object({ jobId: id("Missing job.") });

/** Mirrors the households service (which re-validates): a reason of at most 500 characters. */
export const DELETION_REASON_LIMITS = { min: 10, max: 500 } as const;

export const deletionSchema = z.object({
  householdId: id("Choose a household."),
  reason: z
    .string()
    .trim()
    .min(DELETION_REASON_LIMITS.min, `Describe the request in at least ${DELETION_REASON_LIMITS.min} characters (who asked, how, and the ticket).`)
    .max(DELETION_REASON_LIMITS.max, `Keep the reason under ${DELETION_REASON_LIMITS.max} characters.`),
});

export const refundSchema = z.object({
  donationId: id("Enter the donation id."),
  reason: trimmed(1000, "The reason"),
  counselReference: trimmed(500, "The counsel reference"),
});

/* --------------------------------------------------------------------------------------------- filters */

type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a query parameter, trimmed; "" when absent. */
export function firstParam(params: SearchParams, name: string): string {
  const raw = params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

/** A query parameter restricted to known values; `fallback` for anything else. */
export function enumParam<T extends string>(params: SearchParams, name: string, values: readonly T[], fallback: T): T;
export function enumParam<T extends string>(params: SearchParams, name: string, values: readonly T[], fallback?: undefined): T | undefined;
export function enumParam<T extends string>(params: SearchParams, name: string, values: readonly T[], fallback?: T): T | undefined {
  const value = firstParam(params, name);
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A free-text filter value: trimmed, control characters refused, at most `max` characters; undefined when empty or unsafe. */
export function textParam(params: SearchParams, name: string, max = 200): string | undefined {
  const value = firstParam(params, name);
  if (value === "" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

/** Builds `/path?a=1&b=2`, leaving out empty values. */
export function hrefWith(path: string, params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export interface AuditFilter {
  orgId?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  before?: string;
}

export function parseAuditFilter(params: SearchParams): AuditFilter {
  const out: AuditFilter = {};
  for (const key of ["orgId", "actorId", "action", "targetType", "targetId"] as const) {
    const v = textParam(params, key, 200);
    if (v !== undefined) out[key] = v;
  }
  const before = textParam(params, "before", 400);
  if (before !== undefined && /^[A-Za-z0-9_-]+$/.test(before)) out.before = before;
  return out;
}

export const JOB_STATUS_VALUES = ["queued", "running", "succeeded", "failed", "dead"] as const satisfies readonly JobStatus[];
export const JOBS_PAGE_SIZE = 50;
/** Statuses an operator can act on: the queue's retry rules are in src/server/jobs retryJob. */
export const RETRYABLE_JOB_STATUSES: readonly JobStatus[] = ["dead", "failed", "queued"];

export interface JobsFilter {
  status: JobStatus | "all";
  type?: string;
  page: number;
}

/** Defaults to failed ("dead") jobs: the list an operator opens this page for. */
export function parseJobsFilter(params: SearchParams): JobsFilter {
  const status = enumParam(params, "status", [...JOB_STATUS_VALUES, "all"] as const, "dead");
  const type = textParam(params, "type", 120);
  const pageRaw = Number(firstParam(params, "page"));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? pageRaw : 1;
  return { status, ...(type ? { type } : {}), page };
}

export const ORG_TYPE_VALUES = ["sgo", "business", "platform"] as const satisfies readonly OrgType[];
export const ORG_STATUS_VALUES = ["pending", "active", "suspended"] as const satisfies readonly OrgStatus[];

export interface OrgFilter {
  type?: OrgType;
  status?: OrgStatus;
  q?: string;
}

export function parseOrgFilter(params: SearchParams): OrgFilter {
  const type = enumParam(params, "type", ORG_TYPE_VALUES);
  const status = enumParam(params, "status", ORG_STATUS_VALUES);
  const q = textParam(params, "q", 100);
  return { ...(type ? { type } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) };
}

export const LIST_STATUS_VALUES = ["listed", "removed"] as const satisfies readonly SgoListEntryStatus[];

export interface ListEntryFilter {
  source?: SgoListSource;
  state?: string;
  status?: SgoListEntryStatus;
  query?: string;
}

export function parseListEntryFilter(params: SearchParams): ListEntryFilter {
  const source = enumParam(params, "source", LIST_SOURCE_VALUES);
  const status = enumParam(params, "status", LIST_STATUS_VALUES);
  const stateRaw = firstParam(params, "state").toUpperCase();
  const query = textParam(params, "q", 100);
  return { ...(source ? { source } : {}), ...(/^[A-Z]{2}$/.test(stateRaw) ? { state: stateRaw } : {}), ...(status ? { status } : {}), ...(query ? { query } : {}) };
}

export interface OutboxFilter {
  to?: string;
  template?: string;
}

export function parseOutboxFilter(params: SearchParams): OutboxFilter {
  const to = textParam(params, "to", 320);
  const template = textParam(params, "template", 100);
  return { ...(to ? { to } : {}), ...(template ? { template } : {}) };
}

/** A 5-digit county FIPS code from the query, or undefined. */
export function parseCountyParam(params: SearchParams): string | undefined {
  const v = firstParam(params, "county");
  return /^\d{5}$/.test(v) ? v : undefined;
}
