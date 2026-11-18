/**
 * Contracts for the data rails behind auto-submit: the provider interface every rail adapter implements,
 * the normalized income report every provider produces, and the failure codes the family sees.
 *
 * The report is what gets stored (encrypted, purpose "rail-report") and hashed. It deliberately carries no
 * raw provider payload: only the figures the income engine needs, the provider's own identifiers and a
 * SHA-256 of the provider response (docs/reference/payments-and-rails.md, implication 28).
 */
import { z } from "zod";
import type { schema } from "@/db/client";
import type { RailStatus } from "@/db/schema";
import { AppError } from "@/lib/errors";

export type RailConnection = typeof schema.railConnections.$inferSelect;
export type { RailStatus };

/** Providers that can be connected. `irs_transcript` in the schema is not a rail: transcripts go through the document path. */
export type RailProviderId = "simulated" | "plaid";
export type RailKind = "payroll" | "bank";
export const RAIL_PROVIDER_IDS: readonly RailProviderId[] = ["simulated", "plaid"];
export const RAIL_KINDS: readonly RailKind[] = ["payroll", "bank"];

/* ---------------------------------------------------------------------------------- failures */

/**
 * Why a connection did not produce data. Stored in `rail_connections.failure_reason`; the family sees the
 * matching sentence from ./copy and is offered upload with everything else kept.
 */
export const RAIL_FAILURE_REASONS = ["provider_unavailable", "employer_not_found", "no_data_for_year", "connection_expired", "records_unreadable"] as const;
export type RailFailureReason = (typeof RAIL_FAILURE_REASONS)[number];

export function isRailFailureReason(value: unknown): value is RailFailureReason {
  return typeof value === "string" && (RAIL_FAILURE_REASONS as readonly string[]).includes(value);
}

/**
 * A provider call that failed. `retryable` failures (outages, timeouts, 5xx) are retried by the sync job;
 * the others end the connection with `reason`.
 */
export class RailProviderError extends AppError {
  readonly reason: RailFailureReason;
  readonly retryable: boolean;
  constructor(reason: RailFailureReason, message: string, opts: { retryable?: boolean; details?: Record<string, unknown> } = {}) {
    super("not_available", message, { reason, ...(opts.details ?? {}) });
    this.name = "AppError";
    this.reason = reason;
    this.retryable = opts.retryable ?? false;
  }
}

export function isRailProviderError(e: unknown): e is RailProviderError {
  return e instanceof RailProviderError;
}

/* ------------------------------------------------------------------------------------ report */

/**
 * What a provider says about one stream of income.
 *  - `w2`: a Form W-2 for `taxYear`; `grossAnnualCents` is box 1 (wages, tips, other compensation).
 *  - `final_paystub_ytd`: the last pay stub of `taxYear` from one employer; `grossAnnualCents` is its
 *    year-to-date gross pay.
 *  - `paystub_projection`: a pay stub that does not close the year; `grossAnnualCents` is a straight-line
 *    projection shown to a reviewer, never counted.
 *  - `bank_income_estimate`: deposits seen in a bank account, which are net of taxes and deductions; never
 *    counted.
 * Only `w2` and `final_paystub_ytd` for the income year become counted income automatically.
 */
export const RAIL_SOURCE_TYPES = ["w2", "final_paystub_ytd", "paystub_projection", "bank_income_estimate"] as const;
export type RailSourceType = (typeof RAIL_SOURCE_TYPES)[number];
/** Coarse, so the report stays canonical-JSON safe (integers and strings only). */
export type RailConfidence = "high" | "medium" | "low";
export type RailPayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface NormalizedIncomeSource {
  type: RailSourceType;
  employerName: string | null;
  grossAnnualCents: number;
  taxYear: number;
  confidence: RailConfidence;
  /** One plain sentence for a reviewer about where the figure came from. */
  note: string;
  /** W-2 box 5 (Medicare wages and tips), when the provider gave it. */
  medicareWagesCents: number | null;
  /** Pay stubs: the pay date (YYYY-MM-DD) and frequency, and the year-to-date gross printed on the stub. */
  payDate: string | null;
  payFrequency: RailPayFrequency | null;
  ytdGrossCents: number | null;
  /** The provider's id for the underlying document or income source, when it has one. */
  providerRef: string | null;
}

export interface NormalizedIncomeReport {
  /** Format version of this object; bump when the shape changes so stored reports stay readable. */
  version: 1;
  provider: RailProviderId;
  kind: RailKind;
  /** Sandbox data is never real income. */
  sandbox: boolean;
  /** ISO timestamp, passed in by the caller (never read from the clock inside a provider). */
  retrievedAt: string;
  incomeYear: number;
  person: { name: string | null };
  sources: NormalizedIncomeSource[];
  coverage: { incomeYearCovered: boolean; partialYear: boolean };
  /** What the amounts are: gross payroll figures, or bank deposits (net). */
  dataBasis: "payroll_gross" | "bank_net_deposits";
  /** How many W-2s, pay stubs or bank income streams the provider returned, before any filtering by year. */
  recordsSeen: number;
  warnings: string[];
  /** SHA-256 of the provider's raw response body, so the exact payload can be matched later without being stored. */
  providerResponseSha256: string | null;
}

