/**
 * Checkout gates (docs/reference/donor-credit-rules.md, Engineering Implications 2). All fixtures are synthetic.
 */
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { DATE_BEGUN_ANYWHERE_TIME_ZONE, DATE_BEGUN_EVERYWHERE_TIME_ZONE, FIRST_ELIGIBLE_DATE, TAXMATH_VERSION } from "./constants";
import { COPY, COPY_VERSION, renderCopy } from "./copy";
import { zonedDateTime } from "./dates";
import {
  ELIGIBILITY_BLOCKER_CODES,
  ELIGIBILITY_WARNING_CODES,
  assessCreditEligibility,
  classifyPaymentMethod,
  creditStartInstant,
  determineTaxYear,
  isBeforeCreditStart,
  type CreditEligibilityInput,
  type EligibilityBlockerCode,
  type EligibilityWarningCode,
} from "./eligibility";

const START = FIRST_ELIGIBLE_DATE.value;

type Overrides = Omit<Partial<CreditEligibilityInput>, "sgo" | "attestations"> & {
  sgo?: Partial<CreditEligibilityInput["sgo"]>;
  attestations?: Partial<CreditEligibilityInput["attestations"]>;
};

/** A gift that passes every gate: live, IRS-listed SGO, registered, all attestations, card, U.S. dollars, February 2027. */
function eligibleInput(overrides: Overrides = {}): CreditEligibilityInput {
  const { sgo, attestations, ...rest } = overrides;
  return {
    paidAt: new Date("2027-02-01T17:00:00Z"),
    creditStartDate: START,
    sgo: { listSource: "irs_published", listStatus: "listed", portalRegistered: true, ...sgo },
    attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true, ...attestations },
    paymentMethod: "card",
    currency: "usd",
    liveMode: true,
    ...rest,
  };
}

const assess = (overrides: Overrides = {}) => assessCreditEligibility(eligibleInput(overrides));
const blockerCodes = (overrides: Overrides) => assess(overrides).blockers.map((blocker) => blocker.code);
const warningCodes = (overrides: Overrides) => assess(overrides).warnings.map((warning) => warning.code);

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

/** One IANA zone for every time-zone rule in force somewhere in the 50 States and D.C. */
const STATE_TIME_ZONES = [
  "America/New_York",
  "America/Detroit",
  "America/Kentucky/Louisville",
  "America/Indiana/Indianapolis",
  "America/Chicago",
  "America/Indiana/Knox",
  "America/Menominee",
  "America/North_Dakota/Center",
  "America/Denver",
  "America/Boise",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Juneau",
  "America/Sitka",
  "America/Nome",
  "America/Adak",
  "Pacific/Honolulu",
];

