import { hostname } from "node:os";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { execRows, getDb, schema, type DbOrTx } from "@/db/client";
import type { JobStatus } from "@/db/schema";
import { addMs, MS, now } from "@/lib/clock";
import { conflict, invalid, notFound } from "@/lib/errors";
import { newToken } from "@/lib/ids";
import { newSortableId } from "@/server/audit";
import type { EnqueueOptions, JobHandler, JobHandlers } from "./types";

/**
 * Postgres-backed job queue on the `jobs` table.
 *
 *   await enqueue("verification.extract", { documentId }, { dedupeKey: `extract:${documentId}` }, tx);
 *
 * Life of a job: `queued` → (claimed) `running` → `succeeded`, or back to `queued` with a later `runAt`
 * after a failed attempt, or `dead` once `maxAttempts` attempts have failed (or no handler exists).
 * A job waiting for a retry is `queued` with `attempts > 0` and `lastError` set, so a dedupe key keeps
 * protecting it. The `failed` status of the schema is never written by this module.
 *
 * Delivery is at-least-once: a job can run again after a worker crash or a timeout, so handlers must be
 * idempotent (see ./types).
 */

const { jobs } = schema;

export type Job = typeof jobs.$inferSelect;

/* Policy constants --------------------------------------------------------------------------------- */

export const DEFAULT_MAX_ATTEMPTS = 5;

/** Delay before attempt n+1 after attempt n failed (the last entry repeats). Deterministic: no jitter. */
export const RETRY_SCHEDULE_MS: readonly number[] = [30 * MS.second, 2 * MS.minute, 10 * MS.minute, MS.hour, 6 * MS.hour];

/** `lastError` is cut to this many characters. */
export const MAX_LAST_ERROR_LENGTH = 2000;

/** A handler that has not settled after this long fails the attempt, so one hung job cannot stall a worker. */
export const DEFAULT_JOB_TIMEOUT_MS = 5 * MS.minute;

/** A `running` job whose lock is older than this is treated as abandoned by a crashed worker. Must exceed the job timeout. */
export const DEFAULT_STUCK_AFTER_MS = 15 * MS.minute;

/** Succeeded jobs are deleted after this long; dead jobs are kept for operators. */
export const SUCCEEDED_JOB_RETENTION_MS = 7 * MS.day;

/** Dedupe-key prefix reserved for jobs created by `scheduleRecurring()` (./recurring). */
export const RECURRING_KEY_PREFIX = "recurring:";

const ACTIVE_STATUSES: JobStatus[] = ["queued", "running"];
const JOB_STATUSES: JobStatus[] = ["queued", "running", "succeeded", "failed", "dead"];

/** First half of the two-int advisory lock key ("JOBS"), so dedupe locks cannot collide with other advisory locks. */
const DEDUPE_LOCK_NAMESPACE = 0x4a4f4253;

export function retryDelayMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 1), RETRY_SCHEDULE_MS.length) - 1;
  return RETRY_SCHEDULE_MS[i];
}

let processWorkerId: string | null = null;

/** Identifies this process in `jobs.locked_by`. */
export function defaultWorkerId(): string {
  processWorkerId ??= `${hostname()}:${process.pid}:${newToken(4)}`;
  return processWorkerId;
}

/* Enqueue ------------------------------------------------------------------------------------------ */

export interface EnqueueResult {
  /** Id of the job that will run: the new one, or the existing one when the dedupe key matched. */
  id: string;
  /** False when an existing job with the same dedupe key made this call a no-op. */
  enqueued: boolean;
}

const enqueueInput = z.object({
  type: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/, "Job type must be 1-120 characters of letters, digits, '.', '_', ':' or '-'"),
  runAt: z.date().optional(),
  dedupeKey: z.string().min(1).max(500).optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
});

