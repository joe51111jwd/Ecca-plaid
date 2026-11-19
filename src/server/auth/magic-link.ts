import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { addMs, MS, now } from "@/lib/clock";
import { deriveKey, hashToken, hmacSha256, safeEqual } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { AppError, invalid } from "@/lib/errors";
import { newId, newNumericCode, newToken } from "@/lib/ids";
import { audit, SYSTEM_ACTOR, type AuditRequestInfo } from "@/server/audit";
import { renderEmail, sendEmail, type EmailLocale } from "@/server/email";
import { enforceRateLimit, resetRateLimit } from "@/server/ratelimit";
import { signInEmailCopy } from "./copy";
import { normalizeEmail } from "./email-address";
import { grantBootstrapPlatformAdmin } from "./platform";
import { sanitizeRedirect } from "./redirect";
import { createSession, type Session, type User } from "./session";

/**
 * Passwordless sign-in. One email carries a single-use credential in two forms: a link
 * (`/auth/callback?token=…`) and a 6-digit code for when the link opens on another device or inside an embed.
 *
 * Security properties (each covered by tests):
 *  - only hashes are stored: `hashToken(token)` and an HMAC of the code keyed by a server secret and bound to
 *    the link id, so a code cannot be replayed against another link;
 *  - consumption is one atomic `UPDATE … WHERE consumed_at IS NULL AND expires_at > now RETURNING`, so two
 *    concurrent uses yield exactly one session;
 *  - a link accepts at most MAX_CODE_ATTEMPTS wrong codes, then it is burned;
 *  - requesting a new link supersedes the address's older unused links;
 *  - responses and errors never reveal whether an address has an account.
 */

export type MagicLink = typeof schema.magicLinks.$inferSelect;

export const MAGIC_LINK_TTL_MS = 15 * MS.minute;
export const MAGIC_LINK_TTL_MINUTES = MAGIC_LINK_TTL_MS / MS.minute;
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_DIGITS = 6;

/** Rate-limit policies. Fixed windows; the numbers are product policy, not from any regulation. */
export const SIGN_IN_LIMITS = {
  requestPerEmail: { limit: 5, windowMs: 15 * MS.minute },
  requestPerIp: { limit: 20, windowMs: 15 * MS.minute },
  codePerEmail: { limit: 10, windowMs: 15 * MS.minute },
  consumePerIp: { limit: 30, windowMs: 15 * MS.minute },
} as const;

const MAX_CONTEXT_BYTES = 4096;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LINK_INVALID_MESSAGE = "This sign-in link has expired or was already used. Ask for a new one.";
export const CODE_INVALID_MESSAGE = "That code did not work. Check the code in your newest email, or ask for a new one.";

const contextSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= MAX_CONTEXT_BYTES, { message: "context is too large" });

export interface RequestSignInInput {
  email: string;
  /** Same-origin path to open after sign-in. Unsafe values are dropped, not rejected. */
  redirectTo?: string | null;
  /** Flow context returned on sign-in, e.g. { verificationId }. JSON, at most 4 KB. */
  context?: Record<string, unknown> | null;
  /** Language of the email. Defaults to the account's language, else English. */
  locale?: EmailLocale | null;
  request?: AuditRequestInfo | null;
}

/** Identical for every address, whether or not it has an account. */
export interface RequestSignInResult {
  email: string;
  expiresInMinutes: number;
}

export interface SignInResult {
  user: User;
  session: Session;
  /** Put this in the session cookie (setSessionCookie). Never log or store it. */
  sessionToken: string;
  /** Sanitized same-origin path, or null when none was requested. */
  redirectTo: string | null;
  context: Record<string, unknown> | null;
  isNewUser: boolean;
}

export function hashSignInCode(linkId: string, code: string): string {
  return hmacSha256(deriveKey("magic-link-code"), `${linkId}:${code}`).toString("hex");
}

function linkInvalid(): AppError {
  return new AppError("gone", LINK_INVALID_MESSAGE);
}

function codeInvalid(): AppError {
  return invalid(CODE_INVALID_MESSAGE, { fields: { code: CODE_INVALID_MESSAGE } });
}

/**
 * Creates a sign-in credential and emails it. Rate-limited per address and per client IP. Supersedes the
 * address's older unused credentials.
 */
