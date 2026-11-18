/**
 * Auto-submit: connecting a payroll or bank rail, retrieving the prior-year income picture, and turning
 * what qualifies into income items. The public API is re-exported from ./index.
 *
 * Design rules (spec Piece 2; docs/reference/payments-and-rails.md implications 22-31, 46):
 *  - Consumer-directed: every connection rests on a fresh `rail_connect` consent that names the provider,
 *    the receiving SGO and the income year, granted by the person whose account it is.
 *  - A preference, not a trap: a failure, a decline or a revocation only changes this connection's row. The
 *    family's documents, other income items and household answers are never touched, and the family UI is
 *    told to offer upload (`offerUpload`).
 *  - Only a Form W-2 or a year-closing pay stub for the income year becomes counted income automatically.
 *    Projections and bank deposits are review material (flags in `getRailSummaryForDecision`).
 *  - Stored encrypted: provider access tokens (purpose "rail-token") and reports (purpose "rail-report").
 *    The report hash outlives the report.
 *  - Re-syncing replaces the connection's own income items; it never adds a second copy.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { RailReportSummary } from "@/engine/decision";
import { getIncomeCategory, reconcileIncomeEvidence, type IncomeEvidence, type IncomeReviewFlag } from "@/engine/income";
import { addMs, centralDateString, centralYear, now } from "@/lib/clock";
import { canonicalJson, decryptField, decryptJson, encryptField, encryptJson, sha256Hex } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit, SYSTEM_ACTOR, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { assertHouseholdAccess, type User } from "@/server/auth";
import { consentState, getConsentRecord, grantConsent, renderConsent, type RenderedConsent } from "@/server/consents";
import { enqueue } from "@/server/jobs";
import { RAIL_DECLINED_COPY, RAIL_FAILURE_COPY, RAIL_REVOKED_COPY } from "./copy";
import { isCountableSource, isReviewSource, reportToEvidence } from "./normalize";
import { RAIL_POLICY } from "./policy";
import { getRailProvider, RAIL_PROVIDER_INFO, railProviderForMode } from "./providers";
import {
  isRailFailureReason,
  isRailProviderError,
  normalizedIncomeReportSchema,
  type NormalizedIncomeReport,
  type RailConnection,
  type RailFailureReason,
  type RailKind,
  type RailMemberRef,
  type RailProvider,
  type RailProviderId,
  type RailStatus,
} from "./types";
import type { RailConnectionView, StartedConnectionView } from "./views";

export const RAIL_TOKEN_PURPOSE = "rail-token";
export const RAIL_REPORT_PURPOSE = "rail-report";
export const RAIL_SYNC_JOB = "rail.sync";
export const RAIL_REVOKE_REMOTE_JOB = "rail.revoke_remote";
/** Path of the provider webhook route (src/app/api/webhooks/plaid). */
export const RAIL_WEBHOOK_PATH = "/api/webhooks/plaid";

/** Statuses in which the connection may still bring data in. */
const LIVE_STATUSES: readonly RailStatus[] = ["created", "connecting", "connected", "syncing", "ready"];
const WAITING_STATUSES: readonly RailStatus[] = ["connected", "syncing"];

export interface RailActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

type Verification = typeof schema.verifications.$inferSelect;
type Member = typeof schema.householdMembers.$inferSelect;

/* ------------------------------------------------------------------------------------- helpers */

async function loadUser(db: DbOrTx, userId: string): Promise<User> {
  const [user] = typeof userId === "string" && userId ? await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1) : [];
  if (!user) throw forbidden();
  return user;
}

async function loadVerification(db: DbOrTx, verificationId: string): Promise<Verification | null> {
  if (typeof verificationId !== "string" || !verificationId) return null;
  const [v] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verificationId)).limit(1);
  return v ?? null;
}