/** What is stored is exactly what the handler receives later: a plain JSON object. */
function toJsonObject(payload: unknown): Record<string, unknown> {
  let parsed: unknown;
  try {
    const json = JSON.stringify(payload);
    parsed = json === undefined ? undefined : JSON.parse(json);
  } catch (e) {
    throw invalid(`Job payload is not JSON-serializable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid("Job payload must be a plain object");
  return parsed as Record<string, unknown>;
}

function newJobRow(type: string, payload: Record<string, unknown>, opts: EnqueueOptions): typeof jobs.$inferInsert {
  const parsed = enqueueInput.safeParse({ type, ...opts });
  if (!parsed.success) throw invalid(`Invalid job: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const at = now();
  return {
    // Sortable, so jobs that share a runAt (always the case under a frozen clock) are claimed first in, first out.
    id: newSortableId("job"),
    type: parsed.data.type,
    payload: toJsonObject(payload),
    status: "queued",
    runAt: parsed.data.runAt ?? at,
    attempts: 0,
    maxAttempts: parsed.data.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    dedupeKey: parsed.data.dedupeKey ?? null,
    createdAt: at,
  };
}

/** Serializes every writer of one dedupe key until the surrounding transaction ends. */
async function lockDedupeKey(tx: DbOrTx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${DEDUPE_LOCK_NAMESPACE}::int4, hashtext(${key}))`);
}

/**
 * Insert-unless-exists for a dedupe key.
 *
 * The table has no unique index to lean on (a finished job must not block a new one with the same key),
 * so writers of one key are serialized with a transaction-scoped advisory lock: the second writer waits
 * until the first commits or rolls back and then sees its row. That holds at READ COMMITTED, the
 * Postgres default that nothing in this app overrides; a caller-supplied REPEATABLE READ transaction
 * would check against its older snapshot.
 *
 * `.transaction()` on a caller's transaction is a savepoint; the lock still lasts until the caller's
 * transaction ends, which is what makes a rolled-back enqueue invisible and a committed one exclusive.
 */
async function insertUnlessExists(db: DbOrTx, row: typeof jobs.$inferInsert, key: string, scope: "active" | "any"): Promise<EnqueueResult> {
  return db.transaction(async (tx) => {
    await lockDedupeKey(tx, key);
    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, key), scope === "active" ? inArray(jobs.status, ACTIVE_STATUSES) : undefined))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (existing) return { id: existing.id, enqueued: false };
    await tx.insert(jobs).values(row);
    return { id: row.id, enqueued: true };
  });
}

/**
 * Adds a job. Pass the caller's transaction as `dbOrTx` so the job only exists if that transaction
 * commits. With `dedupeKey`, the call is a no-op while a queued or running job with the same key exists.
 */
export async function enqueue(type: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}, dbOrTx?: DbOrTx): Promise<EnqueueResult> {
  const row = newJobRow(type, payload, opts);
  const db = dbOrTx ?? (await getDb());
  if (!row.dedupeKey) {
    await db.insert(jobs).values(row);
    return { id: row.id, enqueued: true };
  }
  return insertUnlessExists(db, row, row.dedupeKey, "active");
}

/**
 * Like `enqueue` with a dedupe key, but a no-op when a job with that key exists in ANY status, so the
 * work is created once even after the first job finished. Used for one-job-per-period scheduling.
 * The guarantee lasts as long as the earlier row does (see `purgeSucceededJobs`).
 */
export async function enqueueOnce(
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions & { dedupeKey: string },
  dbOrTx?: DbOrTx,
): Promise<EnqueueResult> {
  const row = newJobRow(type, payload, opts);
  if (!row.dedupeKey) throw invalid("enqueueOnce requires a dedupeKey");
  return insertUnlessExists(dbOrTx ?? (await getDb()), row, row.dedupeKey, "any");
}

/* Claim -------------------------------------------------------------------------------------------- */

const claimInput = z.object({ limit: z.number().int().min(1).max(100), workerId: z.string().min(1).max(200) });

/**
 * Takes up to `limit` due jobs for this worker: marks them `running`, stamps the lock and counts the
 * attempt. Rows another worker is claiming at the same moment are skipped, never waited for.
 */
export async function claimDueJobs(opts: { limit: number; workerId: string }): Promise<Job[]> {
  const parsed = claimInput.safeParse(opts);
  if (!parsed.success) throw invalid(`Invalid claim: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const { limit, workerId } = parsed.data;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const at = now();
    const due = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, at)))
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt), asc(jobs.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);
    const claimed = await tx
      .update(jobs)
      .set({ status: "running", lockedAt: at, lockedBy: workerId, attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, ids))
      .returning();
    const order = new Map(ids.map((id, i) => [id, i]));
    return claimed.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  });
}

/* Run ---------------------------------------------------------------------------------------------- */

export type JobOutcome =
  /** Handler finished. */
  | "succeeded"
  /** Attempt failed; the job is queued again for `nextRunAt`. */
  | "retry"
  /** No attempts left, or no handler for the type. */
  | "dead"
  /** The lock was taken over while the handler ran (the job was requeued as stuck); nothing was recorded. */
  | "lost";

