import { describe, expect, it } from "vitest";
import { buildCheckoutView, type CheckoutContext, type CheckoutForm, type CheckoutView } from "@/server/donations";
import { assessCreditEligibility, getCopy, renderCopyDynamic, type CopyId, type CreditEligibilityInput } from "@/taxmath";
import { buildReview, checkoutLabels, creditBanner, directoryListNotice, FORM_BLOCKER_CODES, RECEIPT_ELIGIBILITY_FRESH_MS, STANDING_PANEL_NOTES, standingPanel, toClientView, toReceiptSummary, type CheckoutClientView } from "./view-model";

/* Every person, organization and EIN below is SYNTHETIC test data. */

const BEFORE_START = new Date("2026-11-18T15:00:00Z");
const AFTER_START = new Date("2027-03-01T15:00:00Z");

function eligibility(overrides: Partial<CreditEligibilityInput> & { sgo?: Partial<CreditEligibilityInput["sgo"]>; attestations?: Partial<CreditEligibilityInput["attestations"]> } = {}) {
  const allAttested = { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true };
  return assessCreditEligibility({
    paidAt: overrides.paidAt ?? AFTER_START,
    creditStartDate: "2027-01-01",
    paymentMethod: "card",
    currency: "usd",
    liveMode: overrides.liveMode ?? true,
    donorTimeZone: overrides.donorTimeZone ?? "America/Chicago",
    sgo: { listSource: "irs_published", listStatus: "listed", portalRegistered: true, publicListingAuthorized: true, stateParticipation: "list_submitted", ...overrides.sgo },
    attestations: { ...allAttested, ...overrides.attestations },
  });
}

function context(overrides: { now?: Date; mode?: "test" | "live"; source?: "provisional_curated" | "irs_published"; fee?: "none" | "donor_service_fee" | "sgo_invoiced"; status?: CheckoutContext["session"]["status"]; placedAt?: Date | null } = {}): CheckoutContext {
  const source = overrides.source ?? "provisional_curated";
  const at = overrides.now ?? BEFORE_START;
  return {
    now: at,
    session: {
      id: "checkout_synthetic",
      mode: overrides.mode ?? "test",
      status: overrides.status ?? "open",
      source: "hosted",
      createdAt: at,
      expiresAt: new Date(at.getTime() + 86_400_000),
      placedAt: overrides.placedAt ?? null,
      paymentId: overrides.placedAt ? "payment_synthetic" : null,
      orderNumber: overrides.placedAt ? 1 : 0,
    },
    sgo: { orgId: "org_synthetic", slug: "synthetic-fund", displayName: "Synthetic Scholarship Fund", legalName: "Synthetic Scholarship Fund Inc", ein: "00-1234567", state: "TX", portalRegistered: true },
    list: {
      status: source === "irs_published" ? "irs_listed" : "provisional",
      source,
      label: source === "irs_published" ? "On the IRS SGO list" : "On the provisional list",
      entryId: "sgolist_synthetic",
      listedFrom: "2026-11-01",
      removedOn: null,
      retrievedAt: "2027-02-20T12:00:00.000Z",
      refusal: null,
    },
    settings: {
      creditStartDate: "2027-01-01",
      liveEnabled: (overrides.mode ?? "test") === "live",
      fees: { active: overrides.fee ?? "none", sgoFeeBps: overrides.fee === "sgo_invoiced" ? 100 : 0, donorServiceFeeBps: overrides.fee === "donor_service_fee" ? 300 : 0, counselMemoRef: overrides.fee && overrides.fee !== "none" ? "MEMO-SYNTHETIC-1" : null },
    },
  };
}

const SINGLE: CheckoutForm = {
  giftCents: 170_000,
  filingStatus: "single",
  email: "avery@synthetic.example",
  address: { line1: "100 Synthetic Way", city: "Austin", state: "TX", zip: "78701" },
  contributors: { primary: { firstName: "Avery", lastName: "Synthetic" } },
  attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true },
  donorTimeZone: "America/Chicago",
};

const JOINT: CheckoutForm = {
  ...SINGLE,
  giftCents: 340_000,
  filingStatus: "married_joint",
  contributors: { primary: { firstName: "Jordan", lastName: "Testperson" }, spouse: { firstName: "Riley", lastName: "Testperson", email: "riley@synthetic.example" } },
  attestations: { ...SINGLE.attestations, jointOnBehalfOfBoth: true },
};

