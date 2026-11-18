export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "rate_limited"
  | "payment_failed"
  | "not_available"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  rate_limited: 429,
  payment_failed: 402,
  not_available: 503,
  internal: 500,
};

/** Error with a stable machine code. Safe to show `message` to the caller. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Resource") => new AppError("not_found", `${what} not found`);
export const forbidden = (msg = "You do not have access to this resource") => new AppError("forbidden", msg);
export const unauthenticated = (msg = "Sign in required") => new AppError("unauthenticated", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError("bad_request", msg, details);
export const invalid = (msg: string, details?: unknown) => new AppError("validation_failed", msg, details);
export const conflict = (msg: string, details?: unknown) => new AppError("conflict", msg, details);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "AppError");
}

/** JSON body used by every API error response. */
export function toErrorBody(e: unknown): { status: number; body: { error: { code: ErrorCode; message: string; details?: unknown } } } {
  if (isAppError(e)) {
    return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } } };
  }
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong" } } };
}

/** Result type for server actions (never throw across the client boundary). */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; fields?: Record<string, string> } };

export function actionError(e: unknown): { ok: false; error: { code: ErrorCode; message: string; fields?: Record<string, string> } } {
  if (isAppError(e)) {
    const fields = e.details && typeof e.details === "object" && "fields" in (e.details as object) ? ((e.details as { fields?: Record<string, string> }).fields ?? undefined) : undefined;
    return { ok: false, error: { code: e.code, message: e.message, ...(fields ? { fields } : {}) } };
  }
  console.error(e);
  return { ok: false, error: { code: "internal", message: "Something went wrong. Please try again." } };
}
