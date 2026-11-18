import { and, eq, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { assessSubstantialContributor } from "@/taxmath";
import { SGO_TAXABLE_YEAR_BASIS } from "./policy";

/**
 * Per donor, per SGO, per calendar year: the money actually received (succeeded donations only, so a refund takes a
 * gift out again) and the substantial-contributor advisory for SGO staff. Always recomputed from the donations
 * ledger, never incremented, so a retried or out-of-order job cannot drift the figures.
 */

const { donations, donors, donorYearTotals } = schema;

export interface YearKey {
  orgId: string;
  donorId: string;
  taxYear: number;
  mode: Mode;
}

export type DonorYearTotalsRow = typeof donorYearTotals.$inferSelect;

async function received(key: YearKey, tx: DbOrTx): Promise<{ designated: number; nonDesignated: number; count: number; last: Date | null }> {
  const [row] = await tx
    .select({
      designated: sql<string>`coalesce(sum(${donations.designatedAmountCents}), 0)`,
      nonDesignated: sql<string>`coalesce(sum(${donations.nonDesignatedAmountCents}), 0)`,
      count: sql<string>`count(*)`,
      last: sql<Date | string | null>`max(${donations.contributedAt})`,
    })
    .from(donations)
    .where(and(eq(donations.orgId, key.orgId), eq(donations.donorId, key.donorId), eq(donations.taxYear, key.taxYear), eq(donations.mode, key.mode), eq(donations.status, "succeeded")));
  const last = row?.last ? new Date(row.last) : null;
  return { designated: Number(row?.designated ?? 0), nonDesignated: Number(row?.nonDesignated ?? 0), count: Number(row?.count ?? 0), last };
}

/** Recomputes one donor's row and returns it. Callers recompute the spouse's row too (spouses are combined). */
export async function recomputeDonorYearTotals(key: YearKey, tx: DbOrTx): Promise<DonorYearTotalsRow> {
  const own = await received(key, tx);
  const [donor] = await tx.select({ spouseDonorId: donors.spouseDonorId }).from(donors).where(eq(donors.id, key.donorId));
  const spouse = donor?.spouseDonorId ? await received({ ...key, donorId: donor.spouseDonorId }, tx) : null;
  const ownAll = own.designated + own.nonDesignated;
  const spouseAll = spouse ? spouse.designated + spouse.nonDesignated : 0;
  // The SGO's total contributions (the 2 percent denominator) are not known to the checkout: the advisory says so.
  const assessment = assessSubstantialContributor({ basis: "running", donorContributionsCents: ownAll, spouseContributionsCents: spouseAll, totalContributionsCents: null, sgoTaxableYear: key.taxYear });
  const summary = {
    status: assessment.status,
    isSubstantialContributor: assessment.isSubstantialContributor,
    aggregateCents: assessment.organization.aggregateCents,
    shareTestMetBelowTotalCents: assessment.organization.shareTestMetBelowTotalCents,
    advisories: assessment.advisories,
    advisoryDisclaimer: assessment.advisoryDisclaimer,
    basis: assessment.basis,
    sgoTaxableYearBasis: SGO_TAXABLE_YEAR_BASIS,
    taxmathVersion: assessment.taxmathVersion,
    copyVersion: assessment.copyVersion,
  };
  const values = {
    designatedCents: own.designated,
    nonDesignatedCents: own.nonDesignated,
    giftCount: own.count,
    lastContributedAt: own.last,
    combinedWithSpouseCents: ownAll + spouseAll,
    substantialContributor: summary as unknown as Record<string, unknown>,
    updatedAt: now(),
  };
  const [row] = await tx
    .insert(donorYearTotals)
    .values({ orgId: key.orgId, donorId: key.donorId, taxYear: key.taxYear, mode: key.mode, ...values })
    .onConflictDoUpdate({ target: [donorYearTotals.orgId, donorYearTotals.donorId, donorYearTotals.taxYear, donorYearTotals.mode], set: values })
    .returning();
  return row;
}

/** Recomputes the rows of every donor touched and of their spouses. */
export async function recomputeTotalsFor(keys: readonly YearKey[], tx: DbOrTx): Promise<void> {
  const seen = new Set<string>();
  const queue: YearKey[] = [...keys];
  for (const key of keys) {
    const [donor] = await tx.select({ spouseDonorId: donors.spouseDonorId }).from(donors).where(eq(donors.id, key.donorId));
    if (donor?.spouseDonorId) queue.push({ ...key, donorId: donor.spouseDonorId });
  }
  for (const key of queue) {
    const id = `${key.orgId}|${key.donorId}|${key.taxYear}|${key.mode}`;
    if (seen.has(id)) continue;
    seen.add(id);
    await recomputeDonorYearTotals(key, tx);
  }
}
