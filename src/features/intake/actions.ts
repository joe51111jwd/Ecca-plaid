"use server";

/**
 * Server actions of the family intake screens. Each one: reads the form, finds the signed-in person for the
 * surface (page or embed), calls one service function with that person as the actor, and either redirects to the
 * next screen or returns an ActionResult in the family's language. No rule about the verification lives here: the
 * services decide, and the next page load derives the screen from the server's state again.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import type { MemberKind } from "@/db/schema";
import { getDictionary, isLocale, type Locale } from "@/i18n";
import { isAppError, type ActionResult } from "@/lib/errors";
import { audit } from "@/server/audit";
import { clearSessionCookie, consumeCode, getRequestInfo, getSessionCookieToken, requestSignIn, revokeSessionByToken, type User } from "@/server/auth";
import { revokeConsent } from "@/server/consents";
import { addMember, getOrCreateHouseholdForUser, inviteAdult, removeMember, selectCounty, updateAddress, updateMember, upsertOwnerMember } from "@/server/households";
import { completeConnection, declineConnection, getConnection, revokeConnectionsForConsent, startConnection, type RailConnectionView, type StartedConnectionView } from "@/server/rails";
import {
  completeHousehold,
  getFamilyVerification,
  recordSharingConsent,
  removeDocument,
  reuseResult,
  setPathPreference,
  signCertification,
  startVerification,
  submit,
  withdrawCertification,
  type FamilyActor,
} from "@/server/verifications";
import { failure, localizeError, type ActionFailure } from "./errors";
import { basePath, isScreen, isVerificationId, parseBasePath, screenHref, surfaceOf, type FlowAddress, type Screen } from "./flow";
import { isChecked, localeOf, parseAddressForm, parseCountyForm, parseCustodyForm, parseMemberForm, parseOwnerForm, shownSha, text } from "./form-data";
import { CONTINUE_PATH } from "./policy";
import { endEmbedSession, getFamilyUser, rememberPendingLink, setFamilySession } from "./server/session";

type Result<T = void> = ActionResult<T>;

/* ---------------------------------------------------------------------------------------- helpers */

interface ActingFamily {
  locale: Locale;
  address: FlowAddress;
  base: string;
  user: User;
  actor: FamilyActor;
  verificationId: string;
}

/** The flow the form came from and the signed-in person, or a failure to show. */
async function acting(form: FormData): Promise<ActingFamily | ActionFailure> {
  const locale = localeOf(form);
  const t = getDictionary(locale);
  const rawBase = text(form, "base");
  const address = parseBasePath(rawBase);
  const verificationId = text(form, "v");
  if (!address || !isVerificationId(verificationId)) return failure("not_found", t.errors.notFound);
  if (address.kind === "id" && address.verificationId !== verificationId) return failure("not_found", t.errors.notFound);
  const user = await getFamilyUser(surfaceOf(address));
  if (!user) return failure("unauthenticated", t.errors.signInAgain);
  return { locale, address, base: rawBase, user, actor: { userId: user.id, request: await getRequestInfo() }, verificationId };
}

