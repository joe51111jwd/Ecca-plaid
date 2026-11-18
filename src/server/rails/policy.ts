import { MS } from "@/lib/clock";

/**
 * Product policy for the data rails. None of these values comes from section 25F, the proposed regulations
 * or a vendor contract: the sources are silent, so each is a named constant that can be changed in one
 * place (docs/reference/payments-and-rails.md, engineering implications 22-31 and 46).
 */
export const RAIL_POLICY = Object.freeze({
  /**
   * After a provider that reports readiness by webhook (Plaid Payroll Income) says the person finished,
   * we also poll once after this long, so a lost webhook cannot leave the family waiting forever.
   */
  webhookFallbackPollMs: 10 * MS.minute,
  /** Gap between polls while a provider says the data is still being prepared. */
  pollIntervalMs: 2 * MS.minute,
  /**
   * Polls before giving up and marking the connection failed ("provider_unavailable"). With the interval
   * above this is about 30 minutes, after which the family is steered back to upload.
   */
  maxPolls: 15,
  /**
   * Days of bank history requested from Plaid Bank Income. 731 is the documented maximum ("1 to 731",
   * fact 59); asking for the maximum is the only fixed value that always reaches back over the whole
   * prior calendar year whatever day the family applies.
   */
  plaidBankDaysRequested: 731,
  /** Verification stages in which a family may still start or finish a connection. */
  openStages: Object.freeze(["created", "started", "consented", "household", "collecting", "awaiting_family", "in_review"] as const),
  /**
   * Members whose payroll or bank account may be connected. A minor with a job can have pay records, so
   * students are allowed; the provider's own sign-in screen asks for that person's credentials.
   */
  connectableMemberKinds: Object.freeze(["adult", "student", "other"] as const),
  /**
   * Whether the household owner may start a connection for another member who has no sign-in of their
   * own. A member who has their own sign-in always connects their own account (the rail_connect consent
   * is personal, src/server/consents).
   */
  ownerMayConnectForMembersWithoutSignIn: true,
  /**
   * Whether revoking a connection also deletes the income items it produced. Before a decision the items
   * are removed (the family withdrew the data). After a decision they are kept, because the decision
   * record and evidence pack already rest on them; the report itself is deleted either way and only its
   * SHA-256 stays.
   */
  deleteItemsOnRevokeBeforeDecision: true,
});

/**
 * The simulated provider's "slow" persona becomes ready this long after the person finishes. Short, so a
 * demo shows the waiting state without stalling.
 */
export const SIMULATED_SLOW_READY_AFTER_MS = 20 * MS.second;
