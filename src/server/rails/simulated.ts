/**
 * The simulated payroll/bank rail: the zero-config default, fully offline, and unmistakably a sandbox.
 *
 * Every figure and employer name below is SYNTHETIC test data. Nothing here asks for, accepts or stores a
 * real credential: the "sign-in" is a persona picker labelled as a sandbox. The provider refuses to run
 * for a live-mode verification (see ./providers), so simulated income can never reach a real decision.
 *
 * Personas are deterministic for a given income year, member and link time, so tests and demos can rely
 * on them.
 */
import { z } from "zod";
import { badRequest } from "@/lib/errors";
import { SIMULATED_PROVIDER_NAME } from "./copy";
import { payStubSources, summarizeCoverage, type RawPayStub } from "./normalize";
import { SIMULATED_SLOW_READY_AFTER_MS } from "./policy";
import type {
  CompleteLinkResult,
  CreateLinkSessionInput,
  CreateLinkSessionResult,
  FetchContext,
  FetchIncomeResult,
  NormalizedIncomeReport,
  NormalizedIncomeSource,
  RailConnection,
  RailKind,
  RailProvider,
  SimulatedPersonaOption,
} from "./types";

export const SIMULATED_PERSONA_IDS = [
  "single_w2",
  "two_jobs",
  "high_earner",
  "no_prior_year",
  "partial_year",
  "slow_provider",
  "employer_not_found",
  "provider_outage",
  "session_expired",
  "declines",
  "bank_deposits",
] as const;
export type SimulatedPersonaId = (typeof SIMULATED_PERSONA_IDS)[number];

interface PersonaDef extends Omit<SimulatedPersonaOption, "id"> {
  kinds: readonly RailKind[];
}

const SANDBOX_NOTE = { en: "Sandbox: made-up test data.", es: "Prueba: datos inventados." };

/** Labels say plainly what each persona does, so nobody mistakes the picker for a real sign-in. */
export const SIMULATED_PERSONAS: Readonly<Record<SimulatedPersonaId, PersonaDef>> = Object.freeze({
  single_w2: {
    kinds: ["payroll"],
    label: { en: "One employer, W-2 (moderate income)", es: "Un empleador, W-2 (ingresos moderados)" },
    description: { en: `A single job with a W-2 and a final pay stub for the year. ${SANDBOX_NOTE.en}`, es: `Un solo trabajo con un W-2 y un último talón de pago del año. ${SANDBOX_NOTE.es}` },
  },
  two_jobs: {
    kinds: ["payroll"],
    label: { en: "Two jobs, two W-2s", es: "Dos trabajos, dos W-2" },
    description: { en: `Two employers in the same year. ${SANDBOX_NOTE.en}`, es: `Dos empleadores en el mismo año. ${SANDBOX_NOTE.es}` },
  },
  high_earner: {
    kinds: ["payroll"],
    label: { en: "High earner (W-2 of $2.4 million)", es: "Ingresos altos (W-2 de 2.4 millones de dólares)" },
    description: { en: `One W-2 with a very large income, for testing an over-the-limit result. ${SANDBOX_NOTE.en}`, es: `Un W-2 con ingresos muy altos, para probar un resultado por encima del límite. ${SANDBOX_NOTE.es}` },
  },
  no_prior_year: {
    kinds: ["payroll"],
    label: { en: "Employer found, no records for the year", es: "Empleador encontrado, sin registros del año" },
    description: { en: `The job started after the year we need. ${SANDBOX_NOTE.en}`, es: `El trabajo empezó después del año que necesitamos. ${SANDBOX_NOTE.es}` },
  },
  partial_year: {
    kinds: ["payroll"],
    label: { en: "Only a mid-year pay stub", es: "Solo un talón de pago de mitad de año" },
    description: { en: `Shows a projection a reviewer must look at; nothing is counted. ${SANDBOX_NOTE.en}`, es: `Muestra una proyección que debe revisar una persona; no se cuenta nada. ${SANDBOX_NOTE.es}` },
  },
  slow_provider: {
    kinds: ["payroll"],
    label: { en: "Slow provider (records arrive later)", es: "Proveedor lento (los registros llegan después)" },
    description: { en: `Same records as "one employer", ready after a short wait. ${SANDBOX_NOTE.en}`, es: `Los mismos registros que "un empleador", listos después de una breve espera. ${SANDBOX_NOTE.es}` },
  },
  employer_not_found: {
    kinds: ["payroll", "bank"],
    label: { en: "Employer or bank not found", es: "No se encuentra el empleador o el banco" },
    description: { en: `The search finds nothing. ${SANDBOX_NOTE.en}`, es: `La búsqueda no encuentra nada. ${SANDBOX_NOTE.es}` },
  },
  provider_outage: {
    kinds: ["payroll", "bank"],
    label: { en: "Provider outage (fails)", es: "Falla del proveedor (no funciona)" },
    description: { en: `The service is down. ${SANDBOX_NOTE.en}`, es: `El servicio no funciona. ${SANDBOX_NOTE.es}` },
  },
  session_expired: {
    kinds: ["payroll", "bank"],
    label: { en: "Session times out", es: "La sesión se vence" },
    description: { en: `The connection expires before it finishes. ${SANDBOX_NOTE.en}`, es: `La conexión se vence antes de terminar. ${SANDBOX_NOTE.es}` },
  },
  declines: {
    kinds: ["payroll", "bank"],
    label: { en: "Person declines to connect", es: "La persona decide no conectar" },
    description: { en: `Leaves the provider screen without sharing. ${SANDBOX_NOTE.en}`, es: `Sale de la pantalla del proveedor sin compartir. ${SANDBOX_NOTE.es}` },
  },
  bank_deposits: {
    kinds: ["bank"],
    label: { en: "Bank account with payroll deposits", es: "Cuenta de banco con depósitos de nómina" },
    description: { en: `Deposits are after taxes, so a reviewer must look; nothing is counted. ${SANDBOX_NOTE.en}`, es: `Los depósitos son después de impuestos, así que una persona debe revisar; no se cuenta nada. ${SANDBOX_NOTE.es}` },
  },
});

