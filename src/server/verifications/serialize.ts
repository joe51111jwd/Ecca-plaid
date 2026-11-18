/**
 * The public JSON shape of a verification: what the HTTP API returns and what `verification.*` webhooks carry.
 *
 * Data minimization: no names, no email address, no household income figure and never the family link (it is
 * a credential, returned once by createVerification). Household income appears only in the evidence files the
 * SGO downloads. Schema policy: fields are only added, never renamed or removed.
 */
import type { Mode, ThresholdSource, VerificationMethod, VerificationStage, VerificationStatus } from "@/db/schema";
import { EVIDENCE_JSON_PATH, EVIDENCE_PDF_PATH } from "./policy";
import type { VerificationRow } from "./internal";

export interface ApiVerification {
  id: string;
  object: "verification";
  mode: Mode;
  status: VerificationStatus;
  stage: VerificationStage;
  method: VerificationMethod | null;
  household_size: number | null;
  area: { county_fips: string; county_name: string | null; hud_area_code: string | null; hud_area_name: string | null } | null;
  /** The limit the decision relied on, in US dollars as a decimal string ("312000.00"). */
  threshold_usd: string | null;
  /** Every reading of the provisional limit (two while the table is HUD-derived). */
  threshold_readings: Array<{ id: string; usd: string }>;
  threshold_source: ThresholdSource | null;
  threshold_table_version: string | null;
  threshold_effective_date: string | null;
  /** True while the limit comes from the HUD-derived provisional table. Every surface must show it. */
  provisional: boolean;
  income_year: number | null;
  award_program: string | null;
  award_letter_date: string | null;
  reasons: Array<{ code: string; message: string }>;
  evidence_pack_url: string | null;
  evidence_json_url: string | null;
  consent: { version: string; granted_at: string } | null;
  expires_at: string | null;
  decided_at: string | null;
  decided_by: "engine" | "reviewer" | null;
  passport: { reused: true; source_decided_at: string | null } | null;
  external_ref: string | null;
  metadata: Record<string, string>;
  created_at: string;
}

/** Integer cents as a dollar decimal string, without floating point. */
export function centsToUsd(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError("centsToUsd: cents must be a safe integer");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Readings stored on the decision JSON (`decision.threshold.readings`), read defensively. */
function readingsOf(decision: Record<string, unknown> | null): Array<{ id: string; usd: string }> {
  const threshold = decision?.threshold;
  if (!threshold || typeof threshold !== "object") return [];
  const readings = (threshold as { readings?: unknown }).readings;
  if (!Array.isArray(readings)) return [];
  const out: Array<{ id: string; usd: string }> = [];
  for (const r of readings) {
    if (r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && Number.isSafeInteger((r as { thresholdCents?: unknown }).thresholdCents)) {
      out.push({ id: (r as { id: string }).id, usd: centsToUsd((r as { thresholdCents: number }).thresholdCents) });
    }
  }
  return out;
}

export function toApiVerification(row: VerificationRow, opts: { baseUrl: string }): ApiVerification {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const decidedBy = row.decidedBy === null ? null : row.decidedBy === "engine" ? "engine" : "reviewer";
  return {
    id: row.id,
    object: "verification",
    mode: row.mode,
    status: row.status,
    stage: row.stage,
    method: row.method,
    household_size: row.householdSize,
    area: row.countyFips ? { county_fips: row.countyFips, county_name: row.countyName, hud_area_code: row.hudAreaCode, hud_area_name: row.areaName } : null,
    threshold_usd: row.thresholdCents === null ? null : centsToUsd(row.thresholdCents),
    threshold_readings: readingsOf(row.decision),
    threshold_source: row.thresholdSource,
    threshold_table_version: row.thresholdTableVersion,
    threshold_effective_date: row.thresholdEffectiveDate,
    provisional: row.provisional,
    income_year: row.incomeYear,
    award_program: row.awardProgram,
    award_letter_date: row.awardLetterDate,
    reasons: row.decisionReasons.map((r) => ({ code: r.code, message: r.message })),
    evidence_pack_url: row.evidencePdfObjectId ? `${base}${EVIDENCE_PDF_PATH(row.id)}` : null,
    evidence_json_url: row.evidenceJsonObjectId ? `${base}${EVIDENCE_JSON_PATH(row.id)}` : null,
    consent: row.consentVersion && row.consentGrantedAt ? { version: row.consentVersion, granted_at: row.consentGrantedAt.toISOString() } : null,
    expires_at: iso(row.expiresAt),
    decided_at: iso(row.decidedAt),
    decided_by: decidedBy,
    passport: row.passportSourceId ? { reused: true, source_decided_at: iso(row.passportSourceDecidedAt) } : null,
    external_ref: row.externalRef,
    metadata: { ...row.metadata },
    created_at: row.createdAt.toISOString(),
  };
}
