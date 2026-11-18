import type { schema } from "@/db/client";
import type { Mode } from "@/db/schema";

/**
 * The public shape of a donation: the HTTP API, webhook events (`donation.succeeded`, `donation.refunded`) and
 * exports. It carries what the designation must transmit to the SGO (payments-and-rails.md Engineering
 * Implications 45): the designation flag, the exact words, the amount, the time and the donor's identity. It never
 * carries an SSN or TIN (none is collected) or card details (none are stored).
 */

type DonationRow = typeof schema.donations.$inferSelect;
type DonorRow = typeof schema.donors.$inferSelect;

export interface ApiDonation {
  id: string;
  object: "donation";
  mode: Mode;
  status: DonationRow["status"];
  org_id: string;
  checkout_session_id: string;
  payment_id: string | null;
  taxpayer_role: DonationRow["taxpayerRole"];
  filing_status: string;
  currency: "usd";
  designated_amount_cents: number;
  non_designated_amount_cents: number;
  donor_service_fee_cents: number;
  sgo_platform_fee_cents: number;
  fee_structure: DonationRow["feeStructure"];
  designated_25f: boolean;
  designated_at: string;
  designation: { copy_id: string; copy_version: string; text: string; text_sha256: string };
  state_allocation: string;
  attestations: { individual: boolean; us_citizen_or_resident: boolean; no_earmark: boolean; not_in_exchange_for_scholarship: boolean; joint_on_behalf_of_both: boolean };
  goods_or_services: { provided: boolean; value_cents: number };
  contributed_at: string | null;
  tax_year: number | null;
  year_boundary_ambiguous: boolean;
  credit_eligible: boolean;
  credit_ineligible_reason: string | null;
  sgo_list: { status_at_gift: string | null; entry_id_at_gift: string | null };
  e_delivery_consent: boolean;
  refunded_at: string | null;
  donor: {
    id: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    suffix: string | null;
    email: string;
    address: { line1: string; line2: string | null; city: string; state: string; zip: string };
  };
  created_at: string;
  updated_at: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toApiDonation(row: DonationRow, donor: DonorRow): ApiDonation {
  if (donor.id !== row.donorId) throw new Error(`Donor ${donor.id} is not the donor of donation ${row.id}`);
  return {
    id: row.id,
    object: "donation",
    mode: row.mode,
    status: row.status,
    org_id: row.orgId,
    checkout_session_id: row.checkoutSessionId,
    payment_id: row.paymentId,
    taxpayer_role: row.taxpayerRole,
    filing_status: row.filingStatus,
    currency: "usd",
    designated_amount_cents: row.designatedAmountCents,
    non_designated_amount_cents: row.nonDesignatedAmountCents,
    donor_service_fee_cents: row.donorServiceFeeCents,
    sgo_platform_fee_cents: row.platformFeeCents,
    fee_structure: row.feeStructure,
    designated_25f: row.designated25f,
    designated_at: row.designatedAt.toISOString(),
    designation: { copy_id: row.designationCopyId, copy_version: row.designationCopyVersion, text: row.designationText, text_sha256: row.designationTextSha256 },
    state_allocation: row.stateAllocation,
    attestations: {
      individual: row.individualConfirmed,
      us_citizen_or_resident: row.usCitizenOrResidentConfirmed,
      no_earmark: row.noEarmarkConfirmed,
      not_in_exchange_for_scholarship: row.notInExchangeConfirmed,
      joint_on_behalf_of_both: row.jointOnBehalfOfBothConfirmed,
    },
    goods_or_services: { provided: row.goodsOrServicesProvided, value_cents: row.goodsOrServicesValueCents },
    contributed_at: iso(row.contributedAt),
    tax_year: row.taxYear,
    year_boundary_ambiguous: row.yearBoundaryAmbiguous,
    credit_eligible: row.creditEligible,
    credit_ineligible_reason: row.creditIneligibleReason,
    sgo_list: { status_at_gift: row.sgoListStatusAtGift, entry_id_at_gift: row.sgoListEntryIdAtGift },
    e_delivery_consent: row.eDeliveryConsentId !== null,
    refunded_at: iso(row.refundedAt),
    donor: {
      id: donor.id,
      first_name: donor.firstName,
      middle_name: donor.middleName,
      last_name: donor.lastName,
      suffix: donor.suffix,
      email: donor.email,
      address: { line1: donor.addressLine1, line2: donor.addressLine2, city: donor.city, state: donor.state, zip: donor.zip },
    },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
