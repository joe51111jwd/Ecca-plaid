/**
 * The family intake flow as pure data: which screens exist, where each one lives, which screen the family may
 * see right now and where to send them otherwise. The order is always derived from the server's view of the
 * verification (getFamilyView + the household), never from anything the browser says.
 */
import type { PathPreference, VerificationStage, VerificationStatus } from "@/db/schema";

/* ------------------------------------------------------------------------------------------- screens */

export const SCREENS = ["reuse", "consent", "address", "county", "people", "custody", "path", "upload", "connect", "statement", "review", "status"] as const;
export type Screen = (typeof SCREENS)[number];

export function isScreen(value: unknown): value is Screen {
  return typeof value === "string" && (SCREENS as readonly string[]).includes(value);
}

/** The five steps shown in the progress bar. */
export const STEPPER_STEPS = ["consent", "household", "proof", "review", "result"] as const;
export type StepperStep = (typeof STEPPER_STEPS)[number];

export function stepperStepOf(screen: Screen): StepperStep {
  switch (screen) {
    case "reuse":
    case "consent":
      return "consent";
    case "address":
    case "county":
    case "people":
    case "custody":
      return "household";
    case "path":
    case "upload":
    case "connect":
    case "statement":
      return "proof";
    case "review":
      return "review";
    case "status":
      return "result";
  }
}

/* ---------------------------------------------------------------------------------------------- paths */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFICATION_ID_PATTERN = /^ver_[0-9A-Za-z]{1,64}$/;

export type Surface = "page" | "embed";

/**
 * Where a flow lives. A verification link (`/v/{token}`), the same link inside a partner's iframe
 * (`/embed/verify/{token}`), or a signed-in family member opening a verification by id from their household page
 * or an email (`/family/verifications/{id}`).
 */
export type FlowAddress = { kind: "token"; token: string; surface: Surface } | { kind: "id"; verificationId: string };

export function isFamilyToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function isVerificationId(value: unknown): value is string {
  return typeof value === "string" && VERIFICATION_ID_PATTERN.test(value);
}

export function surfaceOf(address: FlowAddress): Surface {
  return address.kind === "token" ? address.surface : "page";
}

/** The path every screen of this flow hangs off. The token path is also the landing page. */
export function basePath(address: FlowAddress): string {
  if (address.kind === "id") return `/family/verifications/${address.verificationId}`;
  return address.surface === "embed" ? `/embed/verify/${address.token}` : `/v/${address.token}`;
}

/**
 * Reads a base path posted back by a form. Anything that is not exactly one of the three shapes is refused, so a
 * redirect built from it can never leave the app or point at another kind of page.
 */
export function parseBasePath(value: unknown): FlowAddress | null {
  if (typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts[0] !== "") return null;
  if (parts.length === 3 && parts[1] === "v" && isFamilyToken(parts[2])) return { kind: "token", token: parts[2], surface: "page" };
  if (parts.length === 4 && parts[1] === "embed" && parts[2] === "verify" && isFamilyToken(parts[3])) return { kind: "token", token: parts[3], surface: "embed" };
  if (parts.length === 4 && parts[1] === "family" && parts[2] === "verifications" && isVerificationId(parts[3])) return { kind: "id", verificationId: parts[3] };
  return null;
}

/** `{base}/{screen}` with an optional query (values are encoded; empty values are dropped). */
export function screenHref(base: string, screen: Screen, query: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const s = q.toString();
  return `${base}/${screen}${s ? `?${s}` : ""}`;
}

/* ------------------------------------------------------------------------------------------ the state */

export type FamilyStepName = "consent" | "household" | "evidence" | "waiting" | "outcome" | "closed";

export interface HouseholdProgress {
  hasAddress: boolean;
  hasCounty: boolean;
  /** The household owner's own row exists (they told us their name). */
  hasOwner: boolean;
  studentCount: number;
}

/** What the server says about the verification, reduced to what decides the screen. */
export interface FlowState {
  currentStep: FamilyStepName;
  status: VerificationStatus;
  stage: VerificationStage;
  canEdit: boolean;
  /** getFamilyView offered an earlier result that can be reused. */
  hasReusable: boolean;
  pathPreference: PathPreference | null;
  /** Documents still on file plus data connections that are working or done. */
  evidenceCount: number;
  household: HouseholdProgress;
}

export interface FlowViewInput {
  currentStep: FamilyStepName;
  status: VerificationStatus;
  stage: VerificationStage;
  canEdit: boolean;
  reusableResult: unknown;
  pathPreference: PathPreference | null;
  documents: ReadonlyArray<{ state: string }>;
  rails: ReadonlyArray<{ status: string }>;
}

export interface FlowHouseholdInput {
  address: unknown;
  county: unknown;
  members: ReadonlyArray<{ isOwner: boolean; kind: string }>;
}

