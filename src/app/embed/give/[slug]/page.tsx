import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedShell } from "@/components/layout";
import { GiftIntro, SgoSummary, slugSchema, standingPanel, TaxMathPanel } from "@/features/checkout";
import { SandboxNotice } from "@/features/payments";
import { getSetting } from "@/server/settings";
import { getPublicSgo, isGiftableStatus } from "@/server/sgos";

export const metadata: Metadata = { title: "Give", robots: { index: false } };

type Params = Promise<{ slug: string }>;

/**
 * The widget's start screen, framed on the organization's own site by /embed/donate.js. Starting a gift moves the
 * frame to /embed/give/{slug}/{token}: the checkout is carried in the frame's URL because cookies set inside another
 * site's iframe are blocked by most browsers.
 */
export default async function EmbedGivePage({ params }: { params: Params }) {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const sgo = await getPublicSgo(parsed.data);
  if (!sgo) notFound();
  const live = await getSetting("gifts.liveEnabled");
  return (
    <EmbedShell partner={{ name: sgo.displayName, logoUrl: sgo.logoUrl }} secureNote="donor">
      <div className="space-y-6">
        {live ? null : <SandboxNotice />}
        <div className="rounded-panel border border-line bg-surface p-5 shadow-sm">
          <div className="space-y-6">
            <SgoSummary sgo={sgo} />
            <GiftIntro slug={sgo.slug} surface="widget" canStart={isGiftableStatus(sgo.list.status)} />
          </div>
        </div>
        <TaxMathPanel panel={standingPanel()} />
      </div>
    </EmbedShell>
  );
}
