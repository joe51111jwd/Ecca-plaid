import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode, VendorType } from "@/db/schema";
import { now } from "@/lib/clock";
import { forbidden, invalid, notFound } from "@/lib/errors";
import { newId, newToken } from "@/lib/ids";
import { audit } from "@/server/audit";
import { emailAddressSchema, isPlatformAdmin, type Organization } from "@/server/auth";
import { createOrganization } from "@/server/orgs";
import { getSetting } from "@/server/settings";
import { auditContextOf, authorizeManage, authorizePlatform, isBusinessSystemActor, type BusinessActor } from "./access";
import { SUCCESS_FEE_LIMITS, type SuccessFeeTerms } from "./fees";
import { checkBrandColor, checkWebUrl, HOLD_WINDOW_HOURS, isVendorType, MAX_ALLOWED_ORIGINS, normalizeOriginList, VENDOR_TYPES } from "./validation";

export type BusinessProfile = typeof schema.businessProfiles.$inferSelect;

export interface BusinessRecord {
  org: Organization;
  profile: BusinessProfile;
}

/* ---------------------------------------------------------------------------------- publishable keys */

/**
 * POLICY: one publishable key per business, and its mode follows the deployment: `pk_live_…` in production,
 * `pk_test_…` everywhere else. The schema has a single key column, so a production business has no test key.
 */
export function publishableKeyMode(): Mode {
  return process.env.NODE_ENV === "production" ? "live" : "test";
}

/** `pk_test_` / `pk_live_` followed by 32 URL-safe characters (192 random bits). Identifies a business; not a secret. */
export const PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9_-]{32}$/;

export function newPublishableKey(mode: Mode = publishableKeyMode()): string {
  return `pk_${mode}_${newToken(24)}`;
}

/** The mode a well-formed publishable key belongs to, or null for anything that is not one. */
export function publishableKeyModeOf(key: unknown): Mode | null {
  if (typeof key !== "string") return null;
  const m = PUBLISHABLE_KEY_PATTERN.exec(key);
  return m ? (m[1] as Mode) : null;
}

/* ---------------------------------------------------------------------------------------- validation */

function validationError(error: z.ZodError, message: string): never {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "form"] ??= issue.message;
  throw invalid(message, { fields });
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const nameSchema = z
  .string({ error: "Enter the business's name." })
  .refine((v) => !CONTROL_CHARS.test(v.replace(/[\t\r\n]/g, " ")), "The name contains characters that are not allowed.")
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Enter the business's name.").max(200, "Name: use at most 200 characters."));

const vendorTypeSchema = z.custom<VendorType>((v) => isVendorType(v), { message: `Choose a vendor type: ${VENDOR_TYPES.join(", ")}.` });

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

function urlSchema(opts: { httpsOnly: boolean; label: string }) {
  return z.preprocess(
    emptyToNull,
    z
      .string()
      .transform((v, ctx) => {
        const r = checkWebUrl(v, opts);
        if (!r.ok) {
          ctx.addIssue({ code: "custom", message: r.reason });
          return z.NEVER;
        }
        return r.url;
      })
      .nullable(),
  );
}

const brandColorSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .transform((v, ctx) => {
      const r = checkBrandColor(v);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.reason });
        return z.NEVER;
      }
      return r.color;
    })
    .nullable(),
);

const originsSchema = z
  .array(z.unknown(), { error: "Enter the allowed origins as a list." })
  .max(MAX_ALLOWED_ORIGINS, `List at most ${MAX_ALLOWED_ORIGINS} origins.`)
  .transform((list, ctx) => {
    const r = normalizeOriginList(list);
    if (!r.ok) {
      for (const [i, reason] of Object.entries(r.errors)) ctx.addIssue({ code: "custom", message: reason, path: [Number(i)] });
      return z.NEVER;
    }
    return r.origins;
  });

const holdWindowSchema = z
  .number({ error: "Enter the hold window in whole hours." })
  .int("Enter the hold window in whole hours.")
  .min(HOLD_WINDOW_HOURS.min, `Hold a reservation for at least ${HOLD_WINDOW_HOURS.min} hour.`)
  .max(HOLD_WINDOW_HOURS.max, `A reservation can be held for at most ${HOLD_WINDOW_HOURS.max} hours (30 days).`);

