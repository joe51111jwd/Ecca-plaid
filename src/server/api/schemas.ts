/**
 * Zod schemas of the public API v1: request bodies and query strings (used by the route handlers to validate input)
 * and response objects (used to generate the OpenAPI document and, in tests, to check that every real response and
 * every documented example has exactly this shape). One source, so the code, the OpenAPI file and the docs cannot drift.
 *
 * Response schemas are strict: a field the services add or drop fails the parity tests until it is documented here.
 */
import { z } from "zod";
import { EVENT_TYPES } from "@/server/events";
import { BOOKING_LIMITS, HANDOFF_STATUSES, HOLD_EXTENSION_LIMITS } from "@/server/handoffs";
import { MAX_APPLICANT_NAME_LENGTH, MAX_EXTERNAL_REF_LENGTH, MAX_RETURN_URL_LENGTH, MAX_STUDENT_NAME_LENGTH } from "@/server/verifications";
import { CURSOR_MAX_LENGTH, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "./policy";

/** Registry of named schemas: each becomes `#/components/schemas/<id>` in the OpenAPI document. */
export const apiSchemaRegistry = z.registry<{ id: string; description?: string }>();

function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  apiSchemaRegistry.add(schema, { id, ...(description ? { description } : {}) });
  return schema;
}

/* ------------------------------------------------------------------------------------------ shared */

const VERIFICATION_STATUSES = ["pending", "eligible", "ineligible", "needs_review", "expired", "canceled"] as const;
const VERIFICATION_STAGES = ["created", "started", "consented", "household", "collecting", "submitted", "processing", "awaiting_family", "in_review", "decided"] as const;
const DONATION_STATUSES = ["pending", "succeeded", "failed", "canceled", "refunded"] as const;
const DELIVERY_STATUSES = ["pending", "succeeded", "failed", "dead"] as const;

export const modeSchema = named("Mode", z.enum(["test", "live"]), "test data never mixes with live data.");
const isoDateTime = z.string().describe("ISO 8601 timestamp in UTC, e.g. 2026-11-18T16:00:00.000Z");
const isoDate = z.string().describe("Calendar date, YYYY-MM-DD");
const usd = z.string().regex(/^-?\d+\.\d{2}$/).describe('US dollars as a decimal string, e.g. "312000.00"');
const metadataOut = z.record(z.string(), z.string());

/** Query-string integer page size. */
const limitQuery = z.coerce
  .number("limit must be a whole number")
  .int("limit must be a whole number")
  .min(1, `limit must be between 1 and ${PAGE_LIMIT_MAX}`)
  .max(PAGE_LIMIT_MAX, `limit must be between 1 and ${PAGE_LIMIT_MAX}`)
  .default(PAGE_LIMIT_DEFAULT)
  .describe(`Page size, 1 to ${PAGE_LIMIT_MAX} (default ${PAGE_LIMIT_DEFAULT}).`);
const startingAfterQuery = z
  .string()
  .min(1)
  .max(CURSOR_MAX_LENGTH)
  .optional()
  .describe("Opaque cursor: pass `next_cursor` from the previous page to get the next (older) page.");

const studentIn = z.strictObject({
  first_name: z.string().max(MAX_STUDENT_NAME_LENGTH).nullish(),
  last_name: z.string().max(MAX_STUDENT_NAME_LENGTH).nullish(),
});
const metadataIn = z.record(z.string(), z.string()).describe("Up to 20 string values; keys of letters, digits, `_`, `-` and `.` (at most 40 characters).");

/* ----------------------------------------------------------------------------------- verifications */

