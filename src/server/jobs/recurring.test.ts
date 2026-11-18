import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { addMs, MS, setTestNow } from "@/lib/clock";
import { useTestDb } from "../../../tests/helpers/db";
import { getJob, listJobs, runDueJobs } from "./index";
import { MIN_RECURRING_INTERVAL_MS, recurringDedupeKey, recurringPeriodIndex, scheduleRecurring } from "./recurring";
import type { JobHandlers, RecurringJob } from "./types";

const T0 = new Date("2026-11-18T12:00:00.000Z");

const recurring: RecurringJob[] = [
  { type: "demo.every-5m", everyMs: 5 * MS.minute },
  { type: "demo.hourly", everyMs: MS.hour, payload: { scope: "all" } },
  { type: "demo.daily", everyMs: MS.day },
];
const handlers: JobHandlers = { "demo.every-5m": async () => {}, "demo.hourly": async () => {}, "demo.daily": async () => {} };

describe("recurring jobs", () => {
  const t = useTestDb();

  beforeEach(() => {
    setTestNow(T0);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  const count = async () => (await t.db.select().from(schema.jobs)).length;

  it("derives the period index from the epoch", () => {
    expect(recurringPeriodIndex(1000, new Date(0))).toBe(0);
    expect(recurringPeriodIndex(1000, new Date(999))).toBe(0);
    expect(recurringPeriodIndex(1000, new Date(1000))).toBe(1);
    expect(recurringPeriodIndex(MS.day, T0)).toBe(Math.floor(T0.getTime() / MS.day));
    expect(recurringDedupeKey("demo.daily", MS.day, T0)).toBe(`recurring:demo.daily:${Math.floor(T0.getTime() / MS.day)}`);
    // Two instants in the same period share a key; the next period does not.
    expect(recurringDedupeKey("x", MS.hour, addMs(T0, 59 * MS.minute))).toBe(recurringDedupeKey("x", MS.hour, T0));
    expect(recurringDedupeKey("x", MS.hour, addMs(T0, MS.hour))).not.toBe(recurringDedupeKey("x", MS.hour, T0));
  });

  it("enqueues one due job per recurring type for the current period", async () => {
    expect(await scheduleRecurring({ recurring })).toEqual({ scheduled: 3, alreadyScheduled: 0, invalid: [] });
    const jobs = await listJobs();
    expect(jobs.map((j) => j.type).sort()).toEqual(["demo.daily", "demo.every-5m", "demo.hourly"]);
    for (const job of jobs) {
      expect(job.status).toBe("queued");
      expect(job.runAt).toEqual(T0);
      expect(job.dedupeKey).toBe(recurringDedupeKey(job.type, recurring.find((r) => r.type === job.type)!.everyMs, T0));
    }
    expect(jobs.find((j) => j.type === "demo.hourly")!.payload).toEqual({ scope: "all" });
    expect(jobs.find((j) => j.type === "demo.daily")!.payload).toEqual({});
  });

  it("does not schedule a period twice, however many instances call at once", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => scheduleRecurring({ recurring })));
    expect(results.reduce((n, r) => n + r.scheduled, 0)).toBe(3);
    expect(results.reduce((n, r) => n + r.alreadyScheduled, 0)).toBe(8 * 3 - 3);
    expect(await count()).toBe(3);
  });

  it("does not reschedule a period whose job already ran, failed or died", async () => {
    await scheduleRecurring({ recurring });
    await runDueJobs({
      handlers: {
        "demo.every-5m": async () => {},
        "demo.hourly": async () => {
          throw new Error("synthetic failure");
        },
        // demo.daily has no handler and is dead-lettered
      },
    });
    const statuses = Object.fromEntries((await listJobs()).map((j) => [j.type, j.status]));
    expect(statuses).toEqual({ "demo.every-5m": "succeeded", "demo.hourly": "queued", "demo.daily": "dead" });
    setTestNow(addMs(T0, MS.minute));
    expect(await scheduleRecurring({ recurring })).toEqual({ scheduled: 0, alreadyScheduled: 3, invalid: [] });
    expect(await count()).toBe(3);
  });

  it("schedules each type again when its own period rolls over", async () => {
    await scheduleRecurring({ recurring });
    await runDueJobs({ handlers });

    // 12:05 starts a new 5-minute period only.
    setTestNow(addMs(T0, 5 * MS.minute));
    expect(await scheduleRecurring({ recurring })).toEqual({ scheduled: 1, alreadyScheduled: 2, invalid: [] });
    // 13:00 starts a new 5-minute and a new hourly period.
    setTestNow(addMs(T0, MS.hour));
    expect(await scheduleRecurring({ recurring })).toEqual({ scheduled: 2, alreadyScheduled: 1, invalid: [] });
    // Midnight UTC starts all three.
    setTestNow(addMs(T0, 12 * MS.hour));
    expect(await scheduleRecurring({ recurring })).toEqual({ scheduled: 3, alreadyScheduled: 0, invalid: [] });
    expect(await count()).toBe(9);
  });

  it("after an outage runs the stale job and the current period's job, not one job per missed period", async () => {
    await scheduleRecurring({ recurring: [recurring[0]] });
    // Nothing ran for an hour (worker down); the old job is still queued and one new one is added for "now".
    setTestNow(addMs(T0, MS.hour));
    await scheduleRecurring({ recurring: [recurring[0]] });
    expect(await count()).toBe(2);
    let runs = 0;
    await runDueJobs({
      handlers: {
        "demo.every-5m": async () => {
          runs++;
        },
      },
    });
    expect(runs).toBe(2);
  });

  it("skips unusable definitions without stopping the rest", async () => {
    const res = await scheduleRecurring({
      recurring: [
        { type: "demo.zero", everyMs: 0 },
        { type: "demo.negative", everyMs: -5 },
        { type: "demo.nan", everyMs: Number.NaN },
        { type: "demo.too-fast", everyMs: MIN_RECURRING_INTERVAL_MS - 1 },
        { type: "", everyMs: MS.hour },
        { type: "bad type name", everyMs: MS.hour },
        { type: "demo.bad-payload", everyMs: MS.hour, payload: { n: BigInt(1) } },
        { type: "demo.good", everyMs: MIN_RECURRING_INTERVAL_MS },
      ],
    });
    expect(res.scheduled).toBe(1);
    expect(res.invalid).toEqual(["demo.zero", "demo.negative", "demo.nan", "demo.too-fast", "", "bad type name", "demo.bad-payload"]);
    const jobs = await listJobs();
    expect(jobs.map((j) => j.type)).toEqual(["demo.good"]);
    expect((await getJob(jobs[0].id)).status).toBe("queued");
  });

  it("does nothing for an empty list", async () => {
    expect(await scheduleRecurring({ recurring: [] })).toEqual({ scheduled: 0, alreadyScheduled: 0, invalid: [] });
    expect(await count()).toBe(0);
  });
});
