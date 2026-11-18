import { ArrowRight, Check, EyeOff, FileCheck, GraduationCap, HandHeart, LockKeyhole, MailCheck, Tent, UserRoundCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, LegalNote } from "@/components/ui/alert";
import { OrgMark } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CodeBlock } from "@/components/ui/copy";
import { Money } from "@/components/ui/money";
import { ProvisionalBadge } from "@/components/ui/provisional";
import { KeyValue, KeyValueList } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { describeThresholdSource, getActiveTable, getThreshold, type ThresholdResult, type ThresholdSourceDescription } from "@/engine/ami";
import { LANDING, LANDING_EXAMPLE } from "./landing-copy";

const CONTAINER = "mx-auto w-full max-w-page px-4 sm:px-6 lg:px-8";

const ENTRY_ICON: Record<(typeof LANDING.entries)[number]["key"], ReactNode> = {
  donor: <HandHeart />,
  family: <UsersRound />,
  sgo: <GraduationCap />,
  partner: <Tent />,
};

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold tracking-wide text-brand-700">{children}</p>;
}

function SectionHeading({ eyebrow, title, lead, id }: { eyebrow?: string; title: string; lead?: string; id: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={id} className={cn("font-display text-display-sm text-balance text-fg sm:text-display-md", eyebrow && "mt-3")}>
        {title}
      </h2>
      {lead ? <p className="mt-4 text-lg text-fg-muted">{lead}</p> : null}
    </div>
  );
}

interface LiveThreshold {
  result: ThresholdResult;
  source: ThresholdSourceDescription;
}

/**
 * The example's numbers come from the income engine itself, so the landing page can never show a limit
 * the product would not actually use, and it stops saying "provisional" on its own once an IRS-published
 * table is the active one. If the engine cannot answer, the example is shown without a limit.
 */
function liveThreshold(): LiveThreshold | null {
  try {
    return { result: getThreshold({ countyFips: LANDING_EXAMPLE.countyFips, householdSize: LANDING_EXAMPLE.householdSize }), source: describeThresholdSource(getActiveTable()) };
  } catch (error) {
    console.error("Landing example: the income engine could not compute the illustrative limit", error);
    return null;
  }
}

/** The illustrative result shown in the hero. Labeled as an example and, while it is, as provisional — like the real thing. */
function ExampleResult({ live }: { live: LiveThreshold | null }) {
  const example = LANDING.example;
  const provisional = live?.result.provisional ?? true;
  return (
    <div className="rounded-panel border border-line bg-canvas p-3 sm:p-4">
      <div className="rounded-card border border-line bg-surface shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <p className="text-sm font-semibold text-fg">{example.title}</p>
          <Badge variant="outline" size="sm">
            {example.label}
          </Badge>
        </div>
        <div className="px-5 py-5">
          <StatusBadge kind="verification" status="eligible" provisional={provisional} />
          <KeyValueList className="mt-4" dense>
            <KeyValue label={example.householdLabel}>{example.household(LANDING_EXAMPLE.householdSize)}</KeyValue>
            {live ? (
              <>
                <KeyValue label={example.countyLabel}>
                  {live.result.county.name}, {LANDING_EXAMPLE.state}
                </KeyValue>
                <KeyValue label={example.limitLabel} hint={`${live.result.formula}. ${live.source.sourceLine}`}>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Money cents={live.result.thresholdCents} />
                    {provisional ? <ProvisionalBadge size="sm" /> : null}
                  </span>
                </KeyValue>
              </>
            ) : null}
            <KeyValue label={example.methodLabel}>{example.method}</KeyValue>
            <KeyValue label={example.evidenceLabel}>{example.evidence}</KeyValue>
          </KeyValueList>
        </div>
        <p className="rounded-b-card border-t border-line bg-canvas px-5 py-3 text-xs leading-5 text-fg-muted">{example.footnote}</p>
      </div>
    </div>
  );
}