const cents = z.number().int().min(0).max(1_000_000_000_000);
const year = z.number().int().min(2000).max(2999);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const normalizedIncomeSourceSchema = z.strictObject({
  type: z.enum(RAIL_SOURCE_TYPES),
  employerName: z.string().max(200).nullable(),
  grossAnnualCents: cents,
  taxYear: year,
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().max(1000),
  medicareWagesCents: cents.nullable(),
  payDate: isoDate.nullable(),
  payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).nullable(),
  ytdGrossCents: cents.nullable(),
  providerRef: z.string().max(200).nullable(),
});

export const normalizedIncomeReportSchema = z.strictObject({
  version: z.literal(1),
  provider: z.enum(["simulated", "plaid"]),
  kind: z.enum(["payroll", "bank"]),
  sandbox: z.boolean(),
  retrievedAt: z.iso.datetime({ offset: true }),
  incomeYear: year,
  person: z.strictObject({ name: z.string().max(200).nullable() }),
  sources: z.array(normalizedIncomeSourceSchema).max(200),
  coverage: z.strictObject({ incomeYearCovered: z.boolean(), partialYear: z.boolean() }),
  dataBasis: z.enum(["payroll_gross", "bank_net_deposits"]),
  recordsSeen: z.number().int().min(0).max(100_000),
  warnings: z.array(z.string().max(1000)).max(100),
  providerResponseSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});

/* ---------------------------------------------------------------------------------- provider */

/** The household member whose account is being connected. */
export interface RailMemberRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface CreateLinkSessionInput {
  connectionId: string;
  householdId: string;
  member: RailMemberRef;
  incomeYear: number;
  kind: RailKind;
  locale: "en" | "es";
  /** Absolute URL the provider should call back, for providers that use webhooks. */
  webhookUrl: string;
}

/** One choice in the simulated provider's sandbox picker. */
export interface SimulatedPersonaOption {
  id: string;
  label: { en: string; es: string };
  description: { en: string; es: string };
}

/** What the browser needs to open the provider's own screen. Never contains a secret. */
export type LinkSessionPayload =
  | { provider: "simulated"; sandbox: true; personas: SimulatedPersonaOption[] }
  | { provider: "plaid"; sandbox: boolean; linkToken: string; expiration: string | null };

export interface CreateLinkSessionResult {
  client: LinkSessionPayload;
  /** The provider-side user id, when the provider creates one up front (Plaid `user_id`). */
  externalId: string | null;
}

/** How the data becomes available after the person finishes on the provider's screen. */
export type RailReadiness =
  /** Fetch now. */
  | { type: "immediate" }
  /** Fetch after a delay (the provider is still preparing it). */
  | { type: "poll"; afterMs: number }
  /** The provider will call our webhook; poll after `fallbackPollMs` in case the webhook is lost. */
  | { type: "webhook"; fallbackPollMs: number };

export type CompleteLinkResult =
  | { outcome: "linked"; externalId: string; accessToken: string | null; readiness: RailReadiness }
  | { outcome: "declined" }
  | { outcome: "failed"; reason: RailFailureReason; detail: string };

export interface FetchContext {
  /** The access token, already decrypted, when the connection has one. */
  accessToken: string | null;
  incomeYear: number;
  member: RailMemberRef;
  /** The moment of retrieval; stamped into the report as `retrievedAt`. */
  retrievedAt: Date;
}

export type FetchIncomeResult = { state: "ready"; report: NormalizedIncomeReport } | { state: "pending"; retryAfterMs: number };

/** A verified webhook, reduced to what the service acts on. */
export interface RailWebhookEvent {
  /** Matches `rail_connections.external_id`. Null for events that name no connection. */
  externalId: string | null;
  /** `ready`: fetch and inspect. `failed`: the provider could not process. `ignored`: nothing to do. */
  event: "ready" | "failed" | "ignored";
  detail: string;
}

export interface RailProvider {
  readonly id: RailProviderId;
  /** Shown to the family and named in the rail_connect consent. */
  readonly displayName: string;
  /** True when this provider instance only ever returns test data. */
  readonly sandbox: boolean;
  /**
   * The vendor's own statement about whether it is a consumer reporting agency (fact 53). Carried into the
   * evidence trail for counsel; it says nothing about this product's own FCRA status.
   */
  readonly craPosture: "vendor_states_not_cra" | "vendor_is_cra" | "unknown" | "not_applicable";
  createLinkSession(input: CreateLinkSessionInput): Promise<CreateLinkSessionResult>;
  /** Validates what the browser reported (never trusted as data) and finishes the link. */
  completeLink(input: { connection: RailConnection; clientResult: unknown; at: Date }): Promise<CompleteLinkResult>;
  fetchIncomeReport(connection: RailConnection, ctx: FetchContext): Promise<FetchIncomeResult>;
  /** Removes our access at the provider. Must succeed when the access is already gone. */
  revoke(connection: RailConnection, ctx: { accessToken: string | null }): Promise<void>;
  /** Verifies the signature FIRST, then parses. Throws AppError `unauthenticated` for a bad signature. */
  parseWebhook?(rawBody: string, headers: { get(name: string): string | null }): Promise<RailWebhookEvent>;
}
