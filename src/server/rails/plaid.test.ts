import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTestNow } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { createPlaidRail, mapPlaidWebhook, normalizePlaidBankIncome, normalizePlaidPayrollIncome, PlaidApiError, PLAID_API_VERSION } from "./plaid";
import { fakePlaidFetch, makeWebhookSigner, payrollIncomeBody, signJwt } from "./test-support";
import type { RailConnection } from "./types";

// Every id, name and amount is SYNTHETIC. No call reaches Plaid.

const NOW = new Date("2026-11-18T15:00:00Z");
const member = { id: "hm_1", firstName: "Alex", lastName: "Synthetic" };

function connection(over: Partial<RailConnection> = {}): RailConnection {
  return {
    id: "rail_1",
    householdId: "hh_1",
    verificationId: "ver_1",
    memberId: "hm_1",
    provider: "plaid",
    kind: "payroll",
    status: "connecting",
    externalId: "usr_synthetic",
    accessTokenEnc: null,
    reportEnc: null,
    reportSha256: null,
    consentId: "con_1",
    failureReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

async function failureOf(p: Promise<unknown>): Promise<{ reason?: string; retryable?: boolean; code?: string }> {
  try {
    await p;
    return {};
  } catch (e) {
    const err = e as { reason?: string; retryable?: boolean; code?: string };
    return { reason: err.reason, retryable: err.retryable, code: err.code };
  }
}

const ctx = { incomeYear: 2025, retrievedAt: NOW, sandbox: true, rawSha256: "a".repeat(64) };

describe("Plaid adapter", () => {
  beforeEach(() => setTestNow(NOW));
  afterEach(() => setTestNow(null));

  describe("createLinkSession", () => {
    it("creates the user with an opaque id, then a payroll income link token, with credentials only in headers", async () => {
      const plaid = fakePlaidFetch({
        "/user/create": () => ({ json: { user_id: "usr_synthetic", request_id: "r1" } }),
        "/link/token/create": () => ({ json: { link_token: "link-sandbox-synthetic", expiration: "2026-11-18T19:00:00Z", request_id: "r2" } }),
      });
      const rail = createPlaidRail({ clientId: "client-synthetic", secret: "secret-synthetic", environment: "sandbox", fetch: plaid.fetch });
      const out = await rail.createLinkSession({ connectionId: "rail_1", householdId: "hh_1", member, incomeYear: 2025, kind: "payroll", locale: "es", webhookUrl: "https://app.example/api/webhooks/plaid" });

      expect(out).toEqual({ client: { provider: "plaid", sandbox: true, linkToken: "link-sandbox-synthetic", expiration: "2026-11-18T19:00:00Z" }, externalId: "usr_synthetic" });
      expect(plaid.calls.map((c) => c.path)).toEqual(["/user/create", "/link/token/create"]);
      expect(plaid.calls[0]!.body).toEqual({ client_user_id: "rail_1" });
      expect(plaid.calls[1]!.body).toEqual({
        user_id: "usr_synthetic",
        user: { client_user_id: "rail_1" },
        client_name: "Passport",
        language: "es",
        country_codes: ["US"],
        products: ["income_verification"],
        income_verification: { income_source_types: ["payroll"], payroll_income: { flow_types: ["payroll_digital_income"] } },
        webhook: "https://app.example/api/webhooks/plaid",
      });
      for (const call of plaid.calls) {
        expect(call.headers["plaid-client-id"]).toBe("client-synthetic");
        expect(call.headers["plaid-secret"]).toBe("secret-synthetic");
        expect(call.headers["plaid-version"]).toBe(PLAID_API_VERSION);
        expect(JSON.stringify(call.body)).not.toContain("secret-synthetic");
        // No PII goes to Plaid's user record.
        expect(JSON.stringify(call.body)).not.toContain("Alex");
      }
    });

    it("asks for bank income with the documented maximum history for a bank connection", async () => {
      const plaid = fakePlaidFetch({
        "/user/create": () => ({ json: { user_id: "usr_b" } }),
        "/link/token/create": () => ({ json: { link_token: "link-b" } }),
      });
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "production", fetch: plaid.fetch });
      const out = await rail.createLinkSession({ connectionId: "rail_2", householdId: "hh_1", member, incomeYear: 2025, kind: "bank", locale: "en", webhookUrl: "https://x/y" });
      expect(out.client).toMatchObject({ provider: "plaid", sandbox: false, expiration: null });
      expect(plaid.calls[1]!.body.income_verification).toEqual({ income_source_types: ["bank"], bank_income: { days_requested: 731 } });
    });

    it("maps Plaid failures: 5xx and network errors are retryable outages, other 4xx are not", async () => {
      const down = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/user/create": () => ({ status: 503, json: { error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR" } }) }).fetch });
      expect(await failureOf(down.createLinkSession({ connectionId: "r", householdId: "h", member, incomeYear: 2025, kind: "payroll", locale: "en", webhookUrl: "https://x" }))).toEqual({
        reason: "provider_unavailable",
        retryable: true,
        code: "not_available",
      });
      const bad = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/user/create": () => ({ status: 400, json: { error_type: "INVALID_REQUEST", error_code: "MISSING_FIELDS" } }) }).fetch });
      expect(await failureOf(bad.createLinkSession({ connectionId: "r", householdId: "h", member, incomeYear: 2025, kind: "payroll", locale: "en", webhookUrl: "https://x" }))).toMatchObject({ reason: "provider_unavailable", retryable: false });
      const offline = createPlaidRail({
        clientId: "c",
        secret: "s",
        environment: "sandbox",
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
      });
      expect(await failureOf(offline.createLinkSession({ connectionId: "r", householdId: "h", member, incomeYear: 2025, kind: "payroll", locale: "en", webhookUrl: "https://x" }))).toMatchObject({ reason: "provider_unavailable", retryable: true });
    });
  });

  describe("completeLink", () => {
    const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/item/public_token/exchange": () => ({ json: { access_token: "access-sandbox-synthetic", item_id: "item_1" } }) }).fetch });

    it("payroll: nothing is exchanged; readiness comes from the webhook with a fallback poll", async () => {
      const out = await rail.completeLink({ connection: connection(), clientResult: { status: "success", publicToken: "public-sandbox-x" }, at: NOW });
      expect(out).toEqual({ outcome: "linked", externalId: "usr_synthetic", accessToken: null, readiness: { type: "webhook", fallbackPollMs: 600_000 } });
    });

    it("bank: the public token is exchanged for an access token", async () => {
      const out = await rail.completeLink({ connection: connection({ kind: "bank" }), clientResult: { status: "success", publicToken: "public-sandbox-x" }, at: NOW });
      expect(out).toEqual({ outcome: "linked", externalId: "usr_synthetic", accessToken: "access-sandbox-synthetic", readiness: { type: "immediate" } });
    });

    it("maps Link exits: no error is a decline; not-found institutions, expired tokens and outages are failures", async () => {
      const exit = (errorCode: string | null, exitStatus: string | null) => rail.completeLink({ connection: connection(), clientResult: { status: "exit", errorCode, exitStatus }, at: NOW });
      expect(await exit(null, "requires_credentials")).toEqual({ outcome: "declined" });
      expect(await exit(null, null)).toEqual({ outcome: "declined" });
      expect(await exit(null, "institution_not_found")).toMatchObject({ outcome: "failed", reason: "employer_not_found" });
      expect(await exit(null, "institution_not_supported")).toMatchObject({ outcome: "failed", reason: "employer_not_found" });
      expect(await exit("INVALID_LINK_TOKEN", null)).toMatchObject({ outcome: "failed", reason: "connection_expired" });
      expect(await exit("ITEM_LOGIN_REQUIRED", null)).toMatchObject({ outcome: "failed", reason: "connection_expired" });
      expect(await exit("INSTITUTION_DOWN", null)).toMatchObject({ outcome: "failed", reason: "provider_unavailable" });
      expect(await exit("SOMETHING_NEW", null)).toMatchObject({ outcome: "failed", reason: "provider_unavailable" });
    });

    it("rejects malformed client results instead of trusting them", async () => {
      for (const bad of [null, {}, { status: "success" }, { status: "success", publicToken: "" }, { status: "exit" }, { status: "success", publicToken: "x", extra: 1 }]) {
        expect((await failureOf(rail.completeLink({ connection: connection(), clientResult: bad, at: NOW }))).code).toBe("bad_request");
      }
    });
  });

  describe("fetchIncomeReport", () => {
    it("reads W-2s (strings) and the year-closing pay stub (numbers) for the income year and hashes the raw body", async () => {
      const body = payrollIncomeBody(2025);
      const plaid = fakePlaidFetch({ "/credit/payroll_income/get": () => ({ json: body }) });
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: plaid.fetch });
      const out = await rail.fetchIncomeReport(connection({ status: "syncing" }), { accessToken: null, incomeYear: 2025, member, retrievedAt: NOW });
      expect(plaid.calls[0]).toMatchObject({ path: "/credit/payroll_income/get", body: { user_id: "usr_synthetic" } });
      expect(out.state).toBe("ready");
      if (out.state !== "ready") return;
      expect(out.report.providerResponseSha256).toBe(sha256Hex(JSON.stringify(body)));
      expect(out.report.person.name).toBe("Alex Synthetic");
      expect(out.report.sources.map((s) => [s.type, s.grossAnnualCents, s.medicareWagesCents])).toEqual([
        ["w2", 5_200_000, 5_400_000],
        ["final_paystub_ytd", 5_400_000, null],
      ]);
      expect(out.report.coverage).toEqual({ incomeYearCovered: true, partialYear: false });
      expect(out.report).toMatchObject({ provider: "plaid", kind: "payroll", sandbox: true, dataBasis: "payroll_gross", recordsSeen: 2, retrievedAt: NOW.toISOString() });
    });

    it("uses the bank income endpoint for a bank connection", async () => {
      const plaid = fakePlaidFetch({ "/credit/bank_income/get": () => ({ json: { bank_income: [], request_id: "r" } }) });
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: plaid.fetch });
      const out = await rail.fetchIncomeReport(connection({ kind: "bank" }), { accessToken: "access-x", incomeYear: 2025, member, retrievedAt: NOW });
      expect(plaid.calls[0]).toMatchObject({ path: "/credit/bank_income/get", body: { user_id: "usr_synthetic" } });
      expect(out).toMatchObject({ state: "ready", report: { kind: "bank", recordsSeen: 0, sources: [] } });
    });

    it("treats an unexpected response shape as unreadable", async () => {
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/credit/payroll_income/get": () => ({ json: { items: "nope" } }) }).fetch });
      expect(await failureOf(rail.fetchIncomeReport(connection(), { accessToken: null, incomeYear: 2025, member, retrievedAt: NOW }))).toMatchObject({ reason: "records_unreadable" });
    });
  });

  describe("normalizePlaidPayrollIncome (status mapping and traps)", () => {
    it("is pending while any item is processing or waiting for the person's approval", () => {
      expect(normalizePlaidPayrollIncome(payrollIncomeBody(2025, { status: "PROCESSING" }), ctx).state).toBe("pending");
      expect(normalizePlaidPayrollIncome(payrollIncomeBody(2025, { status: "APPROVAL_STATUS_PENDING" }), ctx).state).toBe("pending");
    });

    it("throws records_unreadable when every item failed", () => {
      expect(() => normalizePlaidPayrollIncome(payrollIncomeBody(2025, { status: "FAILED" }), ctx)).toThrow(expect.objectContaining({ reason: "records_unreadable" }));
    });

    it("PROCESSING_COMPLETE with nothing parsed yields an empty report (the unparsable-documents trap), not data", () => {
      const out = normalizePlaidPayrollIncome(payrollIncomeBody(2025, { noRecords: true }), ctx);
      expect(out).toMatchObject({ state: "ready", report: { sources: [], recordsSeen: 0, coverage: { incomeYearCovered: false, partialYear: false } } });
    });

    it("checks the top-level error even on a 2xx", () => {
      expect(() => normalizePlaidPayrollIncome({ items: [], error: { error_type: "INCOME_VERIFICATION_ERROR", error_code: "X", error_message: "m" } }, ctx)).toThrow(PlaidApiError);
      const withData = normalizePlaidPayrollIncome(payrollIncomeBody(2025, { error: { error_type: "INCOME_VERIFICATION_ERROR", error_code: "PARTIAL" } }), ctx);
      expect(withData.state === "ready" && withData.report.warnings.join(" ")).toMatch(/INCOME_VERIFICATION_ERROR\/PARTIAL/);
    });

    it("ignores W-2s and stubs from other years but counts them as records seen", () => {
      const out = normalizePlaidPayrollIncome(payrollIncomeBody(2024, { stubDate: "2024-12-27" }), ctx);
      expect(out).toMatchObject({ state: "ready", report: { sources: [], recordsSeen: 2 } });
    });

    it("turns a mid-year stub into a projection and skips unreadable W-2 amounts", () => {
      const out = normalizePlaidPayrollIncome(payrollIncomeBody(2025, { w2Wages: "not money", stubDate: "2025-06-13", stubYtd: 24_000 }), ctx);
      if (out.state !== "ready") throw new Error("expected ready");
      expect(out.report.sources.map((s) => s.type)).toEqual(["paystub_projection"]);
      expect(out.report.coverage).toEqual({ incomeYearCovered: false, partialYear: true });
      expect(out.report.warnings.join(" ")).toMatch(/W-2 without a readable/);
    });

    it("warns about Forms 1099 it does not read", () => {
      const body = payrollIncomeBody(2025);
      ((body.items as Array<{ payroll_income: Array<{ form1099s: unknown[] }> }>)[0]!.payroll_income[0]!).form1099s = [{ tax_year: "2025" }];
      const out = normalizePlaidPayrollIncome(body, ctx);
      expect(out.state === "ready" && out.report.warnings.join(" ")).toMatch(/1099/);
    });
  });

  describe("normalizePlaidBankIncome", () => {
    it("sums whole months inside the income year as a never-counted net deposit estimate", () => {
      const months = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.UTC(2024, 11 + i, 1));
        const end = new Date(Date.UTC(2024, 12 + i, 0));
        return { start_date: d.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), total_amounts: [{ amount: 2500.5, iso_currency_code: "USD" }] };
      });
      const out = normalizePlaidBankIncome({ bank_income: [{ items: [{ bank_income_sources: [{ income_source_id: "src_1", income_description: "SYNTHETIC PAYROLL", income_category: "SALARY", historical_summary: months }] }] }] }, ctx);
      if (out.state !== "ready") throw new Error("expected ready");
      expect(out.report.dataBasis).toBe("bank_net_deposits");
      expect(out.report.sources).toHaveLength(1);
      expect(out.report.sources[0]).toMatchObject({ type: "bank_income_estimate", grossAnnualCents: 12 * 250_050, confidence: "low", employerName: "SYNTHETIC PAYROLL" });
      expect(out.report.coverage).toEqual({ incomeYearCovered: false, partialYear: false });
    });

    it("marks a partial year and leaves out foreign currency", () => {
      const out = normalizePlaidBankIncome(
        {
          bank_income: [
            {
              items: [
                {
                  bank_income_sources: [
                    {
                      income_category: "SALARY",
                      historical_summary: [
                        { start_date: "2025-11-01", end_date: "2025-11-30", total_amounts: [{ amount: 100, iso_currency_code: "USD" }, { amount: 999, iso_currency_code: "CAD" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        ctx,
      );
      if (out.state !== "ready") throw new Error("expected ready");
      expect(out.report.sources[0]!.grossAnnualCents).toBe(10_000);
      expect(out.report.coverage.partialYear).toBe(true);
      expect(out.report.warnings.join(" ")).toMatch(/currency/);
    });
  });

  describe("revoke", () => {
    it("removes the Item with the access token, then the Plaid user", async () => {
      const plaid = fakePlaidFetch({ "/item/remove": () => ({ json: { request_id: "r" } }), "/user/remove": () => ({ json: { request_id: "r" } }) });
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: plaid.fetch });
      await rail.revoke(connection({ kind: "bank" }), { accessToken: "access-x" });
      expect(plaid.calls.map((c) => [c.path, c.body])).toEqual([
        ["/item/remove", { access_token: "access-x" }],
        ["/user/remove", { user_id: "usr_synthetic" }],
      ]);
    });

    it("treats an already-removed user as success and other failures as errors", async () => {
      const gone = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/user/remove": () => ({ status: 400, json: { error_type: "INVALID_INPUT", error_code: "USER_NOT_FOUND" } }) }).fetch });
      await expect(gone.revoke(connection(), { accessToken: null })).resolves.toBeUndefined();
      const down = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: fakePlaidFetch({ "/user/remove": () => ({ status: 500, json: {} }) }).fetch });
      expect(await failureOf(down.revoke(connection(), { accessToken: null }))).toMatchObject({ retryable: true });
    });
  });

  describe("webhooks", () => {
    const NOW_S = Math.floor(NOW.getTime() / 1000);
    const body = JSON.stringify({ webhook_type: "INCOME", webhook_code: "USER_INCOME_VERIFICATION", item_id: "item_1", user_id: "usr_synthetic", verification_status: "VERIFICATION_STATUS_PROCESSING_COMPLETE", environment: "sandbox" }, null, 2);

    it("verifies with the key fetched by kid (cached) before parsing", async () => {
      const signer = makeWebhookSigner("kid-a", NOW_S - 100);
      const plaid = fakePlaidFetch({ "/webhook_verification_key/get": (b) => ({ json: { key: { ...signer.key, kid: b.key_id }, request_id: "r" } }) });
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: plaid.fetch });
      const jwt = signJwt(signer.privateKey, { alg: "ES256", kid: "kid-a", typ: "JWT" }, { iat: NOW_S, request_body_sha256: sha256Hex(body) });
      const headers = new Headers({ "Plaid-Verification": jwt });
      expect(await rail.parseWebhook!(body, headers)).toEqual({ externalId: "usr_synthetic", event: "ready", detail: "VERIFICATION_STATUS_PROCESSING_COMPLETE" });
      await rail.parseWebhook!(body, headers);
      expect(plaid.calls.filter((c) => c.path === "/webhook_verification_key/get")).toHaveLength(1);
      expect(plaid.calls[0]!.body).toEqual({ key_id: "kid-a" });
    });

    it("rejects an unsigned or forged webhook without acting on it, and an unknown kid as unauthenticated", async () => {
      const signer = makeWebhookSigner("kid-a", NOW_S - 100);
      const plaid = fakePlaidFetch({ "/webhook_verification_key/get": () => ({ status: 400, json: { error_type: "INVALID_INPUT", error_code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID" } }) });
      const rail = createPlaidRail({ clientId: "c", secret: "s", environment: "sandbox", fetch: plaid.fetch });
      expect((await failureOf(rail.parseWebhook!(body, new Headers()))).code).toBe("unauthenticated");
      const jwt = signJwt(signer.privateKey, { alg: "ES256", kid: "kid-zzz" }, { iat: NOW_S, request_body_sha256: sha256Hex(body) });
      expect((await failureOf(rail.parseWebhook!(body, new Headers({ "plaid-verification": jwt })))).code).toBe("unauthenticated");
    });

    it("maps statuses: complete → fetch and inspect, failed → failed, deprecated pending approval and others → ignored", () => {
      const base = { webhook_type: "INCOME", webhook_code: "USER_INCOME_VERIFICATION", user_id: "usr_1", environment: "sandbox" };
      expect(mapPlaidWebhook({ ...base, verification_status: "VERIFICATION_STATUS_PROCESSING_COMPLETE" }, "sandbox").event).toBe("ready");
      expect(mapPlaidWebhook({ ...base, verification_status: "VERIFICATION_STATUS_PROCESSING_FAILED" }, "sandbox").event).toBe("failed");
      expect(mapPlaidWebhook({ ...base, verification_status: "VERIFICATION_STATUS_PENDING_APPROVAL" }, "sandbox").event).toBe("ignored");
      expect(mapPlaidWebhook({ ...base, verification_status: "SOMETHING_ELSE" }, "sandbox").event).toBe("ignored");
      expect(mapPlaidWebhook({ ...base, webhook_code: "USER_INCOME_VERIFICATION_RISK_SIGNALS" }, "sandbox").event).toBe("ignored");
      expect(mapPlaidWebhook({ ...base, user_id: null, verification_status: "VERIFICATION_STATUS_PROCESSING_COMPLETE" }, "sandbox").event).toBe("ignored");
      expect(mapPlaidWebhook({ ...base, environment: "production", verification_status: "VERIFICATION_STATUS_PROCESSING_COMPLETE" }, "sandbox").event).toBe("ignored");
      expect(mapPlaidWebhook("garbage", "sandbox").event).toBe("ignored");
    });
  });
});
