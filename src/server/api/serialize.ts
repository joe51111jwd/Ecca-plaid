/**
 * API shapes (snake_case JSON) of the records this module serves directly: events, webhook endpoints and deliveries,
 * and the key context. Verifications, handoffs and donations are serialized by their own services
 * (toApiVerification, toApiHandoff, toApiDonation).
 */
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import type { DeliveryStatus, Mode } from "@/db/schema";
import { invalid } from "@/lib/errors";
import type { EventRecord } from "@/server/events";
import type { WebhookDelivery, WebhookEndpoint } from "@/server/webhooks";
import type { ApiKeySummary, Organization } from "./keys";
import type { eventSchema, meSchema, webhookDeliverySchema, webhookEndpointSchema } from "./schemas";

export type ApiEvent = z.infer<typeof eventSchema>;
export type ApiWebhookEndpoint = z.infer<typeof webhookEndpointSchema>;
export type ApiWebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type ApiMe = z.infer<typeof meSchema>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toApiEvent(event: EventRecord): ApiEvent {
  return { id: event.id, object: "event", type: event.type as ApiEvent["type"], mode: event.mode, created_at: event.createdAt.toISOString(), data: event.payload };
}

export function toApiWebhookEndpoint(endpoint: WebhookEndpoint): ApiWebhookEndpoint {
  return {
    id: endpoint.id,
    object: "webhook_endpoint",
    url: endpoint.url,
    description: endpoint.description,
    event_types: [...endpoint.eventTypes],
    format: endpoint.format,
    status: endpoint.status,
    failure_count: endpoint.failureCount,
    last_success_at: iso(endpoint.lastSuccessAt),
    last_failure_at: iso(endpoint.lastFailureAt),
    created_at: endpoint.createdAt.toISOString(),
  };
}

export function toApiWebhookDelivery(delivery: WebhookDelivery, mode: Mode): ApiWebhookDelivery {
  return {
    id: delivery.id,
    object: "webhook_delivery",
    endpoint_id: delivery.endpointId,
    event_id: delivery.eventId,
    event_type: delivery.eventType,
    mode,
    attempt: delivery.attempt,
    status: delivery.status,
    response_status: delivery.responseStatus,
    response_excerpt: delivery.responseExcerpt,
    error: delivery.error,
    next_attempt_at: iso(delivery.nextAttemptAt),
    created_at: delivery.createdAt.toISOString(),
    delivered_at: iso(delivery.deliveredAt),
  };
}

export function toApiMe(org: Organization, mode: Mode, key: ApiKeySummary): ApiMe {
  if (org.type !== "sgo" && org.type !== "business") throw new Error("Only SGO and business organizations have API keys");
  return {
    object: "api_key_context",
    mode,
    organization: { id: org.id, name: org.name, slug: org.slug, type: org.type, status: org.status },
    api_key: { id: key.id, name: key.name, prefix: key.prefix, created_at: key.createdAt.toISOString() },
  };
}

/* ------------------------------------------------------------------------------- delivery history */

export interface ListDeliveriesForModeParams {
  orgId: string;
  endpointId: string;
  mode: Mode;
  status?: DeliveryStatus;
  limit: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

function encodeDeliveryCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeDeliveryCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = raw.indexOf("|");
  const createdAt = new Date(sep > 0 ? raw.slice(0, sep) : "");
  const id = raw.slice(sep + 1);
  if (sep <= 0 || Number.isNaN(createdAt.getTime()) || id.length === 0 || id.length > 128) {
    throw invalid("The cursor is not valid.", { fields: { starting_after: "Use next_cursor from the previous page." } });
  }
  return { createdAt, id };
}

/**
 * One endpoint's deliveries, newest first, limited to events of `mode`. The webhooks service lists deliveries per
 * organization without a mode (endpoints serve both modes); joining the event keeps a test key from reading the
 * delivery history of live events.
 */
export async function listDeliveriesForMode(params: ListDeliveriesForModeParams): Promise<{ items: WebhookDelivery[]; nextCursor: string | null }> {
  const d = schema.webhookDeliveries;
  const e = schema.events;
  const where: SQL[] = [eq(d.orgId, params.orgId), eq(d.endpointId, params.endpointId), eq(e.mode, params.mode), eq(e.orgId, params.orgId)];
  if (params.status) where.push(eq(d.status, params.status));
  if (params.cursor) {
    const c = decodeDeliveryCursor(params.cursor);
    where.push(or(lt(d.createdAt, c.createdAt), and(eq(d.createdAt, c.createdAt), lt(d.id, c.id)))!);
  }
  const db = await getDb();
  const rows = await db
    .select({ delivery: d })
    .from(d)
    .innerJoin(e, eq(e.id, d.eventId))
    .where(and(...where))
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(params.limit + 1);
  const items = rows.slice(0, params.limit).map((r) => r.delivery);
  return { items, nextCursor: rows.length > params.limit ? encodeDeliveryCursor(items[items.length - 1]) : null };
}