export const createVerificationBody = named(
  "CreateVerificationRequest",
  z.strictObject({
    applicant_email: z.string().max(320).nullish().describe("Where the invitation is sent when send_invite is true."),
    applicant_name: z.string().max(MAX_APPLICANT_NAME_LENGTH).nullish(),
    student: studentIn.nullish().describe("The student the scholarship is for. Shown to the family; never returned by reads."),
    external_ref: z.string().max(MAX_EXTERNAL_REF_LENGTH).nullish().describe("Your own applicant or application id. Filterable, and a CSV column."),
    return_url: z.string().max(MAX_RETURN_URL_LENGTH).nullish().describe("Where the family is sent when it finishes: https (http://localhost while testing)."),
    metadata: metadataIn.nullish(),
    send_invite: z.boolean().optional().describe("Email the family link to applicant_email. Default false: you deliver family_url yourself."),
    locale: z.enum(["en", "es"]).optional().describe("Language of the invitation email. Default en."),
  }),
);

export const verificationSchema = named(
  "Verification",
  z.strictObject({
    id: z.string(),
    object: z.literal("verification"),
    mode: modeSchema,
    status: z.enum(VERIFICATION_STATUSES).describe("The outcome: drive your queue from this."),
    stage: z.enum(VERIFICATION_STAGES).describe("Where a pending verification is in the family flow. Informational; never branch eligibility on it."),
    method: z.enum(["direct", "categorical"]).nullable(),
    household_size: z.number().int().nullable(),
    area: z
      .strictObject({ county_fips: z.string(), county_name: z.string().nullable(), hud_area_code: z.string().nullable(), hud_area_name: z.string().nullable() })
      .nullable(),
    threshold_usd: usd.nullable().describe("The income limit the decision relied on."),
    threshold_readings: z.array(z.strictObject({ id: z.string(), usd })).describe("Every reading of the provisional limit (two while the table is HUD-derived)."),
    threshold_source: z.enum(["hud_provisional", "irs_published"]).nullable(),
    threshold_table_version: z.string().nullable(),
    threshold_effective_date: isoDate.nullable(),
    provisional: z.boolean().describe("True while the limit comes from the HUD-derived provisional table. Show it wherever you show the result."),
    income_year: z.number().int().nullable(),
    award_program: z.string().nullable(),
    award_letter_date: isoDate.nullable(),
    reasons: z.array(z.strictObject({ code: z.string(), message: z.string() })),
    evidence_pack_url: z.string().nullable(),
    evidence_json_url: z.string().nullable(),
    consent: z.strictObject({ version: z.string(), granted_at: isoDateTime }).nullable(),
    expires_at: isoDateTime.nullable(),
    decided_at: isoDateTime.nullable(),
    decided_by: z.enum(["engine", "reviewer"]).nullable(),
    passport: z.strictObject({ reused: z.literal(true), source_decided_at: isoDateTime.nullable() }).nullable(),
    external_ref: z.string().nullable(),
    metadata: metadataOut,
    created_at: isoDateTime,
  }),
  "An income verification. Never carries names, contact details, income figures or the family link.",
);

export const verificationCreatedSchema = named(
  "VerificationCreated",
  verificationSchema.extend({
    family_url: z.string().describe("The family's secret link. Returned only in this response: deliver it, do not store it in logs."),
    embed_url: z.string().describe("The same flow for an iframe on your own site. Returned only in this response."),
  }),
);

export const listVerificationsQuery = z.strictObject({
  status: z.enum(VERIFICATION_STATUSES).optional(),
  external_ref: z.string().min(1).max(MAX_EXTERNAL_REF_LENGTH).optional(),
  limit: limitQuery,
  starting_after: startingAfterQuery,
});

export const exportVerificationsQuery = z.strictObject({
  columns: z.string().max(4000).optional().describe("Comma-separated column names, each optionally `name:Header label`. Default: every standard column."),
  status: z.enum(VERIFICATION_STATUSES).optional(),
  external_ref: z.string().min(1).max(MAX_EXTERNAL_REF_LENGTH).optional(),
  header: z.enum(["true", "false"]).optional().describe("Include the header row (default true)."),
});

/* --------------------------------------------------------------------------------------- donations */

