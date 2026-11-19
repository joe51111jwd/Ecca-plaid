/**
 * The wrapper every /api/v1 route handler goes through:
 *
 *   export const POST = apiRoute({
 *     orgTypes: ["sgo"],
 *     body: createVerificationBody,
 *     audit: "api.verification.create",
 *     handler: async (ctx) => ({ status: 201, body: … }),
 *   });
 *
 * Order: request id → API key → per-key rate limit → organization type → path params → query → JSON body (zod) →
 * Idempotency-Key → handler → audit of mutating calls → uniform JSON envelope. Every response carries X-Request-Id,
 * `Cache-Control: no-store` and (once the key is known) the RateLimit-* headers. Errors use toErrorBody plus the
 * request id, and an unexpected error is logged server-side and reported as a bare `internal` error: no stack, no
 * message from the exception.
 */
import type { z } from "zod";
import type { Mode, OrgType } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { AppError, badRequest, forbidden, invalid, isAppError, toErrorBody } from "@/lib/errors";
import { newToken } from "@/lib/ids";
import { audit, type AuditRequestInfo } from "@/server/audit";
import { rateLimit, rateLimitHeaders } from "@/server/ratelimit";
import { beginIdempotentRequest, completeIdempotentRequest, releaseIdempotentRequest } from "./idempotency";
import { authenticateApiKey, type ApiKeySummary, type Organization } from "./keys";
import { API_RATE_LIMIT, MAX_JSON_BODY_BYTES } from "./policy";

export type ApiOrgType = Extract<OrgType, "sgo" | "business">;

/** Acting API key, in the shape the verification and donation services take (`OrgActor` / `ReadAccess`). */
export interface ApiKeyActor {
  type: "api_key";
  id: string;
  mode: Mode;
  request: AuditRequestInfo;
}

export interface ApiContext<Q, B> {
  request: Request;
  requestId: string;
  org: Organization;
  mode: Mode;
  apiKey: ApiKeySummary;
  actor: ApiKeyActor;
  /** The same key in the shape the handoff service takes (`HandoffActor`). */
  handoffActor: { type: "api_key"; apiKeyId: string; mode: Mode; request: AuditRequestInfo };
  params: Record<string, string>;
  query: Q;
  body: B;
  /** APP_URL without a trailing slash: base of the URLs the API returns. */
  baseUrl: string;
  /** Names the record a mutating call touched, for its audit entry. */
  setAuditTarget(type: string, id: string): void;
}

/** A JSON reply, or a ready Response for binary and CSV downloads (the wrapper still adds its headers). */
export type ApiHandlerResult = { status?: number; body: unknown; headers?: Record<string, string> } | Response;

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface ApiRouteSpec<QS extends z.ZodType | undefined, BS extends z.ZodType | undefined> {
  /** Organization types whose keys may call this route. */
  orgTypes: readonly ApiOrgType[];
  /** Query-string schema. Without one, any query parameter is refused. */
  query?: QS;
  /** JSON body schema (POST / PATCH). Without one, a non-empty body is refused. */
  body?: BS;
  /** Accept `Idempotency-Key` (default: true for POST). */
  idempotent?: boolean;
  /** Audit action written for a successful call, e.g. "api.webhook_endpoint.create". */
  audit?: string;
  /** Service field names → API field names in `details.fields` of validation errors (default: camelCase → snake_case). */
  fieldNames?: Readonly<Record<string, string>>;
  handler: (ctx: ApiContext<Infer<QS>, Infer<BS>>) => Promise<ApiHandlerResult>;
}

export interface RouteHandlerContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const PARAM_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function newRequestId(): string {
  return `req_${newToken(12)}`;
}

function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Rewrites `details.fields` keys into the API's field names. */
function apiFieldNames(details: unknown, overrides: Readonly<Record<string, string>> | undefined): unknown {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  const d = details as Record<string, unknown>;
  const fields = d.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return details;
  const mapped: Record<string, unknown> = {};
  for (const [key, message] of Object.entries(fields as Record<string, unknown>)) {
    const name = overrides?.[key] ?? key.split(".").map(camelToSnake).join(".");
    if (!(name in mapped)) mapped[name] = message;
  }
  return { ...d, fields: mapped };
}

