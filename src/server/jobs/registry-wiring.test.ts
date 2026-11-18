import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestNow } from "@/lib/clock";
import { useTestDb } from "../../../tests/helpers/db";
import { enqueue, getJob, listJobs, runDueJobs } from "./index";
import { scheduleRecurring } from "./recurring";
import { runQueueCycle } from "./runner";

/**
 * The queue, the recurring scheduler and the runner all fall back to the app registry when no handlers
 * are passed in. The registry is replaced here so the test does not depend on what the domains register.
 */
const ran: string[] = [];

vi.mock("./registry", () => ({
  allJobHandlers: () => ({
    "wired.work": async (payload: Record<string, unknown>) => {
      ran.push(String(payload.n));
    },
    "wired.sweep": async () => {
      ran.push("sweep");
    },
  }),
  allRecurringJobs: () => [{ type: "wired.sweep", everyMs: 60_000, payload: { from: "registry" } }],
}));

describe("registry wiring", () => {
  useTestDb();

  beforeEach(() => {
    ran.length = 0;
    setTestNow("2026-11-18T12:00:00.000Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("runDueJobs resolves handlers from the registry and dead-letters types it does not know", async () => {
    const known = await enqueue("wired.work", { n: 1 });
    const unknown = await enqueue("wired.unknown", {});
    expect(await runDueJobs()).toEqual({ ran: 2, succeeded: 1, failed: 1 });
    expect(ran).toEqual(["1"]);
    expect((await getJob(known.id)).status).toBe("succeeded");
    expect(await getJob(unknown.id)).toMatchObject({ status: "dead", lastError: 'No handler is registered for job type "wired.unknown"' });
  });

  it("scheduleRecurring reads the recurring jobs from the registry", async () => {
    expect(await scheduleRecurring()).toEqual({ scheduled: 1, alreadyScheduled: 0, invalid: [] });
    expect(await scheduleRecurring()).toEqual({ scheduled: 0, alreadyScheduled: 1, invalid: [] });
    const [job] = await listJobs();
    expect(job).toMatchObject({ type: "wired.sweep", payload: { from: "registry" }, status: "queued" });
  });

  it("runQueueCycle schedules and runs registry work in one pass", async () => {
    await enqueue("wired.work", { n: 7 });
    const res = await runQueueCycle();
    expect(res).toMatchObject({ scheduled: 1, ran: 2, succeeded: 2, failed: 0, rounds: 1, drained: true });
    expect(ran.sort()).toEqual(["7", "sweep"]);
  });
});
