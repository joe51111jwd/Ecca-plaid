import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { RailStatus } from "@/db/schema";
import { centralDateString, now } from "@/lib/clock";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit, normalizeIp, type AuditRequestInfo } from "@/server/audit";
import { assertHouseholdAccess, type User } from "@/server/auth";
import {
  CONSENT_COPY_KINDS,
  getConsentCopy,
  isConsentLocale,
  renderConsent,
  type ConsentCopyKind,
  type ConsentLocale,
  type ConsentVarsByKind,
  type RenderedConsent,
} from "./copy";

/**
 * Consent records: a person agreed to a specific version of specific words, at a specific time.
 *
 * The text is always re-rendered on the server from the registry in ./copy (never taken from the client),
 * and the grant stores the version id, the SHA-256 of the exact words, the structured scope, the variables
 * used, the locale, the time and the request's IP and user agent. Rows are immutable except `revokedAt`.
 *
 * Who may grant (spec: "Support more than one adult on the household, with a clear owner for consent"):
 *  - verification_share, passport_reuse: only the household owner. This is the parent's written instruction
 *    to collect and share (the consumer-directed design in the spec's FCRA row).
 *  - rail_connect: the owner or another adult member with their own sign-in (each connects their own account).
 *  - electronic_delivery: any signed-in person, for themselves.
 */

export type Consent = typeof schema.consents.$inferSelect;

export interface ConsentActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

export {
  CONSENT_COPY,
  CONSENT_COPY_KINDS,
  CONSENT_LOCALES,
  CONSENT_VAR_TYPES,
  CURRENT_CONSENT_VERSION,
  consentTemplateSha256,
  consentText,
  formatConsentDate,
  getConsentCopy,
  isConsentCopyKind,
  isConsentLocale,
  placeholdersOf,
  renderConsent,
  type ConsentCopyEntry,
  type ConsentCopyKind,
  type ConsentLocale,
  type ConsentVarsByKind,
  type RenderedConsent,
  type RenderedScope,
} from "./copy";

/**
 * Policy (sources are silent): the longest period a sharing permission may run, counted from the day it is
 * given. A sanity bound against typos in the caller's `shareUntil`, not a legal rule; the verifications
 * service chooses the actual period.
 */
export const CONSENT_MAX_PERIOD_DAYS = 731;

/** Rail connection states in which the provider can still send data. Revoking the consent must close these. */
export const OPEN_RAIL_STATUSES: readonly RailStatus[] = ["created", "connecting", "connected", "syncing", "ready"];

const HOUSEHOLD_KINDS: ReadonlySet<ConsentCopyKind> = new Set(["verification_share", "passport_reuse", "rail_connect"]);
const OWNER_ONLY_KINDS: ReadonlySet<ConsentCopyKind> = new Set(["verification_share", "passport_reuse"]);

/* ---------------------------------------------------------------------------------------- helpers */

/** The first instant after the given calendar day ends in US Central time. */
export function endOfCentralDay(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Next-day midnight is 05:00Z under CDT and 06:00Z under CST; DST changes at 2 a.m., never at midnight.
  const cdt = new Date(Date.UTC(y!, m! - 1, d! + 1, 5));
  return centralDateString(cdt) === centralDateString(new Date(Date.UTC(y!, m! - 1, d! + 1, 12))) ? cdt : new Date(Date.UTC(y!, m! - 1, d! + 1, 6));
}

const MAX_USER_AGENT_LENGTH = 512;

function tidyUserAgent(raw: string | null | undefined): string | null {
  const v = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  return v.length === 0 ? null : v.slice(0, MAX_USER_AGENT_LENGTH);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

async function loadUser(db: DbOrTx, userId: string): Promise<User> {
  const [user] = typeof userId === "string" && userId.length > 0 ? await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1) : [];
  if (!user) throw forbidden();
  return user;
}

