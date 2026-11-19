import { Ticket } from "lucide-react";
import type { Metadata } from "next";
import { Card, EmptyState, Money, PageHeader, Pagination, StatusBadge, Table, Tabs, DateTime } from "@/components/ui";
import type { HandoffStatus } from "@/db/schema";
import { PORTAL_HOME, PORTAL_PAGE_SIZE } from "@/features/handoff/policy";
import { requirePortalPage, type SearchParams } from "@/features/handoff/server/context";
import { isAppError } from "@/lib/errors";
import { formatDeadline, isHandoffStatus, isHolding, listHandoffs, type HandoffRecord } from "@/server/handoffs";
import { PortalFrame } from "../_frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Handoffs · Business portal", robots: { index: false, follow: false } };

const FILTERS: Array<{ key: string; label: string; status?: HandoffStatus }> = [
  { key: "all", label: "All" },
  { key: "held", label: "Spot held", status: "held" },
  { key: "eligible", label: "Eligible", status: "eligible" },
  { key: "awarded", label: "Awarded", status: "awarded" },
  { key: "completed", label: "Completed", status: "completed" },
  { key: "expired", label: "Expired", status: "expired" },
];

/** "Nov 21, 2:05 PM" in the camp's time zone; the full deadline is in the tooltip. */
const SHORT_DEADLINE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One line, cut with an ellipsis; the whole text is in the tooltip. */
function Clipped({ text, className }: { text: string | null; className: string }) {
  if (!text) return <>—</>;
  return (
    <span className={`block truncate ${className}`} title={text}>
      {text}
    </span>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** /partner/handoffs — every handoff in the selected mode, newest first, filterable by status. */
export default async function HandoffsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const path = `${PORTAL_HOME}/handoffs`;
  const ctx = await requirePortalPage(path, query);
  const rawStatus = first(query.status);
  const status = isHandoffStatus(rawStatus) ? rawStatus : undefined;
  const rawBefore = first(query.before);
  const before = rawBefore && rawBefore.length <= 128 ? rawBefore : undefined;
  let page;
  try {
    page = await listHandoffs(ctx.org.id, { mode: ctx.mode, limit: PORTAL_PAGE_SIZE, ...(status ? { status } : {}), ...(before ? { before } : {}) });
  } catch (e) {
    // A stale or foreign cursor: show the first page rather than an error. Anything else (the database) is real.
    if (!before || !isAppError(e)) throw e;
    page = await listHandoffs(ctx.org.id, { mode: ctx.mode, limit: PORTAL_PAGE_SIZE, ...(status ? { status } : {}) });
  }

  return (
    <PortalFrame ctx={ctx} path={path} width="full">
      <PageHeader className="mb-8" title="Handoffs" description="One row per family that started a scholarship check from your booking checkout. Open one to extend its hold, mark it completed or cancel it." />
      <Tabs
        label="Filter by status"
        variant="pills"
        className="mb-4"
        current={ctx.href(path, { status })}
        items={FILTERS.map((f) => ({ href: ctx.href(path, { status: f.status }), label: f.label }))}
      />
      <Card padding="none">
        <Table<HandoffRecord>
          caption="Handoffs"
          rows={page.data}
          rowKey={(r) => r.handoff.id}
          rowHref={(r) => ctx.href(`${path}/${r.handoff.id}`)}
          density="compact"
          columns={[
            {
              key: "booking",
              header: "Booking",
              primary: true,
              cell: (r) => (
                <span>
                  <span className="font-medium">{r.handoff.bookingRef}</span>
                  <span className="block text-xs font-normal text-fg-muted">
                    Started <DateTime value={r.handoff.createdAt} format="date" />
                  </span>
                </span>
              ),
            },
            { key: "description", header: "What", width: "11rem", cell: (r) => <Clipped text={r.handoff.bookingDescription} className="max-w-[11rem]" /> },
            { key: "status", header: "Status", cell: (r) => <StatusBadge kind="handoff" status={r.handoff.status} size="sm" /> },
            { key: "sgo", header: "Scholarship organization", width: "10rem", cell: (r) => <Clipped text={r.related.sgoName ?? "Family choosing"} className="max-w-[10rem]" /> },
            { key: "amount", header: "Total", numeric: true, cell: (r) => (r.handoff.bookingAmountCents === null ? "—" : <Money cents={r.handoff.bookingAmountCents} />) },
            {
              key: "hold",
              header: "Hold ends",
              cell: (r) =>
                r.handoff.holdExpiresAt && isHolding(r.handoff.status) ? (
                  <time dateTime={r.handoff.holdExpiresAt.toISOString()} title={formatDeadline("en", r.handoff.holdExpiresAt)} className="whitespace-nowrap nums">
                    {SHORT_DEADLINE.format(r.handoff.holdExpiresAt)}
                  </time>
                ) : (
                  "—"
                ),
            },
          ]}
          empty={
            <EmptyState
              icon={<Ticket />}
              title={status ? "No handoffs with this status" : "No handoffs yet"}
              description={status ? "Try another filter." : "They appear here when a family clicks the scholarship button on your booking checkout."}
            />
          }
        />
      </Card>
      <Pagination
        className="mt-4"
        labels={{ previous: "First page" }}
        summary={`${page.data.length} handoff${page.data.length === 1 ? "" : "s"} on this page`}
        prevHref={before ? ctx.href(path, { status }) : null}
        nextHref={page.nextCursor ? ctx.href(path, { status, before: page.nextCursor }) : null}
      />
    </PortalFrame>
  );
}
