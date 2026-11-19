import { Trees } from "lucide-react";
import { MAIN_CONTENT_ID } from "@/components/layout";
import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_CAMP } from "../../demo";
import { DEMO_CAMP_HOME } from "../../policy";

/**
 * The demo camp's own look: a fictional third-party booking site, deliberately unlike the product's UI so the
 * handoff button and pages read as something installed on someone else's site. Always labeled as a demo.
 */
export function CampShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f6f3ea] text-[#1d2a22]">
      <div className="bg-[#3b2f1e] px-4 py-2 text-center text-xs font-medium text-[#f6f3ea]">
        Demo site: Camp Cedar Creek is fictional. It shows how a booking site installs the scholarship button. Nothing here is real.
      </div>
      <header className="border-b border-[#d9d2bf] bg-[#fffdf7]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={DEMO_CAMP_HOME} className="flex items-center gap-2 text-lg font-bold" style={{ color: DEMO_CAMP.brandColor }}>
            <Trees aria-hidden="true" className="size-6" />
            {DEMO_CAMP.name}
          </Link>
          <nav aria-label="Camp site" className="flex gap-4 text-sm">
            <Link href={DEMO_CAMP_HOME} className="underline-offset-4 hover:underline">
              Sessions
            </Link>
          </nav>
        </div>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 outline-none sm:px-6 sm:py-12">
        {children}
      </main>
      <footer className="border-t border-[#d9d2bf] px-4 py-6 text-center text-xs text-[#5b6a5f]">{DEMO_CAMP.tagline}</footer>
    </div>
  );
}