const grantSchema = z.object({
  kind: z.enum(CONSENT_COPY_KINDS as [ConsentCopyKind, ...ConsentCopyKind[]], { error: "Unknown consent kind." }),
  userId: z.string().min(1),
  householdId: z.string().min(1).nullish(),
  verificationId: z.string().min(1).nullish(),
  recipientOrgId: z.string().min(1).nullish(),
  locale: z.string().refine(isConsentLocale, "Unknown language."),
  vars: z.record(z.string(), z.unknown()).default({}),
  shownSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

export interface GrantConsentInput {
  kind: ConsentCopyKind;
  userId: string;
  householdId?: string | null;
  verificationId?: string | null;
  recipientOrgId?: string | null;
  locale: ConsentLocale;
  /**
   * Variables the server cannot work out itself. `organizationName`, `email`, and for passport reuse
   * `decidedDate` / `resultValidUntil`, are always taken from the database and override anything passed.
   */
  vars?: Partial<Record<string, string | number>>;
  /** SHA-256 of the text the person saw. When given and the server's rendering differs, the grant is refused. */
  shownSha256?: string | null;
  request?: AuditRequestInfo | null;
}

export interface GrantConsentResult {
  consent: Consent;
  rendered: RenderedConsent;
}

/* ------------------------------------------------------------------------------------------ grant */

/**
 * Records a consent. Re-renders the copy server-side, checks who may grant it and for what, and writes the
 * row and an audit entry in one transaction. Throws validation_failed (bad input), forbidden (not allowed),
 * not_found (unknown or inaccessible household/verification), conflict (verification closed, text changed).
 */
export async function grantConsent(input: GrantConsentInput, dbOrTx?: DbOrTx): Promise<GrantConsentResult> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "consent")] ??= issue.message;
    throw invalid("The consent request is not valid.", { fields });
  }
  const req = parsed.data;
  const kind = req.kind;
  const locale = req.locale as ConsentLocale;
  const db = dbOrTx ?? (await getDb());

  return db.transaction(async (tx) => {
    const user = await loadUser(tx, req.userId);
    const today = centralDateString(now());
    const vars: Record<string, unknown> = { ...req.vars };
    let householdId: string | null = null;
    let verificationId: string | null = null;
    let recipientOrgId: string | null = null;

    if (HOUSEHOLD_KINDS.has(kind)) {
      if (!req.householdId) throw invalid("A household is required for this consent.", { fields: { householdId: "Required." } });
      if (!req.verificationId) throw invalid("A verification is required for this consent.", { fields: { verificationId: "Required." } });
      const access = await assertHouseholdAccess(user, req.householdId, tx);
      if (OWNER_ONLY_KINDS.has(kind) && access.access !== "owner") {
        throw forbidden("Only the adult in charge of this household can give this permission.");
      }
      householdId = access.household.id;

      const [ver] = await tx.select().from(schema.verifications).where(eq(schema.verifications.id, req.verificationId)).limit(1);
      // A verification tied to another household is reported exactly like a missing one.
      if (!ver || (ver.householdId !== null && ver.householdId !== householdId)) throw notFound("Verification");
      if (ver.status === "canceled" || ver.status === "expired") throw conflict("This verification is closed.");
      verificationId = ver.id;

      if (req.recipientOrgId && req.recipientOrgId !== ver.orgId) throw invalid("The receiving organization does not match this verification.", { fields: { recipientOrgId: "Does not match the verification." } });
      if (OWNER_ONLY_KINDS.has(kind) && !req.recipientOrgId) throw invalid("Say which organization receives the result.", { fields: { recipientOrgId: "Required." } });
      const [org] = await tx.select().from(schema.organizations).where(eq(schema.organizations.id, ver.orgId)).limit(1);
      if (!org || org.type !== "sgo") throw notFound("Organization");
      recipientOrgId = org.id;
      vars.organizationName = org.name;

      if (kind === "passport_reuse") {
        if (!ver.passportSourceId) throw conflict("This verification does not reuse an earlier result.");
        const [source] = await tx.select().from(schema.verifications).where(eq(schema.verifications.id, ver.passportSourceId)).limit(1);
        if (!source || source.householdId !== householdId) throw notFound("Earlier result");
        if (!source.decidedAt || !source.expiresAt || source.expiresAt.getTime() <= now().getTime()) throw conflict("The earlier result can no longer be reused.");
        vars.decidedDate = centralDateString(source.decidedAt);
        vars.resultValidUntil = centralDateString(source.expiresAt);
      }
    } else {
      if (req.verificationId || req.recipientOrgId) throw invalid("This consent is not tied to a verification or organization.");
      if (req.householdId) householdId = (await assertHouseholdAccess(user, req.householdId, tx)).household.id;
      vars.email = user.email;
    }

    const rendered = renderConsent(kind, locale, vars as unknown as ConsentVarsByKind[typeof kind]);
    if (req.shownSha256 && req.shownSha256 !== rendered.sha256) {
      throw conflict("The wording of this permission has changed. Please read it again.", { reason: "copy_changed" });
    }

    let expiresAt: Date | null = null;
    if (kind === "verification_share" || kind === "passport_reuse") {
      const until = String(rendered.vars.shareUntil);
      if (until < today) throw invalid("The sharing period must end today or later.", { fields: { shareUntil: "Must not be in the past." } });
      if (until > addDays(today, CONSENT_MAX_PERIOD_DAYS)) throw invalid("The sharing period is too long.", { fields: { shareUntil: `At most ${CONSENT_MAX_PERIOD_DAYS} days.` } });
      if (kind === "passport_reuse" && until > String(rendered.vars.resultValidUntil)) {
        throw invalid("Sharing cannot last longer than the result is valid.", { fields: { shareUntil: "After the result expires." } });
      }
      expiresAt = endOfCentralDay(until);
    }

    const [consent] = await tx
      .insert(schema.consents)
      .values({
        id: newId("consent"),
        kind,
        userId: user.id,
        householdId,
        verificationId,
        recipientOrgId,
        copyVersion: rendered.version,
        copySha256: rendered.sha256,
        locale,
        scope: { ...rendered.scope, vars: rendered.vars },
        grantedAt: now(),
        expiresAt,
        ip: normalizeIp(input.request?.ip),
        userAgent: tidyUserAgent(input.request?.userAgent),
      })
      .returning();

    await audit(
      {
        actor: { type: "user", id: user.id },
        orgId: recipientOrgId,
        action: "consent.grant",
        target: { type: "consent", id: consent.id },
        metadata: { kind, copyVersion: rendered.version, copySha256: rendered.sha256, locale, householdId, verificationId },
        request: input.request,
      },
      tx,
    );
    return { consent, rendered };
  });
}

