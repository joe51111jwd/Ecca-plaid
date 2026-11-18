/**
 * The large-donor flag: is a donor (together with a spouse) a "substantial contributor" to an SGO?
 *
 * Under the proposed regulations an SGO may not award a scholarship to a substantial contributor or a
 * member of that person's family. The test (Prop. Treas. Reg. 1.25F-3(d)(2); docs/reference/
 * donor-credit-rules.md F49 to F53) has two parts, both measured over the SGO's taxable year:
 *
 *   aggregate contributions of MORE THAN $5,000, AND
 *   that aggregate is MORE THAN 2 percent of the total contributions the SGO received,
 *
 * with a spouse's contributions attributed to the individual, all contributions counted (designated or
 * not), and the same test applied separately to the section 25F segregated account. Status is fixed at the
 * close of the SGO's taxable year and lasts for that year and the next.
 *
 * The checkout knows the numerator; the SGO has the denominator. So this function returns an ADVISORY for
 * SGO staff and never blocks, delays or changes a gift.
 */
import { z } from "zod";
import { formatUsd } from "@/lib/money";
import { invalid } from "@/lib/errors";
import {
  SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS,
  SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD,
  SUBSTANTIAL_CONTRIBUTOR_STATUS_TAXABLE_YEARS,
  TAXMATH_VERSION,
} from "./constants";
import { COPY_VERSION, renderCopyDynamic, type CopyId } from "./copy";
import { centsSchema, parseInput, sumCents, taxYearSchema } from "./validation";

export interface ContributionTotalsInput {
  /** Everything the donor gave in the SGO's taxable year so far, designated or not, in cents. */
  donorContributionsCents: number;
  /** Everything the donor's spouse gave in the same period, in cents. Attributed to the donor. Default 0. */
  spouseContributionsCents?: number;
  /** Total contributions received from all sources in the same period (the SGO supplies this), in cents. */
  totalContributionsCents?: number | null;
}

export interface SubstantialContributorInput extends ContributionTotalsInput {
  /**
   * "year_end": figures as of the close of the SGO's taxable year, when status is determined.
   * "running": figures through some date within the year (also the test for an "excepted scholarship").
   */
  basis: "running" | "year_end";
  /** The same figures for the SGO's section 25F segregated account, when tracked separately. */
  segregatedAccount?: ContributionTotalsInput | null;
  /** Further gifts the donor has scheduled or pledged for the same taxable year, in cents. */
  pledgedCents?: number;
  /** The SGO taxable year the figures belong to (the calendar year in which it ends). */
  sgoTaxableYear?: number | null;
}

export interface ThresholdTest {
  /** Donor plus spouse. */
  aggregateCents: number;
  /** aggregate > $5,000. */
  exceedsAmountThreshold: boolean;
  totalContributionsCents: number | null;
  /** The aggregate as a share of the total, in hundredths of a percent, rounded (214 = 2.14 percent). Null without a total. */
  shareBps: number | null;
  /** aggregate > 2 percent of the total, compared exactly. Null without a total. */
  exceedsShareThreshold: boolean | null;
  /** Both parts met. Null when the amount part is met but the total is unknown. */
  substantial: boolean | null;
  /** With this aggregate, the share part is met whenever the total for the year is below this amount. */
  shareTestMetBelowTotalCents: number;
}

export type SubstantialContributorStatus =
  /** Aggregate is $5,000 or less: the test cannot be met on these figures. */
  | "not_flagged"
  /** Aggregate is over $5,000 and the SGO's total is not known here: the SGO must apply the 2 percent part. */
  | "over_amount_threshold_share_unknown"
  /** Over $5,000 but not over 2 percent of the total supplied. */
  | "not_substantial_contributor"
  /** Over $5,000 and over 2 percent, for the organization or its section 25F account. */
  | "substantial_contributor";

