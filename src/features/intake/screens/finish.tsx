/**
 * The end of the flow: review and send, then the status page (processing, we need more, a person is reviewing, the
 * result). Every word about the outcome comes from getFamilyView (the decision engine's family explanation, the
 * provisional note) or the dictionary; nothing is decided here.
 */
import { CircleCheck, CircleSlash, FileSearch, Hourglass, Info, UserRoundSearch } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Badge, Button, KeyValueList, ProvisionalNotice, Spinner } from "@/components/ui";
import { pickBilingual } from "@/i18n";
import { AutoRefresh } from "../components/auto-refresh";
import { SubmitForm } from "../components/forms";
import { householdChangedSinceSnapshot } from "../flow";
import { STATUS_REFRESH_MS } from "../policy";
import type { FlowContext } from "../server/context";
import { StillNeeded } from "./proof";
import { activeDocuments, DocumentList, formFields, hrefFor, memberName, QueryError, ScreenHeading } from "./shared";
import { lastValidDay, type ScreenProps } from "./steps";

/* ------------------------------------------------------------------------------------------ review */

/** True when the household was changed after the living-arrangement step snapshotted it. */
export function householdChanged(ctx: FlowContext): boolean {
  const snap = ctx.verification.household;
  return householdChangedSinceSnapshot(snap ? { size: snap.size, countyFips: snap.countyFips, studentMemberIds: snap.studentMemberIds } : null, {
    size: ctx.household.size,
    countyFips: ctx.household.county?.fips ?? null,
    studentIds: ctx.household.studentIds,
  });
}