function Hero({ live }: { live: LiveThreshold | null }) {
  return (
    <section aria-labelledby="hero-title" className="border-b border-line bg-surface">
      <div className={cn(CONTAINER, "grid gap-y-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-x-14 lg:gap-y-14 lg:py-20")}>
        <div className="lg:col-start-1 lg:row-start-1 lg:self-center">
          <Eyebrow>{LANDING.hero.eyebrow}</Eyebrow>
          <h1 id="hero-title" className="mt-4 font-display text-display-md text-balance text-fg sm:text-display-lg xl:text-display-xl">
            {LANDING.hero.title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-fg-muted">{LANDING.hero.lead}</p>
        </div>

        <nav aria-labelledby="chooser-title" className="lg:col-span-2 lg:row-start-2">
          <h2 id="chooser-title" className="text-base font-semibold text-fg">
            {LANDING.hero.chooserTitle}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LANDING.entries.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={entry.href}
                  className="group flex h-full flex-col rounded-card border border-line-strong bg-surface p-5 transition-[border-color,box-shadow] hover:border-action hover:shadow-md"
                >
                  {/* Phones: icon, title and arrow share one row so four cards fit in about two screens. */}
                  <span className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-4">
                    <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand-surface text-brand-700 [&>svg]:size-5">
                      {ENTRY_ICON[entry.key]}
                    </span>
                    <span className="flex min-w-0 flex-1 items-start justify-between gap-3 sm:w-full">
                      <span className="text-lg leading-6 font-semibold text-fg">{entry.title}</span>
                      <ArrowRight aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-action" />
                    </span>
                  </span>
                  <span className="mt-3 flex-1 text-sm text-fg-muted sm:mt-2">{entry.body}</span>
                  {/* Two lines reserved from sm up so the dividers line up across the row. */}
                  <span className="mt-4 border-t border-line pt-3 text-xs font-medium text-fg-muted sm:min-h-[2.875rem]">{entry.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-start-2 lg:row-start-1 lg:self-center">
          <ExampleResult live={live} />
        </div>
      </div>
    </section>
  );
}

function Facts() {
  return (
    <section aria-labelledby="facts-title" className="border-b border-line bg-canvas">
      <div className={cn(CONTAINER, "py-12 sm:py-14")}>
        <h2 id="facts-title" className="text-sm font-semibold tracking-wide text-fg-muted">
          {LANDING.facts.title}
        </h2>
        <dl className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-10">
          {LANDING.facts.items.map((fact) => (
            <div key={fact.label} className="border-t-2 border-brand-700 pt-5">
              {/* The label is the term; the figure and its qualifier are the description. */}
              <dt className="text-base font-semibold text-fg">{fact.label}</dt>
              <dd className="mt-1">
                <span className="block font-display text-display-md text-fg nums sm:text-display-lg">{fact.figure}</span>
                <span className="mt-2 block text-sm text-fg-muted">{fact.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const STEP_ICON = [<MailCheck key="1" />, <FileCheck key="2" />, <UserRoundCheck key="3" />];

function Verification() {
  const copy = LANDING.verification;
  return (
    <section aria-labelledby="verification-title" className="bg-surface">
      <div className={cn(CONTAINER, "py-16 sm:py-20")}>
        <SectionHeading id="verification-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
        <ol className="mt-10 grid gap-6 lg:grid-cols-3">
          {copy.steps.map((step, index) => (
            <li key={step.title} className="relative rounded-card border border-line bg-surface p-6">
              <div className="flex items-center justify-between">
                <span className="font-display text-display-sm text-brand-700 nums">
                  <span className="sr-only">Step </span>
                  {index + 1}
                </span>
                <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-brand-surface text-brand-700 [&>svg]:size-5">
                  {STEP_ICON[index]}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-fg">{step.title}</h3>
              <p className="mt-2 text-base text-fg-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <Alert tone="neutral" className="mt-6">
          <p>{copy.footnote}</p>
        </Alert>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href="/family" size="lg" trailingIcon={<ArrowRight />}>
            {copy.familyCta}
          </Button>
          <Button href="/sgo" size="lg" variant="secondary">
            {copy.sgoCta}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Donor() {
  const copy = LANDING.donor;
  return (
    <section aria-labelledby="donor-title" className="border-y border-line bg-canvas">
      <div className={cn(CONTAINER, "grid gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16")}>
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionHeading id="donor-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
          <div className="mt-8">
            <Button href="/give" size="lg" trailingIcon={<ArrowRight />}>
              {copy.cta}
            </Button>
          </div>
        </div>
        <div className="rounded-panel border border-line bg-surface p-6 sm:p-8">
          <ul className="space-y-4">
            {copy.points.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-surface text-brand-700">
                  <Check strokeWidth={3} className="size-3" />
                </span>
                <span className="text-base text-fg">{point}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-line pt-5 text-sm text-fg-muted">{copy.feeNote}</p>
          <LegalNote title={copy.legalTitle} className="mt-5">
            <p>{copy.legal}</p>
          </LegalNote>
        </div>
      </div>
    </section>
  );
}

function Partner() {
  const copy = LANDING.partner;
  const art = copy.illustration;
  return (
    <section aria-labelledby="partner-title" className="bg-surface">
      <div className={cn(CONTAINER, "grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16")}>
        <div className="order-last lg:order-first">
          <div className="rounded-panel border border-line bg-canvas p-3 sm:p-4">
            <div className="rounded-card border border-line bg-surface shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <span className="flex min-w-0 items-center gap-3">
                  <OrgMark name={art.business} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">{art.business}</span>
                    <span className="block truncate text-sm text-fg-muted">{art.booking}</span>
                  </span>
                </span>
                <Badge variant="outline" size="sm">
                  {art.label}
                </Badge>
              </div>
              <div className="px-5 py-5">
                <StatusBadge kind="handoff" status="held" />
                <p className="mt-3 text-base text-fg">{art.held}</p>
              </div>
              <div className="rounded-b-card border-t border-line bg-canvas px-5 py-4">
                <p className="text-xs font-medium text-fg-muted">{art.stagesLabel}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge kind="handoff" status="held" size="sm" />
                  <StatusBadge kind="handoff" status="eligible" size="sm" />
                  <StatusBadge kind="handoff" status="awarded" size="sm" />
                  <StatusBadge kind="handoff" status="declined" size="sm" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <SectionHeading id="partner-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
          <dl className="mt-8 space-y-5">
            {copy.points.map((point) => (
              <div key={point.title} className="border-l-2 border-brand-200 pl-4">
                <dt className="text-base font-semibold text-fg">{point.title}</dt>
                <dd className="mt-1 text-base text-fg-muted">{point.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-fg-muted">{copy.caveat}</p>
          <div className="mt-8">
            <Button href="/partner" size="lg" variant="secondary" trailingIcon={<ArrowRight />}>
              {copy.cta}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Honesty({ limitsProvisional }: { limitsProvisional: boolean }) {
  const copy = LANDING.honesty;
  // Never say the limits are provisional once the IRS table is the one in use (and never the reverse).
  const items = copy.items.filter((item) => item.key !== "limits" || limitsProvisional);
  return (
    <section aria-labelledby="honesty-title" className="bg-surface">
      <div className={cn(CONTAINER, "pb-16 sm:pb-20")}>
        <div className="hatch rounded-panel border border-dashed border-caution-line bg-caution-surface p-6 sm:p-10">
          <div className="max-w-2xl">
            <ProvisionalBadge>Proposed rules · provisional data</ProvisionalBadge>
            <h2 id="honesty-title" className="mt-4 font-display text-display-sm text-balance text-caution-fg sm:text-display-md">
              {copy.title}
            </h2>
            <p className="mt-3 text-lg text-caution-fg">{copy.lead}</p>
          </div>
          <dl className="mt-8 grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <div key={item.key} className="rounded-card border border-accent-200 bg-surface p-5">
                <dt className="text-base font-semibold text-fg">{item.title}</dt>
                <dd className="mt-2 text-sm leading-6 text-fg-muted">{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

const CARE_ICON = [<UserRoundCheck key="1" />, <LockKeyhole key="2" />, <EyeOff key="3" />];

function Care() {
  const copy = LANDING.care;
  return (
    <section aria-labelledby="care-title" className="border-t border-line bg-canvas">
      <div className={cn(CONTAINER, "py-16 sm:py-20")}>
        <SectionHeading id="care-title" title={copy.title} />
        <ul className="mt-10 grid gap-8 md:grid-cols-3">
          {copy.items.map((item, index) => (
            <li key={item.title}>
              <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-control border border-line bg-surface text-brand-700 [&>svg]:size-5">
                {CARE_ICON[index]}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-fg">{item.title}</h3>
              <p className="mt-2 text-base text-fg-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Developers() {
  const copy = LANDING.developers;
  return (
    <section aria-labelledby="developers-title" data-surface="inverse" className="bg-brand-900">
      <div className={cn(CONTAINER, "grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16")}>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide text-accent-300">{copy.eyebrow}</p>
          <h2 id="developers-title" className="mt-3 font-display text-display-sm text-balance text-fg sm:text-display-md">
            {copy.title}
          </h2>
          <p className="mt-4 max-w-xl text-lg text-fg-muted">{copy.lead}</p>
          <div className="mt-8">
            <Button href="/docs" size="lg" trailingIcon={<ArrowRight />}>
              {copy.cta}
            </Button>
          </div>
        </div>
        <div className="min-w-0">
          <CodeBlock title={copy.sampleTitle} code={copy.sample} copyable={false} />
          <p className="mt-3 text-sm text-fg-subtle">{copy.sampleNote}</p>
        </div>
      </div>
    </section>
  );
}

/** The public landing page body. Wrap in `<PublicShell>`. All wording comes from landing-copy.ts. */
export function Landing() {
  const live = liveThreshold();
  return (
    <>
      <Hero live={live} />
      <Facts />
      <Verification />
      <Donor />
      <Partner />
      <Honesty limitsProvisional={live?.result.provisional ?? true} />
      <Care />
      <Developers />
    </>
  );
}