async function loadConnection(db: DbOrTx, connectionId: string, opts: { forUpdate?: boolean } = {}): Promise<RailConnection | null> {
  if (typeof connectionId !== "string" || !connectionId) return null;
  const q = db.select().from(schema.railConnections).where(eq(schema.railConnections.id, connectionId)).limit(1);
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

/** The verification and household access for a family actor. Strangers get not_found, never forbidden. */
async function accessVerification(db: DbOrTx, user: User, verificationId: string): Promise<{ verification: Verification; access: "owner" | "adult" }> {
  const verification = await loadVerification(db, verificationId);
  if (!verification || !verification.householdId) throw notFound("Verification");
  try {
    const access = await assertHouseholdAccess(user, verification.householdId, db);
    return { verification, access: access.access };
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") throw notFound("Verification");
    throw e;
  }
}

async function accessConnection(db: DbOrTx, user: User, connectionId: string): Promise<{ connection: RailConnection; verification: Verification; access: "owner" | "adult" }> {
  const connection = await loadConnection(db, connectionId);
  if (!connection) throw notFound("Connection");
  try {
    const { verification, access } = await accessVerification(db, user, connection.verificationId);
    if (verification.householdId !== connection.householdId) throw notFound("Connection");
    return { connection, verification, access };
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") throw notFound("Connection");
    throw e;
  }
}

function providerIdOf(connection: RailConnection): RailProviderId {
  if (connection.provider !== "simulated" && connection.provider !== "plaid") throw new AppError("internal", `Connection ${connection.id} has no rail provider`);
  return connection.provider;
}

function kindOf(connection: RailConnection): RailKind {
  if (connection.kind !== "payroll" && connection.kind !== "bank") throw new AppError("internal", `Connection ${connection.id} has no rail kind`);
  return connection.kind;
}

async function recordEvent(db: DbOrTx, verificationId: string, type: string, actor: { type: "family" | "system"; id: string | null }, data: Record<string, unknown>): Promise<void> {
  await db.insert(schema.verificationEvents).values({ id: newId("verificationEvent"), verificationId, type, actorType: actor.type, actorId: actor.id, data });
}

function auditActorFor(actor: RailActor | null): AuditActor {
  return actor ? { type: "user", id: actor.userId } : SYSTEM_ACTOR;
}

function readReport(connection: RailConnection): NormalizedIncomeReport | null {
  if (!connection.reportEnc) return null;
  const parsed = normalizedIncomeReportSchema.safeParse(decryptJson(connection.reportEnc, RAIL_REPORT_PURPOSE));
  if (!parsed.success) throw new AppError("internal", `Stored report for connection ${connection.id} does not match the report format`);
  return parsed.data;
}

/** SHA-256 over the canonical JSON of the report: stable across key order and re-encryption. */
export function railReportSha256(report: NormalizedIncomeReport): string {
  return sha256Hex(canonicalJson(report));
}

/** The income year a connection was consented for (the consent names it), falling back to the verification. */
async function incomeYearFor(db: DbOrTx, connection: RailConnection, verification: Verification): Promise<number> {
  if (connection.consentId) {
    const consent = await getConsentRecord(connection.consentId, db);
    const year = Number((consent.scope as { vars?: { incomeYear?: unknown } }).vars?.incomeYear);
    if (Number.isInteger(year)) return year;
  }
  return verification.incomeYear ?? centralYear(connection.createdAt) - 1;
}

/** The calendar year before the application. Before submission the verification has no income year yet, so today's year stands in. */
function expectedIncomeYear(verification: Verification): number {
  return verification.incomeYear ?? centralYear(now()) - 1;
}

function toView(connection: RailConnection, verification: Pick<Verification, "mode">): RailConnectionView {
  const provider = providerIdOf(connection);
  const status = connection.status;
  const failureReason = status === "failed" && isRailFailureReason(connection.failureReason) ? connection.failureReason : null;
  const report = status === "revoked" ? null : readReport(connection);
  const sources = report?.sources.filter((s) => s.taxYear === report.incomeYear) ?? [];
  const anyCountable = report ? sources.some((s) => isCountableSource(s, report.incomeYear)) : false;
  let failureMessage: RailConnectionView["failureMessage"] = null;
  if (failureReason) failureMessage = { ...RAIL_FAILURE_COPY[failureReason] };
  else if (status === "declined") failureMessage = { ...RAIL_DECLINED_COPY };
  else if (status === "revoked") failureMessage = { ...RAIL_REVOKED_COPY };
  return {
    id: connection.id,
    verificationId: connection.verificationId,
    memberId: connection.memberId,
    provider,
    providerName: RAIL_PROVIDER_INFO[provider].displayName,
    kind: kindOf(connection),
    status,
    sandbox: provider === "simulated" || verification.mode === "test",
    failureReason,
    failureMessage,
    reportSha256: connection.reportSha256,
    retrieved: report
      ? {
          incomeYear: report.incomeYear,
          sources: sources.map((s) => ({ type: s.type, employerName: s.employerName, taxYear: s.taxYear, grossAnnualCents: s.grossAnnualCents, counted: isCountableSource(s, report.incomeYear) })),
          coverage: { ...report.coverage },
        }
      : null,
    waiting: WAITING_STATUSES.includes(status),
    offerUpload: status === "failed" || status === "declined" || status === "revoked" || (status === "ready" && !anyCountable),
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

async function viewOf(db: DbOrTx, connectionId: string): Promise<RailConnectionView> {
  const connection = await loadConnection(db, connectionId);
  if (!connection) throw notFound("Connection");
  const verification = await loadVerification(db, connection.verificationId);
  if (!verification) throw notFound("Connection");
  return toView(connection, verification);
}

function memberRef(member: Pick<Member, "id" | "firstName" | "lastName">): RailMemberRef {
  return { id: member.id, firstName: member.firstName, lastName: member.lastName };
}

async function loadMember(db: DbOrTx, memberId: string | null): Promise<Member | null> {
  if (!memberId) return null;
  const [m] = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.id, memberId)).limit(1);
  return m ?? null;
}

function assertOpenVerification(verification: Verification): void {
  if (verification.status !== "pending" || !(RAIL_POLICY.openStages as readonly string[]).includes(verification.stage)) {
    throw conflict("This verification is no longer collecting income information.", { reason: "verification_closed" });
  }
}

/* --------------------------------------------------------------------------- state transitions */

async function markFailed(connectionId: string, reason: RailFailureReason, detail: string, actor: RailActor | null): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const connection = await loadConnection(tx, connectionId, { forUpdate: true });
    if (!connection || !LIVE_STATUSES.includes(connection.status)) return;
    const verification = await loadVerification(tx, connection.verificationId);
    if (connection.status === "ready") {
      // A re-sync that failed does not undo a report already received: the stored report and items stand.
      await audit({ actor: auditActorFor(actor), orgId: verification?.orgId ?? null, action: "rail.resync_failed", target: { type: "rail_connection", id: connectionId }, metadata: { reason, detail: detail.slice(0, 300) }, request: actor?.request }, tx);
      return;
    }
    await tx.update(schema.railConnections).set({ status: "failed", failureReason: reason, updatedAt: now() }).where(eq(schema.railConnections.id, connectionId));
    await recordEvent(tx, connection.verificationId, "rail.failed", actor ? { type: "family", id: actor.userId } : { type: "system", id: null }, { railConnectionId: connectionId, provider: connection.provider, reason });
    await audit(
      { actor: auditActorFor(actor), orgId: verification?.orgId ?? null, action: "rail.fail", target: { type: "rail_connection", id: connectionId }, metadata: { reason, detail: detail.slice(0, 300) }, request: actor?.request },
      tx,
    );
  });
}

