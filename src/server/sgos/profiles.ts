import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { now } from "@/lib/clock";
import { conflict, forbidden, invalid } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { emailAddressSchema, isPlatformAdmin, type Organization } from "@/server/auth";
import { createOrganization } from "@/server/orgs";
import { auditContextOf, authorize, isSystemActor, loadSgo, type SgoActor, type SgoProfile } from "./access";
import { cleanText, hasControlChars, inProduction, isSandboxEin, normalizeEin } from "./identity";
import { describeListing, type ListStatusResult } from "./list-status";
import { getActiveListSource, resolveEntry } from "./listing";
import { normalizeStateCode } from "./states";

/* ------------------------------------------------------------------------------------- validation */

const EIN_MESSAGE = "Enter the EIN as NN-NNNNNNN.";

const einSchema = z.string().transform((v, ctx) => {
  const ein = normalizeEin(v);
  if (!ein) {
    ctx.addIssue({ code: "custom", message: EIN_MESSAGE });
    return z.NEVER;
  }
  if (inProduction() && isSandboxEin(ein)) {
    ctx.addIssue({ code: "custom", message: "That EIN is reserved for sandbox demo organizations." });
    return z.NEVER;
  }
  return ein;
});

const stateSchema = z.string().transform((v, ctx) => {
  const code = normalizeStateCode(v);
  if (!code) {
    ctx.addIssue({ code: "custom", message: "Choose a US State." });
    return z.NEVER;
  }
  return code;
});

/** Single-line text: trimmed, whitespace collapsed, no control characters; "" becomes null for optional fields. */
function lineText(max: number, label: string) {
  return z
    .string()
    .refine((v) => !hasControlChars(v.replace(/[\t\r\n]/g, " ")), `${label} contains characters that are not allowed.`)
    .transform(cleanText)
    .pipe(z.string().max(max, `${label}: use at most ${max} characters.`));
}

const optional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable());

function webUrl(opts: { httpsOnly: boolean; label: string }) {
  return z
    .string()
    .trim()
    .max(500, `${opts.label}: use at most 500 characters.`)
    .transform((v, ctx) => {
      let url: URL;
      try {
        url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
      } catch {
        ctx.addIssue({ code: "custom", message: `Enter a valid web address for ${opts.label.toLowerCase()}.` });
        return z.NEVER;
      }
      const okProtocol = url.protocol === "https:" || (!opts.httpsOnly && url.protocol === "http:");
      if (!okProtocol || url.username || url.password || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) {
        ctx.addIssue({ code: "custom", message: `Enter a valid ${opts.httpsOnly ? "https " : ""}web address for ${opts.label.toLowerCase()}.` });
        return z.NEVER;
      }
      return url.toString();
    });
}

const nameSchema = lineText(200, "Name").pipe(z.string().min(1, "Enter the organization's name."));

const createSgoSchema = z.strictObject({
  name: nameSchema,
  ein: optional(einSchema).optional(),
  city: optional(lineText(100, "City")).optional(),
  state: stateSchema.default("TX"),
  ownerEmail: emailAddressSchema,
});