describe("the gift that passes every gate", () => {
  it("is credit-eligible, with no blockers or warnings, and a headline that promises nothing", () => {
    const result = assess();
    expect(result).toEqual({
      creditEligible: true,
      blockers: [],
      warnings: [],
      onlyBlockedBySandbox: false,
      headline: { copyId: "eligibility.credit_eligible", message: renderCopy("eligibility.credit_eligible") },
      ineligibleReason: null,
      beforeCreditStart: false,
      creditStartInstant: "2027-01-01T10:00:00.000Z",
      paymentMethodClass: "cash",
      taxYear: null,
      taxmathVersion: TAXMATH_VERSION,
      copyVersion: COPY_VERSION,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.headline.message).toMatch(/depends on your own tax return/);
  });
});

describe("gate 1: the credit start, at a conservative instant", () => {
  it("opens at midnight Hawaii time on the start date: 2027-01-01T10:00:00Z", () => {
    expect(DATE_BEGUN_EVERYWHERE_TIME_ZONE.value).toBe("Pacific/Honolulu");
    expect(DATE_BEGUN_EVERYWHERE_TIME_ZONE.authority).toBe("product_policy");
    expect(creditStartInstant(START).toISOString()).toBe("2027-01-01T10:00:00.000Z");
  });

  it("at the start instant it is already the start date in every State's time zone; one millisecond earlier it is not", () => {
    const start = creditStartInstant(START);
    for (const timeZone of STATE_TIME_ZONES) {
      expect(zonedDateTime(start, timeZone).isoDate >= START, timeZone).toBe(true);
    }
    expect(zonedDateTime(new Date(start.getTime() - 1), "Pacific/Honolulu").isoDate).toBe("2026-12-31");
    expect(zonedDateTime(start, "Pacific/Honolulu")).toMatchObject({ isoDate: "2027-01-01", hour: 0, minute: 0, second: 0 });
  });

  it.each([
    ["New Year's Eve, mid-afternoon Central", "2026-12-31T21:00:00Z", true],
    ["midnight Eastern on January 1", "2027-01-01T05:00:00Z", true],
    ["midnight Central on January 1 (Texas)", "2027-01-01T06:00:00Z", true],
    ["midnight Mountain on January 1", "2027-01-01T07:00:00Z", true],
    ["midnight Pacific on January 1", "2027-01-01T08:00:00Z", true],
    ["midnight Alaska on January 1", "2027-01-01T09:00:00Z", true],
    ["one millisecond before midnight Hawaii", "2027-01-01T09:59:59.999Z", true],
    ["midnight Hawaii on January 1", "2027-01-01T10:00:00.000Z", false],
    ["one millisecond after", "2027-01-01T10:00:00.001Z", false],
    ["noon Central on January 1", "2027-01-01T18:00:00Z", false],
  ])("%s -> before the credit start: %s", (_label, paidAtIso, expectedBefore) => {
    const paidAt = new Date(paidAtIso);
    expect(isBeforeCreditStart(paidAt, START)).toBe(expectedBefore);
    const result = assess({ paidAt });
    expect(result.beforeCreditStart).toBe(expectedBefore);
    expect(result.creditEligible).toBe(!expectedBefore);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(expectedBefore ? ["before_credit_start"] : []);
  });

  it("explains the date and the time-zone caution to the donor", () => {
    const result = assess({ paidAt: new Date("2027-01-01T06:30:00Z") });
    expect(result.blockers[0]).toEqual({
      code: "before_credit_start",
      copyId: "eligibility.before_credit_start",
      authority: "product_policy",
      message: renderCopy("eligibility.before_credit_start", { creditStartDate: "January 1, 2027" }),
    });
    expect(result.blockers[0].message).toContain("January 1, 2027");
    expect(result.blockers[0].message).toContain("every U.S. State");
    expect(result.ineligibleReason).toBe(result.blockers[0].message);
  });

  it("stays correct for a start date in daylight-saving time (a date moved for a demo)", () => {
    // Hawaii keeps UTC-10 all year, so the instant is 10:00 UTC in July as well.
    expect(creditStartInstant("2026-07-01").toISOString()).toBe("2026-07-01T10:00:00.000Z");
    for (const timeZone of STATE_TIME_ZONES) {
      expect(zonedDateTime(creditStartInstant("2026-07-01"), timeZone).isoDate >= "2026-07-01", timeZone).toBe(true);
    }
    expect(isBeforeCreditStart(new Date("2026-07-01T09:59:59Z"), "2026-07-01")).toBe(true);
    expect(isBeforeCreditStart(new Date("2026-07-01T10:00:00Z"), "2026-07-01")).toBe(false);
    // A moved date serves sandbox demos only: the sandbox is then the one thing blocking the gift.
    const demo = assess({ paidAt: new Date("2026-11-18T12:00:00Z"), creditStartDate: "2026-11-01", liveMode: false });
    expect(demo.blockers.map((blocker) => blocker.code)).toEqual(["sandbox_mode"]);
    expect(demo.onlyBlockedBySandbox).toBe(true);
    expect(demo.creditStartInstant).toBe("2026-11-01T10:00:00.000Z");
  });

  it("never labels a live payment credit-eligible before the first eligible date, even with an earlier configured start", () => {
    const early = assess({ paidAt: new Date("2026-11-18T12:00:00Z"), creditStartDate: "2026-11-01" });
    expect(early.creditEligible).toBe(false);
    expect(early.beforeCreditStart).toBe(true);
    expect(early.creditStartInstant).toBe("2027-01-01T10:00:00.000Z");
    expect(early.blockers[0]).toMatchObject({
      code: "before_credit_start",
      message: renderCopy("eligibility.before_credit_start", { creditStartDate: "January 1, 2027" }),
    });
    expect(blockerCodes({ paidAt: new Date("2027-01-01T09:59:59.999Z"), creditStartDate: "2020-01-01" })).toEqual(["before_credit_start"]);
    expect(blockerCodes({ paidAt: new Date("2027-01-01T10:00:00Z"), creditStartDate: "2020-01-01" })).toEqual([]);
    expect(blockerCodes({ paidAt: new Date("2027-01-01T10:05:00Z"), initiatedAt: new Date("2026-12-31T12:00:00Z"), creditStartDate: "2026-06-01" })).toEqual([
      "initiated_before_credit_start",
    ]);
    // A later configured date still wins.
    expect(blockerCodes({ paidAt: new Date("2027-02-01T17:00:00Z"), creditStartDate: "2027-03-01" })).toEqual(["before_credit_start"]);
  });

  it("requires the payment to be started after the start instant too", () => {
    const paidAt = new Date("2027-01-01T10:05:00Z");
    expect(blockerCodes({ paidAt, initiatedAt: new Date("2027-01-01T09:58:00Z") })).toEqual(["initiated_before_credit_start"]);
    expect(blockerCodes({ paidAt, initiatedAt: new Date("2026-12-15T12:00:00Z") })).toEqual(["initiated_before_credit_start"]);
    expect(blockerCodes({ paidAt, initiatedAt: new Date("2027-01-01T10:00:00Z") })).toEqual([]);
    expect(blockerCodes({ paidAt, initiatedAt: null })).toEqual([]);
    // Charged before the start: one blocker, not two.
    expect(blockerCodes({ paidAt: new Date("2026-12-31T12:00:00Z"), initiatedAt: new Date("2026-12-31T11:00:00Z") })).toEqual(["before_credit_start"]);
  });

  it("validates its inputs", () => {
    expectValidationError(() => isBeforeCreditStart(new Date("nope"), START));
    expectValidationError(() => isBeforeCreditStart("2027-01-01" as unknown as Date, START));
    expectValidationError(() => isBeforeCreditStart(new Date(), "01/01/2027"));
    expectValidationError(() => creditStartInstant("2027-13-01"));
    expectValidationError(() => creditStartInstant("2027-02-29"));
  });
});

describe("gates 2, 7 and 8: the SGO list", () => {
  it("does not label a gift to an organization on the provisional curated list as credit-eligible", () => {
    const result = assess({ sgo: { listSource: "provisional_curated" } });
    expect(result.creditEligible).toBe(false);
    expect(result.blockers).toEqual([
      {
        code: "sgo_list_provisional",
        copyId: "eligibility.sgo_list_provisional",
        authority: "product_policy",
        message: renderCopy("eligibility.sgo_list_provisional"),
      },
    ]);
    expect(result.headline.message).toContain("provisional list");
  });

  it("blocks an organization that is not on the list in use, whichever list that is", () => {
    expect(blockerCodes({ sgo: { listStatus: "not_listed" } })).toEqual(["sgo_not_listed"]);
    expect(blockerCodes({ sgo: { listStatus: "not_listed", listSource: "provisional_curated" } })).toEqual(["sgo_not_listed"]);
  });

  it("blocks a removed organization when no removal date is known", () => {
    const result = assess({ sgo: { listStatus: "removed" } });
    expect(result.blockers.map((blocker) => [blocker.code, blocker.copyId])).toEqual([["sgo_removed", "eligibility.sgo_removed"]]);
    expect(assess({ sgo: { listStatus: "removed", removedOn: null } }).creditEligible).toBe(false);
  });

  it("treats the removal date itself as too late, from midnight Eastern", () => {
    expect(DATE_BEGUN_ANYWHERE_TIME_ZONE.value).toBe("America/New_York");
    expect(DATE_BEGUN_ANYWHERE_TIME_ZONE.authority).toBe("product_policy");
    const removed = { listStatus: "removed", removedOn: "2027-03-10" } as const;

    // Standard time: March 10, 2027 begins in New York at 05:00 UTC.
    const lastMoment = assess({ paidAt: new Date("2027-03-10T04:59:59.999Z"), sgo: removed });
    expect(lastMoment.creditEligible).toBe(true);
    expect(lastMoment.warnings.map((warning) => warning.code)).toEqual(["sgo_removed_after_gift"]);
    expect(lastMoment.warnings[0].message).toContain("March 10, 2027");
    expect(lastMoment.warnings[0].authority).toBe("proposed_reg");

    const firstMoment = assess({ paidAt: new Date("2027-03-10T05:00:00Z"), sgo: removed });
    expect(firstMoment.blockers.map((blocker) => [blocker.code, blocker.copyId])).toEqual([["sgo_removed", "eligibility.sgo_removed_on"]]);
    expect(firstMoment.blockers[0].message).toContain("March 10, 2027");
    expect(firstMoment.warnings).toEqual([]);

    expect(blockerCodes({ paidAt: new Date("2027-03-10T23:00:00Z"), sgo: removed })).toEqual(["sgo_removed"]);
    expect(blockerCodes({ paidAt: new Date("2027-06-01T12:00:00Z"), sgo: removed })).toEqual(["sgo_removed"]);
    // A gift made well before removal stays good (F54, F56a).
    expect(assess({ paidAt: new Date("2027-01-20T12:00:00Z"), sgo: removed }).creditEligible).toBe(true);
  });

  it("uses Eastern daylight time for a summer removal date", () => {
    const removed = { listStatus: "removed", removedOn: "2027-07-15" } as const;
    expect(blockerCodes({ paidAt: new Date("2027-07-15T03:59:59Z"), sgo: removed })).toEqual([]);
    expect(blockerCodes({ paidAt: new Date("2027-07-15T04:00:00Z"), sgo: removed })).toEqual(["sgo_removed"]);
  });

  it("honours a removal date on an entry still marked listed (a removal scheduled for a later date)", () => {
    const scheduled = { listStatus: "listed", removedOn: "2027-03-10" } as const;
    const before = assess({ paidAt: new Date("2027-03-01T12:00:00Z"), sgo: scheduled });
    expect(before.creditEligible).toBe(true);
    expect(before.warnings).toEqual([]);
    expect(blockerCodes({ paidAt: new Date("2027-03-10T12:00:00Z"), sgo: scheduled })).toEqual(["sgo_removed"]);
  });

  it("a pre-removal gift to a provisional-list organization is still not credit-eligible", () => {
    const result = assess({ paidAt: new Date("2027-01-20T12:00:00Z"), sgo: { listSource: "provisional_curated", listStatus: "removed", removedOn: "2027-03-10" } });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["sgo_list_provisional"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["sgo_removed_after_gift"]);
  });

  it("does not count a listing until its first day has begun in every State", () => {
    const sgo = { listedFrom: "2027-02-10" } as const;
    expect(blockerCodes({ paidAt: new Date("2027-02-09T23:00:00Z"), sgo })).toEqual(["sgo_not_yet_listed"]);
    expect(blockerCodes({ paidAt: new Date("2027-02-10T09:59:59Z"), sgo })).toEqual(["sgo_not_yet_listed"]);
    expect(blockerCodes({ paidAt: new Date("2027-02-10T10:00:00Z"), sgo })).toEqual([]);
    expect(blockerCodes({ paidAt: new Date("2027-02-11T00:00:00Z"), sgo })).toEqual([]);
    const result = assess({ paidAt: new Date("2027-02-09T23:00:00Z"), sgo });
    expect(result.blockers[0].message).toContain("February 10, 2027");
    expect(result.blockers[0].authority).toBe("irs_web");
  });

  it("gate 8: keeps the path closed until the State has submitted its list", () => {
    const advance = assess({ sgo: { stateParticipation: "advance_election_only" } });
    expect(advance.blockers.map((blocker) => [blocker.code, blocker.authority])).toEqual([["state_list_not_submitted", "irs_web"]]);
    expect(advance.blockers[0].message).toContain("advance election");
    expect(blockerCodes({ sgo: { stateParticipation: "not_participating" } })).toEqual(["state_not_participating"]);
    expect(blockerCodes({ sgo: { stateParticipation: "list_submitted" } })).toEqual([]);
    expect(blockerCodes({ sgo: { stateParticipation: null } })).toEqual([]);
  });
});

describe("gate 3: an SGO that did not authorize public listing", () => {
  it("warns that list reliance is unavailable, without blocking", () => {
    const result = assess({ sgo: { publicListingAuthorized: false } });
    expect(result.creditEligible).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: "list_reliance_unavailable",
        copyId: "notice.list_reliance_unavailable",
        authority: "proposed_reg",
        message: renderCopy("notice.list_reliance_unavailable", {}, { sgoListSource: "irs_published" }),
      },
    ]);
    expect(warningCodes({ sgo: { publicListingAuthorized: true } })).toEqual([]);
    expect(warningCodes({ sgo: { publicListingAuthorized: null } })).toEqual([]);
  });

  it("says nothing about the IRS list while the provisional list is the source", () => {
    const result = assess({ sgo: { listSource: "provisional_curated", publicListingAuthorized: false } });
    expect(result.warnings).toEqual([]);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["sgo_list_provisional"]);
  });
});

