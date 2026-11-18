import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateSchemaSql, schema, setDbForTests, type Db } from "@/db/client";
import { MS, setTestNow } from "@/lib/clock";
import { RATE_LIMIT_MAX_WINDOW_MS, purgeExpiredRateLimits, rateLimit, rateLimitStorageKey } from "./index";

/**
 * The limiter's one hard promise — concurrent callers are never granted more than the limit — checked on a
 * real Postgres server with a connection pool, where the upserts truly race (the embedded test database
 * runs statements one at a time). Skipped unless TEST_DATABASE_URL points at a server on which a throwaway
 * database may be created:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run src/server/ratelimit/postgres.integration.test.ts
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-12-01T12:00:00.000Z");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ADMIN_URL)("rate limiter on real Postgres", () => {
  const dbName = `ecca_ratelimit_test_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database "${dbName}"`);
    await admin.end();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString(), max: 24 });
    db = drizzle(pool, { schema }) as unknown as Db;
    for (const stmt of await generateSchemaSql()) await db.execute(sql.raw(stmt));
    setDbForTests({ db, driver: "pg", close: () => pool.end() });
  });

  afterAll(async () => {
    setDbForTests(null);
    await pool?.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // The pool's sockets close a moment after end() resolves.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.query(`drop database if exists "${dbName}"`);
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "55006" || attempt >= 100) throw e;
        await sleep(50);
      }
    }
    await admin.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table rate_limits`);
    setTestNow(T0);
  });
  afterEach(() => setTestNow(null));

  const rowFor = async (key: string) => (await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, rateLimitStorageKey(key))))[0];

  it("grants exactly the limit to 300 callers racing for a brand-new key", async () => {
    const results = await Promise.all(Array.from({ length: 300 }, () => rateLimit("race:new", { limit: 25, windowMs: MS.minute })));
    expect(results.filter((r) => r.allowed)).toHaveLength(25);
    expect(new Set(results.filter((r) => r.allowed).map((r) => r.remaining)).size).toBe(25);
    expect(await rowFor("race:new")).toMatchObject({ count: 300, windowStart: T0 });
  });

  it("grants exactly the limit to callers racing across a window rollover", async () => {
    await Promise.all(Array.from({ length: 40 }, () => rateLimit("race:rollover", { limit: 10, windowMs: MS.minute })));
    setTestNow(new Date(T0.getTime() + MS.minute));
    const results = await Promise.all(Array.from({ length: 200 }, () => rateLimit("race:rollover", { limit: 10, windowMs: MS.minute })));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(await rowFor("race:rollover")).toMatchObject({ count: 200, windowStart: new Date(T0.getTime() + MS.minute) });
  });

  it("keeps keys independent under load", async () => {
    const calls = Array.from({ length: 400 }, (_, i) => rateLimit(`race:key:${i % 8}`, { limit: 7, windowMs: MS.minute }).then((r) => ({ key: i % 8, allowed: r.allowed })));
    const results = await Promise.all(calls);
    for (let k = 0; k < 8; k++) expect(results.filter((r) => r.key === k && r.allowed)).toHaveLength(7);
  });

  it("stays correct while the purge runs at the same time", async () => {
    await rateLimit("race:stale", { limit: 1, windowMs: MS.minute });
    setTestNow(new Date(T0.getTime() + RATE_LIMIT_MAX_WINDOW_MS));
    const [purged, ...results] = await Promise.all([purgeExpiredRateLimits(), ...Array.from({ length: 100 }, () => rateLimit("race:live", { limit: 5, windowMs: MS.minute }))]);
    expect(purged).toBe(1);
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await rowFor("race:stale")).toBeUndefined();
  });
});