export interface SubstantialContributorAdvisory {
  code: "over_amount_threshold" | "substantial_contributor" | "not_substantial_contributor";
  audience: "sgo";
  copyId: CopyId;
  message: string;
}

export interface SubstantialContributorAssessment {
  basis: "running" | "year_end";
  status: SubstantialContributorStatus;
  /** True, false, or null when it cannot be decided without the SGO's total. */
  isSubstantialContributor: boolean | null;
  organization: ThresholdTest;
  segregatedAccount: ThresholdTest | null;
  /** The aggregate if scheduled or pledged gifts are made; null when none were given. */
  projected: { aggregateCents: number; exceedsAmountThreshold: boolean } | null;
  /** SGO taxable years for which the donor is treated as a substantial contributor (year-end basis only). */
  treatedAsSubstantialContributorForYears: number[] | null;
  /** Sentences for SGO staff; empty when nothing is flagged. Never shown to the donor. */
  advisories: SubstantialContributorAdvisory[];
  /** "This is an advisory ... It does not block or change the donor's gift."; null when there is no advisory. */
  advisoryDisclaimer: string | null;
  /** This assessment never blocks a gift. */
  blocksGift: false;
  thresholds: { amountCents: number; shareNumerator: number; shareDenominator: number };
  authority: "proposed_reg";
  taxmathVersion: string;
  copyVersion: string;
}

const totalsShape = {
  donorContributionsCents: centsSchema,
  spouseContributionsCents: centsSchema.optional(),
  totalContributionsCents: centsSchema.nullish(),
};

const inputSchema = z.strictObject({
  ...totalsShape,
  basis: z.enum(["running", "year_end"], "Must be running or year_end"),
  segregatedAccount: z.strictObject(totalsShape).nullish(),
  pledgedCents: centsSchema.optional(),
  sgoTaxableYear: taxYearSchema.nullish(),
}) satisfies z.ZodType<SubstantialContributorInput>;

function percentText(shareBps: number): string {
  return `${(shareBps / 100).toFixed(2)} percent`;
}

function runTest(totals: ContributionTotalsInput, field: string): ThresholdTest {
  const amountThreshold = SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS.value;
  const share = SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD.value;
  const aggregateCents = sumCents(field, totals.donorContributionsCents, totals.spouseContributionsCents ?? 0);
  const total = totals.totalContributionsCents ?? null;
  if (total !== null && total < aggregateCents) {
    throw invalid("Total contributions cannot be less than this donor's own contributions", {
      fields: { [field]: "The total must include this donor's (and spouse's) contributions" },
    });
  }
  const exceedsAmountThreshold = aggregateCents > amountThreshold;
  // aggregate / total > numerator / denominator, compared in integers so 2.00 percent exactly is "not more than".
  const exceedsShareThreshold = total === null ? null : BigInt(aggregateCents) * BigInt(share.denominator) > BigInt(total) * BigInt(share.numerator);
  const shareBps = total === null || total === 0 ? null : Number((BigInt(aggregateCents) * 20_000n + BigInt(total)) / (BigInt(total) * 2n));
  return {
    aggregateCents,
    exceedsAmountThreshold,
    totalContributionsCents: total,
    shareBps,
    exceedsShareThreshold,
    substantial: !exceedsAmountThreshold ? false : exceedsShareThreshold,
    // aggregate > (numerator / denominator) x total  <=>  total < aggregate x denominator / numerator.
    shareTestMetBelowTotalCents: Number((BigInt(aggregateCents) * BigInt(share.denominator)) / BigInt(share.numerator)),
  };
}