async function scheduleSync(db: DbOrTx, connectionId: string, poll: number, afterMs: number, trigger: string): Promise<void> {
  await enqueue(RAIL_SYNC_JOB, { connectionId, poll, trigger }, { runAt: addMs(now(), Math.max(1000, afterMs)), dedupeKey: `${RAIL_SYNC_JOB}:${connectionId}:${trigger}:${poll}` }, db);
}

/* ---------------------------------------------------------------------------------- public API */

const localeSchema = z.enum(["en", "es"]);

export interface RailConsentPreview {
  rendered: RenderedConsent;
  providerName: string;
  incomeYear: number;
}

/**
 * The exact rail_connect consent words to show before connecting (organization, provider and income year
 * filled in by the server). Pass `rendered.sha256` back to `startConnection` as `shownSha256`.
 */
export async function previewRailConsent(verificationId: string, actor: RailActor, locale: "en" | "es"): Promise<RailConsentPreview> {
  const db = await getDb();
  const user = await loadUser(db, actor.userId);
  const { verification } = await accessVerification(db, user, verificationId);
  const provider = railProviderForMode(verification.mode);
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, verification.orgId)).limit(1);
  if (!org) throw notFound("Organization");
  const incomeYear = expectedIncomeYear(verification);
  const rendered = renderConsent("rail_connect", localeSchema.parse(locale), { organizationName: org.name, providerName: provider.displayName, incomeYear });
  return { rendered, providerName: provider.displayName, incomeYear };
}

