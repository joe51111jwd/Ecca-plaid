import { describe, expect, it } from "vitest";
import { COPY_VERSION, renderCopy } from "@/taxmath";
import { mergeCheckoutForm, parseCheckoutPatch, resolveOrder, type CheckoutForm, type CheckoutPatch } from "./form";
import { singleFilerPatch, jointPatch } from "./test-support";
import { allocateCents, buildCheckoutView, renderDeliveryConsent, renderDesignationStatement, type CheckoutContext } from "./view";

/* Synthetic organization, people and amounts. */

const BEFORE_START = new Date("2026-12-10T15:00:00.000Z");
const AFTER_START = new Date("2027-03-02T15:00:00.000Z");

function ctx(overrides: { now?: Date; mode?: "test" | "live"; list?: Partial<CheckoutContext["list"]>; fees?: Partial<CheckoutContext["settings"]["fees"]>; portalRegistered?: boolean; liveEnabled?: boolean; status?: CheckoutContext["session"]["status"] } = {}): CheckoutContext {
  const now = overrides.now ?? BEFORE_START;
  return {
    now,
    session: { id: "chk_synthetic", mode: overrides.mode ?? "test", status: overrides.status ?? "open", source: "hosted", createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000), placedAt: null, paymentId: null, orderNumber: 0 },
    sgo: { orgId: "org_synthetic", slug: "synthetic-fund", displayName: "Synthetic Scholarship Fund", legalName: "Synthetic Scholarship Fund Inc", ein: "00-1234567", state: "TX", portalRegistered: overrides.portalRegistered ?? false },
    list: { status: "provisional", source: "provisional_curated", label: "On the provisional list", entryId: "sle_synthetic", listedFrom: null, removedOn: null, retrievedAt: "2026-11-01T12:00:00.000Z", refusal: null, ...overrides.list },
    settings: {
      creditStartDate: "2027-01-01",
      liveEnabled: overrides.liveEnabled ?? false,
      fees: { active: "none", sgoFeeBps: 0, donorServiceFeeBps: 0, counselMemoRef: null, ...overrides.fees },
    },
  };
}

function formOf(patch: CheckoutPatch): CheckoutForm {
  return mergeCheckoutForm({}, parseCheckoutPatch(patch));
}

/** A form with the designation confirmed against the words the view would render. */
function confirmed(patch: CheckoutPatch, context = ctx()): CheckoutForm {
  const form = formOf(patch);
  const statement = renderDesignationStatement(resolveOrder(form), context.sgo.displayName, "en");
  return { ...form, designationConfirmedTextSha256: statement?.textSha256 ?? null };
}