const createBusinessSchema = z.strictObject({
  name: nameSchema,
  vendorType: vendorTypeSchema,
  website: urlSchema({ httpsOnly: false, label: "Website" }).optional(),
  billingEmail: emailAddressSchema,
  ownerEmail: emailAddressSchema,
});

const profilePatchSchema = z
  .strictObject({
    displayName: nameSchema,
    vendorType: vendorTypeSchema,
    website: urlSchema({ httpsOnly: false, label: "Website" }),
    billingEmail: emailAddressSchema,
    brandColor: brandColorSchema,
    logoUrl: urlSchema({ httpsOnly: true, label: "Logo" }),
    holdWindowHours: holdWindowSchema,
    allowedOrigins: originsSchema,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Nothing to update.");

export interface CreateBusinessInput {
  name: string;
  vendorType: VendorType;
  website?: string | null;
  billingEmail: string;
  ownerEmail: string;
}

export type BusinessProfilePatch = z.input<typeof profilePatchSchema>;

const PATCH_FIELDS = ["displayName", "vendorType", "website", "billingEmail", "brandColor", "logoUrl", "holdWindowHours", "allowedOrigins"] as const;

const successFeeSchema = z.strictObject({
  flatCents: z
    .number({ error: "Enter the flat fee in whole cents." })
    .int("Enter the flat fee in whole cents.")
    .min(0, "The flat fee cannot be negative.")
    .max(SUCCESS_FEE_LIMITS.maxFlatCents, `The flat fee can be at most ${SUCCESS_FEE_LIMITS.maxFlatCents} cents.`),
  bps: z
    .number({ error: "Enter the percentage fee in whole basis points." })
    .int("Enter the percentage fee in whole basis points.")
    .min(0, "The percentage fee cannot be negative.")
    .max(SUCCESS_FEE_LIMITS.maxBps, `The percentage fee can be at most ${SUCCESS_FEE_LIMITS.maxBps} basis points.`),
});

/* -------------------------------------------------------------------------------------------- loading */

/** The business organization and its profile. `not_found` for a missing org, a non-business org or a missing profile. */
export async function loadBusiness(db: DbOrTx, orgId: string, opts: { forUpdate?: boolean } = {}): Promise<BusinessRecord> {
  if (typeof orgId !== "string" || orgId.length === 0) throw notFound("Business");
  const q = db
    .select({ org: schema.organizations, profile: schema.businessProfiles })
    .from(schema.businessProfiles)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.businessProfiles.orgId))
    .where(and(eq(schema.businessProfiles.orgId, orgId), eq(schema.organizations.type, "business")))
    .limit(1);
  const [row] = opts.forUpdate ? await q.for("update", { of: schema.businessProfiles }) : await q;
  if (!row) throw notFound("Business");
  return row;
}

/* ------------------------------------------------------------------------------------------- creation */

/**
 * Creates a business: an organization of type "business", its profile and its owner membership (the owner's account
 * is created if the address is new). The success fee is copied from the platform default
 * ("business.defaultSuccessFee") so later changes to the default do not silently change this business's terms.
 *
 * A platform admin (or system code) may name any owner; anyone else is signing up their own business and must be
 * the owner. Audited as "org.create" and "business.create". No email is sent: the owner signs in the normal way.
 */
