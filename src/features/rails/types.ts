import type { ActionResult } from "@/lib/errors";
import type { RailSourceType } from "@/server/rails/types";
import type { RailConnectionView, StartedConnectionView } from "@/server/rails/views";

export type { RailConnectionView, StartedConnectionView };

/**
 * Every visible word of <RailConnect>, supplied by the family UI (which owns the English and Spanish
 * dictionaries). Persona names come from the server's sandbox payload and failure sentences from the
 * connection view, both already in both languages.
 */
export interface RailConnectStrings {
  heading: string;
  intro: string;
  /** Button that records the consent and opens the provider. */
  connectButton: string;
  connecting: string;
  /** The escape hatch, visible in every state. */
  uploadInstead: string;
  /** "Simulated payroll provider — sandbox" style heading over the persona picker. */
  sandboxHeading: string;
  /** Says no real account is used and nothing typed here is a password. */
  sandboxExplanation: string;
  /** Short marker shown next to a provider running in its sandbox (e.g. Plaid sandbox). */
  sandboxBadge: string;
  choosePersona: string;
  continueButton: string;
  /** Leaves the provider screen without sharing (a decline). */
  declineButton: string;
  plaidOpenButton: string;
  plaidLoading: string;
  plaidLoadFailed: string;
  waitingTitle: string;
  waitingBody: string;
  readyTitle: string;
  readyBody: string;
  /** Records were received but none can count on their own: the family should also upload. */
  readyNeedsUpload: string;
  failedTitle: string;
  declinedTitle: string;
  revokedTitle: string;
  tryAgain: string;
  errorGeneric: string;
  /** Validation message when the consent box is not ticked. */
  consentRequired: string;
  /** Table caption over the retrieved records. */
  retrievedCaption: string;
  sourceTypeLabels: Record<RailSourceType, string>;
  countedLabel: string;
  notCountedLabel: string;
}

/** The rail_connect consent exactly as the server rendered it (`previewRailConsent`). */
export interface RailConsentText {
  title: string;
  paragraphs: readonly string[];
  checkboxLabel: string;
  sha256: string;
}

/**
 * Server actions the page passes in. Each wraps the matching src/server/rails function with the signed-in
 * actor and returns an ActionResult (never throws across the client boundary).
 */
export interface RailConnectActions {
  start: (input: { shownSha256: string }) => Promise<ActionResult<StartedConnectionView>>;
  complete: (connectionId: string, clientResult: unknown) => Promise<ActionResult<RailConnectionView>>;
  decline: (connectionId: string) => Promise<ActionResult<RailConnectionView>>;
  refresh: (connectionId: string) => Promise<ActionResult<RailConnectionView>>;
}