export interface JobRunResult {
  jobId: string;
  type: string;
  outcome: JobOutcome;
  error?: string;
  nextRunAt?: Date;
}

export interface RunOptions {
  /** Handlers to use instead of the app registry (tests, one-off scripts). */
  handlers?: JobHandlers;
  /** Per-attempt time limit. Default DEFAULT_JOB_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Graceful shutdown: once aborted, no further job is claimed (the one in progress finishes). */
  signal?: AbortSignal;
}

/**
 * The registry imports every domain's handlers, and those domains import this module to enqueue.
 * Loading it on demand keeps this module free of that cycle and keeps handler code out of pages that
 * only enqueue.
 */
async function registeredHandlers(): Promise<JobHandlers> {
  const { allJobHandlers } = await import("./registry");
  return allJobHandlers();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function describeError(e: unknown): string {
  let text: string;
  if (e instanceof Error) text = e.stack || `${e.name}: ${e.message}`;
  else if (typeof e === "string") text = e;
  else {
    try {
      text = JSON.stringify(e) ?? String(e);
    } catch {
      text = String(e);
    }
  }
  // Postgres text cannot hold NUL.
  return truncate(text.replaceAll("\u0000", ""), MAX_LAST_ERROR_LENGTH);
}

/** Only the worker that still holds this attempt's lock may record its result. */
function heldBy(job: Job) {
  return and(
    eq(jobs.id, job.id),
    eq(jobs.status, "running"),
    eq(jobs.attempts, job.attempts),
    job.lockedBy === null ? isNull(jobs.lockedBy) : eq(jobs.lockedBy, job.lockedBy),
  );
}

async function invoke(handler: JobHandler, job: Job, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Job timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    // The `.then` wrapper turns a synchronous throw into a rejection.
    await Promise.race([Promise.resolve().then(() => handler(job.payload, { jobId: job.id, attempt: job.attempts })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function recordSuccess(job: Job): Promise<JobRunResult> {
  const db = await getDb();
  const updated = await db
    .update(jobs)
    .set({ status: "succeeded", completedAt: now(), lockedAt: null, lockedBy: null })
    .where(heldBy(job))
    .returning({ id: jobs.id });
  return { jobId: job.id, type: job.type, outcome: updated.length > 0 ? "succeeded" : "lost" };
}

async function recordDead(job: Job, error: string): Promise<JobRunResult> {
  const db = await getDb();
  const updated = await db
    .update(jobs)
    .set({ status: "dead", completedAt: now(), lastError: error, lockedAt: null, lockedBy: null })
    .where(heldBy(job))
    .returning({ id: jobs.id });
  return { jobId: job.id, type: job.type, outcome: updated.length > 0 ? "dead" : "lost", error };
}

async function recordFailure(job: Job, cause: unknown): Promise<JobRunResult> {
  const error = describeError(cause);
  if (job.attempts >= job.maxAttempts) return recordDead(job, error);
  const nextRunAt = addMs(now(), retryDelayMs(job.attempts));
  const db = await getDb();
  const updated = await db
    .update(jobs)
    .set({ status: "queued", runAt: nextRunAt, lastError: error, lockedAt: null, lockedBy: null })
    .where(heldBy(job))
    .returning({ id: jobs.id });
  return updated.length > 0 ? { jobId: job.id, type: job.type, outcome: "retry", error, nextRunAt } : { jobId: job.id, type: job.type, outcome: "lost", error };
}

/**
 * Runs one claimed job (a row returned by `claimDueJobs`) and records the result: `succeeded`; or the
 * error plus a retry on the RETRY_SCHEDULE_MS backoff; or `dead` after `maxAttempts` attempts or when
 * no handler is registered for its type.
 */
export async function runJob(job: Job, opts: RunOptions = {}): Promise<JobRunResult> {
  if (job.status !== "running") throw conflict(`Job ${job.id} must be claimed before it runs (status is "${job.status}")`);
  const handlers = opts.handlers ?? (await registeredHandlers());
  const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type] : undefined;
  let result: JobRunResult;
  if (!handler) {
    result = await recordDead(job, `No handler is registered for job type "${job.type}"`);
  } else {
    try {
      await invoke(handler, job, opts.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS);
      result = await recordSuccess(job);
    } catch (e) {
      result = await recordFailure(job, e);
    }
  }
  if (result.outcome !== "succeeded") {
    const firstLine = result.error?.split("\n", 1)[0] ?? "";
    console.error(`[jobs] ${job.type} ${job.id} attempt ${job.attempts}/${job.maxAttempts}: ${result.outcome}${firstLine ? ` (${firstLine})` : ""}`);
  }
  return result;
}

export interface RunDueResult {
  ran: number;
  succeeded: number;
  /** Attempts that did not succeed (retry scheduled, dead-lettered, or lock lost). */
  failed: number;
}

/**
 * Claims and runs up to `limit` due jobs, one after another. Each job is claimed right before it runs,
 * so a lock is never older than the job's own run time.
 */
export async function runDueJobs(opts: { limit?: number; workerId?: string } & RunOptions = {}): Promise<RunDueResult> {
  const limit = opts.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1) throw invalid("limit must be a positive integer");
  const workerId = opts.workerId ?? defaultWorkerId();
  // Resolved before anything is claimed: a broken registry must not consume attempts.
  const handlers = opts.handlers ?? (await registeredHandlers());
  const result: RunDueResult = { ran: 0, succeeded: 0, failed: 0 };
  while (result.ran < limit && !opts.signal?.aborted) {
    const [job] = await claimDueJobs({ limit: 1, workerId });
    if (!job) break;
    result.ran++;
    try {
      const run = await runJob(job, { handlers, timeoutMs: opts.timeoutMs });
      if (run.outcome === "succeeded") result.succeeded++;
      else result.failed++;
    } catch (e) {
      // The outcome could not be written (database trouble). The job stays locked and is recovered by requeueStuckJobs.
      result.failed++;
      console.error(`[jobs] could not record the result of ${job.type} ${job.id}`, e);
    }
  }
  return result;
}

/* Recovery and housekeeping -------------------------------------------------------------------------- */

/**
 * Releases jobs whose worker died mid-run (lock older than `olderThanMs`). The interrupted attempt
 * counts: a job that keeps killing its worker is dead-lettered instead of looping forever.
 */
export async function requeueStuckJobs(opts: { olderThanMs?: number } = {}): Promise<{ requeued: number; dead: number }> {
  const olderThanMs = opts.olderThanMs ?? DEFAULT_STUCK_AFTER_MS;
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw invalid("olderThanMs must be a non-negative number");
  const db = await getDb();
  const at = now();
  const stuck = and(eq(jobs.status, "running"), or(isNull(jobs.lockedAt), lt(jobs.lockedAt, addMs(at, -olderThanMs))));
  const lockedBy = sql`coalesce(${jobs.lockedBy}, 'unknown')`;
  const dead = await db
    .update(jobs)
    .set({
      status: "dead",
      completedAt: at,
      lastError: sql`'Worker ' || ${lockedBy} || ' stopped responding while running this job; no attempts left'`,
      lockedAt: null,
      lockedBy: null,
    })
    .where(and(stuck, gte(jobs.attempts, jobs.maxAttempts)))
    .returning({ id: jobs.id });
  const requeued = await db
    .update(jobs)
    .set({
      status: "queued",
      runAt: at,
      lastError: sql`'Worker ' || ${lockedBy} || ' stopped responding while running this job; requeued'`,
      lockedAt: null,
      lockedBy: null,
    })
    .where(and(stuck, lt(jobs.attempts, jobs.maxAttempts)))
    .returning({ id: jobs.id });
  if (dead.length + requeued.length > 0) console.warn(`[jobs] recovered stuck jobs: ${requeued.length} requeued, ${dead.length} dead`);
  return { requeued: requeued.length, dead: dead.length };
}

/**
 * Deletes succeeded jobs older than `olderThanMs`. The newest recurring job of each type is always kept,
 * because its row is what stops the current period from being scheduled a second time.
 */
export async function purgeSucceededJobs(opts: { olderThanMs?: number } = {}): Promise<{ purged: number }> {
  const olderThanMs = opts.olderThanMs ?? SUCCEEDED_JOB_RETENTION_MS;
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw invalid("olderThanMs must be a non-negative number");
  const db = await getDb();
  const cutoff = addMs(now(), -olderThanMs).toISOString();
  const recurring = `${RECURRING_KEY_PREFIX}%`;
  // The run_at condition is implied by the completed_at one (a job never completes before its run_at);
  // it is there so the (status, run_at) index bounds the scan to old rows.
  const rows = await execRows<{ id: string }>(
    db,
    sql`
      delete from ${jobs} j
      where j.status = 'succeeded'
        and j.completed_at < ${cutoff}::timestamptz
        and j.run_at < ${cutoff}::timestamptz
        and (
          j.dedupe_key is null
          or j.dedupe_key not like ${recurring}
          or exists (
            select 1 from ${jobs} newer
            where newer.type = j.type and newer.dedupe_key like ${recurring} and newer.created_at > j.created_at
          )
        )
      returning j.id`,
  );
  return { purged: rows.length };
}

/* Admin console ------------------------------------------------------------------------------------ */

export interface JobStats {
  /** Row counts per status (every status is present, zero when empty). */
  byStatus: Record<JobStatus, number>;
  /** Queued and due now. */
  due: number;
  /** Queued for later (scheduled or waiting for a retry). */
  scheduled: number;
  /** Queued again after at least one failed attempt. */
  retrying: number;
  /** `runAt` of the longest-waiting due job. */
  oldestDueAt: Date | null;
  byType: Array<{ type: string } & Record<JobStatus, number>>;
}

export async function getJobStats(): Promise<JobStats> {
  const db = await getDb();
  const at = now();
  const counts = await db
    .select({ type: jobs.type, status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.type, jobs.status);
  const [queued] = await db
    .select({
      due: sql<number>`(count(*) filter (where ${jobs.runAt} <= ${at.toISOString()}::timestamptz))::int`,
      retrying: sql<number>`(count(*) filter (where ${jobs.attempts} > 0))::int`,
      total: sql<number>`count(*)::int`,
      oldestDueAt: sql<Date | null>`min(${jobs.runAt}) filter (where ${jobs.runAt} <= ${at.toISOString()}::timestamptz)`.mapWith(jobs.runAt),
    })
    .from(jobs)
    .where(eq(jobs.status, "queued"));

  const zero = (): Record<JobStatus, number> => ({ queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 });
  const byStatus = zero();
  const perType = new Map<string, Record<JobStatus, number>>();
  for (const row of counts) {
    if (!JOB_STATUSES.includes(row.status)) continue;
    byStatus[row.status] += row.n;
    const entry = perType.get(row.type) ?? zero();
    entry[row.status] += row.n;
    perType.set(row.type, entry);
  }
  const due = Number(queued?.due ?? 0);
  const total = Number(queued?.total ?? 0);
  return {
    byStatus,
    due,
    scheduled: total - due,
    retrying: Number(queued?.retrying ?? 0),
    oldestDueAt: queued?.oldestDueAt ?? null,
    byType: [...perType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, c]) => ({ type, ...c })),
  };
}

const listInput = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed", "dead"]).optional(),
  type: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Newest first. */
export async function listJobs(opts: { status?: JobStatus; type?: string; limit?: number; offset?: number } = {}): Promise<Job[]> {
  const parsed = listInput.safeParse(opts);
  if (!parsed.success) throw invalid(`Invalid job filter: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const { status, type, limit, offset } = parsed.data;
  const db = await getDb();
  return db
    .select()
    .from(jobs)
    .where(and(status ? eq(jobs.status, status) : undefined, type ? eq(jobs.type, type) : undefined))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(limit)
    .offset(offset);
}

export async function getJob(id: string): Promise<Job> {
  const db = await getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) throw notFound("Job");
  return job;
}

/**
 * Operator retry. A dead (or failed) job is queued again with a fresh attempt budget; a job that is
 * waiting for its next retry is made due now. Running and succeeded jobs are refused.
 */
export async function retryJob(id: string): Promise<Job> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
    if (!job) throw notFound("Job");
    if (job.status === "running") throw conflict("This job is running; wait for it to finish");
    if (job.status === "succeeded") throw conflict("This job already succeeded");
    const revived = job.status !== "queued";
    if (revived && job.dedupeKey) {
      // Reviving must not break "at most one queued/running job per dedupe key".
      await lockDedupeKey(tx, job.dedupeKey);
      const [active] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.dedupeKey, job.dedupeKey), inArray(jobs.status, ACTIVE_STATUSES), ne(jobs.id, job.id)))
        .limit(1);
      if (active) throw conflict(`Job ${active.id} with the same dedupe key is already queued or running`);
    }
    const [updated] = await tx
      .update(jobs)
      .set({ status: "queued", runAt: now(), attempts: revived ? 0 : job.attempts, completedAt: null, lockedAt: null, lockedBy: null })
      .where(eq(jobs.id, id))
      .returning();
    return updated;
  });
}
