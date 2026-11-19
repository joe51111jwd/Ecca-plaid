import { CalendarClock, Check, CircleSlash, ExternalLink } from "lucide-react";
import { Badge, Button, OrgMark, StatusBadge, cn } from "@/components/ui";
import { parseUsdToCents } from "@/lib/money";
import { familyNotices, isFinal, statusText, type HandoffView } from "@/server/handoffs";
import { familyPageCopy, verificationButtonLabel, type FamilyLocale } from "../copy";
import { buildReturnHref, formatUsdString, progressSteps, safeBrandColor, shouldPoll, type ProgressStep } from "../family-view";
import { STATUS_POLL_INTERVAL_MS } from "../policy";
import type { FamilyActionState } from "../types";
import { ActionForm } from "./ActionForm";
import { ChooseSgoForm } from "./ChooseSgoForm";
import { LiveStatus } from "./LiveStatus";
import { ReturnLink } from "./ReturnLink";

export interface FamilyHandoffProps {
  view: HandoffView;
  token: string;
  locale: FamilyLocale;
  /** In the embed: the verified origin of the business's page. */
  parentOrigin?: string | null;
  /** The family-page server actions (src/app/h/actions). */
  actions: {
    choose: (previous: FamilyActionState, formData: FormData) => Promise<FamilyActionState>;
    cancel: (previous: FamilyActionState, formData: FormData) => Promise<FamilyActionState>;
  };
}

