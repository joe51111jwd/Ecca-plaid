import { formatUsd } from "@/lib/money";

/**
 * Commercial terms between the platform and a business. The success fee is billed to the business on its own
 * invoice: families are never charged, and the fee is never taken from (or netted against) scholarship funds.
 */

/**
 * POLICY: accepted bounds for a business's success fee. The spec sets no amounts. The basis-point ceiling matches the
 * platform default setting ("business.defaultSuccessFee", at most 2000 bps = 20%); the flat ceiling ($10,000 per
 * booking) only catches typing mistakes.
 */
export const SUCCESS_FEE_LIMITS = { maxFlatCents: 1_000_000, maxBps: 2000 } as const;

export interface SuccessFeeTerms {
  flatCents: number;
  bps: number;
}

/** The sentence every fee description ends with. Exported so screens and tests can rely on the exact words. */
export const FAMILY_AND_SCHOLARSHIP_PROTECTION =
  "Families are never charged, and the fee is never taken from scholarship funds.";

/** 250 → "2.5%", 1 → "0.01%", 1000 → "10%". Integer arithmetic only. */
export function formatBps(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid basis points: ${bps}`);
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * Plain-language statement of who pays what, for the business portal and invoices. Always states that families are
 * never charged and that the fee is never taken from scholarship funds.
 */
export function describeFeeTerms(profile: { displayName: string; successFeeFlatCents: number; successFeeBps: number }): string {
  const name = profile.displayName.trim() || "This business";
  const flat = profile.successFeeFlatCents;
  const bps = profile.successFeeBps;
  if (!Number.isSafeInteger(flat) || flat < 0) throw new Error(`Invalid flat success fee: ${flat}`);
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid success fee basis points: ${bps}`);

  let amount: string | null = null;
  if (flat > 0 && bps > 0) amount = `${formatUsd(flat)} plus ${formatBps(bps)} of the booking amount`;
  else if (flat > 0) amount = formatUsd(flat);
  else if (bps > 0) amount = `${formatBps(bps)} of the booking amount`;

  const terms =
    amount === null
      ? `${name} currently pays no success fee for bookings completed with scholarship funds.`
      : `${name} pays a success fee of ${amount} for each booking completed with scholarship funds, billed to ${name} on its own invoice.`;
  return `${terms} ${FAMILY_AND_SCHOLARSHIP_PROTECTION}`;
}
