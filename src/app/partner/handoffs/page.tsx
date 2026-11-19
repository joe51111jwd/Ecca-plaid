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
            { key: "booking", header: "Booking", primary: true, cell: (r) => <span className="font-medium">{r.handoff.bookingRef}</span> },
            { key: "description", header: "What", cell: (r) => r.handoff.bookingDescription ?? "—", wrap: true },
            { key: "status", header: "Status", cell: (r) => <StatusBadge kind="handoff" status={r.handoff.status} size="sm" /> },
            { key: "sgo", header: "Scholarship organization", cell: (r) => r.related.sgoName ?? "Family choosing" },
            { key: "amount", header: "Booking total", numeric: true, cell: (r) => (r.handoff.bookingAmountCents === null ? "—" : <Money cents={r.handoff.bookingAmountCents} />) },
            { key: "hold", header: "Hold ends", cell: (r) => (r.handoff.holdExpiresAt && isHolding(r.handoff.status) ? formatDeadline("en", r.handoff.holdExpiresAt) : "—") },
            { key: "created", header: "Started", cell: (r) => <DateTime value={r.handoff.createdAt} format="dateTime" /> },
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
