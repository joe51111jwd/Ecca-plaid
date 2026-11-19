import { CircleAlert, CircleCheck, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import { Button, Card, CardHeader, EmptyState, PageHeader, Section, Stat, StatGrid, StatusBadge, Table, TextLink } from "@/components/ui";
import { buildFunnel, timeUntil } from "@/features/handoff/portal";
import { PORTAL_HOME } from "@/features/handoff/policy";
import { requirePortalPage, type SearchParams } from "@/features/handoff/server/context";
import { listExpiringHolds } from "@/features/handoff/server/queries";
import { now } from "@/lib/clock";
import { listPartnershipsForBusiness } from "@/server/businesses";
import { formatDeadline, handoffConversionStats } from "@/server/handoffs";
import { PortalFrame } from "./_frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home · Business portal", robots: { index: false, follow: false } };

/** /partner — conversion funnel, holds expiring soon, and what is left to set up. */
export default async function PartnerHome({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePortalPage(PORTAL_HOME, await searchParams);
  const at = now();
  const [stats, expiring, partnerships] = await Promise.all([
    handoffConversionStats(ctx.org.id, { mode: ctx.mode }),
    listExpiringHolds(ctx.org.id, ctx.mode, at),
    listPartnershipsForBusiness(ctx.org.id),
  ]);
  const funnel = buildFunnel(stats);
  const activePartners = partnerships.filter((p) => p.partnership.status === "active").length;
  const setup = [
    { done: ctx.profile.allowedOrigins.length > 0, label: "Allow the website where your booking checkout lives", href: ctx.href(`${PORTAL_HOME}/install`) },
    { done: activePartners > 0, label: "Partner with at least one scholarship organization", href: ctx.href(`${PORTAL_HOME}/settings`) },
    { done: stats.total > 0, label: "Start a first handoff (test mode is fine)", href: ctx.href(`${PORTAL_HOME}/install`) },
  ];

  return (
    <PortalFrame ctx={ctx} path={PORTAL_HOME}>
      <PageHeader className="mb-8" title={ctx.profile.displayName} description="Families who start a scholarship check from your booking checkout, and what happened next." />

      {setup.some((s) => !s.done) ? (
        <Card className="mb-8" padding="none">
          <CardHeader title="Finish setting up" description="The scholarship button works once these are done." divided />
          <ul className="divide-y divide-line">
            {setup.map((s) => (
              <li key={s.label} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                {s.done ? <CircleCheck aria-hidden="true" className="size-5 text-success-fg" /> : <CircleAlert aria-hidden="true" className="size-5 text-warning-fg" />}
                <span className="flex-1 text-sm">{s.done ? <s className="text-fg-muted">{s.label}</s> : s.label}</span>
                {s.done ? <span className="sr-only">Done</span> : <TextLink href={s.href}>Do this</TextLink>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Section title="Conversion" description="Each step counts the handoffs that reached it. Eligible is not an award: the scholarship organization decides separately.">
        <StatGrid columns={4} tiles>
          {funnel.steps.map((s) => (
            <Stat key={s.key} label={s.label} value={s.count} hint={`${s.share} of handoffs · ${s.description}`} />
          ))}
        </StatGrid>
        <p className="mt-4 text-sm text-fg-muted">
          {funnel.holding} reservation{funnel.holding === 1 ? "" : "s"} on hold now · {funnel.ended.declined} declined · {funnel.ended.expired} hold{funnel.ended.expired === 1 ? "" : "s"} expired · {funnel.ended.canceled} canceled
        </p>
      </Section>

      <Section title="Holds expiring in the next 24 hours" className="mt-10" actions={<Button href={ctx.href(`${PORTAL_HOME}/handoffs`)} variant="secondary" size="sm">All handoffs</Button>}>
        <Card padding="none">
          <Table
            caption="Holds expiring soon"
            rows={expiring}
            rowKey={(r) => r.id}
            rowHref={(r) => ctx.href(`${PORTAL_HOME}/handoffs/${r.id}`)}
            columns={[
              { key: "booking", header: "Booking", primary: true, cell: (r) => <span className="font-medium">{r.bookingRef}</span> },
              { key: "description", header: "What", cell: (r) => r.bookingDescription ?? "—", wrap: true },
              { key: "status", header: "Status", cell: (r) => <StatusBadge kind="handoff" status={r.status} size="sm" /> },
              { key: "deadline", header: "Hold ends", cell: (r) => `${formatDeadline("en", r.holdExpiresAt)} (${timeUntil(r.holdExpiresAt, at)})` },
            ]}
            empty={<EmptyState size="sm" icon={<Hourglass />} title="No holds end in the next 24 hours" description="Extend a hold from the handoff's page if a family needs more time." />}
          />
        </Card>
      </Section>
    </PortalFrame>
  );
}