describe("gate 4: IRS SGO portal registration", () => {
  it("blocks the credit-eligible label until the SGO has registered", () => {
    const result = assess({ sgo: { portalRegistered: false } });
    expect(result.blockers.map((blocker) => [blocker.code, blocker.authority])).toEqual([["sgo_not_portal_registered", "product_policy"]]);
    expect(result.blockers[0].message).toContain("unique donor number");
  });
});

describe("gate 5: donor attestations", () => {
  it.each([
    ["individual", "attestation_individual_missing"],
    ["usCitizenOrResident", "attestation_us_citizen_or_resident_missing"],
    ["noEarmark", "attestation_no_earmark_missing"],
    ["notInExchangeForScholarship", "attestation_not_in_exchange_missing"],
  ] as const)("a missing %s attestation blocks with %s", (attestation, code) => {
    const result = assess({ attestations: { [attestation]: false } });
    expect(result.creditEligible).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([code]);
    expect(result.blockers[0].message).toBe(COPY[result.blockers[0].copyId].text);
  });

  it("lists every missing attestation", () => {
    expect(blockerCodes({ attestations: { individual: false, usCitizenOrResident: false, noEarmark: false, notInExchangeForScholarship: false } })).toEqual([
      "attestation_individual_missing",
      "attestation_us_citizen_or_resident_missing",
      "attestation_no_earmark_missing",
      "attestation_not_in_exchange_missing",
    ]);
  });
});

