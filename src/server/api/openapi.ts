/**
 * The OpenAPI 3.1 document of API v1, generated from the operation table (./operations) and the zod schemas
 * (./schemas). Served at GET /api/v1/openapi.json and committed as public/openapi/v1.json; a test keeps the file
 * identical to this output, every documented operation backed by a route handler and every route handler documented.
 */
import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { EVENT_TYPES } from "@/server/events";
import { WEBHOOK_HEADER, WEBHOOK_MAX_ATTEMPTS } from "@/server/webhooks";
import {
  EXAMPLE_CREATE_HANDOFF,
  EXAMPLE_CREATE_VERIFICATION,
  EXAMPLE_CREATE_WEBHOOK_ENDPOINT,
  EXAMPLE_DECIDED_VERIFICATION,
  EXAMPLE_DONATION,
  EXAMPLE_ERROR,
  EXAMPLE_EVENT,
  EXAMPLE_HANDOFF,
  EXAMPLE_HANDOFF_CREATED,
  EXAMPLE_ME,
  EXAMPLE_VERIFICATION_CREATED,
  EXAMPLE_WEBHOOK_DELIVERY,
  EXAMPLE_WEBHOOK_ENDPOINT,
  EXAMPLE_WEBHOOK_ENDPOINT_WITH_SECRET,
} from "./examples";
import { OPERATIONS, OPERATION_IDS, type OperationDefinition, type OperationId } from "./operations";
import { API_BASE_PATH, API_RATE_LIMIT, IDEMPOTENCY_TTL_MS } from "./policy";
import { apiSchemaRegistry } from "./schemas";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const list = <T>(data: T[]) => ({ object: "list", data, has_more: false, next_cursor: null });

/** Example response body per JSON operation. Each is validated against the operation's schema in tests. */
export const OPERATION_EXAMPLES: Partial<Record<OperationId, unknown>> = {
  createVerification: EXAMPLE_VERIFICATION_CREATED,
  listVerifications: list([EXAMPLE_DECIDED_VERIFICATION]),
  getVerification: EXAMPLE_DECIDED_VERIFICATION,
  cancelVerification: { ...EXAMPLE_DECIDED_VERIFICATION, status: "canceled", stage: "created", method: null, decided_at: null, decided_by: null, evidence_pack_url: null, evidence_json_url: null },
  listDonations: list([EXAMPLE_DONATION]),
  getDonation: EXAMPLE_DONATION,
  createHandoff: EXAMPLE_HANDOFF_CREATED,
  listHandoffs: list([EXAMPLE_HANDOFF]),
  getHandoff: EXAMPLE_HANDOFF,
  completeHandoff: EXAMPLE_HANDOFF,
  cancelHandoff: EXAMPLE_HANDOFF,
  extendHandoffHold: EXAMPLE_HANDOFF,
  getMe: EXAMPLE_ME,
  listEvents: list([EXAMPLE_EVENT]),
  getEvent: EXAMPLE_EVENT,
  createWebhookEndpoint: EXAMPLE_WEBHOOK_ENDPOINT_WITH_SECRET,
  listWebhookEndpoints: list([EXAMPLE_WEBHOOK_ENDPOINT]),
  getWebhookEndpoint: EXAMPLE_WEBHOOK_ENDPOINT,
  updateWebhookEndpoint: EXAMPLE_WEBHOOK_ENDPOINT,
  deleteWebhookEndpoint: { id: EXAMPLE_WEBHOOK_ENDPOINT.id, object: "webhook_endpoint", deleted: true },
  rotateWebhookSecret: EXAMPLE_WEBHOOK_ENDPOINT_WITH_SECRET,
  listWebhookDeliveries: list([EXAMPLE_WEBHOOK_DELIVERY]),
};

/** Example request body per operation with a body. */
export const REQUEST_EXAMPLES: Partial<Record<OperationId, unknown>> = {
  createVerification: EXAMPLE_CREATE_VERIFICATION,
  createHandoff: EXAMPLE_CREATE_HANDOFF,
  completeHandoff: { booking_amount_cents: 45000 },
  cancelHandoff: { reason: "Family chose another session" },
  extendHandoffHold: { hours: 48 },
  createWebhookEndpoint: EXAMPLE_CREATE_WEBHOOK_ENDPOINT,
  updateWebhookEndpoint: { status: "disabled" },
  rotateWebhookSecret: { expire_previous_now: false },
};

function stripMeta(schema: unknown): JsonObject {
  const copy = { ...(schema as JsonObject) };
  delete copy.$schema;
  delete copy.$id;
  return copy;
}

/** Named component schemas: requests as clients send them (input), responses as the API returns them (output). */
function componentSchemas(): Record<string, JsonObject> {
  const uri = (id: string) => `#/components/schemas/${id}`;
  const output = z.toJSONSchema(apiSchemaRegistry, { target: "draft-2020-12", io: "output", uri, unrepresentable: "any" }) as { schemas: Record<string, unknown> };
  const input = z.toJSONSchema(apiSchemaRegistry, { target: "draft-2020-12", io: "input", uri, unrepresentable: "any" }) as { schemas: Record<string, unknown> };
  const out: Record<string, JsonObject> = {};
  for (const id of Object.keys(output.schemas).sort()) {
    out[id] = stripMeta(id.endsWith("Request") ? input.schemas[id] : output.schemas[id]);
  }
  return out;
}

