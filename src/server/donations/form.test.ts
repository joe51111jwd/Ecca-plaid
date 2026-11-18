import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { applyConfirmations, mergeCheckoutForm, nonIndividualNameWord, parseCheckoutPatch, parseStoredForm, resolveOrder, type CheckoutForm } from "./form";

/* All names, addresses and amounts below are synthetic. */

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("validation_failed");
    return ((e as AppError).details as { fields: Record<string, string> }).fields;
  }
  throw new Error("expected a validation error");
}

describe("parseCheckoutPatch", () => {
  it("accepts a complete form", () => {
    const parsed = parseCheckoutPatch({
      giftCents: 170_000,
      filingStatus: "single",
      email: "  Donor@Synthetic.Example ",
      address: { line1: "1 Synthetic Way", city: "Austin", state: "tx", zip: "78701-1234" },
      contributors: { primary: { firstName: "Avery", lastName: "Synthetic", eDeliveryConsent: true } },
      attestations: { individual: true },
      designationConfirmed: true,
      donorTimeZone: "America/Chicago",
    });
    expect(parsed.email).toBe("donor@synthetic.example");
    expect(parsed.address?.state).toBe("TX");
  });

  it.each([
    [{ ssn: "123-45-6789" }, "ssn"],
    [{ tin: "123456789" }, "tin"],
    [{ taxId: "123456789" }, "taxId"],
    [{ itin: "9xx" }, "itin"],
    [{ contributors: { primary: { ssn: "123-45-6789" } } }, "contributors.primary.ssn"],
    [{ contributors: { spouse: { tin: "1" } } }, "contributors.spouse.tin"],
    [{ address: { ssnLast4: "6789" } }, "address.ssnLast4"],
    [{ note: "for my niece" }, "note"],
    [{ studentName: "A. Student" }, "studentName"],
    [{ attestations: { earmarkFor: "student" } }, "attestations.earmarkFor"],
  ])("refuses fields the checkout does not define (%j): no SSN, TIN, note or student", (patch, field) => {
    const fields = fieldsOf(() => parseCheckoutPatch(patch));
    expect(fields[field]).toBe("This field is not part of the checkout.");
  });

  it.each([
    [{ giftCents: -1 }, "giftCents"],
    [{ giftCents: 10.5 }, "giftCents"],
    [{ giftCents: Number.NaN }, "giftCents"],
    [{ giftCents: "1700" }, "giftCents"],
    [{ giftCents: 1e12 }, "giftCents"],
    [{ filingStatus: "married" }, "filingStatus"],
    [{ email: "not-an-email" }, "email"],
    [{ address: { state: "PR" } }, "address.state"],
    [{ address: { zip: "7870" } }, "address.zip"],
    [{ contributors: { primary: { firstName: "12345" } } }, "contributors.primary.firstName"],
    [{ contributors: { primary: { firstName: "Av\u0000ery" } } }, "contributors.primary.firstName"],
    [{ contributors: { primary: { firstName: "x".repeat(101) } } }, "contributors.primary.firstName"],
    [{ donorTimeZone: "Mars/Olympus" }, "donorTimeZone"],
    [{ designationConfirmed: "yes" }, "designationConfirmed"],
  ])("rejects malformed values %j", (patch, field) => {
    expect(fieldsOf(() => parseCheckoutPatch(patch))[field]).toBeTruthy();
  });

  it("refuses a stored form that no longer validates", () => {
    expect(() => parseStoredForm({ ssn: "1" })).toThrow(AppError);
    expect(parseStoredForm({})).toEqual({});
  });
});

