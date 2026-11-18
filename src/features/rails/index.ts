/**
 * Auto-submit UI. The family flow embeds `<RailConnect>` with server actions wrapping src/server/rails and a
 * strings object from its dictionaries.
 */
export { DEFAULT_RAIL_POLL_INTERVAL_MS, RailConnect, type RailConnectProps } from "./RailConnect";
export { initialRailConnectState, phaseForConnection, railConnectReducer, shouldOfferUpload, type RailConnectEvent, type RailConnectPhase, type RailConnectState } from "./state";
export { loadPlaidLink, PLAID_LINK_LOAD_TIMEOUT_MS, PLAID_LINK_SCRIPT_URL, plaidExitResult, plaidSuccessResult, type PlaidGlobal, type PlaidLinkError, type PlaidLinkExitMetadata } from "./plaid-link";
export type { RailConnectActions, RailConnectionView, RailConnectStrings, RailConsentText, StartedConnectionView } from "./types";
