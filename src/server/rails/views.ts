/**
 * Plain, serializable shapes the rails service returns to pages and client components. Type-only: a client
 * component may `import type` from here without pulling server code into the browser bundle.
 */
import type { LinkSessionPayload, NormalizedIncomeReport, RailFailureReason, RailKind, RailProviderId, RailSourceType, RailStatus } from "./types";

export interface RailRetrievedSource {
  type: RailSourceType;
  employerName: string | null;
  taxYear: number;
  grossAnnualCents: number;
  /** True when this source may count as income automatically (a W-2 or year-end pay stub for the income year). */
  counted: boolean;
}

export interface RailConnectionView {
  id: string;
  verificationId: string;
  memberId: string | null;
  provider: RailProviderId;
  providerName: string;
  kind: RailKind;
  status: RailStatus;
  /** True for the simulated provider and any provider sandbox: never real income. */
  sandbox: boolean;
  failureReason: RailFailureReason | null;
  /** Plain-language reason in both languages, for a failed connection. */
  failureMessage: { en: string; es: string } | null;
  /** SHA-256 of the stored report; kept after a revocation for the evidence trail. */
  reportSha256: string | null;
  /** What the connection found, for the family to see. Null until a report is stored (and after revocation). */
  retrieved: {
    incomeYear: number;
    sources: RailRetrievedSource[];
    coverage: NormalizedIncomeReport["coverage"];
  } | null;
  /** True while the family should keep waiting (the provider is preparing the data). */
  waiting: boolean;
  /** True when the family should be offered upload as the next step (failed, declined, revoked, or nothing countable found). */
  offerUpload: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StartedConnectionView {
  connection: RailConnectionView;
  /** What the browser needs to open the provider's screen. Null when the provider could not start a session (the connection is then failed). */
  client: LinkSessionPayload | null;
  consentId: string;
}