describe("gate 6: U.S.-dollar cash only", () => {
  it.each(["card", "us_bank_account", "ach", "bank_transfer", "check", "money_order", "currency", "payroll_deduction", " Card ", "US_BANK_ACCOUNT"])(
    "accepts %s as cash",
    (paymentMethod) => {
      expect(classifyPaymentMethod(paymentMethod)).toBe("cash");
      expect(assess({ paymentMethod }).creditEligible).toBe(true);
    },
  );

  it.each(["crypto", "cryptocurrency", "digital_asset", "stablecoin", "CRYPTO"])("blocks %s as a digital asset", (paymentMethod) => {
    expect(classifyPaymentMethod(paymentMethod)).toBe("digital_asset");
    const result = assess({ paymentMethod });
    expect(result.blockers.map((blocker) => [blocker.code, blocker.authority])).toEqual([["payment_method_digital_asset", "temporary_reg"]]);
    expect(result.paymentMethodClass).toBe("digital_asset");
  });

  it.each(["stock", "securities", "donor_advised_fund", "paypal", "gift_card", "bitcoin", "unknown", "constructor", "toString"])(
    "keeps the unrecognized method %s off the credit-eligible path",
    (paymentMethod) => {
      expect(classifyPaymentMethod(paymentMethod)).toBe("unrecognized");
      const result = assess({ paymentMethod });
      expect(result.blockers.map((blocker) => [blocker.code, blocker.authority])).toEqual([["payment_method_not_cash", "product_policy"]]);
    },
  );

  it("requires U.S. dollars", () => {
    expect(blockerCodes({ currency: "USD" })).toEqual([]);
    expect(blockerCodes({ currency: " usd " })).toEqual([]);
    for (const currency of ["eur", "CAD", "mxn", "usdc", "btc"]) {
      const result = assess({ currency });
      expect(result.blockers.map((blocker) => [blocker.code, blocker.authority]), currency).toEqual([["currency_not_usd", "temporary_reg"]]);
    }
  });
});

