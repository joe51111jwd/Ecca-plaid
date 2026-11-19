/**
 * FormData parsing for the business portal's server actions. Each parser validates the raw form fields (all strings)
 * into the typed input a service expects and throws AppError `validation_failed` with per-field messages. The
 * services validate again; this layer exists so the person sees which field to fix.
 */
import { z } from "zod";
import type { MemberRole, Mode, VendorType } from "@/db/schema";
import { invalid } from "@/lib/errors";
import { parseUsdToCents } from "@/lib/money";
import { isVendorType } from "@/server/businesses";

function fail(error: z.ZodError, message: string): never {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw invalid(Object.values(fields)[0] ?? message, { fields });
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function parse<S extends z.ZodType>(schema: S, raw: unknown, message: string): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) fail(r.error, message);
  return r.data;
}

const id = (label: string) => z.string().trim().min(1, `${label} is missing.`).max(128, `${label} is not valid.`);

/* ------------------------------------------------------------------------------------------ handoffs */

export function parseExtendHold(formData: FormData): { orgId: string; handoffId: string; hours: number } {
  return parse(
    z.object({
      orgId: id("Organization"),
      handoffId: id("Handoff"),
      hours: z
        .string()
        .trim()
        .regex(/^\d{1,4}$/, "Choose how many hours to add.")
        .transform(Number)
        .pipe(z.number().int().min(1, "Add at least 1 hour.")),
    }),
    { orgId: text(formData, "orgId"), handoffId: text(formData, "handoffId"), hours: text(formData, "hours") },
    "Check the hold extension.",
  );
}

/** The optional final booking amount is typed in dollars ("450", "$1,250.50"). */
export function parseComplete(formData: FormData): { orgId: string; handoffId: string; bookingAmountCents?: number } {
  const base = parse(z.object({ orgId: id("Organization"), handoffId: id("Handoff") }), { orgId: text(formData, "orgId"), handoffId: text(formData, "handoffId") }, "Check the booking.");
  const raw = text(formData, "bookingAmount").trim();
  if (raw === "") return base;
  const cents = parseUsdToCents(raw);
  if (cents === null || cents <= 0) throw invalid("Enter the final booking amount in dollars, like 450 or 450.00.", { fields: { bookingAmount: "Enter an amount in dollars, like 450.00." } });
  return { ...base, bookingAmountCents: cents };
}

export function parseCancel(formData: FormData): { orgId: string; handoffId: string; reason?: string } {
  const r = parse(
    z.object({ orgId: id("Organization"), handoffId: id("Handoff"), reason: z.string().max(500, "Keep the reason under 500 characters.") }),
    { orgId: text(formData, "orgId"), handoffId: text(formData, "handoffId"), reason: text(formData, "reason") },
    "Check the cancellation.",
  );
  const reason = r.reason.replace(/\s+/g, " ").trim();
  return { orgId: r.orgId, handoffId: r.handoffId, ...(reason ? { reason } : {}) };
}

/* ------------------------------------------------------------------------------------------ settings */

export interface ProfileForm {
  orgId: string;
  patch: {
    displayName?: string;
    vendorType?: VendorType;
    website?: string;
    billingEmail?: string;
    brandColor?: string;
    logoUrl?: string;
    holdWindowHours?: number;
  };
}

/**
 * The profile and branding form. Only fields present in the form are sent; an empty website, logo or color clears it
 * (the service turns "" into null). The hold window is whole hours.
 */
export function parseProfile(formData: FormData): ProfileForm {
  const orgId = parse(id("Organization"), text(formData, "orgId"), "Check the form.");
  const patch: ProfileForm["patch"] = {};
  const fields: Record<string, string> = {};
  const has = (n: string) => formData.has(n);
  if (has("displayName")) patch.displayName = text(formData, "displayName");
  if (has("vendorType")) {
    const v = text(formData, "vendorType");
    if (isVendorType(v)) patch.vendorType = v;
    else fields.vendorType = "Choose what kind of business this is.";
  }
  if (has("website")) patch.website = text(formData, "website").trim();
  if (has("billingEmail")) patch.billingEmail = text(formData, "billingEmail").trim();
  if (has("brandColor")) patch.brandColor = text(formData, "brandColor").trim();
  if (has("logoUrl")) patch.logoUrl = text(formData, "logoUrl").trim();
  if (has("holdWindowHours")) {
    const raw = text(formData, "holdWindowHours").trim();
    if (/^\d{1,4}$/.test(raw)) patch.holdWindowHours = Number(raw);
    else fields.holdWindowHours = "Enter the hold window in whole hours.";
  }
  if (Object.keys(fields).length > 0) throw invalid(Object.values(fields)[0], { fields });
  if (Object.keys(patch).length === 0) throw invalid("Nothing to update.");
  return { orgId, patch };
}

/** Allowed origins, one per line (commas and spaces also separate). Blank lines are ignored. */
export function parseOrigins(formData: FormData): { orgId: string; allowedOrigins: string[] } {
  const orgId = parse(id("Organization"), text(formData, "orgId"), "Check the form.");
  const allowedOrigins = text(formData, "allowedOrigins")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { orgId, allowedOrigins };
}