const startSchema = z.strictObject({
  verificationId: z.string().min(1).max(128),
  memberId: z.string().min(1).max(128),
  kind: z.enum(["payroll", "bank"]),
  locale: localeSchema.optional(),
  shownSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

export type StartConnectionInput = z.input<typeof startSchema>;

/**
 * Starts a connection for one household member: checks access, records the `rail_connect` consent (naming
 * the provider), creates the `rail_connections` row and opens a provider session. A provider that cannot
 * open a session leaves the connection `failed` (returned with `client: null`), so the family is offered
 * upload instead of an error page.
 */
export async function startConnection(input: StartConnectionInput, actor: RailActor): Promise<StartedConnectionView> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "input")] ??= issue.message;
    throw invalid("The connection request is not valid.", { fields });
  }
  const req = parsed.data;
  const db = await getDb();

  const started = await db.transaction(async (tx) => {
    const user = await loadUser(tx, actor.userId);
    const { verification, access } = await accessVerification(tx, user, req.verificationId);
    assertOpenVerification(verification);
    const provider = railProviderForMode(verification.mode);

    const member = await loadMember(tx, req.memberId);
    if (!member || member.householdId !== verification.householdId || member.removedAt) throw notFound("Household member");
    if (!(RAIL_POLICY.connectableMemberKinds as readonly string[]).includes(member.kind)) throw invalid("This person's account cannot be connected.", { fields: { memberId: "Not connectable." } });
    if (member.userId !== user.id) {
      if (member.userId) throw forbidden("Each adult with their own sign-in connects their own account.");
      if (!(access === "owner" && RAIL_POLICY.ownerMayConnectForMembersWithoutSignIn)) throw forbidden("Only the adult in charge of this household can connect an account for someone else.");
    }

    const [household] = await tx.select().from(schema.households).where(eq(schema.households.id, verification.householdId!)).limit(1);
    const locale = req.locale ?? household?.locale ?? "en";
    const incomeYear = expectedIncomeYear(verification);
    const { consent } = await grantConsent(
      {
        kind: "rail_connect",
        userId: user.id,
        householdId: verification.householdId,
        verificationId: verification.id,
        recipientOrgId: verification.orgId,
        locale,
        vars: { providerName: provider.displayName, incomeYear },
        shownSha256: req.shownSha256 ?? null,
        request: actor.request,
      },
      tx,
    );

    const id = newId("railConnection");
    await tx.insert(schema.railConnections).values({
      id,
      householdId: verification.householdId!,
      verificationId: verification.id,
      memberId: member.id,
      provider: provider.id,
      kind: req.kind,
      status: "created",
      consentId: consent.id,
    });
    await recordEvent(tx, verification.id, "rail.started", { type: "family", id: user.id }, { railConnectionId: id, provider: provider.id, kind: req.kind, memberId: member.id, consentId: consent.id });
    await audit(
      { actor: { type: "user", id: user.id }, orgId: verification.orgId, action: "rail.start", target: { type: "rail_connection", id }, metadata: { provider: provider.id, kind: req.kind, memberId: member.id, consentId: consent.id }, request: actor.request },
      tx,
    );
    return { id, provider, member, verification, incomeYear, locale, consentId: consent.id };
  });

  let client: StartedConnectionView["client"] = null;
  try {
    const session = await started.provider.createLinkSession({
      connectionId: started.id,
      householdId: started.verification.householdId!,
      member: memberRef(started.member),
      incomeYear: started.incomeYear,
      kind: req.kind,
      locale: started.locale,
      webhookUrl: appUrl(RAIL_WEBHOOK_PATH),
    });
    client = session.client;
    await db
      .update(schema.railConnections)
      .set({ status: "connecting", externalId: session.externalId, updatedAt: now() })
      .where(and(eq(schema.railConnections.id, started.id), eq(schema.railConnections.status, "created")));
  } catch (e) {
    if (!isRailProviderError(e)) throw e;
    await markFailed(started.id, e.reason, e.message, actor);
  }
  return { connection: await viewOf(db, started.id), client, consentId: started.consentId };
}

/**
 * Finishes a connection with what the provider's screen reported in the browser (validated by the
 * provider; never trusted as income data). Fetches the report now, or schedules `rail.sync` for providers
 * that prepare the data later. A decline or a provider failure ends this connection only.
 */
export async function completeConnection(connectionId: string, clientResult: unknown, actor: RailActor): Promise<RailConnectionView> {
  const db = await getDb();
  const user = await loadUser(db, actor.userId);
  const { connection, verification } = await accessConnection(db, user, connectionId);
  if (["connected", "syncing", "ready"].includes(connection.status)) return toView(connection, verification);
  if (connection.status !== "connecting") throw conflict("This connection has ended. Start a new one or upload documents instead.", { reason: "connection_closed", status: connection.status });
  if (!connection.consentId) throw new AppError("internal", "Connection has no consent");
  const consent = await getConsentRecord(connection.consentId, db);
  if (consent.userId !== user.id) throw forbidden("Only the person who started this connection can finish it.");
  if (consentState(consent) !== "active") throw new AppError("forbidden", "This permission was taken back.", { reason: "consent_revoked" });
  assertOpenVerification(verification);

  const provider = getRailProvider(providerIdOf(connection));
  let result;
  try {
    result = await provider.completeLink({ connection, clientResult, at: now() });
  } catch (e) {
    if (!isRailProviderError(e)) throw e;
    await markFailed(connection.id, e.reason, e.message, actor);
    return viewOf(db, connection.id);
  }

  if (result.outcome === "declined") return declineConnection(connection.id, actor);
  if (result.outcome === "failed") {
    await markFailed(connection.id, result.reason, result.detail, actor);
    return viewOf(db, connection.id);
  }

  const linked = result;
  const proceed = await db.transaction(async (tx) => {
    const current = await loadConnection(tx, connection.id, { forUpdate: true });
    if (!current || current.status !== "connecting") return false;
    const status: RailStatus = linked.readiness.type === "immediate" ? "connected" : "syncing";
    await tx
      .update(schema.railConnections)
      .set({ status, externalId: linked.externalId, accessTokenEnc: linked.accessToken ? encryptField(linked.accessToken, RAIL_TOKEN_PURPOSE) : null, updatedAt: now() })
      .where(eq(schema.railConnections.id, connection.id));
    if (linked.readiness.type === "poll") await scheduleSync(tx, connection.id, 0, linked.readiness.afterMs, "poll");
    if (linked.readiness.type === "webhook") await scheduleSync(tx, connection.id, 0, linked.readiness.fallbackPollMs, "fallback");
    await recordEvent(tx, connection.verificationId, "rail.connected", { type: "family", id: user.id }, { railConnectionId: connection.id, provider: connection.provider, readiness: linked.readiness.type });
    await audit({ actor: { type: "user", id: user.id }, orgId: verification.orgId, action: "rail.connect", target: { type: "rail_connection", id: connection.id }, metadata: { readiness: linked.readiness.type }, request: actor.request }, tx);
    return true;
  });
  if (proceed && linked.readiness.type === "immediate") await syncConnection(connection.id, { poll: 0, trigger: "inline" });
  return viewOf(db, connection.id);
}