export async function createBusiness(input: CreateBusinessInput, actor: BusinessActor, dbOrTx?: DbOrTx): Promise<BusinessRecord> {
  const parsed = createBusinessSchema.safeParse(input);
  if (!parsed.success) validationError(parsed.error, "Check the business details.");
  const { name, vendorType, website, billingEmail, ownerEmail } = parsed.data;
  const db = dbOrTx ?? (await getDb());

  if (!isBusinessSystemActor(actor)) {
    if (!actor || typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
    if (!(await isPlatformAdmin(actor.userId, db))) {
      const [self] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
      if (!self) throw forbidden();
      if (self.email !== ownerEmail) throw forbidden("You can only sign up a business that you will own.");
    }
  } else if (typeof actor.reason !== "string" || actor.reason.trim() === "") {
    throw forbidden();
  }
  const ctx = auditContextOf(actor);

  return db.transaction(async (tx) => {
    const fee = await getSetting("business.defaultSuccessFee", tx);
    const at = now();
    let [owner] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, ownerEmail)).limit(1);
    if (!owner) {
      await tx.insert(schema.users).values({ id: newId("user"), email: ownerEmail, createdAt: at }).onConflictDoNothing({ target: schema.users.email });
      [owner] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, ownerEmail)).limit(1);
    }
    const org = await createOrganization({ type: "business", name, ownerUserId: owner.id }, isBusinessSystemActor(actor) ? null : { userId: actor.userId, request: actor.request }, tx);
    const [profile] = await tx
      .insert(schema.businessProfiles)
      .values({
        orgId: org.id,
        displayName: name,
        vendorType,
        website: website ?? null,
        billingEmail,
        successFeeFlatCents: fee.flatCents,
        successFeeBps: fee.bps,
        publishableKey: newPublishableKey(),
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await audit(
      {
        actor: ctx.actor,
        orgId: org.id,
        action: "business.create",
        target: { type: "business", id: org.id },
        metadata: { name, vendorType, ownerUserId: owner.id, successFee: { flatCents: fee.flatCents, bps: fee.bps }, ...ctx.extra },
        request: ctx.request,
      },
      tx,
    );
    return { org, profile };
  });
}

/* ---------------------------------------------------------------------------------------------- reads */

/**
 * The business's organization and full profile (billing email, fee terms, allowed origins, publishable key);
 * `not_found` unless `orgId` is a business with a profile. Org-scoped read: callers guard access first
 * (requireOrgMember for staff screens). Never send this to a family's browser: use getBusinessByPublishableKey.
 */
export async function getBusinessProfile(orgId: string, dbOrTx?: DbOrTx): Promise<BusinessRecord> {
  const db = dbOrTx ?? (await getDb());
  return loadBusiness(db, orgId);
}

/** What the embed and the hosted handoff page may show about a business. Safe to serialize to any browser. */
export interface PublicBusiness {
  businessOrgId: string;
  displayName: string;
  vendorType: VendorType;
  website: string | null;
  brandColor: string | null;
  logoUrl: string | null;
  holdWindowHours: number;
  /** Mode of the key used: `test` handoffs never mix with `live` ones. */
  mode: Mode;
}

/**
 * Server-side resolution of a publishable key for the embed and handoff routes: the full record, for checks such as
 * isAllowedOrigin / isAllowedReturnUrl. Null for a malformed or unknown key, a key of the other mode than this
 * deployment issues, or a business whose organization is not active. Do not serialize the result to the browser.
 */
export async function resolvePublishableKey(key: unknown, dbOrTx?: DbOrTx): Promise<(BusinessRecord & { mode: Mode }) | null> {
  const mode = publishableKeyModeOf(key);
  if (!mode || mode !== publishableKeyMode()) return null;
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .select({ org: schema.organizations, profile: schema.businessProfiles })
    .from(schema.businessProfiles)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.businessProfiles.orgId))
    .where(and(eq(schema.businessProfiles.publishableKey, key as string), eq(schema.organizations.type, "business")))
    .limit(1);
  if (!row || row.org.status !== "active") return null;
  return { ...row, mode };
}

/** Public branding for a publishable key (the embed). Only the fields in PublicBusiness; null when the key resolves to nothing. */
export async function getBusinessByPublishableKey(key: unknown, dbOrTx?: DbOrTx): Promise<PublicBusiness | null> {
  const r = await resolvePublishableKey(key, dbOrTx);
  if (!r) return null;
  const p = r.profile;
  return {
    businessOrgId: p.orgId,
    displayName: p.displayName,
    vendorType: p.vendorType,
    website: p.website,
    brandColor: p.brandColor,
    logoUrl: p.logoUrl,
    holdWindowHours: p.holdWindowHours,
    mode: r.mode,
  };
}

/* ------------------------------------------------------------------------------------------ mutations */

/**
 * Updates the business's details, branding, hold window and embed origins. Owners and admins of the business, or a
 * platform admin. Strict: unknown keys are rejected (fees, publishable key and payments customer have their own
 * functions). An empty string clears website, brand color or logo. Audited as "business.profile_update" with the
 * changed fields.
 */