export const donationSchema = named(
  "Donation",
  z.strictObject({
    id: z.string(),
    object: z.literal("donation"),
    mode: modeSchema,
    status: z.enum(DONATION_STATUSES),
    org_id: z.string(),
    checkout_session_id: z.string(),
    payment_id: z.string().nullable(),
    taxpayer_role: z.enum(["individual", "spouse_1", "spouse_2"]),
    filing_status: z.string(),
    currency: z.literal("usd"),
    designated_amount_cents: z.number().int(),
    non_designated_amount_cents: z.number().int(),
    donor_service_fee_cents: z.number().int(),
    sgo_platform_fee_cents: z.number().int(),
    fee_structure: z.enum(["none", "sgo_invoiced", "donor_service_fee"]),
    designated_25f: z.boolean(),
    designated_at: isoDateTime,
    designation: z.strictObject({ copy_id: z.string(), copy_version: z.string(), text: z.string(), text_sha256: z.string() }),
    state_allocation: z.string(),
    attestations: z.strictObject({ individual: z.boolean(), us_citizen_or_resident: z.boolean(), no_earmark: z.boolean(), not_in_exchange_for_scholarship: z.boolean(), joint_on_behalf_of_both: z.boolean() }),
    goods_or_services: z.strictObject({ provided: z.boolean(), value_cents: z.number().int() }),
    contributed_at: isoDateTime.nullable(),
    tax_year: z.number().int().nullable(),
    year_boundary_ambiguous: z.boolean(),
    credit_eligible: z.boolean(),
    credit_ineligible_reason: z.string().nullable(),
    sgo_list: z.strictObject({ status_at_gift: z.string().nullable(), entry_id_at_gift: z.string().nullable() }),
    e_delivery_consent: z.boolean(),
    refunded_at: isoDateTime.nullable(),
    donor: z.strictObject({
      id: z.string(),
      first_name: z.string(),
      middle_name: z.string().nullable(),
      last_name: z.string(),
      suffix: z.string().nullable(),
      email: z.string(),
      address: z.strictObject({ line1: z.string(), line2: z.string().nullable(), city: z.string(), state: z.string(), zip: z.string() }),
    }),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  }),
  "A gift to your organization. The designated section 25F amount and any fee are always separate fields.",
);

export const listDonationsQuery = z.strictObject({
  status: z.enum(DONATION_STATUSES).optional(),
  tax_year: z.coerce.number("tax_year must be a year").int().min(2000).max(2200).optional(),
  limit: limitQuery,
  starting_after: startingAfterQuery,
});

/* ---------------------------------------------------------------------------------------- handoffs */

const awardPaymentMethod = z.enum(["direct_to_vendor", "qualified_digital_wallet", "other"]);

export const handoffSchema = named(
  "Handoff",
  z.strictObject({
    id: z.string(),
    object: z.literal("handoff"),
    booking_ref: z.string(),
    status: z.enum(HANDOFF_STATUSES as unknown as [string, ...string[]]),
    hold_expires_at: isoDateTime.nullable(),
    verification_status: z.enum(["pending", "eligible", "not_eligible"]).describe("Eligible is not a promise of payment: only an award is."),
    award: z.strictObject({ amount_usd: usd, payment_method: awardPaymentMethod }).nullable(),
    sgo: z.strictObject({ name: z.string() }).nullable(),
    metadata: metadataOut,
    mode: modeSchema,
    channel: z.enum(["embed", "redirect"]),
    created_via: z.enum(["api", "embed"]),
    status_detail: z.string(),
    booking: z.strictObject({ ref: z.string(), description: z.string().nullable(), amount_usd: usd.nullable(), amount_confirmed: z.boolean() }),
    return_url: z.string().nullable(),
    completed_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  }),
  "A family sent from your booking checkout to a partner SGO. Never carries income, documents or the family's contact details.",
);

export const handoffCreatedSchema = named(
  "HandoffCreated",
  handoffSchema.extend({
    url: z.string().describe("Hosted handoff page: redirect the family here. Returned only in this response."),
    embed_url: z.string().describe("The same page for an iframe. Returned only in this response."),
  }),
);

