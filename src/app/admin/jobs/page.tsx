import type { Metadata } from "next";
import Link from "next/link";
import { Card, DateTime, Disclosure, EmptyState, PageHeader, Pagination, Section, Stat, StatGrid, StatusBadge, Table, cn, type TableColumn } from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { hrefWith, JOB_STATUS_VALUES, JOBS_PAGE_SIZE, parseJobsFilter, RETRYABLE_JOB_STATUSES } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { now } from "@/lib/clock";
import { getJobStats, listJobs, type Job, type JobStats } from "@/server/jobs";
import { retryJobAction } from "../_actions";

export const metadata: Metadata = { title: "Jobs" };

const PATH = "/admin/jobs";
const STATUS_TAB_LABEL = { all: "All", queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Retrying", dead: "Failed" } as const;

type TypeRow = JobStats["byType"][number];

const TYPE_COLUMNS: Array<TableColumn<TypeRow>> = [
  { key: "type", header: "Job type", primary: true, cell: (r) => <span className="font-mono text-xs">{r.type}</span> },
  { key: "queued", header: "Queued", numeric: true, cell: (r) => String(r.queued) },
  { key: "running", header: "Running", numeric: true, cell: (r) => String(r.running) },
  { key: "succeeded", header: "Succeeded", numeric: true, cell: (r) => String(r.succeeded) },
  { key: "dead", header: "Failed", numeric: true, cell: (r) => (r.dead > 0 ? <span className="font-semibold text-danger-fg">{r.dead}</span> : "0") },
];

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const filter = parseJobsFilter(await searchParams);
  const at = now();
  const [stats, page] = await Promise.all([
    getJobStats(),
    listJobs({ status: filter.status === "all" ? undefined : filter.status, type: filter.type, limit: JOBS_PAGE_SIZE + 1, offset: (filter.page - 1) * JOBS_PAGE_SIZE }),
  ]);
  const rows = page.slice(0, JOBS_PAGE_SIZE);
  const hasNext = page.length > JOBS_PAGE_SIZE;
  const base = { status: filter.status, type: filter.type };

  const columns: Array<TableColumn<Job>> = [
    {
      key: "type",
      header: "Job",
      primary: true,
      cell: (j) => (
        <span>
          <span className="font-mono text-xs">{j.type}</span>
          <span className="block text-xs font-normal text-fg-muted">{j.id}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (j) => <StatusBadge kind="job" status={j.status} size="sm" /> },
    { key: "attempts", header: "Attempts", numeric: true, cell: (j) => `${j.attempts} / ${j.maxAttempts}` },
    { key: "runAt", header: "Run at", numeric: true, cell: (j) => <DateTime value={j.runAt} format="relative" now={at} /> },
    {
      key: "error",
      header: "Last error",
      wrap: true,
      cell: (j) =>
        j.lastError ? (
          <Disclosure summary={<span className="line-clamp-1 max-w-md text-sm">{j.lastError.split("\n")[0]}</span>}>
            <pre className="mt-2 max-h-64 overflow-auto rounded-control bg-sunken p-3 font-mono text-xs whitespace-pre-wrap">{j.lastError}</pre>
          </Disclosure>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "retry",
      header: <span className="sr-only">Retry</span>,
      label: "Retry",
      align: "right",
      cell: (j) =>
        RETRYABLE_JOB_STATUSES.includes(j.status) && (j.status !== "queued" || j.attempts > 0) ? (
          <AdminActionForm action={retryJobAction} layout="inline" submitLabel={j.status === "queued" ? "Run now" : "Retry"} submitVariant="secondary" submitSize="sm" aria-label={`Retry job ${j.id}`}>
            <input type="hidden" name="jobId" value={j.id} />
          </AdminActionForm>
        ) : null,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Jobs" description="The background queue. A failed job has used all its attempts and waits for a person; retrying gives it a fresh set of attempts." />

      <StatGrid columns={4} tiles>
        <Stat label="Due now" value={String(stats.due)} hint={stats.oldestDueAt ? <>Oldest since <DateTime value={stats.oldestDueAt} format="relative" now={at} /></> : "Nothing waiting"} />
        <Stat label="Scheduled" value={String(stats.scheduled)} hint="Queued for later" />
        <Stat label="Retrying" value={String(stats.retrying)} />
        <Stat label="Failed" value={String(stats.byStatus.dead)} />
      </StatGrid>

      <Section title="By type">
        <Card padding="none">
          <Table caption="Jobs by type" columns={TYPE_COLUMNS} rows={stats.byType} rowKey={(r) => r.type} density="compact" empty={<EmptyState size="sm" title="No jobs yet" />} />
        </Card>
      </Section>

      <Section title="Jobs" description={filter.type ? `Type ${filter.type}.` : "Newest first."}>
        <nav aria-label="Job status" className="flex flex-wrap gap-2">
          {(["dead", "failed", "queued", "running", "succeeded", "all"] as const).map((s) => (
            <Link
              key={s}
              href={hrefWith(PATH, { status: s, type: filter.type })}
              aria-current={filter.status === s ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium",
                filter.status === s ? "border-brand-line bg-brand-surface text-brand-fg" : "border-line text-fg-muted hover:bg-sunken hover:text-fg",
              )}
            >
              {STATUS_TAB_LABEL[s]}
              {s !== "all" ? <span className="ml-1.5 nums">{stats.byStatus[s as (typeof JOB_STATUS_VALUES)[number]]}</span> : null}
            </Link>
          ))}
        </nav>
        <Card padding="none">
          <Table caption="Jobs" columns={columns} rows={rows} rowKey={(j) => j.id} density="compact" empty={<EmptyState size="sm" title="No jobs with this status" />} />
        </Card>
        <Pagination
          summary={rows.length === 0 ? "No jobs" : `Showing ${(filter.page - 1) * JOBS_PAGE_SIZE + 1}–${(filter.page - 1) * JOBS_PAGE_SIZE + rows.length}`}
          prevHref={filter.page > 1 ? hrefWith(PATH, { ...base, page: filter.page - 1 }) : null}
          nextHref={hasNext ? hrefWith(PATH, { ...base, page: filter.page + 1 }) : null}
        />
      </Section>
    </div>
  );
}
