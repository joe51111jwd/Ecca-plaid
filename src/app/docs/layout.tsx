import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PublicShell } from "@/components/layout";
import { LegalNote } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { DocsNav, type DocsNavGroup } from "./docs-nav";

export const metadata: Metadata = {
  title: { template: `%s — ${BRAND.name} API docs`, default: `${BRAND.name} API docs` },
  description: `Integrate ${BRAND.name}: income verification for scholarship granting organizations, signed webhooks, evidence packs and the point-of-booking handoff.`,
};

const GROUPS: DocsNavGroup[] = [
  {
    title: "Start",
    items: [
      { href: "/docs", label: "Overview & authentication" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    title: "Verifications",
    items: [
      { href: "/docs/verifications", label: "The Verification object" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/evidence", label: "Evidence packs" },
      { href: "/docs/csv-export", label: "CSV export" },
    ],
  },
  {
    title: "Camps & schools",
    items: [{ href: "/docs/handoffs", label: "Point-of-booking handoff" }],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/errors", label: "Errors, limits & idempotency" },
      { href: "/docs/reference", label: "Endpoints & OpenAPI" },
    ],
  },
];

/** Developer documentation chrome: the public shell, a sticky section sidebar and the standing legal note. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell>
      <div className="mx-auto grid w-full max-w-page gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <DocsNav groups={GROUPS} />
        </aside>
        <div className="min-w-0 max-w-3xl space-y-12">
          {children}
          <LegalNote title="Not legal or tax advice. Built to proposed rules.">
            <p>
              Section 25F eligibility and verification rules described here follow the proposed regulations (REG-117199-25), which are not final and may change. Income limits are
              provisional, derived from HUD data, until the IRS publishes its own table; every result says which source it used. Verification does not promise a scholarship
              award, and an award does not promise payment.
            </p>
          </LegalNote>
        </div>
      </div>
    </PublicShell>
  );
}
