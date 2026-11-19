import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { Alert, Button, Card, CardHeader, DateTime, EmptyState, Money, PageHeader, Section, Stat, StatGrid, StatusBadge, Table } from "@/components/ui";
import { PORTAL_HOME } from "@/features/handoff/policy";
import { requirePortalPage, type SearchParams } from "@/features/handoff/server/context";
import { feeSummary, listInvoices, listSuccessFees } from "@/server/billing";
import { PortalFrame } from "../_frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing · Business portal", robots: { index: false, follow: false } };

/**
 * /partner/billing — the business's success-fee terms in words, the fees accrued, invoiced and paid, and its invoices
 * with their pay links (the sandbox invoice page in test mode). The family never sees any of this.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const path = `${PORTAL_HOME}/billing`;
  const ctx = await requirePortalPage(path, await searchParams);
  const [summary, invoices, fees] = await Promise.all([feeSummary(ctx.org.id, ctx.mode), listInvoices(ctx.org.id, { mode: ctx.mode }), listSuccessFees(ctx.org.id, { mode: ctx.mode, limit: 50 })]);

  return (
    <PortalFrame ctx={ctx} path={path}>
      <PageHeader className="mb-8" title="Billing" description="You pay a success fee only for bookings completed with scholarship funds, on your own invoice." />

      <Alert tone="legal" title="Your fee terms" className="mb-8">
        <p>{summary.terms.description}</p>
        <p className="mt-2 text-sm">Fee terms are set in your agreement with us. Contact support to change them.</p>
      </Alert>

      <Section title="Success fees">
        <StatGrid columns={3} tiles>
          <Stat label="Accrued, not invoiced yet" value={<Money cents={summary.accrued.cents} showCents />} hint={`${summary.accrued.count} completed booking${summary.accrued.count === 1 ? "" : "s"}`} />
          <Stat label="On open invoices" value={<Money cents={summary.invoiced.cents} showCents />} hint={`${summary.invoiced.count} fee${summary.invoiced.count === 1 ? "" : "s"}`} />
          <Stat label="Paid" value={<Money cents={summary.paid.cents} showCents />} hint={`${summary.paid.count} fee${summary.paid.count === 1 ? "" : "s"}`} />
        </StatGrid>
      </Section>

      <Section title="Invoices" className="mt-10" description="Fees accrued in a month are invoiced early the next month.">
        <Card padding="none">
          <Table
            caption="Invoices"
            rows={invoices}
            rowKey={(r) => r.id}
            columns={[
              { key: "number", header: "Invoice", primary: true, cell: (r) => <span className="font-medium">{r.number}</span> },
              { key: "period", header: "Period", cell: (r) => (r.periodStart && r.periodEnd ? `${r.periodStart} to ${r.periodEnd}` : "—") },
              { key: "status", header: "Status", cell: (r) => <StatusBadge kind="invoice" status={r.status} size="sm" /> },
              { key: "due", header: "Due", cell: (r) => <DateTime value={r.dueAt} /> },
              { key: "total", header: "Total", numeric: true, cell: (r) => <Money cents={r.totalCents} showCents /> },
              {
                key: "pay",
                header: "Pay",
                cell: (r) =>
                  r.status === "open" && r.hostedUrl ? (
                    <Button href={r.hostedUrl} size="sm" variant="secondary" target="_blank" rel="noopener noreferrer">
                      {r.processor === "sandbox" ? "Pay (sandbox)" : "Pay invoice"}
                    </Button>
                  ) : r.status === "paid" ? (
                    <span className="text-sm text-fg-muted">
                      Paid <DateTime value={r.paidAt} />
                    </span>
                  ) : (
                    "—"
                  ),
              },
            ]}
            empty={<EmptyState size="sm" icon={<Receipt />} title="No invoices yet" description="An invoice is created once a month when you have completed scholarship-funded bookings." />}
          />
        </Card>
      </Section>

      <Section title="Fee ledger" className="mt-10" description="One line per completed booking.">
        <Card padding="none">
          <CardHeader title="Recent success fees" divided />
          <Table
            caption="Recent success fees"
            rows={fees}
            rowKey={(r) => r.id}
            density="compact"
            columns={[
              { key: "description", header: "Booking", primary: true, wrap: true, cell: (r) => r.description ?? "Success fee" },
              { key: "status", header: "Status", cell: (r) => <StatusBadge kind="fee" status={r.status} size="sm" /> },
              { key: "date", header: "Date", cell: (r) => <DateTime value={r.createdAt} /> },
              { key: "amount", header: "Fee", numeric: true, cell: (r) => <Money cents={r.amountCents} showCents /> },
            ]}
            empty={<EmptyState size="sm" title="No success fees yet" description="A fee is recorded when you mark a scholarship-funded booking completed." />}
          />
        </Card>
      </Section>
    </PortalFrame>
  );
}
