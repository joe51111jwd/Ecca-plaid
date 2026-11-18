import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { addMs, MS, now } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { env, isProd } from "@/lib/env";
import { newId, newToken } from "@/lib/ids";

/**
 * Browser sessions. The cookie holds a 256-bit random token; the database stores only `hashToken(token)`, so a
 * leaked `sessions` table cannot be replayed.
 *
 * A session ends at the first of: its absolute lifetime (30 days from sign-in), 7 days without a request
 * (idle timeout), or revocation (sign-out, "sign out everywhere", account action).
 */

export type User = typeof schema.users.$inferSelect;
export type Session = typeof schema.sessions.$inferSelect;

export const SESSION_COOKIE = "passport_session";
export const SESSION_ABSOLUTE_MS = 30 * MS.day;
export const SESSION_IDLE_MS = 7 * MS.day;
/** `lastSeenAt` is written at most this often, so ordinary page views do not each cost a write. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * MS.minute;

/** 32 random bytes in base64url (see newToken). */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

/**
 * Cookie attributes. No `domain`, so the cookie is host-only and never sent to sibling subdomains. Lax keeps the
 * cookie on top-level navigations from email links while withholding it from cross-site POSTs and subresources.
 * Secure in production and whenever the app is served over https.
 */
export function sessionCookieOptions(): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: isProd() || env().APP_URL.startsWith("https://"), path: "/", maxAge: Math.floor(SESSION_ABSOLUTE_MS / MS.second) };
}

export function isWellFormedSessionToken(token: unknown): token is string {
  return typeof token === "string" && SESSION_TOKEN_PATTERN.test(token);
}

export async function createSession(userId: string, client: SessionClientInfo = {}, dbOrTx?: DbOrTx): Promise<{ session: Session; token: string }> {
  const db = dbOrTx ?? (await getDb());
  const token = newToken(32);
  const at = now();
  const [session] = await db
    .insert(schema.sessions)
    .values({
      id: newId("session"),
      userId,
      tokenHash: hashToken(token),
      createdAt: at,
      expiresAt: addMs(at, SESSION_ABSOLUTE_MS),
      lastSeenAt: at,
      ip: client.ip?.slice(0, 64) ?? null,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
    })
    .returning();
  return { session, token };
}

/** Why a stored session is not usable, or null when it is. Exposed for tests and admin views. */
export function sessionInvalidReason(session: Pick<Session, "revokedAt" | "expiresAt" | "lastSeenAt" | "createdAt">, at: Date = now()): "revoked" | "expired" | "idle" | null {
  if (session.revokedAt) return "revoked";
  if (session.expiresAt.getTime() <= at.getTime()) return "expired";
  const lastActivity = session.lastSeenAt ?? session.createdAt;
  if (lastActivity.getTime() + SESSION_IDLE_MS <= at.getTime()) return "idle";
  return null;
}

/**
 * Resolves a cookie token to its live session and user, or null. Refreshes `lastSeenAt` when it is older than
 * the touch interval (a conditional UPDATE, so concurrent requests do not stack writes).
 */
export async function getSessionFromToken(token: unknown, dbOrTx?: DbOrTx): Promise<{ session: Session; user: User } | null> {
  if (!isWellFormedSessionToken(token)) return null;
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;

  const at = now();
  if (sessionInvalidReason(row.session, at) !== null) return null;

  const touchBefore = new Date(at.getTime() - SESSION_TOUCH_INTERVAL_MS);
  const lastActivity = row.session.lastSeenAt ?? row.session.createdAt;
  if (lastActivity.getTime() <= touchBefore.getTime()) {
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: at })
      .where(and(eq(schema.sessions.id, row.session.id), or(isNull(schema.sessions.lastSeenAt), lte(schema.sessions.lastSeenAt, touchBefore))));
    return { session: { ...row.session, lastSeenAt: at }, user: row.user };
  }
  return row;
}

/** Revokes one session. Returns true when a live session was revoked by this call. */
export async function revokeSession(sessionId: string, dbOrTx?: DbOrTx): Promise<boolean> {
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: now() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .returning({ id: schema.sessions.id });
  return rows.length > 0;
}

/** Revokes the session a cookie token belongs to (sign-out). Unknown tokens are a no-op. */
export async function revokeSessionByToken(token: unknown, dbOrTx?: DbOrTx): Promise<Session | null> {
  if (!isWellFormedSessionToken(token)) return null;
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .update(schema.sessions)
    .set({ revokedAt: now() })
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), isNull(schema.sessions.revokedAt)))
    .returning();
  return row ?? null;
}

/** Signs a person out everywhere (optionally keeping the current session). Returns the number revoked. */
export async function revokeAllSessionsForUser(userId: string, opts: { exceptSessionId?: string } = {}, dbOrTx?: DbOrTx): Promise<number> {
  const db = dbOrTx ?? (await getDb());
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (opts.exceptSessionId) conditions.push(ne(schema.sessions.id, opts.exceptSessionId));
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: now() })
    .where(and(...conditions))
    .returning({ id: schema.sessions.id });
  return rows.length;
}

/** Deletes sessions that ended more than `olderThanMs` ago (default 30 days). For a scheduled cleanup job. */
export async function purgeEndedSessions(olderThanMs = 30 * MS.day, dbOrTx?: DbOrTx): Promise<number> {
  const db = dbOrTx ?? (await getDb());
  const cutoff = new Date(now().getTime() - olderThanMs).toISOString();
  const rows = await db
    .delete(schema.sessions)
    .where(sql`${schema.sessions.expiresAt} < ${cutoff}::timestamptz or ${schema.sessions.revokedAt} < ${cutoff}::timestamptz or coalesce(${schema.sessions.lastSeenAt}, ${schema.sessions.createdAt}) < (${cutoff}::timestamptz - ${`${SESSION_IDLE_MS} milliseconds`}::interval)`)
    .returning({ id: schema.sessions.id });
  return rows.length;
}
