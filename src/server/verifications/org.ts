/**
 * The SGO's side: list, read, cancel, download evidence, count. Every function filters by organization AND mode;
 * another tenant's (or the other mode's) verification is reported as not found.
 */
import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode, VerificationStatus } from "@/db/schema";
import { addMs, MS, now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { conflict, invalid, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { getSgoPolicy } from "@/server/sgos";
import { getObjectBytes, getObjectMeta } from "@/server/storage";
import { loadOrgVerification, orgAuditActor, recordVerificationEvent, type OrgActor, type VerificationRow } from "./internal";
import { CLOSED_STATUSES } from "./policy";
import { toApiVerification } from "./serialize";

const STATUSES: readonly VerificationStatus[] = ["pending", "eligible", "ineligible", "needs_review", "expired", "canceled"];
export const LIST_LIMIT_DEFAULT = 25;
export const LIST_LIMIT_MAX = 100;

export interface ListVerificationsParams {
  mode: Mode;
  status?: VerificationStatus | null;
  externalRef?: string | null;
  /** 1–100, default 25. */
  limit?: number | null;
  /** `nextCursor` of the previous page. */
  cursor?: string | null;
}

export interface VerificationPage {
  /** Newest first. */
  items: VerificationRow[];
  /** Pass as `cursor` for the next (older) page; null when there are no more. */
  nextCursor: string | null;
}

const listSchema = z.strictObject({
  mode: z.enum(["test", "live"]),
  status: z.enum(STATUSES as [VerificationStatus, ...VerificationStatus[]]).nullish(),
  externalRef: z.string().min(1).max(200).nullish(),
  limit: z.number().int().min(1).max(LIST_LIMIT_MAX).nullish(),
  cursor: z.string().max(200).nullish(),
});

function encodeCursor(row: Pick<VerificationRow, "createdAt" | "id">): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    const t = typeof parsed.t === "string" ? new Date(parsed.t) : null;
    if (!t || Number.isNaN(t.getTime()) || typeof parsed.id !== "string" || parsed.id.length === 0 || parsed.id.length > 128) throw new Error("bad cursor");
    return { t, id: parsed.id };
  } catch {
    throw invalid("The cursor is not valid.", { fields: { cursor: "Use nextCursor from the previous page." } });
  }
}

/** Keyset-paginated list of one organization's verifications in one mode, newest first. */
export async function listVerifications(orgId: string, params: ListVerificationsParams, dbOrTx?: DbOrTx): Promise<VerificationPage> {
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "query")] ??= issue.message;
    throw invalid("The list request is not valid.", { fields });
  }
  const p = parsed.data;
  const limit = p.limit ?? LIST_LIMIT_DEFAULT;
  const v = schema.verifications;
  const where: SQL[] = [eq(v.orgId, orgId), eq(v.mode, p.mode)];
  if (p.status) where.push(eq(v.status, p.status));
  if (p.externalRef) where.push(eq(v.externalRef, p.externalRef));
  if (p.cursor) {
    const c = decodeCursor(p.cursor);
    where.push(or(lt(v.createdAt, c.t), and(eq(v.createdAt, c.t), lt(v.id, c.id)))!);
  }
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select()
    .from(v)
    .where(and(...where))
    .orderBy(desc(v.createdAt), desc(v.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]!) : null };
}

/** One verification of the organization in the given mode; not_found otherwise. Audited when an actor is given. */
export async function getVerification(orgId: string, id: string, opts: { mode: Mode; actor?: OrgActor | null }, dbOrTx?: DbOrTx): Promise<VerificationRow> {
  const db = dbOrTx ?? (await getDb());
  const row = await loadOrgVerification(db, orgId, opts.mode, id);
  if (opts.actor) await audit({ actor: orgAuditActor(opts.actor), orgId, action: "verification.read", target: { type: "verification", id: row.id }, request: opts.actor.request }, db);
  return row;
}

/**
 * Cancels a verification that is not decided yet: the family link stops working, open review tasks close, its
 * uploads get a purge date from the SGO's retention window and `verification.canceled` is emitted. A decided, expired or already canceled verification is a conflict
 * (canceling twice is reported, not repeated). Uses `actor.mode` as the mode scope.
 */
