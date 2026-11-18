/**
 * The large-donor advisory against the three examples in Prop. Treas. Reg. 1.25F-3(d)(5), as restated in
 * docs/reference/donor-credit-rules.md F53. The example figures are the regulation's; everything else is synthetic.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS,
  SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD,
  SUBSTANTIAL_CONTRIBUTOR_SPOUSE_ATTRIBUTION,
  SUBSTANTIAL_CONTRIBUTOR_STATUS_TAXABLE_YEARS,
  TAXMATH_VERSION,
} from "./constants";
import { COPY, COPY_VERSION } from "./copy";
import { assessSubstantialContributor, type SubstantialContributorInput } from "./substantial-contributor";

const usd = (dollars: number) => dollars * 100;

function expectValidationError(run: () => unknown, field?: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe("validation_failed");
  if (field) expect(Object.keys(((thrown as AppError).details as { fields: Record<string, string> }).fields)).toContain(field);
}

describe("the thresholds are the proposed regulation's", () => {
  it("more than $5,000 and more than 2 percent, spouses combined, for the year and the next", () => {
    expect(SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS).toMatchObject({ value: usd(5000), authority: "proposed_reg" });
    expect(SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD).toMatchObject({ value: { numerator: 2, denominator: 100 }, authority: "proposed_reg" });
    expect(SUBSTANTIAL_CONTRIBUTOR_SPOUSE_ATTRIBUTION).toMatchObject({ value: true, authority: "proposed_reg" });
    expect(SUBSTANTIAL_CONTRIBUTOR_STATUS_TAXABLE_YEARS).toMatchObject({ value: 2, authority: "proposed_reg" });
  });
});

describe("the regulation's examples (F53)", () => {
  it("Example 1: A gives $6,000 of O's $450,000 (1.33 percent) -> not a substantial contributor", () => {
    const result = assessSubstantialContributor({ basis: "year_end", donorContributionsCents: usd(6000), totalContributionsCents: usd(450_000), sgoTaxableYear: 2027 });
    expect(result.organization).toEqual({
      aggregateCents: usd(6000),
      exceedsAmountThreshold: true,
      totalContributionsCents: usd(450_000),
      shareBps: 133,
      exceedsShareThreshold: false,
      substantial: false,
      shareTestMetBelowTotalCents: usd(300_000),
    });
    expect(result.isSubstantialContributor).toBe(false);
    expect(result.status).toBe("not_substantial_contributor");
    expect(result.treatedAsSubstantialContributorForYears).toBeNull();
    expect(result.advisories.map((advisory) => advisory.code)).toEqual(["not_substantial_contributor"]);
    expect(result.advisories[0].message).toContain("1.33 percent");
    expect(result.advisories[0].message).toContain("$450,000");
  });

  it("Example 2: B gives $6,000 of P's $280,000 (2.14 percent) -> substantial contributor for 2027 and 2028", () => {
    const result = assessSubstantialContributor({ basis: "year_end", donorContributionsCents: usd(6000), totalContributionsCents: usd(280_000), sgoTaxableYear: 2027 });
    expect(result.organization.shareBps).toBe(214);
    expect(result.organization.exceedsShareThreshold).toBe(true);
    expect(result.isSubstantialContributor).toBe(true);
    expect(result.status).toBe("substantial_contributor");
    expect(result.treatedAsSubstantialContributorForYears).toEqual([2027, 2028]);
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]).toMatchObject({ code: "substantial_contributor", audience: "sgo", copyId: "sgo.substantial_contributor.is" });
    expect(result.advisories[0].message).toContain("$6,000");
    expect(result.advisories[0].message).toContain("2.14 percent");
    expect(result.advisories[0].message).toContain("for that taxable year and the next");
  });

  it("Example 3: C gives $7,000 twice, $14,000 of Q's $650,000 (2.15 percent) -> substantial contributor for 2027 and 2028", () => {
    const yearEnd = assessSubstantialContributor({ basis: "year_end", donorContributionsCents: usd(7000) + usd(7000), totalContributionsCents: usd(650_000), sgoTaxableYear: 2027 });
    expect(yearEnd.organization.aggregateCents).toBe(usd(14_000));
    expect(yearEnd.organization.shareBps).toBe(215);
    expect(yearEnd.isSubstantialContributor).toBe(true);
    expect(yearEnd.treatedAsSubstantialContributorForYears).toEqual([2027, 2028]);
  });

  it("Example 3, as of the August 15 award: only the first $7,000 of $400,000 received (under 2 percent), no pledge -> would not have been disqualified", () => {
    const asOfAward = assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(7000), totalContributionsCents: usd(400_000), sgoTaxableYear: 2027 });
    expect(asOfAward.organization.exceedsAmountThreshold).toBe(true);
    expect(asOfAward.organization.shareBps).toBe(175);
    expect(asOfAward.organization.exceedsShareThreshold).toBe(false);
    expect(asOfAward.isSubstantialContributor).toBe(false);
    expect(asOfAward.projected).toBeNull();
    // A running figure never fixes the two-year status; that happens at the close of the SGO's taxable year.
    expect(asOfAward.treatedAsSubstantialContributorForYears).toBeNull();
  });

  it("a running figure over both thresholds is worded as 'not excepted on these figures', never as the year-end determination", () => {
    const running = assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(6000), totalContributionsCents: usd(280_000), sgoTaxableYear: 2027 });
    expect(running.isSubstantialContributor).toBe(true);
    expect(running.treatedAsSubstantialContributorForYears).toBeNull();
    expect(running.advisories).toHaveLength(1);
    expect(running.advisories[0]).toMatchObject({ code: "substantial_contributor", copyId: "sgo.substantial_contributor.is_running" });
    expect(running.advisories[0].message).toContain("determined at the close of the organization's taxable year");
    expect(running.advisories[0].message).toContain("would not qualify as an excepted scholarship");
    expect(running.advisories[0].message).not.toContain("that makes the donor a substantial contributor");
    expect(running.advisories[0].message).toContain("$6,000");
    expect(running.advisories[0].message).toContain("2.14 percent");
  });
});

describe("the two-part test, at its edges", () => {
  const yearEnd = (donor: number, total: number | null, extra: Partial<SubstantialContributorInput> = {}) =>
    assessSubstantialContributor({ basis: "year_end", donorContributionsCents: donor, totalContributionsCents: total, ...extra });

  it("exactly $5,000 is not more than $5,000, whatever the share", () => {
    const result = yearEnd(usd(5000), usd(5000));
    expect(result.organization.exceedsAmountThreshold).toBe(false);
    expect(result.organization.exceedsShareThreshold).toBe(true);
    expect(result.isSubstantialContributor).toBe(false);
    expect(result.status).toBe("not_flagged");
    expect(result.advisories).toEqual([]);
    expect(result.advisoryDisclaimer).toBeNull();
    expect(yearEnd(usd(5000) + 1, usd(5000) + 1).isSubstantialContributor).toBe(true);
  });

  it("exactly 2 percent is not more than 2 percent", () => {
    const exact = yearEnd(usd(6000), usd(300_000));
    expect(exact.organization.shareBps).toBe(200);
    expect(exact.organization.exceedsShareThreshold).toBe(false);
    expect(exact.isSubstantialContributor).toBe(false);
    expect(exact.organization.shareTestMetBelowTotalCents).toBe(usd(300_000));

    expect(yearEnd(usd(6000), usd(300_000) - 1).isSubstantialContributor).toBe(true);
    expect(yearEnd(usd(6000), usd(300_000) + 1).isSubstantialContributor).toBe(false);
    // The comparison is exact even where the displayed share rounds to 2.00 percent.
    const hair = yearEnd(600_001, 30_000_000);
    expect(hair.organization.shareBps).toBe(200);
    expect(hair.organization.exceedsShareThreshold).toBe(true);
  });

  it("a donor who only ever gives the cap, or a couple giving twice the cap, is never flagged (F50)", () => {
    expect(yearEnd(usd(1700), usd(10_000)).status).toBe("not_flagged");
    expect(yearEnd(usd(1700), usd(10_000), { spouseContributionsCents: usd(1700) }).status).toBe("not_flagged");
  });

  it("attributes a spouse's contributions to the donor", () => {
    const alone = yearEnd(usd(3000), usd(200_000));
    expect(alone.status).toBe("not_flagged");
    const together = yearEnd(usd(3000), usd(200_000), { spouseContributionsCents: usd(3000), sgoTaxableYear: 2028 });
    expect(together.organization.aggregateCents).toBe(usd(6000));
    expect(together.organization.shareBps).toBe(300);
    expect(together.isSubstantialContributor).toBe(true);
    expect(together.treatedAsSubstantialContributorForYears).toEqual([2028, 2029]);
  });

  it("counts every contribution, designated or not: the caller passes the whole amount", () => {
    // $1,700 designated plus $4,000 not designated is $5,700 for this test.
    expect(yearEnd(usd(1700) + usd(4000), usd(100_000)).isSubstantialContributor).toBe(true);
  });

  it("without the SGO's total it can only say the amount part is met, and tells the SGO where the 2 percent line is", () => {
    for (const total of [null, undefined]) {
      const result = assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(8000), totalContributionsCents: total });
      expect(result.status).toBe("over_amount_threshold_share_unknown");
      expect(result.isSubstantialContributor).toBeNull();
      expect(result.organization).toMatchObject({ exceedsAmountThreshold: true, shareBps: null, exceedsShareThreshold: null, substantial: null, shareTestMetBelowTotalCents: usd(400_000) });
      expect(result.advisories.map((advisory) => [advisory.code, advisory.copyId])).toEqual([["over_amount_threshold", "sgo.substantial_contributor.over_amount"]]);
      expect(result.advisories[0].message).toContain("$8,000");
      expect(result.advisories[0].message).toContain("below $400,000");
      expect(result.treatedAsSubstantialContributorForYears).toBeNull();
    }
    expect(assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(4000) }).status).toBe("not_flagged");
  });

  it("applies the same test separately to the section 25F segregated account", () => {
    // Not substantial against the whole organization, but substantial against the smaller segregated account.
    const result = yearEnd(usd(6000), usd(450_000), {
      sgoTaxableYear: 2027,
      segregatedAccount: { donorContributionsCents: usd(5500), totalContributionsCents: usd(100_000) },
    });
    expect(result.organization.substantial).toBe(false);
    expect(result.segregatedAccount).toMatchObject({ aggregateCents: usd(5500), exceedsAmountThreshold: true, shareBps: 550, substantial: true });
    expect(result.isSubstantialContributor).toBe(true);
    expect(result.status).toBe("substantial_contributor");
    expect(result.treatedAsSubstantialContributorForYears).toEqual([2027, 2028]);
    expect(result.advisories[0].message).toContain("$5,500");

    const unknownAccount = yearEnd(usd(6000), usd(450_000), { segregatedAccount: { donorContributionsCents: usd(5500) } });
    expect(unknownAccount.isSubstantialContributor).toBeNull();
    expect(unknownAccount.status).toBe("over_amount_threshold_share_unknown");
    // The advisory follows the undecided account-level test, not the organization-level "not substantial".
    expect(unknownAccount.advisories.map((advisory) => advisory.copyId)).toEqual(["sgo.substantial_contributor.over_amount"]);
    expect(unknownAccount.advisories[0].message).toContain("$5,500");

    const smallAccount = yearEnd(usd(6000), usd(450_000), { segregatedAccount: { donorContributionsCents: usd(1700), totalContributionsCents: usd(1700) } });
    expect(smallAccount.segregatedAccount?.substantial).toBe(false);
    expect(smallAccount.isSubstantialContributor).toBe(false);
  });

  it("surfaces scheduled or pledged gifts, which the organization is taken to know about (F50a)", () => {
    const result = assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(3000), pledgedCents: usd(3000), totalContributionsCents: usd(200_000) });
    expect(result.status).toBe("not_flagged");
    expect(result.projected).toEqual({ aggregateCents: usd(6000), exceedsAmountThreshold: true });
    expect(result.advisories.map((advisory) => advisory.copyId)).toEqual(["sgo.substantial_contributor.projected"]);
    expect(result.advisories[0].message).toContain("$6,000");
    expect(result.advisoryDisclaimer).toBe(COPY["sgo.substantial_contributor.advisory_only"].text);

    const small = assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(1000), pledgedCents: usd(1000) });
    expect(small.projected).toEqual({ aggregateCents: usd(2000), exceedsAmountThreshold: false });
    expect(small.advisories).toEqual([]);
  });

  it("handles an organization with no contributions on record and a donor who gave nothing", () => {
    const nothing = yearEnd(0, 0);
    expect(nothing.organization).toMatchObject({ shareBps: null, exceedsShareThreshold: false, substantial: false });
    expect(nothing.status).toBe("not_flagged");
  });
});

describe("it is an advisory for the SGO and never a block", () => {
  it("never blocks, whatever the outcome, and is addressed to SGO staff", () => {
    const outcomes = [
      assessSubstantialContributor({ basis: "year_end", donorContributionsCents: usd(900_000), totalContributionsCents: usd(900_000), sgoTaxableYear: 2027 }),
      assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(900_000) }),
      assessSubstantialContributor({ basis: "running", donorContributionsCents: usd(10) }),
    ];
    for (const result of outcomes) {
      expect(result.blocksGift).toBe(false);
      expect(result.authority).toBe("proposed_reg");
      expect(result.taxmathVersion).toBe(TAXMATH_VERSION);
      expect(result.copyVersion).toBe(COPY_VERSION);
      expect(result.thresholds).toEqual({ amountCents: usd(5000), shareNumerator: 2, shareDenominator: 100 });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      for (const advisory of result.advisories) {
        expect(advisory.audience).toBe("sgo");
        expect(COPY[advisory.copyId].audience).toBe("sgo");
        expect(COPY[advisory.copyId].authority).toBe("proposed_reg");
        expect(advisory.message).toMatch(/Under the proposed rules/);
        expect(advisory.message).not.toMatch(/[{}]/);
      }
    }
    expect(outcomes[0].advisoryDisclaimer).toMatch(/does not block or change the donor's gift/);
  });
});

describe("input validation", () => {
  const base = { basis: "year_end", donorContributionsCents: usd(6000) } as const;
  it.each([
    ["a negative contribution", { donorContributionsCents: -1 }, "donorContributionsCents"],
    ["a NaN contribution", { donorContributionsCents: Number.NaN }, "donorContributionsCents"],
    ["a fractional contribution", { donorContributionsCents: 10.5 }, "donorContributionsCents"],
    ["a missing contribution", { donorContributionsCents: undefined }, "donorContributionsCents"],
    ["a negative spouse contribution", { spouseContributionsCents: -1 }, "spouseContributionsCents"],
    ["a negative total", { totalContributionsCents: -1 }, "totalContributionsCents"],
    ["a total smaller than the donor's own gifts", { totalContributionsCents: usd(5999) }, "totalContributionsCents"],
    ["a total smaller than donor plus spouse", { spouseContributionsCents: usd(1000), totalContributionsCents: usd(6500) }, "totalContributionsCents"],
    ["an account total smaller than the donor's gifts to it", { segregatedAccount: { donorContributionsCents: usd(100), totalContributionsCents: usd(99) } }, "segregatedAccount.totalContributionsCents"],
    ["a negative pledge", { pledgedCents: -1 }, "pledgedCents"],
    ["an unknown basis", { basis: "forecast" }, "basis"],
    ["a missing basis", { basis: undefined }, "basis"],
    ["a two-digit year", { sgoTaxableYear: 27 }, "sgoTaxableYear"],
    ["an unknown field", { donorName: "Synthetic Donor" }, "_"],
  ])("rejects %s", (_label, overrides, field) => {
    expectValidationError(() => assessSubstantialContributor({ ...base, ...overrides } as unknown as SubstantialContributorInput), field);
  });

  it("rejects totals that cannot be added exactly", () => {
    expectValidationError(() => assessSubstantialContributor({ basis: "running", donorContributionsCents: Number.MAX_SAFE_INTEGER, spouseContributionsCents: 1 }));
  });
});