const profilePatchSchema = z
  .strictObject({
    displayName: nameSchema,
    legalName: optional(lineText(200, "Legal name")),
    ein: optional(einSchema),
    description: optional(z.string().trim().max(2000, "Description: use at most 2000 characters.")),
    website: optional(webUrl({ httpsOnly: false, label: "Website" })),
    city: optional(lineText(100, "City")),
    state: stateSchema,
    supportEmail: optional(emailAddressSchema),
    logoUrl: optional(webUrl({ httpsOnly: true, label: "Logo" })),
    acceptsDonations: z.boolean(),
    acceptsHandoffs: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Nothing to update.");

/** Section 25F(c)(2)(A) caps eligibility at 300% of area median gross income; an SGO may set a lower cap, never a higher one. */
export const STATUTORY_MAX_INCOME_CAP_PCT = 300;

/** Accepted ranges for an SGO's own policy. The statute fixes only the cap's ceiling; the other bounds are product policy. */
export const SGO_POLICY_LIMITS = {
  incomeCapPct: { min: 1, max: STATUTORY_MAX_INCOME_CAP_PCT },
  reviewBandBps: { min: 0, max: 2000 },
  rawRetentionDays: { min: 1, max: 365 },
} as const;

const policyPatchSchema = z
  .strictObject({
    incomeCapPct: z
      .number({ error: "Enter the income cap as a whole percent." })
      .int("Enter the income cap as a whole percent.")
      .min(SGO_POLICY_LIMITS.incomeCapPct.min, "The income cap must be at least 1%.")
      .max(STATUTORY_MAX_INCOME_CAP_PCT, "The statute caps eligibility at 300% of area median gross income. You can set a lower cap, not a higher one."),
    reviewBandBps: z
      .number({ error: "Enter the review band in basis points." })
      .int("Enter the review band in whole basis points.")
      .min(SGO_POLICY_LIMITS.reviewBandBps.min, "The review band cannot be negative.")
      .max(SGO_POLICY_LIMITS.reviewBandBps.max, "The review band can be at most 2000 basis points (20%)."),
    rawRetentionDays: z
      .number({ error: "Enter the number of days." })
      .int("Enter a whole number of days.")
      .min(SGO_POLICY_LIMITS.rawRetentionDays.min, "Keep uploads for at least 1 day.")
      .max(SGO_POLICY_LIMITS.rawRetentionDays.max, "Uploads can be kept for at most 365 days."),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Nothing to update.");

/** Stripe Connect account ids (the same shape src/server/payments accepts). */
const PAYMENTS_ACCOUNT_ID = /^acct_[A-Za-z0-9]{1,255}$/;

function validationError(error: z.ZodError, message: string): never {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "form"] ??= issue.message;
  throw invalid(message, { fields });
}

function isUniqueViolation(e: unknown, constraint?: string): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    if (typeof cur === "object" && (cur as { code?: unknown }).code === "23505") {
      const name = (cur as { constraint?: unknown }).constraint;
      return !constraint || typeof name !== "string" || name === constraint;
    }
    cur = typeof cur === "object" ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function assertEinFree(tx: DbOrTx, ein: string, exceptOrgId: string | null): Promise<void> {
  const p = schema.sgoProfiles;
  const [holder] = await tx
    .select({ orgId: p.orgId })
    .from(p)
    .where(exceptOrgId ? and(eq(p.ein, ein), ne(p.orgId, exceptOrgId)) : eq(p.ein, ein))
    .limit(1);
  if (holder) throw conflict("Another organization already uses that EIN. Contact support if it is yours.", { fields: { ein: "Already registered." } });
}

const EIN_TAKEN = () => conflict("Another organization already uses that EIN. Contact support if it is yours.", { fields: { ein: "Already registered." } });

/* ---------------------------------------------------------------------------------------- profiles */

export interface CreateSgoInput {
  name: string;
  ein?: string | null;
  city?: string | null;
  /** Two-letter code; default "TX". */
  state?: string;
  ownerEmail: string;
}

export interface SgoRecord {
  org: Organization;
  profile: SgoProfile;
}

/**
 * Creates an SGO: an organization of type "sgo", its profile and its owner membership (the owner's account is
 * created if the address is new). A platform admin (or system code) may name any owner; anyone else is signing
 * up their own organization and must be the owner. Audited as "org.create" and "sgo.create".
 *
 * No email is sent: the owner signs in the normal way. Being created does not put an SGO on any list — only a
 * platform admin's link to a list entry does.
 */
export async function createSgo(input: CreateSgoInput, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoRecord> {
  const parsed = createSgoSchema.safeParse(input);
  if (!parsed.success) validationError(parsed.error, "Check the organization details.");
  const { name, ein, city, state, ownerEmail } = parsed.data;
  const db = dbOrTx ?? (await getDb());

  if (!isSystemActor(actor)) {
    if (typeof actor.userId !== "string" || actor.userId.length === 0) throw forbidden();
    if (!(await isPlatformAdmin(actor.userId, db))) {
      const [self] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
      if (!self) throw forbidden();
      if (self.email !== ownerEmail) throw forbidden("You can only sign up an organization that you will own.");
    }
  }
  const ctx = auditContextOf(actor);

  try {
    return await db.transaction(async (tx) => {
      if (ein) await assertEinFree(tx, ein, null);
      const at = now();
      let [owner] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, ownerEmail)).limit(1);
      if (!owner) {
        await tx.insert(schema.users).values({ id: newId("user"), email: ownerEmail, createdAt: at }).onConflictDoNothing({ target: schema.users.email });
        [owner] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, ownerEmail)).limit(1);
      }
      const org = await createOrganization({ type: "sgo", name, ownerUserId: owner.id }, isSystemActor(actor) ? null : { userId: actor.userId, request: actor.request }, tx);
      const [profile] = await tx
        .insert(schema.sgoProfiles)
        .values({ orgId: org.id, displayName: name, ein: ein ?? null, city: city ?? null, state, createdAt: at, updatedAt: at })
        .returning();
      await audit(
        {
          actor: ctx.actor,
          orgId: org.id,
          action: "sgo.create",
          target: { type: "sgo", id: org.id },
          metadata: { name, ein: ein ?? null, state, ownerUserId: owner.id, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) },
          request: ctx.request,
        },
        tx,
      );
      return { org, profile };
    });
  } catch (e) {
    if (isUniqueViolation(e, "sgo_profiles_ein_uq")) throw EIN_TAKEN();
    throw e;
  }
}

