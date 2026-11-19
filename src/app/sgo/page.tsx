import { CircleCheck, CircleDashed, Plus, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Alert, Badge, Button, Card, CardHeader, DateTime, EmptyState, PageHeader, ProvisionalBadge, Stat, StatGrid, StatusBadge, Table, TextLink, type TableColumn } from "@/components/ui";
import { getActiveTable } from "@/engine/ami";
import { now } from "@/lib/clock";
import type { VerificationRow } from "@/server/verifications";
import { SGO_PATHS } from "@/features/sgo/nav";
import { REVIEW_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { loadHome } from "@/features/sgo/server/queries";
import { roleAtLeast } from "@/server/auth";

export const metadata: Metadata = { title: "Home" };

const RECENT: Array<TableColumn<VerificationRow>> = [
  {
    key: "who",
    header: "Applicant",
    primary: true,
    cell: (v) => (
      <span>
        {v.applicantName ?? v.applicantEmail ?? "No name given"}
        <span className="block text-xs font-normal text-fg-muted">{v.externalRef ?? v.id}</span>
      </span>
    ),
  },
  { key: "status", header: "Status", cell: (v) => <StatusBadge kind="verification" status={v.status} provisional={v.provisional && (v.status === "eligible" || v.status === "ineligible")} size="sm" /> },
  { key: "stage", header: "Stage", cell: (v) => <StatusBadge kind="stage" status={v.stage} size="sm" showIcon={false} />, hideWhenStacked: true },
  { key: "created", header: "Created", numeric: true, cell: (v) => <DateTime value={v.createdAt} format="relative" now={now()} /> },
];

export default async function SgoHomePage() {
  const ctx = await requireSgoPage("/sgo");
  const home = await loadHome(ctx.actor);
  const { counts, checklist, attention, deadlines, worklist } = home;
  const canReview = roleAtLeast(ctx.role, REVIEW_ROLE);

  return (
    <div className="space-y-8">
      <PageHeader
        title={ctx.profile.displayName || ctx.org.name}
        description="Income verifications, gifts, acknowledgments and the IRS report for your organization."
        actions={
          canReview ? (
            <Button href={SGO_PATHS.newVerification} size="sm" leadingIcon={<Plus />}>
              New verification
            </Button>
          ) : null
        }
      />

      <section aria-labelledby="attention-heading" className="space-y-3">
        <h2 id="attention-heading" className="text-lg font-semibold text-fg">
          Needs your attention
        </h2>
        {attention.length === 0 ? (
          <Alert tone="success" title="Nothing is waiting on you">
            <p>No reviews are waiting, no acknowledgments are blocked and no deadline is close.</p>
          </Alert>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {attention.map((item) => (
              <li key={item.key}>
                <Alert tone={item.tone === "info" ? "info" : item.tone} title={item.title} actions={<TextLink href={item.href}>{item.actionLabel}</TextLink>}>
                  <p>{item.body}</p>
                </Alert>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="counts-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="counts-heading" className="text-lg font-semibold text-fg">
            Verifications by status
          </h2>
          {getActiveTable().provisional ? <ProvisionalBadge size="sm">Income limits are HUD-derived and provisional</ProvisionalBadge> : null}
        </div>
        <StatGrid columns={4} tiles>
          <Stat label="Needs review" value={<TextLink href={`${SGO_PATHS.verifications}?status=needs_review`}>{counts.needs_review}</TextLink>} hint={home.reviews.oldestAgeDays === null ? undefined : home.reviews.oldestAgeDays === 0 ? "Oldest arrived today" : `Oldest waiting ${home.reviews.oldestAgeDays} days`} />
          <Stat label="Pending with family" value={<TextLink href={`${SGO_PATHS.verifications}?status=pending`}>{counts.pending}</TextLink>} />
          <Stat label="Eligible" value={<TextLink href={`${SGO_PATHS.verifications}?status=eligible`}>{counts.eligible}</TextLink>} hint="Not an award" />
          <Stat label="Not eligible" value={<TextLink href={`${SGO_PATHS.verifications}?status=ineligible`}>{counts.ineligible}</TextLink>} />
          <Stat label="Expired" value={counts.expired} />
          <Stat label="Canceled" value={counts.canceled} />
          <Stat label="All" value={counts.total} />
        </StatGrid>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padding="none">
          <CardHeader title="Recent verifications" divided actions={<TextLink href={SGO_PATHS.verifications}>See all</TextLink>} />
          <Table
            caption="Recent verifications"
            density="compact"
            columns={RECENT}
            rows={home.recent}
            rowKey={(v) => v.id}
            rowHref={(v) => SGO_PATHS.verification(v.id)}
            empty={<EmptyState size="sm" title="No verifications yet" description="Create one here, or through the API, and send the family the link." />}
          />
        </Card>

        <Card>
          <CardHeader title={`Reporting for gifts made in ${home.reportingYear}`} description="Your organization's duties as an SGO under the temporary rules." level={2} />
          <dl className="mt-4 space-y-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <dt className="font-semibold text-fg">Donor acknowledgments</dt>
                <dd className="text-fg-muted">
                  Due <DateTime value={deadlines.acknowledgment.dueDate} format="date" /> · {worklist ? `${worklist.counts.outstanding} of ${worklist.counts.donors} donors need action` : "No donors yet"}
                </dd>
              </div>
              <Badge tone={deadlines.acknowledgment.state === "upcoming" ? "neutral" : deadlines.acknowledgment.state === "approaching" ? "warning" : "danger"}>{deadlines.acknowledgment.label}</Badge>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <dt className="font-semibold text-fg">IRS contribution report</dt>
                <dd className="text-fg-muted">
                  Due <DateTime value={deadlines.report.dueDate} format="date" /> · {home.reportSubmitted ? "Recorded as entered in the IRS SGO portal" : "Not recorded as submitted yet"}
                </dd>
              </div>
              <Badge tone={home.reportSubmitted ? "success" : deadlines.report.state === "upcoming" ? "neutral" : deadlines.report.state === "approaching" ? "warning" : "danger"}>
                {home.reportSubmitted ? "Submitted" : deadlines.report.label}
              </Badge>
            </div>
          </dl>
          <p className="mt-4 text-sm">
            <TextLink href={`${SGO_PATHS.acknowledgments}?year=${home.reportingYear}`}>Acknowledgments</TextLink> · <TextLink href={`${SGO_PATHS.irsReport}?year=${home.reportingYear}`}>IRS report</TextLink>
          </p>
        </Card>
      </div>

      <section id="setup" aria-labelledby="setup-heading">
        <Card>
          <CardHeader
            title="Setup checklist"
            description={checklist.complete ? "Every step is done." : `${checklist.items.filter((i) => i.done).length} of ${checklist.items.length} steps done.`}
            actions={checklist.listStatus.status === "provisional" ? <ProvisionalBadge size="sm">Provisional list</ProvisionalBadge> : null}
          />
          <ol className="mt-4 divide-y divide-line">
            {checklist.items.map((item) => (
              <li key={item.key} className="flex items-start gap-3 py-3">
                <span aria-hidden="true" className="mt-0.5 [&>svg]:size-5">
                  {item.done ? <CircleCheck className="text-success-fg" /> : item.blocked ? <TriangleAlert className="text-warning-fg" /> : <CircleDashed className="text-fg-subtle" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">
                    {item.title} <span className="sr-only">{item.done ? "(done)" : item.blocked ? "(blocked)" : "(to do)"}</span>
                  </p>
                  <p className="text-sm text-fg-muted">{item.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
