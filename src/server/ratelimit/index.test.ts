import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { MS, setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { useTestDb } from "../../../tests/helpers/db";
import { RATE_LIMIT_MAX_WINDOW_MS, enforceRateLimit, purgeExpiredRateLimits, rateLimit, rateLimitHeaders, rateLimitStorageKey, resetRateLimit } from "./index";

const T0 = new Date("2026-12-01T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("rate limiter", () => {
  const t = useTestDb();

  beforeEach(() => setTestNow(T0));
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
  });

  const rows = () => t.db.select().from(schema.rateLimits);
  const rowFor = async (key: string) => (await t.db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, rateLimitStorageKey(key))))[0];

  it("allows up to the limit, then denies, reporting remaining and reset time", async () => {
    const opts = { limit: 3, windowMs: MS.minute };
    expect(await rateLimit("k", opts)).toEqual({ allowed: true, limit: 3, remaining: 2, resetAt: at(MS.minute), retryAfterSeconds: 0 });
    setTestNow(at(10_000));
    expect(await rateLimit("k", opts)).toMatchObject({ allowed: true, remaining: 1, resetAt: at(MS.minute) });
    expect(await rateLimit("k", opts)).toMatchObject({ allowed: true, remaining: 0, resetAt: at(MS.minute) });
    expect(await rateLimit("k", opts)).toEqual({ allowed: false, limit: 3, remaining: 0, resetAt: at(MS.minute), retryAfterSeconds: 50 });
  });

  it("keeps separate counts per key", async () => {
    const opts = { limit: 1, windowMs: MS.minute };
    expect((await rateLimit("a", opts)).allowed).toBe(true);
    expect((await rateLimit("b", opts)).allowed).toBe(true);
    expect((await rateLimit("a", opts)).allowed).toBe(false);
    expect((await rateLimit("b", opts)).allowed).toBe(false);
    expect(await rows()).toHaveLength(2);
  });

  it("starts a new window exactly when the old one ends, not a millisecond earlier", async () => {
    const opts = { limit: 2, windowMs: MS.minute };
    await rateLimit("k", opts);
    await rateLimit("k", opts);
    setTestNow(at(MS.minute - 1));
    expect(await rateLimit("k", opts)).toMatchObject({ allowed: false, resetAt: at(MS.minute), retryAfterSeconds: 1 });
    setTestNow(at(MS.minute));
    expect(await rateLimit("k", opts)).toEqual({ allowed: true, limit: 2, remaining: 1, resetAt: at(2 * MS.minute), retryAfterSeconds: 0 });
    expect(await rowFor("k")).toMatchObject({ count: 1, windowStart: at(MS.minute) });
  });

  it("denied requests are counted but never extend the window", async () => {
    const opts = { limit: 1, windowMs: MS.minute };
    await rateLimit("k", opts);
    for (let i = 1; i <= 5; i++) {
      setTestNow(at(i * 5_000));
      expect(await rateLimit("k", opts)).toMatchObject({ allowed: false, resetAt: at(MS.minute) });
    }
    expect(await rowFor("k")).toMatchObject({ count: 6, windowStart: T0 });
    setTestNow(at(MS.minute + 1));
    expect((await rateLimit("k", opts)).allowed).toBe(true);
  });

  it("a long idle gap simply starts a fresh window", async () => {
    const opts = { limit: 2, windowMs: MS.second };
    await rateLimit("k", opts);
    await rateLimit("k", opts);
    setTestNow(at(3 * MS.day));
    expect(await rateLimit("k", opts)).toMatchObject({ allowed: true, remaining: 1, resetAt: at(3 * MS.day + MS.second) });
  });

  it("never grants more than the limit to concurrent callers", async () => {
    const opts = { limit: 10, windowMs: MS.minute };
    const results = await Promise.all(Array.from({ length: 60 }, () => rateLimit("burst", opts)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(50);
    expect(results.map((r) => r.remaining).sort((a, b) => b - a).slice(0, 10)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(await rowFor("burst")).toMatchObject({ count: 60 });
  });

  it("holds the limit for concurrent callers racing across a window rollover", async () => {
    const opts = { limit: 4, windowMs: MS.minute };
    await Promise.all(Array.from({ length: 9 }, () => rateLimit("roll", opts)));
    setTestNow(at(MS.minute));
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit("roll", opts)));
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    expect(await rowFor("roll")).toMatchObject({ count: 30, windowStart: at(MS.minute) });
  });

  it("holds the limit for concurrent callers on many keys at once", async () => {
    const opts = { limit: 3, windowMs: MS.minute };
    const calls = Array.from({ length: 80 }, (_, i) => rateLimit(`key-${i % 4}`, opts).then((r) => ({ key: i % 4, allowed: r.allowed })));
    const results = await Promise.all(calls);
    for (let k = 0; k < 4; k++) expect(results.filter((r) => r.key === k && r.allowed)).toHaveLength(3);
  });

  it("does not reset a window that appears to start in the future (clock skew between instances)", async () => {
    const opts = { limit: 2, windowMs: MS.minute };
    await rateLimit("skew", opts);
    setTestNow(at(-5_000));
    expect(await rateLimit("skew", opts)).toMatchObject({ allowed: true, remaining: 0, resetAt: at(MS.minute) });
    expect(await rateLimit("skew", opts)).toMatchObject({ allowed: false, retryAfterSeconds: 65 });
  });

  it("stores only a hash of the key, never the email or IP inside it", async () => {
    const key = "magic-link:email:parent@example.com:ip:203.0.113.7";
    await rateLimit(key, { limit: 5, windowMs: MS.minute });
    const [row] = await rows();
    expect(row.key).toBe(rateLimitStorageKey(key));
    expect(row.key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("parent@example.com");
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(rateLimitStorageKey("a")).not.toBe(rateLimitStorageKey("b"));
  });

  it("uses a keyed hash, so a stored key cannot be reversed by hashing candidate IPs or emails", async () => {
    const key = "magic-link:ip:203.0.113.7";
    const stored = rateLimitStorageKey(key);
    // Unkeyed digests of the limiter key (with or without a fixed prefix) are what an attacker would try.
    for (const guess of [key, `ecca-ratelimit-v1:${key}`, `ecca-ratelimit-v2:${key}`]) {
      expect(stored).not.toBe(createHash("sha256").update(guess).digest("hex"));
    }
    expect(rateLimitStorageKey(key)).toBe(stored);
  });

  it("cannot overflow the counter", async () => {
    await rateLimit("flood", { limit: 1, windowMs: MS.minute });
    await t.db.update(schema.rateLimits).set({ count: 2_147_483_647 });
    expect(await rateLimit("flood", { limit: 1, windowMs: MS.minute })).toMatchObject({ allowed: false, remaining: 0 });
    expect(await rowFor("flood")).toMatchObject({ count: 2_147_483_647 });
  });

  it("rejects nonsensical configuration instead of silently allowing everything", async () => {
    const bad = [
      { limit: 0, windowMs: 1000 },
      { limit: -1, windowMs: 1000 },
      { limit: 1.5, windowMs: 1000 },
      { limit: Number.NaN, windowMs: 1000 },
      { limit: 1, windowMs: 0 },
      { limit: 1, windowMs: -1000 },
      { limit: 1, windowMs: 0.5 },
      { limit: 1, windowMs: RATE_LIMIT_MAX_WINDOW_MS + 1 },
      { limit: Number.POSITIVE_INFINITY, windowMs: 1000 },
    ];
    for (const opts of bad) await expect(rateLimit("k", opts), JSON.stringify(opts)).rejects.toMatchObject({ code: "internal" });
    await expect(rateLimit("", { limit: 1, windowMs: 1000 })).rejects.toMatchObject({ code: "internal" });
    await expect(rateLimit("x".repeat(513), { limit: 1, windowMs: 1000 })).rejects.toMatchObject({ code: "internal" });
    expect(await rows()).toHaveLength(0);
    expect((await rateLimit("k", { limit: 1, windowMs: RATE_LIMIT_MAX_WINDOW_MS })).allowed).toBe(true);
  });

  it("counts inside a caller's transaction and is undone with it", async () => {
    const opts = { limit: 1, windowMs: MS.minute };
    await expect(
      t.db.transaction(async (tx) => {
        expect((await rateLimit("tx", opts, tx)).allowed).toBe(true);
        expect((await rateLimit("tx", opts, tx)).allowed).toBe(false);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await rows()).toHaveLength(0);
  });

  describe("enforceRateLimit", () => {
    it("returns the result while within the limit", async () => {
      expect(await enforceRateLimit("k", { limit: 2, windowMs: MS.minute })).toMatchObject({ allowed: true, remaining: 1 });
    });

    it("throws a 429 AppError with a human message and machine details", async () => {
      const opts = { limit: 1, windowMs: 15 * MS.minute };
      await enforceRateLimit("k", opts);
      setTestNow(at(3 * MS.minute + 20_000));
      const err = await enforceRateLimit("k", opts).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: "rate_limited",
        status: 429,
        message: "Too many attempts. Please try again in 12 minutes.",
        details: { retryAfterSeconds: 700, resetAt: at(15 * MS.minute).toISOString(), limit: 1 },
      });
    });

    it.each([
      [30 * MS.second, "30 seconds"],
      [MS.second, "1 second"],
      [MS.minute, "1 minute"],
      [90 * MS.second, "2 minutes"],
      [MS.hour, "1 hour"],
      [5 * MS.hour + 1, "6 hours"],
      [3 * MS.day, "3 days"],
    ])("phrases a %i ms wait as %s", async (windowMs, phrase) => {
      const opts = { limit: 1, windowMs, message: "Too many sign-in emails." };
      await enforceRateLimit("k", opts);
      await expect(enforceRateLimit("k", opts)).rejects.toThrow(`Too many sign-in emails. Please try again in ${phrase}.`);
    });
  });

  it("builds RateLimit headers, adding Retry-After only when denied", async () => {
    const opts = { limit: 1, windowMs: MS.minute };
    const ok = await rateLimit("k", opts);
    expect(rateLimitHeaders(ok)).toEqual({ "RateLimit-Limit": "1", "RateLimit-Remaining": "0", "RateLimit-Reset": "60" });
    setTestNow(at(45_500));
    const denied = await rateLimit("k", opts);
    expect(rateLimitHeaders(denied)).toEqual({ "RateLimit-Limit": "1", "RateLimit-Remaining": "0", "RateLimit-Reset": "15", "Retry-After": "15" });
  });

  it("resetRateLimit forgets one key only", async () => {
    const opts = { limit: 1, windowMs: MS.minute };
    await rateLimit("a", opts);
    await rateLimit("b", opts);
    await resetRateLimit("a");
    await resetRateLimit("never-seen");
    expect((await rateLimit("a", opts)).allowed).toBe(true);
    expect((await rateLimit("b", opts)).allowed).toBe(false);
  });

  describe("purgeExpiredRateLimits", () => {
    it("removes only rows that are expired for every possible window", async () => {
      await rateLimit("old", { limit: 5, windowMs: MS.minute });
      setTestNow(at(MS.hour));
      await rateLimit("week-long", { limit: 5, windowMs: RATE_LIMIT_MAX_WINDOW_MS });
      setTestNow(at(RATE_LIMIT_MAX_WINDOW_MS - 1));
      expect(await purgeExpiredRateLimits()).toBe(0);
      setTestNow(at(RATE_LIMIT_MAX_WINDOW_MS));
      expect(await purgeExpiredRateLimits()).toBe(1);
      expect(await rowFor("old")).toBeUndefined();
      expect(await rowFor("week-long")).toBeDefined();
      // The surviving week-long window is still enforced after the purge.
      expect(await rateLimit("week-long", { limit: 1, windowMs: RATE_LIMIT_MAX_WINDOW_MS })).toMatchObject({ allowed: false });
      expect(await purgeExpiredRateLimits()).toBe(0);
    });

    it("is a no-op on an empty table", async () => {
      expect(await purgeExpiredRateLimits()).toBe(0);
    });
  });

  describe("ECCA_DISABLE_RATE_LIMITS (test/demo switch)", () => {
    it("lets everything through without writing rows", async () => {
      vi.stubEnv("ECCA_DISABLE_RATE_LIMITS", "true");
      for (let i = 0; i < 5; i++) {
        expect(await rateLimit("k", { limit: 1, windowMs: MS.minute })).toEqual({ allowed: true, limit: 1, remaining: 1, resetAt: at(MS.minute), retryAfterSeconds: 0 });
      }
      await expect(enforceRateLimit("k", { limit: 1, windowMs: MS.minute })).resolves.toMatchObject({ allowed: true });
      expect(await rows()).toHaveLength(0);
    });

    it("still validates configuration", async () => {
      vi.stubEnv("ECCA_DISABLE_RATE_LIMITS", "1");
      await expect(rateLimit("k", { limit: 0, windowMs: MS.minute })).rejects.toMatchObject({ code: "internal" });
    });

    it("is ignored for any other value", async () => {
      vi.stubEnv("ECCA_DISABLE_RATE_LIMITS", "false");
      await rateLimit("k", { limit: 1, windowMs: MS.minute });
      expect((await rateLimit("k", { limit: 1, windowMs: MS.minute })).allowed).toBe(false);
    });

    it("is never honoured in production", async () => {
      vi.stubEnv("ECCA_DISABLE_RATE_LIMITS", "true");
      vi.stubEnv("NODE_ENV", "production");
      expect((await rateLimit("k", { limit: 1, windowMs: MS.minute })).allowed).toBe(true);
      expect((await rateLimit("k", { limit: 1, windowMs: MS.minute })).allowed).toBe(false);
      expect(await rows()).toHaveLength(1);
    });
  });
});