describe("sandbox mode", () => {
  it("is never credit-eligible, and says when the sandbox is the only reason", () => {
    const result = assess({ liveMode: false });
    expect(result.creditEligible).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["sandbox_mode"]);
    expect(result.onlyBlockedBySandbox).toBe(true);
    expect(result.headline).toEqual({ copyId: "eligibility.sandbox_mode", message: renderCopy("eligibility.sandbox_mode") });
  });

  it("before the credit start, leads with the sandbox-and-date notice", () => {
    const result = assess({ liveMode: false, paidAt: new Date("2026-12-10T15:00:00Z") });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["sandbox_mode", "before_credit_start"]);
    expect(result.onlyBlockedBySandbox).toBe(false);
    expect(result.headline).toEqual({
      copyId: "eligibility.before_credit_start_sandbox",
      message: renderCopy("eligibility.before_credit_start_sandbox", { creditStartDate: "January 1, 2027" }),
    });
    expect(result.ineligibleReason).toContain("Sandbox gift, not credit-eligible");
    expect(result.ineligibleReason).toContain("January 1, 2027");
  });

  it("a live gift before the start is blocked by the date alone", () => {
    const result = assess({ paidAt: new Date("2026-12-10T15:00:00Z") });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["before_credit_start"]);
    expect(result.onlyBlockedBySandbox).toBe(false);
    expect(result.headline.copyId).toBe("eligibility.before_credit_start");
  });
});

