import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/crypto";
import { normalizedIncomeReportSchema, type RailConnection } from "./types";
import { parseSimulatedExternalId, SIMULATED_PERSONA_IDS, SIMULATED_PERSONAS, simulatedExternalId, simulatedPersonasFor, simulatedRail } from "./simulated";
import { SIMULATED_SLOW_READY_AFTER_MS } from "./policy";

// SYNTHETIC personas only.

const AT = new Date("2026-11-18T15:00:00Z");
const member = { id: "hm_1", firstName: "Alex", lastName: "Synthetic" };

function conn(over: Partial<RailConnection> = {}): RailConnection {
  return {
    id: "rail_1",
    householdId: "hh_1",
    verificationId: "ver_1",
    memberId: "hm_1",
    provider: "simulated",
    kind: "payroll",
    status: "connecting",
    externalId: null,
    accessTokenEnc: null,
    reportEnc: null,
    reportSha256: null,
    consentId: null,
    failureReason: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

async function linkAndFetch(persona: string, kind: "payroll" | "bank" = "payroll") {
  const linked = await simulatedRail.completeLink({ connection: conn({ kind }), clientResult: { persona }, at: AT });
  if (linked.outcome !== "linked") return { linked, fetched: null };
  const fetched = await simulatedRail.fetchIncomeReport(conn({ kind, externalId: linked.externalId }), { accessToken: null, incomeYear: 2025, member, retrievedAt: new Date(AT.getTime() + SIMULATED_SLOW_READY_AFTER_MS) });
  return { linked, fetched };
}

describe("simulated rail", () => {
  it("is labelled as a sandbox everywhere and never asks for credentials", async () => {
    expect(simulatedRail.sandbox).toBe(true);
    expect(simulatedRail.displayName).toMatch(/sandbox/i);
    const session = await simulatedRail.createLinkSession({ connectionId: "rail_1", householdId: "hh_1", member, incomeYear: 2025, kind: "payroll", locale: "en", webhookUrl: "https://x" });
    expect(session.client).toMatchObject({ provider: "simulated", sandbox: true });
    const text = JSON.stringify(session.client).toLowerCase();
    expect(text).not.toMatch(/password|username|ssn/);
    for (const id of SIMULATED_PERSONA_IDS) {
      expect(SIMULATED_PERSONAS[id].description.en).toMatch(/Sandbox/);
      expect(SIMULATED_PERSONAS[id].description.es).toMatch(/Prueba/);
    }
  });

  it("offers personas by kind", () => {
    const payroll = simulatedPersonasFor("payroll").map((p) => p.id);
    const bank = simulatedPersonasFor("bank").map((p) => p.id);
    expect(payroll).toContain("single_w2");
    expect(payroll).not.toContain("bank_deposits");
    expect(bank).toEqual(expect.arrayContaining(["bank_deposits", "declines", "provider_outage"]));
    expect(bank).not.toContain("high_earner");
  });

  it("rejects unknown personas and personas for the wrong kind", async () => {
    await expect(simulatedRail.completeLink({ connection: conn(), clientResult: { persona: "hacker" }, at: AT })).rejects.toMatchObject({ code: "bad_request" });
    await expect(simulatedRail.completeLink({ connection: conn(), clientResult: { persona: "single_w2", accessToken: "x" }, at: AT })).rejects.toMatchObject({ code: "bad_request" });
    await expect(simulatedRail.completeLink({ connection: conn({ kind: "bank" }), clientResult: { persona: "high_earner" }, at: AT })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("encodes the persona and link time in the external id", () => {
    const id = simulatedExternalId("slow_provider", AT);
    expect(parseSimulatedExternalId(id)).toEqual({ persona: "slow_provider", linkedAtMs: AT.getTime() });
    expect(parseSimulatedExternalId("sim:nope:1")).toBeNull();
    expect(parseSimulatedExternalId(null)).toBeNull();
  });

  it.each([
    ["single_w2", [["w2", 4_125_000], ["final_paystub_ytd", 4_380_000]], true],
    ["two_jobs", [["w2", 2_310_000], ["w2", 1_184_000]], true],
    ["high_earner", [["w2", 240_000_000]], true],
    ["partial_year", [["paystub_projection", expect.any(Number)]], false],
    ["no_prior_year", [], false],
  ] as const)("persona %s produces a valid, deterministic report", async (persona, expected, covered) => {
    const { fetched } = await linkAndFetch(persona);
    if (fetched?.state !== "ready") throw new Error("expected ready");
    const report = normalizedIncomeReportSchema.parse(fetched.report);
    expect(report.sources.map((s) => [s.type, s.grossAnnualCents])).toEqual(expected);
    expect(report.coverage.incomeYearCovered).toBe(covered);
    expect(report.sandbox).toBe(true);
    expect(report.person.name).toBe("Alex Synthetic");
    expect(report.warnings[0]).toMatch(/Simulated sandbox data/);
    expect(() => canonicalJson(report)).not.toThrow();
    const again = await linkAndFetch(persona);
    expect(again.fetched).toEqual(fetched);
  });

  it("no_prior_year has records but none for the year", async () => {
    const { fetched } = await linkAndFetch("no_prior_year");
    expect(fetched).toMatchObject({ state: "ready", report: { sources: [], recordsSeen: 1 } });
  });

  it("bank_deposits returns a net-deposit estimate that is never counted", async () => {
    const { fetched } = await linkAndFetch("bank_deposits", "bank");
    expect(fetched).toMatchObject({ state: "ready", report: { kind: "bank", dataBasis: "bank_net_deposits", coverage: { incomeYearCovered: false }, sources: [{ type: "bank_income_estimate" }] } });
  });

  it("maps the failure and decline personas", async () => {
    expect((await linkAndFetch("declines")).linked).toEqual({ outcome: "declined" });
    expect((await linkAndFetch("provider_outage")).linked).toMatchObject({ outcome: "failed", reason: "provider_unavailable" });
    expect((await linkAndFetch("employer_not_found")).linked).toMatchObject({ outcome: "failed", reason: "employer_not_found" });
    expect((await linkAndFetch("session_expired")).linked).toMatchObject({ outcome: "failed", reason: "connection_expired" });
  });

  it("the slow provider is pending until its delay has passed", async () => {
    const linked = await simulatedRail.completeLink({ connection: conn(), clientResult: { persona: "slow_provider" }, at: AT });
    expect(linked).toMatchObject({ outcome: "linked", readiness: { type: "poll", afterMs: SIMULATED_SLOW_READY_AFTER_MS } });
    if (linked.outcome !== "linked") return;
    const c = conn({ externalId: linked.externalId });
    const early = await simulatedRail.fetchIncomeReport(c, { accessToken: null, incomeYear: 2025, member, retrievedAt: new Date(AT.getTime() + 5000) });
    expect(early).toEqual({ state: "pending", retryAfterMs: SIMULATED_SLOW_READY_AFTER_MS - 5000 });
    const later = await simulatedRail.fetchIncomeReport(c, { accessToken: null, incomeYear: 2025, member, retrievedAt: new Date(AT.getTime() + SIMULATED_SLOW_READY_AFTER_MS) });
    expect(later.state).toBe("ready");
  });

  it("refuses to fetch for a connection that was never linked", async () => {
    await expect(simulatedRail.fetchIncomeReport(conn(), { accessToken: null, incomeYear: 2025, member, retrievedAt: AT })).rejects.toMatchObject({ code: "bad_request" });
  });
});
