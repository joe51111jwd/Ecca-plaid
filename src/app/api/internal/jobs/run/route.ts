import { z } from "zod";
import { safeEqual, sha256Hex } from "@/lib/crypto";
import { env, isProd } from "@/lib/env";
import { badRequest, toErrorBody, unauthenticated } from "@/lib/errors";
import { getJobStats } from "@/server/jobs";
import { runQueueCycle } from "@/server/jobs/runner";

/**
 * Cron-triggered job runner for hosts without a long-running worker.
 *
 *   POST /api/internal/jobs/run            one pass: schedule recurring jobs, recover stuck jobs, run due jobs
 *   POST /api/internal/jobs/run?drain=1    keep going until no due job is left (bounded by rounds and time)
 *   optional ?limit=N                      jobs per round (1-100, default 10)
 *
 * GET does the same because Vercel Cron can only send GET. Callers must send
 * `Authorization: Bearer <CRON_SECRET>`. Without a configured CRON_SECRET the endpoint is open outside
 * production (local development and end-to-end tests use it to flush the queue) and closed in production.
 */

/** Seconds a serverless host may let this run; the drain's own time budget (50 s) stays below it. */
export const maxDuration = 60;

const query = z.object({
  drain: z.enum(["1", "true", "0", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

let warnedAboutMissingSecret = false;

function isAuthorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) {
    if (!isProd()) return true;
    if (!warnedAboutMissingSecret) {
      warnedAboutMissingSecret = true;
      console.warn("[jobs] /api/internal/jobs/run was called but CRON_SECRET is not set; the endpoint stays closed in production");
    }
    return false;
  }
  // Both sides are hashed first so the comparison takes the same time whatever the caller sent.
  return safeEqual(sha256Hex(request.headers.get("authorization") ?? ""), sha256Hex(`Bearer ${secret}`));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function handle(request: Request): Promise<Response> {
  try {
    if (!isAuthorized(request)) throw unauthenticated("A valid cron secret is required");
    const params = new URL(request.url).searchParams;
    const parsed = query.safeParse({ drain: params.get("drain") ?? undefined, limit: params.get("limit") ?? undefined });
    if (!parsed.success) throw badRequest("Invalid query: drain must be 1 or 0, limit must be an integer from 1 to 100");
    const drain = parsed.data.drain === "1" || parsed.data.drain === "true";

    const cycle = await runQueueCycle({ drain, limit: parsed.data.limit });
    const stats = await getJobStats();
    return json({
      ok: true,
      drain,
      ...cycle,
      queue: { due: stats.due, scheduled: stats.scheduled, running: stats.byStatus.running, dead: stats.byStatus.dead },
    });
  } catch (e) {
    const { status, body } = toErrorBody(e);
    if (status >= 500) console.error("[jobs] /api/internal/jobs/run failed", e);
    return json(body, status);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
