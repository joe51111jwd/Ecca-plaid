/**
 * The first half of the flow: the earlier-result offer (passport), permission, address, county, the people in the
 * home, the living arrangement and the choice of path. Each screen loads what it shows through the services and
 * renders one task; the forms post to ./actions and the next screen is derived from the server again.
 */
import { MapPin, Pencil, UserRound } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmButton } from "@/components/ui";
import { candidateCountiesForZip } from "@/engine/geo";
import { listCounties } from "@/engine/ami";
import { formatConsentDate, type RenderedConsent } from "@/server/consents";
import { certificationIncomeYear, previewPassportConsent, previewSharingConsent } from "@/server/verifications";
import { removeMemberAction } from "../actions";
import { AddressForm, ConsentForm, CountyForm, CustodyForm, MemberForm, OwnerForm, PathForm, ReuseForm, type CountyChoice, type CustodyDefaults, type MemberDefaults } from "../components/forms";
import { firstParam, type FlowContext, type SearchParams } from "../server/context";
import { formFields, hrefFor, memberName, QueryError, ScreenHeading } from "./shared";

export interface ScreenProps {
  ctx: FlowContext;
  query: SearchParams;
}

/** A YYYY-MM-DD date in the family's words ("March 3, 2027" / "3 de marzo de 2027"). */
export function familyDate(value: Date | string | null | undefined, locale: FlowContext["locale"]): string {
  if (!value) return "";
  const iso = typeof value === "string" ? value.slice(0, 10) : centralIsoDate(value);
  return formatConsentDate(iso, locale);
}

/**
 * The last day a result can be used, in the family's words. Results expire at the first instant after their last
 * valid day (US Central), so the day shown is the one just before that instant.
 */
export function lastValidDay(expiresAt: Date, locale: FlowContext["locale"]): string {
  return familyDate(new Date(expiresAt.getTime() - 1), locale);
}

/** The calendar day of an instant in US Central time (the product's business time zone). */
function centralIsoDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The exact consent words, rendered as the service produced them (title, then each paragraph). */
export function ConsentText({ rendered, headingId }: { rendered: Pick<RenderedConsent, "title" | "paragraphs">; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-card border border-line bg-sunken p-4 sm:p-5">
      <h2 id={headingId} className="text-lg font-semibold text-fg">
        {rendered.title}
      </h2>
      {rendered.paragraphs.map((p, i) => (
        <p key={i} className="leading-relaxed whitespace-pre-line text-fg">
          {p}
        </p>
      ))}
    </section>
  );
}

function OwnerOnly({ title, body }: { title: string; body: string }) {
  return (
    <Alert tone="info" title={title}>
      {body}
    </Alert>
  );
}

/* ------------------------------------------------------------------------------------------- reuse */