/**
 * The SGO's organization and profile; `not_found` unless `orgId` is an SGO with a profile. Org-scoped read:
 * callers guard access first (requireOrgMember for staff screens).
 */
export async function getSgoProfile(orgId: string, dbOrTx?: DbOrTx): Promise<SgoRecord> {
  const db = dbOrTx ?? (await getDb());
  return loadSgo(db, orgId);
}

export type SgoProfilePatch = z.input<typeof profilePatchSchema>;

const PROFILE_FIELDS = ["displayName", "legalName", "ein", "description", "website", "city", "state", "supportEmail", "logoUrl", "acceptsDonations", "acceptsHandoffs"] as const;

/**
 * Updates the SGO's public and contact details. Owners and admins of the SGO, or a platform admin. Strict: unknown
 * keys are rejected (policy, list link, payments account and portal registration have their own functions).
 * While the SGO is linked to a list entry, its State cannot change, nor can an EIN that the entry carries: a
 * platform admin unlinks first. Audited as "sgo.profile_update" with the changed fields.
 */
export async function updateSgoProfile(orgId: string, patch: SgoProfilePatch, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoProfile> {
  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) validationError(parsed.error, "Check the organization details.");
  const next = parsed.data;
  const db = dbOrTx ?? (await getDb());
  try {
    return await db.transaction(async (tx) => {
      await authorize(tx, actor, "manage", orgId);
      const { profile } = await loadSgo(tx, orgId, { forUpdate: true });

      const changes: Partial<Record<(typeof PROFILE_FIELDS)[number], unknown>> = {};
      for (const key of PROFILE_FIELDS) {
        if (key in next && next[key] !== undefined && next[key] !== profile[key]) changes[key] = next[key];
      }
      if (Object.keys(changes).length === 0) return profile;

      if (profile.listEntryId && ("ein" in changes || "state" in changes)) {
        const [entry] = await tx.select().from(schema.sgoListEntries).where(eq(schema.sgoListEntries.id, profile.listEntryId)).limit(1);
        if ("state" in changes) {
          throw conflict("This organization is verified against a list entry for its State. Contact support to change the State.", { fields: { state: "Locked while listed." } });
        }
        if (entry?.ein) {
          throw conflict("This organization's EIN was verified against the SGO list. Contact support to change it.", { fields: { ein: "Locked while listed." } });
        }
      }
      if (typeof changes.ein === "string") await assertEinFree(tx, changes.ein, orgId);

      const [updated] = await tx
        .update(schema.sgoProfiles)
        .set({ ...(changes as Partial<SgoProfile>), updatedAt: now() })
        .where(eq(schema.sgoProfiles.orgId, orgId))
        .returning();
      const ctx = auditContextOf(actor);
      const diff = Object.fromEntries(Object.keys(changes).map((k) => [k, { from: profile[k as keyof SgoProfile] ?? null, to: changes[k as keyof typeof changes] ?? null }]));
      await audit(
        { actor: ctx.actor, orgId, action: "sgo.profile_update", target: { type: "sgo", id: orgId }, metadata: { changes: diff, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) }, request: ctx.request },
        tx,
      );
      return updated;
    });
  } catch (e) {
    if (isUniqueViolation(e, "sgo_profiles_ein_uq")) throw EIN_TAKEN();
    throw e;
  }
}