describe("mergeCheckoutForm", () => {
  const base: CheckoutForm = {
    giftCents: 100_000,
    email: "a@synthetic.example",
    address: { line1: "1 Synthetic Way", city: "Austin" },
    contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 50_000 } },
  };

  it("keeps omitted fields, clears nulls and merges nested objects field by field", () => {
    const merged = mergeCheckoutForm(base, parseCheckoutPatch({ giftCents: 200_000, address: { city: null, zip: "78701" }, contributors: { primary: { designatedCents: null } } }));
    expect(merged.giftCents).toBe(200_000);
    expect(merged.email).toBe("a@synthetic.example");
    expect(merged.address).toEqual({ line1: "1 Synthetic Way", zip: "78701" });
    expect(merged.contributors?.primary).toEqual({ firstName: "Avery", lastName: "Synthetic" });
  });

  it("does not store the consent checkbox itself (it is bound to the words in applyConfirmations)", () => {
    const merged = mergeCheckoutForm(base, parseCheckoutPatch({ contributors: { primary: { eDeliveryConsent: true } } }));
    expect(merged.contributors?.primary).not.toHaveProperty("eDeliveryConsent");
  });

  it("clears a whole section with null", () => {
    const merged = mergeCheckoutForm(base, parseCheckoutPatch({ address: null, contributors: null, giftCents: null }));
    expect(merged).toEqual({ email: "a@synthetic.example" });
  });
});

describe("applyConfirmations", () => {
  const sha = "a".repeat(64);
  const none = { primary: { requested: undefined, textSha256: null }, spouse: { requested: undefined, textSha256: null } };

  it("binds the designation confirmation to the words, and refuses it before the words exist", () => {
    expect(applyConfirmations({}, { designationConfirmed: true, designationTextSha256: sha, consents: none }).designationConfirmedTextSha256).toBe(sha);
    expect(() => applyConfirmations({}, { designationConfirmed: true, designationTextSha256: null, consents: none })).toThrow(AppError);
    expect(applyConfirmations({ designationConfirmedTextSha256: sha }, { designationConfirmed: false, designationTextSha256: sha, consents: none })).not.toHaveProperty("designationConfirmedTextSha256");
    expect(applyConfirmations({ designationConfirmedTextSha256: sha }, { designationConfirmed: undefined, designationTextSha256: "b".repeat(64), consents: none }).designationConfirmedTextSha256).toBe(sha);
  });

  it("records an e-delivery consent only with an email address to render it for", () => {
    const given = applyConfirmations({}, { designationConfirmed: undefined, designationTextSha256: null, consents: { ...none, primary: { requested: true, textSha256: sha } } });
    expect(given.contributors?.primary?.eDeliveryConsentTextSha256).toBe(sha);
    expect(() => applyConfirmations({}, { designationConfirmed: undefined, designationTextSha256: null, consents: { ...none, spouse: { requested: true, textSha256: null } } })).toThrow(AppError);
    const withdrawn = applyConfirmations(given, { designationConfirmed: undefined, designationTextSha256: null, consents: { ...none, primary: { requested: false, textSha256: sha } } });
    expect(withdrawn.contributors).toBeUndefined();
  });
});