/**
 * The person chose not to connect (or left the provider's screen). Only this connection changes; the
 * family UI then offers upload with everything else intact.
 */
export async function declineConnection(connectionId: string, actor: RailActor): Promise<RailConnectionView> {
  const db = await getDb();
  const user = await loadUser(db, actor.userId);
  const { connection, verification } = await accessConnection(db, user, connectionId);
  await db.transaction(async (tx) => {
    const current = await loadConnection(tx, connection.id, { forUpdate: true });
    if (!current || !["created", "connecting"].includes(current.status)) return;
    await tx.update(schema.railConnections).set({ status: "declined", updatedAt: now() }).where(eq(schema.railConnections.id, connection.id));
    await recordEvent(tx, connection.verificationId, "rail.declined", { type: "family", id: user.id }, { railConnectionId: connection.id, provider: connection.provider });
    await audit({ actor: { type: "user", id: user.id }, orgId: verification.orgId, action: "rail.decline", target: { type: "rail_connection", id: connection.id }, request: actor.request }, tx);
  });
  return viewOf(db, connection.id);
}

/** One connection, for polling while the provider prepares the data. */
export async function getConnection(connectionId: string, actor: RailActor): Promise<RailConnectionView> {
  const db = await getDb();
  const user = await loadUser(db, actor.userId);
  const { connection, verification } = await accessConnection(db, user, connectionId);
  return toView(connection, verification);
}

/** Every connection of a verification, oldest first. Any adult of the household may list them. */
export async function listConnections(verificationId: string, actor: RailActor): Promise<RailConnectionView[]> {
  const db = await getDb();
  const user = await loadUser(db, actor.userId);
  const { verification } = await accessVerification(db, user, verificationId);
  const rows = await db
    .select()
    .from(schema.railConnections)
    .where(and(eq(schema.railConnections.verificationId, verification.id), eq(schema.railConnections.householdId, verification.householdId!)))
    .orderBy(asc(schema.railConnections.createdAt), asc(schema.railConnections.id));
  return rows.map((row) => toView(row, verification));
}

/* -------------------------------------------------------------------------------------- sync */

export interface SyncOptions {
  /** How many polls already happened for this connection. */
  poll: number;
  trigger: "inline" | "poll" | "fallback" | "webhook" | "job";
}

/**
 * Fetches the report and stores it. Idempotent: a re-sync replaces this connection's income items and
 * never duplicates them; a connection that ended (failed, declined, revoked) or whose consent was taken
 * back is left alone. Retryable provider failures are polled again up to `RAIL_POLICY.maxPolls`.
 */
