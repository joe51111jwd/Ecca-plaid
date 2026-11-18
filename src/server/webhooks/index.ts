import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import type { DeliveryStatus } from "@/db/schema";
import { addMs, MS, now } from "@/lib/clock";
import { conflict, invalid, notFound } from "@/lib/errors";
import { newSortableId } from "@/server/audit";
import { isEventType } from "@/server/events/types";
import { enqueueAttempt, type WebhookDelivery } from "./deliver";
import { WEBHOOK_FORMATS, type WebhookFormat } from "./payload";
import { openEndpointSecrets, sealEndpointSecrets } from "./secrets";
import { generateWebhookSecret } from "./signing";
import { assertSafeWebhookUrl } from "./ssrf";

/**
 * Webhook endpoints and deliveries, always scoped to one organization. An id that belongs to another
 * organization behaves exactly like an id that does not exist (`not_found`).
 *
 * The signing secret is returned exactly once, by `createEndpoint` and `rotateSecret`; it is stored
 * encrypted and never appears in any other result.
 */

export {
  AUTO_DISABLE_AFTER_DEAD_DELIVERIES,
  createDeliveriesForEvent,
  RESPONSE_EXCERPT_CHARS,
  WEBHOOK_DELIVER_JOB,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_JOB,
  WEBHOOK_RETRY_SCHEDULE_MS,
  WEBHOOK_TIMEOUT_MS,
  type WebhookDelivery,
} from "./deliver";
export { buildDeliveryBody, WEBHOOK_FORMATS, type DeliverableEvent, type WebhookFormat } from "./payload";
export {
  buildSignedRequest,
  checkWebhookSignature,
  DEFAULT_TOLERANCE_SECONDS,
  signWebhook,
  verifyWebhookSignature,
  WEBHOOK_HEADER,
  type SignedRequest,
  type VerifyWebhookInput,
  type WebhookHeaders,
  type WebhookVerification,
} from "./signing";
export { assertSafeWebhookUrl, setWebhookResolverForTests, type Resolver, type ResolvedAddress } from "./ssrf";

const { webhookEndpoints: endpoints, webhookDeliveries: deliveries } = schema;

/* Policy constants --------------------------------------------------------------------------------- */

/** Endpoints one organization may have. Every event fans out to all of them. */
export const MAX_ENDPOINTS_PER_ORG = 20;

/** After a rotation, deliveries carry a signature from the previous secret as well for this long. */
export const SECRET_ROTATION_OVERLAP_MS = 24 * MS.hour;

const MAX_DESCRIPTION_LENGTH = 500;

/* Types -------------------------------------------------------------------------------------------- */

type EndpointRow = typeof endpoints.$inferSelect;

/** An endpoint as shown to its organization. There is deliberately no secret field. */
export interface WebhookEndpoint {
  id: string;
  orgId: string;
  url: string;
  description: string | null;
  /** Subscribed event types; `["*"]` means all. */
  eventTypes: string[];
  format: WebhookFormat;
  status: "active" | "disabled";
  /** Deliveries in a row that ran out of retries since the last success. Reaching 20 disables the endpoint. */
  failureCount: number;
  lastSuccessAt: Date | null;
  /** Time of the most recent failed attempt. */
  lastFailureAt: Date | null;
  createdAt: Date;
}

function toEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    orgId: row.orgId,
    url: row.url,
    description: row.description,
    eventTypes: row.eventTypes,
    format: row.format,
    status: row.status,
    failureCount: row.failureCount,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    createdAt: row.createdAt,
  };
}

/* Input validation --------------------------------------------------------------------------------- */

const description = z
  .string()
  .trim()
  .max(MAX_DESCRIPTION_LENGTH, `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`)
  .nullish()
  .transform((v) => (v ? v : null));

const eventTypes = z
  .array(z.string())
  .min(1, "Choose at least one event type")
  .superRefine((types, ctx) => {
    for (const type of types) {
      if (type !== "*" && !isEventType(type)) ctx.addIssue({ code: "custom", message: `Unknown event type "${type}"` });
    }
  })
  // "*" already covers everything; otherwise keep each type once, in the order given.
  .transform((types) => (types.includes("*") ? ["*"] : [...new Set(types)]));

const format = z.enum(WEBHOOK_FORMATS as [WebhookFormat, ...WebhookFormat[]], "Unknown webhook format");
const id = z.string().min(1);

const createInput = z.object({
  orgId: id,
  url: z.string(),
  description: description.optional(),
  eventTypes: eventTypes.default(["*"]),
  format: format.default("native"),
});

