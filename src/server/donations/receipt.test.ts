import { describe, expect, it } from "vitest";
import { renderCopy } from "@/taxmath";
import { toApiDonation } from "./api";
import { buildReceiptEmail, type ReceiptInput } from "./receipt";

/* Synthetic organization, people and amounts. */

function input(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    mode: "live",
    sgoName: "Synthetic Scholarship Fund",
    sgoEin: "00-1234567",
    paymentId: "pay_synthetic",
    paidAt: new Date("2027-03-02T15:00:00.000Z"),
    donorTimeZone: "America/Chicago",
    donations: [{ role: "individual", fullName: "Avery Synthetic", designatedCents: 170_000, nonDesignatedCents: 0 }],
    serviceFeeCents: 0,
    chargedCents: 170_000,
    designationText: "I designate $1,700 of this payment to Synthetic Scholarship Fund as a qualified contribution under Internal Revenue Code section 25F.",
    creditEligible: true,
    blockers: [],
    ...overrides,
  };
}

describe("buildReceiptEmail", () => {
  it("is plainly a payment receipt, not the official acknowledgment", () => {
    const email = buildReceiptEmail(input());
    expect(email.subject).toBe("Payment receipt for your gift to Synthetic Scholarship Fund");
    expect(email.text).toContain(renderCopy("receipt.not_official_acknowledgment", { sgoName: "Synthetic Scholarship Fund" }));
    expect(email.text).toContain(renderCopy("receipt.credit_eligible_path"));
    expect(email.text).toContain(renderCopy("receipt.goods_or_services_none", { sgoName: "Synthetic Scholarship Fund" }));
    expect(email.text).toContain("March 2, 2027");
    expect(email.text).toContain("00-1234567");
    expect(email.text).not.toContain("Sandbox");
    expect(email.text).not.toMatch(/\bfree\b/i);
  });

  it("shows designated, non-designated and the service fee as separate lines", () => {
    const email = buildReceiptEmail(input({ donations: [{ role: "individual", fullName: "Avery Synthetic", designatedCents: 170_000, nonDesignatedCents: 30_000 }], serviceFeeCents: 2_000, chargedCents: 202_000 }));
    expect(email.text).toContain(renderCopy("fee.line.designated_contribution"));
    expect(email.text).toContain(renderCopy("fee.line.non_designated_gift"));
    expect(email.text).toContain(renderCopy("fee.line.donor_service_fee"));
    expect(email.text).toContain(renderCopy("receipt.non_designated", { nonDesignatedAmount: "$300" }));
    expect(email.text).toContain(renderCopy("receipt.service_fee", { platformName: "Passport", feeAmount: "$20" }));
    expect(email.text).toContain("$2,020.00");
  });

  it("gives the exact reasons a gift is not credit-eligible, and watermarks the sandbox", () => {
    const email = buildReceiptEmail(input({ mode: "test", creditEligible: false, blockers: [{ message: "Reason one (synthetic)." }, { message: "Reason two (synthetic)." }] }));
    expect(email.subject).toMatch(/^\[Sandbox\]/);
    expect(email.text.indexOf(renderCopy("receipt.sandbox"))).toBeGreaterThanOrEqual(0);
    expect(email.text).toContain(renderCopy("receipt.not_credit_eligible"));
    expect(email.text).toContain("Reason one (synthetic).");
    expect(email.text).toContain("Reason two (synthetic).");
    expect(email.text).not.toContain(renderCopy("receipt.credit_eligible_path"));
  });

  it("names each spouse's designated contribution on a joint gift", () => {
    const email = buildReceiptEmail(
      input({
        donations: [
          { role: "spouse_1", fullName: "Jordan Testperson", designatedCents: 170_000, nonDesignatedCents: 0 },
          { role: "spouse_2", fullName: "Riley Testperson", designatedCents: 100_000, nonDesignatedCents: 0 },
        ],
        chargedCents: 270_000,
      }),
    );
    expect(email.text).toContain("Jordan Testperson: You designated $1,700");
    expect(email.text).toContain("Riley Testperson: You designated $1,000");
  });

  it("escapes HTML in names", () => {
    const email = buildReceiptEmail(input({ sgoName: "<script>Synthetic</script>" }));
    expect(email.html).not.toContain("<script>Synthetic");
  });
});

describe("toApiDonation", () => {
  it("refuses a donor that is not the donation's", () => {
    const row = { id: "don_1", donorId: "dnr_1" } as Parameters<typeof toApiDonation>[0];
    const donor = { id: "dnr_2" } as Parameters<typeof toApiDonation>[1];
    expect(() => toApiDonation(row, donor)).toThrow(/not the donor/);
  });
});
