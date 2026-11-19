import { describe, expect, it } from "vitest";
import { FIELD_ORDER } from "./form-state";
import { blockingProblems, CHECKOUT_STEPS, firstStepWithProblems, isCheckoutStep, nextStep, parseStep, previousStep, problemsByStep, stepIndex, stepOfPath, stepSearch, STEP_LABELS, STEP_TITLES } from "./steps";

const single = { jointShares: false };
const joint = { jointShares: true };

describe("parseStep", () => {
  it("accepts the four steps", () => {
    for (const step of CHECKOUT_STEPS) expect(parseStep(step)).toBe(step);
  });

  it("falls back to the first step for anything else", () => {
    for (const raw of [null, undefined, "", "GIFT", "payment", " gift", "review ", "__proto__", "toString"]) expect(parseStep(raw)).toBe("gift");
  });

  it("isCheckoutStep rejects non-strings", () => {
    expect(isCheckoutStep(1)).toBe(false);
    expect(isCheckoutStep({})).toBe(false);
    expect(isCheckoutStep("confirm")).toBe(true);
  });
});

describe("step order", () => {
  it("moves forward and back and stops at the ends", () => {
    expect(nextStep("gift")).toBe("about");
    expect(nextStep("confirm")).toBe("review");
    expect(nextStep("review")).toBeNull();
    expect(previousStep("gift")).toBeNull();
    expect(previousStep("review")).toBe("confirm");
    expect(CHECKOUT_STEPS.map(stepIndex)).toEqual([0, 1, 2, 3]);
  });

  it("names every step", () => {
    for (const step of CHECKOUT_STEPS) {
      expect(STEP_LABELS[step].length).toBeGreaterThan(0);
      expect(STEP_TITLES[step].length).toBeGreaterThan(0);
    }
  });
});

describe("stepOfPath", () => {
  it("puts the amount and the designated amount on the gift step for one donor", () => {
    expect(stepOfPath("giftCents", single)).toBe("gift");
    expect(stepOfPath("contributors.primary.designatedCents", single)).toBe("gift");
  });

  it("moves each spouse's designated amount to About you when both spouses give", () => {
    expect(stepOfPath("contributors.primary.designatedCents", joint)).toBe("about");
    expect(stepOfPath("contributors.spouse.designatedCents", joint)).toBe("about");
    expect(stepOfPath("contributors.spouse.giftCents", joint)).toBe("about");
  });

  it("puts identity, address, State credit and the refinements on About you", () => {
    for (const path of [
      "filingStatus",
      "bothSpousesContribute",
      "email",
      "address.line1",
      "address.zip",
      "liability.estimatedTaxCents",
      "liability",
      "contributors.primary.firstName",
      "contributors.spouse.lastName",
      "contributors.spouse.email",
      "contributors.primary.expectedStateCreditCents",
      "contributors.primary.otherQualifiedContributionsCents",
    ]) {
      expect(stepOfPath(path, single)).toBe("about");
    }
  });

  it("puts the confirmations on Confirm", () => {
    for (const path of ["attestations.individual", "attestations.jointOnBehalfOfBoth", "designationConfirmed", "contributors.primary.eDeliveryConsent", "contributors.spouse.eDeliveryConsent"]) {
      expect(stepOfPath(path, joint)).toBe("confirm");
    }
  });

  it("sends anything that is not a field of the form to Review", () => {
    for (const path of ["session", "sgo", "mode", "donorTimeZone", "", "contributors", "contributors.primary", "contributors.third.firstName", "contributors.primary.unknown", "giftCents2"]) {
      expect(stepOfPath(path, single)).toBe("review");
    }
  });

  it("places every field the form orders on a form step, never on Review", () => {
    for (const path of FIELD_ORDER) expect(stepOfPath(path, single)).not.toBe("review");
  });
});

describe("problemsByStep", () => {
  const errors = {
    "attestations.noEarmark": "Confirm the gift is not earmarked.",
    "address.zip": "Enter a ZIP code.",
    giftCents: "Enter the amount of your gift.",
    session: "This checkout has expired.",
    "address.line1": "Enter a street address.",
  };

  it("groups by step in field order", () => {
    const grouped = problemsByStep(errors, single);
    expect(grouped.gift.map((e) => e.path)).toEqual(["giftCents"]);
    expect(grouped.about.map((e) => e.path)).toEqual(["address.line1", "address.zip"]);
    expect(grouped.confirm.map((e) => e.path)).toEqual(["attestations.noEarmark"]);
    expect(grouped.review).toEqual([{ path: "session", message: "This checkout has expired." }]);
  });

  it("finds the first step with a problem", () => {
    expect(firstStepWithProblems(errors, single)).toBe("gift");
    expect(firstStepWithProblems({ designationConfirmed: "x" }, single)).toBe("confirm");
    expect(firstStepWithProblems({ mode: "x" }, single)).toBe("review");
    expect(firstStepWithProblems({}, single)).toBeNull();
  });

  it("follows the joint layout", () => {
    expect(firstStepWithProblems({ "contributors.spouse.designatedCents": "x" }, joint)).toBe("about");
    expect(firstStepWithProblems({ "contributors.spouse.designatedCents": "x" }, single)).toBe("gift");
  });
});

describe("blockingProblems", () => {
  const errors = { giftCents: "Enter the amount.", "contributors.primary.designatedCents": "$1,700 of this gift is not designated.", "address.zip": "Enter a ZIP code." };

  it("holds the gift step on every problem once a filing status is chosen", () => {
    expect(blockingProblems("gift", errors, { jointShares: false, filingStatusChosen: true }).map((p) => p.path)).toEqual(["giftCents", "contributors.primary.designatedCents"]);
  });

  it("lets a donor past the designated amount before choosing a filing status (a joint gift moves it to About you)", () => {
    expect(blockingProblems("gift", errors, { jointShares: false, filingStatusChosen: false }).map((p) => p.path)).toEqual(["giftCents"]);
    expect(blockingProblems("gift", { "contributors.primary.designatedCents": "x" }, { jointShares: false, filingStatusChosen: false })).toEqual([]);
  });

  it("only relaxes the gift step", () => {
    expect(blockingProblems("about", errors, { jointShares: false, filingStatusChosen: false }).map((p) => p.path)).toEqual(["address.zip"]);
    expect(blockingProblems("about", { "contributors.spouse.designatedCents": "x" }, { jointShares: true, filingStatusChosen: false }).map((p) => p.path)).toEqual(["contributors.spouse.designatedCents"]);
  });
});

describe("stepSearch", () => {
  it("sets the step and keeps other parameters", () => {
    expect(stepSearch("", "about")).toBe("?step=about");
    expect(stepSearch("?step=gift", "confirm")).toBe("?step=confirm");
    expect(stepSearch("?utm_source=mail&step=gift", "review")).toBe("?utm_source=mail&step=review");
    expect(stepSearch("lang=es", "gift")).toBe("?lang=es&step=gift");
  });

  it("collapses a repeated step parameter", () => {
    expect(stepSearch("?step=gift&step=review", "about")).toBe("?step=about");
  });
});
