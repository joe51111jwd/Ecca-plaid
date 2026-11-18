import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_shared";
import { organizations } from "./core";

/**
 * Idempotency for POST requests to the public API. A client may send `Idempotency-Key`; a repeat of the
 * same key by the same organization returns the stored response instead of acting twice.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    /** Hash of the client-supplied key (never the raw value). */
    keyHash: text("key_hash").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    /** Hash of the request body: the same key with a different body is a conflict. */
    requestHash: text("request_hash").notNull(),
    /** Null while the first request is still in flight. */
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [uniqueIndex("idempotency_keys_uq").on(t.orgId, t.keyHash), index("idempotency_keys_expires_idx").on(t.expiresAt)],
);