/** Every string the client view carries that a donor reads. */
function allClientTexts(v: CheckoutClientView): string[] {
  return [
    v.banner.title,
    ...v.banner.details,
    ...v.banner.warnings,
    ...v.list.notices.map((c) => c.text),
    ...v.panel.notes.map((c) => c.text),
    ...(v.copy.noEarmark ? [v.copy.noEarmark.text] : []),
    ...(v.copy.donorNameHelp ? [v.copy.donorNameHelp.text] : []),
    ...v.copy.notices.map((c) => c.text),
    ...v.copy.designationIntro.map((c) => c.text),
    ...v.copy.designationAmount.map((c) => c.text),
    ...v.copy.designationClosing.map((c) => c.text),
    ...v.copy.joint.map((c) => c.text),
    ...(v.designation.statement ? [v.designation.statement.text] : []),
    ...(v.review.feeExplanation ? [v.review.feeExplanation.text] : []),
    ...v.review.lines.map((l) => l.label),
  ];
}

describe("creditBanner", () => {
  it("states the sandbox and the credit start date once, then lists the remaining structural reasons, never the form confirmations", () => {
    const e = eligibility({ paidAt: BEFORE_START, liveMode: false, sgo: { listSource: "provisional_curated" }, attestations: { individual: false, noEarmark: false } });
    const banner = creditBanner(e);
    expect(banner.state).toBe("not_eligible");
    expect(banner.tone).toBe("warning");
    expect(banner.title).toBe(renderCopyDynamic("eligibility.before_credit_start_sandbox", { creditStartDate: "January 1, 2027" }));
    expect(banner.details).toEqual([renderCopyDynamic("eligibility.sgo_list_provisional")]);
    expect(banner.reasonCodes).toEqual(["sandbox_mode", "before_credit_start", "sgo_list_provisional"]);
    for (const code of banner.reasonCodes) expect(FORM_BLOCKER_CODES.has(code)).toBe(false);
  });

  it("says only 'sandbox' when the sandbox is the only thing keeping an IRS-listed gift after the start date off the credit-eligible path", () => {
    const banner = creditBanner(eligibility({ liveMode: false }));
    expect(banner).toMatchObject({ state: "sandbox_only", tone: "sandbox", details: [], reasonCodes: ["sandbox_mode"] });
    expect(banner.title).toBe(renderCopyDynamic("eligibility.sandbox_mode"));
  });

  it("is still sandbox-only when the confirmations are not ticked yet (those are shown at the fields)", () => {
    const banner = creditBanner(eligibility({ liveMode: false, attestations: { individual: false } }));
    expect(banner.state).toBe("sandbox_only");
  });

  it("lists the outstanding confirmations when nothing structural blocks a live gift", () => {
    const banner = creditBanner(eligibility({ attestations: { individual: false, notInExchangeForScholarship: false } }));
    expect(banner.state).toBe("pending_confirmations");
    expect(banner.title).toBe(renderCopyDynamic("eligibility.attestation_individual_missing"));
    expect(banner.details).toEqual([renderCopyDynamic("eligibility.attestation_not_in_exchange_missing")]);
    expect(banner.reasonCodes).toEqual([]);
  });

  it("shows the registry's cautious confirmation on the eligible path", () => {
    const banner = creditBanner(eligibility());
    expect(banner).toMatchObject({ state: "eligible", tone: "success", details: [], reasonCodes: [] });
    expect(banner.title).toBe(renderCopyDynamic("eligibility.credit_eligible"));
  });

  it("names an organization that is only on the provisional list after the start date as the reason", () => {
    const banner = creditBanner(eligibility({ sgo: { listSource: "provisional_curated" } }));
    expect(banner.state).toBe("not_eligible");
    expect(banner.title).toBe(renderCopyDynamic("eligibility.sgo_list_provisional"));
    expect(banner.details).toEqual([]);
  });

  it("names a removed organization and does not repeat the title in the details", () => {
    const banner = creditBanner(eligibility({ sgo: { listStatus: "removed", removedOn: "2027-02-01" } }));
    expect(banner.reasonCodes).toEqual(["sgo_removed"]);
    expect(banner.details).not.toContain(banner.title);
  });

  it("carries warnings (a gift in the last hours of the year) even on the eligible path", () => {
    const banner = creditBanner(eligibility({ paidAt: new Date("2027-12-31T23:30:00-06:00"), donorTimeZone: "America/Chicago" }));
    expect(banner.state).toBe("eligible");
    expect(banner.warnings).toEqual([renderCopyDynamic("eligibility.warning.year_boundary")]);
  });
});

