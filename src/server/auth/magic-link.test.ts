import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { MS, setTestNow } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { listAuditLogs } from "@/server/audit";
import { listOutbox } from "@/server/email";
import { useTestDb } from "../../../tests/helpers/db";
import { CODE_INVALID_MESSAGE, consumeCode, consumeToken, hashSignInCode, LINK_INVALID_MESSAGE, MAX_CODE_ATTEMPTS, requestSignIn } from "./magic-link";
import { getSessionFromToken } from "./session";
import { readSignInEmail } from "./test-helpers";

// All addresses below are synthetic test fixtures.
const T0 = new Date("2026-11-18T15:00:00Z");

async function expectAppError(p: Promise<unknown>, code: string, message?: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(isAppError(e)).toBe(true);
    if (!isAppError(e)) return;
    expect(e.code).toBe(code);
    if (message) expect(e.message).toBe(message);
    return;
  }
  throw new Error(`expected AppError ${code}`);
}

describe("magic-link sign-in", () => {
  useTestDb();
  beforeEach(() => setTestNow(T0));
  afterEach(() => {
    setTestNow(null);
    vi.unstubAllEnvs();
  });

  describe("requestSignIn", () => {
    it("normalizes the address, stores only hashes and emails a link plus code", async () => {
      const res = await requestSignIn({ email: "  Parent.One@Example.COM " });
      expect(res).toEqual({ email: "parent.one@example.com", expiresInMinutes: 15 });

      const db = await getDb();
      const [link] = await db.select().from(schema.magicLinks);
      expect(link.email).toBe("parent.one@example.com");
      expect(link.expiresAt.getTime()).toBe(T0.getTime() + 15 * MS.minute);

      const mail = await readSignInEmail("parent.one@example.com");
      expect(link.tokenHash).toBe(hashToken(mail.token));
      expect(link.codeHash).toBe(hashSignInCode(link.id, mail.code));
      expect(link.tokenHash).not.toContain(mail.token);
      expect(link.codeHash).not.toContain(mail.code);
      expect(mail.text).toContain(`/auth/callback?token=${mail.token}`);
      expect(mail.text).toMatch(/expire in 15 minutes/);
      expect(mail.text).toMatch(/can be used once/);
      expect(mail.text).toMatch(/If you did not ask for this, ignore this email/);
    });

    it("writes Spanish copy when asked, and defaults to the account's language", async () => {
      await requestSignIn({ email: "es1@example.com", locale: "es" });
      const es = await readSignInEmail("es1@example.com");
      expect(es.text).toMatch(/vencen en 15 minutos/);
      expect(es.text).toMatch(/una sola vez/);
      expect(es.text).toMatch(/Si usted no pidió esto, ignore este correo/);

      const db = await getDb();
      await db.insert(schema.users).values({ id: "usr_synthetic_es", email: "es2@example.com", locale: "es" });
      await requestSignIn({ email: "es2@example.com" });
      expect((await readSignInEmail("es2@example.com")).subject).toMatch(/iniciar sesión/);
    });

    it("returns the same shape for known and unknown addresses (no account enumeration)", async () => {
      const db = await getDb();
      await db.insert(schema.users).values({ id: "usr_synthetic_known", email: "known@example.com" });
      const known = await requestSignIn({ email: "known@example.com" });
      const unknown = await requestSignIn({ email: "unknown@example.com" });
      expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
      expect(known.expiresInMinutes).toBe(unknown.expiresInMinutes);
      expect((await readSignInEmail("known@example.com")).subject).toBe((await readSignInEmail("unknown@example.com")).subject);
      // No account is created by merely asking.
      expect(await db.select().from(schema.users).where(eq(schema.users.email, "unknown@example.com"))).toHaveLength(0);
    });

    it("rejects invalid addresses with a field error", async () => {
      for (const bad of ["", "not-an-email", "a@", "@b.com", 42, null]) {
        await expectAppError(requestSignIn({ email: bad as string }), "validation_failed");
      }
    });

    it("drops unsafe redirect targets and keeps safe ones", async () => {
      await requestSignIn({ email: "r1@example.com", redirectTo: "//evil.com/x" });
      await requestSignIn({ email: "r2@example.com", redirectTo: "/v/abc?step=2" });
      const db = await getDb();
      const rows = await db.select().from(schema.magicLinks);
      expect(rows.find((r) => r.email === "r1@example.com")!.redirectTo).toBeNull();
      expect(rows.find((r) => r.email === "r2@example.com")!.redirectTo).toBe("/v/abc?step=2");
    });

    it("invalidates the address's older unused links when a new one is requested", async () => {
      await requestSignIn({ email: "again@example.com" });
      const first = await readSignInEmail("again@example.com");
      setTestNow(new Date(T0.getTime() + MS.second));
      await requestSignIn({ email: "again@example.com" });
      const second = await readSignInEmail("again@example.com");
      expect(second.token).not.toBe(first.token);

      await expectAppError(consumeToken(first.token), "gone", LINK_INVALID_MESSAGE);
      const signedIn = await consumeToken(second.token);
      expect(signedIn.user.email).toBe("again@example.com");
    });

    it("rate-limits per address (5 per 15 minutes) and per IP (20 per 15 minutes)", async () => {
      for (let i = 0; i < 5; i++) await requestSignIn({ email: "limited@example.com" });
      await expectAppError(requestSignIn({ email: "limited@example.com" }), "rate_limited");
      setTestNow(new Date(T0.getTime() + 15 * MS.minute + 1));
      await expect(requestSignIn({ email: "limited@example.com" })).resolves.toBeTruthy();

      const request = { ip: "203.0.113.9" };
      for (let i = 0; i < 20; i++) await requestSignIn({ email: `ip${i}@example.com`, request });
      await expectAppError(requestSignIn({ email: "ip-extra@example.com", request }), "rate_limited");
    });
  });

  describe("consumeToken", () => {
    it("creates the account on first use and signs the same person back in later", async () => {
      await requestSignIn({ email: "first@example.com", redirectTo: "/family/start", context: { verificationId: "ver_synthetic" } });
      const { token } = await readSignInEmail("first@example.com");
      const r1 = await consumeToken(token, { ip: "198.51.100.4", userAgent: "vitest" });
      expect(r1.isNewUser).toBe(true);
      expect(r1.redirectTo).toBe("/family/start");
      expect(r1.context).toEqual({ verificationId: "ver_synthetic" });
      expect(r1.user.lastLoginAt?.getTime()).toBe(T0.getTime());
      expect((await getSessionFromToken(r1.sessionToken))?.user.id).toBe(r1.user.id);
      expect(r1.session.ip).toBe("198.51.100.4");

      setTestNow(new Date(T0.getTime() + MS.hour));
      await requestSignIn({ email: "FIRST@example.com" });
      const r2 = await consumeToken((await readSignInEmail("first@example.com")).token);
      expect(r2.isNewUser).toBe(false);
      expect(r2.user.id).toBe(r1.user.id);
      expect(r2.redirectTo).toBeNull();
      expect(r2.user.lastLoginAt?.getTime()).toBe(T0.getTime() + MS.hour);

      const db = await getDb();
      expect(await db.select().from(schema.users)).toHaveLength(1);
      const log = await listAuditLogs({ action: "auth.sign_in" });
      expect(log.items).toHaveLength(2);
      expect(log.items[0].actorId).toBe(r1.user.id);
      expect(JSON.stringify(log.items)).not.toContain(token);
    });

    it("is single-use", async () => {
      await requestSignIn({ email: "once@example.com" });
      const { token } = await readSignInEmail("once@example.com");
      await consumeToken(token);
      await expectAppError(consumeToken(token), "gone", LINK_INVALID_MESSAGE);
    });

    it("yields exactly one success under concurrent use", async () => {
      await requestSignIn({ email: "race@example.com" });
      const { token } = await readSignInEmail("race@example.com");
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeToken(token)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(isAppError(r.reason) && r.reason.code).toBe("gone");
      const db = await getDb();
      expect(await db.select().from(schema.sessions)).toHaveLength(1);
    });

    it("expires after 15 minutes", async () => {
      await requestSignIn({ email: "late@example.com" });
      const { token } = await readSignInEmail("late@example.com");
      setTestNow(new Date(T0.getTime() + 15 * MS.minute));
      await expectAppError(consumeToken(token), "gone", LINK_INVALID_MESSAGE);
    });

    it("answers the same generic error for malformed, unknown and wrong-type tokens", async () => {
      for (const bad of ["", "short", "x".repeat(43), "A".repeat(42) + "=", undefined, 123]) {
        await expectAppError(consumeToken(bad), "gone", LINK_INVALID_MESSAGE);
      }
    });

    it("burns the code too once the link was used", async () => {
      await requestSignIn({ email: "both@example.com" });
      const { token, code } = await readSignInEmail("both@example.com");
      await consumeToken(token);
      await expectAppError(consumeCode({ email: "both@example.com", code }), "validation_failed", CODE_INVALID_MESSAGE);
    });
  });

  describe("consumeCode", () => {
    it("signs in with the emailed code, single-use", async () => {
      await requestSignIn({ email: "code@example.com", redirectTo: "/sgo" });
      const { code, token } = await readSignInEmail("code@example.com");
      const r = await consumeCode({ email: " CODE@example.com", code: `${code.slice(0, 3)} ${code.slice(3)}` });
      expect(r.user.email).toBe("code@example.com");
      expect(r.redirectTo).toBe("/sgo");
      await expectAppError(consumeCode({ email: "code@example.com", code }), "validation_failed");
      await expectAppError(consumeToken(token), "gone");
    });

    it("burns the link after 5 wrong codes, even if the right code comes next", async () => {
      await requestSignIn({ email: "brute@example.com" });
      const { code } = await readSignInEmail("brute@example.com");
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
        await expectAppError(consumeCode({ email: "brute@example.com", code: wrong }), "validation_failed", CODE_INVALID_MESSAGE);
      }
      await expectAppError(consumeCode({ email: "brute@example.com", code }), "validation_failed", CODE_INVALID_MESSAGE);
      const db = await getDb();
      const [link] = await db.select().from(schema.magicLinks).where(eq(schema.magicLinks.email, "brute@example.com"));
      expect(link.consumedAt).not.toBeNull();
      expect(link.attempts).toBe(MAX_CODE_ATTEMPTS);
      expect((await listAuditLogs({ action: "auth.sign_in_locked" })).items).toHaveLength(1);
    });

    it("never lets parallel guesses exceed the attempt allowance", async () => {
      await requestSignIn({ email: "parallel@example.com" });
      const { code } = await readSignInEmail("parallel@example.com");
      const guesses = Array.from({ length: 9 }, (_, i) => String((Number(code) + i + 1) % 1_000_000).padStart(6, "0"));
      await Promise.allSettled(guesses.map((g) => consumeCode({ email: "parallel@example.com", code: g })));
      const db = await getDb();
      const [link] = await db.select().from(schema.magicLinks).where(eq(schema.magicLinks.email, "parallel@example.com"));
      expect(link.attempts).toBeLessThanOrEqual(MAX_CODE_ATTEMPTS);
      expect(link.consumedAt).not.toBeNull();
    });

    it("rejects a code from another address's link (codes are bound to their link)", async () => {
      await requestSignIn({ email: "victim@example.com" });
      await requestSignIn({ email: "attacker@example.com" });
      const attackerCode = (await readSignInEmail("attacker@example.com")).code;
      const victimCode = (await readSignInEmail("victim@example.com")).code;
      if (attackerCode !== victimCode) {
        await expectAppError(consumeCode({ email: "victim@example.com", code: attackerCode }), "validation_failed", CODE_INVALID_MESSAGE);
      }
      // Even an identical code hashes differently per link.
      const db = await getDb();
      const links = await db.select().from(schema.magicLinks);
      expect(hashSignInCode(links[0].id, "123456")).not.toBe(hashSignInCode(links[1].id, "123456"));
    });

    it("rejects the code of a superseded link", async () => {
      await requestSignIn({ email: "super@example.com" });
      const old = await readSignInEmail("super@example.com");
      setTestNow(new Date(T0.getTime() + MS.second));
      await requestSignIn({ email: "super@example.com" });
      const fresh = await readSignInEmail("super@example.com");
      if (old.code !== fresh.code) await expectAppError(consumeCode({ email: "super@example.com", code: old.code }), "validation_failed");
      await expect(consumeCode({ email: "super@example.com", code: fresh.code })).resolves.toBeTruthy();
    });

    it("expires with the link", async () => {
      await requestSignIn({ email: "codelate@example.com" });
      const { code } = await readSignInEmail("codelate@example.com");
      setTestNow(new Date(T0.getTime() + 15 * MS.minute + 1));
      await expectAppError(consumeCode({ email: "codelate@example.com", code }), "validation_failed", CODE_INVALID_MESSAGE);
    });

    it("gives the same error for an address that never asked (no enumeration) and for malformed codes", async () => {
      await expectAppError(consumeCode({ email: "nobody@example.com", code: "123456" }), "validation_failed", CODE_INVALID_MESSAGE);
      await requestSignIn({ email: "fmt@example.com" });
      for (const bad of ["12345", "1234567", "abcdef", ""]) {
        await expectAppError(consumeCode({ email: "fmt@example.com", code: bad }), "validation_failed", CODE_INVALID_MESSAGE);
      }
    });

    it("rate-limits code attempts per address across links", async () => {
      for (let i = 0; i < 10; i++) await expectAppError(consumeCode({ email: "spray@example.com", code: "123456" }), "validation_failed");
      await expectAppError(consumeCode({ email: "spray@example.com", code: "123456" }), "rate_limited");
    });
  });

  describe("platform-admin bootstrap", () => {
    it("grants platform membership to listed addresses, creating the platform organization once", async () => {
      vi.stubEnv("PLATFORM_ADMIN_EMAILS", "Boss@Example.com, second@example.com");
      await requestSignIn({ email: "boss@example.com" });
      const a = await consumeToken((await readSignInEmail("boss@example.com")).token);
      await requestSignIn({ email: "second@example.com" });
      const b = await consumeToken((await readSignInEmail("second@example.com")).token);
      await requestSignIn({ email: "regular@example.com" });
      const c = await consumeToken((await readSignInEmail("regular@example.com")).token);

      const db = await getDb();
      const orgs = await db.select().from(schema.organizations);
      expect(orgs).toHaveLength(1);
      expect(orgs[0].type).toBe("platform");
      const members = await db.select().from(schema.memberships);
      expect(members.map((m) => m.userId).sort()).toEqual([a.user.id, b.user.id].sort());
      expect(members.every((m) => m.role === "owner")).toBe(true);
      expect(members.some((m) => m.userId === c.user.id)).toBe(false);

      // Signing in again does not duplicate anything.
      await requestSignIn({ email: "boss@example.com" });
      await consumeToken((await readSignInEmail("boss@example.com")).token);
      expect(await db.select().from(schema.memberships)).toHaveLength(2);
    });
  });

  it("keeps the credential out of the audit log and stores one email per request", async () => {
    await requestSignIn({ email: "audit@example.com" });
    const { token, code } = await readSignInEmail("audit@example.com");
    await consumeCode({ email: "audit@example.com", code });
    const log = JSON.stringify((await listAuditLogs({})).items);
    expect(log).not.toContain(token);
    expect(log).not.toContain(code);
    expect(await listOutbox({ to: "audit@example.com" })).toHaveLength(1);
  });
});