describe("every reason, together", () => {
  it("reports all blockers in a fixed order and never throws on a hopeless gift", () => {
    const result = assess({
      liveMode: false,
      paidAt: new Date("2026-12-10T15:00:00Z"),
      sgo: { listSource: "provisional_curated", listStatus: "listed", portalRegistered: false, stateParticipation: "advance_election_only", listedFrom: "2027-02-01" },
      attestations: { individual: false, usCitizenOrResident: false, noEarmark: false, notInExchangeForScholarship: false },
      paymentMethod: "crypto",
      currency: "btc",
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "sandbox_mode",
      "before_credit_start",
      "state_list_not_submitted",
      "sgo_not_yet_listed",
      "sgo_list_provisional",
      "sgo_not_portal_registered",
      "attestation_individual_missing",
      "attestation_us_citizen_or_resident_missing",
      "attestation_no_earmark_missing",
      "attestation_not_in_exchange_missing",
      "payment_method_digital_asset",
      "currency_not_usd",
    ]);
    for (const blocker of result.blockers) {
      expect(blocker.message).toMatch(/^(Not (labeled )?credit-eligible|Sandbox gift)/);
      expect(blocker.authority).toBe(COPY[blocker.copyId].authority);
      expect(blocker.message).not.toMatch(/[{}]/);
    }
  });

  it("every blocker and warning code can be produced, and each has its own gate", () => {
    const paidAt = new Date("2027-03-15T17:00:00Z");
    const producing: Record<EligibilityBlockerCode, Overrides> = {
      sandbox_mode: { liveMode: false },
      before_credit_start: { paidAt: new Date("2026-12-31T23:59:59Z") },
      initiated_before_credit_start: { initiatedAt: new Date("2026-12-31T23:59:59Z") },
      state_not_participating: { sgo: { stateParticipation: "not_participating" } },
      state_list_not_submitted: { sgo: { stateParticipation: "advance_election_only" } },
      sgo_not_listed: { sgo: { listStatus: "not_listed" } },
      sgo_removed: { sgo: { listStatus: "removed", removedOn: "2027-03-01" } },
      sgo_not_yet_listed: { sgo: { listedFrom: "2027-04-01" } },
      sgo_list_provisional: { sgo: { listSource: "provisional_curated" } },
      sgo_not_portal_registered: { sgo: { portalRegistered: false } },
      attestation_individual_missing: { attestations: { individual: false } },
      attestation_us_citizen_or_resident_missing: { attestations: { usCitizenOrResident: false } },
      attestation_no_earmark_missing: { attestations: { noEarmark: false } },
      attestation_not_in_exchange_missing: { attestations: { notInExchangeForScholarship: false } },
      payment_method_digital_asset: { paymentMethod: "crypto" },
      payment_method_not_cash: { paymentMethod: "stock" },
      currency_not_usd: { currency: "eur" },
    };
    expect(Object.keys(producing).sort()).toEqual([...ELIGIBILITY_BLOCKER_CODES].sort());
    for (const code of ELIGIBILITY_BLOCKER_CODES) {
      expect(blockerCodes({ paidAt, ...producing[code] }), code).toEqual([code]);
    }

    const warning: Record<EligibilityWarningCode, Overrides> = {
      list_reliance_unavailable: { sgo: { publicListingAuthorized: false } },
      sgo_removed_after_gift: { sgo: { listStatus: "removed", removedOn: "2027-12-01" } },
      tax_year_boundary_ambiguous: { paidAt: new Date("2028-01-01T03:00:00Z"), donorTimeZone: "America/Chicago" },
    };
    expect(Object.keys(warning).sort()).toEqual([...ELIGIBILITY_WARNING_CODES].sort());
    for (const code of ELIGIBILITY_WARNING_CODES) {
      const result = assess({ paidAt, ...warning[code] });
      expect(result.warnings.map((w) => w.code), code).toEqual([code]);
      expect(result.creditEligible, code).toBe(true);
    }
  });
});

