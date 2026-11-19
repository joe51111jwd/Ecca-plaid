/**
 * Every operation of the public API v1, in one table: method, path, who may call it, its input schemas and what it
 * returns. Route handlers take their spec from here (`...operation("createVerification")`), the OpenAPI document is
 * generated from here, and the parity test checks that this table and the route files under src/app/api/v1 agree.
 */
import type { z } from "zod";
import {
  cancelHandoffBody,
  completeHandoffBody,
  createHandoffBody,
  createVerificationBody,
  createWebhookEndpointBody,
  deletedSchema,
  donationListSchema,
  donationSchema,
  eventListSchema,
  eventSchema,
  exportVerificationsQuery,
  extendHoldBody,
  handoffCreatedSchema,
  handoffListSchema,
  handoffSchema,
  listDeliveriesQuery,
  listDonationsQuery,
  listEventsQuery,
  listHandoffsQuery,
  listVerificationsQuery,
  meSchema,
  rotateSecretBody,
  updateWebhookEndpointBody,
  verificationCreatedSchema,
  verificationListSchema,
  verificationSchema,
  webhookDeliveryListSchema,
  webhookEndpointListSchema,
  webhookEndpointSchema,
  webhookEndpointWithSecretSchema,
} from "./schemas";
import type { ApiOrgType } from "./route";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** What a successful call returns: a JSON schema, or a file. */
export type OperationResponse = { kind: "json"; schema: z.ZodType } | { kind: "file"; contentType: "application/pdf" | "application/json" | "text/csv"; description: string };

export interface OperationDefinition {
  method: HttpMethod;
  /** OpenAPI path under /api/v1, with `{id}` parameters. */
  path: string;
  tag: "Verifications" | "Donations" | "Handoffs" | "Events" | "Webhook endpoints" | "Account" | "Meta";
  summary: string;
  description?: string;
  /** Organization types whose keys may call it. Empty for the public OpenAPI document. */
  orgTypes: readonly ApiOrgType[];
  query?: z.ZodType;
  body?: z.ZodType;
  status: 200 | 201;
  response: OperationResponse;
  audit?: string;
  idempotent?: boolean;
  fieldNames?: Readonly<Record<string, string>>;
  /** True only for GET /openapi.json: no API key. */
  public?: boolean;
}

const SGO = ["sgo"] as const;
const BUSINESS = ["business"] as const;
const BOTH = ["sgo", "business"] as const;

const json = (schema: z.ZodType): OperationResponse => ({ kind: "json", schema });