function zodFields(error: z.ZodError, prefix?: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    let path = issue.path.map(String).join(".");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[[path, key].filter(Boolean).join(".")] ??= prefix === "query" ? "Unknown query parameter." : "Unknown field.";
      continue;
    }
    if (path === "") path = prefix ?? "body";
    fields[path] ??= issue.message;
  }
  return fields;
}

function errorResponse(e: unknown, requestId: string, headers: Record<string, string>, fieldNames?: Readonly<Record<string, string>>): Response {
  if (!isAppError(e)) console.error(`[api] ${requestId} unexpected error`, e);
  const { status, body } = toErrorBody(e);
  const extra: Record<string, string> = {};
  if (isAppError(e)) {
    if (e.code === "unauthenticated") extra["WWW-Authenticate"] = 'Bearer realm="api"';
    const retry = (e.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (e.code === "rate_limited" && typeof retry === "number") extra["Retry-After"] = String(retry);
  }
  const error = { ...body.error, ...(body.error.details !== undefined ? { details: apiFieldNames(body.error.details, fieldNames) } : {}), request_id: requestId };
  return jsonResponse(status, { error }, { ...headers, ...extra });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function baseHeaders(requestId: string): Record<string, string> {
  return { "X-Request-Id": requestId, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

function readQuery(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key in out) throw badRequest(`Query parameter "${key}" was given more than once.`, { reason: "duplicate_query_parameter" });
    out[key] = value;
  }
  return out;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) throw new AppError("bad_request", `The request body must be at most ${MAX_JSON_BODY_BYTES} bytes.`, { reason: "body_too_large" });
  const buffer = new Uint8Array(await request.arrayBuffer());
  if (buffer.byteLength > MAX_JSON_BODY_BYTES) throw new AppError("bad_request", `The request body must be at most ${MAX_JSON_BODY_BYTES} bytes.`, { reason: "body_too_large" });
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.trim() === "") return undefined;
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw badRequest("Send the body as JSON with Content-Type: application/json.", { reason: "unsupported_content_type" });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest("The request body is not valid JSON.", { reason: "invalid_json" });
  }
}

async function readParams(ctx: RouteHandlerContext | undefined): Promise<Record<string, string>> {
  const raw = ctx?.params ? await ctx.params : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    // An id that cannot exist is reported like one that does not: never a validation error that echoes it.
    if (typeof value !== "string" || !PARAM_PATTERN.test(value)) throw new AppError("not_found", "Resource not found");
    out[key] = value;
  }
  return out;
}

