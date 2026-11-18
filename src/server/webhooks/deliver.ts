import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { BRAND } from "@/lib/brand";
import { addMs, MS, now } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { newSortableId } from "@/server/audit";
import { enqueue } from "@/server/jobs";
import { buildDeliveryBody, type DeliverableEvent } from "./payload";
import { openEndpointSecrets, signingSecrets } from "./secrets";
import { buildSignedRequest, type SignedRequest } from "./signing";
import { assertSafeWebhookUrl, type ResolvedAddress, type Resolver } from "./ssrf";

/**
 * Webhook delivery: one `webhook_deliveries` row per (event, endpoint), one `webhook.deliver` job per
 * attempt. A failed attempt is recorded on the row and the next attempt is enqueued for its scheduled
 * time in the same transaction, so the retry schedule is the delivery's own and independent of the job
 * queue's backoff (which only covers infrastructure failures such as a database outage).
 */

const { webhookDeliveries: deliveries, webhookEndpoints: endpoints, events } = schema;

export type WebhookDelivery = typeof deliveries.$inferSelect;

/* Policy constants --------------------------------------------------------------------------------- */

export const WEBHOOK_DELIVER_JOB = "webhook.deliver";
export const WEBHOOK_RETRY_JOB = "webhook.retry";

/** Delay before retry n (after attempt n failed). After the last one the delivery is dead. */
export const WEBHOOK_RETRY_SCHEDULE_MS: readonly number[] = [MS.minute, 5 * MS.minute, 30 * MS.minute, 2 * MS.hour, 12 * MS.hour, 24 * MS.hour];

/** The first attempt plus one per scheduled retry. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MS.length + 1;

/** Whole-request time limit: connect, send, and wait for the response status. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Characters of the response body kept on the delivery row. */
export const RESPONSE_EXCERPT_CHARS = 500;

/** An endpoint is disabled once this many deliveries in a row ran out of retries. */
export const AUTO_DISABLE_AFTER_DEAD_DELIVERIES = 20;

/** How often the safety-net sweep looks for due deliveries that have no job (see `sweepDueDeliveries`). */
export const RETRY_SWEEP_EVERY_MS = 5 * MS.minute;

/** The sweep leaves a delivery alone until it is this overdue, so it never races the regular job. */
export const RETRY_SWEEP_GRACE_MS = 2 * MS.minute;

/** A receiver's Retry-After can push the next attempt later than the schedule, but never by more than this. */
export const MAX_RETRY_AFTER_MS = 24 * MS.hour;

/** Bytes of the response body read before the connection is dropped (500 characters are at most 2000 bytes of UTF-8). */
const MAX_RESPONSE_BYTES = 4096;
const MAX_ERROR_CHARS = 500;
const USER_AGENT = `${BRAND.name}-Webhooks/1.0`;

export function deliveryJobKey(deliveryId: string, attempt: number): string {
  return `${WEBHOOK_DELIVER_JOB}:${deliveryId}:${attempt}`;
}

/* Fan-out ------------------------------------------------------------------------------------------ */

function subscribes(eventTypes: string[], type: string): boolean {
  return eventTypes.includes("*") || eventTypes.includes(type);
}

/**
 * Creates a pending delivery, and the job for its first attempt, for every active endpoint of the
 * event's organization that subscribes to its type. Runs entirely on `dbOrTx`, so inside the caller's
 * transaction nothing is delivered unless the event itself commits.
 */