export async function cancelVerification(orgId: string, id: string, actor: OrgActor, dbOrTx?: DbOrTx): Promise<VerificationRow> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const row = await loadOrgVerification(tx, orgId, actor.mode, id, { forUpdate: true });
    if (CLOSED_STATUSES.has(row.status)) throw conflict(row.status === "canceled" ? "This verification is already canceled." : "This verification has expired.", { reason: `verification_${row.status}` });
    if (row.status === "eligible" || row.status === "ineligible") throw conflict("A decided verification cannot be canceled.", { reason: "verification_decided" });
    const at = now();
    const [updated] = await tx.update(schema.verifications).set({ status: "canceled", canceledAt: at, updatedAt: at }).where(eq(schema.verifications.id, row.id)).returning();
    await tx
      .update(schema.reviewTasks)
      .set({ status: "resolved", resolution: "canceled", resolvedAt: at })
      .where(and(eq(schema.reviewTasks.verificationId, row.id), eq(schema.reviewTasks.status, "open")));
    // Uploads of a canceled verification follow the same retention window as decided ones (no state without a rule).
    const policy = await getSgoPolicy(orgId, tx);
    await tx
      .update(schema.documents)
      .set({ purgeAfter: addMs(at, policy.rawRetentionDays * MS.day) })
      .where(and(eq(schema.documents.verificationId, row.id), isNull(schema.documents.purgeAfter), isNull(schema.documents.purgedAt)));
    await recordVerificationEvent(tx, row.id, "canceled", { type: actor.type, id: actor.id }, { previousStatus: row.status, previousStage: row.stage });
    await emitEvent({ orgId, type: "verification.canceled", payload: toApiVerification(updated, { baseUrl: appUrl() }) as unknown as Record<string, unknown>, mode: row.mode }, tx);
    await audit({ actor: orgAuditActor(actor), orgId, action: "verification.cancel", target: { type: "verification", id: row.id }, metadata: { previousStatus: row.status }, request: actor.request }, tx);
    return updated;
  });
}

export interface EvidenceObject {
  bytes: Buffer;
  contentType: string;
  filename: string;
  sha256: string;
}

/**
 * The decrypted evidence PDF or signed JSON of a decided verification, for download. Tenant- and mode-checked
 * (`actor.mode`), integrity-checked against the stored SHA-256, and audited as `evidence.download`.
 */
export async function getEvidenceObject(orgId: string, id: string, kind: "pdf" | "json", actor: OrgActor, dbOrTx?: DbOrTx): Promise<EvidenceObject> {
  if (kind !== "pdf" && kind !== "json") throw invalid("Ask for the pdf or the json evidence file.");
  const db = dbOrTx ?? (await getDb());
  const row = await loadOrgVerification(db, orgId, actor.mode, id);
  const objectId = kind === "pdf" ? row.evidencePdfObjectId : row.evidenceJsonObjectId;
  if (!objectId) throw notFound("Evidence");
  const meta = await getObjectMeta(objectId, { orgId }, db);
  const bytes = await getObjectBytes(objectId, { orgId }, db);
  await audit({ actor: orgAuditActor(actor), orgId, action: "evidence.download", target: { type: "verification", id: row.id }, metadata: { kind, objectId, sha256: meta.sha256 }, request: actor.request }, db);
  return { bytes, contentType: meta.contentType, filename: meta.filename ?? `evidence-${row.id}.${kind}`, sha256: meta.sha256 };
}

export type StatusCounts = Record<VerificationStatus, number> & { total: number };

/** How many verifications the organization has in each status, in one mode. */
export async function statusCounts(orgId: string, mode: Mode, dbOrTx?: DbOrTx): Promise<StatusCounts> {
  if (mode !== "test" && mode !== "live") throw invalid("Unknown mode.");
  const db = dbOrTx ?? (await getDb());
  const v = schema.verifications;
  const rows = await db
    .select({ status: v.status, n: sql<number>`count(*)::int` })
    .from(v)
    .where(and(eq(v.orgId, orgId), eq(v.mode, mode)))
    .groupBy(v.status);
  const out = { pending: 0, eligible: 0, ineligible: 0, needs_review: 0, expired: 0, canceled: 0, total: 0 } as StatusCounts;
  for (const r of rows) {
    if (STATUSES.includes(r.status)) out[r.status] = Number(r.n);
    out.total += Number(r.n);
  }
  return out;
}
