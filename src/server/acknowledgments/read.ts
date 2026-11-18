import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { sha256Hex } from "@/lib/crypto";
import { AppError, forbidden, invalid, notFound } from "@/lib/errors";
import { audit, type AuditRequestInfo } from "@/server/audit";
import { getObjectBytes } from "@/server/storage";
import { requireOrgId, requireReadAccess, type ReadAccess } from "./access";
import { donorAddressLines, donorFullName } from "./build";
import type { AcknowledgmentRow } from "./issue";
import { computeWorklist, WORKLIST_ACTIONS, type Worklist, type WorklistAction, type WorklistItem } from "./worklist";

/**
 * Read models for the SGO dashboard (worklist, per-donor status and history, paper mailing tasks, downloads,
 * reminder history) and the donor's own download. Reads name the reader for the audit log; the caller has already
 * guarded SGO membership (requireOrgMember), the same contract as the donations read models. Everything is scoped
 * by orgId and mode: another SGO's records are "not found".
 */

const { acknowledgments, acknowledgmentNotices, donations, donors, donorNumbers, donorDeliveryConsents } = schema;

const modeSchema = z.enum(["test", "live"]);
const yearSchema = z.number().int().min(2000).max(2200);
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function fields(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "input"] ??= issue.message;
  return out;
}

