import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { ActionForm } from "@/features/handoff/components/ActionForm";
import { CampShell } from "@/features/handoff/components/demo/CampShell";
import { DEMO_SESSIONS } from "@/features/handoff/demo";
import { demoEnabled, PORTAL_HOME } from "@/features/handoff/policy";
import { getDemoCamp } from "@/features/handoff/server/demo";
import { setupDemoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Camp Cedar Creek (demo)", robots: { index: false, follow: false } };

/** /demo/camp — a fictional summer camp's session picker, the start of the live handoff demonstration. */
export default async function DemoCampHome() {
  if (!demoEnabled()) notFound();
  const camp = await getDemoCamp();
  return (
    <CampShell>
      <section className="mb-10">
        <h1 className="text-3xl font-bold sm:text-4xl">Summer 2027 day camp sessions</h1>
        <p className="mt-3 max-w-2xl text-[#4a5a4f]">Hiking, creek science and campfire songs in the Hill Country. Pick a week to book. At checkout you can pay with a scholarship if your family qualifies.</p>
      </section>

      {!camp || !camp.sgoOrgId ? (
        <div className="mb-10 rounded-xl border border-dashed border-[#b8ad8f] bg-[#fffdf7] p-6">
          <h2 className="text-lg font-semibold">Set up the demo</h2>
          <p className="mt-1 mb-4 text-sm text-[#4a5a4f]">Creates the fictional camp as a business, a fictional partner scholarship organization, and an active partnership between them. Synthetic data only.</p>
          <ActionForm action={setupDemoAction} submitLabel="Set up the demo camp" pendingText="Setting up…">
            <span />
          </ActionForm>
        </div>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {DEMO_SESSIONS.map((s) => (
          <li key={s.id} className="flex flex-col rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{s.name}</h2>
            <p className="mt-1 text-sm text-[#4a5a4f]">
              {s.dates} · {s.ages}
            </p>
            <p className="mt-3 text-2xl font-bold">{formatUsd(s.priceCents)}</p>
            <p className="mt-1 text-sm text-[#4a5a4f]">{s.spotsLeft === 0 ? "Full" : `${s.spotsLeft} spots left`}</p>
            <div className="mt-4">
              {s.spotsLeft === 0 || !camp?.sgoOrgId ? (
                <span className="inline-flex h-11 items-center rounded-lg bg-[#d9d2bf] px-5 font-semibold text-[#5b6a5f]">{s.spotsLeft === 0 ? "Full" : "Set up the demo first"}</span>
              ) : (
                <Link href={`/demo/camp/checkout?session=${s.id}`} className="inline-flex h-11 items-center rounded-lg bg-[#1f5c3f] px-5 font-semibold text-white hover:bg-[#174a32]">
                  Book this session
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {camp ? (
        <aside className="mt-12 rounded-xl border border-[#d9d2bf] bg-[#fffdf7] p-5 text-sm text-[#4a5a4f]">
          <h2 className="font-semibold text-[#1d2a22]">Behind the scenes</h2>
          <p className="mt-1">
            The camp&apos;s business portal is at <Link className="underline" href={PORTAL_HOME}>{PORTAL_HOME}</Link>. Sign in as <code>{camp.ownerEmail}</code>; in development the sign-in email appears in the outbox at{" "}
            <Link className="underline" href="/dev/mail">
              /dev/mail
            </Link>
            .
          </p>
        </aside>
      ) : null}
    </CampShell>
  );
}
