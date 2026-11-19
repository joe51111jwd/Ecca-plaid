/**
 * /family — the signed-in household page: the household, the income checks and their status, the saved result
 * ("passport") with its expiry, the permissions given (with "take back"), adding another adult, downloading the
 * household's data and signing out.
 */
import { BadgeCheck, Download, FileClock, House, KeyRound, LogOut, UserPlus, UserRound } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { FocusShell } from "@/components/layout";
import { Alert, Badge, Button, buttonClasses, ConfirmButton, LanguageToggle, SubmitButton, type Tone } from "@/components/ui";
import type { VerificationStatus } from "@/db/schema";
import { getDictionary, type Locale } from "@/i18n";
import { now } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import type { User } from "@/server/auth";
import { consentState, listConsentsForHousehold, type Consent } from "@/server/consents";
import { getOrCreateHouseholdForUser, type HouseholdView } from "@/server/households";
import { FAMILY_VERIFICATION_PATH, getFamilyView, type FamilyView } from "@/server/verifications";
import { familySignOutAction, revokeConsentAction } from "../actions";
import { languageHrefs } from "../components/flow-shell";
import { InviteAdultForm } from "../components/forms";
import { HiddenFields } from "../components/hidden-fields";
import { EXPORT_PATH } from "../policy";
import { firstParam, resolveLocale, type SearchParams } from "../server/context";
import { getFamilyUser } from "../server/session";
import { errorFromQuery, memberName } from "./shared";
import { familyDate } from "./steps";

/** Consent kinds that belong to one verification; their verification ids are the household's income checks. */
const VERIFICATION_CONSENT_KINDS: ReadonlySet<string> = new Set(["verification_share", "passport_reuse", "rail_connect"]);

const STATUS_TONE: Readonly<Record<VerificationStatus, Tone>> = {
  pending: "info",
  eligible: "success",
  ineligible: "neutral",
  needs_review: "warning",
  expired: "neutral",
  canceled: "neutral",
};

/**
 * The household's income checks, newest first. They are found through the permissions recorded for the household
 * (every check that got past the permission step has one) and each is read through getFamilyView, which checks
 * access again. A check opened but not yet given permission is not listed (see the module's known gaps).
 */
async function loadVerifications(consents: readonly Consent[], userId: string): Promise<FamilyView[]> {
  const ids: string[] = [];
  for (const c of consents) if (c.verificationId && VERIFICATION_CONSENT_KINDS.has(c.kind) && !ids.includes(c.verificationId)) ids.push(c.verificationId);
  const views = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getFamilyView(id, userId);
      } catch (e) {
        if (isAppError(e) && (e.code === "not_found" || e.code === "forbidden")) return null;
        throw e;
      }
    }),
  );
  return views.filter((v): v is FamilyView => v !== null);
}

