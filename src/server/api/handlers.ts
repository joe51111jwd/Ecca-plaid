/**
 * Logic shared by several /api/v1 route handlers. Route files stay thin: validate (apiRoute) → call these or a
 * service → return JSON.
 */
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb, schema } from "@/db/client";
import type { Mode } from "@/db/schema";
import { AppError, conflict, notFound } from "@/lib/errors";
import { getHandoff, recordToApi, type ApiHandoff } from "@/server/handoffs";
import { audit } from "@/server/audit";
import { getEvidenceObject, getVerification, listVerifications, toApiVerification, type ApiVerification } from "@/server/verifications";
import { centralDateString, now } from "@/lib/clock";
import { buildVerificationsCsv, parseCsvColumns } from "./csv-export";
import { hasActiveLiveKey } from "./keys";
import { CSV_EXPORT_MAX_ROWS, CSV_EXPORT_PAGE_SIZE, WEBHOOK_WRITE_NEEDS_LIVE_KEY_ONCE_LIVE } from "./policy";
import type { ApiContext } from "./route";
import type { createHandoffBody, createVerificationBody, exportVerificationsQuery } from "./schemas";

/** Maps the snake_case create body onto createVerification's input. */
export function verificationInputFromBody(body: z.output<typeof createVerificationBody>) {
  return {
    applicantEmail: body.applicant_email ?? null,
    applicantName: body.applicant_name ?? null,
    studentFirstName: body.student?.first_name ?? null,
    studentLastName: body.student?.last_name ?? null,
    externalRef: body.external_ref ?? null,
    returnUrl: body.return_url ?? null,
    metadata: body.metadata ?? null,
    sendInvite: body.send_invite ?? false,
    ...(body.locale ? { locale: body.locale } : {}),
  };
}

/** Maps the snake_case create body onto createHandoff's input. */
export function handoffInputFromBody(body: z.output<typeof createHandoffBody>, idempotencyKey: string | null) {
  return {
    bookingRef: body.booking_ref,
    bookingDescription: body.booking_description ?? null,
    bookingAmountCents: body.booking_amount_cents ?? null,
    familyEmail: body.family_email ?? null,
    studentFirstName: body.student?.first_name ?? null,
    studentLastName: body.student?.last_name ?? null,
    returnUrl: body.return_url ?? null,
    channel: body.channel,
    metadata: body.metadata ?? null,
    sgoOrgId: body.sgo_org_id ?? null,
    ...(body.locale ? { locale: body.locale } : {}),
    idempotencyKey,
  };
}

/** A handoff in its API shape, read back after a change so the related verification and award are current. */
export async function apiHandoff(businessOrgId: string, handoffId: string, mode: Mode): Promise<ApiHandoff> {
  return recordToApi(await getHandoff(businessOrgId, handoffId, { mode }));
}

/**
 * The evidence PDF or signed JSON of one verification as a download. 404 for another organization's or the other
 * mode's verification; 409 `evidence_not_ready` while no evidence file exists yet (no decision, or a review pack not
 * generated yet). The download itself is audited by getEvidenceObject (`evidence.download`).
 */
export async function evidenceResponse<Q, B>(ctx: ApiContext<Q, B>, kind: "pdf" | "json"): Promise<Response> {
  const id = ctx.params.id;
  const row = await getVerification(ctx.org.id, id, { mode: ctx.mode });
  const objectId = kind === "pdf" ? row.evidencePdfObjectId : row.evidenceJsonObjectId;
  if (!objectId) {
    throw conflict(row.status === "pending" ? "There is no evidence yet: this verification has not been decided." : "The evidence for this verification is not available yet. Retry shortly.", {
      reason: "evidence_not_ready",
      status: row.status,
    });
  }
  const file = await getEvidenceObject(ctx.org.id, id, kind, ctx.actor);
  const bytes = new Uint8Array(file.bytes.byteLength);
  bytes.set(file.bytes);
  const filename = (kind === "pdf" ? `evidence-${row.id}.pdf` : `evidence-${row.id}.json`).replace(/[^A-Za-z0-9_.-]/g, "_");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": kind === "pdf" ? "application/pdf" : "application/json; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Evidence-SHA256": file.sha256,
    },
  });
}

/** See WEBHOOK_WRITE_NEEDS_LIVE_KEY_ONCE_LIVE. */
export async function assertWebhookWritable<Q, B>(ctx: ApiContext<Q, B>): Promise<void> {
  if (!WEBHOOK_WRITE_NEEDS_LIVE_KEY_ONCE_LIVE || ctx.mode === "live") return;
  if (await hasActiveLiveKey(ctx.org.id)) {
    throw new AppError("forbidden", "Webhook endpoints receive live events too, so once your organization has a live key they are managed with a live key (or in the dashboard).", {
      reason: "live_key_required",
    });
  }
}

/** The mode of a donation of the organization, or not_found. Checked before the donation service reads (and audits) it. */
export async function assertDonationInMode(orgId: string, donationId: string, mode: Mode): Promise<void> {
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.donations.id })
    .from(schema.donations)
    .where(and(eq(schema.donations.id, donationId), eq(schema.donations.orgId, orgId), eq(schema.donations.mode, mode)))
    .limit(1);
  if (!row) throw notFound("Donation");
}

/**
 * GET /verifications/export.csv: every verification of the organization in the key's mode (optionally filtered),
 * newest first, in the requested columns. Audited as `verification.export` (a bulk read) before the file is released.
 */
export async function exportVerificationsCsv<B>(ctx: ApiContext<z.output<typeof exportVerificationsQuery>, B>): Promise<Response> {
  const columns = parseCsvColumns(ctx.query.columns);
  const rows: ApiVerification[] = [];
  let cursor: string | null = null;
  do {
    const page = await listVerifications(ctx.org.id, { mode: ctx.mode, status: ctx.query.status ?? null, externalRef: ctx.query.external_ref ?? null, limit: CSV_EXPORT_PAGE_SIZE, cursor });
    for (const row of page.items) rows.push(toApiVerification(row, { baseUrl: ctx.baseUrl }));
    if (rows.length > CSV_EXPORT_MAX_ROWS) {
      throw new AppError("validation_failed", `The export would have more than ${CSV_EXPORT_MAX_ROWS} rows. Narrow it with status or external_ref.`, { reason: "export_too_large", fields: { status: "Filter the export." } });
    }
    cursor = page.nextCursor;
  } while (cursor !== null);

  const csv = buildVerificationsCsv(rows, columns, { header: ctx.query.header !== "false" });
  await audit({
    actor: { type: "api_key", id: ctx.apiKey.id },
    orgId: ctx.org.id,
    action: "verification.export",
    metadata: { mode: ctx.mode, rows: rows.length, columns: columns.map((c) => c.key), status: ctx.query.status ?? null, requestId: ctx.requestId },
    request: ctx.actor.request,
  });
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="verifications-${ctx.mode}-${centralDateString(now())}.csv"`,
    },
  });
}