function advisoryFor(test: ThresholdTest): SubstantialContributorAdvisory | null {
  if (!test.exceedsAmountThreshold) return null;
  const aggregateAmount = formatUsd(test.aggregateCents);
  if (test.substantial === null || test.totalContributionsCents === null || test.shareBps === null) {
    const copyId: CopyId = "sgo.substantial_contributor.over_amount";
    return {
      code: "over_amount_threshold",
      audience: "sgo",
      copyId,
      message: renderCopyDynamic(copyId, { aggregateAmount, shareTestTotal: formatUsd(test.shareTestMetBelowTotalCents) }),
    };
  }
  const vars = { aggregateAmount, totalContributions: formatUsd(test.totalContributionsCents), sharePercent: percentText(test.shareBps) };
  const copyId: CopyId = test.substantial ? "sgo.substantial_contributor.is" : "sgo.substantial_contributor.not";
  return { code: test.substantial ? "substantial_contributor" : "not_substantial_contributor", audience: "sgo", copyId, message: renderCopyDynamic(copyId, vars) };
}

/** Applies the substantial-contributor test and returns an advisory for SGO staff. Never blocks a gift. */
export function assessSubstantialContributor(input: SubstantialContributorInput): SubstantialContributorAssessment {
  const parsed = parseInput(inputSchema, input, "substantial contributor input");
  const organization = runTest(parsed, "totalContributionsCents");
  const segregatedAccount = parsed.segregatedAccount ? runTest(parsed.segregatedAccount, "segregatedAccount.totalContributionsCents") : null;
  const tests = segregatedAccount ? [organization, segregatedAccount] : [organization];

  let isSubstantialContributor: boolean | null;
  if (tests.some((test) => test.substantial === true)) isSubstantialContributor = true;
  else if (tests.some((test) => test.substantial === null)) isSubstantialContributor = null;
  else isSubstantialContributor = false;

  let status: SubstantialContributorStatus;
  if (isSubstantialContributor === true) status = "substantial_contributor";
  else if (isSubstantialContributor === null) status = "over_amount_threshold_share_unknown";
  else status = tests.some((test) => test.exceedsAmountThreshold) ? "not_substantial_contributor" : "not_flagged";

  const pledgedCents = parsed.pledgedCents ?? 0;
  const projectedAggregateCents = sumCents("pledgedCents", organization.aggregateCents, pledgedCents);
  const projected =
    pledgedCents > 0
      ? { aggregateCents: projectedAggregateCents, exceedsAmountThreshold: projectedAggregateCents > SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS.value }
      : null;

  const advisories: SubstantialContributorAdvisory[] = [];
  // Lead with the test that makes the donor a substantial contributor, else the organization-level one.
  const leading = tests.find((test) => test.substantial === true) ?? tests.find((test) => test.exceedsAmountThreshold);
  const advisory = leading ? advisoryFor(leading) : null;
  if (advisory) advisories.push(advisory);
  if (projected?.exceedsAmountThreshold && !organization.exceedsAmountThreshold) {
    const copyId: CopyId = "sgo.substantial_contributor.projected";
    advisories.push({
      code: "over_amount_threshold",
      audience: "sgo",
      copyId,
      message: renderCopyDynamic(copyId, { projectedAmount: formatUsd(projected.aggregateCents) }),
    });
  }

  const year = parsed.sgoTaxableYear ?? null;
  const treatedAsSubstantialContributorForYears =
    parsed.basis === "year_end" && isSubstantialContributor === true && year !== null
      ? Array.from({ length: SUBSTANTIAL_CONTRIBUTOR_STATUS_TAXABLE_YEARS.value }, (_unused, offset) => year + offset)
      : null;

  return {
    basis: parsed.basis,
    status,
    isSubstantialContributor,
    organization,
    segregatedAccount,
    projected,
    treatedAsSubstantialContributorForYears,
    advisories,
    advisoryDisclaimer: advisories.length > 0 ? renderCopyDynamic("sgo.substantial_contributor.advisory_only") : null,
    blocksGift: false,
    thresholds: {
      amountCents: SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS.value,
      shareNumerator: SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD.value.numerator,
      shareDenominator: SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD.value.denominator,
    },
    authority: "proposed_reg",
    taxmathVersion: TAXMATH_VERSION,
    copyVersion: COPY_VERSION,
  };
}