function Panel({ icon, title, id, children }: { icon: ReactNode; title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-panel border border-line bg-surface p-5 shadow-xs sm:p-6">
      <h2 id={id} className="mb-4 flex items-center gap-2 text-lg font-semibold text-fg">
        <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full bg-brand-surface text-brand-700 [&>svg]:size-5">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function HouseholdPanel({ household, locale }: { household: HouseholdView; locale: Locale }) {
  const t = getDictionary(locale);
  const f = t.family;
  const a = household.address;
  return (
    <Panel icon={<House />} title={f.householdTitle} id="fam-household">
      {a ? (
        <p className="text-fg">
          {a.line1}
          {a.line2 ? `, ${a.line2}` : ""}, {a.city}, TX {a.zip}
          {household.county ? <span className="block text-sm text-fg-muted">{t.address.countyFound(household.county.name)}</span> : null}
        </p>
      ) : (
        <p className="text-fg-muted">{f.noAddress}</p>
      )}
      <p className="mt-4 mb-2 font-medium text-fg">{f.members(household.size)}</p>
      {household.members.length > 0 ? (
        <ul className="divide-y divide-line rounded-card border border-line">
          {household.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 p-3">
              <UserRound aria-hidden="true" className="size-5 text-fg-muted" />
              <span className="font-medium text-fg">{memberName(m)}</span>
              <span className="text-sm text-fg-muted">{t.people.kinds[m.kind].label}</span>
              {m.isOwner ? <Badge tone="brand">{t.people.youBadge}</Badge> : null}
              {m.hasSignIn && !m.isOwner ? <Badge tone="info">{f.hasSignIn}</Badge> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function VerificationsPanel({ views, locale }: { views: readonly FamilyView[]; locale: Locale }) {
  const f = getDictionary(locale).family;
  return (
    <Panel icon={<FileClock />} title={f.verificationsTitle} id="fam-checks">
      {views.length === 0 ? (
        <p className="text-fg-muted">{f.noVerifications}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {views.map((v) => {
            const href = `${FAMILY_VERIFICATION_PATH(v.verificationId)}${locale === "es" ? "?lang=es" : ""}`;
            return (
              <li key={v.verificationId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-fg">{v.orgName}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                    <Badge tone={STATUS_TONE[v.status]}>{f.statusLabels[v.status]}</Badge>
                    {v.provisional && v.outcome ? <Badge tone="caution">{getDictionary(locale).outcome.provisionalTitle}</Badge> : null}
                    {v.sandbox ? <Badge tone="caution">{f.sandboxLabel}</Badge> : null}
                  </p>
                </div>
                <Button variant={v.canEdit ? "primary" : "secondary"} href={href} className="min-h-11">
                  {v.canEdit ? f.continueCheck : f.open}
                  <span className="sr-only"> {v.orgName}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function PassportPanel({ views, locale }: { views: readonly FamilyView[]; locale: Locale }) {
  const f = getDictionary(locale).family;
  const at = now().getTime();
  // The newest eligible result that has not expired yet: what another organization could be offered to reuse.
  const saved = views.find((v) => v.outcome?.status === "eligible" && v.outcome.expiresAt && v.outcome.expiresAt.getTime() > at && !v.sandbox) ?? views.find((v) => v.outcome?.status === "eligible" && v.outcome.expiresAt && v.outcome.expiresAt.getTime() > at);
  return (
    <Panel icon={<BadgeCheck />} title={f.passportTitle} id="fam-passport">
      {saved?.outcome ? (
        <div className="space-y-2 rounded-card border border-success-line bg-success-surface p-4">
          <p className="font-medium text-fg">{f.passportBody(saved.orgName)}</p>
          {saved.outcome.expiresAt ? <p className="text-fg">{f.passportExpires(familyDate(saved.outcome.expiresAt, locale))}</p> : null}
          {saved.outcome.provisional ? <p className="text-sm text-fg-muted">{getDictionary(locale).reuse.provisional}</p> : null}
        </div>
      ) : (
        <p className="text-fg-muted">{f.noPassport}</p>
      )}
    </Panel>
  );
}

function ConsentsPanel({ consents, views, locale, userId, isOwner }: { consents: readonly Consent[]; views: readonly FamilyView[]; locale: Locale; userId: string; isOwner: boolean }) {
  const t = getDictionary(locale);
  const f = t.family;
  const at = now();
  const active = consents.filter((c) => consentState(c, at) === "active" && c.kind !== "electronic_delivery");
  const orgOf = (c: Consent): string => {
    const recipient = c.scope.recipient;
    if (typeof recipient === "string" && recipient) return recipient;
    return views.find((v) => v.verificationId === c.verificationId)?.orgName ?? "—";
  };
  return (
    <Panel icon={<KeyRound />} title={f.consentsTitle} id="fam-consents">
      <p className="mb-4 text-fg-muted">{f.consentsLead}</p>
      {active.length === 0 ? (
        <p className="text-fg-muted">{f.noConsents}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {active.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-fg">{f.consentKinds[c.kind as keyof typeof f.consentKinds] ?? f.consentKinds.verification_share}</p>
                <p className="text-sm text-fg-muted">
                  {f.consentFor(orgOf(c))} · {f.consentGiven(familyDate(c.grantedAt, locale))}
                  {c.expiresAt ? ` · ${f.consentUntil(familyDate(c.expiresAt, locale))}` : ""}
                </p>
              </div>
              {isOwner || c.userId === userId ? (
                <ConfirmButton
                  label={f.revoke}
                  variant="secondary"
                  triggerClassName="min-h-11"
                  tone="danger"
                  title={f.revokeTitle}
                  description={f.revokeBody(orgOf(c))}
                  confirmLabel={f.revoke}
                  cancelLabel={t.common.cancel}
                  locale={locale}
                  action={revokeConsentAction}
                  fields={{ consentId: c.id, lang: locale }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The whole /family page. Redirects to sign-in when nobody is signed in. */
export async function renderFamilyHome(query: SearchParams): Promise<ReactNode> {
  const user: User | null = await getFamilyUser("page");
  const locale = await resolveLocale(query);
  if (!user) redirect(`/sign-in?next=${encodeURIComponent("/family")}${locale === "es" ? "&lang=es" : ""}`);
  const { household } = await getOrCreateHouseholdForUser(user.id);
  const pageLocale = await resolveLocale(query, household.locale);
  const t = getDictionary(pageLocale);
  const f = t.family;
  const isOwner = household.access === "owner";
  const consents = await listConsentsForHousehold(household.id, { userId: user.id });
  const views = (await loadVerifications(consents, user.id)).reverse();
  const error = errorFromQuery(query, pageLocale);
  const notice = firstParam(query.notice);

  return (
    <FocusShell
      locale={pageLocale}
      width="xl"
      card={false}
      languageToggle={<LanguageToggle current={pageLocale} hrefs={languageHrefs("page", "/family")} />}
      exit={
        <form action={familySignOutAction}>
          <HiddenFields values={{ lang: pageLocale }} />
          <SubmitButton variant="ghost" leadingIcon={<LogOut aria-hidden="true" className="size-4" />}>
            {t.common.signOut}
          </SubmitButton>
        </form>
      }
      secureNote="family"
    >
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold text-fg sm:text-3xl">{f.title}</h1>
        <p className="text-fg-muted">{f.lead}</p>
        <p className="text-sm text-fg-muted">{f.signedInAs(user.email)}</p>
      </header>
      {error ? (
        <Alert tone="danger" role="alert" className="mb-6" title={t.errors.title}>
          {error}
        </Alert>
      ) : null}
      {notice === "revoked" ? (
        <Alert tone="success" role="status" className="mb-6">
          {f.revoked}
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <VerificationsPanel views={views} locale={pageLocale} />
          <PassportPanel views={views} locale={pageLocale} />
          <HouseholdPanel household={household} locale={pageLocale} />
        </div>
        <div className="space-y-6">
          <Panel icon={<UserPlus />} title={f.adultsTitle} id="fam-adults">
            {isOwner ? (
              <>
                <p className="mb-4 text-fg-muted">{f.adultsLead}</p>
                <InviteAdultForm locale={pageLocale} />
              </>
            ) : (
              <p className="text-fg-muted">{f.adultsOwnerOnly}</p>
            )}
          </Panel>
          <ConsentsPanel consents={consents} views={views} locale={pageLocale} userId={user.id} isOwner={isOwner} />
          <Panel icon={<Download />} title={f.dataTitle} id="fam-data">
            {isOwner ? (
              <>
                <p className="mb-4 text-fg-muted">{f.dataLead}</p>
                {/* A plain anchor, not next/link: the route answers with a file download. */}
                <a href={EXPORT_PATH} download className={buttonClasses({ variant: "secondary", size: "md" })}>
                  <Download aria-hidden="true" className="size-4" />
                  {f.download}
                </a>
              </>
            ) : (
              <p className="text-fg-muted">{f.dataOwnerOnly}</p>
            )}
          </Panel>
          <Panel icon={<LogOut />} title={f.signOutTitle} id="fam-signout">
            <form action={familySignOutAction}>
              <HiddenFields values={{ lang: pageLocale }} />
              <SubmitButton variant="secondary">{t.common.signOut}</SubmitButton>
            </form>
          </Panel>
        </div>
      </div>
      <p className="mt-8 text-center text-sm text-fg-muted">{t.common.notAPromise}</p>
    </FocusShell>
  );
}
