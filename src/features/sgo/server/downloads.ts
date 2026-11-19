import { isAppError, notFound, toErrorBody } from "@/lib/errors";
import { downloadAcknowledgmentPdf, downloadIrsReport } from "@/server/acknowledgments";
import { exportDonationsCsv } from "@/server/donations";
import { getDocumentForReview, getEvidenceObject } from "@/server/verifications";
import type { SgoActor } from "../types";

/**
 * The files the dashboard serves: evidence packs, a raw upload for the inline viewer, acknowledgment PDFs, IRS report
 * files and the donations CSV. Each function takes the already-authenticated SgoActor and passes ITS organization
 * and mode to the owning service, which checks tenancy, verifies the stored hash and writes the audit entry.
 */

export interface DashboardFile {
  bytes: Buffer;
  contentType: string;
  filename: string;
  /** `inline` only for the document viewer; everything else downloads. */
  disposition: "inline" | "attachment";
  sha256?: string;
}

const read = (a: SgoActor) => ({ actor: { type: "user" as const, id: a.userId }, request: a.request });

export async function evidenceFile(actor: SgoActor, verificationId: string, kind: string): Promise<DashboardFile> {
  if (kind !== "pdf" && kind !== "json") throw notFound("Evidence");
  const file = await getEvidenceObject(actor.orgId, verificationId, kind, { type: "user", id: actor.userId, mode: actor.mode, request: actor.request });
  return { bytes: file.bytes, contentType: file.contentType, filename: file.filename, disposition: "attachment", sha256: file.sha256 };
}

/** Content types the browser may render inline in the viewer; anything else is offered as a download. */
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function documentFile(actor: SgoActor, documentId: string): Promise<DashboardFile & { verificationId: string }> {
  const doc = await getDocumentForReview(actor.orgId, documentId, { type: "user", id: actor.userId, mode: actor.mode, request: actor.request });
  const inline = INLINE_TYPES.has(doc.contentType);
  return { bytes: doc.bytes, contentType: inline ? doc.contentType : "application/octet-stream", filename: doc.filename, disposition: inline ? "inline" : "attachment", sha256: doc.sha256, verificationId: doc.verificationId };
}

export async function acknowledgmentFile(actor: SgoActor, acknowledgmentId: string): Promise<DashboardFile> {
  const file = await downloadAcknowledgmentPdf(actor.orgId, acknowledgmentId, read(actor));
  // The worklist on screen is one mode; a link copied from the other mode is not served from this view.
  if (file.acknowledgment.mode !== actor.mode) throw notFound("Acknowledgment");
  return { bytes: file.bytes, contentType: file.contentType, filename: file.filename, disposition: "attachment", sha256: file.sha256 };
}

export async function irsReportFile(actor: SgoActor, reportId: string): Promise<DashboardFile> {
  const file = await downloadIrsReport(actor.orgId, reportId, read(actor));
  if (file.report.mode !== actor.mode) throw notFound("Report");
  return { bytes: file.bytes, contentType: file.contentType, filename: file.filename, disposition: "attachment", sha256: file.sha256 };
}

const DONATION_STATUSES = new Set(["pending", "succeeded", "failed", "canceled", "refunded"]);

export async function donationsCsvFile(actor: SgoActor, query: { taxYear?: string | null; status?: string | null }): Promise<DashboardFile> {
  const taxYear = query.taxYear && /^\d{4}$/.test(query.taxYear) ? Number(query.taxYear) : undefined;
  const status = query.status && DONATION_STATUSES.has(query.status) ? (query.status as "pending" | "succeeded" | "failed" | "canceled" | "refunded") : undefined;
  const { filename, csv } = await exportDonationsCsv(actor.orgId, { mode: actor.mode, ...(taxYear !== undefined ? { taxYear } : {}), ...(status ? { status } : {}) }, read(actor));
  return { bytes: Buffer.from(csv, "utf8"), contentType: "text/csv; charset=utf-8", filename, disposition: "attachment" };
}

/** `filename*` per RFC 6266 / 5987, with an ASCII fallback. */
export function contentDisposition(disposition: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function fileResponse(file: DashboardFile): Response {
  const headers = new Headers({
    "Content-Type": file.contentType,
    "Content-Disposition": contentDisposition(file.disposition, file.filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  // Uploaded files are untrusted: never let one run script or reach the app's origin. Browsers refuse to show a PDF in
  // a sandboxed document, so PDFs rely on the browser's own PDF viewer isolation and nosniff instead.
  if (file.contentType !== "application/pdf") headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  if (file.sha256) headers.set("X-Content-SHA256", file.sha256);
  return new Response(new Uint8Array(file.bytes), { status: 200, headers });
}

/**
 * Errors from a dashboard download. Another tenant's id, the other mode's id and a missing id all answer 404 with
 * the same body, so ids cannot be probed; a signed-out request answers 401; a purged file 410.
 */
export function downloadErrorResponse(e: unknown): Response {
  const headers = { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" };
  if (isAppError(e)) {
    if (e.code === "not_found" || e.code === "forbidden") return new Response("Not found", { status: 404, headers });
    if (e.code === "unauthenticated") return new Response("Sign in required", { status: 401, headers });
    if (e.code === "gone") return new Response(e.message, { status: 410, headers });
  }
  const { status, body } = toErrorBody(e);
  if (status >= 500) console.error(e);
  return new Response(body.error.message, { status, headers });
}

/**
 * The body of every dashboard download route: resolve the signed-in staff member from the session (any member may
 * download what the dashboard shows them), load the file for THEIR organization and mode, and answer.
 */
export async function serveDashboardFile(load: (actor: SgoActor) => Promise<DashboardFile>, resolveActor: () => Promise<{ actor: SgoActor }>): Promise<Response> {
  try {
    const { actor } = await resolveActor();
    return fileResponse(await load(actor));
  } catch (e) {
    return downloadErrorResponse(e);
  }
}