describe("toClientView", () => {
  it("drops no sentence of the service's view: every copy item lands somewhere on the screen", () => {
    for (const [form, ctx] of [
      [{}, context()],
      [SINGLE, context()],
      [JOINT, context({ now: AFTER_START, mode: "live", source: "irs_published" })],
      [{ ...SINGLE, contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 100_000 } } }, context({ fee: "donor_service_fee" })],
    ] as Array<[CheckoutForm, CheckoutContext]>) {
      const view = buildCheckoutView(form, ctx);
      const texts = new Set(allClientTexts(toClientView(view)));
      for (const c of view.copy) {
        if (c.placement === "eligibility") continue; // stated by the banner (verified in the creditBanner tests)
        expect(texts.has(c.text), `${c.id} is missing from the client view`).toBe(true);
      }
    }
  });

  it("always carries the standing caveats in the panel, even before an amount is entered", () => {
    const client = toClientView(buildCheckoutView({}, context()));
    expect(client.panel.status).toBe("empty");
    expect(client.panel.sections).toEqual([]);
    const ids = client.panel.notes.map((n) => n.id);
    for (const id of STANDING_PANEL_NOTES) expect(ids).toContain(id);
    expect(ids).toContain("note.before_credit_start");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders standing notes verbatim from the registry (no component wording)", () => {
    const client = toClientView(buildCheckoutView(SINGLE, context()));
    for (const note of client.panel.notes) {
      expect(getCopy(note.id as CopyId).id).toBe(note.id);
    }
    const joint = client.panel.notes.find((n) => n.id === "note.joint_each_spouse");
    expect(joint?.text).toContain("each spouse who makes a qualified contribution");
  });

  it("marks the figures as an illustration before the credit start date, and as a preview after it", () => {
    expect(toClientView(buildCheckoutView(SINGLE, context())).panel.status).toBe("illustration_before_credit_start");
    expect(toClientView(buildCheckoutView(SINGLE, context({ now: AFTER_START }))).panel.status).toBe("preview");
  });

  it("splits a joint gift into one designated line per spouse that add up to the charge", () => {
    const client = toClientView(buildCheckoutView(JOINT, context()));
    expect(client.order.bothSpouses).toBe(true);
    expect(client.order.contributors.map((c) => c.heading)).toEqual([renderCopyDynamic("panel.heading.spouse_1"), renderCopyDynamic("panel.heading.spouse_2")]);
    expect(client.review.lines).toHaveLength(2);
    expect(client.review.lines.map((l) => l.amountCents)).toEqual([170_000, 170_000]);
    expect(client.review.lines[0].label).toContain("Jordan Testperson");
    expect(client.review.lines[1].label).toContain("Riley Testperson");
    expect(client.review.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(client.review.totalCents);
    expect(client.copy.joint.length).toBeGreaterThan(0);
    expect(client.attestations.map((a) => a.key)).toContain("jointOnBehalfOfBoth");
  });

  it("shows a donor service fee as its own line with the fee-structure explanation, never inside the designated line", () => {
    const view = buildCheckoutView(SINGLE, context({ fee: "donor_service_fee" }));
    const review = buildReview(view);
    const fee = review.lines.find((l) => l.kind === "donor_service_fee");
    const designated = review.lines.find((l) => l.kind === "designated_contribution");
    expect(designated?.amountCents).toBe(170_000);
    expect(fee?.amountCents).toBe(5_100);
    expect(fee?.hint).toBe(view.fees?.explanation.text);
    expect(review.totalCents).toBe(175_100);
    expect(review.feeExplanation?.id).toBe("fee.donor_service_fee.donor");
  });

  it("explains the no-fee structure even though there is no fee line", () => {
    const review = buildReview(buildCheckoutView(SINGLE, context()));
    expect(review.lines.map((l) => l.kind)).toEqual(["designated_contribution"]);
    expect(review.feeExplanation?.id).toBe("fee.none.donor");
  });

  it("puts the designation statement only in the statement (not repeated in the surrounding copy)", () => {
    const client = toClientView(buildCheckoutView(SINGLE, context()));
    expect(client.designation.statement?.text).toContain("$1,700");
    const around = [...client.copy.designationIntro, ...client.copy.designationAmount, ...client.copy.designationClosing].map((c) => c.text);
    expect(around).not.toContain(client.designation.statement?.text);
    expect(client.copy.designationClosing.map((c) => c.id)).toEqual(expect.arrayContaining(["designation.irrevocable", "designation.deposit_regardless"]));
  });

  it("explains an ordinary-gift remainder next to the designated amount", () => {
    const client = toClientView(buildCheckoutView({ ...SINGLE, contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 100_000 } } }, context()));
    expect(client.order.nonDesignatedCents).toBe(70_000);
    expect(client.copy.designationAmount.map((c) => c.id)).toContain("designation.non_designated_remainder");
    expect(client.errors["contributors.primary.designatedCents"]).toBeDefined();
  });

  it("passes the service's field errors through untouched", () => {
    const view = buildCheckoutView({}, context());
    expect(toClientView(view).errors).toEqual(view.errors);
    expect(toClientView(view).canPlaceOrder).toBe(false);
  });

  it("lifts the no-earmark notice and the name help out of the standing notices", () => {
    const client = toClientView(buildCheckoutView(SINGLE, context()));
    expect(client.copy.noEarmark?.id).toBe("notice.no_earmark");
    expect(client.copy.donorNameHelp?.id).toBe("field.donor_name.help");
    expect(client.copy.notices.map((c) => c.id)).not.toContain("notice.no_earmark");
  });

  it("echoes the donor's own tax estimate only when there is a preview", () => {
    expect(toClientView(buildCheckoutView({ liability: { estimatedTaxCents: 50_000 } }, context())).order.liability).toBeNull();
    expect(toClientView(buildCheckoutView({ ...SINGLE, liability: { estimatedTaxCents: 50_000 } }, context())).order.liability).toEqual({ estimatedTaxCents: 50_000, otherCreditsCents: 0 });
  });
});