function isFailure(value: unknown): value is ActionFailure {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

/** The household of the verification, as the service reports it (never an id taken from the form). */
async function householdIdOf(a: ActingFamily): Promise<string> {
  return (await getFamilyVerification(a.verificationId, a.actor)).householdId;
}

/** The screen a form asks to come back to, if it is one of ours. */
function returnScreen(form: FormData, fallback: Screen): Screen {
  const s = text(form, "screen");
  return isScreen(s) ? s : fallback;
}

/* ---------------------------------------------------------------------------------------- sign-in */

/** Step 1 of signing in from a verification link: email a 6-digit code (the email's link also works on this device). */
export async function requestCodeAction(_prev: unknown, form: FormData): Promise<Result<{ email: string }>> {
  const locale = localeOf(form);
  const t = getDictionary(locale);
  const address = parseBasePath(text(form, "base"));
  if (!address || address.kind !== "token") return failure("not_found", t.errors.notFound);
  try {
    if (address.surface === "page") await rememberPendingLink(address.token);
    const res = await requestSignIn({ email: text(form, "email"), redirectTo: CONTINUE_PATH, locale, request: await getRequestInfo() });
    return { ok: true, data: { email: res.email } };
  } catch (e) {
    if (isAppError(e) && e.code === "validation_failed") return failure(e.code, t.errors.fields.email, { email: t.errors.fields.email });
    return localizeError(e, locale);
  }
}

/** Step 2: the code. Signs in on this surface and opens the link for the person, then shows the next screen. */
export async function verifyCodeAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const locale = localeOf(form);
  const t = getDictionary(locale);
  const address = parseBasePath(text(form, "base"));
  if (!address || address.kind !== "token") return failure("not_found", t.errors.notFound);
  const request = await getRequestInfo();
  try {
    const result = await consumeCode({ email: text(form, "email"), code: text(form, "code") }, request);
    await setFamilySession(address.surface, result.sessionToken);
    await startVerification(address.token, result.user.id, { request });
  } catch (e) {
    if (isAppError(e) && (e.code === "validation_failed" || e.code === "gone") && !(e.details && typeof e.details === "object" && "reason" in e.details)) {
      return failure(e.code, t.errors.fields.code, { code: t.errors.fields.code });
    }
    // A link already used by another household (or closed meanwhile) is shown by the landing page itself.
    if (!(isAppError(e) && (e.code === "conflict" || e.code === "gone"))) return localizeError(e, locale);
  }
  redirect(langHref(basePath(address), locale));
}

/** A signed-in person opens the link ("Continue"). */
export async function startAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const locale = localeOf(form);
  const t = getDictionary(locale);
  const address = parseBasePath(text(form, "base"));
  if (!address || address.kind !== "token") return failure("not_found", t.errors.notFound);
  const user = await getFamilyUser(address.surface);
  if (!user) return failure("unauthenticated", t.errors.signInAgain);
  try {
    await startVerification(address.token, user.id, { request: await getRequestInfo() });
  } catch (e) {
    if (!(isAppError(e) && (e.code === "conflict" || e.code === "gone"))) return localizeError(e, locale);
  }
  redirect(langHref(basePath(address), locale));
}

/**
 * Signs out from a family screen ("Not you?", "Sign out" on the household page) and stays in the flow: the page
 * session (main cookie) or the embedded session (partitioned cookie) is revoked, then the person goes back to the
 * link's landing page, or to the sign-in page when there is no link.
 */
export async function familySignOutAction(form: FormData): Promise<void> {
  const address = parseBasePath(text(form, "base"));
  const locale = localeOf(form);
  let userId: string | null;
  if (address && surfaceOf(address) === "embed") {
    userId = await endEmbedSession();
  } else {
    const token = await getSessionCookieToken();
    userId = token ? ((await revokeSessionByToken(token))?.userId ?? null) : null;
    await clearSessionCookie();
  }
  if (userId) await audit({ actor: { type: "user", id: userId }, action: "auth.sign_out", target: { type: "user", id: userId }, metadata: { surface: address ? surfaceOf(address) : "page" }, request: await getRequestInfo() });
  if (address && address.kind === "token") redirect(langHref(basePath(address), locale));
  redirect(`/sign-in?signed_out=1${locale === "es" ? "&lang=es" : ""}`);
}

function langHref(path: string, locale: Locale): string {
  return locale === "es" ? `${path}${path.includes("?") ? "&" : "?"}lang=es` : path;
}

function go(a: ActingFamily, screen: Screen, query: Record<string, string> = {}): never {
  redirect(screenHref(a.base, screen, a.locale === "es" ? { ...query, lang: "es" } : query));
}

function goBase(a: ActingFamily): never {
  redirect(langHref(a.base, a.locale));
}

/* ---------------------------------------------------------------------------------------- passport */

