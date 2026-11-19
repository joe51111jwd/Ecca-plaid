/**
 * Point-of-booking handoff: a camp, school or other vendor sends a family from its booking checkout to a partner SGO
 * to verify household income, holds the reservation for a stated window, and completes the booking with
 * scholarship funds if the SGO awards a scholarship. The public API of src/server/handoffs.
 *
 * The business is the customer for this surface; the family never pays and never sees a fee. Verifying income does
 * not promise an award, and an award does not promise that the business will be paid.
 *
 *  - Create: createHandoff(input, source) — source `{ kind: "api", … }` (secret API key) or `{ kind: "embed", … }`
 *    (publishable key; origin-checked and rate-limited). chooseHandoffSgo (family picks among partners),
 *    reissueHandoffLink (business resends the link).
 *  - Lifecycle: extendHold, completeHandoff (accrues the success fee), cancelHandoff, cancelHandoffByFamily.
 *  - SGO decisions (for src/server/awards only): markHandoffAwarded, declineHandoffForSgo.
 *  - Family page: getHandoffView(token).
 *  - Read models: listHandoffs, getHandoff, recordToApi / toApiHandoff, handoffConversionStats, listHandoffsForSgo,
 *    getHandoffForSgo.
 *  - Jobs (jobs.ts): "handoff.verification_updated"; recurring "handoff.expire_holds" and "handoff.sync_progress".
 */
export {
  chooseHandoffSgo,
  createHandoff,
  isWellFormedHandoffToken,
  NO_PARTNER_ERROR_MESSAGE,
  reissueHandoffLink,
  type CreateHandoffInput,
  type CreateHandoffResult,
  type HandoffSource,
} from "./create";
export {
  applyVerificationOutcome,
  cancelHandoff,
  cancelHandoffByFamily,
  completeHandoff,
  declineHandoffForSgo,
  expireDueHolds,
  extendHold,
  markHandoffAwarded,
  syncDueProgress,
  syncHandoffWithVerification,
  type CompleteHandoffResult,
  type SgoDecisionContext,
} from "./lifecycle";
export { getHandoffView, type HandoffStep, type HandoffView } from "./view";
export {
  getHandoff,
  getHandoffForSgo,
  handoffConversionStats,
  listHandoffs,
  listHandoffsForSgo,
  recordToApi,
  type HandoffConversionStats,
  type HandoffPage,
  type HandoffRecord,
  type ListHandoffsParams,
  type SgoHandoffView,
} from "./read";
export { centsToUsdString, toApiHandoff, toWebhookPayload, type ApiHandoff, type AwardPaymentMethod, type HandoffRelated, type HandoffRow, type HandoffWebhookPayload } from "./serialize";
export {
  allowedTransitions,
  canTransition,
  FINAL_STATUSES,
  HANDOFF_STATUSES,
  HOLDING_STATUSES,
  isFinal,
  isHandoffStatus,
  holdIsActive,
  isHolding,
  publicVerificationStatus,
  targetForVerification,
  type PublicVerificationStatus,
  type VerificationProgress,
} from "./state";
export { handoffSystemActor, type HandoffActor } from "./internal";
export { BUSINESS_STATUS_DETAIL, familyNotices, formatDeadline, HANDOFF_COPY_VERSION, statusText, type StatusText } from "./copy";
export * from "./policy";
export { HANDOFF_EXPIRE_HOLDS, HANDOFF_SYNC_PROGRESS, HANDOFF_VERIFICATION_UPDATED } from "./jobs";