/* ------------------------------------------------------------------------------------------ policy */

/** The SGO's own verification and retention policy, as the decision engine and the retention job consume it. */
export interface SgoPolicy {
  orgId: string;
  /** Percent of area median gross income, 1–300. 300 is the statutory maximum; lower is the SGO's stricter policy. */
  incomeCapPct: number;
  /** While the threshold table is provisional, incomes within this many basis points of the limit go to review (0–2000). */
  reviewBandBps: number;
  /** Days raw uploads are kept after a decision before their bytes are purged (1–365). */
  rawRetentionDays: number;
}

export type SgoPolicyPatch = Partial<Omit<SgoPolicy, "orgId">>;

function policyOf(profile: SgoProfile): SgoPolicy {
  return { orgId: profile.orgId, incomeCapPct: profile.incomeCapPct, reviewBandBps: profile.reviewBandBps, rawRetentionDays: profile.rawRetentionDays };
}

export async function getSgoPolicy(orgId: string, dbOrTx?: DbOrTx): Promise<SgoPolicy> {
  const db = dbOrTx ?? (await getDb());
  const { profile } = await loadSgo(db, orgId);
  return policyOf(profile);
}

/**
 * Sets any of the policy values. A cap above 300% is refused: the statute allows a stricter cap, never a looser one.
 * Owners and admins of the SGO, or a platform admin. Audited as "sgo.policy_update" with before/after values.
 * Applies to decisions made after the change; decisions already made keep the cap they recorded.
 */
export async function updateSgoPolicy(orgId: string, patch: SgoPolicyPatch, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoPolicy> {
  const parsed = policyPatchSchema.safeParse(patch);
  if (!parsed.success) validationError(parsed.error, "Check the policy values.");
  const next = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorize(tx, actor, "manage", orgId);
    const { profile } = await loadSgo(tx, orgId, { forUpdate: true });
    const before = policyOf(profile);
    const after: SgoPolicy = { ...before, ...next };
    if (after.incomeCapPct === before.incomeCapPct && after.reviewBandBps === before.reviewBandBps && after.rawRetentionDays === before.rawRetentionDays) return before;
    const [updated] = await tx
      .update(schema.sgoProfiles)
      .set({ incomeCapPct: after.incomeCapPct, reviewBandBps: after.reviewBandBps, rawRetentionDays: after.rawRetentionDays, updatedAt: now() })
      .where(eq(schema.sgoProfiles.orgId, orgId))
      .returning();
    const ctx = auditContextOf(actor);
    await audit(
      {
        actor: ctx.actor,
        orgId,
        action: "sgo.policy_update",
        target: { type: "sgo", id: orgId },
        metadata: { from: { ...before, orgId: undefined }, to: { ...after, orgId: undefined }, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) },
        request: ctx.request,
      },
      tx,
    );
    return policyOf(updated);
  });
}

/* ------------------------------------------------------------------------------------ onboarding */