export async function updateBusinessProfile(orgId: string, patch: BusinessProfilePatch, actor: BusinessActor, dbOrTx?: DbOrTx): Promise<BusinessProfile> {
  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) validationError(parsed.error, "Check the business details.");
  const next = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorizeManage(tx, actor, orgId);
    const { profile } = await loadBusiness(tx, orgId, { forUpdate: true });

    const changes: Partial<Pick<BusinessProfile, (typeof PATCH_FIELDS)[number]>> = {};
    for (const key of PATCH_FIELDS) {
      const value = next[key];
      if (value === undefined) continue;
      const same = Array.isArray(value) ? JSON.stringify(value) === JSON.stringify(profile[key]) : value === profile[key];
      if (!same) (changes as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(changes).length === 0) return profile;

    const [updated] = await tx
      .update(schema.businessProfiles)
      .set({ ...changes, updatedAt: now() })
      .where(eq(schema.businessProfiles.orgId, orgId))
      .returning();
    const ctx = auditContextOf(actor);
    const diff = Object.fromEntries(Object.keys(changes).map((k) => [k, { from: profile[k as keyof BusinessProfile] ?? null, to: changes[k as keyof typeof changes] ?? null }]));
    await audit({ actor: ctx.actor, orgId, action: "business.profile_update", target: { type: "business", id: orgId }, metadata: { changes: diff, ...ctx.extra }, request: ctx.request }, tx);
    return updated;
  });
}

/**
 * Replaces the publishable key. The old key stops working immediately (embeds using it show nothing until the
 * snippet is updated). Owners and admins of the business, or a platform admin. Audited as
 * "business.publishable_key_rotate".
 */
export async function rotatePublishableKey(orgId: string, actor: BusinessActor, dbOrTx?: DbOrTx): Promise<BusinessProfile> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorizeManage(tx, actor, orgId);
    const { profile } = await loadBusiness(tx, orgId, { forUpdate: true });
    const publishableKey = newPublishableKey();
    const [updated] = await tx.update(schema.businessProfiles).set({ publishableKey, updatedAt: now() }).where(eq(schema.businessProfiles.orgId, orgId)).returning();
    const ctx = auditContextOf(actor);
    await audit(
      {
        actor: ctx.actor,
        orgId,
        action: "business.publishable_key_rotate",
        target: { type: "business", id: orgId },
        metadata: { previousKeyPrefix: profile.publishableKey.slice(0, 12), newKeyPrefix: publishableKey.slice(0, 12), ...ctx.extra },
        request: ctx.request,
      },
      tx,
    );
    return updated;
  });
}

/**
 * Sets the business's success fee: a flat amount per completed scholarship-funded booking and/or basis points of the
 * booking amount. Commercial terms: platform admins only (or system code such as a seed script); the business's own
 * owners cannot change them. Applies to bookings completed afterwards. Audited as "business.success_fee_update".
 */
export async function setSuccessFee(orgId: string, terms: SuccessFeeTerms, actor: BusinessActor, dbOrTx?: DbOrTx): Promise<BusinessProfile> {
  const parsed = successFeeSchema.safeParse(terms);
  if (!parsed.success) validationError(parsed.error, "Check the fee terms.");
  const { flatCents, bps } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorizePlatform(tx, actor);
    const { profile } = await loadBusiness(tx, orgId, { forUpdate: true });
    if (profile.successFeeFlatCents === flatCents && profile.successFeeBps === bps) return profile;
    const [updated] = await tx
      .update(schema.businessProfiles)
      .set({ successFeeFlatCents: flatCents, successFeeBps: bps, updatedAt: now() })
      .where(eq(schema.businessProfiles.orgId, orgId))
      .returning();
    const ctx = auditContextOf(actor);
    await audit(
      {
        actor: ctx.actor,
        orgId,
        action: "business.success_fee_update",
        target: { type: "business", id: orgId },
        metadata: { from: { flatCents: profile.successFeeFlatCents, bps: profile.successFeeBps }, to: { flatCents, bps }, ...ctx.extra },
        request: ctx.request,
      },
      tx,
    );
    return updated;
  });
}
