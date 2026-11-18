import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { badRequest, invalid, notFound } from "@/lib/errors";
import { newSortableId } from "@/server/audit";
import { createDeliveriesForEvent } from "@/server/webhooks";
import { EVENT_TYPES, isEventType, type EventType } from "./types";

/**
 * Domain events (outbox pattern).
 *
 *   await db.transaction(async (tx) => {
 *     await tx.update(verifications)...                       // the state change
 *     await emitEvent({ orgId, type: "verification.decided", payload, mode }, tx);
 *   });
 *
 * Emitting inside the transaction that makes the change is what guarantees there is no event without
 * its state change and no state change without its event: the event row, one pending delivery per
 * subscribed webhook endpoint and the delivery jobs all commit or roll back together with it.
 */

export { EVENT_TYPES, isEventType, type EventType };

const { events } = schema;

export type EventRecord = typeof events.$inferSelect;

export interface EmitEventInput {
  orgId: string;
  type: EventType;
  /** The `data` object webhook receivers get. Must be plain JSON. */
  payload: Record<string, unknown>;
  mode: Mode;
}

const emitInput = z.object({
  orgId: z.string().min(1),
  type: z.string().refine(isEventType, "Unknown event type"),
  mode: z.enum(["test", "live"]),
});

function toJsonObject(payload: unknown): Record<string, unknown> {
  let parsed: unknown;
  try {
    const json = JSON.stringify(payload);
    parsed = json === undefined ? undefined : JSON.parse(json);
  } catch (e) {
    throw invalid(`Event payload is not JSON-serializable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid("Event payload must be a plain object");
  return parsed as Record<string, unknown>;
}

/**
 * Records an event and queues its webhook deliveries. Pass the transaction that carries the state
 * change as `dbOrTx`; without one the event is written in a transaction of its own.
 */
export async function emitEvent(input: EmitEventInput, dbOrTx?: DbOrTx): Promise<EventRecord> {
  const parsed = emitInput.safeParse(input);
  if (!parsed.success) throw invalid(`Invalid event: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const row = {
    // Sortable, so events that share a timestamp (a frozen clock, or one fast transaction) list in the order emitted.
    id: newSortableId("event"),
    orgId: parsed.data.orgId,
    type: parsed.data.type,
    mode: parsed.data.mode,
    payload: toJsonObject(input.payload),
    createdAt: now(),
  };
  const db = dbOrTx ?? (await getDb());
  // On a caller's transaction this is a savepoint; on the plain database it makes the three writes atomic.
  return db.transaction(async (tx) => {
    const [event] = await tx.insert(events).values(row).returning();
    await createDeliveriesForEvent(event, tx);
    return event;
  });
}

const listInput = z.object({
  orgId: z.string().min(1),
  mode: z.enum(["test", "live"]).optional(),
  type: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  before: z.union([z.string().min(1), z.date()]).optional(),
});

export interface ListEventsOptions {
  orgId: string;
  /** Only events of this mode. API callers must pass their key's mode so test and live data never mix. */
  mode?: Mode;
  type?: string;
  /** 1-200, default 50. */
  limit?: number;
  /** Cursor: the id of the last event of the previous page, or a date; only older events are returned. */
  before?: string | Date;
}

/** An organization's events, newest first. */
export async function listEvents(opts: ListEventsOptions): Promise<EventRecord[]> {
  const parsed = listInput.safeParse(opts);
  if (!parsed.success) throw invalid(`Invalid event filter: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const { orgId, mode, type, limit, before } = parsed.data;
  const db = await getDb();

  let olderThan;
  if (before instanceof Date) {
    olderThan = lt(events.createdAt, before);
  } else if (before !== undefined) {
    // The cursor is looked up inside the organization, so another tenant's event id reveals nothing.
    const [cursor] = await db
      .select({ id: events.id, createdAt: events.createdAt })
      .from(events)
      .where(and(eq(events.id, before), eq(events.orgId, orgId)));
    if (!cursor) throw badRequest("Unknown cursor: `before` must be the id of one of this organization's events");
    olderThan = or(lt(events.createdAt, cursor.createdAt), and(eq(events.createdAt, cursor.createdAt), lt(events.id, cursor.id)));
  }

  return db
    .select()
    .from(events)
    .where(and(eq(events.orgId, orgId), mode ? eq(events.mode, mode) : undefined, type ? eq(events.type, type) : undefined, olderThan))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
}

/** One event of the organization. Throws `not_found` for an unknown id and for another organization's event alike. */
export async function getEvent(orgId: string, id: string): Promise<EventRecord> {
  const db = await getDb();
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.orgId, orgId)));
  if (!event) throw notFound("Event");
  return event;
}
