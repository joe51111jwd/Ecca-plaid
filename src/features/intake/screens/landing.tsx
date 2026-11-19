/**
 * What a verification link shows before the flow starts: the organization that is asking, what will happen, how long
 * it takes, what to have ready, the privacy promise, and sign-in (or "Continue" for someone already signed in).
 * Also the friendly pages for a link that is unknown, expired, canceled or already used by another household.
 */
import { CircleSlash, Clock, FileCheck2, Hourglass, LinkIcon, ListChecks, ShieldCheck, UserRoundX } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Button, SubmitButton } from "@/components/ui";
import { getDictionary, type Locale } from "@/i18n";
import type { User } from "@/server/auth";
import type { FamilyLinkState } from "@/server/verifications";
import { familySignOutAction } from "../actions";
import { ContinueForm } from "../components/forms";
import { FlowShell } from "../components/flow-shell";
import { HiddenFields } from "../components/hidden-fields";
import { SignInPanel } from "../components/sign-in-panel";
import type { Surface } from "../flow";
import { ESTIMATED_MINUTES } from "../policy";
import { ScreenHeading } from "./shared";

type ClosedLink = Exclude<FamilyLinkState, { state: "active" }>;
type ActiveLink = Extract<FamilyLinkState, { state: "active" }>;

function StateCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 text-center sm:text-left">
      <span aria-hidden="true" className="inline-flex size-14 items-center justify-center rounded-full bg-sunken text-fg-muted [&>svg]:size-7">
        {icon}
      </span>
      <h1 className="text-2xl font-semibold text-balance text-fg">{title}</h1>
      <div className="space-y-3 text-base leading-relaxed text-fg-muted">{children}</div>
    </div>
  );
}

/** A link that cannot be used: unknown, expired or canceled. */
export function LinkStateScreen({ link, locale, surface, base }: { link: ClosedLink; locale: Locale; surface: Surface; base: string }) {
  const t = getDictionary(locale).link;
  const orgName = link.state === "invalid" ? null : link.orgName;
  let card: ReactNode;
  if (link.state === "invalid") {
    card = (
      <StateCard icon={<LinkIcon />} title={t.invalidTitle}>
        <p>{t.invalidBody}</p>
      </StateCard>
    );
  } else if (link.state === "expired") {
    card = (
      <StateCard icon={<Hourglass />} title={t.expiredTitle}>
        <p>{t.expiredBody(link.orgName)}</p>
      </StateCard>
    );
  } else {
    card = (
      <StateCard icon={<CircleSlash />} title={t.canceledTitle}>
        <p>{t.canceledBody(link.orgName)}</p>
      </StateCard>
    );
  }
  return (
    <FlowShell surface={surface} locale={locale} currentPath={base} orgName={orgName}>
      {card}
    </FlowShell>
  );
}

export interface LandingScreenProps {
  link: ActiveLink;
  locale: Locale;
  surface: Surface;
  base: string;
  user: User | null;
  /** An email address the organization passed in the link (`?email=`), already validated. */
  defaultEmail: string;
}

function SignOutButton({ base, locale, label }: { base: string; locale: Locale; label: string }) {
  return (
    <form action={familySignOutAction}>
      <HiddenFields values={{ base, lang: locale }} />
      <SubmitButton variant="link">{label}</SubmitButton>
    </form>
  );
}

