import { Download, Gift } from "lucide-react";
import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Badge, Button, Card, DateTime, Disclosure, EmptyState, KeyValueList, Money } from "@/components/ui";
import { getRequestInfo, requireUser } from "@/server/auth";
import { listGiftsForUser } from "@/server/donations";
import { donorPageNotes, toDonorGroupsView } from "./gifts-view";
import { WithdrawEDeliveryButton } from "./withdraw-e-delivery";

export const metadata: Metadata = { title: "My gifts", robots: { index: false } };

/**
 * The signed-in donor's gifts: each organization (with EIN) and year, the unique donor number when the organization
 * has recorded it, the receipts of each gift, the official acknowledgment to download once issued, and the
 * electronic-delivery preference.
 */
export default async function DonorPage() {
  const user = await requireUser({ returnTo: "/donor" });
  const groups = toDonorGroupsView(await listGiftsForUser(user.id, { request: await getRequestInfo() }));
  const notes = donorPageNotes();
  return (
    <FocusShell width="xl" card={false} secureNote="donor" exit={<a href="/sign-out" className="text-sm font-medium text-fg-muted hover:text-fg">Sign out</a>}>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-fg">My gifts</h1>
          <p className="text-fg-muted">Signed in as {user.email}</p>
          {notes.map((n) => (
            <p key={n.id} data-copy-id={n.id} className="text-sm text-fg-muted">
              {n.text}
            </p>
          ))}
        </header>

        {groups.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Gift />}
              title="No gifts yet"
              description={`Gifts made with ${user.email} appear here, grouped by organization and year.`}
              action={<Button href="/give">Find an organization</Button>}
            />
          </Card>
        ) : (
          <ul className="space-y-6" data-testid="donor-groups">
            {groups.map((g) => (
              <Card as="li" key={g.key} className="space-y-5" data-sandbox={g.sandbox || undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-fg">{g.sgo.name}</h2>
                    <p className="text-sm text-fg-muted">
                      {g.sgo.legalName && g.sgo.legalName !== g.sgo.name ? `${g.sgo.legalName} · ` : ""}
                      {g.sgo.ein ? `EIN ${g.sgo.ein}` : "EIN not on file"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.sandbox ? (
                      <Badge tone="caution" size="sm">
                        Sandbox
                      </Badge>
                    ) : null}
                    <Badge tone="neutral" size="sm">
                      {g.taxYear ?? "Processing"}
                    </Badge>
                  </div>
                </div>

                <KeyValueList
                  layout="grid"
                  columns={2}
                  items={[
                    { label: "Donor", value: g.donorName },
                    { label: "Designated and received this year", value: <Money cents={g.designatedTotalCents} showCents /> },
                    {
                      label: "Unique donor number",
                      value: (
                        <span className="space-y-1">
                          <span className="block font-mono">{g.donorNumber.number ?? g.donorNumber.status}</span>
                          {g.donorNumber.note ? <span className="block text-sm text-fg-muted">{g.donorNumber.note}</span> : null}
                        </span>
                      ),
                    },
                    {
                      label: "Official acknowledgment",
                      value: (
                        <span className="space-y-2">
                          <span className="block">{g.acknowledgment.statusLabel}</span>
                          {g.acknowledgment.blockedReason ? <span className="block text-sm text-fg-muted">{g.acknowledgment.blockedReason}</span> : null}
                          {g.acknowledgment.download ? (
                            <Button href={`/donor/acknowledgments/${g.acknowledgment.download.acknowledgmentId}`} size="sm" variant="secondary" leadingIcon={<Download />} prefetch={false}>
                              Download (version {g.acknowledgment.download.version})
                            </Button>
                          ) : null}
                        </span>
                      ),
                    },
                  ]}
                />

                <div className="rounded-card border border-line bg-sunken p-4 text-sm" data-testid="e-delivery">
                  <p className="font-medium text-fg">How the acknowledgment is delivered</p>
                  {g.eDelivery.state === "consented" ? (
                    <div className="mt-2 space-y-3">
                      <p className="text-fg-muted">By email to {g.eDelivery.email}.</p>
                      {g.eDelivery.consentId ? <WithdrawEDeliveryButton consentId={g.eDelivery.consentId} /> : null}
                    </div>
                  ) : g.eDelivery.state === "withdrawn" ? (
                    <p className="mt-2 text-fg-muted">
                      By mail. You withdrew consent to email delivery on {g.eDelivery.withdrawnAt ? <DateTime value={g.eDelivery.withdrawnAt} format="date" /> : "an earlier date"}.
                    </p>
                  ) : (
                    <p className="mt-2 text-fg-muted">By mail to the address you gave with your gift.</p>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">Receipts</h3>
                  <ul className="mt-2 divide-y divide-line">
                    {g.gifts.map((gift) => (
                      <li key={gift.donationId} className="space-y-2 py-3" data-gift-status={gift.status}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm text-fg">
                            <DateTime value={gift.date} format="date" /> · {gift.statusLabel}
                          </span>
                          <span className="font-medium text-fg">
                            <Money cents={gift.designatedCents} showCents /> designated
                          </span>
                        </div>
                        {gift.nonDesignatedCents > 0 ? (
                          <p className="text-sm text-fg-muted">
                            Not designated: <Money cents={gift.nonDesignatedCents} showCents />
                          </p>
                        ) : null}
                        {gift.serviceFeeCents > 0 ? (
                          <p className="text-sm text-fg-muted">
                            Service fee (separate charge): <Money cents={gift.serviceFeeCents} showCents />
                          </p>
                        ) : null}
                        {gift.outcome ? <p className={gift.outcome.creditEligible ? "text-sm text-success-fg" : "text-sm text-warning-fg"}>{gift.outcome.text}</p> : null}
                        <Disclosure summary="Designation as confirmed" variant="plain">
                          <p className="mt-2 text-sm text-fg-muted">{gift.designationText}</p>
                        </Disclosure>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </div>
    </FocusShell>
  );
}