export function parsePartnershipRequest(formData: FormData): { orgId: string; sgoOrgId: string } {
  return parse(
    z.object({ orgId: id("Organization"), sgoOrgId: z.string().trim().min(1, "Choose a scholarship organization.").max(128, "Choose a scholarship organization.") }),
    { orgId: text(formData, "orgId"), sgoOrgId: text(formData, "sgoOrgId") },
    "Choose a scholarship organization.",
  );
}

export function parsePartnershipEnd(formData: FormData): { orgId: string; partnershipId: string } {
  return parse(z.object({ orgId: id("Organization"), partnershipId: id("Partnership") }), { orgId: text(formData, "orgId"), partnershipId: text(formData, "partnershipId") }, "Check the form.");
}

/* ---------------------------------------------------------------------------------------------- team */

const ROLE_VALUES = ["owner", "admin", "reviewer", "viewer"] as const satisfies readonly MemberRole[];

export function parseInvite(formData: FormData): { orgId: string; email: string; role: MemberRole } {
  return parse(
    z.object({
      orgId: id("Organization"),
      email: z.string().trim().min(1, "Enter an email address.").max(254, "That email address is too long."),
      role: z.enum(ROLE_VALUES, "Choose a role."),
    }),
    { orgId: text(formData, "orgId"), email: text(formData, "email"), role: text(formData, "role") },
    "Check the invitation.",
  );
}

export function parseRoleChange(formData: FormData): { orgId: string; userId: string; role: MemberRole } {
  return parse(
    z.object({ orgId: id("Organization"), userId: id("Member"), role: z.enum(ROLE_VALUES, "Choose a role.") }),
    { orgId: text(formData, "orgId"), userId: text(formData, "userId"), role: text(formData, "role") },
    "Check the role.",
  );
}

export function parseMemberRemoval(formData: FormData): { orgId: string; userId: string } {
  return parse(z.object({ orgId: id("Organization"), userId: id("Member") }), { orgId: text(formData, "orgId"), userId: text(formData, "userId") }, "Check the form.");
}

/* ------------------------------------------------------------------------------------- developers */

export function parseApiKeyCreate(formData: FormData): { orgId: string; name: string; mode: Mode } {
  return parse(
    z.object({ orgId: id("Organization"), name: z.string().trim().min(1, "Give the key a name.").max(100, "Keep the name under 100 characters."), mode: z.enum(["test", "live"], "Choose test or live.") }),
    { orgId: text(formData, "orgId"), name: text(formData, "name"), mode: text(formData, "mode") },
    "Check the key.",
  );
}

export function parseApiKeyRevoke(formData: FormData): { orgId: string; keyId: string } {
  return parse(z.object({ orgId: id("Organization"), keyId: id("Key") }), { orgId: text(formData, "orgId"), keyId: text(formData, "keyId") }, "Check the form.");
}

export function parseWebhookCreate(formData: FormData): { orgId: string; url: string; description: string | null; eventTypes: string[] } {
  const base = parse(
    z.object({ orgId: id("Organization"), url: z.string().trim().min(1, "Enter the URL that receives events.").max(2048, "That URL is too long."), description: z.string().max(500, "Keep the description under 500 characters.") }),
    { orgId: text(formData, "orgId"), url: text(formData, "url"), description: text(formData, "description") },
    "Check the endpoint.",
  );
  const eventTypes = formData.getAll("eventTypes").filter((v): v is string => typeof v === "string" && v.length > 0);
  if (eventTypes.length === 0) throw invalid("Choose at least one event.", { fields: { eventTypes: "Choose at least one event." } });
  const description = base.description.trim();
  return { orgId: base.orgId, url: base.url, description: description || null, eventTypes };
}

export function parseWebhookTarget(formData: FormData): { orgId: string; endpointId: string } {
  return parse(z.object({ orgId: id("Organization"), endpointId: id("Endpoint") }), { orgId: text(formData, "orgId"), endpointId: text(formData, "endpointId") }, "Check the form.");
}

/* -------------------------------------------------------------------------------------------- signup */

export function parseSignup(formData: FormData): { name: string; vendorType: VendorType; website: string | null; billingEmail: string } {
  const vendorType = text(formData, "vendorType");
  const r = parse(
    z.object({
      name: z.string().trim().min(1, "Enter your business's name.").max(200, "Use at most 200 characters."),
      vendorType: z.custom<VendorType>((v) => isVendorType(v), "Choose what kind of business this is."),
      website: z.string().trim().max(2048, "That address is too long."),
      billingEmail: z.string().trim().min(1, "Enter the email that receives invoices.").max(254, "That email address is too long."),
    }),
    { name: text(formData, "name"), vendorType, website: text(formData, "website"), billingEmail: text(formData, "billingEmail") },
    "Check your business details.",
  );
  return { name: r.name, vendorType: r.vendorType, website: r.website || null, billingEmail: r.billingEmail };
}