export async function ReuseScreen({ ctx }: ScreenProps) {
  const t = ctx.t;
  const r = t.reuse;
  const reusable = ctx.view.reusableResult;
  if (!reusable) return null;
  if (!ctx.isOwner) {
    return (
      <>
        <ScreenHeading title={r.title} />
        <OwnerOnly title={t.consent.ownerOnlyTitle} body={r.ownerOnly} />
      </>
    );
  }
  const rendered = await previewPassportConsent(ctx.view.verificationId, reusable.verificationId, { userId: ctx.user.id }, ctx.locale);
  return (
    <>
      <ScreenHeading title={r.title} lead={r.lead(reusable.orgName, familyDate(reusable.decidedAt, ctx.locale))} />
      {reusable.validUntil ? <p className="mb-5 font-medium text-fg">{r.validUntil(familyDate(reusable.validUntil, ctx.locale))}</p> : null}
      <div className="space-y-6">
        <ConsentText rendered={rendered} headingId="passport-consent" />
        <ReuseForm fields={formFields(ctx)} sourceId={reusable.verificationId} consentSha={rendered.sha256} consentLabel={rendered.checkboxLabel} />
        <Button variant="secondary" size="lg" fullWidth href={hrefFor(ctx, "consent")}>
          {r.freshButton}
        </Button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------------------------------- consent */

export async function ConsentScreen({ ctx, query }: ScreenProps) {
  const t = ctx.t;
  const c = t.consent;
  if (!ctx.isOwner) {
    return (
      <>
        <ScreenHeading title={c.title} />
        <OwnerOnly title={c.ownerOnlyTitle} body={c.ownerOnlyBody} />
      </>
    );
  }
  const rendered = await previewSharingConsent(ctx.view.verificationId, { userId: ctx.user.id }, ctx.locale);
  const shareUntil = typeof rendered.scope.shareUntil === "string" ? rendered.scope.shareUntil : null;
  return (
    <>
      <ScreenHeading title={c.title} lead={c.lead} />
      {firstParam(query.notice) === "reuse_fallback" ? (
        <Alert tone="info" title={t.reuse.fallbackTitle} className="mb-6" role="status">
          {t.reuse.fallbackBody}
        </Alert>
      ) : null}
      <QueryError query={query} locale={ctx.locale} />
      <div className="space-y-6">
        <section aria-labelledby="consent-summary" className="rounded-card border border-brand-line bg-brand-surface p-4 sm:p-5">
          <h2 id="consent-summary" className="mb-3 font-semibold text-fg">
            {c.summaryTitle}
          </h2>
          <ul className="space-y-2 text-fg">
            <li>{c.summaryWho(ctx.view.orgName)}</li>
            <li>{c.summaryWhat}</li>
            <li>{c.summaryWhy}</li>
            <li>{shareUntil ? c.summaryUntil(familyDate(shareUntil, ctx.locale)) : c.summaryHowLong}</li>
          </ul>
        </section>
        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-wide text-fg-muted uppercase">{c.fullTextTitle}</p>
          <ConsentText rendered={rendered} headingId="consent-text" />
          <p className="text-xs text-fg-muted">{c.versionNote(rendered.version)}</p>
        </div>
        <ConsentForm fields={formFields(ctx)} checkboxLabel={rendered.checkboxLabel} sha={rendered.sha256} />
        <p className="text-sm text-fg-muted">{c.noThanks}</p>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------------------------------- address */

export function AddressScreen({ ctx, query }: ScreenProps) {
  const a = ctx.t.address;
  if (!ctx.isOwner) {
    return (
      <>
        <ScreenHeading title={a.title} />
        <OwnerOnly title={ctx.t.consent.ownerOnlyTitle} body={ctx.t.people.ownerOnly} />
      </>
    );
  }
  const current = ctx.household.address;
  return (
    <>
      <ScreenHeading title={a.title} lead={a.lead} />
      <QueryError query={query} locale={ctx.locale} />
      <AddressForm fields={formFields(ctx)} defaults={{ line1: current?.line1 ?? "", line2: current?.line2 ?? "", city: current?.city ?? "", zip: current?.zip ?? "" }} />
    </>
  );
}

/* ------------------------------------------------------------------------------------------ county */

function percent(bps: number, locale: FlowContext["locale"]): string {
  return new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(bps / 10_000);
}

export function CountyScreen({ ctx, query }: ScreenProps) {
  const c = ctx.t.county;
  const zip = ctx.household.address?.zip ?? "";
  const zipCandidates = zip ? candidateCountiesForZip(zip) : [];
  const candidates: CountyChoice[] = zipCandidates.map((x) => ({ fips: x.fips, name: x.name, ...(x.landShareBps !== undefined ? { share: percent(x.landShareBps, ctx.locale) } : {}) }));
  const all: CountyChoice[] = listCounties()
    .map((x) => ({ fips: x.fips, name: x.name }))
    .sort((x, y) => x.name.localeCompare(y.name, "en"));
  return (
    <>
      <ScreenHeading title={c.title} lead={zipCandidates.length > 1 ? c.leadAmbiguous(zip) : c.leadUnknown(zip)} />
      <QueryError query={query} locale={ctx.locale} />
      <CountyForm fields={formFields(ctx)} candidates={candidates.length > 1 ? candidates : []} allCounties={all} selected={ctx.household.county?.fips ?? null} />
    </>
  );
}

/* ------------------------------------------------------------------------------------------ people */

function AddressSummary({ ctx }: { ctx: FlowContext }) {
  const a = ctx.t.address;
  const addr = ctx.household.address;
  const county = ctx.household.county;
  if (!addr) return null;
  return (
    <Card tone="sunken" padding="sm" className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-700" />
          <div className="min-w-0">
            <p className="text-sm text-fg-muted">{a.current}</p>
            <p className="font-medium text-fg">
              {addr.line1}
              {addr.line2 ? `, ${addr.line2}` : ""}, {addr.city}, TX {addr.zip}
            </p>
            {county ? <p className="text-sm text-fg">{a.countyFound(county.name)}</p> : null}
          </div>
        </div>
        {ctx.isOwner ? (
          <Button variant="link" href={hrefFor(ctx, "address")}>
            {a.change}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function kindLabel(ctx: FlowContext, kind: string): string {
  const kinds = ctx.t.people.kinds;
  return kind in kinds ? kinds[kind as keyof typeof kinds].label : kinds.other.label;
}

export function PeopleScreen({ ctx, query }: ScreenProps) {
  const t = ctx.t;
  const p = t.people;
  const fields = formFields(ctx);
  const members = ctx.household.members;
  const owner = members.find((m) => m.isOwner);
  const peopleHref = hrefFor(ctx, "people");

  if (!owner) {
    if (!ctx.isOwner) {
      return (
        <>
          <ScreenHeading title={p.title} />
          <OwnerOnly title={t.consent.ownerOnlyTitle} body={p.ownerOnly} />
        </>
      );
    }
    return (
      <>
        <ScreenHeading title={p.youTitle} lead={p.youLead} />
        <AddressSummary ctx={ctx} />
        <QueryError query={query} locale={ctx.locale} />
        <OwnerForm fields={fields} defaults={{ firstName: "", lastName: "", relationship: "parent" }} />
      </>
    );
  }

  const editId = firstParam(query.edit);
  const editing = editId ? members.find((m) => m.id === editId) : undefined;
  if (ctx.isOwner && (firstParam(query.add) === "1" || editing)) {
    const defaults: MemberDefaults = editing
      ? { memberId: editing.id, kind: editing.kind, firstName: editing.firstName, lastName: editing.lastName, relationship: editing.relationship ?? "", hasDob: editing.hasDob, kindLocked: editing.isOwner || editing.hasSignIn }
      : { memberId: null, kind: ctx.state.household.studentCount === 0 ? "student" : "adult", firstName: "", lastName: "", relationship: ctx.state.household.studentCount === 0 ? "self" : "", hasDob: false, kindLocked: false };
    return (
      <>
        <ScreenHeading title={editing ? p.editTitle(memberName(editing)) : p.addTitle} lead={editing ? undefined : p.whyBody} />
        <MemberForm fields={fields} defaults={defaults} cancelHref={peopleHref} />
      </>
    );
  }

  const noStudent = ctx.state.household.studentCount === 0;
  return (
    <>
      <ScreenHeading title={p.title} lead={p.lead} />
      <AddressSummary ctx={ctx} />
      {firstParam(query.notice) === "county_mismatch" ? (
        <Alert tone="info" role="status" className="mb-5">
          {t.county.noMatchNote}
        </Alert>
      ) : null}
      <QueryError query={query} locale={ctx.locale} />
      <section aria-labelledby="people-list" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="people-list" className="text-lg font-semibold text-fg">
            {p.listCaption}
          </h2>
          <p className="font-medium text-brand-700" role="status">
            {p.sizeBack(ctx.household.size)}
          </p>
        </div>
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-fg-muted">
                  <UserRound className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{memberName(m)}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
                    <span>{kindLabel(ctx, m.kind)}</span>
                    {m.isOwner ? <Badge tone="brand">{p.youBadge}</Badge> : null}
                    {m.kind === "student" ? <Badge tone="success">{p.studentBadge}</Badge> : null}
                  </p>
                </div>
              </div>
              {ctx.isOwner ? (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" href={hrefFor(ctx, "people", { edit: m.id })} leadingIcon={<Pencil aria-hidden="true" />} className="min-h-11">
                    {t.common.edit}
                    <span className="sr-only"> {memberName(m)}</span>
                  </Button>
                  {m.isOwner ? null : (
                    <ConfirmButton
                      label={
                        <>
                          {t.common.remove}
                          <span className="sr-only"> {memberName(m)}</span>
                        </>
                      }
                      variant="ghost"
                      triggerClassName="min-h-11"
                      tone="danger"
                      title={p.removeTitle(memberName(m))}
                      description={p.removeBody}
                      confirmLabel={p.removeConfirm}
                      cancelLabel={t.common.cancel}
                      locale={ctx.locale}
                      action={removeMemberAction}
                      fields={{ ...fields, memberId: m.id }}
                    />
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <details className="rounded-card border border-line p-4 text-sm text-fg-muted">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-fg">{p.whyTitle}</summary>
          <p className="mt-2">{p.whyBody}</p>
        </details>
      </section>
      {noStudent ? (
        <Alert tone="warning" title={p.noStudentTitle} className="mt-6">
          {p.noStudentBody}
        </Alert>
      ) : null}
      {ctx.isOwner ? (
        <div className="mt-6 flex flex-col gap-3">
          <Button variant={noStudent ? "primary" : "secondary"} size="lg" fullWidth href={hrefFor(ctx, "people", { add: "1" })}>
            {p.addPerson}
          </Button>
          {noStudent ? null : (
            <Button size="lg" fullWidth href={hrefFor(ctx, "custody")}>
              {p.done}
            </Button>
          )}
        </div>
      ) : (
        <Alert tone="info" className="mt-6">
          {p.ownerOnly}
        </Alert>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------------------------- custody */

function triDefault(value: boolean | undefined | null): CustodyDefaults["lives"] {
  return value === true ? "yes" : value === false ? "no" : "";
}

export function CustodyScreen({ ctx, query }: ScreenProps) {
  const t = ctx.t;
  const c = t.custody;
  if (!ctx.isOwner) {
    return (
      <>
        <ScreenHeading title={c.title} />
        <OwnerOnly title={t.consent.ownerOnlyTitle} body={t.people.ownerOnly} />
      </>
    );
  }
  const stored = ctx.verification.household?.custody ?? null;
  const students = ctx.household.members.filter((m) => m.kind === "student");
  const studentName = students.length === 1 ? students[0]!.firstName : c.theStudent;
  const incomeYear = ctx.verification.incomeYear ?? certificationIncomeYear({ applicationDate: ctx.verification.applicationDate });
  const defaults: CustodyDefaults = {
    lives: stored ? triDefault(stored.livesInMultipleHouseholds) : "",
    months: stored?.monthsInThisHousehold !== undefined && stored?.monthsInThisHousehold !== null ? String(stored.monthsInThisHousehold) : "",
    equal: triDefault(stored?.equalTime),
    higher: stored?.thisHouseholdHasHigherIncome === "yes" ? "yes" : stored?.thisHouseholdHasHigherIncome === "no" ? "no" : stored?.thisHouseholdHasHigherIncome === "unknown" ? "unsure" : "",
    notes: stored?.notes ?? "",
  };
  return (
    <>
      <ScreenHeading title={c.title} lead={c.lead} />
      <QueryError query={query} locale={ctx.locale} />
      <CustodyForm fields={formFields(ctx)} defaults={defaults} studentName={studentName} incomeYear={incomeYear} />
    </>
  );
}

/* -------------------------------------------------------------------------------------------- path */

export function PathScreen({ ctx, query }: ScreenProps) {
  const p = ctx.t.path;
  const custody = ctx.verification.household?.custody;
  return (
    <>
      <ScreenHeading title={p.title} lead={p.lead} />
      {custody?.livesInMultipleHouseholds ? (
        <Alert tone="info" role="note" className="mb-5">
          {p.custodyReview}
        </Alert>
      ) : null}
      <QueryError query={query} locale={ctx.locale} />
      <PathForm fields={formFields(ctx)} current={ctx.view.pathPreference} />
    </>
  );
}