/** Builds a Next.js route handler from a spec. See the module comment for what it does in which order. */
export function apiRoute<QS extends z.ZodType | undefined = undefined, BS extends z.ZodType | undefined = undefined>(
  spec: ApiRouteSpec<QS, BS>,
): (request: Request, context: RouteHandlerContext) => Promise<Response> {
  return async (request, context) => {
    const requestId = newRequestId();
    let headers = baseHeaders(requestId);
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    let idempotencyRecord: string | null = null;

    try {
      const auth = await authenticateApiKey(request);
      const limit = await rateLimit(`api:key:${auth.apiKeyId}`, API_RATE_LIMIT);
      headers = { ...headers, ...rateLimitHeaders(limit) };
      if (!limit.allowed) throw new AppError("rate_limited", `Rate limit of ${limit.limit} requests per minute for this key exceeded.`, { retryAfterSeconds: limit.retryAfterSeconds });

      if (auth.org.type !== "sgo" && auth.org.type !== "business") throw forbidden();
      if (!spec.orgTypes.includes(auth.org.type)) {
        throw forbidden(spec.orgTypes.length === 1 ? `This endpoint is for ${spec.orgTypes[0] === "sgo" ? "scholarship organization" : "business"} keys.` : "This key cannot call this endpoint.", { reason: "wrong_organization_type" });
      }

      const params = await readParams(context);

      const rawQuery = readQuery(url);
      let query: unknown = undefined;
      if (spec.query) {
        const parsed = spec.query.safeParse(rawQuery);
        if (!parsed.success) {
          const fields = zodFields(parsed.error, "query");
          throw invalid(Object.values(fields)[0] ?? "The query string is not valid.", { fields });
        }
        query = parsed.data;
      } else if (Object.keys(rawQuery).length > 0) {
        throw invalid("This endpoint takes no query parameters.", { fields: Object.fromEntries(Object.keys(rawQuery).map((k) => [k, "Unknown query parameter."])) });
      }

      let rawBody: unknown = undefined;
      let body: unknown = undefined;
      if (MUTATING.has(method)) {
        rawBody = await readJsonBody(request);
        if (spec.body) {
          const parsed = spec.body.safeParse(rawBody ?? {});
          if (!parsed.success) {
            const fields = zodFields(parsed.error);
            throw invalid(Object.values(fields)[0] ?? "The request body is not valid.", { fields });
          }
          body = parsed.data;
        } else if (rawBody !== undefined && !(typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody) && Object.keys(rawBody).length === 0)) {
          throw invalid("This endpoint takes no request body.", { fields: { body: "Send no body (or {})." } });
        }
      }

      const idempotencyKey = request.headers.get("idempotency-key");
      if (idempotencyKey !== null && method === "POST" && spec.idempotent !== false) {
        const start = await beginIdempotentRequest({ orgId: auth.org.id, mode: auth.mode, key: idempotencyKey, method, path: url.pathname, body: rawBody ?? null });
        if (start.kind === "replay") return jsonResponse(start.status, start.body, { ...headers, "Idempotent-Replayed": "true" });
        idempotencyRecord = start.recordId;
      }

      let auditTarget: { type: string; id: string } | null = null;
      const actor: ApiKeyActor = { type: "api_key", id: auth.apiKeyId, mode: auth.mode, request: auth.request };
      const result = await spec.handler({
        request,
        requestId,
        org: auth.org,
        mode: auth.mode,
        apiKey: auth.apiKey,
        actor,
        handoffActor: { type: "api_key", apiKeyId: auth.apiKeyId, mode: auth.mode, request: auth.request },
        params,
        query: query as Infer<QS>,
        body: body as Infer<BS>,
        baseUrl: appUrl().replace(/\/+$/, ""),
        setAuditTarget: (type, id) => {
          auditTarget = { type, id };
        },
      });

      const status = result instanceof Response ? result.status : (result.status ?? 200);
      if (spec.audit && MUTATING.has(method) && status < 400) {
        await audit({
          actor: { type: "api_key", id: auth.apiKeyId },
          orgId: auth.org.id,
          action: spec.audit,
          target: auditTarget,
          metadata: { mode: auth.mode, requestId, method, path: url.pathname, status },
          request: auth.request,
        });
      }

      if (result instanceof Response) {
        if (idempotencyRecord) await releaseIdempotentRequest(idempotencyRecord);
        const merged = new Headers(result.headers);
        for (const [k, v] of Object.entries(headers)) merged.set(k, v);
        return new Response(result.body, { status: result.status, headers: merged });
      }
      if (idempotencyRecord) {
        if (status < 500) await completeIdempotentRequest(idempotencyRecord, status, result.body);
        else await releaseIdempotentRequest(idempotencyRecord);
      }
      return jsonResponse(status, result.body, { ...headers, ...(result.headers ?? {}) });
    } catch (e) {
      const response = errorResponse(e, requestId, headers, spec.fieldNames);
      if (idempotencyRecord) {
        // A deterministic refusal is remembered like a success; a crash or a rate limit is not, so a retry can run.
        if (response.status < 500 && response.status !== 429) {
          await completeIdempotentRequest(idempotencyRecord, response.status, await response.clone().json()).catch((err: unknown) => console.error(`[api] ${requestId} could not store idempotent response`, err));
        } else {
          await releaseIdempotentRequest(idempotencyRecord).catch((err: unknown) => console.error(`[api] ${requestId} could not release idempotency key`, err));
        }
      }
      return response;
    }
  };
}

/** `{ object: "list", data, has_more, next_cursor }`. */
export function listEnvelope<T>(data: T[], nextCursor: string | null): { object: "list"; data: T[]; has_more: boolean; next_cursor: string | null } {
  return { object: "list", data, has_more: nextCursor !== null, next_cursor: nextCursor };
}
