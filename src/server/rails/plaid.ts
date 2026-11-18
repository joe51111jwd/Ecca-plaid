/**
 * Plaid Income adapter (RAIL_PROVIDER=plaid), REST over fetch with no SDK (plaid-node changed its whole
 * surface in v51; docs/reference/payments-and-rails.md fact 62). The flow is the documented one (facts
 * 55-59, sketch P2):
 *
 *   createLinkSession  /user/create (client_user_id = our connection id, never PII) → /link/token/create
 *                      with products ["income_verification"] and the payroll or bank income options
 *   completeLink       Payroll: nothing to exchange. Plaid: "because Payroll and Document Income are fetched
 *                      once ... there's no need to retrieve or store an access_token". Bank: the public
 *                      token is exchanged (/item/public_token/exchange) so the Item can be removed later;
 *                      the access token is stored only encrypted (purpose "rail-token") by the service.
 *   webhook            INCOME / USER_INCOME_VERIFICATION, verified FIRST (./plaid-webhook). PROCESSING_COMPLETE
 *                      means "fetch and inspect", never "data is usable": Plaid says it fires when documents
 *                      "have been parsed successfully or ... were not parsable".
 *   fetchIncomeReport  /credit/payroll_income/get or /credit/bank_income/get with user_id; checks the
 *                      top-level `error` even on a 2xx and each Item's processing_status.
 *   revoke             /item/remove (bank, with the access token) then /user/remove (user_id).
 *
 * Not exercised against Plaid's live sandbox from this codebase; unit tests run against the documented shapes.
 */
import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { now } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError, badRequest } from "@/lib/errors";
import { decimalToCents, payStubSources, summarizeCoverage, type RawPayStub } from "./normalize";
import { verifyPlaidWebhook, type PlaidWebhookKey } from "./plaid-webhook";
import { RAIL_POLICY } from "./policy";
import {
  RailProviderError,
  type CompleteLinkResult,
  type CreateLinkSessionInput,
  type CreateLinkSessionResult,
  type FetchContext,
  type FetchIncomeResult,
  type NormalizedIncomeReport,
  type NormalizedIncomeSource,
  type RailConnection,
  type RailFailureReason,
  type RailKind,
  type RailPayFrequency,
  type RailProvider,
  type RailWebhookEvent,
} from "./types";

export const PLAID_API_VERSION = "2020-09-14";
export const PLAID_BASE_URLS = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" } as const;
/** Policy: how long one Plaid API call may take before it counts as an outage (retried by the sync job). */
export const PLAID_REQUEST_TIMEOUT_MS = 20_000;
/**
 * Policy (sources are silent): how long a fetched webhook verification key is trusted before it is fetched
 * again. Plaid can expire a key (`expired_at`); without a refresh, a key cached while still valid would keep
 * verifying webhooks after Plaid expired it.
 */
export const PLAID_WEBHOOK_KEY_CACHE_MS = 60 * 60 * 1000;

export interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: "sandbox" | "production";
  /** Defaults to the global fetch. Injected in tests. */
  fetch?: typeof fetch;
}

/* ----------------------------------------------------------------------------- error mapping */

/**
 * Plaid error codes we act on specially (each appears in Plaid's docs fetched for the reference). Anything
 * else is an outage if Plaid answered 5xx/429 (retryable) or a non-retryable provider failure otherwise.
 */
const ERROR_REASONS: Readonly<Record<string, { reason: RailFailureReason; retryable: boolean }>> = Object.freeze({
  INSTITUTION_DOWN: { reason: "provider_unavailable", retryable: true },
  INSTITUTION_NOT_RESPONDING: { reason: "provider_unavailable", retryable: true },
  ITEM_LOGIN_REQUIRED: { reason: "connection_expired", retryable: false },
  INVALID_LINK_TOKEN: { reason: "connection_expired", retryable: false },
});

/** Link's onExit `metadata.status` values that mean the person's employer or bank was not available. */
const NOT_FOUND_EXIT_STATUSES: ReadonlySet<string> = new Set(["institution_not_found", "institution_not_supported"]);