/**
 * Records the SGO's own statement that it has (or has not) registered in the IRS SGO portal. Only the SGO can
 * register (a contact who can bind it must; docs/reference/acknowledgment-reporting.md, E3), so this is an
 * attestation by its owner or admin, or a platform admin. Until it is true no real unique donor numbers can exist.
 * Audited as "sgo.irs_portal_registration".
 */
export async function setIrsPortalRegistered(orgId: string, registered: boolean, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoProfile> {
  if (typeof registered !== "boolean") throw invalid("Choose whether the organization is registered.", { fields: { registered: "Required." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorize(tx, actor, "manage", orgId);
    const { profile } = await loadSgo(tx, orgId, { forUpdate: true });
    if (profile.irsPortalRegistered === registered) return profile;
    const at = now();
    const [updated] = await tx
      .update(schema.sgoProfiles)
      .set({ irsPortalRegistered: registered, irsPortalRegisteredAt: registered ? at : null, updatedAt: at })
      .where(eq(schema.sgoProfiles.orgId, orgId))
      .returning();
    const ctx = auditContextOf(actor);
    await audit(
      { actor: ctx.actor, orgId, action: "sgo.irs_portal_registration", target: { type: "sgo", id: orgId }, metadata: { registered, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) }, request: ctx.request },
      tx,
    );
    return updated;
  });
}

/**
 * Sets (or clears, with null) the connected payments account gifts settle to. Platform admins or system code
 * (the payments onboarding flow) only: SGO staff cannot redirect where donor money goes. Audited as
 * "sgo.payments_account_update".
 */
export async function setPaymentsAccount(orgId: string, accountId: string | null, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoProfile> {
  const value = accountId === null ? null : typeof accountId === "string" ? accountId.trim() : "";
  if (value !== null && !PAYMENTS_ACCOUNT_ID.test(value)) {
    throw invalid("Enter a connected account id (acct_…).", { fields: { accountId: "Enter a connected account id (acct_…)." } });
  }
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorize(tx, actor, "platform");
    const { profile } = await loadSgo(tx, orgId, { forUpdate: true });
    if (profile.paymentsAccountId === value) return profile;
    const [updated] = await tx.update(schema.sgoProfiles).set({ paymentsAccountId: value, updatedAt: now() }).where(eq(schema.sgoProfiles.orgId, orgId)).returning();
    const ctx = auditContextOf(actor);
    await audit(
      {
        actor: ctx.actor,
        orgId,
        action: "sgo.payments_account_update",
        target: { type: "sgo", id: orgId },
        metadata: { from: profile.paymentsAccountId, to: value, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) },
        request: ctx.request,
      },
      tx,
    );
    return updated;
  });
}

/**
 * Records that the SGO works in the dashboard only (true) or intends to receive webhooks (false). Owners and
 * admins, or a platform admin. Audited as "sgo.integration_update".
 */