/** The landing page of a working link. */
export function LandingScreen({ link, locale, surface, base, user, defaultEmail }: LandingScreenProps) {
  const t = getDictionary(locale);
  const l = t.link;
  const v = link.verification;
  const finished = v.status === "eligible" || v.status === "ineligible" || v.status === "needs_review";
  // Someone signed in, the link was already started, and this person cannot open it: another household holds it.
  const heldByOther = user !== null && v.started;

  if (heldByOther) {
    return (
      <FlowShell surface={surface} locale={locale} currentPath={base} orgName={v.orgName} sandbox={v.mode === "test"}>
        <StateCard icon={<UserRoundX />} title={l.usedTitle}>
          <p>{l.usedBody(v.orgName)}</p>
          <p>{l.signedInAs(user.email)}</p>
        </StateCard>
        <div className="mt-6">
          <SignOutButton base={base} locale={locale} label={l.signInAnother} />
        </div>
      </FlowShell>
    );
  }

  const start = user ? (
    <div className="space-y-4">
      <p className="text-fg">{l.signedInAs(user.email)}</p>
      <ContinueForm base={base} locale={locale} label={finished ? l.finishedSignedIn : l.continueStart} />
      <SignOutButton base={base} locale={locale} label={l.notYou} />
    </div>
  ) : (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">{t.signIn.title}</h2>
        <p className="mt-1 text-fg-muted">{surface === "embed" ? t.signIn.introEmbed : t.signIn.intro}</p>
      </div>
      <SignInPanel locale={locale} base={base} surface={surface} defaultEmail={defaultEmail} />
    </div>
  );

  if (finished) {
    return (
      <FlowShell surface={surface} locale={locale} currentPath={base} orgName={v.orgName} sandbox={v.mode === "test"}>
        <StateCard icon={<FileCheck2 />} title={l.finishedTitle}>
          <p>{l.finishedBody}</p>
        </StateCard>
        <div className="mt-6 border-t border-line pt-6">{start}</div>
      </FlowShell>
    );
  }

  return (
    <FlowShell surface={surface} locale={locale} currentPath={base} orgName={v.orgName} sandbox={v.mode === "test"} width="lg">
      <ScreenHeading eyebrow={l.eyebrow(v.orgName)} title={l.title} lead={l.lead(v.orgName)} />

      <section aria-labelledby="what-happens" className="mb-8">
        <h2 id="what-happens" className="mb-4 text-lg font-semibold text-fg">
          {l.stepsTitle}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {l.steps.map((step, i) => (
            <li key={step.title} className="flex gap-3 rounded-card border border-line bg-sunken p-4 sm:flex-col">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-base font-semibold text-white">
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold text-fg">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="mb-8 flex items-start gap-3 rounded-card border border-brand-line bg-brand-surface p-4">
        <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-700" />
        <div>
          <h2 className="font-semibold text-fg">{l.timeTitle}</h2>
          <p className="mt-1 text-fg-muted">{l.timeBody(ESTIMATED_MINUTES)}</p>
        </div>
      </div>

      <div className="mb-8 rounded-panel border border-line bg-surface p-5 shadow-xs sm:p-6">{start}</div>

      <div className="grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="have-ready">
          <h2 id="have-ready" className="mb-3 flex items-center gap-2 text-lg font-semibold text-fg">
            <ListChecks aria-hidden="true" className="size-5 text-brand-700" />
            {l.readyTitle}
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-fg-muted marker:text-brand-700">
            {l.readyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-fg-muted">{l.readyPhoto}</p>
        </section>
        <section aria-labelledby="privacy">
          <h2 id="privacy" className="mb-3 flex items-center gap-2 text-lg font-semibold text-fg">
            <ShieldCheck aria-hidden="true" className="size-5 text-brand-700" />
            {l.privacyTitle}
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-fg-muted marker:text-brand-700">
            {l.privacyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <Alert tone="legal" role="note" className="mt-8">
        {l.notAPromise}
      </Alert>
    </FlowShell>
  );
}

/** Opened `/family/verifications/{id}` without being signed in. */
export function SignedOutScreen({ locale, base }: { locale: Locale; base: string }) {
  const t = getDictionary(locale);
  const next = encodeURIComponent(base);
  return (
    <FlowShell surface="page" locale={locale} currentPath={base}>
      <StateCard icon={<ShieldCheck />} title={t.signIn.title}>
        <p>{t.signIn.intro}</p>
      </StateCard>
      <div className="mt-6">
        <Button size="lg" fullWidth href={`/sign-in?next=${next}${locale === "es" ? "&lang=es" : ""}`}>
          {t.signIn.send}
        </Button>
      </div>
    </FlowShell>
  );
}
