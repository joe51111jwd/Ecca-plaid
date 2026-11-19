import { CircleDashed, Eye, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import { Button, Card, CardFooter, DateTime, EmptyState, Field, Input, Money, PageHeader, Pagination, StatusBadge, Table, Tabs, type TableColumn } from "@/components/ui";
import type { VerificationStatus } from "@/db/schema";
import { now } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { roleAtLeast } from "@/server/auth";
import { applicantLabels, listVerifications, statusCounts, type VerificationRow } from "@/server/verifications";
import { SGO_PATHS } from "@/features/sgo/nav";
import { LIST_PAGE_SIZE, REVIEW_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";

export const metadata: Metadata = { title: "Verifications" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUSES: readonly VerificationStatus[] = ["needs_review", "pending", "eligible", "ineligible", "expired", "canceled"];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const COLUMNS: Array<TableColumn<VerificationRow & { label: string }>> = [
  {
    key: "applicant",
    header: "Applicant",
    primary: true,
    wrap: true,
    cell: (v) => (
      <span>
        {v.label}
        <span className="block text-xs font-normal text-fg-muted">{v.externalRef ?? v.id}</span>
      </span>
    ),
  },
  { key: "student", header: "Student", hideWhenStacked: true, cell: (v) => [v.studentFirstName, v.studentLastName].filter(Boolean).join(" ") || <span className="text-fg-subtle">—</span> },
  { key: "status", header: "Status", cell: (v) => <StatusBadge kind="verification" status={v.status} provisional={v.provisional && (v.status === "eligible" || v.status === "ineligible")} size="sm" /> },
  { key: "stage", header: "Stage", cell: (v) => <StatusBadge kind="stage" status={v.stage} size="sm" showIcon={false} /> },
  { key: "method", header: "Method", cell: (v) => (v.method ? <StatusBadge kind="method" status={v.method} size="sm" showIcon={false} /> : <span className="text-fg-subtle">—</span>) },
  {
    key: "limit",
    header: "Limit used",
    numeric: true,
    cell: (v) =>
      v.thresholdCents === null ? (
        <span className="text-fg-subtle">—</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Money cents={v.thresholdCents} />
          {v.provisional ? (
            // The status column carries the full Provisional badge; here a compact marker keeps the column narrow.
            <span title="Provisional (HUD-derived) limit" className="inline-flex text-caution-fg">
              <CircleDashed aria-hidden="true" className="size-3.5" />
              <span className="sr-only">provisional</span>
            </span>
          ) : null}
        </span>
      ),
  },
  { key: "created", header: "Created", numeric: true, cell: (v) => <DateTime value={v.createdAt} format="relative" now={now()} /> },
];

export default async function VerificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = STATUSES.find((s) => s === first(params.status)) ?? null;
  const ref = first(params.ref)?.trim().slice(0, 200) || null;
  const cursor = first(params.cursor)?.slice(0, 200) || null;
  const self = `${SGO_PATHS.verifications}${status ? `?status=${status}` : ""}`;
  const ctx = await requireSgoPage(self);

  const [counts, page] = await Promise.all([
    statusCounts(ctx.org.id, ctx.mode),
    // A tampered or stale cursor shows the first page instead of an error page.
    listVerifications(ctx.org.id, { mode: ctx.mode, status, externalRef: ref, limit: LIST_PAGE_SIZE, cursor }).catch((e: unknown) => {
      if (cursor && isAppError(e) && e.code === "validation_failed") return listVerifications(ctx.org.id, { mode: ctx.mode, status, externalRef: ref, limit: LIST_PAGE_SIZE });
      throw e;
    }),
  ]);

  const labels = await applicantLabels(ctx.org.id, page.items);
  const rows = page.items.map((v) => ({ ...v, label: labels[v.id]! }));

  const href = (q: { status?: string | null; cursor?: string | null }) => {
    const sp = new URLSearchParams();
    if (q.status) sp.set("status", q.status);
    if (ref) sp.set("ref", ref);
    if (q.cursor) sp.set("cursor", q.cursor);
    const s = sp.toString();
    return `${SGO_PATHS.verifications}${s ? `?${s}` : ""}`;
  };
  const canCreate = roleAtLeast(ctx.role, REVIEW_ROLE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verifications"
        description="Every household you have asked to verify, newest first."
        actions={
          canCreate ? (
            <Button href={SGO_PATHS.newVerification} size="sm" leadingIcon={<Plus />}>
              New verification
            </Button>
          ) : null
        }
      />

      <Card padding="none">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 sm:px-6">
          <Tabs
            divider={false}
            label="Filter by status"
            current={href({ status })}
            items={[
              { href: href({}), label: "All", count: counts.total, match: "exact" },
              { href: href({ status: "needs_review" }), label: "Needs review", count: counts.needs_review, icon: <Eye /> },
              { href: href({ status: "pending" }), label: "Pending", count: counts.pending },
              { href: href({ status: "eligible" }), label: "Eligible", count: counts.eligible },
              { href: href({ status: "ineligible" }), label: "Not eligible", count: counts.ineligible },
              { href: href({ status: "expired" }), label: "Expired", count: counts.expired },
              { href: href({ status: "canceled" }), label: "Canceled", count: counts.canceled },
            ]}
          />
          <form method="get" action={SGO_PATHS.verifications} className="flex items-end gap-2 py-2" role="search">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <Field label="Your reference" hideLabel>
              <Input type="search" size="sm" name="ref" defaultValue={ref ?? ""} placeholder="Find by your reference" leading={<Search />} />
            </Field>
            <Button type="submit" size="sm" variant="secondary">
              Find
            </Button>
          </form>
        </div>
        <Table
          caption={status ? `Verifications: ${status.replace("_", " ")}` : "Verifications"}
          density="compact"
          columns={COLUMNS}
          rows={rows}
          rowKey={(v) => v.id}
          rowHref={(v) => SGO_PATHS.verification(v.id)}
          empty={
            <EmptyState
              size="sm"
              title={ref ? "No verification with that reference" : "Nothing here yet"}
              description={ref ? "References match exactly, in the mode on screen. Check the reference, or switch between test and live." : "Create a verification and send the family the link, or create them through the API. Bookings from camps and schools appear here too."}
              action={
                !ref && canCreate ? (
                  <Button href={SGO_PATHS.newVerification} size="sm" leadingIcon={<Plus />}>
                    New verification
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {cursor || page.nextCursor ? (
          <CardFooter>
            <Pagination prevHref={cursor ? href({ status }) : null} nextHref={page.nextCursor ? href({ status, cursor: page.nextCursor }) : null} summary={`${page.items.length} shown${cursor ? " (later page)" : ""}`} />
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
