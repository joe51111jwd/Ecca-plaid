import type { DonorGiftGroup } from "@/server/donations";
import { renderCopy } from "@/taxmath";

/**
 * Shapes the signed-in donor's gifts (donations service `listGiftsForUser`) for the "My gifts" page. Pure. Tax
 * sentences come from the taxmath registry or are the ones the service stored with each gift.
 */

export interface DonorGiftView {
  donationId: string;
  /** ISO 8601: when the money was received, else when the designation was made. */
  date: string;
  status: "pending" | "succeeded" | "failed" | "canceled" | "refunded";
  statusLabel: string;
  designatedCents: number;
  nonDesignatedCents: number;
  serviceFeeCents: number;
  /** The words of the credit outcome recorded at the charge; null while the payment is being processed. */
  outcome: { creditEligible: boolean; text: string } | null;
  designationText: string;
}

export interface DonorGroupView {
  key: string;
  sandbox: boolean;
  sgo: { name: string; legalName: string | null; ein: string | null };
  donorName: string;
  taxYear: number | null;
  designatedTotalCents: number;
  donorNumber: { number: string | null; status: string; note: string | null };
  acknowledgment: {
    statusLabel: string;
    /** The version in force with the donor, for download; null until one is issued. */
    download: { acknowledgmentId: string; version: number; issuedAt: string | null; delivery: "email" | "paper_required" } | null;
    blockedReason: string | null;
  };
  eDelivery: { state: "consented" | "withdrawn" | "none"; consentId: string | null; email: string | null; withdrawnAt: string | null };
  gifts: DonorGiftView[];
}

const GIFT_STATUS: Record<DonorGiftView["status"], string> = {
  pending: "Processing",
  succeeded: "Received",
  failed: "Failed",
  canceled: "Canceled",
  refunded: "Refunded",
};

const ACK_STATUS: Record<NonNullable<DonorGiftGroup["acknowledgment"]>["status"], string> = {
  not_generated: "Not issued yet",
  draft: "Being prepared",
  issued: "Issued",
  superseded: "Replaced by a newer version",
  blocked: "Not issued yet",
};

const DONOR_NUMBER_STATUS: Record<NonNullable<DonorGiftGroup["donorNumber"]>["status"], string> = {
  assigned: "Assigned",
  sandbox: "Test number",
  pending_sgo_registration: "Not available yet",
  not_assigned: "Not available yet",
};

function giftOutcome(g: DonorGiftGroup["gifts"][number]): DonorGiftView["outcome"] {
  if (g.status === "pending") return null;
  if (g.creditEligible) return { creditEligible: true, text: renderCopy("receipt.credit_eligible_path") };
  return { creditEligible: false, text: g.creditIneligibleReason ?? renderCopy("receipt.not_credit_eligible") };
}

export function toDonorGroupsView(groups: readonly DonorGiftGroup[]): DonorGroupView[] {
  return [...groups]
    .sort((a, b) => (b.taxYear ?? Number.MAX_SAFE_INTEGER) - (a.taxYear ?? Number.MAX_SAFE_INTEGER) || a.sgo.name.localeCompare(b.sgo.name) || a.donor.fullName.localeCompare(b.donor.fullName) || a.mode.localeCompare(b.mode))
    .map((g) => {
      const issued = g.acknowledgment?.issued ?? null;
      return {
        key: `${g.sgo.orgId}|${g.donor.id}|${g.mode}|${g.taxYear ?? "pending"}`,
        sandbox: g.mode === "test",
        sgo: { name: g.sgo.name, legalName: g.sgo.legalName, ein: g.sgo.ein },
        donorName: g.donor.fullName,
        taxYear: g.taxYear,
        designatedTotalCents: g.designatedTotalCents,
        donorNumber: g.donorNumber
          ? { number: g.donorNumber.number, status: DONOR_NUMBER_STATUS[g.donorNumber.status], note: g.donorNumber.note }
          : { number: null, status: "Not available yet", note: null },
        acknowledgment: {
          statusLabel: g.acknowledgment ? ACK_STATUS[g.acknowledgment.status] : ACK_STATUS.not_generated,
          download: issued ? { acknowledgmentId: issued.acknowledgmentId, version: issued.version, issuedAt: issued.issuedAt ? issued.issuedAt.toISOString() : null, delivery: issued.delivery } : null,
          blockedReason: g.acknowledgment?.status === "blocked" ? g.acknowledgment.blockedReason : null,
        },
        eDelivery: {
          state: g.eDelivery.consented ? "consented" : g.eDelivery.withdrawnAt ? "withdrawn" : "none",
          consentId: g.eDelivery.consented ? g.eDelivery.consentId : null,
          email: g.eDelivery.email,
          withdrawnAt: g.eDelivery.withdrawnAt ? g.eDelivery.withdrawnAt.toISOString() : null,
        },
        gifts: g.gifts.map((gift) => ({
          donationId: gift.donationId,
          date: (gift.contributedAt ?? gift.designatedAt).toISOString(),
          status: gift.status,
          statusLabel: GIFT_STATUS[gift.status],
          designatedCents: gift.designatedCents,
          nonDesignatedCents: gift.nonDesignatedCents,
          serviceFeeCents: gift.serviceFeeCents,
          outcome: giftOutcome(gift),
          designationText: gift.designationText,
        })),
      };
    });
}

/** The standing sentences at the top of the page: what to keep and how the credit is claimed. */
export function donorPageNotes(): Array<{ id: string; text: string }> {
  return (["note.what_to_keep", "note.claim_form"] as const).map((id) => ({ id, text: renderCopy(id) }));
}