export async function createDeliveriesForEvent(event: DeliverableEvent & { orgId: string }, dbOrTx: DbOrTx): Promise<WebhookDelivery[]> {
  const active = await dbOrTx
    .select({ id: endpoints.id, eventTypes: endpoints.eventTypes })
    .from(endpoints)
    .where(and(eq(endpoints.orgId, event.orgId), eq(endpoints.status, "active")))
    .orderBy(asc(endpoints.createdAt), asc(endpoints.id))
    // Holds off a concurrent deleteEndpoint until this transaction ends, so the delivery rows below never
    // point at an endpoint that vanished mid-insert (which would fail the caller's whole transaction).
    .for("share");
  const targets = active.filter((e) => subscribes(e.eventTypes, event.type));
  if (targets.length === 0) return [];
  const at = now();
  const created = await dbOrTx
    .insert(deliveries)
    .values(
      targets.map((target) => ({
        id: newSortableId("webhookDelivery"),
        endpointId: target.id,
        eventId: event.id,
        orgId: event.orgId,
        eventType: event.type,
        attempt: 0,
        status: "pending" as const,
        nextAttemptAt: at,
        createdAt: at,
      })),
    )
    .returning();
  for (const delivery of created) await enqueueAttempt(delivery.id, 1, at, dbOrTx);
  return created;
}

export async function enqueueAttempt(deliveryId: string, attempt: number, runAt: Date, dbOrTx?: DbOrTx): Promise<boolean> {
  const res = await enqueue(WEBHOOK_DELIVER_JOB, { deliveryId, attempt }, { runAt, dedupeKey: deliveryJobKey(deliveryId, attempt) }, dbOrTx);
  return res.enqueued;
}

/* HTTP --------------------------------------------------------------------------------------------- */

export interface HttpAttempt {
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  /** Start of the response body. */
  excerpt: string | null;
  /** Why no response arrived. */
  error: string | null;
  /** Raw Retry-After response header, if the receiver sent one. */
  retryAfter: string | null;
}

const NO_RESPONSE = { status: null, excerpt: null, retryAfter: null } as const;

/** Makes the socket connect to the addresses that passed the SSRF check instead of resolving the name again. */
function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
    else callback(null, addresses[0].address, addresses[0].family);
  };
}

function excerptOf(body: Buffer): string | null {
  const text = new TextDecoder("utf-8")
    .decode(body)
    // Postgres text cannot hold NUL; other control characters only garble the dashboard.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const excerpt = Array.from(text).slice(0, RESPONSE_EXCERPT_CHARS).join("");
  return excerpt.length > 0 ? excerpt : null;
}

function describeNetworkError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);
  const text = typeof code === "string" && !message.includes(code) ? `${code}: ${message}` : message;
  return text.replaceAll("\u0000", "").slice(0, MAX_ERROR_CHARS);
}

/**
 * POSTs the signed request and reports what came back. Never throws and never follows a redirect (a 3xx
 * is reported as its status). The outcome is decided by the status line: once it arrived, a slow or
 * broken body only shortens the excerpt.
 */
export function sendSignedRequest(request: SignedRequest, addresses: ResolvedAddress[], timeoutMs: number): Promise<HttpAttempt> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let req: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    const chunks: Buffer[] = [];
    let received = 0;

    const finish = (result: HttpAttempt): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      req?.destroy();
    };
    const finishWithResponse = (res: http.IncomingMessage): void =>
      finish({ status: res.statusCode ?? null, excerpt: excerptOf(Buffer.concat(chunks)), error: null, retryAfter: res.headers["retry-after"] ?? null });

    try {
      const url = new URL(request.url);
      const body = Buffer.from(request.body, "utf8");
      const transport = url.protocol === "https:" ? https : http;
      req = transport.request(
        url,
        {
          method: request.method,
          // A fresh connection per attempt: no pooled socket to an address that was vetted for another request.
          agent: false,
          lookup: pinnedLookup(addresses),
          headers: { ...request.headers, "content-length": String(body.length) },
        },
        (res) => {
          response = res;
          res.on("data", (chunk: Buffer) => {
            if (received < MAX_RESPONSE_BYTES) chunks.push(chunk.subarray(0, MAX_RESPONSE_BYTES - received));
            received += chunk.length;
            if (received >= MAX_RESPONSE_BYTES) finishWithResponse(res);
          });
          res.on("end", () => finishWithResponse(res));
          res.on("error", () => finishWithResponse(res));
          res.on("close", () => finishWithResponse(res));
        },
      );
      req.on("error", (e) => {
        if (response) finishWithResponse(response);
        else finish({ ...NO_RESPONSE, error: describeNetworkError(e) });
      });
      timer = setTimeout(() => {
        if (response) finishWithResponse(response);
        else finish({ ...NO_RESPONSE, error: `No response within ${timeoutMs} ms` });
      }, timeoutMs);
      req.end(body);
    } catch (e) {
      finish({ ...NO_RESPONSE, error: describeNetworkError(e) });
    }
  });
}