describe("determineTaxYear", () => {
  it.each([
    ["11:30 p.m. Eastern on December 31", "2028-01-01T04:30:00Z", "America/New_York", 2027, 2028, true, "2027-12-31"],
    ["one second before midnight Central", "2028-01-01T05:59:59Z", "America/Chicago", 2027, 2028, true, "2027-12-31"],
    ["midnight Central on January 1", "2028-01-01T06:00:00Z", "America/Chicago", 2028, 2028, false, "2028-01-01"],
    ["8 p.m. Hawaii on December 31", "2028-01-01T06:00:00Z", "Pacific/Honolulu", 2027, 2028, true, "2027-12-31"],
    ["6 p.m. Central on December 31, still December 31 in UTC", "2027-12-31T23:59:59Z", "America/Chicago", 2027, 2027, false, "2027-12-31"],
    ["midday in June", "2027-06-15T17:00:00Z", "America/Denver", 2027, 2027, false, "2027-06-15"],
    ["8 a.m. January 1 in Tokyo, a donor abroad", "2027-12-31T23:00:00Z", "Asia/Tokyo", 2028, 2027, true, "2028-01-01"],
    ["a donor whose zone is UTC", "2028-01-01T00:00:00Z", "UTC", 2028, 2028, false, "2028-01-01"],
    ["the last millisecond of the year in UTC", "2027-12-31T23:59:59.999Z", "UTC", 2027, 2027, false, "2027-12-31"],
  ])("%s", (_label, paidAtIso, timeZone, taxYear, utcYear, ambiguous, localDate) => {
    expect(determineTaxYear(new Date(paidAtIso), timeZone)).toEqual({
      taxYear,
      basis: "calendar_year_of_charge_in_donor_time_zone",
      timeZone,
      localDate,
      localYear: taxYear,
      utcYear,
      yearBoundaryAmbiguous: ambiguous,
    });
  });

  it("is never ambiguous away from the turn of the year, in any State's zone", () => {
    for (const timeZone of STATE_TIME_ZONES) {
      for (const iso of ["2027-01-02T00:00:00Z", "2027-03-14T09:30:00Z", "2027-11-07T08:30:00Z", "2027-12-30T23:59:59Z"]) {
        expect(determineTaxYear(new Date(iso), timeZone).yearBoundaryAmbiguous, `${timeZone} ${iso}`).toBe(false);
      }
    }
  });

  it("rejects an unknown or empty time zone and an invalid instant", () => {
    expectValidationError(() => determineTaxYear(new Date("2027-06-01T00:00:00Z"), "Mars/Olympus_Mons"), "timeZone");
    expectValidationError(() => determineTaxYear(new Date("2027-06-01T00:00:00Z"), ""), "timeZone");
    expectValidationError(() => determineTaxYear(new Date("2027-06-01T00:00:00Z"), undefined as unknown as string), "timeZone");
    expectValidationError(() => determineTaxYear(new Date(Number.NaN), "America/Chicago"));
  });

  it("is reported by assessCreditEligibility when the donor's time zone is known", () => {
    const quiet = assess({ donorTimeZone: "America/Chicago" });
    expect(quiet.taxYear).toMatchObject({ taxYear: 2027, yearBoundaryAmbiguous: false });
    expect(quiet.warnings).toEqual([]);

    const newYearsEve = assess({ paidAt: new Date("2028-01-01T03:00:00Z"), donorTimeZone: "America/Chicago" });
    expect(newYearsEve.taxYear).toMatchObject({ taxYear: 2027, utcYear: 2028, yearBoundaryAmbiguous: true });
    expect(newYearsEve.warnings.map((warning) => [warning.code, warning.authority])).toEqual([["tax_year_boundary_ambiguous", "product_policy"]]);
    expect(newYearsEve.creditEligible).toBe(true);
    expectValidationError(() => assess({ donorTimeZone: "Not/AZone" }), "timeZone");
  });
});