/* ------------------------------------------------------------------------------------------ revoke */

export interface RevokeConsentResult {
  consent: Consent;
  /** True when the consent was already revoked; nothing changed. */
  alreadyRevoked: boolean;
  /** What other services must stop now. This module does not change their rows. */
  mustStop: {
    /** Verifications that may no longer collect or share under this consent. */
    verificationIds: string[];
    /** Open data-rail connections to disconnect at the provider. */
    railConnectionIds: string[];
    /** Stop electronic delivery to this person. */
    electronicDelivery: boolean;
  };
}

async function canSeeConsent(db: DbOrTx, user: User, consent: Consent): Promise<"granter" | "owner" | "adult" | null> {
  if (consent.userId === user.id) return "granter";
  if (!consent.householdId) return null;
  try {
    return (await assertHouseholdAccess(user, consent.householdId, db)).access;
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") return null;
    throw e;
  }
}

async function openRailsFor(db: DbOrTx, consent: Consent): Promise<string[]> {
  const rc = schema.railConnections;
  const open = inArray(rc.status, [...OPEN_RAIL_STATUSES]);
  let where;
  if (consent.kind === "rail_connect") {
    where = consent.verificationId ? and(open, or(eq(rc.consentId, consent.id), and(isNull(rc.consentId), eq(rc.verificationId, consent.verificationId)))) : and(open, eq(rc.consentId, consent.id));
  } else if ((consent.kind === "verification_share" || consent.kind === "passport_reuse") && consent.verificationId) {
    where = and(open, eq(rc.verificationId, consent.verificationId));
  } else {
    return [];
  }
  const rows = await db.select({ id: rc.id }).from(rc).where(where);
  return rows.map((r) => r.id).sort();
}

/**
 * Withdraws a consent: sets `revokedAt` (the only field that ever changes) and reports what downstream must
 * stop. The person who granted it may revoke it, and so may the household owner. Idempotent.
 */
export async function revokeConsent(consentId: string, actor: ConsentActor, dbOrTx?: DbOrTx): Promise<RevokeConsentResult> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const user = await loadUser(tx, actor.userId);
    const [current] = typeof consentId === "string" && consentId ? await tx.select().from(schema.consents).where(eq(schema.consents.id, consentId)).for("update").limit(1) : [];
    if (!current) throw notFound("Consent");
    const relation = await canSeeConsent(tx, user, current);
    if (!relation) throw notFound("Consent");
    if (relation === "adult") throw forbidden("Only the adult in charge of this household or the person who gave this permission can take it back.");

    const alreadyRevoked = current.revokedAt !== null;
    let consent = current;
    if (!alreadyRevoked) {
      [consent] = await tx.update(schema.consents).set({ revokedAt: now() }).where(eq(schema.consents.id, current.id)).returning();
      await audit(
        {
          actor: { type: "user", id: user.id },
          orgId: current.recipientOrgId,
          action: "consent.revoke",
          target: { type: "consent", id: current.id },
          metadata: { kind: current.kind, copyVersion: current.copyVersion, householdId: current.householdId, verificationId: current.verificationId },
          request: actor.request,
        },
        tx,
      );
    }
    return {
      consent,
      alreadyRevoked,
      mustStop: {
        verificationIds: consent.verificationId && consent.kind !== "electronic_delivery" ? [consent.verificationId] : [],
        railConnectionIds: await openRailsFor(tx, consent),
        electronicDelivery: consent.kind === "electronic_delivery",
      },
    };
  });
}