export function simulatedPersonasFor(kind: RailKind): SimulatedPersonaOption[] {
  return SIMULATED_PERSONA_IDS.filter((id) => SIMULATED_PERSONAS[id].kinds.includes(kind)).map((id) => ({
    id,
    label: { ...SIMULATED_PERSONAS[id].label },
    description: { ...SIMULATED_PERSONAS[id].description },
  }));
}

const clientResultSchema = z.strictObject({ persona: z.enum(SIMULATED_PERSONA_IDS) });

const EXTERNAL_ID = /^sim:([a-z0-9_]+):(\d{1,15})$/;

export function simulatedExternalId(persona: SimulatedPersonaId, linkedAt: Date): string {
  return `sim:${persona}:${linkedAt.getTime()}`;
}

export function parseSimulatedExternalId(externalId: string | null): { persona: SimulatedPersonaId; linkedAtMs: number } | null {
  const m = externalId ? EXTERNAL_ID.exec(externalId) : null;
  if (!m || !(SIMULATED_PERSONA_IDS as readonly string[]).includes(m[1])) return null;
  return { persona: m[1] as SimulatedPersonaId, linkedAtMs: Number(m[2]) };
}

/* --------------------------------------------------------------------------- synthetic records */

const EMPLOYER_A = "Synthetic Grocery Co. (sandbox)";
const EMPLOYER_B = "Synthetic After-School Program (sandbox)";
const EMPLOYER_HIGH = "Synthetic Holdings LLC (sandbox)";

function w2(employerName: string, taxYear: number, wagesCents: number, medicareWagesCents: number, ref: string): NormalizedIncomeSource {
  return {
    type: "w2",
    employerName,
    grossAnnualCents: wagesCents,
    taxYear,
    confidence: "high",
    note: `Form W-2 for ${taxYear} from the simulated payroll provider (box 1). Sandbox data.`,
    medicareWagesCents,
    payDate: null,
    payFrequency: null,
    ytdGrossCents: null,
    providerRef: ref,
  };
}

interface PersonaRecords {
  w2s: NormalizedIncomeSource[];
  stubs: RawPayStub[];
  bank: NormalizedIncomeSource[];
}

