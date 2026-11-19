import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedShell } from "@/components/layout";
import { Alert, Button } from "@/components/ui";
import { CheckoutForm, CheckoutProvider, checkoutPaths, LiveTaxMathPanel, resolveCheckout, slugSchema, tokenSchema, usStateOptions } from "@/features/checkout";
import { getPublicSgo } from "@/server/sgos";

export const metadata: Metadata = { title: "Give", robots: { index: false }, referrer: "no-referrer" };

type Params = Promise<{ slug: string; token: string }>;

/** The widget checkout in progress. The token in the path is the checkout's bearer credential (see features/checkout/access.ts). */
export default async function EmbedCheckoutPage({ params }: { params: Params }) {
  const raw = await params;
  const slug = slugSchema.safeParse(raw.slug);
  const token = tokenSchema.safeParse(raw.token);
  if (!slug.success) notFound();
  const sgo = await getPublicSgo(slug.data);
  if (!sgo) notFound();
  const partner = { name: sgo.displayName, logoUrl: sgo.logoUrl };
  const resolved = token.success ? await resolveCheckout(token.data, slug.data) : ({ kind: "ended", reason: "unknown" } as const);
  const start = checkoutPaths({ kind: "widget", slug: slug.data, token: "" }).start;

  if (resolved.kind === "completed" && token.success) {
    return (
      <EmbedShell partner={partner} secureNote="donor">
        <div className="space-y-4 rounded-panel border border-line bg-surface p-5" data-testid="checkout-complete">
          <h1 className="text-xl font-semibold text-fg">This gift is complete</h1>
          <div className="flex flex-wrap gap-3">
            <Button href={checkoutPaths({ kind: "widget", slug: slug.data, token: token.data }).thanks}>View the receipt</Button>
            <Button href={start} variant="secondary">
              Make another gift
            </Button>
          </div>
        </div>
      </EmbedShell>
    );
  }

  if (resolved.kind !== "active" || !token.success) {
    return (
      <EmbedShell partner={partner} secureNote="donor">
        <Alert tone="info" role="status" title="This checkout is no longer open" actions={<Button href={start}>Start a new gift</Button>}>
          <p>It expired, was canceled, or the link is not complete. Nothing was charged from it.</p>
        </Alert>
      </EmbedShell>
    );
  }

  const { view, payment } = resolved.loaded;
  const access = { kind: "widget", slug: slug.data, token: token.data } as const;
  return (
    <EmbedShell partner={partner} secureNote="donor">
      <CheckoutProvider access={access} initialView={view} initialPayment={payment} returnUrl={checkoutPaths(access).thanks}>
        <div className="space-y-6">
          <div className="rounded-panel border border-line bg-surface p-5 shadow-sm">
            <CheckoutForm states={usStateOptions()} />
          </div>
          <LiveTaxMathPanel />
        </div>
      </CheckoutProvider>
    </EmbedShell>
  );
}