export const createHandoffBody = named(
  "CreateHandoffRequest",
  z.strictObject({
    booking_ref: z.string().min(1).max(BOOKING_LIMITS.maxRefLength).describe("Your booking or order id."),
    booking_description: z.string().max(BOOKING_LIMITS.maxDescriptionLength).nullish(),
    booking_amount_cents: z.number().int().positive().max(BOOKING_LIMITS.maxAmountCents).nullish().describe("The booking total in whole cents."),
    family_email: z.string().max(320).nullish(),
    student: studentIn.nullish(),
    return_url: z.string().max(MAX_RETURN_URL_LENGTH).nullish().describe("Must be on one of your allowed origins."),
    channel: z.enum(["embed", "redirect"]).default("redirect"),
    metadata: metadataIn.nullish(),
    sgo_org_id: z.string().min(1).max(128).nullish().describe("A partner SGO to route this family to. Default: your only active partner, or the family chooses."),
    locale: z.enum(["en", "es"]).optional(),
  }),
);

export const listHandoffsQuery = z.strictObject({
  status: z.enum(HANDOFF_STATUSES as unknown as [string, ...string[]]).optional(),
  limit: limitQuery,
  starting_after: startingAfterQuery,
});

export const completeHandoffBody = named(
  "CompleteHandoffRequest",
  z.strictObject({
    booking_amount_cents: z.number().int().positive().max(BOOKING_LIMITS.maxAmountCents).optional().describe("The final booking amount, confirmed server-side. Cannot be below the award."),
  }),
);

export const cancelHandoffBody = named("CancelHandoffRequest", z.strictObject({ reason: z.string().max(500).optional().describe("Kept in your audit log; never shown to the family.") }));

export const extendHoldBody = named(
  "ExtendHoldRequest",
  z.strictObject({ hours: z.number().int().min(1).max(HOLD_EXTENSION_LIMITS.maxSingleHours).describe(`Whole hours to add (total extensions per handoff at most ${HOLD_EXTENSION_LIMITS.maxTotalHours}).`) }),
);

/* ------------------------------------------------------------------------------------------ events */

export const eventSchema = named(
  "Event",
  z.strictObject({
    id: z.string(),
    object: z.literal("event"),
    type: z.enum(EVENT_TYPES),
    mode: modeSchema,
    created_at: isoDateTime,
    data: z.record(z.string(), z.unknown()).describe("The object the event is about, e.g. a Verification for verification.* events."),
  }),
);

export const listEventsQuery = z.strictObject({
  type: z.enum(EVENT_TYPES).optional(),
  limit: limitQuery,
  starting_after: startingAfterQuery,
});

/* -------------------------------------------------------------------------------- webhook endpoints */

const eventTypeOrAll = z.union([z.enum(EVENT_TYPES), z.literal("*")]);

export const webhookEndpointSchema = named(
  "WebhookEndpoint",
  z.strictObject({
    id: z.string(),
    object: z.literal("webhook_endpoint"),
    url: z.string(),
    description: z.string().nullable(),
    event_types: z.array(z.string()).describe('Subscribed event types; ["*"] means all.'),
    format: z.enum(["native", "generic_csv_row"]),
    status: z.enum(["active", "disabled"]),
    failure_count: z.number().int(),
    last_success_at: isoDateTime.nullable(),
    last_failure_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  }),
);

export const webhookEndpointWithSecretSchema = named(
  "WebhookEndpointWithSecret",
  webhookEndpointSchema.extend({ secret: z.string().describe('Signing secret ("whsec_…"). Returned only by create and rotate_secret.') }),
);

export const createWebhookEndpointBody = named(
  "CreateWebhookEndpointRequest",
  z.strictObject({
    url: z.string().min(1).max(2048).describe("Public https URL."),
    description: z.string().max(500).nullish(),
    event_types: z.array(eventTypeOrAll).min(1).optional().describe('Default ["*"].'),
    format: z.enum(["native", "generic_csv_row"]).optional().describe("native (JSON, default) or generic_csv_row (a header line and one CSV row per event)."),
  }),
);

