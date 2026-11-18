/**
 * Businesses (camps, schools, other vendors) that install the point-of-booking handoff, and their partnerships with
 * SGOs. The public API of src/server/businesses.
 *
 * The business is the customer for the handoff: contract, branding and the success fee sit with the business, never
 * with the family, and the fee is never taken from scholarship funds. Mutations take a `BusinessActor` and check it
 * themselves; reads take an explicit org scope and callers guard access first. Every mutation is audited in the same
 * transaction.
 */
export { businessSystemActor, isBusinessSystemActor, MANAGE_ROLE, type BusinessActor, type BusinessSystemActor, type BusinessUserActor } from "./access";
export { describeFeeTerms, FAMILY_AND_SCHOLARSHIP_PROTECTION, formatBps, SUCCESS_FEE_LIMITS, type SuccessFeeTerms } from "./fees";
export {
  createBusiness,
  getBusinessByPublishableKey,
  getBusinessProfile,
  newPublishableKey,
  PUBLISHABLE_KEY_PATTERN,
  publishableKeyMode,
  publishableKeyModeOf,
  resolvePublishableKey,
  rotatePublishableKey,
  setSuccessFee,
  updateBusinessProfile,
  type BusinessProfile,
  type BusinessProfilePatch,
  type BusinessRecord,
  type CreateBusinessInput,
  type PublicBusiness,
} from "./profiles";
export {
  assertActivePartnership,
  endPartnership,
  getActivePartnerSgos,
  listPartnershipsForBusiness,
  listPartnershipsForSgo,
  requestPartnership,
  respondToPartnership,
  type PartnerSgo,
  type Partnership,
  type PartnershipStatus,
  type PartnershipSummary,
} from "./partnerships";
export {
  checkBrandColor,
  checkWebUrl,
  contrastWithWhite,
  darkenForWhiteText,
  HOLD_WINDOW_HOURS,
  isAllowedOrigin,
  isAllowedReturnUrl,
  isVendorType,
  MAX_ALLOWED_ORIGINS,
  MAX_RETURN_URL_LENGTH,
  MIN_BRAND_CONTRAST_RATIO,
  normalizeOrigin,
  normalizeOriginList,
  relativeLuminance,
  VENDOR_TYPES,
  vendorTypeLabel,
  type BrandColorCheck,
  type OriginCheck,
} from "./validation";
