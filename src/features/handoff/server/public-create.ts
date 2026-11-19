/**
 * The public, browser-facing entry point the embed script calls to start a handoff with the business's publishable
 * key: `POST /embed/handoff/create` (route in src/app/embed/handoff/create). The handoffs service does every check
 * that matters (key, Origin on the business's allowed list, rate limits, booking fields as untrusted text, amount
 * recorded as unconfirmed); this layer only reads the request safely and shapes the cross-origin response.
 *
 * The script sends the body as `text/plain` JSON so a browser makes a "simple" request with no preflight; a JSON
 * content type is accepted too (and its preflight answered by `preflightResponse`).
 */
import { z } from "zod";
import { requestInfoFromHeaders } from "@/server/audit";
import { normalizeOrigin } from "@/server/businesses";
import { createHandoff, type CreateHandoffResult } from "@/server/handoffs";
import { badRequest, invalid, isAppError, toErrorBody } from "@/lib/errors";
import { PUBLIC_CREATE_MAX_BODY_BYTES, PUBLIC_CREATE_PREFLIGHT_MAX_AGE_SECONDS } from "../policy";

export interface PublicResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** What the script sends. snake_case, matching the server-to-server API's create body. */
export const publicCreateBody = z.strictObject({
  publishable_key: z.string({ error: "publishable_key is required." }).min(1, "publishable_key is required.").max(200),
  booking_ref: z.string({ error: "booking_ref must be text." }),
  booking_description: z.string({ error: "booking_description must be text." }).nullish(),
  booking_amount_cents: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
      if (!Number.isSafeInteger(n) || n <= 0) {
        ctx.addIssue({ code: "custom", message: "booking_amount_cents must be a positive whole number of cents." });
        return z.NEVER;
      }
      return n;
    }),
  return_url: z.string().max(2048).nullish(),
  locale: z.enum(["en", "es"]).optional(),
  channel: z.enum(["embed", "redirect"]).optional(),
});

export type PublicCreateBody = z.output<typeof publicCreateBody>;

/** The success body. The URLs carry the family's resume token: the script opens one of them and never stores it. */
export interface PublicCreateResult {
  object: "handoff_session";
  handoff_id: string;
  status: string;
  hold_expires_at: string | null;
  url: string;
  embed_url: string;
}

/**
 * CORS headers for a response to `origin`. The service already refused any origin the business did not allow, so
 * reflecting it here grants nothing: a disallowed origin only ever receives the generic error. Never credentials.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
  if (origin) {
    const r = normalizeOrigin(origin);
    if (r.ok) headers["Access-Control-Allow-Origin"] = r.origin;
  }
  return headers;
}

/** Answer to the CORS preflight (only sent by browsers when the script is customized to use a JSON content type). */
export function preflightResponse(origin: string | null): PublicResponse {
  return {
    status: 204,
    body: null,
    headers: {
      ...corsHeaders(origin),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": String(PUBLIC_CREATE_PREFLIGHT_MAX_AGE_SECONDS),
    },
  };
}

/** Parses the raw body text. Throws AppError (bad_request / validation_failed). */
export function parsePublicCreateBody(text: string): PublicCreateBody {
  if (Buffer.byteLength(text, "utf8") > PUBLIC_CREATE_MAX_BODY_BYTES) throw badRequest("The request body is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw badRequest("The request body must be JSON.");
  }
  const parsed = publicCreateBody.safeParse(json);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
    throw invalid(Object.values(fields)[0] ?? "The handoff request is not valid.", { fields });
  }
  return parsed.data;
}

function toResult(created: CreateHandoffResult): PublicCreateResult {
  return {
    object: "handoff_session",
    handoff_id: created.handoff.id,
    status: created.handoff.status,
    hold_expires_at: created.handoff.holdExpiresAt ? created.handoff.holdExpiresAt.toISOString() : null,
    url: created.url,
    embed_url: created.embedUrl,
  };
}

/** Reads the body with a hard size cap (a lying or missing Content-Length cannot make us buffer more). */
async function readCappedText(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > PUBLIC_CREATE_MAX_BODY_BYTES) throw badRequest("The request body is too large.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PUBLIC_CREATE_MAX_BODY_BYTES) {
      await reader.cancel();
      throw badRequest("The request body is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Handles `POST /embed/handoff/create`. Never throws: every failure is a JSON error body with CORS headers. */
export async function handlePublicCreate(request: Request): Promise<PublicResponse> {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  try {
    const body = parsePublicCreateBody(await readCappedText(request));
    const info = requestInfoFromHeaders(request.headers);
    const created = await createHandoff(
      {
        bookingRef: body.booking_ref,
        bookingDescription: body.booking_description ?? null,
        bookingAmountCents: body.booking_amount_cents,
        returnUrl: body.return_url ?? null,
        channel: body.channel ?? "redirect",
        locale: body.locale ?? "en",
      },
      { kind: "embed", publishableKey: body.publishable_key, origin, ip: info.ip, userAgent: info.userAgent },
    );
    return { status: 201, body: toResult(created), headers };
  } catch (e) {
    if (!isAppError(e)) console.error(e);
    const { status, body } = toErrorBody(e);
    return { status, body, headers };
  }
}