const updateInput = z.object({ url: z.string().optional(), description: description.optional(), eventTypes: eventTypes.optional(), format: format.optional() }).strict();

function parse<T>(schemaToUse: z.ZodType<T>, input: unknown): T {
  const res = schemaToUse.safeParse(input);
  if (res.success) return res.data;
  const fields: Record<string, string> = {};
  for (const issue of res.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw invalid(Object.values(fields)[0] ?? "Invalid input", { fields });
}

/* Endpoints ---------------------------------------------------------------------------------------- */

async function loadEndpoint(orgId: string, endpointId: string): Promise<EndpointRow> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(endpoints)
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.orgId, orgId)));
  if (!row) throw notFound("Webhook endpoint");
  return row;
}

export interface CreateEndpointInput {
  orgId: string;
  url: string;
  description?: string | null;
  /** Event types to receive, or `["*"]` (the default) for all. */
  eventTypes?: string[];
  /** Default "native". */
  format?: WebhookFormat;
}

/**
 * Registers an endpoint and returns its signing secret. This is the only time the secret is available
 * (apart from `rotateSecret`, which replaces it), so the caller must show it to the user now.
 */
export async function createEndpoint(input: CreateEndpointInput): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const data = parse(createInput, input);
  const target = await assertSafeWebhookUrl(data.url, { phase: "register" });
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(endpoints)
    .where(eq(endpoints.orgId, data.orgId));
  if (n >= MAX_ENDPOINTS_PER_ORG) throw conflict(`An organization can have at most ${MAX_ENDPOINTS_PER_ORG} webhook endpoints. Delete one to add another.`);

  const secret = generateWebhookSecret();
  const [row] = await db
    .insert(endpoints)
    .values({
      id: newSortableId("webhookEndpoint"),
      orgId: data.orgId,
      url: target.url,
      description: data.description ?? null,
      secretEnc: sealEndpointSecrets({ current: secret }),
      eventTypes: data.eventTypes,
      format: data.format,
      status: "active",
      failureCount: 0,
      createdAt: now(),
    })
    .returning();
  return { endpoint: toEndpoint(row), secret };
}

/** Oldest first. */
export async function listEndpoints(orgId: string): Promise<WebhookEndpoint[]> {
  const db = await getDb();
  const rows = await db.select().from(endpoints).where(eq(endpoints.orgId, orgId)).orderBy(endpoints.createdAt, endpoints.id);
  return rows.map(toEndpoint);
}

export async function getEndpoint(orgId: string, endpointId: string): Promise<WebhookEndpoint> {
  return toEndpoint(await loadEndpoint(orgId, endpointId));
}

export interface UpdateEndpointInput {
  url?: string;
  /** null or "" clears it. */
  description?: string | null;
  eventTypes?: string[];
  format?: WebhookFormat;
}

/** Changes the given fields. A new URL goes through the same checks as on creation. */
export async function updateEndpoint(orgId: string, endpointId: string, patch: UpdateEndpointInput): Promise<WebhookEndpoint> {
  const data = parse(updateInput, patch);
  const current = await loadEndpoint(orgId, endpointId);
  const changes: Partial<Pick<EndpointRow, "url" | "description" | "eventTypes" | "format">> = {};
  if (data.url !== undefined) changes.url = (await assertSafeWebhookUrl(data.url, { phase: "register" })).url;
  if (patch.description !== undefined) changes.description = data.description ?? null;
  if (data.eventTypes !== undefined) changes.eventTypes = data.eventTypes;
  if (data.format !== undefined) changes.format = data.format;
  if (Object.keys(changes).length === 0) return toEndpoint(current);
  const db = await getDb();
  const [row] = await db
    .update(endpoints)
    .set(changes)
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.orgId, orgId)))
    .returning();
  if (!row) throw notFound("Webhook endpoint");
  return toEndpoint(row);
}

/**
 * Replaces the signing secret and returns the new one (shown once). For `overlapMs` (default 24 hours)
 * deliveries are signed with both the new and the previous secret, so the receiver can switch without
 * rejecting anything. Pass `overlapMs: 0` when the old secret leaked and must stop working immediately.
 */
export async function rotateSecret(orgId: string, endpointId: string, opts: { overlapMs?: number } = {}): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const overlapMs = opts.overlapMs ?? SECRET_ROTATION_OVERLAP_MS;
  if (!Number.isFinite(overlapMs) || overlapMs < 0) throw invalid("overlapMs must be zero or a positive number of milliseconds");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(endpoints)
      .where(and(eq(endpoints.id, endpointId), eq(endpoints.orgId, orgId)))
      .for("update");
    if (!current) throw notFound("Webhook endpoint");
    const secret = generateWebhookSecret();
    const previous = openEndpointSecrets(current.secretEnc).current;
    const secretEnc = sealEndpointSecrets({ current: secret, ...(overlapMs > 0 ? { previous: { secret: previous, expiresAt: addMs(now(), overlapMs) } } : {}) });
    const [row] = await tx.update(endpoints).set({ secretEnc }).where(eq(endpoints.id, current.id)).returning();
    return { endpoint: toEndpoint(row), secret };
  });
}