export function ReviewScreen({ ctx, query }: ScreenProps) {
  const t = ctx.t;
  const r = t.review;
  const changed = householdChanged(ctx);
  const students = ctx.household.members.filter((m) => m.kind === "student");
  const custody = ctx.verification.household?.custody ?? null;
  const memberById = new Map(ctx.household.members.map((m) => [m.id, m]));
  const hasEvidence = ctx.state.evidenceCount > 0 || ctx.view.certifications.length > 0;
  return (
    <>
      <ScreenHeading title={r.title} lead={r.lead} />
      <QueryError query={query} locale={ctx.locale} />
      {changed ? (
        <Alert tone="warning" title={r.changedTitle} className="mb-6" actions={<Button href={hrefFor(ctx, "custody")}>{r.changedButton}</Button>}>
          {r.changedBody}
        </Alert>
      ) : null}
      <div className="space-y-8">
        <section aria-labelledby="review-household" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="review-household" className="text-lg font-semibold text-fg">
              {r.householdTitle}
            </h2>
            {ctx.isOwner ? (
              <Button variant="link" href={hrefFor(ctx, "people")}>
                {r.editHousehold}
              </Button>
            ) : null}
          </div>
          <KeyValueList
            items={[
              { label: r.sizeLabel, value: r.size(ctx.household.size) },
              { label: r.countyLabel, value: ctx.household.county?.name ?? "—" },
              { label: r.studentsLabel, value: students.map(memberName).join(", ") || "—" },
              { label: r.custodyLabel, value: custody ? (custody.livesInMultipleHouseholds ? t.common.yes : t.common.no) : "—" },
            ]}
          />
        </section>

        <DocumentList ctx={ctx} documents={ctx.view.documents} returnTo="review" />

        {ctx.view.rails.length > 0 ? (
          <section aria-labelledby="review-connections" className="space-y-3">
            <h2 id="review-connections" className="text-lg font-semibold text-fg">
              {r.connectionsTitle}
            </h2>
            <ul className="divide-y divide-line rounded-card border border-line">
              {ctx.view.rails.map((rail) => (
                <li key={rail.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span className="font-medium text-fg">{rail.providerName}</span>
                  <Badge tone={rail.offerUpload ? "warning" : rail.waiting ? "info" : "success"}>{pickBilingual(rail.label, ctx.locale)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {ctx.view.certifications.length > 0 ? (
          <section aria-labelledby="review-statements" className="space-y-3">
            <h2 id="review-statements" className="text-lg font-semibold text-fg">
              {r.statementsTitle}
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-fg">
              {ctx.view.certifications.map((c) => {
                const m = c.memberId ? memberById.get(c.memberId) : undefined;
                return <li key={c.id}>{c.kind === "zero_income" ? r.statementZero(m ? memberName(m) : t.common.you) : r.statementOther}</li>;
              })}
            </ul>
          </section>
        ) : null}

        {hasEvidence ? null : (
          <Alert tone="info" role="note">
            {r.nothingYet}
          </Alert>
        )}

        <Button variant="secondary" size="lg" fullWidth href={hrefFor(ctx, ctx.view.pathPreference === "auto_submit" ? "connect" : "upload")}>
          {r.addMore}
        </Button>

        <section aria-labelledby="review-next" className="space-y-3 border-t border-line pt-6">
          <h2 id="review-next" className="text-lg font-semibold text-fg">
            {r.whatNext}
          </h2>
          <p className="text-fg-muted">{r.attest}</p>
          <p className="text-fg-muted">{pickBilingual(ctx.view.whatHappensNext, ctx.locale)}</p>
          <SubmitForm fields={formFields(ctx)} disabled={changed} />
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------------------------ status */

function StatusHero({ icon, tone, title, children }: { icon: ReactNode; tone: "success" | "info" | "warning" | "neutral"; title: string; children?: ReactNode }) {
  const ring = { success: "bg-success-surface text-success-700", info: "bg-info-surface text-info-700", warning: "bg-warning-surface text-warning-700", neutral: "bg-sunken text-fg-muted" }[tone];
  return (
    <div className="mb-6 space-y-4">
      <span aria-hidden="true" className={`inline-flex size-16 items-center justify-center rounded-full [&>svg]:size-8 ${ring}`}>
        {icon}
      </span>
      <h1 className="text-2xl leading-tight font-semibold text-balance text-fg sm:text-3xl">{title}</h1>
      {children ? <div className="space-y-2 text-base leading-relaxed text-fg-muted">{children}</div> : null}
    </div>
  );
}

function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}

function ExitLinks({ ctx }: { ctx: FlowContext }) {
  const t = ctx.t;
  return (
    <div className="mt-8 flex flex-col gap-3">
      {ctx.view.returnUrl ? (
        <Button size="lg" fullWidth href={ctx.view.returnUrl} className="h-auto! min-h-12 py-3 text-center whitespace-normal!">
          {t.common.returnTo(ctx.view.orgName)}
        </Button>
      ) : null}
      {ctx.surface === "page" ? (
        <Button variant="secondary" size="lg" fullWidth href={ctx.locale === "es" ? "/family?lang=es" : "/family"}>
          {t.common.goToHome}
        </Button>
      ) : null}
    </div>
  );
}

function OutcomeView({ ctx }: { ctx: FlowContext }) {
  const t = ctx.t;
  const o = t.outcome;
  const outcome = ctx.view.outcome!;
  const eligible = outcome.status === "eligible";
  // The engine's explanation may already carry the provisional note and the last valid day; never say them twice.
  const paragraphs = outcome.paragraphs.filter((p) => p !== outcome.provisionalNote);
  const until = outcome.expiresAt ? lastValidDay(outcome.expiresAt, ctx.locale) : null;
  const untilSaid = until !== null && paragraphs.some((p) => p.includes(until));
  return (
    <>
      <StatusHero icon={eligible ? <CircleCheck /> : <Info />} tone={eligible ? "success" : "neutral"} title={eligible ? o.eligibleTitle : o.ineligibleTitle}>
        <p className="font-medium text-fg">{outcome.headline}</p>
        <Paragraphs items={paragraphs} />
      </StatusHero>
      <div className="space-y-4">
        {outcome.provisional ? (
          <ProvisionalNotice title={o.provisionalTitle} locale={ctx.locale}>
            {outcome.provisionalNote ?? undefined}
          </ProvisionalNotice>
        ) : null}
        <ul className="space-y-1 text-fg">
          {until && !untilSaid ? <li>{o.expires(until)}</li> : null}
          {outcome.decidedByReviewer ? <li>{o.reviewer}</li> : null}
          {outcome.reusedEarlierResult ? <li>{o.reused}</li> : null}
        </ul>
        <Alert tone="legal" role="note">
          {o.notAPromise}
        </Alert>
        {eligible ? <p className="text-fg-muted">{o.savedPassport}</p> : null}
      </div>
    </>
  );
}

export function StatusScreen({ ctx, query }: ScreenProps) {
  const t = ctx.t;
  const s = t.status;
  const v = ctx.view;
  const awaiting = v.status === "pending" && v.stage === "awaiting_family";
  const processing = v.status === "pending" && !v.canEdit;
  const next = pickBilingual(v.whatHappensNext, ctx.locale);
  const documents = activeDocuments(v.documents);

  let body: ReactNode;
  if (v.currentStep === "closed") {
    body = (
      <StatusHero icon={<CircleSlash />} tone="neutral" title={s.closedTitle}>
        <p>{next}</p>
      </StatusHero>
    );
  } else if (v.outcome) {
    body = <OutcomeView ctx={ctx} />;
  } else if (v.status === "needs_review") {
    body = (
      <>
        <StatusHero icon={<UserRoundSearch />} tone="info" title={s.reviewTitle}>
          <p>{s.reviewBody}</p>
          {v.explanation ? <Paragraphs items={v.explanation.paragraphs} /> : null}
        </StatusHero>
        <p className="text-fg-muted">{next}</p>
      </>
    );
  } else if (awaiting) {
    body = (
      <>
        <StatusHero icon={<FileSearch />} tone="warning" title={s.moreTitle}>
          <p>{s.moreBody}</p>
          {v.explanation ? <Paragraphs items={v.explanation.paragraphs} /> : null}
        </StatusHero>
        <StillNeeded ctx={ctx} />
        <Button size="lg" fullWidth href={hrefFor(ctx, v.pathPreference === "auto_submit" ? "connect" : "upload")}>
          {s.addWhatsNeeded}
        </Button>
        <p className="mt-6 text-fg-muted">{next}</p>
      </>
    );
  } else if (processing) {
    body = (
      <>
        <StatusHero icon={<Hourglass />} tone="info" title={s.processingTitle}>
          <p>{s.processingBody}</p>
        </StatusHero>
        <p className="mb-6 flex items-center gap-2 text-fg-muted" role="status">
          <Spinner size="sm" />
          {s.lastUpdated}
        </p>
        <p className="text-fg-muted">{next}</p>
      </>
    );
  } else {
    // Still being filled in (opened from the household page): offer the way back into the steps.
    body = (
      <>
        <StatusHero icon={<Hourglass />} tone="info" title={t.meta.stepTitle}>
          <p>{next}</p>
        </StatusHero>
        <Button size="lg" fullWidth href={ctx.locale === "es" ? `${ctx.base}?lang=es` : ctx.base}>
          {t.common.continue}
        </Button>
      </>
    );
  }

  return (
    <>
      <AutoRefresh intervalMs={STATUS_REFRESH_MS} enabled={processing && !awaiting} />
      <QueryError query={query} locale={ctx.locale} />
      {body}
      {v.outcome || documents.length === 0 ? null : (
        <div className="mt-8">
          <DocumentList ctx={ctx} documents={v.documents} returnTo="status" headingLevel={2} />
        </div>
      )}
      {v.outcome || v.currentStep === "closed" ? null : (
        <Alert tone="legal" role="note" className="mt-8">
          {t.common.notAPromise}
        </Alert>
      )}
      <ExitLinks ctx={ctx} />
    </>
  );
}