export async function reuseAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const t = getDictionary(a.locale);
  const fields: Record<string, string> = {};
  if (!isChecked(form, "agree")) fields.agree = t.errors.consentRequired;
  if (!isChecked(form, "attest")) fields.attest = t.errors.attestRequired;
  const firstProblem = Object.values(fields)[0];
  if (firstProblem) return failure("validation_failed", firstProblem, fields);
  let outcome: "reused" | "fallback";
  try {
    const result = await reuseResult(a.verificationId, text(form, "source"), { attestsNothingChanged: true, locale: a.locale, shownSha256: shownSha(form) }, a.actor);
    outcome = result.outcome;
  } catch (e) {
    return localizeError(e, a.locale);
  }
  if (outcome === "reused") go(a, "status");
  go(a, "consent", { notice: "reuse_fallback" });
}

/* ----------------------------------------------------------------------------------------- consent */

export async function consentAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const t = getDictionary(a.locale);
  if (!isChecked(form, "agree")) return failure("validation_failed", t.errors.consentRequired, { agree: t.errors.consentRequired });
  try {
    await recordSharingConsent(a.verificationId, a.actor, { locale: a.locale, shownSha256: shownSha(form) });
  } catch (e) {
    return localizeError(e, a.locale);
  }
  goBase(a);
}

/* --------------------------------------------------------------------------------------- household */

export async function addressAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const parsed = parseAddressForm(form, a.locale);
  if (!parsed.ok) return failure("validation_failed", getDictionary(a.locale).errors.title, parsed.fields);
  let needsCounty: boolean;
  try {
    const result = await updateAddress(await householdIdOf(a), parsed.data, a.actor);
    needsCounty = result.needsSelection;
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, needsCounty ? "county" : "people");
}

export async function countyAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const parsed = parseCountyForm(form, a.locale);
  if (!parsed.ok) return failure("validation_failed", getDictionary(a.locale).errors.fields.county, parsed.fields);
  let matchesZip: boolean | null;
  try {
    matchesZip = (await selectCounty(await householdIdOf(a), parsed.data.fips, a.actor)).matchesZip;
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, "people", matchesZip === false ? { notice: "county_mismatch" } : {});
}

export async function ownerAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const parsed = parseOwnerForm(form, a.locale);
  if (!parsed.ok) return failure("validation_failed", getDictionary(a.locale).errors.title, parsed.fields);
  try {
    await upsertOwnerMember(await householdIdOf(a), parsed.data, a.actor);
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, "people");
}

export async function memberAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const parsed = parseMemberForm(form, a.locale);
  if (!parsed.ok) return failure("validation_failed", getDictionary(a.locale).errors.title, parsed.fields);
  const memberId = text(form, "memberId");
  try {
    const householdId = await householdIdOf(a);
    if (memberId) await updateMember(householdId, memberId, parsed.data, a.actor);
    else await addMember(householdId, parsed.data, a.actor);
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, "people");
}

/** Used with a confirmation dialog, so it reports problems on the page it returns to. */
export async function removeMemberAction(form: FormData): Promise<void> {
  const a = await acting(form);
  if (isFailure(a)) redirect("/family");
  let error: string | null = null;
  try {
    await removeMember(await householdIdOf(a), text(form, "memberId"), a.actor);
  } catch (e) {
    error = errorKeyOf(e);
  }
  go(a, "people", error ? { error } : {});
}

export async function custodyAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const parsed = parseCustodyForm(form, a.locale);
  if (!parsed.ok) return failure("validation_failed", getDictionary(a.locale).errors.title, parsed.fields);
  try {
    await completeHousehold(a.verificationId, a.actor, { custody: parsed.data });
  } catch (e) {
    return localizeError(e, a.locale);
  }
  goBase(a);
}

/* -------------------------------------------------------------------------------------------- path */

export async function pathAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const preference = text(form, "preference");
  if (preference !== "upload" && preference !== "auto_submit") {
    const t = getDictionary(a.locale);
    return failure("validation_failed", t.errors.fields.generic, { preference: t.errors.fields.generic });
  }
  try {
    await setPathPreference(a.verificationId, a.actor, preference);
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, preference === "upload" ? "upload" : "connect");
}

