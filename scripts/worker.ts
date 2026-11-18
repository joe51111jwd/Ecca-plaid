/**
 * Long-running job worker for deployments on real Postgres.
 *
 *   npm run worker                                  poll forever
 *   npm run worker -- --interval=1000 --limit=10    pause between idle polls (ms), jobs per pass
 *   npm run worker -- --once                        one pass (drains what is due), then exit
 *
 * Each pass schedules recurring jobs, recovers jobs abandoned by a crashed worker, and runs what is
 * due. Any number of workers can run side by side: jobs are claimed with SKIP LOCKED. Set
 * JOBS_INLINE=false on the web processes when a worker runs.
 *
 * SIGINT/SIGTERM: the job in progress finishes, nothing new is claimed, the process exits 0. A second
 * signal exits immediately; the interrupted job is retried once its lock expires.
 */
import { existsSync } from "node:fs";
import { closeDb } from "@/db/client";
import { usingEmbeddedDb } from "@/lib/env";
import { defaultWorkerId } from "@/server/jobs";
import { runQueueCycle } from "@/server/jobs/runner";

/** Maintenance (recurring scheduling, stuck-job recovery, purge) runs on the first pass and then this often. */
const MAINTENANCE_EVERY_MS = 30_000;
/** Longest pause between passes while passes keep failing (database unreachable). */
const MAX_FAILURE_PAUSE_MS = 30_000;

/** Same files Next.js reads for the app; variables already set in the environment win. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function fail(message: string): never {
  console.error(`worker: ${message}`);
  process.exit(1);
}

function intArg(name: string, fallback: number, min: number, max: number): number {
  const raw = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 3));
  if (!Number.isInteger(value) || value < min || value > max) fail(`--${name} must be a whole number from ${min} to ${max}`);
  return value;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const intervalMs = intArg("interval", 1000, 50, 3_600_000);
  const limit = intArg("limit", 10, 1, 100);
  const once = process.argv.includes("--once");
  if (usingEmbeddedDb()) {
    fail("DATABASE_URL is not set. With the embedded database, jobs run inside the web process; a separate worker would open the same files twice.");
  }

  const workerId = defaultWorkerId();
  const shutdown = new AbortController();
  let wake: (() => void) | null = null;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shutdown.signal.aborted) {
      console.error(`worker: ${signal} again, exiting now`);
      process.exit(1);
    }
    console.log(`worker: ${signal} received, finishing the job in progress`);
    shutdown.abort();
    wake?.();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = done;
    });

  console.log(`worker: ${workerId} started (interval ${intervalMs} ms, ${limit} jobs per pass${once ? ", single pass" : ""})`);
  let lastMaintenanceAt = Number.NEGATIVE_INFINITY;
  let failures = 0;
  while (!shutdown.signal.aborted) {
    // Loop pacing is real elapsed time, like the timers themselves; job timing uses the app clock inside the queue.
    const maintenance = performance.now() - lastMaintenanceAt >= MAINTENANCE_EVERY_MS;
    let moreIsDue = false;
    try {
      const res = await runQueueCycle({ workerId, limit, maintenance, drain: once, signal: shutdown.signal });
      if (maintenance) lastMaintenanceAt = performance.now();
      failures = 0;
      moreIsDue = !res.drained;
      if (res.ran + res.scheduled + res.requeued + res.deadLettered + res.purged > 0) {
        console.log(
          `worker: ran ${res.ran} (${res.succeeded} ok, ${res.failed} failed)` +
            (res.scheduled ? `, scheduled ${res.scheduled} recurring` : "") +
            (res.requeued + res.deadLettered ? `, recovered ${res.requeued} stuck (${res.deadLettered} dead)` : "") +
            (res.purged ? `, purged ${res.purged}` : ""),
        );
      }
    } catch (e) {
      failures++;
      console.error("worker: pass failed", e);
    }
    if (once) {
      if (failures > 0) process.exitCode = 1;
      break;
    }
    if (shutdown.signal.aborted) break;
    if (failures > 0) await pause(Math.min(intervalMs * 2 ** Math.min(failures, 10), Math.max(intervalMs, MAX_FAILURE_PAUSE_MS)));
    else if (!moreIsDue) await pause(intervalMs);
  }

  await closeDb();
  console.log("worker: stopped");
}

main().catch((e) => {
  console.error("worker: crashed", e);
  process.exit(1);
});
