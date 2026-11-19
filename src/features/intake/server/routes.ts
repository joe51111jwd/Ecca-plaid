/**
 * The family flow's route handlers, written once and mounted by thin files under src/app: continuing a sign-in
 * started from a verification link, switching language, receiving uploads and downloading the household's data.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDictionary, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, parseLocale, type Locale } from "@/i18n";
import { appUrl } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { requestInfoFromHeaders } from "@/server/audit";
import { getCurrentUser } from "@/server/auth";
import { exportHouseholdData, getOrCreateHouseholdForUser, updateHouseholdLocale } from "@/server/households";
import { MAX_UPLOAD_BYTES } from "@/server/storage";
import { addDocument, startVerification } from "@/server/verifications";
import { failure, localizeError, type ActionFailure } from "../errors";
import { isFamilyToken, isVerificationId, parseBasePath, surfaceOf, type Surface } from "../flow";
import { isUploadKind } from "../form-data";
import { UPLOAD_OVERHEAD_BYTES } from "../policy";
import { getFamilyUser, localeCookieOptions, takePendingLink } from "./session";

const PRIVATE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

/**
 * A same-site path to send someone back to, or null. Only a single leading slash is accepted (no "//host", no
 * backslashes, no scheme), so a redirect built from it never leaves the app.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "http://placeholder.invalid");
    if (url.origin !== "http://placeholder.invalid") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** The path with `lang` set to the locale (English removes it, so the remembered choice and the URL agree). */
export function withLang(path: string, locale: Locale): string {
  const url = new URL(path, "http://placeholder.invalid");
  if (locale === "es") url.searchParams.set("lang", "es");
  else url.searchParams.delete("lang");
  return `${url.pathname}${url.search}`;
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303, headers: PRIVATE_HEADERS });
}

/* -------------------------------------------------------------------------------------- continue */

/**
 * GET /family/continue — where the sign-in email sends someone who started from a verification link. The link
 * they came from was remembered in a short-lived cookie on this device; without it they land on their household page.
 */
export async function handleContinue(request: NextRequest): Promise<NextResponse> {
  const token = await takePendingLink();
  const user = await getCurrentUser();
  if (!token || !isFamilyToken(token)) return redirectTo(request, "/family");
  if (user) {
    try {
      await startVerification(token, user.id, { request: requestInfoFromHeaders(request.headers) });
    } catch (e) {
      // The landing page explains a used, expired or canceled link.
      if (!isAppError(e)) console.error("[intake] continue failed", e);
    }
  }
  return redirectTo(request, `/v/${token}`);
}

/* -------------------------------------------------------------------------------------- language */

/**
 * GET /family/language?to=es&next=/v/… (and /embed/verify/language for the embedded flow) — remembers the choice
 * in a cookie and, for the household owner, saves it on the household so emails come in the same language.
 */
export async function handleLanguage(request: NextRequest, surface: Surface): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const locale = parseLocale(params.get("to")) ?? "en";
  const fallback = surface === "embed" ? "/" : "/family";
  let next = safeNextPath(params.get("next")) ?? fallback;
  // The embedded flow may only navigate within /embed (everything else refuses to be framed).
  if (surface === "embed" && !next.startsWith("/embed/")) next = fallback;
  (await cookies()).set(LOCALE_COOKIE, locale, localeCookieOptions(surface, LOCALE_COOKIE_MAX_AGE_SECONDS));

  const user = await getFamilyUser(surface);
  if (user) {
    try {
      const { household } = await getOrCreateHouseholdForUser(user.id);
      if (household.access === "owner" && household.locale !== locale) await updateHouseholdLocale(household.id, locale, { userId: user.id, request: requestInfoFromHeaders(request.headers) });
    } catch (e) {
      // The cookie already holds the choice; saving it on the household is a convenience for emails.
      if (!isAppError(e)) console.error("[intake] saving the household language failed", e);
    }
  }
  return redirectTo(request, withLang(next, locale));
}

/* ---------------------------------------------------------------------------------------- upload */

export interface UploadResponseBody {
  ok: true;
  data: { documentId: string; duplicate: boolean; filename: string };
}

function json(body: UploadResponseBody | ActionFailure, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/** Requests must come from our own pages: the embed session cookie is SameSite=None, so the origin is checked. */
export function isSameOriginRequest(request: Pick<NextRequest, "headers" | "nextUrl">): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([request.nextUrl.origin]);
  try {
    allowed.add(new URL(appUrl()).origin);
  } catch {
    // APP_URL is validated by env(); nothing else to allow.
  }
  return allowed.has(origin);
}

const STATUS_BY_CODE: Record<string, number> = { validation_failed: 422, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, gone: 410, rate_limited: 429 };

/**
 * POST /family/upload (multipart) — one file per request: `file`, `kind`, optional `memberId`, plus the flow's
 * `base`, `v` and `lang`. The bytes are checked by the documents service (type sniffing, size, duplicates).
 */
export async function handleUpload(request: NextRequest): Promise<NextResponse> {
  const queryLocale = parseLocale(request.nextUrl.searchParams.get("lang")) ?? "en";
  const t = getDictionary(queryLocale);
  if (!isSameOriginRequest(request)) return json(failure("forbidden", t.errors.forbidden), 403);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES + UPLOAD_OVERHEAD_BYTES) return json(failure("validation_failed", t.errors.files.tooLarge), 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(failure("bad_request", t.errors.generic), 400);
  }
  const locale = parseLocale(form.get("lang")) ?? queryLocale;
  const d = getDictionary(locale);
  const address = parseBasePath(form.get("base"));
  const verificationId = form.get("v");
  if (!address || !isVerificationId(verificationId)) return json(failure("not_found", d.errors.notFound), 404);
  const user = await getFamilyUser(surfaceOf(address));
  if (!user) return json(failure("unauthenticated", d.errors.signInAgain), 401);

  const file = form.get("file");
  if (!(file instanceof File)) return json(failure("validation_failed", d.errors.files.empty), 422);
  if (file.size > MAX_UPLOAD_BYTES) return json(failure("validation_failed", d.errors.files.tooLarge), 413);
  const kind = form.get("kind");
  if (!isUploadKind(kind)) return json(failure("validation_failed", d.errors.files.chooseKind, { declaredKind: d.errors.fields.declaredKind }), 422);
  const memberRaw = form.get("memberId");
  const memberId = typeof memberRaw === "string" && memberRaw.length > 0 ? memberRaw : null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await addDocument(
      { verificationId, declaredKind: kind, memberId, bytes, filename: file.name, contentType: file.type },
      { userId: user.id, request: requestInfoFromHeaders(request.headers) },
    );
    return json({ ok: true, data: { documentId: result.document.id, duplicate: result.duplicate, filename: result.document.filename } }, result.duplicate ? 200 : 201);
  } catch (e) {
    const localized = localizeError(e, locale);
    return json(localized, STATUS_BY_CODE[localized.error.code] ?? 500);
  }
}

/* ---------------------------------------------------------------------------------------- export */

/** GET /family/data — everything held about the household, as a JSON download (owner only). */
export async function handleExport(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return redirectTo(request, `/sign-in?next=${encodeURIComponent("/family")}`);
  try {
    const { household } = await getOrCreateHouseholdForUser(user.id);
    const data = await exportHouseholdData(household.id, { userId: user.id, request: requestInfoFromHeaders(request.headers) });
    const day = data.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="household-data-${day}.json"` },
    });
  } catch (e) {
    if (isAppError(e) && (e.code === "forbidden" || e.code === "not_found")) return redirectTo(request, "/family?error=forbidden");
    throw e;
  }
}
