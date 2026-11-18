import type { Mode } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { plaidRailFromEnv, type PlaidRail } from "./plaid";
import { SIMULATED_PROVIDER_NAME } from "./copy";
import { simulatedRail } from "./simulated";
import type { RailProvider, RailProviderId } from "./types";

/** Static facts about each provider, available without its credentials (for views and the evidence trail). */
export const RAIL_PROVIDER_INFO: Readonly<Record<RailProviderId, { displayName: string; craPosture: RailProvider["craPosture"] }>> = Object.freeze({
  simulated: { displayName: SIMULATED_PROVIDER_NAME, craPosture: "not_applicable" },
  // Plaid's own statement: "Income is a product of Plaid Inc., which is not a consumer reporting agency" (fact 53).
  plaid: { displayName: "Plaid", craPosture: "vendor_states_not_cra" },
});

/**
 * Which rail serves a connection.
 *
 * Sandbox data must never reach a real decision, and real data must never land in test mode. So:
 *  - the simulated rail serves only `test`-mode verifications;
 *  - Plaid serves `test` verifications only with PLAID_ENV=sandbox, and `live` ones only with
 *    PLAID_ENV=production.
 * When the configured rail cannot serve a verification, auto-submit is unavailable and the family uploads.
 */

const overrides = new Map<RailProviderId, RailProvider>();
let plaidInstance: { key: string; rail: PlaidRail } | null = null;

/** Tests only: replace a provider (for example a Plaid rail wired to a mocked fetch). Pass null to restore. */
export function setRailProviderForTests(id: RailProviderId, provider: RailProvider | null): void {
  if (env().NODE_ENV === "production") throw new Error("setRailProviderForTests is not allowed in production");
  if (provider) overrides.set(id, provider);
  else overrides.delete(id);
}

/** The provider for an id, as configured. Throws `not_available` if it is not configured here. */
export function getRailProvider(id: RailProviderId): RailProvider {
  const override = overrides.get(id);
  if (override) return override;
  if (id === "simulated") return simulatedRail;
  const e = env();
  // One instance per configuration, so its webhook-key cache survives between requests.
  const key = `${e.PLAID_CLIENT_ID ?? ""}|${e.PLAID_ENV}`;
  if (!plaidInstance || plaidInstance.key !== key) plaidInstance = { key, rail: plaidRailFromEnv() };
  return plaidInstance.rail;
}

/** RAIL_PROVIDER: the rail offered to families. */
export function configuredRailProviderId(): RailProviderId {
  return env().RAIL_PROVIDER;
}

/** Why a provider cannot serve a verification of this mode, or null when it can. */
export function railModeMismatch(provider: Pick<RailProvider, "id" | "sandbox">, mode: Mode): string | null {
  if (mode === "live" && provider.sandbox) return "A sandbox data connection cannot be used for a live verification.";
  if (mode === "test" && !provider.sandbox) return "A production data connection cannot be used for a test verification.";
  return null;
}

/** The configured provider for a verification of `mode`. Throws `not_available` when there is none. */
export function railProviderForMode(mode: Mode): RailProvider {
  const provider = getRailProvider(configuredRailProviderId());
  const mismatch = railModeMismatch(provider, mode);
  if (mismatch) throw new AppError("not_available", `Connecting an account is not available for this verification. Please upload documents instead. (${mismatch})`, { reason: "rail_unavailable_for_mode" });
  return provider;
}