describe("buildCheckoutView", () => {
  it("is ready to place for a complete single-filer sandbox form, with every required label", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx());
    expect(view.errors).toEqual({});
    expect(view.canPlaceOrder).toBe(true);
    expect(view.mode).toBe("test");
    expect(view.labels.provisionalList).toBe(renderCopy("notice.sgo_list_provisional", { platformName: "Passport" }));
    expect(view.labels.beforeCreditStart).toContain("January 1, 2027");
    expect(view.labels.proposedRules).toContain("not final");
    expect(view.labels.previewNotTaxAdvice).toBe(renderCopy("note.preview_not_tax_advice"));
    expect(view.labels.irsList).toBeNull();
    const ids = view.copy.map((c) => c.id);
    for (const id of ["notice.sgo_list_provisional", "note.preview_not_tax_advice", "note.proposed_rules_not_final", "note.before_credit_start", "designation.statement", "designation.irrevocable", "notice.no_earmark", "notice.individuals_only", "notice.no_ssn"] as const) {
      expect(ids).toContain(id);
    }
    expect(view.designation.statement?.text).toBe("I designate $1,700 of this payment to Synthetic Scholarship Fund as a qualified contribution under Internal Revenue Code section 25F.");
    expect(view.designation.statement?.copyVersion).toBe(COPY_VERSION);
    expect(view.preview?.totals.creditCents).toBe(170_000);
    expect(view.panel?.title).toBe(renderCopy("panel.title"));
    expect(view.totals).toMatchObject({ giftCents: 170_000, designatedCents: 170_000, chargedCents: 170_000, donorServiceFeeCents: 0, sgoInvoicedFeeCents: 0 });
    expect(view.fees?.lines).toEqual([expect.objectContaining({ kind: "designated_contribution", amountCents: 170_000 })]);
  });

  it("is never credit-eligible in the sandbox, and says why", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx());
    expect(view.eligibility.creditEligible).toBe(false);
    expect(view.eligibility.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["sandbox_mode", "before_credit_start", "sgo_list_provisional", "sgo_not_portal_registered"]));
    expect(view.copy.find((c) => c.placement === "eligibility")?.id).toBe("eligibility.before_credit_start_sandbox");
  });

  it("reports every missing required field", () => {
    const view = buildCheckoutView({}, ctx());
    expect(view.canPlaceOrder).toBe(false);
    expect(Object.keys(view.errors).sort()).toEqual(
      [
        "address.city",
        "address.line1",
        "address.state",
        "address.zip",
        "attestations.individual",
        "attestations.noEarmark",
        "attestations.notInExchangeForScholarship",
        "attestations.usCitizenOrResident",
        "contributors.primary.firstName",
        "contributors.primary.lastName",
        "designationConfirmed",
        "email",
        "filingStatus",
        "giftCents",
      ].sort(),
    );
    expect(view.preview).toBeNull();
    expect(view.fees).toBeNull();
  });

  it("refuses a gift below the processor minimum", () => {
    expect(buildCheckoutView(confirmed(singleFilerPatch({ giftCents: 49 })), ctx()).errors.giftCents).toMatch(/smallest gift/);
  });

  it("lapses the designation confirmation when the amount or the name changes", () => {
    const form = confirmed(singleFilerPatch());
    expect(buildCheckoutView(form, ctx()).designation.confirmed).toBe(true);
    const changed = mergeCheckoutForm(form, parseCheckoutPatch({ giftCents: 100_000 }));
    const view = buildCheckoutView(changed, ctx());
    expect(view.designation.confirmed).toBe(false);
    expect(view.errors.designationConfirmed).toBeTruthy();
    const renamed = mergeCheckoutForm(form, parseCheckoutPatch({ contributors: { primary: { firstName: "Blake" } } }));
    expect(buildCheckoutView(renamed, ctx()).designation.confirmed).toBe(true);
  });

  it("allows designating more than the cap, with the explanation, and no error", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch({ giftCents: 300_000, contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 300_000 } } })), ctx());
    expect(view.errors).toEqual({});
    expect(view.preview?.flags.overCapDesignation).toBe(true);
    expect(view.copy.map((c) => c.id)).toEqual(expect.arrayContaining(["note.over_cap_designation", "designation.deposit_regardless"]));
    expect(view.preview?.totals.creditCents).toBe(170_000);
    expect(view.preview?.totals.overCapCents).toBe(130_000);
  });

  it("explains, and blocks, a non-designated part this checkout cannot collect", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch({ giftCents: 200_000 })), ctx());
    expect(view.order.contributors[0]).toMatchObject({ designatedCents: 170_000, nonDesignatedCents: 30_000 });
    expect(view.errors["contributors.primary.designatedCents"]).toMatch(/\$300 of this gift is not designated/);
    expect(view.capabilities.nonDesignatedCollectible).toBe(false);
    expect(view.copy.map((c) => c.id)).toContain("designation.non_designated_remainder");
    expect(view.copy.map((c) => c.id)).toContain("designation.default_explained");
  });

  it("refuses organization names on the individuals-only checkout", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch({ contributors: { primary: { firstName: "Synthetic", lastName: "Holdings LLC" } } })), ctx());
    expect(view.errors["contributors.primary.lastName"]).toMatch(/organization/);
  });

  it("shows a donor service fee as its own line on top, never touching the designated amount", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx({ fees: { active: "donor_service_fee", donorServiceFeeBps: 100, counselMemoRef: "MEMO-SYNTHETIC-1" } }));
    expect(view.totals).toMatchObject({ designatedCents: 170_000, donorServiceFeeCents: 1_700, chargedCents: 171_700, depositedTo25fAccountCents: 170_000 });
    expect(view.fees?.lines.map((l) => [l.kind, l.amountCents])).toEqual([
      ["designated_contribution", 170_000],
      ["donor_service_fee", 1_700],
    ]);
    expect(view.preview?.totals.donorServiceFeeCents).toBe(1_700);
    expect(view.copy.map((c) => c.id)).toEqual(expect.arrayContaining(["fee.donor_service_fee.donor", "note.fee_not_part_of_contribution"]));
  });

  it("charges only the gift under sgo_invoiced and reports the separately invoiced fee", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx({ fees: { active: "sgo_invoiced", sgoFeeBps: 150, counselMemoRef: "MEMO-SYNTHETIC-2" } }));
    expect(view.totals).toMatchObject({ chargedCents: 170_000, sgoInvoicedFeeCents: 2_550, donorServiceFeeCents: 0 });
  });

  it("opens the credit-eligible path only when every gate passes (live, IRS list, registered, after the start)", () => {
    const live = ctx({ now: AFTER_START, mode: "live", liveEnabled: true, portalRegistered: true, list: { status: "irs_listed", source: "irs_published", label: "On the IRS SGO list as of March 1, 2027", retrievedAt: "2027-03-01T12:00:00.000Z" } });
    const view = buildCheckoutView(confirmed(singleFilerPatch(), live), live);
    expect(view.errors).toEqual({});
    expect(view.eligibility.creditEligible).toBe(true);
    expect(view.labels.provisionalList).toBeNull();
    expect(view.labels.irsList).toContain("March 1, 2027");
    expect(view.labels.beforeCreditStart).toBeNull();
    expect(view.copy.map((c) => c.id)).toContain("notice.list_reliance");

    const unregistered = { ...live, sgo: { ...live.sgo, portalRegistered: false } };
    expect(buildCheckoutView(confirmed(singleFilerPatch(), unregistered), unregistered).eligibility.blockers.map((b) => b.code)).toEqual(["sgo_not_portal_registered"]);

    const missingAttestation = mergeCheckoutForm(confirmed(singleFilerPatch(), live), parseCheckoutPatch({ attestations: { noEarmark: false } }));
    const blocked = buildCheckoutView(missingAttestation, live);
    expect(blocked.eligibility.blockers.map((b) => b.code)).toEqual(["attestation_no_earmark_missing"]);
    expect(blocked.errors["attestations.noEarmark"]).toBeTruthy();
  });

  it("blocks a live checkout once live gifts are switched off", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx({ mode: "live", liveEnabled: false }));
    expect(view.errors.mode).toMatch(/not being accepted/);
  });

  it("blocks an SGO the list now refuses, with the list's own words", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx({ list: { status: "removed", removedOn: "2026-12-01", refusal: { reason: "sgo_removed", message: "Removed from the provisional list effective December 1, 2026. A gift to this organization cannot be accepted." } } }));
    expect(view.errors.sgo).toMatch(/Removed/);
    expect(view.eligibility.blockers.map((b) => b.code)).toContain("sgo_removed");
    expect(view.canPlaceOrder).toBe(false);
  });

  it("builds the joint designation, joint copy and one consent per spouse", () => {
    const view = buildCheckoutView(confirmed(jointPatch()), ctx());
    expect(view.errors).toEqual({});
    expect(view.designation.statement?.id).toBe("designation.statement_joint");
    expect(view.designation.statement?.text).toBe(
      "This payment is made on behalf of both spouses. Jordan Testperson designates $1,700 and Riley Testperson designates $1,700 of this payment to Synthetic Scholarship Fund as qualified contributions under Internal Revenue Code section 25F.",
    );
    expect(view.copy.map((c) => c.id)).toEqual(expect.arrayContaining(["joint.split_instruction", "joint.both_names", "joint.separate_acknowledgments", "joint.even_split_default"]));
    expect(view.attestations.map((a) => a.key)).toContain("jointOnBehalfOfBoth");
    expect(view.consents.map((c) => [c.key, c.email, c.given])).toEqual([
      ["primary", "couple@synthetic.example", false],
      ["spouse", "riley@synthetic.example", false],
    ]);
    expect(view.preview?.totals.creditCents).toBe(340_000);
  });

  it("requires the joint attestation and both names when both spouses give", () => {
    const view = buildCheckoutView(confirmed(jointPatch({ attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true }, contributors: { primary: { firstName: "Jordan", lastName: "Testperson" } } })), ctx());
    expect(view.errors["attestations.jointOnBehalfOfBoth"]).toBeTruthy();
    expect(view.errors["contributors.spouse.firstName"]).toBeTruthy();
    expect(view.designation.statement).toBeNull();
  });

  it("marks a consent given only for the exact words rendered for that address", () => {
    const form = confirmed(singleFilerPatch());
    const rendered = renderDeliveryConsent({ email: "donor@synthetic.example" }, "Synthetic Scholarship Fund", "en");
    const given = { ...form, contributors: { primary: { ...form.contributors?.primary, eDeliveryConsentTextSha256: rendered?.textSha256 } } };
    expect(buildCheckoutView(given, ctx()).consents[0].given).toBe(true);
    const moved = { ...given, email: "new@synthetic.example" };
    expect(buildCheckoutView(moved, ctx()).consents[0].given).toBe(false);
  });

  it("reports a non-editable checkout", () => {
    const view = buildCheckoutView(confirmed(singleFilerPatch()), ctx({ status: "completed" }));
    expect(view.capabilities.editable).toBe(false);
    expect(view.canPlaceOrder).toBe(false);
  });
});

describe("allocateCents", () => {
  it.each([
    [1_701, [170_001, 170_000], [851, 850]],
    [1, [1, 1], [1, 0]],
    [0, [5, 5], [0, 0]],
    [10, [0, 0], [10, 0]],
    [100, [1, 2, 3], [17, 33, 50]],
  ])("splits %i over %j exactly", (total, weights, expected) => {
    const parts = allocateCents(total, weights);
    expect(parts).toEqual(expected);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
  });
});