export async function setDashboardOnly(orgId: string, dashboardOnly: boolean, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoProfile> {
  if (typeof dashboardOnly !== "boolean") throw invalid("Choose how you will receive results.", { fields: { dashboardOnly: "Required." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorize(tx, actor, "manage", orgId);
    const { profile } = await loadSgo(tx, orgId, { forUpdate: true });
    if (profile.dashboardOnly === dashboardOnly) return profile;
    const [updated] = await tx.update(schema.sgoProfiles).set({ dashboardOnly, updatedAt: now() }).where(eq(schema.sgoProfiles.orgId, orgId)).returning();
    const ctx = auditContextOf(actor);
    await audit(
      { actor: ctx.actor, orgId, action: "sgo.integration_update", target: { type: "sgo", id: orgId }, metadata: { dashboardOnly, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) }, request: ctx.request },
      tx,
    );
    return updated;
  });
}

export type OnboardingItemKey = "ein" | "list" | "irs_portal" | "payments" | "integration" | "team";

export interface OnboardingItem {
  key: OnboardingItemKey;
  title: string;
  done: boolean;
  /** True when the step cannot be completed until something else is (see `reason`). */
  blocked: boolean;
  /** Plain-language state of the step and what to do next. */
  reason: string;
}

export interface OnboardingChecklist {
  orgId: string;
  items: OnboardingItem[];
  /** Every item is done. */
  complete: boolean;
  /** The list standing the checklist was computed from. */
  listStatus: ListStatusResult;
}

/**
 * The SGO's setup steps, in order: EIN on file, on the list, IRS SGO portal registration, payments account,
 * webhook or dashboard-only, team invited. Org-scoped read: callers guard access first.
 */
export async function onboardingChecklist(orgId: string, dbOrTx?: DbOrTx): Promise<OnboardingChecklist> {
  const db = dbOrTx ?? (await getDb());
  const { profile } = await loadSgo(db, orgId);
  const source = await getActiveListSource(db);
  const listStatus = describeListing(await resolveEntry(db, profile, source), source, now());

  const [webhooks] = await db
    .select({ n: count() })
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.orgId, orgId), eq(schema.webhookEndpoints.status, "active")));
  const [members] = await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
  const activeWebhooks = Number(webhooks?.n ?? 0);
  const memberCount = Number(members?.n ?? 0);
  const listName = source === "irs_published" ? "IRS SGO list" : "provisional list";

  const items: OnboardingItem[] = [
    {
      key: "ein",
      title: "EIN on file",
      done: Boolean(profile.ein),
      blocked: false,
      reason: profile.ein
        ? `EIN ${profile.ein} is on file.`
        : "Add your EIN. It is printed on every donor acknowledgment and is how we match you to the SGO list.",
    },
    (() => {
      const done = listStatus.status === "irs_listed" || listStatus.status === "provisional";
      if (done) return { key: "list" as const, title: "On the SGO list", done, blocked: false, reason: `${listStatus.label}.` };
      if (listStatus.status === "removed") {
        return { key: "list" as const, title: "On the SGO list", done: false, blocked: true, reason: `${listStatus.label}. Contact support if you believe this is wrong.` };
      }
      if (listStatus.entryId) return { key: "list" as const, title: "On the SGO list", done: false, blocked: true, reason: `${listStatus.label}. Gifts can be accepted from that date.` };
      if (!profile.ein) {
        return { key: "list" as const, title: "On the SGO list", done: false, blocked: true, reason: `Add your EIN first: we check the ${listName} by EIN.` };
      }
      return {
        key: "list" as const,
        title: "On the SGO list",
        done: false,
        blocked: false,
        reason: `We have not matched you to the ${listName} yet. Gifts can be accepted only once a platform admin has verified your listing.`,
      };
    })(),
    {
      key: "irs_portal",
      title: "Registered in the IRS SGO portal",
      done: profile.irsPortalRegistered,
      blocked: false,
      reason: profile.irsPortalRegistered
        ? "You told us you have registered in the IRS SGO portal."
        : "Register in the IRS SGO portal. Until you do, you cannot create unique donor numbers or send compliant donor acknowledgments.",
    },
    {
      key: "payments",
      title: "Payments account connected",
      done: Boolean(profile.paymentsAccountId),
      blocked: false,
      reason: profile.paymentsAccountId ? "Gifts settle to your connected payments account." : "Connect a payments account so gifts can settle to you.",
    },
    {
      key: "integration",
      title: "Webhook or dashboard-only",
      done: activeWebhooks > 0 || profile.dashboardOnly,
      blocked: false,
      reason:
        activeWebhooks > 0
          ? `${activeWebhooks} active webhook endpoint${activeWebhooks === 1 ? "" : "s"} will receive results.`
          : profile.dashboardOnly
            ? "You chose to work in the dashboard only."
            : "Add a webhook endpoint to receive results in your own system, or choose to work in the dashboard only.",
    },
    {
      key: "team",
      title: "Team invited",
      done: memberCount > 1,
      blocked: false,
      reason: memberCount > 1 ? `${memberCount} people are on your team.` : "Invite at least one colleague so more than one person can review applications.",
    },
  ];
  return { orgId, items, complete: items.every((i) => i.done), listStatus };
}

