import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Alert, DateTime, KeyValue, KeyValueList, LineItems, StatusBadge } from "@/components/ui";
import { SandboxBanner, SandboxInvoicePayButton } from "@/features/payments";
import { BRAND } from "@/lib/brand";
import { getSandboxInvoiceView } from "@/server/payments";
import { assertSandboxPagesEnabled, firstParam, orNotFound } from "../../shared";

export const metadata: Metadata = {
  title: "Sandbox invoice",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ key?: string | string[] }>;
}

/**
 * The sandbox processor's hosted invoice page: /sandbox/invoice/{invoiceId}?key={secret}
 *
 * It stands where a real processor's hosted invoice would: the business opens it from the invoice email.
 * "Mark paid (sandbox)" reports the invoice as paid. No money moves.
 */
export default async function SandboxInvoicePage({ params, searchParams }: PageProps) {
  assertSandboxPagesEnabled();
  const [{ invoiceId }, query] = await Promise.all([params, searchParams]);
  const { invoice, lines, businessName, key } = await orNotFound(() => getSandboxInvoiceView(invoiceId, firstParam(query.key)));
  const payable = invoice.status === "open" || invoice.status === "uncollectible";

  return (
    <FocusShell
      banner={<SandboxBanner>This is a test invoice. Nothing is owed and no payment is taken.</SandboxBanner>}
      homeHref={null}
      width="lg"
      secureNote="This is a sandbox page. No payment details are collected here."
    >
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-wide text-caution-fg uppercase">Test invoice</p>
            <h1 className="mt-1 font-display text-display-sm text-fg" data-testid="sandbox-invoice-number">
              Invoice {invoice.number}
            </h1>
            <p className="mt-2 text-base text-fg-muted">From {BRAND.name}</p>
          </div>
          <StatusBadge kind="invoice" status={invoice.status} />
        </header>

        <KeyValueList layout="grid" columns={2}>
          <KeyValue label="Billed to">{businessName ?? "—"}</KeyValue>
          <KeyValue label="Issued">
            <DateTime value={invoice.issuedAt} format="dateLong" />
          </KeyValue>
          <KeyValue label="Due">
            <DateTime value={invoice.dueAt} format="dateLong" />
          </KeyValue>
          {invoice.periodStart || invoice.periodEnd ? (
            <KeyValue label="Period">
              <DateTime value={invoice.periodStart} /> – <DateTime value={invoice.periodEnd} />
            </KeyValue>
          ) : null}
        </KeyValueList>

        <LineItems
          label={`Lines of invoice ${invoice.number}`}
          showCents
          items={lines.map((line) => ({ label: line.description, amountCents: line.amountCents }))}
          total={{ label: payable ? "Amount due (sandbox, not owed)" : "Total", amountCents: invoice.totalCents }}
        />

        {payable ? <SandboxInvoicePayButton invoiceId={invoice.id} invoiceKey={key} /> : null}
        {invoice.status === "paid" ? (
          <Alert tone="success" role="status" title="Paid (sandbox)">
            <p>
              This test invoice was marked paid on <DateTime value={invoice.paidAt} format="dateLong" />. No money moved.
            </p>
          </Alert>
        ) : null}
        {invoice.status === "void" ? (
          <Alert tone="neutral" title="This invoice was voided">
            <p>It is no longer owed and cannot be paid.</p>
          </Alert>
        ) : null}
      </div>
    </FocusShell>
  );
}
