/**
 * Loads everything a family screen needs, in one place, through the services' public APIs: the link's state, the
 * signed-in person, the family view of the verification, the verification snapshot and the household. Pages call
 * this and render; they never decide anything themselves.
 */
import { cookies } from "next/headers";
import { getDictionary, LOCALE_COOKIE, pickLocale, type Dictionary, type Locale } from "@/i18n";
import { isAppError } from "@/lib/errors";
import type { User } from "@/server/auth";
import { getHousehold, type HouseholdView } from "@/server/households";
import { getFamilyVerification, getFamilyView, getVerificationByFamilyToken, type FamilyLinkState, type FamilyVerificationView, type FamilyView } from "@/server/verifications";
import { basePath, flowStateOf, surfaceOf, type FlowAddress, type FlowState, type Surface } from "../flow";
import { getFamilyUser } from "./session";

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The language for this request: `?lang=`, then the remembered choice, then the saved household language. */
export async function resolveLocale(query: SearchParams, ...fallbacks: Array<string | null | undefined>): Promise<Locale> {
  const remembered = (await cookies()).get(LOCALE_COOKIE)?.value;
  return pickLocale(firstParam(query.lang), remembered, ...fallbacks);
}

export interface FlowContext {
  address: FlowAddress;
  surface: Surface;
  base: string;
  locale: Locale;
  t: Dictionary;
  user: User;
  view: FamilyView;
  verification: FamilyVerificationView;
  household: HouseholdView;
  state: FlowState;
  /** The person is the household owner (only the owner gives consent and edits the household). */
  isOwner: boolean;
}

export type FlowLoad =
  /** The link is unknown, expired or canceled: show its state. */
  | { kind: "link"; link: Exclude<FamilyLinkState, { state: "active" }>; locale: Locale; surface: Surface; base: string; user: User | null }
  /** The link works but nobody is signed in, or the signed-in person has not started it yet (or cannot). */
  | { kind: "landing"; link: Extract<FamilyLinkState, { state: "active" }>; locale: Locale; surface: Surface; base: string; user: User | null }
  /** Opened by id without being signed in. */
  | { kind: "signed_out"; locale: Locale; base: string }
  /** Opened by id but the verification does not exist or is not this person's. */
  | { kind: "not_found"; locale: Locale }
  | { kind: "ready"; ctx: FlowContext };

async function loadView(verificationId: string, user: User): Promise<{ view: FamilyView; verification: FamilyVerificationView; household: HouseholdView } | null> {
  try {
    const [view, verification] = await Promise.all([getFamilyView(verificationId, user.id), getFamilyVerification(verificationId, { userId: user.id })]);
    const household = await getHousehold(verification.householdId, { userId: user.id });
    return { view, verification, household };
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") return null;
    throw e;
  }
}

export async function loadFlow(address: FlowAddress, query: SearchParams): Promise<FlowLoad> {
  const surface = surfaceOf(address);
  const base = basePath(address);
  const user = await getFamilyUser(surface);

  let verificationId: string;
  if (address.kind === "token") {
    const link = await getVerificationByFamilyToken(address.token);
    if (link.state !== "active") return { kind: "link", link, locale: await resolveLocale(query), surface, base, user };
    if (!user || !link.verification.started) return { kind: "landing", link, locale: await resolveLocale(query, link.verification.locale), surface, base, user };
    verificationId = link.verification.id;
    const loaded = await loadView(verificationId, user);
    if (!loaded) return { kind: "landing", link, locale: await resolveLocale(query, link.verification.locale), surface, base, user };
    return { kind: "ready", ctx: await buildContext(address, query, user, loaded) };
  }

  if (!user) return { kind: "signed_out", locale: await resolveLocale(query), base };
  const loaded = await loadView(address.verificationId, user);
  if (!loaded) return { kind: "not_found", locale: await resolveLocale(query) };
  return { kind: "ready", ctx: await buildContext(address, query, user, loaded) };
}

async function buildContext(address: FlowAddress, query: SearchParams, user: User, loaded: { view: FamilyView; verification: FamilyVerificationView; household: HouseholdView }): Promise<FlowContext> {
  const locale = await resolveLocale(query, loaded.household.locale, loaded.view.locale);
  return {
    address,
    surface: surfaceOf(address),
    base: basePath(address),
    locale,
    t: getDictionary(locale),
    user,
    view: loaded.view,
    verification: loaded.verification,
    household: loaded.household,
    state: flowStateOf(loaded.view, loaded.household),
    isOwner: loaded.household.access === "owner",
  };
}