async function setStatus(orgId: string, endpointId: string, changes: Partial<Pick<EndpointRow, "status" | "failureCount">>): Promise<WebhookEndpoint> {
  const db = await getDb();
  const [row] = await db
    .update(endpoints)
    .set(changes)
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.orgId, orgId)))
    .returning();
  if (!row) throw notFound("Webhook endpoint");
  return toEndpoint(row);
}

/** Stops deliveries to the endpoint. Deliveries still waiting for an attempt are closed unsent when their turn comes. */
export async function disableEndpoint(orgId: string, endpointId: string): Promise<WebhookEndpoint> {
  return setStatus(orgId, endpointId, { status: "disabled" });
}

/** Re-activates the endpoint (also after an automatic disable) and resets its failure streak. Events emitted while it was disabled are not replayed. */
export async function enableEndpoint(orgId: string, endpointId: string): Promise<WebhookEndpoint> {
  return setStatus(orgId, endpointId, { status: "active", failureCount: 0 });
}

/** Removes the endpoint together with its delivery history. Events themselves are kept. */
export async function deleteEndpoint(orgId: string, endpointId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: endpoints.id })
      .from(endpoints)
      .where(and(eq(endpoints.id, endpointId), eq(endpoints.orgId, orgId)))
      .for("update");
    if (!row) throw notFound("Webhook endpoint");
    await tx.delete(deliveries).where(eq(deliveries.endpointId, row.id));
    await tx.delete(endpoints).where(eq(endpoints.id, row.id));
  });
}

/* Deliveries --------------------------------------------------------------------------------------- */

const listDeliveriesInput = z.object({
  orgId: id,
  endpointId: id.optional(),
  eventId: id.optional(),
  status: z.enum(["pending", "succeeded", "failed", "dead"]).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

/** Newest first. `status` "failed" means the last attempt failed and another one is scheduled. */
export async function listDeliveries(opts: { orgId: string; endpointId?: string; eventId?: string; status?: DeliveryStatus; limit?: number }): Promise<WebhookDelivery[]> {
  const filter = parse(listDeliveriesInput, opts);
  const db = await getDb();
  return db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.orgId, filter.orgId),
        filter.endpointId ? eq(deliveries.endpointId, filter.endpointId) : undefined,
        filter.eventId ? eq(deliveries.eventId, filter.eventId) : undefined,
        filter.status ? eq(deliveries.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
    .limit(filter.limit);
}

export async function getDelivery(orgId: string, deliveryId: string): Promise<WebhookDelivery> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.orgId, orgId)));
  if (!row) throw notFound("Webhook delivery");
  return row;
}

/**
 * Sends an event to its endpoint again, now. A new delivery (with its own attempts and retry schedule)
 * is created and returned; the original stays as history. If the original was still being retried it is
 * closed, so the receiver is not sent the same event on two schedules.
 */
export async function resendDelivery(orgId: string, deliveryId: string): Promise<WebhookDelivery> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.orgId, orgId)))
      .for("update");
    if (!original) throw notFound("Webhook delivery");
    const [endpoint] = await tx
      .select({ status: endpoints.status })
      .from(endpoints)
      .where(and(eq(endpoints.id, original.endpointId), eq(endpoints.orgId, orgId)));
    if (!endpoint) throw notFound("Webhook endpoint");
    if (endpoint.status !== "active") throw conflict("This endpoint is disabled. Enable it before resending.");

    const at = now();
    const [created] = await tx
      .insert(deliveries)
      .values({
        id: newSortableId("webhookDelivery"),
        endpointId: original.endpointId,
        eventId: original.eventId,
        orgId: original.orgId,
        eventType: original.eventType,
        attempt: 0,
        status: "pending",
        nextAttemptAt: at,
        createdAt: at,
      })
      .returning();
    await tx
      .update(deliveries)
      .set({ status: "dead", nextAttemptAt: null, error: `Replaced by a manual resend (${created.id})` })
      .where(and(eq(deliveries.id, original.id), inArray(deliveries.status, ["pending", "failed"])));
    await enqueueAttempt(created.id, 1, at, tx);
    return created;
  });
}
