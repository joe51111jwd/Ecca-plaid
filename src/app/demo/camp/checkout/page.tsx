import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { CampShell } from "@/features/handoff/components/demo/CampShell";
import { EmbedScriptMount } from "@/features/handoff/components/demo/EmbedScriptMount";
import { HostEventLog } from "@/features/handoff/components/demo/HostEventLog";
import { demoBookingDescription, findDemoSession, newDemoBookingRef } from "@/features/handoff/demo";
import { DEMO_CAMP_HOME, demoEnabled, EMBED_SCRIPT_PATH } from "@/features/handoff/policy";
import { getDemoCamp } from "@/features/handoff/server/demo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout · Camp Cedar Creek (demo)", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /demo/camp/checkout?session=… — the fictional camp's checkout, with the real embed script installed against the
 * seeded demo business (its publishable key; this app's origin is on its allowed list). Each visit is a new booking.
 */
export default async function DemoCheckout({ searchParams }: Props) {
  if (!demoEnabled()) notFound();
  const query = await searchParams;
  const session = findDemoSession(query.session);
  const camp = await getDemoCamp();
  if (!session || session.spotsLeft === 0 || !camp?.sgoOrgId) redirect(DEMO_CAMP_HOME);
  const inline = (Array.isArray(query.mode) ? query.mode[0] : query.mode) === "inline";
  const bookingRef = newDemoBookingRef();
  const statusPath = `/demo/camp/booking/${bookingRef}`;

  return (
    <CampShell>
      <h1 className="text-3xl font-bold">Checkout</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-6">
          <div className="rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-5">
            <h2 className="text-lg font-semibold">{session.name}</h2>
            <p className="text-sm text-[#4a5a4f]">
              {session.dates} · {session.ages}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[#4a5a4f]">Booking</dt>
              <dd className="font-mono">{bookingRef}</dd>
              <dt className="text-[#4a5a4f]">Total</dt>
              <dd className="font-semibold">{formatUsd(session.priceCents)}</dd>
            </dl>
          </div>

          <div className="rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-5">
            <h2 className="text-lg font-semibold">Pay by card</h2>
            <p className="mt-1 text-sm text-[#4a5a4f]">Card payment is not part of this demo.</p>
            <button type="button" disabled className="mt-3 inline-flex h-11 items-center rounded-lg bg-[#d9d2bf] px-5 font-semibold text-[#5b6a5f]">
              Pay {formatUsd(session.priceCents)}
            </button>
          </div>

          <div className="rounded-xl border-2 border-[#1f5c3f] bg-[#fffdf7] p-5">
            <h2 className="text-lg font-semibold">Or pay with a scholarship</h2>
            <p className="mt-1 mb-4 text-sm text-[#4a5a4f]">
              We hold your spot while a partner scholarship organization checks whether your family qualifies.{" "}
              <Link className="underline" href={`/demo/camp/checkout?session=${session.id}${inline ? "" : "&mode=inline"}`}>
                {inline ? "Use the redirect version" : "Try the inline version"}
              </Link>
            </p>
            <EmbedScriptMount
              scriptSrc={`${camp.origin}${EMBED_SCRIPT_PATH}`}
              data={{
                "publishable-key": camp.publishableKey,
                "booking-ref": bookingRef,
                "booking-description": demoBookingDescription(session),
                "booking-amount-cents": String(session.priceCents),
                "return-url": `${camp.origin}${statusPath}`,
                mode: inline ? "inline" : "button",
              }}
            />
          </div>
        </section>

        <aside className="self-start rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-5">
          <HostEventLog statusHref={statusPath} />
        </aside>
      </div>
    </CampShell>
  );
}