export async function syncConnection(connectionId: string, opts: SyncOptions): Promise<void> {
  const db = await getDb();
  const connection = await loadConnection(db, connectionId);
  if (!connection || !["connected", "syncing", "ready"].includes(connection.status)) return;
  const verification = await loadVerification(db, connection.verificationId);
  if (!verification || verification.status === "canceled" || verification.status === "expired") return;
  if (connection.consentId) {
    const consent = await getConsentRecord(connection.consentId, db);
    if (consentState(consent) !== "active") return;
  }
  const member = await loadMember(db, connection.memberId);
  if (!member) throw new AppError("internal", `Connection ${connection.id} has no member`);
  const incomeYear = await incomeYearFor(db, connection, verification);
  const provider = getRailProvider(providerIdOf(connection));
  const accessToken = connection.accessTokenEnc ? decryptField(connection.accessTokenEnc, RAIL_TOKEN_PURPOSE) : null;

  const retryLater = async (afterMs: number, reason: RailFailureReason, detail: string) => {
    if (opts.poll + 1 >= RAIL_POLICY.maxPolls) {
      await markFailed(connection.id, reason, `${detail} (gave up after ${opts.poll + 1} attempts)`, null);
      return;
    }
    await db.transaction(async (tx) => {
      const current = await loadConnection(tx, connection.id, { forUpdate: true });
      if (!current || !["connected", "syncing"].includes(current.status)) return;
      await tx.update(schema.railConnections).set({ status: "syncing", updatedAt: now() }).where(eq(schema.railConnections.id, connection.id));
      await scheduleSync(tx, connection.id, opts.poll + 1, afterMs, "poll");
    });
  };

  let result;
  try {
    result = await provider.fetchIncomeReport(connection, { accessToken, incomeYear, member: memberRef(member), retrievedAt: now() });
  } catch (e) {
    if (!isRailProviderError(e)) throw e;
    if (e.retryable) return retryLater(RAIL_POLICY.pollIntervalMs, e.reason, e.message);
    await markFailed(connection.id, e.reason, e.message, null);
    return;
  }
  if (result.state === "pending") return retryLater(result.retryAfterMs, "provider_unavailable", "The provider was still preparing the records");

  const report = normalizedIncomeReportSchema.parse(result.report);
  if (report.incomeYear !== incomeYear) throw new AppError("internal", `Provider returned a report for ${report.incomeYear}, expected ${incomeYear}`);
  const usable = report.sources.some((s) => isCountableSource(s, incomeYear) || isReviewSource(s, incomeYear));
  const failure: RailFailureReason | null = usable ? null : report.recordsSeen === 0 ? "records_unreadable" : "no_data_for_year";
  const reportSha256 = railReportSha256(report);
  const { evidence } = reportToEvidence(report, { railConnectionId: connection.id, memberId: member.id });
  const reconciled = reconcileIncomeEvidence({ incomeYear, evidence });

  await db.transaction(async (tx) => {
    const current = await loadConnection(tx, connection.id, { forUpdate: true });
    if (!current || !["connected", "syncing", "ready"].includes(current.status)) return;
    await tx.delete(schema.incomeItems).where(eq(schema.incomeItems.railConnectionId, connection.id));
    const providerName = RAIL_PROVIDER_INFO[providerIdOf(connection)].displayName;
    if (!failure && reconciled.items.length > 0) {
      await tx.insert(schema.incomeItems).values(
        reconciled.items.map((item) => ({
          id: newId("incomeItem"),
          verificationId: connection.verificationId,
          memberId: item.memberId,
          source: "rail" as const,
          category: item.category,
          description: item.description ?? null,
          incomeYear: item.incomeYear,
          annualAmountCents: item.annualAmountCents,
          counted: getIncomeCategory(item.category)?.treatment !== "excluded",
          basis: `Retrieved through ${providerName}${report.sandbox ? " (sandbox test data)" : ""}; report ${reportSha256.slice(0, 16)}. ${item.description ?? ""}`.trim().slice(0, 500),
          documentId: null,
          railConnectionId: connection.id,
          createdBy: `rail:${connection.provider}`,
        })),
      );
    }
    await tx
      .update(schema.railConnections)
      .set({
        status: failure ? "failed" : "ready",
        failureReason: failure,
        reportEnc: encryptJson(report, RAIL_REPORT_PURPOSE),
        reportSha256,
        updatedAt: now(),
      })
      .where(eq(schema.railConnections.id, connection.id));
    await recordEvent(tx, connection.verificationId, failure ? "rail.failed" : "rail.ready", { type: "system", id: null }, {
      railConnectionId: connection.id,
      provider: connection.provider,
      reportSha256,
      ...(failure ? { reason: failure } : { countedItems: reconciled.items.length, incomeYearCovered: report.coverage.incomeYearCovered }),
    });
    await audit(
      {
        actor: SYSTEM_ACTOR,
        orgId: verification.orgId,
        action: "rail.sync",
        target: { type: "rail_connection", id: connection.id },
        metadata: { trigger: opts.trigger, poll: opts.poll, reportSha256, outcome: failure ?? "ready", items: failure ? 0 : reconciled.items.length },
      },
      tx,
    );
  });
}

/* ------------------------------------------------------------------------------------ revoke */

async function revokeRemote(connection: RailConnection): Promise<boolean> {
  const provider = getRailProvider(providerIdOf(connection));
  const accessToken = connection.accessTokenEnc ? decryptField(connection.accessTokenEnc, RAIL_TOKEN_PURPOSE) : null;
  try {
    await provider.revoke(connection, { accessToken });
  } catch (e) {
    if (isRailProviderError(e) || (e instanceof AppError && e.code === "not_available")) return false;
    throw e;
  }
  const db = await getDb();
  await db.update(schema.railConnections).set({ accessTokenEnc: null, updatedAt: now() }).where(eq(schema.railConnections.id, connection.id));
  return true;
}