export const OPERATIONS = {
  /* ------------------------------------------------------------------------------------ verifications */
  createVerification: {
    method: "POST",
    path: "/verifications",
    tag: "Verifications",
    summary: "Create a verification",
    description: "Starts an income verification and returns the family link (family_url) and an embeddable link (embed_url). Both are returned only here.",
    orgTypes: SGO,
    body: createVerificationBody,
    status: 201,
    response: json(verificationCreatedSchema),
    audit: "api.verification.create",
    idempotent: true,
    fieldNames: { studentFirstName: "student.first_name", studentLastName: "student.last_name", applicantEmail: "applicant_email", returnUrl: "return_url", externalRef: "external_ref", sendInvite: "send_invite" },
  },
  listVerifications: {
    method: "GET",
    path: "/verifications",
    tag: "Verifications",
    summary: "List verifications",
    description: "Your organization's verifications in the key's mode, newest first.",
    orgTypes: SGO,
    query: listVerificationsQuery,
    status: 200,
    response: json(verificationListSchema),
  },
  exportVerifications: {
    method: "GET",
    path: "/verifications/export.csv",
    tag: "Verifications",
    summary: "Export verifications as CSV",
    description: "A generic CSV of your verifications. `columns` picks, orders and renames columns to match another system's import. Cells are CSV-injection safe.",
    orgTypes: SGO,
    query: exportVerificationsQuery,
    status: 200,
    response: { kind: "file", contentType: "text/csv", description: "RFC 4180 CSV with CRLF line ends." },
  },
  getVerification: {
    method: "GET",
    path: "/verifications/{id}",
    tag: "Verifications",
    summary: "Retrieve a verification",
    orgTypes: SGO,
    status: 200,
    response: json(verificationSchema),
  },
  cancelVerification: {
    method: "POST",
    path: "/verifications/{id}/cancel",
    tag: "Verifications",
    summary: "Cancel a verification",
    description: "Stops a verification that is not decided yet: the family link stops working. A decided, expired or canceled verification is a 409.",
    orgTypes: SGO,
    status: 200,
    response: json(verificationSchema),
    audit: "api.verification.cancel",
    idempotent: true,
  },
  getEvidencePdf: {
    method: "GET",
    path: "/verifications/{id}/evidence.pdf",
    tag: "Verifications",
    summary: "Download the evidence pack (PDF)",
    description: "The human-readable evidence pack. 409 (`evidence_not_ready`) until it exists. Every download is audited.",
    orgTypes: SGO,
    status: 200,
    response: { kind: "file", contentType: "application/pdf", description: "The evidence pack." },
  },
  getEvidenceJson: {
    method: "GET",
    path: "/verifications/{id}/evidence.json",
    tag: "Verifications",
    summary: "Download the signed evidence record (JSON)",
    description: "The signed evidence record ({ record, signature }). Verify it with /.well-known/jwks.json. 409 (`evidence_not_ready`) until it exists. Every download is audited.",
    orgTypes: SGO,
    status: 200,
    response: { kind: "file", contentType: "application/json", description: "The signed evidence record." },
  },

  /* ---------------------------------------------------------------------------------------- donations */
  listDonations: {
    method: "GET",
    path: "/donations",
    tag: "Donations",
    summary: "List donations",
    orgTypes: SGO,
    query: listDonationsQuery,
    status: 200,
    response: json(donationListSchema),
  },
  getDonation: {
    method: "GET",
    path: "/donations/{id}",
    tag: "Donations",
    summary: "Retrieve a donation",
    orgTypes: SGO,
    status: 200,
    response: json(donationSchema),
  },

  /* ----------------------------------------------------------------------------------------- handoffs */
  createHandoff: {
    method: "POST",
    path: "/handoffs",
    tag: "Handoffs",
    summary: "Create a handoff",
    description: "Sends a family from your booking checkout to a partner SGO and holds the reservation. Returns the handoff page URL (redirect) and embed URL, only here.",
    orgTypes: BUSINESS,
    body: createHandoffBody,
    status: 201,
    response: json(handoffCreatedSchema),
    audit: "api.handoff.create",
    idempotent: true,
    fieldNames: { bookingRef: "booking_ref", bookingDescription: "booking_description", bookingAmountCents: "booking_amount_cents", familyEmail: "family_email", studentFirstName: "student.first_name", studentLastName: "student.last_name", returnUrl: "return_url", sgoOrgId: "sgo_org_id" },
  },
  listHandoffs: {
    method: "GET",
    path: "/handoffs",
    tag: "Handoffs",
    summary: "List handoffs",
    orgTypes: BUSINESS,
    query: listHandoffsQuery,
    status: 200,
    response: json(handoffListSchema),
  },
  getHandoff: {
    method: "GET",
    path: "/handoffs/{id}",
    tag: "Handoffs",
    summary: "Retrieve a handoff",
    orgTypes: BUSINESS,
    status: 200,
    response: json(handoffSchema),
  },
  completeHandoff: {
    method: "POST",
    path: "/handoffs/{id}/complete",
    tag: "Handoffs",
    summary: "Complete a booking with scholarship funds",
    description: "Only after the SGO has offered an award (status awarded). Accrues your success fee; the family is never charged.",
    orgTypes: BUSINESS,
    body: completeHandoffBody,
    status: 200,
    response: json(handoffSchema),
    audit: "api.handoff.complete",
    idempotent: true,
    fieldNames: { bookingAmountCents: "booking_amount_cents" },
  },
  cancelHandoff: {
    method: "POST",
    path: "/handoffs/{id}/cancel",
    tag: "Handoffs",
    summary: "Cancel a handoff",
    orgTypes: BUSINESS,
    body: cancelHandoffBody,
    status: 200,
    response: json(handoffSchema),
    audit: "api.handoff.cancel",
    idempotent: true,
  },
  extendHandoffHold: {
    method: "POST",
    path: "/handoffs/{id}/extend_hold",
    tag: "Handoffs",
    summary: "Extend the reservation hold",
    orgTypes: BUSINESS,
    body: extendHoldBody,
    status: 200,
    response: json(handoffSchema),
    audit: "api.handoff.extend_hold",
    idempotent: true,
  },

  /* ------------------------------------------------------------------------------------------ account */
  getMe: {
    method: "GET",
    path: "/me",
    tag: "Account",
    summary: "Who am I",
    description: "The organization and mode of the key. Use it to check a key.",
    orgTypes: BOTH,
    status: 200,
    response: json(meSchema),
  },

  /* ------------------------------------------------------------------------------------------- events */
  listEvents: {
    method: "GET",
    path: "/events",
    tag: "Events",
    summary: "List events",
    description: "Your organization's events in the key's mode, newest first. The same objects webhooks deliver.",
    orgTypes: BOTH,
    query: listEventsQuery,
    status: 200,
    response: json(eventListSchema),
  },
  getEvent: {
    method: "GET",
    path: "/events/{id}",
    tag: "Events",
    summary: "Retrieve an event",
    orgTypes: BOTH,
    status: 200,
    response: json(eventSchema),
  },

  /* -------------------------------------------------------------------------------- webhook endpoints */
  createWebhookEndpoint: {
    method: "POST",
    path: "/webhook_endpoints",
    tag: "Webhook endpoints",
    summary: "Create a webhook endpoint",
    description: "Returns the signing secret once. Once your organization holds a live key, managing endpoints needs a live key.",
    orgTypes: BOTH,
    body: createWebhookEndpointBody,
    status: 201,
    response: json(webhookEndpointWithSecretSchema),
    audit: "api.webhook_endpoint.create",
    idempotent: true,
    fieldNames: { eventTypes: "event_types" },
  },
  listWebhookEndpoints: {
    method: "GET",
    path: "/webhook_endpoints",
    tag: "Webhook endpoints",
    summary: "List webhook endpoints",
    orgTypes: BOTH,
    status: 200,
    response: json(webhookEndpointListSchema),
  },
  getWebhookEndpoint: {
    method: "GET",
    path: "/webhook_endpoints/{id}",
    tag: "Webhook endpoints",
    summary: "Retrieve a webhook endpoint",
    orgTypes: BOTH,
    status: 200,
    response: json(webhookEndpointSchema),
  },
  updateWebhookEndpoint: {
    method: "PATCH",
    path: "/webhook_endpoints/{id}",
    tag: "Webhook endpoints",
    summary: "Update a webhook endpoint",
    orgTypes: BOTH,
    body: updateWebhookEndpointBody,
    status: 200,
    response: json(webhookEndpointSchema),
    audit: "api.webhook_endpoint.update",
    fieldNames: { eventTypes: "event_types" },
  },
  deleteWebhookEndpoint: {
    method: "DELETE",
    path: "/webhook_endpoints/{id}",
    tag: "Webhook endpoints",
    summary: "Delete a webhook endpoint",
    orgTypes: BOTH,
    status: 200,
    response: json(deletedSchema),
    audit: "api.webhook_endpoint.delete",
  },
  rotateWebhookSecret: {
    method: "POST",
    path: "/webhook_endpoints/{id}/rotate_secret",
    tag: "Webhook endpoints",
    summary: "Rotate the signing secret",
    description: "Returns the new secret once. For 24 hours deliveries are signed with both secrets, unless expire_previous_now is true.",
    orgTypes: BOTH,
    body: rotateSecretBody,
    status: 200,
    response: json(webhookEndpointWithSecretSchema),
    audit: "api.webhook_endpoint.rotate_secret",
    idempotent: true,
  },
  listWebhookDeliveries: {
    method: "GET",
    path: "/webhook_endpoints/{id}/deliveries",
    tag: "Webhook endpoints",
    summary: "List deliveries of an endpoint",
    description: "Delivery attempts for events of the key's mode, newest first.",
    orgTypes: BOTH,
    query: listDeliveriesQuery,
    status: 200,
    response: json(webhookDeliveryListSchema),
  },

  /* --------------------------------------------------------------------------------------------- meta */
  getOpenApi: {
    method: "GET",
    path: "/openapi.json",
    tag: "Meta",
    summary: "This OpenAPI document",
    orgTypes: [],
    status: 200,
    response: { kind: "file", contentType: "application/json", description: "OpenAPI 3.1 document." },
    public: true,
  },
} as const satisfies Record<string, OperationDefinition>;

export type OperationId = keyof typeof OPERATIONS;
export const OPERATION_IDS = Object.keys(OPERATIONS) as OperationId[];

/** The route-spec part of an operation, to spread into `apiRoute({ ...operation(id), handler })`. */
export function operation<K extends OperationId>(id: K): Pick<(typeof OPERATIONS)[K], Extract<keyof (typeof OPERATIONS)[K], "orgTypes" | "query" | "body" | "audit" | "idempotent" | "fieldNames">> {
  const op = OPERATIONS[id] as OperationDefinition;
  const out: Record<string, unknown> = { orgTypes: op.orgTypes };
  for (const key of ["query", "body", "audit", "idempotent", "fieldNames"] as const) if (op[key] !== undefined) out[key] = op[key];
  return out as Pick<(typeof OPERATIONS)[K], Extract<keyof (typeof OPERATIONS)[K], "orgTypes" | "query" | "body" | "audit" | "idempotent" | "fieldNames">>;
}
