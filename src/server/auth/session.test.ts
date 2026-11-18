import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { MS, setTestNow } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { useTestDb } from "../../../tests/helpers/db";
import {
  createSession,
  getSessionFromToken,
  purgeEndedSessions,
  revokeAllSessionsForUser,
  revokeSession,
  revokeSessionByToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionInvalidReason,
} from "./session";

const T0 = new Date("2026-11-18T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("sessions", () => {
  useTestDb();
  let userId: string;

  beforeEach(async () => {
    setTestNow(T0);
    const db = await getDb();
    userId = "usr_synthetic_session";
    await db.insert(schema.users).values({ id: userId, email: "session@example.com" });
  });
  afterEach(() => {
    setTestNow(null);
    vi.unstubAllEnvs();
  });

  it("issues a 256-bit token and stores only its hash", async () => {
    const { session, token } = await createSession(userId, { ip: "198.51.100.1", userAgent: "vitest" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(session.tokenHash).toBe(hashToken(token));
    const db = await getDb();
    const raw = JSON.stringify(await db.select().from(schema.sessions));
    expect(raw).not.toContain(token);
    expect(session.expiresAt.getTime()).toBe(at(30 * MS.day).getTime());
  });

  it("resolves a live token to its user and ignores malformed or unknown ones", async () => {
    const { token } = await createSession(userId);
    expect((await getSessionFromToken(token))?.user.email).toBe("session@example.com");
    for (const bad of [undefined, null, "", "abc", token + "x", "A".repeat(43), 42]) {
      expect(await getSessionFromToken(bad)).toBeNull();
    }
  });

  it("expires after 7 idle days", async () => {
    const { token } = await createSession(userId);
    setTestNow(at(7 * MS.day - 1));
    expect(await getSessionFromToken(token)).not.toBeNull();
    // That request refreshed lastSeenAt, so the idle clock restarts from here.
    setTestNow(at(14 * MS.day - 2));
    expect(await getSessionFromToken(token)).not.toBeNull();
    setTestNow(at(21 * MS.day - 2));
    expect(await getSessionFromToken(token)).toBeNull();
  });

  it("expires 30 days after sign-in even when active", async () => {
    const { token } = await createSession(userId);
    for (let d = 6; d < 30; d += 6) {
      setTestNow(at(d * MS.day));
      expect(await getSessionFromToken(token)).not.toBeNull();
    }
    setTestNow(at(30 * MS.day));
    expect(await getSessionFromToken(token)).toBeNull();
  });

  it("refreshes lastSeenAt at most every 5 minutes", async () => {
    const { session, token } = await createSession(userId);
    const db = await getDb();
    const lastSeen = async () => (await db.select().from(schema.sessions).where(eq(schema.sessions.id, session.id)))[0].lastSeenAt!.getTime();
    setTestNow(at(4 * MS.minute));
    await getSessionFromToken(token);
    expect(await lastSeen()).toBe(T0.getTime());
    setTestNow(at(5 * MS.minute));
    await getSessionFromToken(token);
    expect(await lastSeen()).toBe(at(5 * MS.minute).getTime());
  });

  it("revokes one session, by id or by token, and all of a user's sessions", async () => {
    const a = await createSession(userId);
    const b = await createSession(userId);
    const c = await createSession(userId);
    expect(await revokeSession(a.session.id)).toBe(true);
    expect(await revokeSession(a.session.id)).toBe(false);
    expect(await getSessionFromToken(a.token)).toBeNull();
    expect(await getSessionFromToken(b.token)).not.toBeNull();

    expect((await revokeSessionByToken(b.token))?.id).toBe(b.session.id);
    expect(await revokeSessionByToken(b.token)).toBeNull();
    expect(await revokeSessionByToken("garbage")).toBeNull();

    const d = await createSession(userId);
    expect(await revokeAllSessionsForUser(userId, { exceptSessionId: d.session.id })).toBe(1);
    expect(await getSessionFromToken(c.token)).toBeNull();
    expect(await getSessionFromToken(d.token)).not.toBeNull();
    expect(await revokeAllSessionsForUser(userId)).toBe(1);
    expect(await getSessionFromToken(d.token)).toBeNull();
  });

  it("explains why a session is not usable", () => {
    const base = { createdAt: T0, lastSeenAt: T0, expiresAt: at(30 * MS.day), revokedAt: null };
    expect(sessionInvalidReason(base, T0)).toBeNull();
    expect(sessionInvalidReason({ ...base, revokedAt: T0 }, T0)).toBe("revoked");
    expect(sessionInvalidReason(base, at(30 * MS.day))).toBe("expired");
    expect(sessionInvalidReason(base, at(7 * MS.day))).toBe("idle");
    expect(sessionInvalidReason({ ...base, lastSeenAt: null }, at(7 * MS.day))).toBe("idle");
  });

  it("purges sessions that ended long ago and keeps live ones", async () => {
    const live = await createSession(userId);
    const old = await createSession(userId);
    await revokeSession(old.session.id);
    setTestNow(at(31 * MS.day));
    const fresh = await createSession(userId);
    expect(await purgeEndedSessions(MS.day)).toBe(2);
    const db = await getDb();
    const ids = (await db.select().from(schema.sessions)).map((s) => s.id);
    expect(ids).toEqual([fresh.session.id]);
    expect(ids).not.toContain(live.session.id);
  });

  describe("cookie", () => {
    it("is HttpOnly, SameSite=Lax, host-only, path / and lives 30 days", () => {
      const o = sessionCookieOptions();
      expect(SESSION_COOKIE).toBe("passport_session");
      expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
      expect(o).not.toHaveProperty("domain");
      expect(o.secure).toBe(false);
    });

    it("is Secure when the app is served over https", () => {
      vi.stubEnv("APP_URL", "https://passport.example.com");
      expect(sessionCookieOptions().secure).toBe(true);
    });
  });
});
