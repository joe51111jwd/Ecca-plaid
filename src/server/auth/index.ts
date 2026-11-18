/**
 * Accounts: passwordless sign-in, sessions and access guards. The public API of src/server/auth.
 */
export { emailAddressSchema, normalizeEmail } from "./email-address";
export { sanitizeRedirect } from "./redirect";
export {
  CODE_DIGITS,
  CODE_INVALID_MESSAGE,
  consumeCode,
  consumeToken,
  hashSignInCode,
  LINK_INVALID_MESSAGE,
  MAGIC_LINK_TTL_MINUTES,
  MAGIC_LINK_TTL_MS,
  MAX_CODE_ATTEMPTS,
  requestSignIn,
  SIGN_IN_LIMITS,
  type MagicLink,
  type RequestSignInInput,
  type RequestSignInResult,
  type SignInResult,
} from "./magic-link";
export {
  createSession,
  getSessionFromToken,
  isWellFormedSessionToken,
  purgeEndedSessions,
  revokeAllSessionsForUser,
  revokeSession,
  revokeSessionByToken,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  sessionCookieOptions,
  sessionInvalidReason,
  type CookieOptions,
  type Session,
  type SessionClientInfo,
  type User,
} from "./session";
export { clearSessionCookie, getCurrentSession, getCurrentUser, getRequestInfo, getSessionCookieToken, setSessionCookie } from "./current";
export {
  defaultLandingPath,
  ensurePlatformOrg,
  grantBootstrapPlatformAdmin,
  isBootstrapPlatformAdmin,
  isPlatformAdmin,
  PLATFORM_BOOTSTRAP_ROLE,
  PLATFORM_ORG_SLUG,
  type Membership,
  type Organization,
} from "./platform";
export {
  assertHouseholdAccess,
  assertOrgMember,
  assertPlatformAdmin,
  getMemberships,
  getPrimaryOrg,
  isMemberRole,
  MEMBER_ROLES,
  minimumRole,
  requireHouseholdAccess,
  requireOrgMember,
  requireOrgType,
  requirePlatformAdmin,
  requireUser,
  requireUserOrThrow,
  ROLE_RANK,
  roleAtLeast,
  type Household,
  type HouseholdAccess,
  type OrgAccess,
  type PrimaryOrg,
} from "./guards";
export { invitationEmailCopy, signInEmailCopy } from "./copy";