export async function requestSignIn(input: RequestSignInInput, dbOrTx?: DbOrTx): Promise<RequestSignInResult> {
  const email = normalizeEmail(input.email);
  const redirectTo = input.redirectTo ? sanitizeRedirect(input.redirectTo) : null;
  let context: Record<string, unknown> | null = null;
  if (input.context !== undefined && input.context !== null) {
    const parsed = contextSchema.safeParse(input.context);
    if (!parsed.success) throw new AppError("internal", "requestSignIn: context must be a JSON object of at most 4 KB");
    context = parsed.data;
  }
  const ip = input.request?.ip ?? null;

  const db = dbOrTx ?? (await getDb());
  await enforceRateLimit(`auth:request:email:${email}`, { ...SIGN_IN_LIMITS.requestPerEmail, message: "Too many sign-in emails were requested for this address." }, db);
  if (ip) await enforceRateLimit(`auth:request:ip:${ip}`, { ...SIGN_IN_LIMITS.requestPerIp, message: "Too many sign-in requests from this network." }, db);

  const [existingUser] = await db.select({ locale: schema.users.locale }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const locale: EmailLocale = input.locale === "es" || input.locale === "en" ? input.locale : (existingUser?.locale ?? "en");

  const at = now();
  const token = newToken(32);
  const code = newNumericCode(CODE_DIGITS);
  const linkId = newId("magicLink");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.magicLinks)
      .set({ consumedAt: at })
      .where(and(eq(schema.magicLinks.email, email), isNull(schema.magicLinks.consumedAt)));
    await tx.insert(schema.magicLinks).values({
      id: linkId,
      email,
      tokenHash: hashToken(token),
      codeHash: hashSignInCode(linkId, code),
      redirectTo,
      context,
      expiresAt: addMs(at, MAGIC_LINK_TTL_MS),
      createdIp: ip,
      createdAt: at,
    });
  });

  const copy = signInEmailCopy(locale, MAGIC_LINK_TTL_MINUTES);
  const rendered = renderEmail({
    locale,
    preheader: copy.preheader,
    heading: copy.heading,
    paragraphs: copy.paragraphs,
    cta: { label: copy.cta, url: appUrl(`/auth/callback?token=${encodeURIComponent(token)}${locale === "es" ? "&lang=es" : ""}`) },
    code: { label: copy.codeLabel, value: code },
    footerNote: copy.footerNote,
  });
  await sendEmail(
    { to: email, subject: copy.subject, template: "magic_link", html: rendered.html, text: rendered.text, related: { type: "magic_link", id: linkId }, sensitive: true },
    db,
  );

  return { email, expiresInMinutes: MAGIC_LINK_TTL_MINUTES };
}

/** Signs in with the token from an emailed link. Throws `gone` for any unknown, used, superseded or expired token. */
export async function consumeToken(token: unknown, request?: AuditRequestInfo | null, dbOrTx?: DbOrTx): Promise<SignInResult> {
  const db = dbOrTx ?? (await getDb());
  if (request?.ip) await enforceRateLimit(`auth:consume:ip:${request.ip}`, { ...SIGN_IN_LIMITS.consumePerIp, message: "Too many sign-in attempts from this network." }, db);
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw linkInvalid();

  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    const at = now();
    const [link] = await tx
      .update(schema.magicLinks)
      .set({ consumedAt: at })
      .where(and(eq(schema.magicLinks.tokenHash, tokenHash), isNull(schema.magicLinks.consumedAt), gt(schema.magicLinks.expiresAt, at)))
      .returning();
    if (!link) throw linkInvalid();
    return completeSignIn(tx, link, "link", request ?? null);
  });
}