describe("input validation", () => {
  it.each([
    ["an invalid payment time", { paidAt: new Date("nope") }, "paidAt"],
    ["a payment time given as text", { paidAt: "2027-02-01T00:00:00Z" }, "paidAt"],
    ["an invalid start time", { initiatedAt: new Date("nope") }, "initiatedAt"],
    ["a start date in the wrong format", { creditStartDate: "January 1, 2027" }, "creditStartDate"],
    ["a start date that does not exist", { creditStartDate: "2027-02-30" }, "creditStartDate"],
    ["an unknown list source", { sgo: { listSource: "irs" } }, "sgo.listSource"],
    ["an unknown list status", { sgo: { listStatus: "pending" } }, "sgo.listStatus"],
    ["a malformed removal date", { sgo: { removedOn: "03/10/2027" } }, "sgo.removedOn"],
    ["a malformed listing date", { sgo: { listedFrom: "2027-2-1" } }, "sgo.listedFrom"],
    ["a non-boolean registration flag", { sgo: { portalRegistered: "yes" } }, "sgo.portalRegistered"],
    ["an unknown State status", { sgo: { stateParticipation: "elected" } }, "sgo.stateParticipation"],
    ["an attestation that is not a boolean", { attestations: { individual: "true" } }, "attestations.individual"],
    ["a missing attestation", { attestations: { noEarmark: undefined } }, "attestations.noEarmark"],
    ["an empty payment method", { paymentMethod: "  " }, "paymentMethod"],
    ["an empty currency", { currency: "" }, "currency"],
    ["a non-boolean mode", { liveMode: 1 }, "liveMode"],
    ["an unknown field", { donorType: "company" }, "_"],
    ["an unknown SGO field", { sgo: { ein: "00-0000000" } }, "sgo"],
  ])("rejects %s", (_label, overrides, field) => {
    expectValidationError(() => assess(overrides as unknown as Overrides), field);
  });

  it("rejects a missing argument", () => {
    expectValidationError(() => assessCreditEligibility(undefined as unknown as CreditEligibilityInput));
    expectValidationError(() => assessCreditEligibility({} as unknown as CreditEligibilityInput));
  });
});
