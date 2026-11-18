import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, type Mode } from "./_shared";

/* Identity ------------------------------------------------------------------------------------------ */

/** One row per human, keyed by email. Parents, donors, SGO staff, business staff and platform admins all sign in the same way. */
export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text("email").notNull(), // always lower-cased
    name: text("name"),
    phone: text("phone"), // backup contact for magic links (later)
    locale: text("locale").$type<"en" | "es">().notNull().default("en"),
    createdAt: createdAt(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export type OrgType = "sgo" | "business" | "platform";
export type OrgStatus = "pending" | "active" | "suspended";

/** Tenant. `sgo` = scholarship granting organization, `business` = camp/school/vendor, `platform` = us (exactly one row). */
export const organizations = pgTable(
  "organizations",
  {
    id: pk(),
    type: text("type").$type<OrgType>().notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").$type<OrgStatus>().notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug), index("organizations_type_idx").on(t.type)],
);

export type MemberRole = "owner" | "admin" | "reviewer" | "viewer";

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").$type<MemberRole>().notNull().default("viewer"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

/** Platform-wide switches (counsel gates, fee structure, credit start date overrides for tests). See src/server/settings. */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

/* Audit ----------------------------------------------------------------------------------------------- */

export type ActorType = "user" | "api_key" | "system" | "family" | "webhook";

/** Append-only access and change log. Never update or delete rows. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    orgId: text("org_id"), // tenant whose data was touched
    action: text("action").notNull(), // e.g. "verification.read", "document.download", "api_key.create"
    targetType: text("target_type"),
    targetId: text("target_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_org_at_idx").on(t.orgId, t.at), index("audit_target_idx").on(t.targetType, t.targetId), index("audit_actor_idx").on(t.actorId, t.at)],
);

/* Background jobs --------------------------------------------------------------------------------------- */

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

/** Postgres-backed queue (claimed with FOR UPDATE SKIP LOCKED). See src/server/jobs. */
export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /** When set, at most one queued/running job may exist with this key. */
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("jobs_claim_idx").on(t.status, t.runAt), index("jobs_dedupe_idx").on(t.dedupeKey), index("jobs_type_idx").on(t.type, t.status)],
);

/* Email outbox ------------------------------------------------------------------------------------------ */

export type EmailStatus = "queued" | "sent" | "failed";

/** Every email we send is recorded here. With EMAIL_PROVIDER=outbox nothing leaves the machine; /dev/mail shows them. */
export const emails = pgTable(
  "emails",
  {
    id: pk(),
    toEmail: text("to_email").notNull(),
    fromEmail: text("from_email").notNull(),
    subject: text("subject").notNull(),
    template: text("template").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    status: text("status").$type<EmailStatus>().notNull().default("queued"),
    provider: text("provider").notNull().default("outbox"),
    providerId: text("provider_id"),
    error: text("error"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("emails_to_idx").on(t.toEmail, t.createdAt)],
);

/* Encrypted object storage index ------------------------------------------------------------------------ */

export type ObjectPurpose = "upload" | "evidence_pdf" | "evidence_json" | "acknowledgment_pdf" | "irs_report" | "export" | "invoice_pdf";

/** Index of every stored blob. Bytes live in the object store, encrypted with a per-object key wrapped by the master key. */
export const objects = pgTable(
  "objects",
  {
    id: pk(),
    storageKey: text("storage_key").notNull(),
    purpose: text("purpose").$type<ObjectPurpose>().notNull(),
    /** SHA-256 of the plaintext bytes. Kept after the bytes are purged so evidence still proves what was reviewed. */
    sha256: text("sha256").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    filename: text("filename"),
    wrappedKey: text("wrapped_key").notNull(),
    orgId: text("org_id"),
    householdId: text("household_id"),
    createdAt: createdAt(),
    /** Set when the bytes are deleted (retention purge or user request). The row stays as the audit record. */
    deletedAt: ts("deleted_at"),
    deleteReason: text("delete_reason"),
  },
  (t) => [uniqueIndex("objects_key_uq").on(t.storageKey), index("objects_org_idx").on(t.orgId), index("objects_household_idx").on(t.householdId)],
);

/* Rate limiting ----------------------------------------------------------------------------------------- */

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

/* API keys, events and webhooks ------------------------------------------------------------------------- */

export const apiKeys = pgTable(
  "api_keys",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    /** Display prefix, e.g. "ecca_test_3fK9". The full key is shown once and only its hash is stored. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)],
);

/** Domain event outbox. Every event is delivered to the org's matching webhook endpoints. Types are listed in src/server/events/types.ts. */
export const events = pgTable(
  "events",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("events_org_idx").on(t.orgId, t.createdAt)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    url: text("url").notNull(),
    description: text("description"),
    /** Signing secret, encrypted with encryptField(purpose "webhook-secret"). */
    secretEnc: text("secret_enc").notNull(),
    /** Subscribed event types; ["*"] = all. */
    eventTypes: jsonb("event_types").$type<string[]>().notNull().default(["*"]),
    /** Payload format: our native JSON, or a vendor-compatible mapping. */
    format: text("format").$type<"native" | "generic_csv_row">().notNull().default("native"),
    status: text("status").$type<"active" | "disabled">().notNull().default("active"),
    failureCount: integer("failure_count").notNull().default(0),
    lastSuccessAt: ts("last_success_at"),
    lastFailureAt: ts("last_failure_at"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.orgId)],
);

export type DeliveryStatus = "pending" | "succeeded" | "failed" | "dead";

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: pk(),
    endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id),
    eventId: text("event_id").notNull().references(() => events.id),
    orgId: text("org_id").notNull(),
    eventType: text("event_type").notNull(),
    attempt: integer("attempt").notNull().default(0),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    responseStatus: integer("response_status"),
    responseExcerpt: text("response_excerpt"),
    error: text("error"),
    nextAttemptAt: ts("next_attempt_at"),
    createdAt: createdAt(),
    deliveredAt: ts("delivered_at"),
  },
  (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt), index("webhook_deliveries_event_idx").on(t.eventId)],
);

/** Marker so `boolean` stays imported for modules that extend this file. */
export const _coreBoolean = boolean;