/** Signs in with the 6-digit code from the newest email sent to `email`. */
export async function consumeCode(input: { email: string; code: string }, request?: AuditRequestInfo | null, dbOrTx?: DbOrTx): Promise<SignInResult> {
  const email = normalizeEmail(input.email);
  const code = typeof input.code === "string" ? input.code.replace(/[\s-]/g, "") : "";
  const db = dbOrTx ?? (await getDb());

  if (request?.ip) await enforceRateLimit(`auth:consume:ip:${request.ip}`, { ...SIGN_IN_LIMITS.consumePerIp, message: "Too many sign-in attempts from this network." }, db);
  await enforceRateLimit(`auth:code:email:${email}`, { ...SIGN_IN_LIMITS.codePerEmail, message: "Too many codes were tried for this address." }, db);
  if (!new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code)) throw codeInvalid();

  const at = now();
  const ml = schema.magicLinks;
  const live = and(isNull(ml.consumedAt), gt(ml.expiresAt, at));
  const [link] = await db
    .select({ id: ml.id })
    .from(ml)
    .where(and(eq(ml.email, email), live))
    .orderBy(desc(ml.createdAt), desc(ml.id))
    .limit(1);
  if (!link) throw codeInvalid();

  // Count the attempt before comparing, atomically, so parallel guesses cannot exceed the allowance.
  const [attempt] = await db
    .update(ml)
    .set({ attempts: sql`${ml.attempts} + 1` })
    .where(and(eq(ml.id, link.id), live, lt(ml.attempts, MAX_CODE_ATTEMPTS)))
    .returning({ attempts: ml.attempts, codeHash: ml.codeHash });
  if (!attempt) throw codeInvalid();

  if (!safeEqual(attempt.codeHash, hashSignInCode(link.id, code))) {
    if (attempt.attempts >= MAX_CODE_ATTEMPTS) {
      const burned = await db
        .update(ml)
        .set({ consumedAt: now() })
        .where(and(eq(ml.id, link.id), isNull(ml.consumedAt)))
        .returning({ id: ml.id });
      if (burned.length > 0) {
        await audit({ actor: SYSTEM_ACTOR, action: "auth.sign_in_locked", target: { type: "magic_link", id: link.id }, metadata: { reason: "too_many_code_attempts" }, request }, db);
      }
    }
    throw codeInvalid();
  }

  const result = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(ml)
      .set({ consumedAt: now() })
      .where(and(eq(ml.id, link.id), isNull(ml.consumedAt), gt(ml.expiresAt, now())))
      .returning();
    if (!consumed) throw codeInvalid();
    return completeSignIn(tx, consumed, "code", request ?? null);
  });
  await resetRateLimit(`auth:code:email:${email}`, db);
  return result;
}

async function completeSignIn(tx: DbOrTx, link: MagicLink, method: "link" | "code", request: AuditRequestInfo | null): Promise<SignInResult> {
  const at = now();
  const u = schema.users;
  let isNewUser = false;
  let [user] = await tx.update(u).set({ lastLoginAt: at }).where(eq(u.email, link.email)).returning();
  if (!user) {
    const inserted = await tx.insert(u).values({ id: newId("user"), email: link.email, createdAt: at, lastLoginAt: at }).onConflictDoNothing({ target: u.email }).returning();
    if (inserted[0]) {
      user = inserted[0];
      isNewUser = true;
    } else {
      [user] = await tx.update(u).set({ lastLoginAt: at }).where(eq(u.email, link.email)).returning();
    }
  }

  const platformAdminGranted = await grantBootstrapPlatformAdmin(user, tx);
  const { session, token } = await createSession(user.id, { ip: request?.ip, userAgent: request?.userAgent }, tx);
  await audit(
    {
      actor: { type: "user", id: user.id },
      action: "auth.sign_in",
      target: { type: "user", id: user.id },
      metadata: { method, newUser: isNewUser, magicLinkId: link.id, sessionId: session.id, ...(platformAdminGranted ? { platformAdminGranted: true } : {}) },
      request,
    },
    tx,
  );

  return {
    user,
    session,
    sessionToken: token,
    // Re-checked on the way out: the stored value was sanitized when written, but rules can tighten later.
    redirectTo: link.redirectTo ? sanitizeRedirect(link.redirectTo) : null,
    context: link.context ?? null,
    isNewUser,
  };
}

/** How long a used or expired sign-in link row is kept before the cleanup job deletes it. */
export const MAGIC_LINK_RETENTION_MS = MS.day;

/**
 * Deletes sign-in links that expired more than `olderThanMs` ago (default one day), used or not. A link is
 * useless once it has expired, so nothing reads these rows again. For the scheduled cleanup job.
 */
export async function purgeExpiredMagicLinks(olderThanMs: number = MAGIC_LINK_RETENTION_MS, dbOrTx?: DbOrTx): Promise<number> {
  const db = dbOrTx ?? (await getDb());
  const cutoff = addMs(now(), -olderThanMs);
  const rows = await db.delete(schema.magicLinks).where(lt(schema.magicLinks.expiresAt, cutoff)).returning({ id: schema.magicLinks.id });
  return rows.length;
}