function Progress({ steps, label }: { steps: ProgressStep[]; label: string }) {
  return (
    <ol aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s) => (
        <li
          key={s.id}
          aria-current={s.state === "current" ? "step" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-control border px-3 py-2 text-sm",
            s.state === "done" && "border-success-line bg-success-surface text-success-fg",
            s.state === "current" && "border-brand-line bg-brand-surface font-semibold text-brand-fg",
            s.state === "upcoming" && "border-line text-fg-muted",
            s.state === "stopped" && "border-line bg-sunken text-fg-muted",
          )}
        >
          <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center">
            {s.state === "done" ? <Check className="size-4" /> : s.state === "stopped" ? <CircleSlash className="size-4" /> : <span className={cn("size-2 rounded-full", s.state === "current" ? "bg-brand-700" : "bg-line-strong")} />}
          </span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The family's handoff page body: the business's branding beside ours, the booking, which scholarship organization
 * can check whether the family qualifies (or a choice among several), the hold deadline in words, the way into the
 * verification flow, and the live status with honest wording. No fee is ever shown to the family here.
 */
export function FamilyHandoff({ view, token, locale, parentOrigin = null, actions }: FamilyHandoffProps) {
  const t = familyPageCopy(locale);
  const brand = safeBrandColor(view.business.brandColor);
  const copyKey = view.step === "choose_sgo" ? "choose_sgo" : view.status;
  // The service's status copy, with the hold sentence moved into its own callout below.
  const text = statusText(locale, copyKey, {
    businessName: view.business.displayName,
    sgoName: view.sgo?.name ?? null,
    holdDeadline: null,
    awardAmountCents: view.award ? parseUsdToCents(view.award.amountUsd) : null,
  });
  const notices = familyNotices(locale, { businessName: view.business.displayName, provisional: view.verification?.status === "eligible" && view.verification.provisional, sandbox: view.mode === "test" });
  const amount = formatUsdString(view.booking.amountUsd);
  const returnHref = buildReturnHref(view.returnUrl, { handoffId: view.id, status: view.status });
  const final = isFinal(view.status);

  return (
    <div className="space-y-6" data-handoff-status={view.status}>
      <LiveStatus handoffId={view.id} status={view.status} holdExpiresAt={view.hold.expiresAt} poll={shouldPoll(view.status)} intervalMs={STATUS_POLL_INTERVAL_MS} parentOrigin={parentOrigin} />

      {brand ? <div aria-hidden="true" className="h-1.5 rounded-full" style={{ backgroundColor: brand }} /> : null}

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="handoff" status={view.status} locale={locale} provisional={view.verification?.status === "eligible" && view.verification.provisional} />
          {view.mode === "test" ? (
            <Badge tone="caution" size="sm">
              {t.sandbox}
            </Badge>
          ) : null}
        </div>
        <h1 className="font-display text-display-sm text-fg sm:text-display-md" aria-live="polite">
          {text.headline}
        </h1>
        <p className="text-base text-fg-muted">{text.body}</p>
      </header>

      {view.hold.deadline ? (
        <p className="flex items-start gap-3 rounded-card border border-brand-line bg-brand-surface p-4 text-base font-medium text-brand-fg">
          <CalendarClock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{t.holdLine(view.hold.deadline[locale])}</span>
        </p>
      ) : final && view.status !== "completed" ? (
        <p className="text-sm text-fg-muted">{t.holdEnded}</p>
      ) : null}

      <section aria-labelledby="booking-heading" className="rounded-card border border-line p-4">
        <div className="flex items-center gap-3">
          <OrgMark name={view.business.displayName} logoUrl={view.business.logoUrl} size="md" />
          <div className="min-w-0">
            <h2 id="booking-heading" className="text-sm font-medium text-fg-muted">
              {t.bookingHeading}
            </h2>
            <p className="truncate font-semibold text-fg">{view.business.displayName}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {view.booking.description ? (
            <div className="sm:col-span-2">
              <dt className="sr-only">{t.bookingHeading}</dt>
              <dd className="text-base text-fg">{view.booking.description}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-fg-muted">{t.bookingRef}</dt>
            <dd className="font-medium text-fg nums">{view.booking.ref}</dd>
          </div>
          {amount ? (
            <div>
              <dt className="text-fg-muted">{t.bookingAmount}</dt>
              <dd className="font-medium text-fg nums">{amount}</dd>
            </div>
          ) : null}
          {view.student.firstName ? (
            <div>
              <dt className="text-fg-muted">{t.student}</dt>
              <dd className="font-medium text-fg">{view.student.firstName}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {!final ? <p className="text-base text-fg">{view.sgo ? t.offerWithSgo(view.sgo.name) : t.offer}</p> : null}

      {view.step === "choose_sgo" && view.partnerChoices.length > 0 ? (
        <ChooseSgoForm
          token={token}
          locale={locale}
          choices={view.partnerChoices}
          labels={{ heading: t.chooseHeading, hint: t.chooseHint, submit: t.chooseSubmit, pending: t.choosePending, error: t.chooseError }}
          action={actions.choose}
        />
      ) : view.verificationUrl ? (
        <div className="space-y-2">
          <Button href={view.verificationUrl} target="_blank" rel="noopener noreferrer" size="lg" variant={final || view.status === "eligible" || view.status === "awarded" ? "secondary" : "primary"} trailingIcon={<ExternalLink />} fullWidth>
            {verificationButtonLabel(locale, view.status)}
          </Button>
          <p className="text-sm text-fg-muted">{t.opensInNewTab}</p>
        </div>
      ) : null}

      <section aria-labelledby="progress-heading" className="space-y-3">
        <h2 id="progress-heading" className="text-sm font-semibold text-fg">
          {t.progressLabel}
        </h2>
        <Progress steps={progressSteps(view.status, locale, { verifiedEligible: view.verification?.status === "eligible" })} label={t.progressLabel} />
        {shouldPoll(view.status) ? <p className="text-xs text-fg-subtle">{t.liveStatusNote}</p> : null}
      </section>

      <ul className="space-y-1.5 border-t border-line pt-4 text-sm text-fg-muted">
        {notices.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        {returnHref ? <ReturnLink href={returnHref} label={t.returnTo(view.business.displayName)} handoffId={view.id} status={view.status} parentOrigin={parentOrigin} /> : <span />}
        {!final ? (
          <ActionForm
            action={actions.cancel}
            submitLabel={t.cancelLink}
            submitVariant="link"
            submitSize="sm"
            submitClassName="h-auto! min-h-11 whitespace-normal! text-left"
            errorTitle={t.cancelError}
            quietSuccess
            locale={locale}
            confirm={{ title: t.cancelTitle, description: t.cancelDescription(view.business.displayName), confirmLabel: t.cancelConfirm, tone: "danger" }}
          >
            <input type="hidden" name="token" value={token} />
          </ActionForm>
        ) : null}
      </div>
    </div>
  );
}