const worklistSchema = z.strictObject({
  mode: modeSchema,
  taxYear: yearSchema,
  action: z.enum(WORKLIST_ACTIONS as [WorklistAction, ...WorklistAction[]]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export interface WorklistPage extends Worklist {
  /** Items matching the action filter, before paging. */
  total: number;
  offset: number;
  limit: number;
}

/** The SGO's acknowledgment worklist for a calendar year (counts over everyone; items filtered and paged). Audited. */
export async function acknowledgmentWorklist(orgId: string, params: z.input<typeof worklistSchema>, access: ReadAccess, dbOrTx?: DbOrTx): Promise<WorklistPage> {
  const org = requireOrgId(orgId);
  const reader = requireReadAccess(access);
  const parsed = worklistSchema.safeParse(params);
  if (!parsed.success) throw invalid("Check the filters.", { fields: fields(parsed.error) });
  const { mode, taxYear, action } = parsed.data;
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;
  const db = dbOrTx ?? (await getDb());
  const worklist = await computeWorklist(db, org, mode, taxYear);
  const filtered = action ? worklist.items.filter((i) => i.action === action) : worklist.items;
  await audit({ actor: reader.actor, orgId: org, action: "acknowledgment.worklist", metadata: { taxYear, mode, action: action ?? null, donors: worklist.counts.donors }, request: reader.request ?? null }, db);
  return { ...worklist, items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
}

export interface DonorAcknowledgmentDetail {
  donor: { id: string; fullName: string; email: string; addressLines: string[] };
  taxYear: number;
  mode: "test" | "live";
  /** The donor's line of the worklist (status, number, delivery, next action), or null when nothing is to be acknowledged. */
  status: WorklistItem | null;
  /** Every version, newest first, with its delivery record. */
  versions: AcknowledgmentRow[];
  donorNumber: (typeof donorNumbers.$inferSelect) | null;
  /** E-delivery consents with this SGO, newest first (with withdrawals). */
  consents: Array<typeof donorDeliveryConsents.$inferSelect>;
}

const detailSchema = z.strictObject({ mode: modeSchema, taxYear: yearSchema });

/** One donor's acknowledgment status and full version history for a year. Not found unless the donor gave to this SGO that year. Audited. */
export async function getDonorAcknowledgments(orgId: string, donorId: string, params: z.input<typeof detailSchema>, access: ReadAccess, dbOrTx?: DbOrTx): Promise<DonorAcknowledgmentDetail> {
  const org = requireOrgId(orgId);
  const reader = requireReadAccess(access);
  const parsed = detailSchema.safeParse(params);
  if (!parsed.success) throw invalid("Check the filters.", { fields: fields(parsed.error) });
  const { mode, taxYear } = parsed.data;
  if (typeof donorId !== "string" || !SAFE_ID.test(donorId)) throw notFound("Donor");
  const db = dbOrTx ?? (await getDb());
  const [gave] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(and(eq(donations.orgId, org), eq(donations.donorId, donorId), eq(donations.mode, mode), eq(donations.taxYear, taxYear), inArray(donations.status, ["succeeded", "refunded"])))
    .limit(1);
  if (!gave) throw notFound("Donor");
  const [donor] = await db.select().from(donors).where(eq(donors.id, donorId));
  if (!donor) throw notFound("Donor");
  const worklist = await computeWorklist(db, org, mode, taxYear);
  const versions = await db
    .select()
    .from(acknowledgments)
    .where(and(eq(acknowledgments.orgId, org), eq(acknowledgments.donorId, donorId), eq(acknowledgments.mode, mode), eq(acknowledgments.taxYear, taxYear)))
    .orderBy(desc(acknowledgments.version));
  const [donorNumber] = await db.select().from(donorNumbers).where(and(eq(donorNumbers.orgId, org), eq(donorNumbers.donorId, donorId), eq(donorNumbers.mode, mode), eq(donorNumbers.taxYear, taxYear)));
  const consents = await db
    .select()
    .from(donorDeliveryConsents)
    .where(and(eq(donorDeliveryConsents.orgId, org), eq(donorDeliveryConsents.donorId, donorId), eq(donorDeliveryConsents.mode, mode)))
    .orderBy(desc(donorDeliveryConsents.grantedAt), desc(donorDeliveryConsents.id));
  await audit({ actor: reader.actor, orgId: org, action: "acknowledgment.read", target: { type: "donor", id: donorId }, metadata: { taxYear, mode, versions: versions.length }, request: reader.request ?? null }, db);
  return {
    donor: { id: donor.id, fullName: donorFullName(donor), email: donor.email, addressLines: donorAddressLines(donor) },
    taxYear,
    mode,
    status: worklist.items.find((i) => i.donor.id === donorId) ?? null,
    versions,
    donorNumber: donorNumber ?? null,
    consents,
  };
}

const paperSchema = z.strictObject({ mode: modeSchema, taxYear: yearSchema.optional(), limit: z.number().int().min(1).max(1000).optional() });

export interface PaperMailingTask {
  acknowledgment: AcknowledgmentRow;
  donor: { id: string; fullName: string; addressLines: string[] };
}

/**
 * Paper acknowledgments still to be mailed (no active e-delivery consent when issued, or switched to paper), oldest
 * first, with the mailing address. Each is printed from downloadAcknowledgmentPdf and closed with
 * markAcknowledgmentMailed. Superseded versions are not listed: only the version in force is mailed. Audited.
 */
export async function listPaperMailings(orgId: string, params: z.input<typeof paperSchema>, access: ReadAccess, dbOrTx?: DbOrTx): Promise<PaperMailingTask[]> {
  const org = requireOrgId(orgId);
  const reader = requireReadAccess(access);
  const parsed = paperSchema.safeParse(params);
  if (!parsed.success) throw invalid("Check the filters.", { fields: fields(parsed.error) });
  const db = dbOrTx ?? (await getDb());
  const where = [eq(acknowledgments.orgId, org), eq(acknowledgments.mode, parsed.data.mode), eq(acknowledgments.status, "issued"), eq(acknowledgments.delivery, "paper_required"), isNull(acknowledgments.deliveredAt)];
  if (parsed.data.taxYear !== undefined) where.push(eq(acknowledgments.taxYear, parsed.data.taxYear));
  const rows = await db
    .select({ ack: acknowledgments, donor: donors })
    .from(acknowledgments)
    .innerJoin(donors, eq(donors.id, acknowledgments.donorId))
    .where(and(...where))
    .orderBy(asc(acknowledgments.issuedAt), asc(acknowledgments.id))
    .limit(parsed.data.limit ?? 500);
  await audit({ actor: reader.actor, orgId: org, action: "acknowledgment.paper_list", metadata: { mode: parsed.data.mode, taxYear: parsed.data.taxYear ?? null, count: rows.length }, request: reader.request ?? null }, db);
  return rows.map((r) => ({ acknowledgment: r.ack, donor: { id: r.donor.id, fullName: donorFullName(r.donor), addressLines: donorAddressLines(r.donor) } }));
}

export interface AcknowledgmentDownload {
  filename: string;
  contentType: "application/pdf";
  bytes: Buffer;
  sha256: string;
  acknowledgment: AcknowledgmentRow;
}

async function readPdf(db: DbOrTx, row: AcknowledgmentRow): Promise<{ bytes: Buffer; filename: string; sha256: string }> {
  if (!row.pdfObjectId) throw notFound("Acknowledgment document");
  const bytes = await getObjectBytes(row.pdfObjectId, { orgId: row.orgId }, db);
  // The acknowledgment row's hash identifies the document the donor was given; never serve anything else.
  if (!row.pdfSha256 || sha256Hex(bytes) !== row.pdfSha256) throw new AppError("internal", `Acknowledgment ${row.id}: the stored PDF does not match the recorded SHA-256`);
  return { bytes, sha256: row.pdfSha256, filename: `${row.mode === "test" ? "sandbox-" : ""}acknowledgment-${row.taxYear}-v${row.version}.pdf` };
}

/** The stored PDF of one issued (or superseded) version, for SGO staff to view or print. Audited. */
export async function downloadAcknowledgmentPdf(orgId: string, acknowledgmentId: string, access: ReadAccess, dbOrTx?: DbOrTx): Promise<AcknowledgmentDownload> {
  const org = requireOrgId(orgId);
  const reader = requireReadAccess(access);
  const db = dbOrTx ?? (await getDb());
  const [row] = typeof acknowledgmentId === "string" && SAFE_ID.test(acknowledgmentId) ? await db.select().from(acknowledgments).where(and(eq(acknowledgments.id, acknowledgmentId), eq(acknowledgments.orgId, org))) : [];
  if (!row) throw notFound("Acknowledgment");
  const { bytes, filename, sha256 } = await readPdf(db, row);
  await audit({ actor: reader.actor, orgId: org, action: "acknowledgment.download", target: { type: "acknowledgment", id: row.id }, metadata: { donorId: row.donorId, taxYear: row.taxYear, mode: row.mode, version: row.version, pdfSha256: row.pdfSha256 }, request: reader.request ?? null }, db);
  return { filename, contentType: "application/pdf", bytes, sha256, acknowledgment: row };
}

/**
 * The donor's own download of an acknowledgment they were issued. The donor row belongs to the user when it is
 * linked to them or carries their (verified sign-in) email, as in listGiftsForUser. Anything else is not found.
 */
export async function downloadAcknowledgmentForUser(userId: string, acknowledgmentId: string, options: { request?: AuditRequestInfo | null } = {}, dbOrTx?: DbOrTx): Promise<AcknowledgmentDownload> {
  if (typeof userId !== "string" || !SAFE_ID.test(userId)) throw forbidden();
  const db = dbOrTx ?? (await getDb());
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw forbidden();
  const [row] = typeof acknowledgmentId === "string" && SAFE_ID.test(acknowledgmentId) ? await db.select().from(acknowledgments).where(eq(acknowledgments.id, acknowledgmentId)) : [];
  if (!row || (row.status !== "issued" && row.status !== "superseded")) throw notFound("Acknowledgment");
  const [donor] = await db.select().from(donors).where(eq(donors.id, row.donorId));
  const owns = donor !== undefined && (donor.userId === user.id || donor.email === user.email.trim().toLowerCase());
  if (!owns) throw notFound("Acknowledgment");
  const { bytes, filename, sha256 } = await readPdf(db, row);
  await audit({ actor: { type: "user", id: user.id }, orgId: row.orgId, action: "acknowledgment.download", target: { type: "acknowledgment", id: row.id }, metadata: { donorId: row.donorId, taxYear: row.taxYear, mode: row.mode, version: row.version, by: "donor" }, request: options.request ?? null }, db);
  return { filename, contentType: "application/pdf", bytes, sha256, acknowledgment: row };
}

const noticesSchema = z.strictObject({ mode: modeSchema, taxYear: yearSchema.optional() });

/** Worklist and reminder emails sent to the SGO (no donor data), newest first. */
export async function listAcknowledgmentNotices(orgId: string, params: z.input<typeof noticesSchema>, access: ReadAccess, dbOrTx?: DbOrTx): Promise<Array<typeof acknowledgmentNotices.$inferSelect>> {
  const org = requireOrgId(orgId);
  requireReadAccess(access);
  const parsed = noticesSchema.safeParse(params);
  if (!parsed.success) throw invalid("Check the filters.", { fields: fields(parsed.error) });
  const db = dbOrTx ?? (await getDb());
  const where = [eq(acknowledgmentNotices.orgId, org), eq(acknowledgmentNotices.mode, parsed.data.mode)];
  if (parsed.data.taxYear !== undefined) where.push(eq(acknowledgmentNotices.taxYear, parsed.data.taxYear));
  return db.select().from(acknowledgmentNotices).where(and(...where)).orderBy(desc(acknowledgmentNotices.sentAt));
}
