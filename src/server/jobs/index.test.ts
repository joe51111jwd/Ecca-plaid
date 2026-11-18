import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { addMs, MS, setTestNow } from "@/lib/clock";
import { useTestDb } from "../../../tests/helpers/db";
import {
  claimDueJobs,
  DEFAULT_MAX_ATTEMPTS,
  enqueue,
  enqueueOnce,
  getJob,
  getJobStats,
  listJobs,
  MAX_LAST_ERROR_LENGTH,
  purgeSucceededJobs,
  requeueStuckJobs,
  RETRY_SCHEDULE_MS,
  retryDelayMs,
  retryJob,
  runDueJobs,
  runJob,
} from "./index";
import type { JobHandlers } from "./types";

const T0 = new Date("2026-11-18T12:00:00.000Z");
const { jobs } = schema;

describe("job queue", () => {
  const t = useTestDb();

  beforeEach(() => {
    setTestNow(T0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  const allRows = () => t.db.select().from(jobs);

  describe("enqueue", () => {
    it("stores a queued job with defaults taken from the clock", async () => {
      const res = await enqueue("demo.work", { a: 1, nested: { b: [1, 2] } });
      expect(res.enqueued).toBe(true);
      expect(res.id).toMatch(/^job_/);
      const job = await getJob(res.id);
      expect(job).toMatchObject({
        type: "demo.work",
        payload: { a: 1, nested: { b: [1, 2] } },
        status: "queued",
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        dedupeKey: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        completedAt: null,
      });
      expect(job.runAt).toEqual(T0);
      expect(job.createdAt).toEqual(T0);
    });

    it("honours runAt and maxAttempts and defaults the payload to {}", async () => {
      const runAt = addMs(T0, MS.hour);
      const { id } = await enqueue("demo.later", undefined, { runAt, maxAttempts: 2 });
      const job = await getJob(id);
      expect(job.runAt).toEqual(runAt);
      expect(job.maxAttempts).toBe(2);
      expect(job.payload).toEqual({});
    });

    it("stores exactly what JSON round-trips (dates become strings, undefined is dropped)", async () => {
      const { id } = await enqueue("demo.json", { when: new Date("2027-01-01T00:00:00Z"), gone: undefined });
      expect((await getJob(id)).payload).toEqual({ when: "2027-01-01T00:00:00.000Z" });
    });

    it("rejects bad input", async () => {
      await expect(enqueue("", {})).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("has space", {})).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("x", {}, { maxAttempts: 0 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("x", {}, { maxAttempts: 1.5 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("x", {}, { runAt: new Date("nope") })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("x", {}, { dedupeKey: "" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("x", [] as unknown as Record<string, unknown>)).rejects.toMatchObject({ code: "validation_failed" });
      await expect(enqueue("x", { big: BigInt(1) })).rejects.toMatchObject({ code: "validation_failed" });
      const loop: Record<string, unknown> = {};
      loop.self = loop;
      await expect(enqueue("x", loop)).rejects.toMatchObject({ code: "validation_failed" });
      expect(await allRows()).toHaveLength(0);
    });
  });

  describe("dedupe", () => {
    it("is a no-op while a job with the key is queued and returns the existing id", async () => {
      const first = await enqueue("demo.once", { n: 1 }, { dedupeKey: "k1" });
      const second = await enqueue("demo.once", { n: 2 }, { dedupeKey: "k1" });
      expect(first.enqueued).toBe(true);
      expect(second).toEqual({ id: first.id, enqueued: false });
      const rows = await allRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ n: 1 });
    });

    it("does not confuse different keys or jobs without a key", async () => {
      await enqueue("demo.once", {}, { dedupeKey: "a" });
      await enqueue("demo.once", {}, { dedupeKey: "b" });
      await enqueue("demo.once", {});
      await enqueue("demo.once", {});
      expect(await allRows()).toHaveLength(4);
    });

    it("is a no-op while the job is running or waiting for a retry, and allowed again once it finished", async () => {
      const handlers: JobHandlers = {
        "demo.once": async (payload) => {
          if (payload.fail) throw new Error("synthetic failure");
        },
      };
      const { id } = await enqueue("demo.once", { fail: true }, { dedupeKey: "k" });
      const [claimed] = await claimDueJobs({ limit: 1, workerId: "w1" });
      expect(claimed.status).toBe("running");
      expect((await enqueue("demo.once", {}, { dedupeKey: "k" })).enqueued).toBe(false);

      expect((await runJob(claimed, { handlers })).outcome).toBe("retry");
      expect((await getJob(id)).status).toBe("queued");
      expect((await enqueue("demo.once", {}, { dedupeKey: "k" })).enqueued).toBe(false);

      await t.db.update(jobs).set({ payload: {} }).where(eq(jobs.id, id));
      setTestNow(addMs(T0, MS.day));
      expect(await runDueJobs({ handlers })).toEqual({ ran: 1, succeeded: 1, failed: 0 });
      const again = await enqueue("demo.once", {}, { dedupeKey: "k" });
      expect(again.enqueued).toBe(true);
      expect(again.id).not.toBe(id);
    });

    it("allows a new job after the previous one with the key died", async () => {
      const { id } = await enqueue("demo.missing", {}, { dedupeKey: "k" });
      await runDueJobs({ handlers: {} });
      expect((await getJob(id)).status).toBe("dead");
      expect((await enqueue("demo.missing", {}, { dedupeKey: "k" })).enqueued).toBe(true);
    });

    it("creates exactly one job when many callers race on the same key", async () => {
      const results = await Promise.all(Array.from({ length: 25 }, (_, i) => enqueue("demo.race", { i }, { dedupeKey: "race" })));
      expect(results.filter((r) => r.enqueued)).toHaveLength(1);
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(await allRows()).toHaveLength(1);
    });

    it("keeps racing callers on different keys independent", async () => {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => enqueue("demo.race", {}, { dedupeKey: `key-${i % 4}` })));
      expect(results.filter((r) => r.enqueued)).toHaveLength(4);
      expect(await allRows()).toHaveLength(4);
    });

    it("enqueueOnce is a no-op for a key in any status, even after the job finished", async () => {
      const handlers: JobHandlers = { "demo.period": async () => {} };
      const first = await enqueueOnce("demo.period", {}, { dedupeKey: "period:1" });
      expect(first.enqueued).toBe(true);
      await runDueJobs({ handlers });
      expect((await getJob(first.id)).status).toBe("succeeded");
      expect(await enqueueOnce("demo.period", {}, { dedupeKey: "period:1" })).toEqual({ id: first.id, enqueued: false });
      expect((await enqueueOnce("demo.period", {}, { dedupeKey: "period:2" })).enqueued).toBe(true);
      const racing = await Promise.all(Array.from({ length: 10 }, () => enqueueOnce("demo.period", {}, { dedupeKey: "period:3" })));
      expect(racing.filter((r) => r.enqueued)).toHaveLength(1);
      expect(await allRows()).toHaveLength(3);
    });
  });

  describe("transactions", () => {
    it("rolls the job back with the caller's transaction", async () => {
      await expect(
        t.db.transaction(async (tx) => {
          await enqueue("demo.tx", { plain: true }, {}, tx);
          await enqueue("demo.tx", { deduped: true }, { dedupeKey: "tx-key" }, tx);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await allRows()).toHaveLength(0);
      // The rolled-back key must not block a later enqueue.
      expect((await enqueue("demo.tx", {}, { dedupeKey: "tx-key" })).enqueued).toBe(true);
    });

    it("commits the job with the caller's transaction and dedupes inside it", async () => {
      const ids = await t.db.transaction(async (tx) => {
        const a = await enqueue("demo.tx", {}, { dedupeKey: "tx-key" }, tx);
        const b = await enqueue("demo.tx", {}, { dedupeKey: "tx-key" }, tx);
        expect(b).toEqual({ id: a.id, enqueued: false });
        const c = await enqueue("demo.tx", {}, {}, tx);
        return [a.id, c.id];
      });
      expect((await allRows()).map((r) => r.id).sort()).toEqual([...ids].sort());
    });
  });

  describe("claimDueJobs", () => {
    it("claims only due jobs, oldest runAt first, and marks them running", async () => {
      const late = await enqueue("demo.c", { n: "late" }, { runAt: addMs(T0, -MS.minute) });
      const early = await enqueue("demo.c", { n: "early" }, { runAt: addMs(T0, -MS.hour) });
      const future = await enqueue("demo.c", { n: "future" }, { runAt: addMs(T0, 1) });
      const exact = await enqueue("demo.c", { n: "exact" }, { runAt: T0 });

      const claimed = await claimDueJobs({ limit: 10, workerId: "worker-a" });
      expect(claimed.map((j) => j.id)).toEqual([early.id, late.id, exact.id]);
      for (const job of claimed) {
        expect(job).toMatchObject({ status: "running", attempts: 1, lockedBy: "worker-a" });
        expect(job.lockedAt).toEqual(T0);
      }
      expect((await getJob(future.id)).status).toBe("queued");
      expect(await claimDueJobs({ limit: 10, workerId: "worker-b" })).toEqual([]);
    });

    it("is first in, first out for jobs that are due at the same instant", async () => {
      // The clock is frozen, so every job below has the same runAt and createdAt.
      for (let i = 0; i < 12; i++) await enqueue("demo.fifo", { i });
      const claimed = await claimDueJobs({ limit: 12, workerId: "w" });
      expect(claimed.map((j) => j.payload.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect((await listJobs({ type: "demo.fifo" })).map((j) => j.payload.i)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    });

    it("respects the limit", async () => {
      for (let i = 0; i < 5; i++) await enqueue("demo.c", { i }, { runAt: addMs(T0, -i * 1000) });
      expect(await claimDueJobs({ limit: 2, workerId: "w" })).toHaveLength(2);
      expect(await claimDueJobs({ limit: 2, workerId: "w" })).toHaveLength(2);
      expect(await claimDueJobs({ limit: 2, workerId: "w" })).toHaveLength(1);
    });

    it("never hands the same job to two workers claiming at once", async () => {
      for (let i = 0; i < 10; i++) await enqueue("demo.c", { i });
      const batches = await Promise.all([
        claimDueJobs({ limit: 4, workerId: "a" }),
        claimDueJobs({ limit: 4, workerId: "b" }),
        claimDueJobs({ limit: 4, workerId: "c" }),
        claimDueJobs({ limit: 4, workerId: "d" }),
      ]);
      const ids = batches.flat().map((j) => j.id);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      for (const [i, batch] of batches.entries()) for (const job of batch) expect(job.lockedBy).toBe("abcd"[i]);
    });

    it("validates its input", async () => {
      await expect(claimDueJobs({ limit: 0, workerId: "w" })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(claimDueJobs({ limit: 1, workerId: "" })).rejects.toMatchObject({ code: "validation_failed" });
    });
  });

  describe("runJob", () => {
    it("passes payload and context to the handler and marks the job succeeded", async () => {
      const seen: unknown[] = [];
      const handlers: JobHandlers = {
        "demo.run": async (payload, ctx) => {
          seen.push({ payload, ctx });
        },
      };
      const { id } = await enqueue("demo.run", { hello: "world" });
      const [job] = await claimDueJobs({ limit: 1, workerId: "w" });
      setTestNow(addMs(T0, 5000));
      expect(await runJob(job, { handlers })).toEqual({ jobId: id, type: "demo.run", outcome: "succeeded" });
      expect(seen).toEqual([{ payload: { hello: "world" }, ctx: { jobId: id, attempt: 1 } }]);
      const done = await getJob(id);
      expect(done).toMatchObject({ status: "succeeded", attempts: 1, lockedAt: null, lockedBy: null, lastError: null });
      expect(done.completedAt).toEqual(addMs(T0, 5000));
    });

    it("refuses a job that was not claimed", async () => {
      const { id } = await enqueue("demo.run", {});
      await expect(runJob(await getJob(id), { handlers: {} })).rejects.toMatchObject({ code: "conflict" });
      expect((await getJob(id)).status).toBe("queued");
    });

    it("retries on the fixed backoff schedule and dead-letters after maxAttempts", async () => {
      expect(RETRY_SCHEDULE_MS).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
      const attempts: number[] = [];
      const handlers: JobHandlers = {
        "demo.flaky": async (_payload, ctx) => {
          attempts.push(ctx.attempt);
          throw new Error(`synthetic failure #${ctx.attempt}`);
        },
      };
      const { id } = await enqueue("demo.flaky", {});
      let clock = T0;
      for (const [i, delay] of RETRY_SCHEDULE_MS.slice(0, DEFAULT_MAX_ATTEMPTS - 1).entries()) {
        expect(await runDueJobs({ handlers })).toEqual({ ran: 1, succeeded: 0, failed: 1 });
        const job = await getJob(id);
        expect(job).toMatchObject({ status: "queued", attempts: i + 1, lockedAt: null, lockedBy: null, completedAt: null });
        expect(job.lastError).toContain(`synthetic failure #${i + 1}`);
        expect(job.runAt).toEqual(addMs(clock, delay));

        // One millisecond early it is not due yet.
        setTestNow(addMs(clock, delay - 1));
        expect(await runDueJobs({ handlers })).toEqual({ ran: 0, succeeded: 0, failed: 0 });
        clock = addMs(clock, delay);
        setTestNow(clock);
      }
      expect(await runDueJobs({ handlers })).toEqual({ ran: 1, succeeded: 0, failed: 1 });
      const dead = await getJob(id);
      expect(dead).toMatchObject({ status: "dead", attempts: DEFAULT_MAX_ATTEMPTS, lockedAt: null, lockedBy: null });
      expect(dead.lastError).toContain(`synthetic failure #${DEFAULT_MAX_ATTEMPTS}`);
      expect(dead.completedAt).toEqual(clock);
      expect(attempts).toEqual([1, 2, 3, 4, 5]);

      // Dead jobs are never picked up again.
      setTestNow(addMs(clock, 30 * MS.day));
      expect(await runDueJobs({ handlers })).toEqual({ ran: 0, succeeded: 0, failed: 0 });
    });

    it("repeats the last delay once the schedule is exhausted", () => {
      expect(retryDelayMs(1)).toBe(30 * MS.second);
      expect(retryDelayMs(2)).toBe(2 * MS.minute);
      expect(retryDelayMs(3)).toBe(10 * MS.minute);
      expect(retryDelayMs(4)).toBe(MS.hour);
      expect(retryDelayMs(5)).toBe(6 * MS.hour);
      expect(retryDelayMs(6)).toBe(6 * MS.hour);
      expect(retryDelayMs(40)).toBe(6 * MS.hour);
      expect(retryDelayMs(0)).toBe(30 * MS.second);
    });

    it("uses the 6h step for jobs with more than five attempts", async () => {
      const handlers: JobHandlers = {
        "demo.flaky": async () => {
          throw new Error("synthetic failure");
        },
      };
      const { id } = await enqueue("demo.flaky", {}, { maxAttempts: 7 });
      let clock = T0;
      for (const delay of [...RETRY_SCHEDULE_MS, 6 * MS.hour]) {
        await runDueJobs({ handlers });
        expect((await getJob(id)).runAt).toEqual(addMs(clock, delay));
        clock = addMs(clock, delay);
        setTestNow(clock);
      }
      await runDueJobs({ handlers });
      expect(await getJob(id)).toMatchObject({ status: "dead", attempts: 7 });
    });

    it("dies on the first failure when maxAttempts is 1", async () => {
      const { id } = await enqueue("demo.flaky", {}, { maxAttempts: 1 });
      const res = await runDueJobs({
        handlers: {
          "demo.flaky": async () => {
            throw new Error("synthetic failure");
          },
        },
      });
      expect(res).toEqual({ ran: 1, succeeded: 0, failed: 1 });
      expect((await getJob(id)).status).toBe("dead");
    });

    it("truncates a long error and survives non-Error throwables and NUL bytes", async () => {
      const handlers: JobHandlers = {
        "demo.long": async () => {
          throw new Error("x".repeat(10_000));
        },
        "demo.string": async () => {
          throw "plain string \u0000 with a NUL";
        },
        "demo.object": async () => {
          throw { code: "E_SYNTHETIC", detail: 42 };
        },
        "demo.sync": (() => {
          throw new Error("thrown synchronously");
        }) as unknown as JobHandlers[string],
      };
      const long = await enqueue("demo.long", {});
      const str = await enqueue("demo.string", {});
      const obj = await enqueue("demo.object", {});
      const sync = await enqueue("demo.sync", {});
      expect(await runDueJobs({ handlers })).toEqual({ ran: 4, succeeded: 0, failed: 4 });
      const longError = (await getJob(long.id)).lastError!;
      expect(longError).toHaveLength(MAX_LAST_ERROR_LENGTH);
      expect(longError.endsWith("…")).toBe(true);
      expect((await getJob(str.id)).lastError).toBe("plain string  with a NUL");
      expect((await getJob(obj.id)).lastError).toBe('{"code":"E_SYNTHETIC","detail":42}');
      expect((await getJob(sync.id)).lastError).toContain("thrown synchronously");
    });

    it("dead-letters an unknown job type immediately with a clear error", async () => {
      const { id } = await enqueue("demo.nobody-home", { a: 1 });
      const [job] = await claimDueJobs({ limit: 1, workerId: "w" });
      const res = await runJob(job, { handlers: { "demo.other": async () => {} } });
      expect(res.outcome).toBe("dead");
      const dead = await getJob(id);
      expect(dead).toMatchObject({ status: "dead", attempts: 1, lockedBy: null });
      expect(dead.lastError).toBe('No handler is registered for job type "demo.nobody-home"');
      expect(dead.completedAt).toEqual(T0);
    });

    it("does not treat inherited object properties as handlers", async () => {
      const { id } = await enqueue("constructor", {});
      await runDueJobs({ handlers: {} });
      expect(await getJob(id)).toMatchObject({ status: "dead", lastError: 'No handler is registered for job type "constructor"' });
    });

    it("fails the attempt when the handler exceeds the time limit", async () => {
      const { id } = await enqueue("demo.hang", {});
      const [job] = await claimDueJobs({ limit: 1, workerId: "w" });
      const res = await runJob(job, { handlers: { "demo.hang": () => new Promise<void>(() => {}) }, timeoutMs: 25 });
      expect(res.outcome).toBe("retry");
      expect(res.error).toContain("Job timed out after 25 ms");
      expect(await getJob(id)).toMatchObject({ status: "queued", attempts: 1 });
    });

    it("records nothing when the lock was taken over while the handler ran", async () => {
      const { id } = await enqueue("demo.slow", {});
      const [first] = await claimDueJobs({ limit: 1, workerId: "crashed" });
      setTestNow(addMs(T0, MS.hour));
      expect(await requeueStuckJobs({ olderThanMs: 15 * MS.minute })).toEqual({ requeued: 1, dead: 0 });
      const [second] = await claimDueJobs({ limit: 1, workerId: "replacement" });
      expect(second).toMatchObject({ id, attempts: 2, lockedBy: "replacement" });

      // The first worker comes back to life and reports late: both success and failure are ignored.
      expect((await runJob(first, { handlers: { "demo.slow": async () => {} } })).outcome).toBe("lost");
      expect(
        (
          await runJob(first, {
            handlers: {
              "demo.slow": async () => {
                throw new Error("late failure");
              },
            },
          })
        ).outcome,
      ).toBe("lost");
      expect(await getJob(id)).toMatchObject({ status: "running", attempts: 2, lockedBy: "replacement" });
      expect((await runJob(second, { handlers: { "demo.slow": async () => {} } })).outcome).toBe("succeeded");
    });
  });

  describe("runDueJobs", () => {
    it("runs due jobs in order and reports the tallies", async () => {
      const order: string[] = [];
      const handlers: JobHandlers = {
        "demo.ok": async (p) => {
          order.push(String(p.n));
        },
        "demo.bad": async () => {
          throw new Error("synthetic failure");
        },
      };
      await enqueue("demo.ok", { n: "second" }, { runAt: addMs(T0, -1000) });
      await enqueue("demo.ok", { n: "first" }, { runAt: addMs(T0, -2000) });
      await enqueue("demo.bad", {});
      await enqueue("demo.unknown", {});
      await enqueue("demo.ok", { n: "future" }, { runAt: addMs(T0, MS.minute) });
      expect(await runDueJobs({ handlers, workerId: "w" })).toEqual({ ran: 4, succeeded: 2, failed: 2 });
      expect(order).toEqual(["first", "second"]);
      expect(await runDueJobs({ handlers, workerId: "w" })).toEqual({ ran: 0, succeeded: 0, failed: 0 });
    });

    it("stops at the limit (default 10) and picks up jobs enqueued by handlers", async () => {
      const handlers: JobHandlers = {
        "demo.chain": async (p) => {
          const n = Number(p.n);
          if (n < 14) await enqueue("demo.chain", { n: n + 1 });
        },
      };
      await enqueue("demo.chain", { n: 0 });
      expect(await runDueJobs({ handlers })).toEqual({ ran: 10, succeeded: 10, failed: 0 });
      expect(await runDueJobs({ handlers, limit: 3 })).toEqual({ ran: 3, succeeded: 3, failed: 0 });
      expect(await runDueJobs({ handlers, limit: 50 })).toEqual({ ran: 2, succeeded: 2, failed: 0 });
      await expect(runDueJobs({ handlers, limit: 0 })).rejects.toMatchObject({ code: "validation_failed" });
    });
  });

  describe("requeueStuckJobs", () => {
    it("requeues jobs whose lock is too old and leaves fresh ones alone", async () => {
      const stuck = await enqueue("demo.s", {});
      await claimDueJobs({ limit: 1, workerId: "crashed-worker" });
      setTestNow(addMs(T0, 10 * MS.minute));
      const fresh = await enqueue("demo.s", {});
      await claimDueJobs({ limit: 1, workerId: "live-worker" });

      setTestNow(addMs(T0, 15 * MS.minute));
      // Exactly at the threshold is not yet "older than".
      expect(await requeueStuckJobs({ olderThanMs: 15 * MS.minute })).toEqual({ requeued: 0, dead: 0 });
      setTestNow(addMs(T0, 15 * MS.minute + 1));
      expect(await requeueStuckJobs({ olderThanMs: 15 * MS.minute })).toEqual({ requeued: 1, dead: 0 });

      const job = await getJob(stuck.id);
      expect(job).toMatchObject({ status: "queued", attempts: 1, lockedAt: null, lockedBy: null });
      expect(job.runAt).toEqual(addMs(T0, 15 * MS.minute + 1));
      expect(job.lastError).toBe("Worker crashed-worker stopped responding while running this job; requeued");
      expect(await getJob(fresh.id)).toMatchObject({ status: "running", lockedBy: "live-worker" });

      const [again] = await claimDueJobs({ limit: 1, workerId: "live-worker" });
      expect(again).toMatchObject({ id: stuck.id, attempts: 2 });
    });

    it("dead-letters a stuck job that has no attempts left", async () => {
      const { id } = await enqueue("demo.s", {}, { maxAttempts: 1 });
      await claimDueJobs({ limit: 1, workerId: "crashed-worker" });
      setTestNow(addMs(T0, MS.hour));
      expect(await requeueStuckJobs()).toEqual({ requeued: 0, dead: 1 });
      const job = await getJob(id);
      expect(job).toMatchObject({ status: "dead", attempts: 1, lockedAt: null, lockedBy: null });
      expect(job.lastError).toBe("Worker crashed-worker stopped responding while running this job; no attempts left");
      expect(job.completedAt).toEqual(addMs(T0, MS.hour));
    });

    it("ignores queued, succeeded and dead jobs", async () => {
      await enqueue("demo.s", {});
      const done = await enqueue("demo.done", {}, { runAt: addMs(T0, -1000) });
      await runDueJobs({ handlers: { "demo.done": async () => {}, "demo.s": async () => {} }, limit: 1 });
      expect((await getJob(done.id)).status).toBe("succeeded");
      setTestNow(addMs(T0, MS.day));
      expect(await requeueStuckJobs({ olderThanMs: 0 })).toEqual({ requeued: 0, dead: 0 });
      await expect(requeueStuckJobs({ olderThanMs: -1 })).rejects.toMatchObject({ code: "validation_failed" });
    });
  });

  describe("admin helpers", () => {
    async function seed() {
      const handlers: JobHandlers = {
        "demo.ok": async () => {},
        "demo.bad": async () => {
          throw new Error("synthetic failure");
        },
      };
      await enqueue("demo.ok", { n: 1 }, { runAt: addMs(T0, -3 * MS.minute) });
      await enqueue("demo.ok", { n: 2 }, { runAt: addMs(T0, -2 * MS.minute) });
      await enqueue("demo.bad", {}, { runAt: addMs(T0, -MS.minute) });
      await enqueue("demo.gone", {}, { runAt: addMs(T0, -MS.second) });
      await runDueJobs({ handlers });
      // After the run: 2 succeeded, 1 retrying (queued, later), 1 dead.
      setTestNow(addMs(T0, 1000));
      const due = await enqueue("demo.ok", { n: 3 }, { runAt: addMs(T0, 500) });
      setTestNow(addMs(T0, 2000));
      await enqueue("demo.ok", { n: 4 }, { runAt: addMs(T0, MS.hour) });
      setTestNow(addMs(T0, 3000));
      const running = await enqueue("demo.busy", {}, { runAt: addMs(T0, -MS.hour) });
      await claimDueJobs({ limit: 1, workerId: "w" });
      return { due, running };
    }

    it("getJobStats summarizes the queue", async () => {
      const { due } = await seed();
      const stats = await getJobStats();
      expect(stats.byStatus).toEqual({ queued: 3, running: 1, succeeded: 2, failed: 0, dead: 1 });
      expect(stats.due).toBe(1);
      expect(stats.scheduled).toBe(2);
      expect(stats.retrying).toBe(1);
      expect(stats.oldestDueAt).toEqual((await getJob(due.id)).runAt);
      expect(stats.byType).toEqual([
        { type: "demo.bad", queued: 1, running: 0, succeeded: 0, failed: 0, dead: 0 },
        { type: "demo.busy", queued: 0, running: 1, succeeded: 0, failed: 0, dead: 0 },
        { type: "demo.gone", queued: 0, running: 0, succeeded: 0, failed: 0, dead: 1 },
        { type: "demo.ok", queued: 2, running: 0, succeeded: 2, failed: 0, dead: 0 },
      ]);
    });

    it("getJobStats on an empty queue", async () => {
      expect(await getJobStats()).toEqual({
        byStatus: { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 },
        due: 0,
        scheduled: 0,
        retrying: 0,
        oldestDueAt: null,
        byType: [],
      });
    });

    it("listJobs filters by status and type, newest first, with limit and offset", async () => {
      await seed();
      const all = await listJobs();
      expect(all).toHaveLength(7);
      expect(all[0].type).toBe("demo.busy");
      expect(all.map((j) => j.createdAt.getTime())).toEqual([...all.map((j) => j.createdAt.getTime())].sort((a, b) => b - a));
      expect((await listJobs({ status: "succeeded" })).map((j) => j.type)).toEqual(["demo.ok", "demo.ok"]);
      expect(await listJobs({ status: "dead", type: "demo.gone" })).toHaveLength(1);
      expect(await listJobs({ status: "dead", type: "demo.ok" })).toHaveLength(0);
      expect(await listJobs({ type: "demo.ok" })).toHaveLength(4);
      expect(await listJobs({ limit: 2 })).toHaveLength(2);
      expect((await listJobs({ limit: 2, offset: 2 })).map((j) => j.id)).toEqual(all.slice(2, 4).map((j) => j.id));
      await expect(listJobs({ limit: 0 })).rejects.toMatchObject({ code: "validation_failed" });
      await expect(listJobs({ status: "bogus" as never })).rejects.toMatchObject({ code: "validation_failed" });
    });

    it("getJob throws not_found for an unknown id", async () => {
      await expect(getJob("job_missing")).rejects.toMatchObject({ code: "not_found" });
    });

    it("retryJob revives a dead job with a fresh attempt budget", async () => {
      const { id } = await enqueue("demo.gone", {});
      await runDueJobs({ handlers: {} });
      expect(await getJob(id)).toMatchObject({ status: "dead", attempts: 1 });
      setTestNow(addMs(T0, MS.hour));
      const revived = await retryJob(id);
      expect(revived).toMatchObject({ id, status: "queued", attempts: 0, completedAt: null, lockedAt: null, lockedBy: null });
      expect(revived.runAt).toEqual(addMs(T0, MS.hour));
      expect(revived.lastError).toContain("No handler");
      expect(await runDueJobs({ handlers: { "demo.gone": async () => {} } })).toEqual({ ran: 1, succeeded: 1, failed: 0 });
    });

    it("retryJob makes a job that waits for its backoff due now without resetting attempts", async () => {
      const { id } = await enqueue("demo.bad", {});
      await runDueJobs({
        handlers: {
          "demo.bad": async () => {
            throw new Error("synthetic failure");
          },
        },
      });
      expect((await getJob(id)).runAt).toEqual(addMs(T0, 30 * MS.second));
      const res = await retryJob(id);
      expect(res).toMatchObject({ status: "queued", attempts: 1 });
      expect(res.runAt).toEqual(T0);
    });

    it("retryJob refuses running, succeeded and unknown jobs", async () => {
      const running = await enqueue("demo.busy", {});
      await claimDueJobs({ limit: 1, workerId: "w" });
      await expect(retryJob(running.id)).rejects.toMatchObject({ code: "conflict" });
      const ok = await enqueue("demo.ok", {});
      await runDueJobs({ handlers: { "demo.ok": async () => {} } });
      await expect(retryJob(ok.id)).rejects.toMatchObject({ code: "conflict" });
      await expect(retryJob("job_missing")).rejects.toMatchObject({ code: "not_found" });
    });

    it("retryJob will not create a second active job for one dedupe key", async () => {
      const dead = await enqueue("demo.gone", {}, { dedupeKey: "same" });
      await runDueJobs({ handlers: {} });
      const replacement = await enqueue("demo.gone", {}, { dedupeKey: "same" });
      expect(replacement.enqueued).toBe(true);
      await expect(retryJob(dead.id)).rejects.toMatchObject({ code: "conflict" });
      expect((await getJob(dead.id)).status).toBe("dead");
      // Once the replacement is finished the dead one may be revived.
      await t.db.update(jobs).set({ status: "succeeded" }).where(eq(jobs.id, replacement.id));
      expect((await retryJob(dead.id)).status).toBe("queued");
    });

    it("purgeSucceededJobs deletes old succeeded jobs only", async () => {
      const handlers: JobHandlers = { "demo.ok": async () => {} };
      const old = await enqueue("demo.ok", {});
      const dead = await enqueue("demo.gone", {});
      await runDueJobs({ handlers });
      setTestNow(addMs(T0, 6 * MS.day));
      const recent = await enqueue("demo.ok", {});
      await runDueJobs({ handlers });
      const queued = await enqueue("demo.ok", {}, { runAt: addMs(T0, 30 * MS.day) });

      setTestNow(addMs(T0, 7 * MS.day));
      expect(await purgeSucceededJobs()).toEqual({ purged: 0 });
      setTestNow(addMs(T0, 7 * MS.day + 1));
      expect(await purgeSucceededJobs()).toEqual({ purged: 1 });
      expect((await allRows()).map((r) => r.id).sort()).toEqual([dead.id, recent.id, queued.id].sort());
      await expect(getJob(old.id)).rejects.toMatchObject({ code: "not_found" });
      expect(await purgeSucceededJobs({ olderThanMs: 0 })).toEqual({ purged: 1 });
      await expect(purgeSucceededJobs({ olderThanMs: Number.NaN })).rejects.toMatchObject({ code: "validation_failed" });
    });

    it("purgeSucceededJobs always keeps the newest recurring job of each type", async () => {
      const handlers: JobHandlers = { "demo.tick": async () => {}, "demo.tock": async () => {} };
      const tick1 = await enqueueOnce("demo.tick", {}, { dedupeKey: "recurring:demo.tick:1" });
      await runDueJobs({ handlers });
      setTestNow(addMs(T0, MS.day));
      const tick2 = await enqueueOnce("demo.tick", {}, { dedupeKey: "recurring:demo.tick:2" });
      const tock1 = await enqueueOnce("demo.tock", {}, { dedupeKey: "recurring:demo.tock:1" });
      await runDueJobs({ handlers });

      setTestNow(addMs(T0, 365 * MS.day));
      expect(await purgeSucceededJobs()).toEqual({ purged: 1 });
      expect((await allRows()).map((r) => r.id).sort()).toEqual([tick2.id, tock1.id].sort());
      await expect(getJob(tick1.id)).rejects.toMatchObject({ code: "not_found" });
      // The surviving rows still block a second job for their period.
      expect((await enqueueOnce("demo.tick", {}, { dedupeKey: "recurring:demo.tick:2" })).enqueued).toBe(false);
    });
  });
});
