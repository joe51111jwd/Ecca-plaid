/**
 * Data rails for auto-submit: a licensed payroll or bank connection (simulated sandbox by default, Plaid
 * when RAIL_PROVIDER=plaid), the normalized income report, the step from report to income items, and the
 * guided IRS transcript path. The public API of src/server/rails.
 *
 * Family-facing functions take a `RailActor` and check household access themselves. `getRailSummaryForDecision`
 * and `syncConnection` are for jobs and services that already checked access.
 */
export {
  completeConnection,
  declineConnection,
  getConnection,
  getRailSummaryForDecision,
  handleRailWebhook,
  listConnections,
  previewRailConsent,
  RAIL_REPORT_PURPOSE,
  RAIL_REVOKE_REMOTE_JOB,
  RAIL_SYNC_JOB,
  RAIL_TOKEN_PURPOSE,
  RAIL_WEBHOOK_PATH,
  railReportSha256,
  retryRemoteRevoke,
  revokeConnection,
  revokeConnectionsForConsent,
  startConnection,
  syncConnection,
  type RailActor,
  type RailConsentPreview,
  type RailDecisionConnection,
  type RailDecisionSummary,
  type RailWebhookResult,
  type StartConnectionInput,
  type SyncOptions,
} from "./service";
export type { RailConnectionView, RailRetrievedSource, StartedConnectionView } from "./views";
export {
  isRailFailureReason,
  isRailProviderError,
  normalizedIncomeReportSchema,
  RAIL_FAILURE_REASONS,
  RAIL_KINDS,
  RAIL_PROVIDER_IDS,
  RAIL_SOURCE_TYPES,
  RailProviderError,
  type CompleteLinkResult,
  type CreateLinkSessionInput,
  type CreateLinkSessionResult,
  type FetchContext,
  type FetchIncomeResult,
  type LinkSessionPayload,
  type NormalizedIncomeReport,
  type NormalizedIncomeSource,
  type RailConnection,
  type RailFailureReason,
  type RailKind,
  type RailMemberRef,
  type RailProvider,
  type RailProviderId,
  type RailReadiness,
  type RailSourceType,
  type RailStatus,
  type RailWebhookEvent,
  type SimulatedPersonaOption,
} from "./types";
export { isCountableSource, isReviewSource, reportToEvidence, type ReportEvidence } from "./normalize";
export { RAIL_DECLINED_COPY, RAIL_FAILURE_COPY, RAIL_REVOKED_COPY, RAIL_STATUS_LABELS, railFailureMessage, SIMULATED_PROVIDER_NAME, type RailLocale } from "./copy";
export { RAIL_POLICY, SIMULATED_SLOW_READY_AFTER_MS } from "./policy";
export { configuredRailProviderId, getRailProvider, RAIL_PROVIDER_INFO, railModeMismatch, railProviderForMode, setRailProviderForTests } from "./providers";
export { SIMULATED_PERSONA_IDS, SIMULATED_PERSONAS, simulatedPersonasFor, simulatedRail, type SimulatedPersonaId } from "./simulated";
export { createPlaidRail, type PlaidConfig, type PlaidRail } from "./plaid";
export { customerFileNumberFor, getTranscriptGuide, TRANSCRIPT_GUIDE_SOURCES, TRANSCRIPT_GUIDE_VERSION, type TranscriptGuide, type TranscriptGuideStep } from "./transcript";