const GONE_DOCUMENT_STATES: ReadonlySet<string> = new Set(["removed", "deleted_after_decision"]);
const COUNTING_RAIL_STATUSES: ReadonlySet<string> = new Set(["connecting", "connected", "syncing", "ready"]);

export function flowStateOf(view: FlowViewInput, household: FlowHouseholdInput): FlowState {
  return {
    currentStep: view.currentStep,
    status: view.status,
    stage: view.stage,
    canEdit: view.canEdit,
    hasReusable: view.reusableResult !== null && view.reusableResult !== undefined,
    pathPreference: view.pathPreference,
    evidenceCount: view.documents.filter((d) => !GONE_DOCUMENT_STATES.has(d.state)).length + view.rails.filter((r) => COUNTING_RAIL_STATUSES.has(r.status)).length,
    household: {
      hasAddress: Boolean(household.address),
      hasCounty: Boolean(household.county),
      hasOwner: household.members.some((m) => m.isOwner),
      studentCount: household.members.filter((m) => m.kind === "student").length,
    },
  };
}

/* ---------------------------------------------------------------------------------------- the rules */

function householdScreen(h: HouseholdProgress): Screen {
  if (!h.hasAddress) return "address";
  if (!h.hasCounty) return "county";
  if (!h.hasOwner || h.studentCount === 0) return "people";
  return "custody";
}

/** Where the family should be right now. */
export function defaultScreen(state: FlowState): Screen {
  if (state.currentStep === "closed" || state.currentStep === "waiting" || state.currentStep === "outcome") return "status";
  if (state.stage === "awaiting_family") return "status";
  if (state.currentStep === "consent") return state.hasReusable ? "reuse" : "consent";
  if (state.currentStep === "household") return householdScreen(state.household);
  if (!state.pathPreference) return "path";
  if (state.evidenceCount > 0) return "review";
  return state.pathPreference === "auto_submit" ? "connect" : "upload";
}

/** Whether the family may open this screen now. Anything else is sent to `defaultScreen`. */
export function isScreenAllowed(screen: Screen, state: FlowState): boolean {
  const h = state.household;
  const householdEditable = state.canEdit && (state.currentStep === "household" || state.currentStep === "evidence");
  switch (screen) {
    case "status":
      return true;
    case "reuse":
      return state.hasReusable && state.canEdit;
    case "consent":
      return state.currentStep === "consent";
    case "address":
      return householdEditable;
    case "county":
      return householdEditable && h.hasAddress;
    case "people":
      return householdEditable && h.hasAddress && h.hasCounty;
    case "custody":
      return householdEditable && h.hasAddress && h.hasCounty && h.hasOwner && h.studentCount > 0;
    case "path":
    case "upload":
    case "connect":
    case "statement":
    case "review":
      return state.currentStep === "evidence" && state.canEdit;
  }
}

export type ScreenDecision = { screen: Screen; redirect: false } | { screen: Screen; redirect: true };

/** The screen to render for a request, or where to redirect when the request is not allowed (or unknown). */
export function resolveScreen(requested: string | null | undefined, state: FlowState): ScreenDecision {
  if (requested && isScreen(requested) && isScreenAllowed(requested, state)) return { screen: requested, redirect: false };
  return { screen: defaultScreen(state), redirect: true };
}

/** The screen behind the "Back" link, if there is a sensible one the family is allowed to open. */
export function previousScreen(screen: Screen, state: FlowState): Screen | null {
  const candidates: Record<Screen, Screen | null> = {
    reuse: null,
    consent: null,
    address: null,
    county: "address",
    people: state.household.hasCounty ? "address" : null,
    custody: "people",
    path: "custody",
    upload: "path",
    connect: "path",
    statement: "upload",
    review: state.pathPreference === "auto_submit" ? "connect" : "upload",
    status: null,
  };
  const prev = candidates[screen];
  return prev && isScreenAllowed(prev, state) ? prev : null;
}

/* ---------------------------------------------------------------------------------- household guard */

export interface HouseholdSnapshotLike {
  size: number;
  countyFips: string;
  studentMemberIds: readonly string[];
}

export interface CurrentHouseholdLike {
  size: number;
  countyFips: string | null;
  studentIds: readonly string[];
}

/**
 * True when the household was changed after its facts were confirmed for this verification (the living-arrangement
 * step snapshots them). The family must confirm again before sending, so a stale size or county is never used.
 */
export function householdChangedSinceSnapshot(snapshot: HouseholdSnapshotLike | null, current: CurrentHouseholdLike): boolean {
  if (!snapshot) return false;
  if (snapshot.size !== current.size) return true;
  if (snapshot.countyFips !== current.countyFips) return true;
  return snapshot.studentMemberIds.some((id) => !current.studentIds.includes(id));
}
