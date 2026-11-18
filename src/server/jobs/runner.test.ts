import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMs, MS, setTestNow } from "@/lib/clock";
import { useTestDb } from "../../../tests/helpers/db";
import { claimDueJobs, enqueue, getJob, getJobStats, listJobs, runDueJobs } from "./index";
import { inlineRunnerStatus, runQueueCycle, startInlineRunner, stopInlineRunner } from "./runner";
import type { JobHandlers, RecurringJob } from "./types";

const T0 = new Date("2026-11-18T12:00:00.000Z");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met in time");
    await sleep(5);
  }
}

describe("runQueueCycle", () => {
  useTestDb();

  beforeEach(() => {
    setTestNow(T0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  const recurring: RecurringJob[] = [{ type: "demo.sweep", everyMs: MS.minute }];

  it("does maintenance, then one round of jobs", async () => {
    const handlers: JobHandlers = { "demo.sweep": async () => {}, "demo.work": async () => {} };
    // An abandoned job, an old succeeded job and fresh work.
    const stuck = await enqueue("demo.work", { n: "stuck" });
    await claimDueJobs({ limit: 1, workerId: "crashed" });
    const old = await enqueue("demo.work", { n: "old" });
    await runDueJobs({ handlers });
    setTestNow(addMs(T0, 8 * MS.day));
    await enqueue("demo.work", { n: "fresh" });

    const res = await runQueueCycle({ handlers, recurring, workerId: "w" });
    expect(res).toEqual({ scheduled: 1, requeued: 1, deadLettered: 0, purged: 1, ran: 3, succeeded: 3, failed: 0, rounds: 1, drained: true });
    expect((await getJob(stuck.id)).status).toBe("succeeded");
    await expect(getJob(old.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await getJobStats()).byStatus).toMatchObject({ queued: 0, running: 0, succeeded: 3 });
  });

  it("skips maintenance when asked to", async () => {
    await enqueue("demo.work", {});
    await claimDueJobs({ limit: 1, workerId: "crashed" });
    setTestNow(addMs(T0, MS.day));
    const res = await runQueueCycle({ handlers: {}, recurring, maintenance: false });
    expect(res).toEqual({ scheduled: 0, requeued: 0, deadLettered: 0, purged: 0, ran: 0, succeeded: 0, failed: 0, rounds: 1, drained: true });
    expect(await listJobs({ status: "running" })).toHaveLength(1);
  });

  it("runs a single round unless draining", async () => {
    const handlers: JobHandlers = { "demo.work": async () => {} };
    for (let i = 0; i < 7; i++) await enqueue("demo.work", { i });
    const res = await runQueueCycle({ handlers, recurring: [], limit: 3 });
    expect(res).toMatchObject({ ran: 3, succeeded: 3, rounds: 1, drained: false });
    expect((await getJobStats()).due).toBe(4);
  });

  it("drains until no due job is left, including jobs enqueued along the way", async () => {
    const handlers: JobHandlers = {
      "demo.chain": async (p) => {
        const n = Number(p.n);
        if (n < 11) await enqueue("demo.chain", { n: n + 1 });
      },
      "demo.flaky": async () => {
        throw new Error("synthetic failure");
      },
    };
    await enqueue("demo.chain", { n: 0 });
    await enqueue("demo.flaky", {});
    await enqueue("demo.chain", { n: 99 }, { runAt: addMs(T0, MS.hour) });
    const res = await runQueueCycle({ handlers, recurring: [], limit: 4, drain: true });
    // 12 chained jobs + 1 failed attempt = 13 runs in rounds of 4 → 4, 4, 4, 1.
    expect(res).toMatchObject({ ran: 13, succeeded: 12, failed: 1, rounds: 4, drained: true });
    const stats = await getJobStats();
    expect(stats.due).toBe(0);
    // The failed job waits for its retry and the future job for its time; neither keeps the drain going.
    expect(stats.scheduled).toBe(2);
  });

  it("bounds a drain by rounds and by elapsed time", async () => {
    const handlers: JobHandlers = {
      "demo.forever": async () => {
        await enqueue("demo.forever", {});
      },
    };
    await enqueue("demo.forever", {});
    const byRounds = await runQueueCycle({ handlers, recurring: [], limit: 2, drain: true, maxRounds: 3 });
    expect(byRounds).toMatchObject({ ran: 6, rounds: 3, drained: false });
    const byTime = await runQueueCycle({ handlers, recurring: [], limit: 2, drain: true, timeBudgetMs: 0 });
    expect(byTime).toMatchObject({ ran: 2, rounds: 1, drained: false });
  });
});

describe("inline runner", () => {
  useTestDb();

  beforeEach(() => {
    setTestNow(T0);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    await stopInlineRunner();
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("runs queued jobs in the background and stops on request", async () => {
    const done: number[] = [];
    const handlers: JobHandlers = {
      "demo.bg": async (p) => {
        done.push(Number(p.n));
      },
    };
    expect(inlineRunnerStatus().running).toBe(false);
    expect(startInlineRunner({ intervalMs: 5, handlers, recurring: [] })).toBe(true);
    expect(inlineRunnerStatus().running).toBe(true);
    await enqueue("demo.bg", { n: 1 });
    await enqueue("demo.bg", { n: 2 });
    await waitFor(() => done.length === 2);
    expect(done.sort()).toEqual([1, 2]);

    await stopInlineRunner();
    expect(inlineRunnerStatus().running).toBe(false);
    const { id } = await enqueue("demo.bg", { n: 3 });
    await sleep(60);
    expect(done).toHaveLength(2);
    expect((await getJob(id)).status).toBe("queued");
  });

  it("is a single loop per process: a second start is refused and ticks never overlap", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const handlers: JobHandlers = {
      "demo.slow": async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(25);
        active--;
        runs++;
      },
    };
    for (let i = 0; i < 6; i++) await enqueue("demo.slow", { i });
    // One job per tick with a 1 ms pause: overlapping ticks would show up as concurrent handlers.
    expect(startInlineRunner({ intervalMs: 1, limit: 1, handlers, recurring: [] })).toBe(true);
    expect(startInlineRunner({ intervalMs: 1, limit: 1, handlers, recurring: [] })).toBe(false);
    expect(startInlineRunner({ intervalMs: 1, limit: 1, handlers, recurring: [] })).toBe(false);
    await waitFor(() => runs === 6);
    expect(maxActive).toBe(1);
    expect((await getJobStats()).byStatus.succeeded).toBe(6);
  });

  it("schedules recurring jobs on its first tick", async () => {
    let sweeps = 0;
    const handlers: JobHandlers = {
      "demo.sweep": async () => {
        sweeps++;
      },
    };
    startInlineRunner({ intervalMs: 5, handlers, recurring: [{ type: "demo.sweep", everyMs: MS.hour }] });
    await waitFor(() => sweeps === 1);
    await sleep(50);
    // Same period, many ticks later: still exactly one run.
    expect(sweeps).toBe(1);
    expect(inlineRunnerStatus().ticks).toBeGreaterThan(2);
  });

  it("survives failing jobs and failing ticks", async () => {
    let ok = 0;
    const handlers: JobHandlers = {
      "demo.bad": async () => {
        throw new Error("synthetic failure");
      },
      "demo.ok": async () => {
        ok++;
      },
    };
    // Maintenance blows up on every tick it runs on (here: every tick); job ticks must keep going.
    const explosive = {
      [Symbol.iterator]() {
        throw new Error("synthetic registry failure");
      },
    } as unknown as RecurringJob[];
    startInlineRunner({ intervalMs: 2, maintenanceEveryMs: 4, handlers, recurring: explosive });
    await enqueue("demo.bad", {});
    await enqueue("demo.ok", {});
    await waitFor(() => inlineRunnerStatus().lastError !== null || inlineRunnerStatus().consecutiveFailures > 0);
    await waitFor(() => ok === 1);
    expect(inlineRunnerStatus().running).toBe(true);
    const bad = (await listJobs({ type: "demo.bad" }))[0];
    expect(bad).toMatchObject({ status: "queued", attempts: 1 });
    expect(console.error).toHaveBeenCalledWith("[jobs] inline runner tick failed", expect.any(Error));
  });

  it("stop waits for the tick in progress and the runner can be started again", async () => {
    let finished = false;
    let started = false;
    const handlers: JobHandlers = {
      "demo.slow": async () => {
        started = true;
        await sleep(80);
        finished = true;
      },
    };
    await enqueue("demo.slow", {});
    startInlineRunner({ intervalMs: 1, handlers, recurring: [] });
    await waitFor(() => started);
    await stopInlineRunner();
    expect(finished).toBe(true);
    expect((await listJobs({ type: "demo.slow" }))[0].status).toBe("succeeded");

    await stopInlineRunner(); // idempotent
    expect(startInlineRunner({ intervalMs: 5, handlers, recurring: [] })).toBe(true);
    expect(inlineRunnerStatus().running).toBe(true);
  });
});