function schemaRef(schema: z.ZodType): JsonObject {
  const meta = apiSchemaRegistry.get(schema);
  if (!meta) throw new Error("OpenAPI: response and body schemas must be registered with an id");
  return { $ref: `#/components/schemas/${meta.id}` };
}

function queryParameters(op: OperationDefinition): JsonObject[] {
  if (!op.query) return [];
  const json = z.toJSONSchema(op.query, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as { properties?: Record<string, JsonObject>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => {
    const { description, ...rest } = schema;
    return { name, in: "query", required: (json.required ?? []).includes(name), ...(typeof description === "string" ? { description } : {}), schema: rest };
  });
}

/** A body is required when its schema has a required field; otherwise it may be omitted (or sent as {}). */
function hasRequiredFields(schema: z.ZodType): boolean {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as { required?: string[] };
  return (json.required ?? []).length > 0;
}

const ERROR_RESPONSES: Record<string, string> = {
  "400": "Malformed request: invalid JSON, wrong content type, bad Idempotency-Key.",
  "401": "Missing, malformed, unknown or revoked API key (one uniform answer).",
  "403": "The key may not do this: wrong organization type, suspended organization, live key required.",
  "404": "Not found — also for another organization's or the other mode's records.",
  "409": "Conflict: wrong state for this action, evidence not ready, or Idempotency-Key reused / in progress.",
  "422": "Validation failed: details.fields names each invalid field.",
  "429": "Rate limited: see Retry-After.",
};

function operationObject(id: OperationId): JsonObject {
  const op = OPERATIONS[id] as OperationDefinition;
  const parameters: JsonObject[] = [];
  if (op.path.includes("{id}")) parameters.push({ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } });
  parameters.push(...queryParameters(op));
  if (op.idempotent) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });

  const success: JsonObject =
    op.response.kind === "json"
      ? {
          description: op.summary,
          content: { "application/json": { schema: schemaRef(op.response.schema), ...(OPERATION_EXAMPLES[id] !== undefined ? { example: OPERATION_EXAMPLES[id] as Json } : {}) } },
        }
      : {
          description: op.response.description,
          content: { [op.response.contentType]: { schema: op.response.contentType === "application/pdf" ? { type: "string", contentMediaType: "application/pdf" } : op.response.contentType === "text/csv" ? { type: "string" } : { type: "object" } } },
        };

  const responses: JsonObject = { [String(op.status)]: success };
  if (!op.public) {
    for (const [code, description] of Object.entries(ERROR_RESPONSES)) responses[code] = { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
  }

  return {
    operationId: id,
    tags: [op.tag],
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    ...(op.public ? { security: [] } : { "x-org-types": [...op.orgTypes] }),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(op.body
      ? {
          requestBody: {
            required: hasRequiredFields(op.body),
            content: { "application/json": { schema: schemaRef(op.body), ...(REQUEST_EXAMPLES[id] !== undefined ? { example: REQUEST_EXAMPLES[id] as Json } : {}) } },
          },
        }
      : {}),
    responses,
  };
}

const DESCRIPTION = [
  `The ${BRAND.name} API: create and read income verifications, receive decisions by webhook, download evidence, and send families from a booking checkout to a partner SGO.`,
  "",
  "Authenticate with a secret key: `Authorization: Bearer ecca_test_…` (test mode) or `ecca_live_…` (live mode). A key only ever sees its own organization's data in its own mode.",
  `Rate limit: ${API_RATE_LIMIT.limit} requests per minute per key (RateLimit-* headers). POST requests accept an Idempotency-Key, remembered for ${IDEMPOTENCY_TTL_MS / 3_600_000} hours.`,
  `Webhooks are signed per Standard Webhooks (${WEBHOOK_HEADER.id}, ${WEBHOOK_HEADER.timestamp}, ${WEBHOOK_HEADER.signature}) and retried up to ${WEBHOOK_MAX_ATTEMPTS} attempts. Event types: ${EVENT_TYPES.join(", ")}.`,
  "",
  "Not legal or tax advice. Section 25F eligibility rules are proposed regulations, not final; income limits are provisional until the IRS publishes its table.",
].join("\n");

/** The complete OpenAPI 3.1 document. Deterministic: the same code always yields the same JSON. */
export function openApiDocument(): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const id of OPERATION_IDS) {
    const op = OPERATIONS[id] as OperationDefinition;
    paths[op.path] ??= {};
    paths[op.path][op.method.toLowerCase()] = operationObject(id);
  }
  const tags = [...new Set(OPERATION_IDS.map((id) => (OPERATIONS[id] as OperationDefinition).tag))].map((name) => ({ name }));
  return {
    openapi: "3.1.0",
    info: { title: `${BRAND.name} API`, version: "v1", description: DESCRIPTION },
    servers: [{ url: API_BASE_PATH, description: "This deployment" }],
    security: [{ bearerAuth: [] }],
    tags,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "ecca_test_… or ecca_live_…", description: "A secret API key. Never put it in a browser or an app." } },
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description: "Retry-safe POST: the same key with the same body returns the stored response; with a different body, 409.",
          schema: { type: "string", minLength: 1, maxLength: 255 },
        },
      },
      schemas: componentSchemas(),
    },
    "x-error-example": EXAMPLE_ERROR as unknown as Json,
  };
}

/** The committed copy's location in the repository (served statically at /openapi/v1.json). */
export const OPENAPI_PUBLIC_FILE = "public/openapi/v1.json";