async function revokeOne(connectionId: string, actor: RailActor | null, reason: "family_request" | "consent_revoked"): Promise<void> {
  const db = await getDb();
  const revoked = await db.transaction(async (tx) => {
    const current = await loadConnection(tx, connectionId, { forUpdate: true });
    if (!current || current.status === "revoked") return null;
    const verification = await loadVerification(tx, current.verificationId);
    const deleteItems = RAIL_POLICY.deleteItemsOnRevokeBeforeDecision && !verification?.decidedAt;
    if (deleteItems) await tx.delete(schema.incomeItems).where(eq(schema.incomeItems.railConnectionId, current.id));
    // The report goes; its hash stays for the evidence trail. The token stays only until the provider confirms removal.
    await tx.update(schema.railConnections).set({ status: "revoked", reportEnc: null, updatedAt: now() }).where(eq(schema.railConnections.id, current.id));
    await recordEvent(tx, current.verificationId, "rail.revoked", actor ? { type: "family", id: actor.userId } : { type: "system", id: null }, {
      railConnectionId: current.id,
      provider: current.provider,
      reason,
      reportSha256: current.reportSha256,
      itemsDeleted: deleteItems,
    });
    await audit(
      { actor: auditActorFor(actor), orgId: verification?.orgId ?? null, action: "rail.revoke", target: { type: "rail_connection", id: current.id }, metadata: { reason, itemsDeleted: deleteItems }, request: actor?.request },
      tx,
    );
    return current;
  });
  if (!revoked) return;
  const ok = await revokeRemote(revoked);
  if (!ok) await enqueue(RAIL_REVOKE_REMOTE_JOB, { connectionId: revoked.id }, { dedupeKey: `${RAIL_REVOKE_REMOTE_JOB}:${revoked.id}`, maxAttempts: 10 });
}

/**
 * Disconnects a connection: the provider's access is removed (retried by a job if the provider is down),
 * the token and the report are deleted, the report hash is kept. Income items it produced are removed if
 * the verification has no decision yet. The person who started it or the household owner may revoke.
 */
export async function revokeConnection(connectionId: string, actor: RailActor): Promise<RailConnectionView> {
  const db = await getDb();
  const user = await loadUser(db, actor.userId);
  const { connection, access } = await accessConnection(db, user, connectionId);
  if (access !== "owner" && connection.consentId) {
    const consent = await getConsentRecord(connection.consentId, db);
    if (consent.userId !== user.id) throw forbidden("Only the adult in charge of this household or the person who connected this account can disconnect it.");
  }
  await revokeOne(connection.id, actor, "family_request");
  return viewOf(db, connection.id);
}

/**
 * Called after `revokeConsent` with its `mustStop.railConnectionIds`: revokes each listed connection. The
 * consents service already checked who may revoke, so no access check is repeated here.
 */
export async function revokeConnectionsForConsent(railConnectionIds: readonly string[], opts: { actor?: RailActor | null } = {}): Promise<{ revoked: string[] }> {
  const ids = [...new Set(railConnectionIds.filter((id) => typeof id === "string" && id.length > 0))];
  for (const id of ids) await revokeOne(id, opts.actor ?? null, "consent_revoked");
  return { revoked: ids };
}

/** Job body: retries the provider-side removal for a revoked connection until it succeeds. */
export async function retryRemoteRevoke(connectionId: string): Promise<void> {
  const db = await getDb();
  const connection = await loadConnection(db, connectionId);
  if (!connection || connection.status !== "revoked") return;
  if (!(await revokeRemote(connection))) throw new AppError("not_available", `Provider removal for ${connectionId} failed; will retry`);
}

/* ----------------------------------------------------------------------------------- webhook */

export interface RailWebhookResult {
  status: "processed" | "ignored";
  connectionId: string | null;
}

/**
 * A provider webhook. The provider verifies the signature before anything else (throws AppError
 * `unauthenticated`); only then is a connection looked up. `ready` schedules a sync (which fetches and
 * inspects: a "complete" status can still mean nothing was readable); `failed` ends the connection.
 */
export async function handleRailWebhook(providerId: RailProviderId, rawBody: string, headers: { get(name: string): string | null }): Promise<RailWebhookResult> {
  const provider: RailProvider = getRailProvider(providerId);
  if (!provider.parseWebhook) throw notFound("Webhook");
  const event = await provider.parseWebhook(rawBody, headers);
  if (event.event === "ignored" || !event.externalId) return { status: "ignored", connectionId: null };

  const db = await getDb();
  const [connection] = await db
    .select()
    .from(schema.railConnections)
    .where(and(eq(schema.railConnections.provider, providerId), eq(schema.railConnections.externalId, event.externalId)))
    .limit(1);
  if (!connection) return { status: "ignored", connectionId: null };
  const verification = await loadVerification(db, connection.verificationId);
  await audit({ actor: { type: "webhook", id: providerId }, orgId: verification?.orgId ?? null, action: "rail.webhook", target: { type: "rail_connection", id: connection.id }, metadata: { event: event.event, detail: event.detail } });

  if (event.event === "failed") {
    await markFailed(connection.id, "provider_unavailable", event.detail, null);
    return { status: "processed", connectionId: connection.id };
  }
  if (!["connected", "syncing", "ready"].includes(connection.status)) return { status: "ignored", connectionId: connection.id };
  await db.transaction(async (tx) => {
    const current = await loadConnection(tx, connection.id, { forUpdate: true });
    if (!current || !["connected", "syncing", "ready"].includes(current.status)) return;
    if (current.status === "connected") await tx.update(schema.railConnections).set({ status: "syncing", updatedAt: now() }).where(eq(schema.railConnections.id, current.id));
    await enqueue(RAIL_SYNC_JOB, { connectionId: current.id, poll: 0, trigger: "webhook" }, { dedupeKey: `${RAIL_SYNC_JOB}:${current.id}:webhook` }, tx);
  });
  return { status: "processed", connectionId: connection.id };
}