describe("resolveOrder", () => {
  it("defaults the designation to the lesser of the gift and the per-taxpayer cap", () => {
    const small = resolveOrder({ giftCents: 50_000, filingStatus: "single" });
    expect(small.contributors).toMatchObject([{ role: "individual", giftCents: 50_000, designatedCents: 50_000, nonDesignatedCents: 0, designatedDefaulted: true }]);
    const large = resolveOrder({ giftCents: 200_000, filingStatus: "single" });
    expect(large.contributors[0]).toMatchObject({ designatedCents: 170_000, nonDesignatedCents: 30_000 });
    expect(large.errors).toEqual({});
  });

  it("does not block designating more than the cap (the reference's Examples 1 and 2 designate $2,000)", () => {
    const order = resolveOrder({ giftCents: 200_000, filingStatus: "single", contributors: { primary: { designatedCents: 200_000 } } });
    expect(order.contributors[0]).toMatchObject({ designatedCents: 200_000, nonDesignatedCents: 0, designatedDefaulted: false });
    expect(order.errors).toEqual({});
  });

  it("refuses a designated amount above the person's share", () => {
    const order = resolveOrder({ giftCents: 100_000, filingStatus: "single", contributors: { primary: { designatedCents: 100_001 } } });
    expect(order.errors["contributors.primary.designatedCents"]).toMatch(/cannot be more/);
    expect(order.contributors[0].designatedCents).toBe(100_000);
  });

  it("lets earlier qualified contributions use up the cap in the default", () => {
    const order = resolveOrder({ giftCents: 100_000, filingStatus: "single", contributors: { primary: { otherQualifiedContributionsCents: 120_000 } } });
    expect(order.contributors[0]).toMatchObject({ designatedCents: 50_000, nonDesignatedCents: 50_000 });
  });

  it("splits a joint gift evenly by default, odd cent to the first spouse", () => {
    const order = resolveOrder({ giftCents: 340_001, filingStatus: "married_joint" });
    expect(order.contributors.map((c) => [c.role, c.giftCents, c.giftDefaulted])).toEqual([
      ["spouse_1", 170_001, true],
      ["spouse_2", 170_000, true],
    ]);
    expect(order.contributors.map((c) => c.designatedCents)).toEqual([170_000, 170_000]);
  });

  it("takes an explicit amount for one spouse and gives the other the rest", () => {
    const order = resolveOrder({ giftCents: 300_000, filingStatus: "married_joint", contributors: { primary: { giftCents: 100_000 } } });
    expect(order.contributors.map((c) => c.giftCents)).toEqual([100_000, 200_000]);
    expect(order.contributors[1].giftDefaulted).toBe(true);
    const tooMuch = resolveOrder({ giftCents: 300_000, filingStatus: "married_joint", contributors: { spouse: { giftCents: 400_000 } } });
    expect(tooMuch.errors["contributors.spouse.giftCents"]).toMatch(/cannot be more/);
  });

  it("refuses explicit spouse amounts that do not add up to the gift", () => {
    const order = resolveOrder({ giftCents: 300_000, filingStatus: "married_joint", contributors: { primary: { giftCents: 100_000 }, spouse: { giftCents: 100_000 } } });
    expect(order.errors["contributors.spouse.giftCents"]).toMatch(/add up/);
  });

  it("has one contributor when only the first spouse gives", () => {
    const order = resolveOrder({ giftCents: 340_000, filingStatus: "married_joint", bothSpousesContribute: false });
    expect(order.contributors).toHaveLength(1);
    expect(order.contributors[0]).toMatchObject({ role: "spouse_1", giftCents: 340_000, designatedCents: 170_000, nonDesignatedCents: 170_000 });
  });

  it("uses the checkout email for the second spouse unless they gave their own", () => {
    const shared = resolveOrder({ giftCents: 2_000, filingStatus: "married_joint", email: "us@synthetic.example" });
    expect(shared.contributors.map((c) => c.email)).toEqual(["us@synthetic.example", "us@synthetic.example"]);
    const own = resolveOrder({ giftCents: 2_000, filingStatus: "married_joint", email: "us@synthetic.example", contributors: { spouse: { email: "two@synthetic.example" } } });
    expect(own.contributors[1].email).toBe("two@synthetic.example");
  });

  it("builds the full legal name only when first and last are present", () => {
    const order = resolveOrder({ giftCents: 1_000, filingStatus: "single", contributors: { primary: { firstName: "Avery", middleName: "Q", lastName: "Synthetic", suffix: "Jr." } } });
    expect(order.contributors[0].fullName).toBe("Avery Q Synthetic Jr.");
    expect(resolveOrder({ giftCents: 1_000, contributors: { primary: { firstName: "Avery" } } }).contributors[0].fullName).toBeNull();
  });
});

describe("nonIndividualNameWord", () => {
  it.each([
    ["Synthetic Holdings LLC", "llc"],
    ["Avery Synthetic Family Trust", "trust"],
    ["Acme, Inc.", "inc."],
    ["The Synthetic Foundation", "foundation"],
  ])("flags %s", (name, word) => expect(nonIndividualNameWord(name)).toBe(word));

  it.each(["Avery Synthetic", "Trusty Testperson", "Incorvaia Synthetic", "Jordan Co"])("does not flag %s", (name) => expect(nonIndividualNameWord(name)).toBeNull());
});
