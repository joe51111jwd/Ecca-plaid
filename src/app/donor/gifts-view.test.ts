import { describe, expect, it } from "vitest";
import type { DonorGiftGroup } from "@/server/donations";
import { renderCopy } from "@/taxmath";
import { donorPageNotes, toDonorGroupsView } from "./gifts-view";

/* SYNTHETIC donors and organizations. */

function group(overrides: Partial<DonorGiftGroup> = {}): DonorGiftGroup {
  return {
    sgo: { orgId: "org_a", name: "Synthetic Scholarship Fund", legalName: "Synthetic Scholarship Fund Inc", ein: "00-1234567" },
    donor: { id: "donor_a", fullName: "Avery Synthetic" },
    mode: "test",
    taxYear: 2026,
    designatedTotalCents: 170_000,
    donorNumber: { status: "sandbox", number: "TEST-0001", source: "sandbox_generated", assignedAt: new Date("2026-11-20T00:00:00Z"), note: renderCopy("ack.sandbox_donor_number") },
    acknowledgment: null,
    eDelivery: { consented: true, consentId: "consent_a", email: "avery@synthetic.example", withdrawnAt: null },
    gifts: [
      {
        donationId: "donation_a",
        status: "succeeded",
        designatedAt: new Date("2026-11-18T15:00:00Z"),
        contributedAt: new Date("2026-11-18T15:01:00Z"),
        designatedCents: 170_000,
        nonDesignatedCents: 0,
        serviceFeeCents: 0,
        creditEligible: false,
        creditIneligibleReason: "Sandbox gift, not credit-eligible. (stored with the gift)",
        designationText: "I designate $1,700 of this payment to Synthetic Scholarship Fund as a qualified contribution under Internal Revenue Code section 25F.",
        receiptEmailId: "email_a",
        refundedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("toDonorGroupsView", () => {
  it("shows the organization with its EIN, the donor number and its note, and the stored outcome of each gift", () => {
    const [g] = toDonorGroupsView([group()]);
    expect(g.sgo.ein).toBe("00-1234567");
    expect(g.sandbox).toBe(true);
    expect(g.donorNumber).toEqual({ number: "TEST-0001", status: "Test number", note: renderCopy("ack.sandbox_donor_number") });
    expect(g.gifts[0]).toMatchObject({ statusLabel: "Received", date: "2026-11-18T15:01:00.000Z", outcome: { creditEligible: false, text: "Sandbox gift, not credit-eligible. (stored with the gift)" } });
    expect(g.eDelivery).toEqual({ state: "consented", consentId: "consent_a", email: "avery@synthetic.example", withdrawnAt: null });
    expect(g.acknowledgment).toEqual({ statusLabel: "Not issued yet", download: null, blockedReason: null });
  });

  it("offers the issued version for download even when a later version is blocked", () => {
    const [g] = toDonorGroupsView([
      group({
        acknowledgment: {
          status: "blocked",
          acknowledgmentId: "ack_v2",
          version: 2,
          issuedAt: null,
          deliveredAt: null,
          delivery: null,
          blockedReason: "The donor number is missing.",
          pdfObjectId: null,
          needsRegeneration: true,
          issued: { acknowledgmentId: "ack_v1", version: 1, issuedAt: new Date("2027-01-20T00:00:00Z"), delivery: "email", deliveredAt: null, pdfObjectId: "obj", totalDesignatedCents: 170_000 },
        },
      }),
    ]);
    expect(g.acknowledgment.download).toEqual({ acknowledgmentId: "ack_v1", version: 1, issuedAt: "2027-01-20T00:00:00.000Z", delivery: "email" });
    expect(g.acknowledgment.blockedReason).toBe("The donor number is missing.");
  });

  it("uses the registry's words for a gift on the credit-eligible path and says nothing while it is processing", () => {
    const base = group().gifts[0];
    const [g] = toDonorGroupsView([
      group({
        gifts: [
          { ...base, donationId: "d1", creditEligible: true, creditIneligibleReason: null },
          { ...base, donationId: "d2", status: "pending", contributedAt: null },
          { ...base, donationId: "d3", creditEligible: false, creditIneligibleReason: null },
        ],
      }),
    ]);
    expect(g.gifts[0].outcome).toEqual({ creditEligible: true, text: renderCopy("receipt.credit_eligible_path") });
    expect(g.gifts[1].outcome).toBeNull();
    expect(g.gifts[1].date).toBe("2026-11-18T15:00:00.000Z");
    expect(g.gifts[2].outcome?.text).toBe(renderCopy("receipt.not_credit_eligible"));
  });

  it("reports a withdrawn consent (mailed) and no consent (mailed)", () => {
    const withdrawn = toDonorGroupsView([group({ eDelivery: { consented: false, consentId: "consent_a", email: "a@synthetic.example", withdrawnAt: new Date("2026-12-01T00:00:00Z") } })])[0];
    expect(withdrawn.eDelivery).toEqual({ state: "withdrawn", consentId: null, email: "a@synthetic.example", withdrawnAt: "2026-12-01T00:00:00.000Z" });
    const none = toDonorGroupsView([group({ eDelivery: { consented: false, consentId: null, email: null, withdrawnAt: null } })])[0];
    expect(none.eDelivery.state).toBe("none");
  });

  it("lists gifts still processing first, then newest year first, then by organization; keys are unique", () => {
    const view = toDonorGroupsView([
      group({ taxYear: 2026, sgo: { orgId: "org_b", name: "B Fund", legalName: null, ein: null } }),
      group({ taxYear: 2027 }),
      group({ taxYear: null }),
      group({ taxYear: 2026 }),
      group({ taxYear: 2026, mode: "live" }),
    ]);
    expect(view.map((g) => [g.taxYear, g.sgo.name, g.sandbox])).toEqual([
      [null, "Synthetic Scholarship Fund", true],
      [2027, "Synthetic Scholarship Fund", true],
      [2026, "B Fund", true],
      [2026, "Synthetic Scholarship Fund", false],
      [2026, "Synthetic Scholarship Fund", true],
    ]);
    expect(new Set(view.map((g) => g.key)).size).toBe(view.length);
    expect(view[2].donorNumber.number).toBe("TEST-0001");
  });

  it("handles a group with no donor number summary yet", () => {
    expect(toDonorGroupsView([group({ donorNumber: null, taxYear: null })])[0].donorNumber).toEqual({ number: null, status: "Not available yet", note: null });
  });

  it("carries what to keep and how to claim, from the registry", () => {
    expect(donorPageNotes().map((n) => n.id)).toEqual(["note.what_to_keep", "note.claim_form"]);
  });
});