function recordsFor(persona: SimulatedPersonaId, y: number): PersonaRecords {
  switch (persona) {
    case "single_w2":
    case "slow_provider":
      return {
        w2s: [w2(EMPLOYER_A, y, 4_125_000, 4_380_000, "sim-w2-a")],
        stubs: [
          { employerName: EMPLOYER_A, payDate: `${y}-06-13`, payFrequency: "biweekly", ytdGrossCents: 2_021_600, providerRef: "sim-stub-a-1" },
          { employerName: EMPLOYER_A, payDate: `${y}-12-26`, payFrequency: "biweekly", ytdGrossCents: 4_380_000, providerRef: "sim-stub-a-2" },
        ],
        bank: [],
      };
    case "two_jobs":
      return {
        w2s: [w2(EMPLOYER_A, y, 2_310_000, 2_310_000, "sim-w2-a"), w2(EMPLOYER_B, y, 1_184_000, 1_184_000, "sim-w2-b")],
        stubs: [],
        bank: [],
      };
    case "high_earner":
      return { w2s: [w2(EMPLOYER_HIGH, y, 240_000_000, 240_000_000, "sim-w2-h")], stubs: [], bank: [] };
    case "no_prior_year":
      return { w2s: [], stubs: [{ employerName: EMPLOYER_B, payDate: `${y + 1}-01-16`, payFrequency: "biweekly", ytdGrossCents: 210_000, providerRef: "sim-stub-b-1" }], bank: [] };
    case "partial_year":
      return { w2s: [], stubs: [{ employerName: EMPLOYER_A, payDate: `${y}-06-13`, payFrequency: "biweekly", ytdGrossCents: 1_650_000, providerRef: "sim-stub-a-1" }], bank: [] };
    case "bank_deposits":
      return {
        w2s: [],
        stubs: [],
        bank: [
          {
            type: "bank_income_estimate",
            employerName: `Payroll deposits from ${EMPLOYER_A}`,
            grossAnnualCents: 3_312_000,
            taxYear: y,
            confidence: "low",
            note: `Deposits seen in 12 months of ${y} in a simulated bank account. These are amounts after taxes and deductions, not gross income. Sandbox data.`,
            medicareWagesCents: null,
            payDate: null,
            payFrequency: null,
            ytdGrossCents: null,
            providerRef: "sim-bank-src-1",
          },
        ],
      };
    default:
      return { w2s: [], stubs: [], bank: [] };
  }
}

function buildReport(persona: SimulatedPersonaId, kind: RailKind, ctx: FetchContext): NormalizedIncomeReport {
  const y = ctx.incomeYear;
  const records = recordsFor(persona, y);
  const stubs = payStubSources(records.stubs, y, "high");
  const sources = [...records.w2s.filter((s) => s.taxYear === y), ...stubs.sources, ...records.bank];
  return {
    version: 1,
    provider: "simulated",
    kind,
    sandbox: true,
    retrievedAt: ctx.retrievedAt.toISOString(),
    incomeYear: y,
    person: { name: `${ctx.member.firstName} ${ctx.member.lastName}`.trim() || null },
    sources,
    coverage: summarizeCoverage(sources, y),
    dataBasis: records.bank.length > 0 ? "bank_net_deposits" : "payroll_gross",
    recordsSeen: records.w2s.length + records.stubs.length + records.bank.length,
    warnings: ["Simulated sandbox data. This is not anyone's real income.", ...stubs.warnings],
    providerResponseSha256: null,
  };
}

/* ---------------------------------------------------------------------------------- provider */

export const simulatedRail: RailProvider = {
  id: "simulated",
  displayName: SIMULATED_PROVIDER_NAME,
  sandbox: true,
  craPosture: "not_applicable",

  async createLinkSession(input: CreateLinkSessionInput): Promise<CreateLinkSessionResult> {
    return { client: { provider: "simulated", sandbox: true, personas: simulatedPersonasFor(input.kind) }, externalId: null };
  },

  async completeLink({ connection, clientResult, at }): Promise<CompleteLinkResult> {
    const parsed = clientResultSchema.safeParse(clientResult);
    if (!parsed.success) throw badRequest("Pick one of the sandbox choices.");
    const persona = parsed.data.persona;
    if (!SIMULATED_PERSONAS[persona].kinds.includes(connection.kind as RailKind)) throw badRequest("That sandbox choice does not apply to this kind of account.");
    switch (persona) {
      case "declines":
        return { outcome: "declined" };
      case "provider_outage":
        return { outcome: "failed", reason: "provider_unavailable", detail: "Simulated provider outage." };
      case "employer_not_found":
        return { outcome: "failed", reason: "employer_not_found", detail: "Simulated search found no employer or bank." };
      case "session_expired":
        return { outcome: "failed", reason: "connection_expired", detail: "Simulated session timeout." };
      case "slow_provider":
        return { outcome: "linked", externalId: simulatedExternalId(persona, at), accessToken: null, readiness: { type: "poll", afterMs: SIMULATED_SLOW_READY_AFTER_MS } };
      default:
        return { outcome: "linked", externalId: simulatedExternalId(persona, at), accessToken: null, readiness: { type: "immediate" } };
    }
  },

  async fetchIncomeReport(connection: RailConnection, ctx: FetchContext): Promise<FetchIncomeResult> {
    const parsed = parseSimulatedExternalId(connection.externalId);
    if (!parsed) throw badRequest("This simulated connection was never linked.");
    if (parsed.persona === "slow_provider") {
      const remaining = parsed.linkedAtMs + SIMULATED_SLOW_READY_AFTER_MS - ctx.retrievedAt.getTime();
      if (remaining > 0) return { state: "pending", retryAfterMs: remaining };
    }
    return { state: "ready", report: buildReport(parsed.persona, connection.kind as RailKind, ctx) };
  },

  async revoke(): Promise<void> {
    // Nothing is held at a simulated provider.
  },
};
