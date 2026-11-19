/**
 * Scholarship awards: the SGO's explicit decision for an eligible student, never automatic after verification.
 * The public API of src/server/awards.
 *
 *  - offerAward (emits award.offered; moves a booking handoff to "awarded")
 *  - declineAwardForHandoff (the booking handoff becomes "declined")
 *  - updateAwardStatus (accepted / paid / revoked)
 *  - listAwards, getAwardContext (with the compliance reminders for the SGO's award screen)
 */
export {
  canChangeAwardStatus,
  declineAwardForHandoff,
  getAwardContext,
  listAwards,
  offerAward,
  updateAwardStatus,
  type AwardActor,
  type AwardContext,
  type AwardRow,
  type ListAwardsParams,
  type OfferAwardInput,
  type OfferAwardResult,
} from "./service";
export {
  AWARD_DECIDER_ROLE,
  AWARD_PAYMENT_METHODS,
  awardComplianceReminders,
  MAX_AWARD_CENTS,
  MAX_AWARD_NOTES_LENGTH,
  REASON_LENGTH,
  REVOKE_AFTER_COMPLETION_ALLOWED,
  UNSETTLED_VENDOR_TYPES,
  type AwardPaymentMethod,
  type ComplianceReminder,
} from "./policy";
