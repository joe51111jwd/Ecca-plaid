import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSchemaSql, schema, setDbForTests, type Db } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { emitEvent } from "@/server/events";
import { createEndpoint } from "@/server/webhooks";
import { createTestOrg } from "@/server/webhooks/test-support";
import { truncateAll } from "../../../tests/helpers/db";
import { claimDueJobs, enqueue, getJobStats, runDueJobs, type Job } from "./index";
import { scheduleRecurring } from "./recurring";
import type { JobHandlers } from "./types";

/**
 * The same queue semantics as index.test.ts, but on a real Postgres server with a connection pool, where
 * transactions truly run at the same time (the embedded database serializes them). Skipped unless
 * TEST_DATABASE_URL points at a server on which a throwaway database may be created:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run src/server/jobs/postgres.integration.test.ts
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const { jobs } = schema;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ADMIN_URL)("job queue on real Postgres", () => {
  const dbName = `ecca_queue_test_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database "${dbName}"`);
    await admin.end();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString(), max: 16 });
    db = drizzle(pool, { schema }) as unknown as Db;
    for (const stmt of await generateSchemaSql()) await db.execute(sql.raw(stmt));
    setDbForTests({ db, driver: "pg", close: () => pool.end() });
  });
  afterAll(async () => {
    setDbForTests(null);
    await pool?.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // The pool's sockets close a moment after end() resolves; wait for them instead of killing them.
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
    await truncateAll(db);
    setTestNow("2026-11-18T12:00:00.000Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("creates one job when many connections enqueue the same dedupe key at once", async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => enqueue("pg.race", { i }, { dedupeKey: "race" })));
    expect(results.filter((r) => r.enqueued)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("makes a second enqueue wait for the transaction that holds the key, then honours its outcome", async () => {
    for (const outcome of ["commit", "rollback"] as const) {
      const key = `held-${outcome}`;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let firstEnqueued!: () => void;
      const ready = new Promise<void>((resolve) => (firstEnqueued = resolve));

      const first = db
        .transaction(async (tx) => {
          await enqueue("pg.held", { from: "first" }, { dedupeKey: key }, tx);
          firstEnqueued();
          await held;
          if (outcome === "rollback") throw new Error("rollback");
        })
        .catch((e: Error) => e.message);
      await ready;

      let settled = false;
      const second = enqueue("pg.held", { from: "second" }, { dedupeKey: key }).then((r) => {
        settled = true;
        return r;
      });
      await sleep(250);
      // Still blocked on the first transaction: it has neither inserted a duplicate nor given up.
      expect(settled).toBe(false);

      release();
      await first;
      const result = await second;
      const rows = (await db.select().from(jobs)).filter((j) => j.dedupeKey === key);
      expect(rows).toHaveLength(1);
      if (outcome === "commit") {
        expect(result.enqueued).toBe(false);
        expect(rows[0].payload).toEqual({ from: "first" });
      } else {
        expect(result.enqueued).toBe(true);
        expect(rows[0].payload).toEqual({ from: "second" });
      }
    }
  });

  it("never hands a job to two workers, with many workers claiming concurrently", async () => {
    const total = 300;
    const due = new Date("2026-11-18T11:00:00.000Z");
    await db.insert(jobs).values(Array.from({ length: total }, (_, i) => ({ id: `job_pgclaim_${String(i).padStart(4, "0")}`, type: "pg.claim", payload: { i }, runAt: due, createdAt: due })));
    const worker = async (name: string): Promise<Job[]> => {
      const mine: Job[] = [];
      for (;;) {
        const batch = await claimDueJobs({ limit: 7, workerId: name });
        if (batch.length === 0) return mine;
        mine.push(...batch);
      }
    };
    const perWorker = await Promise.all(Array.from({ length: 12 }, (_, i) => worker(`w${i}`)));
    const ids = perWorker.flat().map((j) => j.id);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
    for (const [i, claimed] of perWorker.entries()) for (const job of claimed) expect(job.lockedBy).toBe(`w${i}`);
    expect((await getJobStats()).byStatus).toMatchObject({ queued: 0, running: total });
  });

  it("skips rows another transaction has locked instead of waiting for them", async () => {
    await enqueue("pg.locked", { n: 1 });
    await enqueue("pg.locked", { n: 2 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${jobs} where payload->>'n' = '1' for update`);
      locked();
      await held;
    });
    await ready;
    const started = Date.now();
    const claimed = await claimDueJobs({ limit: 10, workerId: "w" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(claimed.map((j) => j.payload)).toEqual([{ n: 2 }]);
    release();
    await holder;
    expect((await claimDueJobs({ limit: 10, workerId: "w" })).map((j) => j.payload)).toEqual([{ n: 1 }]);
  });

  it("runs every job exactly once with several runners working the queue together", async () => {
    const total = 120;
    const runs = new Map<string, number>();
    const handlers: JobHandlers = {
      "pg.once": async (_payload, ctx) => {
        runs.set(ctx.jobId, (runs.get(ctx.jobId) ?? 0) + 1);
        await sleep(1);
      },
    };
    for (let i = 0; i < total; i++) await enqueue("pg.once", { i });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => runDueJobs({ handlers, limit: total, workerId: `runner-${i}` })));
    expect(results.reduce((n, r) => n + r.ran, 0)).toBe(total);
    expect(results.reduce((n, r) => n + r.succeeded, 0)).toBe(total);
    expect(runs.size).toBe(total);
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    // The work was actually shared.
    expect(results.filter((r) => r.ran > 0).length).toBeGreaterThan(1);
    expect((await getJobStats()).byStatus).toMatchObject({ queued: 0, running: 0, succeeded: total });
  });

  it("schedules a recurring period once across many instances", async () => {
    const recurring = [
      { type: "pg.sweep", everyMs: 60_000 },
      { type: "pg.daily", everyMs: 86_400_000 },
    ];
    const results = await Promise.all(Array.from({ length: 20 }, () => scheduleRecurring({ recurring })));
    expect(results.reduce((n, r) => n + r.scheduled, 0)).toBe(2);
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("commits or rolls back an event with its deliveries and jobs", async () => {
    const orgId = await createTestOrg();
    await createEndpoint({ orgId, url: "http://127.0.0.1:9/hook" });
    await expect(
      db.transaction(async (tx) => {
        await emitEvent({ orgId, type: "verification.decided", payload: {}, mode: "test" }, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.select().from(schema.events)).toHaveLength(0);
    expect(await db.select().from(schema.webhookDeliveries)).toHaveLength(0);
    expect(await db.select().from(jobs)).toHaveLength(0);

    await db.transaction(async (tx) => {
      await emitEvent({ orgId, type: "verification.decided", payload: {}, mode: "test" }, tx);
    });
    expect(await db.select().from(schema.events)).toHaveLength(1);
    expect(await db.select().from(schema.webhookDeliveries)).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});