/** The "Upload documents instead" escape hatch of the connect screen: records the preference, keeps everything. */
export async function switchToUploadAction(input: { base: string; v: string; lang: string }): Promise<Result<{ href: string }>> {
  const form = new FormData();
  form.set("base", String(input?.base ?? ""));
  form.set("v", String(input?.v ?? ""));
  form.set("lang", String(input?.lang ?? ""));
  const a = await acting(form);
  if (isFailure(a)) return a;
  try {
    await setPathPreference(a.verificationId, a.actor, "upload");
  } catch (e) {
    return localizeError(e, a.locale);
  }
  return { ok: true, data: { href: screenHref(a.base, "upload", a.locale === "es" ? { lang: "es" } : {}) } };
}

/* --------------------------------------------------------------------------------------- documents */

export async function removeDocumentAction(form: FormData): Promise<void> {
  const a = await acting(form);
  if (isFailure(a)) redirect("/family");
  let error: string | null = null;
  try {
    await removeDocument(text(form, "documentId"), a.actor);
  } catch (e) {
    error = errorKeyOf(e);
  }
  go(a, returnScreen(form, "upload"), error ? { error } : {});
}

/* -------------------------------------------------------------------------------------- statements */

export async function signStatementAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  const t = getDictionary(a.locale);
  if (!isChecked(form, "agree")) return failure("validation_failed", t.statement.agreeRequired, { agree: t.statement.agreeRequired });
  const kind = text(form, "kind");
  if (kind !== "zero_income" && kind !== "no_other_income") return failure("validation_failed", t.errors.fields.generic);
  const memberId = text(form, "memberId") || null;
  try {
    await signCertification(a.verificationId, a.actor, { kind, memberId, locale: a.locale, shownSha256: shownSha(form) });
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, "upload");
}

export async function withdrawStatementAction(form: FormData): Promise<void> {
  const a = await acting(form);
  if (isFailure(a)) redirect("/family");
  let error: string | null = null;
  try {
    await withdrawCertification(text(form, "certificationId"), a.actor);
  } catch (e) {
    error = errorKeyOf(e);
  }
  go(a, returnScreen(form, "upload"), error ? { error } : {});
}

/* ------------------------------------------------------------------------------------------ submit */

export async function submitAction(_prev: unknown, form: FormData): Promise<Result<never>> {
  const a = await acting(form);
  if (isFailure(a)) return a;
  try {
    await submit(a.verificationId, a.actor);
  } catch (e) {
    return localizeError(e, a.locale);
  }
  go(a, "status");
}

/* -------------------------------------------------------------------------------------------- rail */

const railContextSchema = z.strictObject({
  base: z.string().max(200),
  v: z.string().max(128),
  lang: z.string().max(5),
});

export type RailActionContext = z.infer<typeof railContextSchema>;

async function railActing(input: unknown): Promise<ActingFamily | ActionFailure> {
  const parsed = railContextSchema.safeParse(input);
  const form = new FormData();
  if (parsed.success) {
    form.set("base", parsed.data.base);
    form.set("v", parsed.data.v);
    form.set("lang", isLocale(parsed.data.lang) ? parsed.data.lang : "en");
  }
  return acting(form);
}

