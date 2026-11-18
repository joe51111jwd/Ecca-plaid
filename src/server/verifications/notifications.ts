/**
 * Email to SGO staff when a verification needs review or has been decided. One builder makes the email for one
 * or many verifications (a digest is the same email with more lines); `notifySgo` sends it for one verification
 * now, honouring the SGO's preference stored in `sgo_profiles.settings[SGO_NOTIFICATION_SETTINGS_KEY]`.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { forbidden, invalid } from "@/lib/errors";
import { audit } from "@/server/audit";
import { assertOrgMember } from "@/server/auth";
import { renderEmail, type SendEmailInput } from "@/server/email";
import { getSgoProfile } from "@/server/sgos";
import { sgoNotificationCopy, type SgoNotificationItem } from "./copy";
import { loadUser, orgAuditActor, type OrgActor, type VerificationRow } from "./internal";
import { queueAndSend } from "./mail";
import { REVIEWER_ROLES, SGO_NOTIFICATION_DEFAULTS, SGO_NOTIFICATION_SETTINGS_KEY, SGO_VERIFICATION_PATH } from "./policy";

export type SgoNotificationKind = "needs_review" | "decided";

export interface SgoNotificationSettings {
  /** Email reviewers when a verification needs a person. */
  needsReview: boolean;
  /** Email reviewers when a verification is decided and its evidence pack is ready. */
  decided: boolean;
}

/** Template names in the outbox, one per kind. */
export const SGO_NOTIFICATION_TEMPLATES: Readonly<Record<SgoNotificationKind, string>> = Object.freeze({
  needs_review: "verification_needs_review",
  decided: "verification_decided",
});

/** Path of the dashboard review queue, linked from digest emails. */
export const SGO_REVIEW_QUEUE_PATH = "/sgo/review";

const settingsSchema = z.object({ needsReview: z.boolean().optional(), decided: z.boolean().optional() });

/** The SGO's preferences from `sgo_profiles.settings`; anything missing or malformed falls back to the defaults. */
export function readSgoNotificationSettings(settings: Record<string, unknown> | null | undefined): SgoNotificationSettings {
  const parsed = settingsSchema.safeParse(settings?.[SGO_NOTIFICATION_SETTINGS_KEY]);
  const stored = parsed.success ? parsed.data : {};
  return { needsReview: stored.needsReview ?? SGO_NOTIFICATION_DEFAULTS.needsReview, decided: stored.decided ?? SGO_NOTIFICATION_DEFAULTS.decided };
}

export async function getSgoNotificationSettings(orgId: string, dbOrTx?: DbOrTx): Promise<SgoNotificationSettings> {
  const db = dbOrTx ?? (await getDb());
  const { profile } = await getSgoProfile(orgId, db);
  return readSgoNotificationSettings(profile.settings);
}

/**
 * Changes the SGO's verification email preferences. Owners and admins only (signed-in staff; not API keys). Only
 * this module's key inside `sgo_profiles.settings` is written; every other setting is left as it is.
 */
export async function setSgoNotificationSettings(orgId: string, patch: Partial<SgoNotificationSettings>, actor: OrgActor, dbOrTx?: DbOrTx): Promise<SgoNotificationSettings> {
  const parsed = z.strictObject({ needsReview: z.boolean().optional(), decided: z.boolean().optional() }).safeParse(patch);
  if (!parsed.success) throw invalid("Choose on or off for each email.", { fields: { settings: "needsReview and decided must be true or false." } });
  if (actor.type !== "user") throw forbidden("Only signed-in staff can change email preferences.");
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const user = await loadUser(tx, actor.id).catch(() => {
      throw forbidden();
    });
    await assertOrgMember(user, orgId, "admin", tx);
    const before = await getSgoNotificationSettings(orgId, tx);
    const after: SgoNotificationSettings = { ...before, ...parsed.data };
    await tx
      .update(schema.sgoProfiles)
      .set({ settings: sql`jsonb_set(${schema.sgoProfiles.settings}, ${`{${SGO_NOTIFICATION_SETTINGS_KEY}}`}::text[], ${JSON.stringify(after)}::jsonb, true)` })
      .where(eq(schema.sgoProfiles.orgId, orgId));
    await audit({ actor: orgAuditActor(actor), orgId, action: "sgo.notification_settings_update", target: { type: "organization", id: orgId }, metadata: { before, after }, request: actor.request }, tx);
    return after;
  });
}

/**
 * The email for one or many verifications of one SGO, without a recipient. The same function serves an immediate
 * notice (one item) and a digest (several), so the wording stays in one place.
 */
export function buildSgoNotificationEmail(kind: SgoNotificationKind, input: { mode: Mode; items: readonly SgoNotificationItem[] }): Omit<SendEmailInput, "to"> {
  if (input.items.length === 0) throw invalid("A notification needs at least one verification.");
  const copy = sgoNotificationCopy(kind, input);
  const url = input.items.length === 1 ? appUrl(SGO_VERIFICATION_PATH(input.items[0]!.verificationId)) : appUrl(SGO_REVIEW_QUEUE_PATH);
  const rendered = renderEmail({ heading: copy.heading, paragraphs: copy.paragraphs, cta: { label: copy.cta, url } });
  return {
    subject: copy.subject,
    template: SGO_NOTIFICATION_TEMPLATES[kind],
    html: rendered.html,
    text: rendered.text,
    ...(input.items.length === 1 ? { related: { type: "verification", id: input.items[0]!.verificationId } } : {}),
  };
}

/** Email addresses of the SGO's staff who review verifications (owner, admin, reviewer), sorted. */
export async function reviewerRecipients(db: DbOrTx, orgId: string): Promise<string[]> {
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), inArray(schema.memberships.role, [...REVIEWER_ROLES])))
    .orderBy(asc(schema.users.email));
  return [...new Set(rows.map((r) => r.email))];
}

/**
 * Queues the notice for one verification in the caller's transaction, unless the SGO turned this kind off.
 * Returns how many people were emailed.
 */
export async function notifySgo(db: DbOrTx, v: VerificationRow, kind: SgoNotificationKind, detail: { reasonCount?: number } = {}): Promise<number> {
  const settings = await getSgoNotificationSettings(v.orgId, db);
  if (kind === "needs_review" ? !settings.needsReview : !settings.decided) return 0;
  const item: SgoNotificationItem =
    kind === "needs_review"
      ? { verificationId: v.id, externalRef: v.externalRef, reasonCount: detail.reasonCount ?? 0 }
      : { verificationId: v.id, externalRef: v.externalRef, status: v.status === "ineligible" ? "ineligible" : "eligible", decidedBy: v.decidedBy === "engine" ? "engine" : "reviewer" };
  const email = buildSgoNotificationEmail(kind, { mode: v.mode, items: [item] });
  const recipients = await reviewerRecipients(db, v.orgId);
  for (const to of recipients) await queueAndSend({ ...email, to }, db);
  return recipients.length;
}
