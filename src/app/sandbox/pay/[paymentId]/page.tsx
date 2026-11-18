import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { PaymentForm, SandboxBanner } from "@/features/payments";
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
 * of it) can complete the test payment with one of the documented test numbers. No money moves. With a
 * `return_url` (a path on this site) the payer is sent on once the payment has succeeded or is pending.
 */
export default async function SandboxPayPage({ params, searchParams }: PageProps) {
  assertSandboxPagesEnabled();
  const [{ paymentId }, query] = await Promise.all([params, searchParams]);
  const { payment, payeeName } = await orNotFound(() => getSandboxPaymentView(paymentId, firstParam(query.key)));
  const returnPath = safeReturnPath(firstParam(query.return_url));

  return (
    <FocusShell banner={<SandboxBanner />} homeHref={null} width="lg" secureNote="This is a sandbox page. Nothing you type here is stored, and nothing is charged.">
      <div className="space-y-6">
        <header>
          <p className="text-sm font-semibold tracking-wide text-caution-fg uppercase">Test payment</p>
          <h1 className="mt-1 font-display text-display-sm text-fg">{payeeName ? `Payment to ${payeeName}` : "Sandbox payment"}</h1>
          {payment.description ? <p className="mt-2 text-base text-fg-muted">{payment.description}</p> : null}
        </header>
        {/* The page banner already says "sandbox"; the form's own notice would repeat it. */}
        <PaymentForm payment={payment} returnUrl={returnPath ?? undefined} showSandboxNotice={false} refreshWhilePending />
      </div>
    </FocusShell>
  );
}
