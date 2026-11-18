import { defaultWorkerId, purgeSucceededJobs, requeueStuckJobs, runDueJobs, type RunOptions } from "./index";
import { scheduleRecurring } from "./recurring";
import type { RecurringJob } from "./types";

/**
 * One pass over the queue, shared by the three ways jobs get run:
 *  - the inline runner below (embedded database: jobs run inside the web process),
 *  - `scripts/worker.ts` (a long-running worker next to real Postgres),
 *  - `POST /api/internal/jobs/run` (cron-triggered, for hosts without long-running processes).
 */

export interface QueueCycleOptions extends RunOptions {
  workerId?: string;
  /** Jobs per round. Default 10. */
  limit?: number;
  /** Before running: schedule recurring jobs, recover stuck jobs, purge old succeeded rows. Default true. */
  maintenance?: boolean;
  /** Keep running rounds until no due job is left, within `maxRounds` and `timeBudgetMs`. Default false (one round). */
  drain?: boolean;
  /** Drain bound. Default 100. */
  maxRounds?: number;
  /** Drain bound in real elapsed time; no new round starts after it. Default 50 s. */
  timeBudgetMs?: number;
  /** Recurring definitions to use instead of the app registry (tests). */
  recurring?: RecurringJob[];
}

export interface QueueCycleResult {
  /** Recurring jobs created for the current period. */
  scheduled: number;
  /** Stuck jobs put back in the queue. */
  requeued: number;
  /** Stuck jobs with no attempts left, now dead. */
  deadLettered: number;
  /** Old succeeded rows deleted. */
  purged: number;
  ran: number;
  succeeded: number;
  failed: number;
  rounds: number;
  /** True when the last round found fewer due jobs than its limit, i.e. nothing due was left behind. */
  drained: boolean;
}

export const DEFAULT_DRAIN_MAX_ROUNDS = 100;
export const DEFAULT_DRAIN_TIME_BUDGET_MS = 50_000;

export async function runQueueCycle(opts: QueueCycleOptions = {}): Promise<QueueCycleResult> {
  const limit = opts.limit ?? 10;
  const workerId = opts.workerId ?? defaultWorkerId();
  const maxRounds = opts.drain ? (opts.maxRounds ?? DEFAULT_DRAIN_MAX_ROUNDS) : 1;
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_DRAIN_TIME_BUDGET_MS;
  const result: QueueCycleResult = { scheduled: 0, requeued: 0, deadLettered: 0, purged: 0, ran: 0, succeeded: 0, failed: 0, rounds: 0, drained: false };

  if (opts.maintenance !== false) {
    result.scheduled = (await scheduleRecurring({ recurring: opts.recurring })).scheduled;
    const recovered = await requeueStuckJobs();
    result.requeued = recovered.requeued;
    result.deadLettered = recovered.dead;
    result.purged = (await purgeSucceededJobs()).purged;
  }

  // The budget limits real elapsed time (a serverless invocation), so it is not read from the app clock.
  const startedAt = performance.now();
  while (result.rounds < maxRounds && !opts.signal?.aborted) {
    const round = await runDueJobs({ limit, workerId, handlers: opts.handlers, timeoutMs: opts.timeoutMs, signal: opts.signal });
    result.rounds++;
    result.ran += round.ran;
    result.succeeded += round.succeeded;
    result.failed += round.failed;
    if (round.ran < limit) {
      // An aborted round stopped early; that says nothing about what is still due.
      result.drained = !opts.signal?.aborted;
      break;
    }
    if (performance.now() - startedAt >= timeBudgetMs) break;
  }
  return result;
}

/* Inline runner ------------------------------------------------------------------------------------ */

export interface InlineRunnerOptions extends RunOptions {
  /** Pause between ticks. Default 1500 ms. */
  intervalMs?: number;
  /** Jobs per tick. Default 10. */
  limit?: number;
  /** Maintenance (recurring scheduling, stuck-job recovery, purge) runs on the first tick and then this often. Default 30 s. */
  maintenanceEveryMs?: number;
  recurring?: RecurringJob[];
}

interface RunnerState {
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** The tick in progress, if any. Never rejects. */
  inFlight: Promise<void> | null;
  ticks: number;
  consecutiveFailures: number;
  lastError: string | null;
}

/** Longest pause between ticks while ticks keep failing (e.g. the database is unreachable). */
const MAX_FAILURE_PAUSE_MS = 30_000;

// On globalThis so a dev-server hot reload, which re-evaluates this module, finds the loop that is already running.
const g = globalThis as unknown as { __eccaInlineJobRunner?: RunnerState };

/**
 * Starts the in-process job loop used with the embedded database. At most one loop exists per process:
 * a second call returns false and changes nothing. Ticks never overlap (the next one is scheduled only
 * after the current one settled) and a failing tick is logged and retried later, never thrown.
 */
export function startInlineRunner(opts: InlineRunnerOptions = {}): boolean {
  if (g.__eccaInlineJobRunner && !g.__eccaInlineJobRunner.stopped) return false;
  const intervalMs = Math.max(1, opts.intervalMs ?? 1500);
  const maintenanceEveryTicks = Math.max(1, Math.round((opts.maintenanceEveryMs ?? 30_000) / intervalMs));
  const state: RunnerState = { stopped: false, timer: null, inFlight: null, ticks: 0, consecutiveFailures: 0, lastError: null };
  g.__eccaInlineJobRunner = state;

  const tick = async (): Promise<void> => {
    const maintenance = state.ticks % maintenanceEveryTicks === 0;
    state.ticks++;
    try {
      await runQueueCycle({ limit: opts.limit, maintenance, handlers: opts.handlers, timeoutMs: opts.timeoutMs, recurring: opts.recurring });
      state.consecutiveFailures = 0;
      state.lastError = null;
    } catch (e) {
      state.consecutiveFailures++;
      state.lastError = e instanceof Error ? e.message : String(e);
      console.error("[jobs] inline runner tick failed", e);
    }
  };

  const scheduleNext = (): void => {
    if (state.stopped) return;
    // Back off while ticks keep failing so a database outage does not flood the log.
    const pause =
      state.consecutiveFailures === 0 ? intervalMs : Math.min(intervalMs * 2 ** Math.min(state.consecutiveFailures, 10), Math.max(intervalMs, MAX_FAILURE_PAUSE_MS));
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.stopped || state.inFlight) return;
      state.inFlight = tick().finally(() => {
        state.inFlight = null;
        scheduleNext();
      });
    }, pause);
    // The loop must not keep a process alive on its own (scripts, tests, graceful shutdown).
    state.timer.unref?.();
  };

  scheduleNext();
  return true;
}

/** Stops the loop and waits for a tick in progress to finish. Safe to call when no loop is running. */
export async function stopInlineRunner(): Promise<void> {
  const state = g.__eccaInlineJobRunner;
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.inFlight) await state.inFlight;
  if (g.__eccaInlineJobRunner === state) g.__eccaInlineJobRunner = undefined;
}

export function inlineRunnerStatus(): { running: boolean; ticks: number; consecutiveFailures: number; lastError: string | null } {
  const state = g.__eccaInlineJobRunner;
  if (!state || state.stopped) return { running: false, ticks: state?.ticks ?? 0, consecutiveFailures: 0, lastError: null };
  return { running: true, ticks: state.ticks, consecutiveFailures: state.consecutiveFailures, lastError: state.lastError };
}
