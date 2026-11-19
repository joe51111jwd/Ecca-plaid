import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Button, Card, CardFooter, DateTime, EmptyState, PageHeader, Pagination, StatusBadge, Table, Tabs, type TableColumn } from "@/components/ui";
import { isAppError } from "@/lib/errors";
import { listReviewQueue, type ReviewQueueItem } from "@/server/verifications";
import { SGO_PATHS } from "@/features/sgo/nav";
import { LIST_PAGE_SIZE, REVIEW_WAITING_LONG_DAYS } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { loadTeam, teamNames } from "@/features/sgo/server/queries";

export const metadata: Metadata = { title: "Review queue" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ReviewQueuePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = first(params.filter) === "unassigned" ? "unassigned" : first(params.filter) === "mine" ? "mine" : "all";
  const cursor = first(params.cursor)?.slice(0, 300) || null;
  const ctx = await requireSgoPage(`${SGO_PATHS.review}${filter === "all" ? "" : `?filter=${filter}`}`);
  const assignedTo = filter === "unassigned" ? null : filter === "mine" ? ctx.user.id : undefined;
  const query = { mode: ctx.mode, limit: LIST_PAGE_SIZE, ...(assignedTo !== undefined ? { assignedTo } : {}) };

  const [page, team] = await Promise.all([
    listReviewQueue(ctx.org.id, { ...query, cursor }).catch((e: unknown) => {
      if (cursor && isAppError(e) && e.code === "validation_failed") return listReviewQueue(ctx.org.id, query);
      throw e;
    }),
    loadTeam(ctx.actor),
  ]);
  const names = teamNames(team);
  const href = (f: string, c?: string | null) => {
    const sp = new URLSearchParams();
    if (f !== "all") sp.set("filter", f);
    if (c) sp.set("cursor", c);
    const s = sp.toString();
    return `${SGO_PATHS.review}${s ? `?${s}` : ""}`;
  };

  const columns: Array<TableColumn<ReviewQueueItem>> = [
    {
      key: "verification",
      header: "Verification",
      primary: true,
      cell: (i) => (
        <span>
          {i.externalRef ?? i.verificationId}
          <span className="block text-xs font-normal text-fg-muted">{i.externalRef ? i.verificationId : null}</span>
        </span>
      ),
    },
    {
      key: "reasons",
      header: "Why it needs a person",
      wrap: true,
      cell: (i) =>
        i.reasons.length === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {i.reasons.map((r) => (
              <li key={r.code}>{r.message}</li>
            ))}
          </ul>
        ),
    },
    {
      key: "state",
      header: "State",
      cell: (i) => (i.waitingOnFamily ? <Badge tone="info" size="sm">Waiting on the family</Badge> : <StatusBadge kind="verification" status={i.status} size="sm" />),
    },
    { key: "assigned", header: "Assigned to", cell: (i) => (i.assignedTo ? (names.get(i.assignedTo) ?? "A former team member") : <span className="text-fg-subtle">No one</span>) },
    {
      key: "age",
      header: "Waiting",
      numeric: true,
      cell: (i) => (
        <span className="inline-flex flex-col items-end">
          <Badge tone={i.ageDays >= REVIEW_WAITING_LONG_DAYS ? "danger" : "neutral"} size="sm">
            {i.ageDays === 0 ? "Today" : `${i.ageDays} day${i.ageDays === 1 ? "" : "s"}`}
          </Badge>
          <span className="text-xs text-fg-muted">
            since <DateTime value={i.createdAt} format="date" />
          </span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Review queue" description="What the automatic check could not decide, oldest first. Families are waiting on these." />
      <Card padding="none">
        <div className="border-b border-line px-5 sm:px-6">
          <Tabs
            divider={false}
            label="Filter the queue"
            current={href(filter)}
            items={[
              { href: href("all"), label: "All open", match: "exact" },
              { href: href("unassigned"), label: "Unassigned", match: "exact" },
              { href: href("mine"), label: "Assigned to me", match: "exact" },
            ]}
          />
        </div>
        <Table
          caption="Open review tasks, oldest first"
          columns={columns}
          rows={page.items}
          rowKey={(i) => i.taskId}
          rowHref={(i) => `${SGO_PATHS.verification(i.verificationId)}#review`}
          empty={
            <EmptyState
              size="sm"
              icon={<CircleCheck />}
              title={filter === "mine" ? "Nothing assigned to you" : filter === "unassigned" ? "Everything is assigned" : "Nothing to review"}
              description={filter === "all" ? "When the check cannot decide on its own, the verification appears here with the reasons. Nothing to do for now." : "See all open reviews to pick one up."}
              action={
                filter === "all" ? undefined : (
                  <Button href={href("all")} size="sm" variant="secondary">
                    All open reviews
                  </Button>
                )
              }
            />
          }
        />
        {cursor || page.nextCursor ? (
          <CardFooter>
            <Pagination prevHref={cursor ? href(filter) : null} nextHref={page.nextCursor ? href(filter, page.nextCursor) : null} summary={`${page.items.length} shown`} />
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