interface PlaidErrorBody {
  error_type?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export class PlaidApiError extends RailProviderError {
  readonly httpStatus: number | null;
  readonly plaidErrorCode: string | null;
  constructor(path: string, httpStatus: number | null, body: PlaidErrorBody | null) {
    const code = body?.error_code ?? null;
    const mapped = code ? ERROR_REASONS[code] : undefined;
    const retryable = mapped?.retryable ?? (httpStatus === null || httpStatus >= 500 || httpStatus === 429);
    super(mapped?.reason ?? "provider_unavailable", `Plaid ${path} failed${httpStatus ? ` with ${httpStatus}` : ""}${code ? ` (${body?.error_type ?? "error"}/${code})` : ""}`, {
      retryable,
      details: { path, httpStatus, plaidErrorType: body?.error_type ?? null, plaidErrorCode: code },
    });
    this.httpStatus = httpStatus;
    this.plaidErrorCode = code;
  }
}

/* ------------------------------------------------------------------------------ response shapes */

// Only the fields used; every field is nullable in Plaid's reference. W-2 amounts are strings, pay stub
// amounts are numbers (fact 57). Unknown fields are allowed (passthrough by default in z.object).
const nstr = z.string().nullish();
const nnum = z.number().nullish();

const payrollIncomeGetSchema = z.object({
  items: z
    .array(
      z.object({
        item_id: nstr,
        status: z.object({ processing_status: nstr }).nullish(),
        payroll_income: z
          .array(
            z.object({
              w2s: z
                .array(
                  z.object({
                    document_id: nstr,
                    tax_year: z.union([z.string(), z.number()]).nullish(),
                    wages_tips_other_comp: z.union([z.string(), z.number()]).nullish(),
                    medicare_wages_and_tips: z.union([z.string(), z.number()]).nullish(),
                    employer: z.object({ name: nstr }).nullish(),
                  }),
                )
                .nullish(),
              pay_stubs: z
                .array(
                  z.object({
                    document_id: nstr,
                    earnings: z.object({ total: z.object({ ytd_amount: nnum, current_amount: nnum }).nullish() }).nullish(),
                    pay_period_details: z.object({ pay_date: nstr, pay_frequency: nstr }).nullish(),
                    employer: z.object({ name: nstr }).nullish(),
                    employee: z.object({ name: nstr }).nullish(),
                  }),
                )
                .nullish(),
              form1099s: z.array(z.unknown()).nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
  error: z.object({ error_type: nstr, error_code: nstr, error_message: nstr }).nullish(),
});
export type PlaidPayrollIncomeGet = z.infer<typeof payrollIncomeGetSchema>;

const bankIncomeGetSchema = z.object({
  bank_income: z
    .array(
      z.object({
        bank_income_id: nstr,
        items: z
          .array(
            z.object({
              bank_income_sources: z
                .array(
                  z.object({
                    income_source_id: nstr,
                    income_description: nstr,
                    income_category: nstr,
                    historical_summary: z
                      .array(
                        z.object({
                          start_date: nstr,
                          end_date: nstr,
                          total_amounts: z.array(z.object({ amount: nnum, iso_currency_code: nstr })).nullish(),
                        }),
                      )
                      .nullish(),
                  }),
                )
                .nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
  error: z.object({ error_type: nstr, error_code: nstr, error_message: nstr }).nullish(),
});
export type PlaidBankIncomeGet = z.infer<typeof bankIncomeGetSchema>;

/* --------------------------------------------------------------------------------- normalization */

const FREQUENCY: Readonly<Record<string, RailPayFrequency>> = { WEEKLY: "weekly", BIWEEKLY: "biweekly", SEMI_MONTHLY: "semimonthly", MONTHLY: "monthly" };
const NOT_READY_STATUSES: ReadonlySet<string> = new Set(["PROCESSING", "APPROVAL_STATUS_PENDING"]);

/** Plaid strings are unbounded; the stored report caps them (normalizedIncomeReportSchema). */
function clip(value: string | null | undefined, max = 200): string | null {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** The report keeps at most 100 distinct warnings; repeated per-record warnings collapse into one. */
export const PLAID_MAX_REPORT_WARNINGS = 100;
function capWarnings(warnings: readonly string[]): string[] {
  const distinct = [...new Set(warnings.map((w) => (w.length > 1000 ? w.slice(0, 1000) : w)))];
  if (distinct.length <= PLAID_MAX_REPORT_WARNINGS) return distinct;
  return [...distinct.slice(0, PLAID_MAX_REPORT_WARNINGS - 1), `${distinct.length - (PLAID_MAX_REPORT_WARNINGS - 1)} further warning(s) were left out.`];
}

interface NormalizeContext {
  incomeYear: number;
  retrievedAt: Date;
  sandbox: boolean;
  rawSha256: string;
}

/**
 * Plaid Payroll Income → normalized report, or `pending` while any Item is still processing or waiting for
 * the person's approval. Throws RailProviderError when Plaid reports an error with nothing usable, or every
 * Item failed.
 */
export function normalizePlaidPayrollIncome(json: PlaidPayrollIncomeGet, ctx: NormalizeContext): FetchIncomeResult {
  const warnings: string[] = [];
  const items = json.items ?? [];
  if (json.error && items.length === 0) throw new PlaidApiError("/credit/payroll_income/get", 200, json.error);
  if (json.error) warnings.push(`Plaid reported ${json.error.error_type ?? "an error"}/${json.error.error_code ?? "unknown"} alongside the data.`);

  const statuses = items.map((item) => item.status?.processing_status ?? "UNKNOWN");
  if (statuses.some((s) => NOT_READY_STATUSES.has(s))) return { state: "pending", retryAfterMs: RAIL_POLICY.pollIntervalMs };
  if (items.length > 0 && statuses.every((s) => s === "FAILED")) {
    throw new RailProviderError("records_unreadable", "Plaid could not process the payroll records.", { details: { statuses } });
  }

  const w2Sources: NormalizedIncomeSource[] = [];
  const stubs: RawPayStub[] = [];
  let recordsSeen = 0;
  let forms1099 = 0;
  let personName: string | null = null;
  items.forEach((item, index) => {
    const status = statuses[index];
    if (status === "FAILED") {
      warnings.push(`One payroll connection (${item.item_id ?? "unknown item"}) failed to process and was skipped.`);
      return;
    }
    if (status !== "PROCESSING_COMPLETE") warnings.push(`One payroll connection reported processing status ${status}.`);
    for (const pi of item.payroll_income ?? []) {
      forms1099 += pi.form1099s?.length ?? 0;
      for (const w of pi.w2s ?? []) {
        recordsSeen += 1;
        const taxYear = Number(w.tax_year);
        const wages = decimalToCents(w.wages_tips_other_comp);
        if (!Number.isInteger(taxYear) || wages === null || wages < 0) {
          warnings.push("A W-2 without a readable tax year or box 1 amount was not used.");
          continue;
        }
        if (taxYear !== ctx.incomeYear) continue;
        const medicare = decimalToCents(w.medicare_wages_and_tips);
        w2Sources.push({
          type: "w2",
          employerName: clip(w.employer?.name),
          grossAnnualCents: wages,
          taxYear,
          confidence: "high",
          note: `Form W-2 for ${taxYear} from the payroll provider through Plaid ("wages_tips_other_comp", read as box 1).`,
          medicareWagesCents: medicare !== null && medicare >= 0 ? medicare : null,
          payDate: null,
          payFrequency: null,
          ytdGrossCents: null,
          providerRef: clip(w.document_id),
        });
      }
      for (const s of pi.pay_stubs ?? []) {
        recordsSeen += 1;
        personName ??= clip(s.employee?.name);
        const payDate = s.pay_period_details?.pay_date;
        if (!payDate) {
          warnings.push("A pay stub without a pay date was not used.");
          continue;
        }
        const ytd = decimalToCents(s.earnings?.total?.ytd_amount);
        stubs.push({
          employerName: clip(s.employer?.name),
          payDate,
          payFrequency: FREQUENCY[s.pay_period_details?.pay_frequency ?? ""] ?? null,
          ytdGrossCents: ytd,
          providerRef: clip(s.document_id),
        });
      }
    }
  });
  if (forms1099 > 0) warnings.push(`${forms1099} Form(s) 1099 were returned and are not read by this connection; that income must be reported separately.`);

  const fromStubs = payStubSources(stubs, ctx.incomeYear, "high");
  const sources = [...w2Sources, ...fromStubs.sources];
  const report: NormalizedIncomeReport = {
    version: 1,
    provider: "plaid",
    kind: "payroll",
    sandbox: ctx.sandbox,
    retrievedAt: ctx.retrievedAt.toISOString(),
    incomeYear: ctx.incomeYear,
    person: { name: personName },
    sources,
    coverage: summarizeCoverage(sources, ctx.incomeYear),
    dataBasis: "payroll_gross",
    recordsSeen,
    warnings: capWarnings([...warnings, ...fromStubs.warnings]),
    providerResponseSha256: ctx.rawSha256,
  };
  return { state: "ready", report };
}

function inYear(date: string | null | undefined, year: number): boolean {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) === year;
}

/**
 * Plaid Bank Income → normalized report. Each income source becomes one `bank_income_estimate` with the
 * deposits of the monthly summaries that fall wholly inside the income year. Bank figures are net deposits
 * (fact 59) and never counted.
 */
export function normalizePlaidBankIncome(json: PlaidBankIncomeGet, ctx: NormalizeContext): FetchIncomeResult {
  const warnings: string[] = [];
  const reports = json.bank_income ?? [];
  if (json.error && reports.length === 0) throw new PlaidApiError("/credit/bank_income/get", 200, json.error);
  if (json.error) warnings.push(`Plaid reported ${json.error.error_type ?? "an error"}/${json.error.error_code ?? "unknown"} alongside the data.`);

  const sources: NormalizedIncomeSource[] = [];
  let recordsSeen = 0;
  let partial = false;
  for (const report of reports) {
    for (const item of report.items ?? []) {
      for (const src of item.bank_income_sources ?? []) {
        recordsSeen += 1;
        let total = 0;
        const months = new Set<string>();
        let foreign = false;
        for (const month of src.historical_summary ?? []) {
          if (!inYear(month.start_date, ctx.incomeYear) || !inYear(month.end_date, ctx.incomeYear)) continue;
          for (const amount of month.total_amounts ?? []) {
            if (amount.iso_currency_code && amount.iso_currency_code !== "USD") {
              foreign = true;
              continue;
            }
            const c = decimalToCents(amount.amount);
            if (c !== null && c > 0) total += c;
          }
          months.add(month.start_date!.slice(0, 7));
        }
        if (foreign) warnings.push("Deposits in a currency other than US dollars were left out.");
        if (months.size === 0) continue;
        if (months.size < 12) partial = true;
        sources.push({
          type: "bank_income_estimate",
          employerName: clip(src.income_description),
          grossAnnualCents: total,
          taxYear: ctx.incomeYear,
          confidence: "low",
          note: `Deposits categorized ${clip(src.income_category, 100) ?? "UNKNOWN"} across ${months.size} month(s) of ${ctx.incomeYear}. Bank deposits are after taxes and deductions; this is not gross income.`,
          medicareWagesCents: null,
          payDate: null,
          payFrequency: null,
          ytdGrossCents: null,
          providerRef: clip(src.income_source_id),
        });
      }
    }
  }
  return {
    state: "ready",
    report: {
      version: 1,
      provider: "plaid",
      kind: "bank",
      sandbox: ctx.sandbox,
      retrievedAt: ctx.retrievedAt.toISOString(),
      incomeYear: ctx.incomeYear,
      person: { name: null },
      sources,
      coverage: summarizeCoverage(sources, ctx.incomeYear, { partialHint: partial }),
      dataBasis: "bank_net_deposits",
      recordsSeen,
      warnings: capWarnings(warnings),
      providerResponseSha256: ctx.rawSha256,
    },
  };
}

/* ------------------------------------------------------------------------------------ webhook */

const webhookBodySchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  user_id: z.string().nullish(),
  item_id: z.string().nullish(),
  verification_status: z.string().nullish(),
  environment: z.string().nullish(),
});

/** Maps a VERIFIED webhook body. The deprecated PENDING_APPROVAL status and anything unknown are ignored. */
export function mapPlaidWebhook(body: unknown, environment: "sandbox" | "production"): RailWebhookEvent {
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) return { externalId: null, event: "ignored", detail: "unrecognized body" };
  const b = parsed.data;
  if (b.environment && b.environment !== environment) return { externalId: null, event: "ignored", detail: `webhook from ${b.environment}, configured for ${environment}` };
  if (b.webhook_type !== "INCOME" || b.webhook_code !== "USER_INCOME_VERIFICATION") return { externalId: b.user_id ?? null, event: "ignored", detail: `${b.webhook_type}/${b.webhook_code}` };
  if (!b.user_id) return { externalId: null, event: "ignored", detail: "no user_id" };
  if (b.verification_status === "VERIFICATION_STATUS_PROCESSING_COMPLETE") return { externalId: b.user_id, event: "ready", detail: b.verification_status };
  if (b.verification_status === "VERIFICATION_STATUS_PROCESSING_FAILED") return { externalId: b.user_id, event: "failed", detail: b.verification_status };
  return { externalId: b.user_id, event: "ignored", detail: b.verification_status ?? "no status" };
}

/* ----------------------------------------------------------------------------------- adapter */

const clientResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("success"), publicToken: z.string().min(1).max(500) }),
  z.strictObject({ status: z.literal("exit"), errorCode: z.string().max(100).nullable(), exitStatus: z.string().max(100).nullable() }),
]);

export interface PlaidRail extends RailProvider {
  readonly environment: "sandbox" | "production";
}

export function createPlaidRail(config: PlaidConfig): PlaidRail {
  const base = PLAID_BASE_URLS[config.environment];
  const doFetch = config.fetch ?? fetch;
  const keyCache = new Map<string, { key: PlaidWebhookKey; fetchedAtMs: number }>();

  async function call<T>(path: string, body: Record<string, unknown>, schema?: z.ZodType<T>): Promise<{ json: T; raw: string }> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "PLAID-CLIENT-ID": config.clientId, "PLAID-SECRET": config.secret, "Plaid-Version": PLAID_API_VERSION },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(PLAID_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PlaidApiError(path, null, null);
    }
    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) throw new PlaidApiError(path, res.status, (parsed as PlaidErrorBody | null) ?? null);
    if (schema) {
      const checked = schema.safeParse(parsed);
      if (!checked.success) throw new RailProviderError("records_unreadable", `Plaid ${path} returned an unexpected response shape.`, { details: { path } });
      return { json: checked.data, raw };
    }
    return { json: parsed as T, raw };
  }

  async function getKey(kid: string): Promise<PlaidWebhookKey> {
    const cached = keyCache.get(kid);
    if (cached && now().getTime() - cached.fetchedAtMs < PLAID_WEBHOOK_KEY_CACHE_MS) return cached.key;
    let json: { key?: PlaidWebhookKey };
    try {
      ({ json } = await call<{ key?: PlaidWebhookKey }>("/webhook_verification_key/get", { key_id: kid }));
    } catch (e) {
      // An unknown kid is a forged or stale token; an outage is ours to retry (Plaid redelivers on non-2xx).
      if (e instanceof PlaidApiError && e.httpStatus !== null && e.httpStatus < 500) throw new AppError("unauthenticated", "Invalid webhook signature", { reason: "unknown_kid" });
      throw e;
    }
    if (!json.key || typeof json.key.x !== "string" || typeof json.key.y !== "string") throw new AppError("unauthenticated", "Invalid webhook signature", { reason: "unknown_kid" });
    keyCache.set(kid, { key: json.key, fetchedAtMs: now().getTime() });
    return json.key;
  }

  return {
    id: "plaid",
    displayName: "Plaid",
    sandbox: config.environment === "sandbox",
    environment: config.environment,
    craPosture: "vendor_states_not_cra",

    async createLinkSession(input: CreateLinkSessionInput): Promise<CreateLinkSessionResult> {
      const user = await call<{ user_id?: string }>("/user/create", { client_user_id: input.connectionId });
      if (!user.json.user_id) throw new RailProviderError("provider_unavailable", "Plaid /user/create returned no user_id.", { retryable: true });
      const incomeVerification =
        input.kind === "payroll"
          ? { income_source_types: ["payroll"], payroll_income: { flow_types: ["payroll_digital_income"] } }
          : { income_source_types: ["bank"], bank_income: { days_requested: RAIL_POLICY.plaidBankDaysRequested } };
      const link = await call<{ link_token?: string; expiration?: string }>("/link/token/create", {
        user_id: user.json.user_id,
        user: { client_user_id: input.connectionId },
        client_name: BRAND.name,
        language: input.locale,
        country_codes: ["US"],
        products: ["income_verification"],
        income_verification: incomeVerification,
        webhook: input.webhookUrl,
      });
      if (!link.json.link_token) throw new RailProviderError("provider_unavailable", "Plaid /link/token/create returned no link_token.", { retryable: true });
      return {
        client: { provider: "plaid", sandbox: config.environment === "sandbox", linkToken: link.json.link_token, expiration: link.json.expiration ?? null },
        externalId: user.json.user_id,
      };
    },

    async completeLink({ connection, clientResult }): Promise<CompleteLinkResult> {
      const parsed = clientResultSchema.safeParse(clientResult);
      if (!parsed.success) throw badRequest("The connection result is not valid.");
      const result = parsed.data;
      if (result.status === "exit") {
        if (result.exitStatus && NOT_FOUND_EXIT_STATUSES.has(result.exitStatus)) return { outcome: "failed", reason: "employer_not_found", detail: `Link exit: ${result.exitStatus}` };
        if (result.errorCode === null) return { outcome: "declined" };
        const mapped = ERROR_REASONS[result.errorCode];
        return { outcome: "failed", reason: mapped?.reason ?? "provider_unavailable", detail: `Link exit error ${result.errorCode}` };
      }
      if (!connection.externalId) throw badRequest("This connection has no Plaid user.");
      if ((connection.kind as RailKind) === "bank") {
        const exchanged = await call<{ access_token?: string; item_id?: string }>("/item/public_token/exchange", { public_token: result.publicToken });
        if (!exchanged.json.access_token) throw new RailProviderError("provider_unavailable", "Plaid did not return an access token.", { retryable: false });
        // Bank Income sends no USER_INCOME_VERIFICATION webhook (fact 59), so the data is polled for.
        return { outcome: "linked", externalId: connection.externalId, accessToken: exchanged.json.access_token, readiness: { type: "immediate" } };
      }
      return { outcome: "linked", externalId: connection.externalId, accessToken: null, readiness: { type: "webhook", fallbackPollMs: RAIL_POLICY.webhookFallbackPollMs } };
    },

    async fetchIncomeReport(connection: RailConnection, ctx: FetchContext): Promise<FetchIncomeResult> {
      if (!connection.externalId) throw new RailProviderError("connection_expired", "This connection has no Plaid user.");
      const norm = { incomeYear: ctx.incomeYear, retrievedAt: ctx.retrievedAt, sandbox: config.environment === "sandbox" };
      if ((connection.kind as RailKind) === "bank") {
        const { json, raw } = await call("/credit/bank_income/get", { user_id: connection.externalId }, bankIncomeGetSchema);
        return normalizePlaidBankIncome(json, { ...norm, rawSha256: sha256Hex(raw) });
      }
      const { json, raw } = await call("/credit/payroll_income/get", { user_id: connection.externalId }, payrollIncomeGetSchema);
      return normalizePlaidPayrollIncome(json, { ...norm, rawSha256: sha256Hex(raw) });
    },

    async revoke(connection: RailConnection, ctx: { accessToken: string | null; onAccessTokenRevoked?: () => Promise<void> }): Promise<void> {
      if (ctx.accessToken) {
        await call("/item/remove", { access_token: ctx.accessToken });
        await ctx.onAccessTokenRevoked?.();
      }
      if (connection.externalId) {
        try {
          await call("/user/remove", { user_id: connection.externalId });
        } catch (e) {
          if (!(e instanceof PlaidApiError && e.plaidErrorCode === "USER_NOT_FOUND")) throw e;
        }
      }
    },

    async parseWebhook(rawBody: string, headers: { get(name: string): string | null }): Promise<RailWebhookEvent> {
      // Signature first: nothing in the body is looked at, and no record is looked up, before this passes.
      await verifyPlaidWebhook(rawBody, headers.get("plaid-verification"), { getKey, now: now() });
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { externalId: null, event: "ignored", detail: "body is not JSON" };
      }
      return mapPlaidWebhook(body, config.environment);
    },
  };
}

/** The configured Plaid rail. Throws `not_available` when the credentials are missing. */
export function plaidRailFromEnv(): PlaidRail {
  const e = env();
  if (!e.PLAID_CLIENT_ID || !e.PLAID_SECRET) throw new AppError("not_available", "Plaid is not configured (PLAID_CLIENT_ID and PLAID_SECRET).");
  return createPlaidRail({ clientId: e.PLAID_CLIENT_ID, secret: e.PLAID_SECRET, environment: e.PLAID_ENV });
}