/* ------------------------------------------------------------------------------ for decisions */

export interface RailDecisionConnection {
  id: string;
  provider: RailProviderId;
  kind: RailKind;
  status: RailStatus;
  memberId: string | null;
  consentId: string | null;
  failureReason: RailFailureReason | null;
  reportSha256: string | null;
  /** The vendor's own statement about CRA status, for the evidence trail (not a finding about this product). */
  craPosture: RailProvider["craPosture"];
  sandbox: boolean;
  retrievedAt: string | null;
  warnings: string[];
}

export interface RailDecisionSummary {
  verificationId: string;
  /** True while a provider is preparing data for a finished connection: the decision should wait for it. */
  pending: boolean;
  /** Connections the person opened but never finished on the provider's screen. They produce nothing until finished. */
  unfinished: string[];
  connections: RailDecisionConnection[];
  /** For `DecisionInput.railReports`: one entry per connection with a stored report. */
  railReports: RailReportSummary[];
  /**
   * Reconcile-ready evidence (W-2s and year-closing pay stubs for the income year), with `origin: "rail"` and
   * `sourceId` = the connection id. Pass it to `reconcileIncomeEvidence` together with the document evidence
   * when reconciling across sources.
   */
  evidence: IncomeEvidence[];
  /** Review material from the reports (pay-stub projections, bank deposits): pass as `direct.evidenceFlags`. */
  flags: IncomeReviewFlag[];
}

/**
 * What the decide job needs about a verification's data connections. For services and jobs that already
 * checked access to the verification: there is no actor and no access check here. Reads are audited.
 */
export async function getRailSummaryForDecision(verificationId: string, dbOrTx?: DbOrTx): Promise<RailDecisionSummary> {
  const db = dbOrTx ?? (await getDb());
  const verification = await loadVerification(db, verificationId);
  if (!verification) throw notFound("Verification");
  const rows = await db.select().from(schema.railConnections).where(eq(schema.railConnections.verificationId, verification.id)).orderBy(asc(schema.railConnections.createdAt), asc(schema.railConnections.id));

  const connections: RailDecisionConnection[] = [];
  const railReports: RailReportSummary[] = [];
  const evidence: IncomeEvidence[] = [];
  const flags: IncomeReviewFlag[] = [];
  for (const row of rows) {
    const provider = providerIdOf(row);
    const report = row.status === "ready" ? readReport(row) : null;
    connections.push({
      id: row.id,
      provider,
      kind: kindOf(row),
      status: row.status,
      memberId: row.memberId,
      consentId: row.consentId,
      failureReason: isRailFailureReason(row.failureReason) ? row.failureReason : null,
      reportSha256: row.reportSha256,
      craPosture: RAIL_PROVIDER_INFO[provider].craPosture,
      sandbox: provider === "simulated" || verification.mode === "test",
      retrievedAt: report?.retrievedAt ?? null,
      warnings: report?.warnings ?? [],
    });
    if (report && row.memberId) {
      railReports.push({ railConnectionId: row.id, provider, kind: report.kind, dataBasis: report.dataBasis, retrievedOn: centralDateString(new Date(report.retrievedAt)) });
      const converted = reportToEvidence(report, { railConnectionId: row.id, memberId: row.memberId });
      evidence.push(...converted.evidence);
      flags.push(...converted.flags);
    }
  }
  if (rows.length > 0) {
    await audit({ actor: SYSTEM_ACTOR, orgId: verification.orgId, action: "rail.read_for_decision", target: { type: "verification", id: verification.id }, metadata: { connections: rows.length, reports: railReports.length } }, dbOrTx);
  }
  return {
    verificationId: verification.id,
    pending: rows.some((r) => r.status === "connected" || r.status === "syncing"),
    unfinished: rows.filter((r) => r.status === "created" || r.status === "connecting").map((r) => r.id),
    connections,
    railReports,
    evidence,
    flags,
  };
}
