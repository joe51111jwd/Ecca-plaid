import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_shared";
import { users } from "./core";

/**
 * Single-use, short-lived sign-in credential sent by email. The email carries both a link (token) and a
 * 6-digit code (same credential, typed by hand — needed inside embeds and on a second device).
 */
export const magicLinks = pgTable(
  "magic_links",
  {
    id: pk(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    /** Where to send the browser after sign-in (validated same-origin path). */
    redirectTo: text("redirect_to"),
    /** Free-form flow context, e.g. { verificationId, handoffId }. */
    context: jsonb("context").$type<Record<string, unknown>>(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    /** Failed code attempts; the link is burned after too many. */
    attempts: integer("attempts").notNull().default(0),
    createdIp: text("created_ip"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("magic_links_token_uq").on(t.tokenHash), index("magic_links_email_idx").on(t.email, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: text("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);
