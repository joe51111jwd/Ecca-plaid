/**
 * Public HTTP API v1: API keys, authentication, the route wrapper, idempotency, the OpenAPI document and the CSV
 * export. The public API of src/server/api.
 *
 *  - Keys (dashboard): createApiKey, listApiKeys, revokeApiKey. The full key is returned once; only its hash is kept.
 *  - Requests: authenticateApiKey(request) and apiRoute({ orgTypes, query, body, handler }) for route handlers under
 *    src/app/api/v1. Every operation is listed in OPERATIONS (./operations).
 *  - OpenAPI: openApiDocument() (served at /api/v1/openapi.json, committed as public/openapi/v1.json).
 *  - Docs: the developer docs at /docs render samples from ./docs-samples, which tests execute.
 */
export {
  API_KEY_MANAGER_ROLE,
  API_ORG_TYPES,
  authenticateApiKey,
  createApiKey,
  hasActiveLiveKey,
  listApiKeys,
  orgAllowsMode,
  parseBearer,
  revokeApiKey,
  UNAUTHENTICATED_MESSAGE,
  type ApiAuth,
  type ApiKeyActor as ApiKeyManager,
  type ApiKeySummary,
  type Organization,
} from "./keys";
export { apiRoute, listEnvelope, newRequestId, type ApiContext, type ApiHandlerResult, type ApiKeyActor, type ApiOrgType, type ApiRouteSpec, type RouteHandlerContext } from "./route";
export { beginIdempotentRequest, completeIdempotentRequest, purgeExpiredIdempotencyKeys, releaseIdempotentRequest, stableStringify, type IdempotencyRequest, type IdempotencyStart } from "./idempotency";
export { OPERATIONS, OPERATION_IDS, operation, type HttpMethod, type OperationDefinition, type OperationId, type OperationResponse } from "./operations";
export { OPENAPI_PUBLIC_FILE, OPERATION_EXAMPLES, openApiDocument, REQUEST_EXAMPLES } from "./openapi";
export { buildVerificationsCsv, MAX_CSV_COLUMNS, METADATA_COLUMN_PATTERN, parseCsvColumns, STANDARD_CSV_COLUMNS, VERIFICATION_CSV_COLUMNS, type CsvColumn, type StandardCsvColumn } from "./csv-export";
export { listDeliveriesForMode, toApiEvent, toApiMe, toApiWebhookDelivery, toApiWebhookEndpoint, type ApiEvent, type ApiMe, type ApiWebhookDelivery, type ApiWebhookEndpoint } from "./serialize";
export { apiHandoff, assertDonationInMode, assertWebhookWritable, evidenceResponse, exportVerificationsCsv, handoffInputFromBody, verificationInputFromBody } from "./handlers";
export { HANDOFF_EMBED_CONTRACT } from "./handoff-embed-contract";
export * from "./policy";
export * as apiSchemas from "./schemas";
