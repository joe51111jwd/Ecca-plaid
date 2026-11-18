import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { LineItems, Money } from "@/components/ui";
import { SandboxBanner, SandboxHostedPayment } from "@/features/payments";
import { getSandboxPaymentView } from "@/server/payments";
import { assertSandboxPagesEnabled, firstParam, orNotFound, safeReturnPath } from "../../shared";

export const metadata: Metadata = {
  title: "Sandbox payment",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ key?: string | string[]; return_url?: string | string[] }>;
}

/**
 * The sandbox processor's hosted pay page: /sandbox/pay/{paymentId}?key={secret}[&return_url=/path]
 *
 * It stands where a real processor's payment page would. Whoever has the link (the payment's secret is part
 * of it) can complete the test payment with one of the documented test numbers. No money moves.
 */
export default async function SandboxPayPage({ params, searchParams }: PageProps) {
  assertSandboxPagesEnabled();
  const [{ paymentId }, query] = await Promise.all([params, searchParams]);
  const view = await orNotFound(() => getSandboxPaymentView(paymentId, firstParam(query.key)));
  const returnPath = safeReturnPath(firstParam(query.return_url));

  return (
    <FocusShell banner={<SandboxBanner />} homeHref={null} width="lg" secureNote="This is a sandbox page. Nothing you type here is stored, and nothing is charged.">
      <div className="space-y-6">
        <header>
          <p className="text-sm font-semibold tracking-wide text-caution-fg uppercase">Test payment</p>
          <h1 className="mt-1 font-display text-display-sm text-fg">{view.payeeName ? `Payment to ${view.payeeName}` : "Sandbox payment"}</h1>
          {view.description ? <p className="mt-2 text-base text-fg-muted">{view.description}</p> : null}
        </header>

        {view.lines.length > 1 ? (
          <LineItems
            label="What this payment is made of"
            showCents
            items={view.lines.map((line) => ({ label: line.description, amountCents: line.amountCents }))}
            total={{ label: "Total (sandbox, not charged)", amountCents: view.amountCents }}
          />
        ) : (
          <p className="flex items-baseline justify-between gap-4 border-y border-line py-4">
            <span className="text-base font-medium text-fg">Amount (sandbox, not charged)</span>
            <Money cents={view.amountCents} showCents className="text-2xl font-semibold text-fg" />
          </p>
        )}

        <SandboxHostedPayment view={view} returnPath={returnPath} />
      </div>
    </FocusShell>
  );
}