export const updateWebhookEndpointBody = named(
  "UpdateWebhookEndpointRequest",
  z.strictObject({
    url: z.string().min(1).max(2048).optional(),
    description: z.string().max(500).nullish(),
    event_types: z.array(eventTypeOrAll).min(1).optional(),
    format: z.enum(["native", "generic_csv_row"]).optional(),
    status: z.enum(["active", "disabled"]).optional().describe("disabled stops deliveries; active re-enables and resets the failure streak."),
  }),
);

export const rotateSecretBody = named(
  "RotateSecretRequest",
  z.strictObject({ expire_previous_now: z.boolean().optional().describe("Stop the old secret immediately (it leaked). Default: both secrets sign for 24 hours.") }),
);

export const deletedSchema = named("Deleted", z.strictObject({ id: z.string(), object: z.literal("webhook_endpoint"), deleted: z.literal(true) }));

export const webhookDeliverySchema = named(
  "WebhookDelivery",
  z.strictObject({
    id: z.string(),
    object: z.literal("webhook_delivery"),
    endpoint_id: z.string(),
    event_id: z.string(),
    event_type: z.string(),
    mode: modeSchema,
    attempt: z.number().int(),
    status: z.enum(DELIVERY_STATUSES),
    response_status: z.number().int().nullable(),
    response_excerpt: z.string().nullable().describe("The first characters of your endpoint's reply."),
    error: z.string().nullable(),
    next_attempt_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    delivered_at: isoDateTime.nullable(),
  }),
);

export const listDeliveriesQuery = z.strictObject({
  status: z.enum(DELIVERY_STATUSES).optional(),
  limit: limitQuery,
  starting_after: startingAfterQuery,
});

/* ----------------------------------------------------------------------------------------------- me */

export const meSchema = named(
  "Me",
  z.strictObject({
    object: z.literal("api_key_context"),
    mode: modeSchema,
    organization: z.strictObject({ id: z.string(), name: z.string(), slug: z.string(), type: z.enum(["sgo", "business"]), status: z.enum(["pending", "active", "suspended"]) }),
    api_key: z.strictObject({ id: z.string(), name: z.string(), prefix: z.string(), created_at: isoDateTime }),
  }),
);

/* ------------------------------------------------------------------------------------------ envelopes */

export const errorSchema = named(
  "Error",
  z.strictObject({
    error: z.strictObject({
      code: z.enum(["bad_request", "validation_failed", "unauthenticated", "forbidden", "not_found", "conflict", "gone", "rate_limited", "payment_failed", "not_available", "internal"]),
      message: z.string(),
      details: z.unknown().optional(),
      request_id: z.string(),
    }),
  }),
  "Every error has this shape. `details.fields` names invalid input fields; `details.reason` is a stable machine reason where one exists.",
);

/** `{ object: "list", data, has_more, next_cursor }` for one item schema. */
export function listOf<T extends z.ZodType>(id: string, item: T) {
  return named(
    id,
    z.strictObject({
      object: z.literal("list"),
      data: z.array(item),
      has_more: z.boolean(),
      next_cursor: z.string().nullable().describe("Pass as starting_after to get the next page; null on the last page."),
    }),
  );
}

export const verificationListSchema = listOf("VerificationList", verificationSchema);
export const donationListSchema = listOf("DonationList", donationSchema);
export const handoffListSchema = listOf("HandoffList", handoffSchema);
export const eventListSchema = listOf("EventList", eventSchema);
export const webhookEndpointListSchema = listOf("WebhookEndpointList", webhookEndpointSchema);
export const webhookDeliveryListSchema = listOf("WebhookDeliveryList", webhookDeliverySchema);

export type ListEnvelope<T> = { object: "list"; data: T[]; has_more: boolean; next_cursor: string | null };