/** Milliseconds a Retry-After header asks us to wait (delta-seconds or an HTTP date), or 0 when absent or unusable. */
export function retryAfterMs(header: string | null, at: Date): number {
  if (!header) return 0;
  const value = header.trim();
  const ms = /^\d{1,9}$/.test(value) ? Number(value) * 1000 : Date.parse(value) - at.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : 0;
}

/* One attempt -------------------------------------------------------------------------------------- */

export type DeliveryOutcome =
  /** The endpoint answered 2xx. */
  | "succeeded"
  /** The attempt failed and the next one is scheduled for `nextAttemptAt`. */
  | "retry_scheduled"
  /** No further attempts: retries exhausted, the endpoint answered 410 Gone, or the endpoint is disabled. */
  | "dead"
  /** Nothing was sent: the delivery is gone or finished, or this attempt was already made. */
  | "skipped";

export interface DeliveryAttemptResult {
  outcome: DeliveryOutcome;
  reason?: "delivery_not_found" | "already_finished" | "stale_attempt" | "endpoint_disabled" | "endpoint_gone" | "retries_exhausted";
  status?: number | null;
  nextAttemptAt?: Date;
}

export interface DeliveryDeps {
  /** DNS override for the delivery-time SSRF check. */
  resolve?: Resolver;
  /** Default WEBHOOK_TIMEOUT_MS. */
  timeoutMs?: number;
}

const OPEN_STATUSES = ["pending", "failed"] as const;

/**
 * Makes attempt number `attempt` (1-based) of a delivery and records it. Idempotent per attempt: a job
 * that runs again after its attempt was recorded, or after the delivery finished, sends nothing. Two
 * workers running the same attempt at the very same moment can both send; only one result is recorded
 * and only one retry is scheduled (receivers deduplicate on webhook-id).
 */
