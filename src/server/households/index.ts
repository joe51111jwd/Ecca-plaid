/**
 * Households: the family's durable identity (the "passport"), the people in it, its address and Texas
 * county, shared-custody answers, and the family's privacy operations. The public API of src/server/households.
 *
 * Every function that acts for a person takes a `HouseholdActor` and checks access itself (owner, or a
 * linked adult; see HOUSEHOLD_PERMISSIONS). `getHouseholdSnapshot` and `getHouseholdSize` are for services
 * and jobs that already checked access to the household or verification.
 */
export { HOUSEHOLD_PERMISSIONS, householdCan, type HouseholdActor, type HouseholdPermission, type HouseholdRole } from "./access";
export {
  getHousehold,
  getOrCreateHouseholdForUser,
  selectCounty,
  updateAddress,
  updateHouseholdLocale,
  type GetOrCreateHouseholdResult,
  type HouseholdCountyView,
  type HouseholdLocale,
  type HouseholdView,
  type SelectCountyResult,
  type UpdateAddressResult,
} from "./households";
export {
  addMember,
  DOB_ENCRYPTION_PURPOSE,
  getHouseholdSize,
  MAX_HOUSEHOLD_MEMBERS,
  readMemberDob,
  removeMember,
  setStudents,
  updateMember,
  upsertOwnerMember,
  type HouseholdMemberView,
  type OwnerMemberInput,
} from "./members";
export { FAMILY_HOME_PATH, inviteAdult, type InviteAdultInput, type InviteAdultResult } from "./invites";
export { getHouseholdSnapshot, type HouseholdSnapshot, type SnapshotGap, type SnapshotMember, type SnapshotOptions } from "./snapshot";
export { DELETION_REQUEST_PURGE_REASON, exportHouseholdData, HOUSEHOLD_EXPORT_FORMAT, processDeletionRequest, type DeletionReport, type HouseholdExport } from "./privacy";
export {
  ADULT_MIN_AGE_YEARS,
  ageOn,
  checkDateOfBirth,
  checkPersonName,
  MAX_AGE_YEARS,
  MAX_CUSTODY_NOTES_LENGTH,
  MAX_NAME_LENGTH,
  MEMBER_KINDS,
  parseMemberInput,
  parseMemberPatch,
  personNameSchema,
  RELATIONSHIPS,
  validateCustodyInfo,
  type CustodyFlag,
  type CustodyFlagCode,
  type CustodyInput,
  type CustodyValidation,
  type MemberInput,
  type MemberPatch,
  type NormalizedAddress,
  type Relationship,
} from "./validation";
export { householdInvitationCopy, type HouseholdInvitationCopy } from "./copy";
