import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { ActorType } from "@/db/schema";
import { now } from "@/lib/clock";
import { AppError, badRequest } from "@/lib/errors";
import { cleanUserAgent, type AuditRequestInfo } from "./request";
import { sanitizeAuditMetadata } from "./sanitize";
import { newSortableId } from "./sortable-id";

/**
 * Audit trail: who did what to which record, and from where.
 *
 *   await audit({ actor: { type: "user", id: user.id }, orgId, action: "document.download",
 *                 target: { type: "document", id }, request: requestInfoFromHeaders(await headers()) }, tx);
 *
 * Every read of sensitive data (documents, evidence, donor records) and every change goes through `audit()`.
 * The log is append-only: this module deliberately has no update or delete function.
 */

export type AuditLog = typeof schema.auditLogs.$inferSelect;

export interface AuditActor {
  type: ActorType;
  /** User id, API key id, … Omitted for `system`. */
  id?: string | null;
}

export interface AuditTarget {
  type: string;
  id: string;
}

export interface AuditEntry {
  actor: AuditActor;
  /** The tenant whose data was touched (not necessarily the actor's organization). */
  orgId?: string | null;
  /** Dot-separated verb on a noun, e.g. "verification.read", "api_key.create", "settings.update". */
  action: string;
  target?: AuditTarget | null;
  /** Small, non-secret context. Sanitized before it is stored (see ./sanitize). */
  metadata?: Record<string, unknown> | null;
  request?: AuditRequestInfo | null;
}

export const SYSTEM_ACTOR: AuditActor = { type: "system" };

// A record rather than an array so that adding an actor type to the schema fails to compile until it is listed here.
const ACTOR_TYPE_SET: Record<ActorType, true> = { user: true, api_key: true, system: true, family: true, webhook: true };
const ACTOR_TYPES = Object.keys(ACTOR_TYPE_SET) as ActorType[];
const MAX_ACTION_LENGTH = 120;
const MAX_REF_LENGTH = 200;
const MAX_IP_LENGTH = 64;

function requireRef(value: string | null | undefined, what: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length === 0 || v.length > MAX_REF_LENGTH) throw new AppError("internal", `Audit entry has an invalid ${what}`);
  return v;
}

function optionalRef(value: string | null | undefined, what: string): string | null {
  return value === null || value === undefined ? null : requireRef(value, what);
}

/**
 * Appends one entry. Pass the transaction of the change being recorded so the change and its audit entry
 * commit (or roll back) together. A failure to write the entry is thrown, never swallowed: sensitive data is
 * not released without a record.
 */
export async function audit(entry: AuditEntry, dbOrTx?: DbOrTx): Promise<AuditLog> {
  if (!ACTOR_TYPES.includes(entry.actor?.type)) throw new AppError("internal", "Audit entry has an invalid actor type");
  const action = typeof entry.action === "string" ? entry.action.trim() : "";
  if (action.length === 0 || action.length > MAX_ACTION_LENGTH) throw new AppError("internal", "Audit entry has an invalid action");

  const db = dbOrTx ?? (await getDb());
  const ip = entry.request?.ip?.trim() || null;
  const [row] = await db
    .insert(schema.auditLogs)
    .values({
      // `at` follows the application clock, which may be frozen; the id keeps entries in the order written.
      id: newSortableId("audit"),
      at: now(),
      actorType: entry.actor.type,
      actorId: optionalRef(entry.actor.id, "actor id"),
      orgId: optionalRef(entry.orgId, "organization id"),
      action,
      targetType: entry.target ? requireRef(entry.target.type, "target type") : null,
      targetId: entry.target ? requireRef(entry.target.id, "target id") : null,
      ip: ip ? ip.slice(0, MAX_IP_LENGTH) : null,
      userAgent: cleanUserAgent(entry.request?.userAgent),
      metadata: sanitizeAuditMetadata(entry.metadata),
    })
    .returning();
  return row;
}

export interface ListAuditLogsParams {
  /** Tenant scope. Dashboards for an organization MUST pass it; only platform-admin views may omit it. */
  orgId?: string;
  targetType?: string;
  targetId?: string;
  actorId?: string;
  /** Exact action name. */
  action?: string;
  /** Page size, 1–200. Default 50. */
  limit?: number;
  /** `nextCursor` of the previous page. */
  before?: string | null;
}

export interface AuditLogPage {
  /** Newest first. */
  items: AuditLog[];
  /** Pass as `before` to get the next (older) page; null when there are no more entries. */
  nextCursor: string | null;
}

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

function encodeCursor(row: Pick<AuditLog, "at" | "id">): string {
  return Buffer.from(`${row.at.getTime()}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = raw.indexOf("|");
  const ms = sep > 0 ? Number(raw.slice(0, sep)) : Number.NaN;
  const id = raw.slice(sep + 1);
  if (!Number.isSafeInteger(ms) || Math.abs(ms) > 8.64e15 || id.length === 0 || id.length > MAX_REF_LENGTH) throw badRequest("Invalid cursor");
  return { at: new Date(ms), id };
}

/**
 * Lists entries newest first with keyset pagination on (at, id), so pages stay stable while new entries are
 * being appended and deep pages cost the same as the first one.
 */
export async function listAuditLogs(params: ListAuditLogsParams = {}, dbOrTx?: DbOrTx): Promise<AuditLogPage> {
  const limit = params.limit ?? AUDIT_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_PAGE_MAX) throw badRequest(`limit must be an integer between 1 and ${AUDIT_PAGE_MAX}`);

  const t = schema.auditLogs;
  const where: SQL[] = [];
  if (params.orgId !== undefined) where.push(eq(t.orgId, params.orgId));
  if (params.targetType !== undefined) where.push(eq(t.targetType, params.targetType));
  if (params.targetId !== undefined) where.push(eq(t.targetId, params.targetId));
  if (params.actorId !== undefined) where.push(eq(t.actorId, params.actorId));
  if (params.action !== undefined) where.push(eq(t.action, params.action));
  if (params.before) {
    const cursor = decodeCursor(params.before);
    where.push(or(lt(t.at, cursor.at), and(eq(t.at, cursor.at), lt(t.id, cursor.id)))!);
  }

  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select()
    .from(t)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(t.at), desc(t.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
}

export { sanitizeAuditMetadata, SENSITIVE_KEY_PATTERN, AUDIT_METADATA_LIMITS } from "./sanitize";
export { requestInfoFromHeaders, normalizeIp, type AuditRequestInfo, type HeaderReader } from "./request";
export { newSortableId } from "./sortable-id";
