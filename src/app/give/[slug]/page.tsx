import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { FocusShell } from "@/components/layout";
import { Alert, Button } from "@/components/ui";
import {
  CheckoutForm,
  CheckoutProvider,
  checkoutCookieName,
  checkoutPaths,
  GiftIntro,
  LiveTaxMathPanel,
  newGiftAction,
  resolveCheckout,
  SgoSummary,
  slugSchema,
  standingPanel,
  TaxMathPanel,
  usStateOptions,
} from "@/features/checkout";
import { SandboxBanner } from "@/features/payments";
import { getSetting } from "@/server/settings";
import { getPublicSgo, isGiftableStatus } from "@/server/sgos";

export const metadata: Metadata = { title: "Give", robots: { index: false } };

type Params = Promise<{ slug: string }>;

const ENDED_MESSAGE = {
  expired: "Your earlier checkout expired after a few days without changes, so nothing was saved from it. Start again below.",
  canceled: "Your earlier checkout was canceled. Start again below.",
  unknown: "Your earlier checkout could not be found. Start again below.",
} as const;

/**
 * The hosted checkout for one organization: the start screen, the checkout in progress (resumed from this browser's
 * cookie), or a note that this browser's last gift here is complete.
 */
export default async function GiveToSgoPage({ params }: { params: Params }) {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const slug = parsed.data;
  const sgo = await getPublicSgo(slug);
  if (!sgo) notFound();

  const token = (await cookies()).get(checkoutCookieName(slug))?.value ?? null;
  const resolved = await resolveCheckout(token, slug);
  const partner = { name: sgo.displayName, logoUrl: sgo.logoUrl };

  if (resolved.kind === "active") {
    const { view, payment } = resolved.loaded;
    return (
      <CheckoutProvider access={{ kind: "hosted", slug }} initialView={view} initialPayment={payment} returnUrl={checkoutPaths({ kind: "hosted", slug }).thanks}>
        <FocusShell partner={partner} banner={view.mode === "test" ? <SandboxBanner /> : undefined} aside={<LiveTaxMathPanel />} secureNote="donor">
          <CheckoutForm states={usStateOptions()} />
        </FocusShell>
      </CheckoutProvider>
    );
  }

  const live = await getSetting("gifts.liveEnabled");
  if (resolved.kind === "completed") {
    return (
      <FocusShell partner={partner} banner={live ? undefined : <SandboxBanner />} secureNote="donor" width="lg">
        <div className="space-y-5" data-testid="checkout-complete">
          <h1 className="text-2xl font-semibold text-fg">Your gift to {sgo.displayName} is complete</h1>
          <p className="text-fg-muted">This browser&rsquo;s last checkout for this organization has been paid.</p>
          <div className="flex flex-wrap gap-3">
            <Button href={checkoutPaths({ kind: "hosted", slug }).thanks}>View the receipt</Button>
            <form action={newGiftAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="secondary">
                Make another gift
              </Button>
            </form>
          </div>
        </div>
      </FocusShell>
    );
  }

  const canStart = isGiftableStatus(sgo.list.status);
  return (
    <FocusShell partner={partner} banner={live ? undefined : <SandboxBanner />} aside={<TaxMathPanel panel={standingPanel()} />} secureNote="donor">
      <div className="space-y-6">
        <SgoSummary sgo={sgo} />
        {resolved.kind === "ended" ? (
          <Alert tone="info" role="status">
            <p>{ENDED_MESSAGE[resolved.reason]}</p>
          </Alert>
        ) : null}
        <GiftIntro slug={slug} surface="hosted" canStart={canStart} />
      </div>
    </FocusShell>
  );
}