export async function attemptDelivery(deliveryId: string, attempt: number, deps: DeliveryDeps = {}): Promise<DeliveryAttemptResult> {
  const db = await getDb();
  const [row] = await db
    .select({ delivery: deliveries, endpoint: endpoints, event: events })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .innerJoin(events, eq(events.id, deliveries.eventId))
    .where(eq(deliveries.id, deliveryId));
  if (!row) return { outcome: "skipped", reason: "delivery_not_found" };
  const { delivery, endpoint, event } = row;
  if (delivery.status === "succeeded" || delivery.status === "dead") return { outcome: "skipped", reason: "already_finished" };
  if (delivery.attempt !== attempt - 1) return { outcome: "skipped", reason: "stale_attempt" };

  if (endpoint.status !== "active") {
    // Closed without an attempt, and not counted against the endpoint: nothing was sent.
    await db
      .update(deliveries)
      .set({ status: "dead", nextAttemptAt: null, error: "Not delivered: the endpoint is disabled" })
      .where(and(eq(deliveries.id, delivery.id), inArray(deliveries.status, OPEN_STATUSES)));
    return { outcome: "dead", reason: "endpoint_disabled" };
  }

  const sentAt = now();
  let result: HttpAttempt;
  try {
    const target = await assertSafeWebhookUrl(endpoint.url, { phase: "deliver", resolve: deps.resolve });
    const { body, contentType } = buildDeliveryBody(event, endpoint.format);
    const request = buildSignedRequest({
      url: target.url,
      id: event.id,
      timestamp: sentAt,
      body,
      contentType,
      secrets: signingSecrets(openEndpointSecrets(endpoint.secretEnc), sentAt),
      userAgent: USER_AGENT,
    });
    result = await sendSignedRequest(request, target.addresses, deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS);
  } catch (e) {
    // The URL no longer passes the SSRF check, or the request could not be built. Both count as a failed attempt.
    result = { ...NO_RESPONSE, error: isAppError(e) ? e.message : `Could not send the request: ${describeNetworkError(e)}` };
  }

  const finishedAt = now();
  const ok = result.status !== null && result.status >= 200 && result.status < 300;
  // 410 Gone is the receiver saying it no longer wants webhooks (Standard Webhooks): stop and disable.
  const gone = result.status === 410;
  const exhausted = attempt >= WEBHOOK_MAX_ATTEMPTS;
  const status = ok ? "succeeded" : gone || exhausted ? "dead" : "failed";
  // The schedule is the floor; a receiver that asks for more time (Retry-After, e.g. with 429 or 503) gets it.
  const nextAttemptAt = status === "failed" ? addMs(finishedAt, Math.max(WEBHOOK_RETRY_SCHEDULE_MS[attempt - 1], retryAfterMs(result.retryAfter, finishedAt))) : null;
  const error = ok ? null : (result.error ?? `The endpoint responded with HTTP ${result.status}`);

  return db.transaction(async (tx): Promise<DeliveryAttemptResult> => {
    const recorded = await tx
      .update(deliveries)
      .set({ attempt, status, responseStatus: result.status, responseExcerpt: result.excerpt, error, nextAttemptAt, deliveredAt: ok ? finishedAt : null })
      // Guards against a duplicate run of this job and against a resend or delete that closed the delivery meanwhile.
      .where(and(eq(deliveries.id, delivery.id), eq(deliveries.attempt, attempt - 1), inArray(deliveries.status, OPEN_STATUSES)))
      .returning({ id: deliveries.id });
    if (recorded.length === 0) return { outcome: "skipped", reason: "stale_attempt" };

    if (status === "succeeded") {
      await tx.update(endpoints).set({ lastSuccessAt: finishedAt, failureCount: 0 }).where(eq(endpoints.id, endpoint.id));
      return { outcome: "succeeded", status: result.status };
    }
    if (status === "failed" && nextAttemptAt) {
      await tx.update(endpoints).set({ lastFailureAt: finishedAt }).where(eq(endpoints.id, endpoint.id));
      await enqueueAttempt(delivery.id, attempt + 1, nextAttemptAt, tx);
      return { outcome: "retry_scheduled", status: result.status, nextAttemptAt };
    }
    await tx
      .update(endpoints)
      .set({
        lastFailureAt: finishedAt,
        failureCount: sql`${endpoints.failureCount} + 1`,
        status: gone ? "disabled" : sql`case when ${endpoints.failureCount} + 1 >= ${AUTO_DISABLE_AFTER_DEAD_DELIVERIES} then 'disabled' else ${endpoints.status} end`,
      })
      .where(eq(endpoints.id, endpoint.id));
    return { outcome: "dead", reason: gone ? "endpoint_gone" : "retries_exhausted", status: result.status };
  });
}

/* Safety net --------------------------------------------------------------------------------------- */

/**
 * Re-enqueues deliveries that are due but have no live job, which happens only when the job for an
 * attempt was lost or dead-lettered (for example after a long database outage). The dedupe key makes
 * this a no-op for every delivery whose job still exists.
 */
export async function sweepDueDeliveries(opts: { limit?: number } = {}): Promise<{ checked: number; enqueued: number }> {
  const db = await getDb();
  const at = now();
  const due = await db
    .select({ id: deliveries.id, attempt: deliveries.attempt })
    .from(deliveries)
    .where(and(inArray(deliveries.status, OPEN_STATUSES), lte(deliveries.nextAttemptAt, addMs(at, -RETRY_SWEEP_GRACE_MS))))
    .orderBy(asc(deliveries.nextAttemptAt))
    .limit(opts.limit ?? 500);
  let enqueued = 0;
  for (const delivery of due) {
    if (await enqueueAttempt(delivery.id, delivery.attempt + 1, at)) enqueued++;
  }
  return { checked: due.length, enqueued };
}