const railStartSchema = z.strictObject({
  memberId: z.string().min(1).max(128),
  kind: z.enum(["payroll", "bank"]),
  shownSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Records the rail_connect consent and opens the provider for the chosen adult (RailConnect's `start`). */
export async function railStartAction(context: RailActionContext, choice: { memberId: string; kind: "payroll" | "bank" }, input: { shownSha256: string }): Promise<Result<StartedConnectionView>> {
  const a = await railActing(context);
  if (isFailure(a)) return a;
  const parsed = railStartSchema.safeParse({ memberId: choice?.memberId, kind: choice?.kind, shownSha256: input?.shownSha256 });
  if (!parsed.success) return failure("validation_failed", getDictionary(a.locale).errors.consentRequired);
  try {
    return { ok: true, data: await startConnection({ verificationId: a.verificationId, memberId: parsed.data.memberId, kind: parsed.data.kind, locale: a.locale, shownSha256: parsed.data.shownSha256 }, a.actor) };
  } catch (e) {
    return localizeError(e, a.locale);
  }
}

export async function railCompleteAction(context: RailActionContext, connectionId: string, clientResult: unknown): Promise<Result<RailConnectionView>> {
  const a = await railActing(context);
  if (isFailure(a)) return a;
  try {
    return { ok: true, data: await completeConnection(String(connectionId), clientResult, a.actor) };
  } catch (e) {
    return localizeError(e, a.locale);
  }
}

export async function railDeclineAction(context: RailActionContext, connectionId: string): Promise<Result<RailConnectionView>> {
  const a = await railActing(context);
  if (isFailure(a)) return a;
  try {
    return { ok: true, data: await declineConnection(String(connectionId), a.actor) };
  } catch (e) {
    return localizeError(e, a.locale);
  }
}

export async function railRefreshAction(context: RailActionContext, connectionId: string): Promise<Result<RailConnectionView>> {
  const a = await railActing(context);
  if (isFailure(a)) return a;
  try {
    return { ok: true, data: await getConnection(String(connectionId), a.actor) };
  } catch (e) {
    return localizeError(e, a.locale);
  }
}

/* ------------------------------------------------------------------------------------- family home */

/** Adds another adult to the household and emails them a sign-in invitation. Owner only (the service checks). */
export async function inviteAdultAction(_prev: unknown, form: FormData): Promise<Result<{ email: string }>> {
  const locale = localeOf(form);
  const t = getDictionary(locale);
  const user = await getFamilyUser("page");
  if (!user) return failure("unauthenticated", t.errors.signInAgain);
  const parsed = parseMemberForm(withKind(form, "adult"), locale);
  const email = text(form, "email").trim();
  const fields: Record<string, string> = parsed.ok ? {} : { ...parsed.fields };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = t.errors.fields.email;
  if (!parsed.ok || Object.keys(fields).length > 0) return failure("validation_failed", t.errors.title, fields);
  const actor = { userId: user.id, request: await getRequestInfo() };
  const { household } = await getOrCreateHouseholdForUser(user.id);
  let memberId: string | null = null;
  try {
    memberId = (await addMember(household.id, parsed.data, actor)).id;
    const result = await inviteAdult(household.id, { email, memberId }, actor);
    return { ok: true, data: { email: result.user.email } };
  } catch (e) {
    // Do not leave a half-added adult behind when the invitation itself was refused.
    if (memberId) await removeMember(household.id, memberId, actor).catch(() => undefined);
    if (isAppError(e) && e.code === "validation_failed" && e.details && typeof e.details === "object" && "fields" in e.details) return localizeError(e, locale);
    return localizeError(e, locale, { fallback: isAppError(e) && e.code === "conflict" ? "inviteConflict" : undefined });
  }
}

/**
 * "Take back" a permission from the household page: the consents service withdraws it (the person who gave it or the
 * owner may), then any payroll or bank connection it covered is disconnected. Reports back on the household page.
 */
export async function revokeConsentAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const lang = locale === "es" ? "&lang=es" : "";
  const user = await getFamilyUser("page");
  if (!user) redirect(`/sign-in?next=${encodeURIComponent("/family")}${lang}`);
  const actor = { userId: user.id, request: await getRequestInfo() };
  let outcome = "notice=revoked";
  try {
    const result = await revokeConsent(text(form, "consentId"), actor);
    if (result.mustStop.railConnectionIds.length > 0) await revokeConnectionsForConsent(result.mustStop.railConnectionIds, { actor });
  } catch (e) {
    outcome = `error=${errorKeyOf(e)}`;
  }
  redirect(`/family?${outcome}${lang}`);
}

function withKind(form: FormData, kind: MemberKind): FormData {
  const copy = new FormData();
  for (const [k, v] of form.entries()) copy.append(k, v);
  copy.set("kind", kind);
  return copy;
}

/** A dictionary error key for a failure shown on the page after a redirect (`?error=`). */
function errorKeyOf(e: unknown): string {
  const failed = localizeError(e, "en");
  const t = getDictionary("en").errors as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(t)) if (value === failed.error.message) return key;
  return "generic";
}