/* ------------------------------------------------------------------------------------------- reads */

/** A consent the actor gave, or one on a household the actor belongs to. Otherwise not_found. */
export async function getConsent(consentId: string, actor: ConsentActor, dbOrTx?: DbOrTx): Promise<Consent> {
  const db = dbOrTx ?? (await getDb());
  const user = await loadUser(db, actor.userId);
  const consent = await getConsentRecord(consentId, db);
  if (!(await canSeeConsent(db, user, consent))) throw notFound("Consent");
  return consent;
}

/**
 * A consent by id with no access check, for services and jobs that already checked access to the record that
 * points at it (a verification, an evidence pack). Throws not_found.
 */
export async function getConsentRecord(consentId: string, dbOrTx?: DbOrTx): Promise<Consent> {
  const db = dbOrTx ?? (await getDb());
  const [consent] = typeof consentId === "string" && consentId ? await db.select().from(schema.consents).where(eq(schema.consents.id, consentId)).limit(1) : [];
  if (!consent) throw notFound("Consent");
  return consent;
}

/** Every consent recorded for a household, newest first. Any adult of the household may list them. */
export async function listConsentsForHousehold(householdId: string, actor: ConsentActor, dbOrTx?: DbOrTx): Promise<Consent[]> {
  const db = dbOrTx ?? (await getDb());
  const user = await loadUser(db, actor.userId);
  const access = await assertHouseholdAccess(user, householdId, db);
  return db.select().from(schema.consents).where(eq(schema.consents.householdId, access.household.id)).orderBy(desc(schema.consents.grantedAt), desc(schema.consents.id));
}

export type ConsentState = "active" | "revoked" | "expired";

export function consentState(consent: Pick<Consent, "revokedAt" | "expiresAt">, at: Date = now()): ConsentState {
  if (consent.revokedAt) return "revoked";
  if (consent.expiresAt && consent.expiresAt.getTime() <= at.getTime()) return "expired";
  return "active";
}

/**
 * The newest active consent of `kind` for a verification. Call it before every step that collects or shares
 * under that consent. Throws AppError forbidden with `details.reason` "consent_missing", "consent_revoked" or
 * "consent_expired" (the state of the newest grant).
 */
export async function assertActiveConsent(verificationId: string, kind: ConsentCopyKind, dbOrTx?: DbOrTx): Promise<Consent> {
  const db = dbOrTx ?? (await getDb());
  const c = schema.consents;
  const rows =
    typeof verificationId === "string" && verificationId
      ? await db.select().from(c).where(and(eq(c.verificationId, verificationId), eq(c.kind, kind))).orderBy(desc(c.grantedAt), desc(c.id))
      : [];
  const at = now();
  const active = rows.find((r) => consentState(r, at) === "active");
  if (active) return active;
  if (rows.length === 0) throw new AppError("forbidden", "Permission is needed before this step.", { reason: "consent_missing", kind });
  const state = consentState(rows[0]!, at);
  throw new AppError("forbidden", state === "revoked" ? "This permission was taken back." : "This permission has ended.", { reason: `consent_${state}`, kind });
}

/**
 * Re-renders a stored consent from its version, locale and saved variables and checks the hash still
 * matches, for evidence packs and audits. Returns null if the record cannot be reproduced (it never should).
 */
export function reconstructConsent(consent: Consent): RenderedConsent | null {
  const locale = consent.locale;
  if (!isConsentLocale(locale) || !getConsentCopy(consent.copyVersion, locale)) return null;
  const vars = (consent.scope as { vars?: unknown }).vars;
  if (!vars || typeof vars !== "object") return null;
  try {
    const kind = consent.kind as ConsentCopyKind;
    const rendered = renderConsent(kind, locale, vars as ConsentVarsByKind[typeof kind], { version: consent.copyVersion });
    return rendered.sha256 === consent.copySha256 ? rendered : null;
  } catch {
    return null;
  }
}