describe("labels and directory helpers", () => {
  it("labels every filing status from the registry", () => {
    const labels = checkoutLabels("en");
    expect(labels.filingStatusOptions.map((o) => o.value)).toEqual(["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"]);
    expect(labels.filingStatusOptions.find((o) => o.value === "married_joint")?.label).toBe(renderCopyDynamic("filing_status.married_joint"));
  });

  it("labels the provisional list and says nothing for the IRS list", () => {
    expect(directoryListNotice("provisional_curated")?.id).toBe("notice.sgo_list_provisional");
    expect(directoryListNotice("irs_published")).toBeNull();
  });

  it("gives the start screen a panel with every standing caveat", () => {
    expect(standingPanel().notes.map((n) => n.id)).toEqual([...STANDING_PANEL_NOTES]);
  });
});

describe("toReceiptSummary", () => {
  function completed(placedAt: Date, now: Date, mode: "test" | "live" = "test"): CheckoutView {
    return buildCheckoutView(SINGLE, context({ now, mode, status: "completed", placedAt, source: mode === "live" ? "irs_published" : "provisional_curated" }));
  }

  it("says plainly that it is not the official acknowledgment, carries the sandbox watermark and what to keep for Form 8525", () => {
    const receipt = toReceiptSummary(completed(BEFORE_START, BEFORE_START), null, BEFORE_START);
    expect(receipt.sandbox).toBe(true);
    expect(receipt.receiptNotes.map((n) => n.id)).toEqual(["receipt.sandbox", "receipt.not_official_acknowledgment", "receipt.goods_or_services_none"]);
    expect(receipt.receiptNotes[1].text).toContain("Synthetic Scholarship Fund");
    expect(receipt.keep.map((k) => k.id)).toEqual(["note.what_to_keep", "note.claim_form", "note.claim_form_availability", "note.recordkeeping"]);
    expect(receipt.designationText).toContain("$1,700");
    expect(receipt.totalCents).toBe(170_000);
  });

  it("restates the outcome right after paying, with the reasons", () => {
    const receipt = toReceiptSummary(completed(BEFORE_START, BEFORE_START), null, new Date(BEFORE_START.getTime() + 60_000));
    expect(receipt.outcome?.creditEligible).toBe(false);
    expect(receipt.outcome?.headline.id).toBe("receipt.not_credit_eligible");
    expect(receipt.outcome?.reasons.length).toBeGreaterThan(0);
  });

  it("does not restate the outcome on a later visit", () => {
    const later = new Date(BEFORE_START.getTime() + RECEIPT_ELIGIBILITY_FRESH_MS + 1);
    expect(toReceiptSummary(completed(BEFORE_START, later), null, later).outcome).toBeNull();
  });

  it("does not restate the outcome when the credit start passed between paying and now, however soon", () => {
    const placed = new Date("2027-01-01T09:55:00Z"); // before the start has begun in every State (Hawaii)
    const now = new Date("2027-01-01T10:05:00Z");
    expect(toReceiptSummary(completed(placed, now, "live"), null, now).outcome).toBeNull();
  });

  it("does not restate the outcome for an order with no placement time or a clock that went backwards", () => {
    const view = buildCheckoutView(SINGLE, context({ status: "completed" }));
    expect(toReceiptSummary(view, null, BEFORE_START).outcome).toBeNull();
    expect(toReceiptSummary(completed(BEFORE_START, BEFORE_START), null, new Date(BEFORE_START.getTime() - 1000)).outcome).toBeNull();
  });

  it("uses the credit-eligible receipt words on the eligible path", () => {
    const receipt = toReceiptSummary(completed(AFTER_START, AFTER_START, "live"), null, AFTER_START);
    expect(receipt.sandbox).toBe(false);
    expect(receipt.receiptNotes.map((n) => n.id)).not.toContain("receipt.sandbox");
    expect(receipt.outcome).toMatchObject({ creditEligible: true, headline: { id: "receipt.credit_eligible_path" }, reasons: [] });
  });
});
