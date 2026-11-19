import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/features/handoff/components/demo/AutoRefresh";
import { CampShell } from "@/features/handoff/components/demo/CampShell";
import { isDemoBookingRef } from "@/features/handoff/demo";
import { DEMO_CAMP_HOME, DEMO_STATUS_POLL_INTERVAL_MS, demoEnabled } from "@/features/handoff/policy";
import { getDemoBooking, getDemoCamp } from "@/features/handoff/server/demo";
import { formatDeadline, isFinal } from "@/server/handoffs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking status · Camp Cedar Creek (demo)", robots: { index: false, follow: false } };

const CAMP_WORDS: Record<string, { title: string; body: string }> = {
  started: { title: "Spot on hold", body: "The family has the scholarship link. We are holding the spot." },
  verifying: { title: "Spot on hold", body: "The family is checking whether they qualify. We are holding the spot." },
  held: { title: "Spot on hold", body: "The family submitted. Waiting on the result or the scholarship organization's decision." },
  eligible: { title: "Spot on hold: eligible", body: "The family's income was verified. The scholarship organization still decides whether to award. Not paid yet." },
  awarded: { title: "Scholarship offered", body: "The scholarship organization offered an award. The camp confirms the booking once it is completed with scholarship funds." },
  completed: { title: "Booking confirmed", body: "Completed with scholarship funds." },
  declined: { title: "No scholarship", body: "The hold ended. The family can still book and pay another way." },
  expired: { title: "Hold expired", body: "The hold window passed without an award." },
  canceled: { title: "Canceled", body: "The scholarship check was canceled." },
};

/**
 * /demo/camp/booking/{ref} — the fictional camp's own record of a booking: what its server learns from the handoff
 * API (GET /api/v1/handoffs/{id}) and the handoff.* webhook events. The family lands here from "Return to …".
 */
export default async function DemoBookingStatus({ params }: { params: Promise<{ ref: string }> }) {
  if (!demoEnabled()) notFound();
  const { ref } = await params;
  if (!isDemoBookingRef(ref)) notFound();
  const camp = await getDemoCamp();
  if (!camp) notFound();
  const state = await getDemoBooking(camp, ref);

  return (
    <CampShell>
      <AutoRefresh intervalMs={DEMO_STATUS_POLL_INTERVAL_MS} enabled={!state || !isFinal(state.handoff.status)} />
      <p className="text-sm text-[#4a5a4f]">
        <Link className="underline" href={DEMO_CAMP_HOME}>
          Sessions
        </Link>{" "}
        / Booking <span className="font-mono">{ref}</span>
      </p>
      {!state ? (
        <div className="mt-6 rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-6">
          <h1 className="text-2xl font-bold">No scholarship check for this booking yet</h1>
          <p className="mt-2 text-[#4a5a4f]">Once the family clicks the scholarship button at checkout, its status shows here.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-6" data-demo-status={state.handoff.status}>
            <h1 className="text-2xl font-bold">{CAMP_WORDS[state.handoff.status]?.title ?? state.handoff.status}</h1>
            <p className="mt-2 text-[#4a5a4f]">{CAMP_WORDS[state.handoff.status]?.body}</p>
            <dl className="mt-6 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-[#4a5a4f]">Booking</dt>
              <dd>{state.handoff.booking.description}</dd>
              <dt className="text-[#4a5a4f]">Handoff</dt>
              <dd className="font-mono">{state.handoff.id}</dd>
              <dt className="text-[#4a5a4f]">API status</dt>
              <dd className="font-mono">{state.handoff.status}</dd>
              <dt className="text-[#4a5a4f]">Verification</dt>
              <dd className="font-mono">{state.handoff.verification_status}</dd>
              <dt className="text-[#4a5a4f]">Hold until</dt>
              <dd>{state.handoff.hold_expires_at && !isFinal(state.handoff.status) && state.handoff.status !== "awarded" ? formatDeadline("en", new Date(state.handoff.hold_expires_at)) : "—"}</dd>
              <dt className="text-[#4a5a4f]">Scholarship organization</dt>
              <dd>{state.handoff.sgo?.name ?? "Family choosing"}</dd>
            </dl>
            <p className="mt-6 text-xs text-[#5b6a5f]">{state.handoff.status_detail}</p>
          </section>
          <aside className="rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-5">
            <h2 className="font-semibold">Webhook events for this booking</h2>
            <p className="mt-1 mb-3 text-xs text-[#5b6a5f]">What the camp&apos;s server receives (signed POSTs). This page refreshes on its own.</p>
            <ol className="space-y-2">
              {state.events.map((e) => (
                <li key={e.id} className="rounded-lg bg-[#f6f3ea] p-2 font-mono text-xs break-all">
                  <strong>{e.type}</strong>
                  <div className="text-[#5b6a5f]">{e.createdAt.toISOString()}</div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </CampShell>
  );
}
