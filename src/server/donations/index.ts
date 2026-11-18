/**
 * Donations: the service layer of Piece 1 (donor checkout). This file is the domain's public API.
 *
 *   const { token, view } = await startCheckout({ sgoSlug, source: "hosted" });   // view = everything the page renders
 *   let view = await saveCheckout(token, { giftCents: 170_000, filingStatus: "single", ... });
 *   view = await saveCheckout(token, { designationConfirmed: true });            // binds to the exact words shown
 *   const order = await placeOrder(token, { request });                          // donors, donations, ONE payment
 *   <PaymentForm payment={order.payment} />                                      // src/features/payments
 *   ...payments enqueues "donation.payment_updated" → this domain's handler finishes the gift
 *
 * Rules this domain enforces (docs/architecture.md "Money rules"):
 *   - All numbers, gates, fee lines and tax sentences come from src/taxmath.
 *   - The designation is recorded at the time of payment with the exact words, their version and hashes, and is
 *     irrevocable: there is no un-designate and no self-serve refund (operators only: recordOperatorRefund).
 *   - A fee is never part of, or taken from, the designated amount; under the "none" structure there is no fee.
 *   - No SSN or TIN is collected anywhere (the form schema refuses unknown fields).
 *   - Credit eligibility is re-assessed as of the charge, with a fresh SGO-list snapshot kept as reliance evidence.
 */
export {
  computeCheckoutView,
  getCheckout,
  getCheckoutPayment,
  placeOrder,
  saveCheckout,
  startCheckout,
  type CheckoutSessionRow,
  type DonationRow,
  type PlacedOrder,
  type PlaceOrderOptions,
  type StartCheckoutInput,
  type StartCheckoutResult,
} from "./checkout";
export { checkoutPatchSchema, CONTRIBUTOR_KEYS, type CheckoutForm, type CheckoutPatch, type ContributorKey, type ResolvedContributor, type ResolvedOrder } from "./form";
export {
  allocateCents,
  buildCheckoutView,
  type CheckoutContext,
  type CheckoutListContext,
  type CheckoutStatus,
  type CheckoutTotals,
  type CheckoutView,
  type CopyPlacement,
  type ViewAttestation,
  type ViewConsent,
  type ViewCopy,
} from "./view";
export { DONATION_PAYMENT_UPDATED_JOB, handleDonationPaymentUpdated } from "./payment-updated";
export { recordOperatorRefund, type OperatorRefundResult, type RecordOperatorRefundInput } from "./refunds";
export {
  DONATION_EXPORT_COLUMNS,
  donorTotalsForSgo,
  exportDonationsCsv,
  getDonationForSgo,
  listDonationsForSgo,
  listGiftsForUser,
  type DeliveryConsentRecord,
  type DonationRecord,
  type DonorGift,
  type DonorGiftGroup,
  type DonorRecord,
  type DonorTotal,
  type ListDonationsParams,
  type ReadAccess,
  type SgoDonationDetail,
  type SgoDonationItem,
} from "./read";
export { toApiDonation, type ApiDonation } from "./api";
export { buildReceiptEmail, type ReceiptEmail, type ReceiptInput } from "./receipt";
export { withdrawEDeliveryConsent } from "./consents";
export * as donationsPolicy from "./policy";
