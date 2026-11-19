import type { Metadata } from "next";
import { Alert, Badge, Card, CardFooter, CardHeader, DateTime, EmptyState, Field, LegalNote, Money, PageHeader, Pagination, Select, Stat, StatGrid, StatusBadge, Table, Tabs, Button, type TableColumn } from "@/components/ui";
import { isAppError } from "@/lib/errors";
import { donorTotalsForSgo, listDonationsForSgo, type DonorTotal, type SgoDonationItem } from "@/server/donations";
import { AckStatus } from "@/features/sgo/components/AckStatus";
import { DownloadLink } from "@/features/sgo/components/DownloadLink";
import { pickTaxYear, taxYearOptions } from "@/features/sgo/deadlines";
import { SGO_PATHS } from "@/features/sgo/nav";
import { DONATION_PAGE_SIZE, FIRST_TAX_YEAR, SANDBOX_NUMBER_LABEL } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { readerOf, today } from "@/features/sgo/server/queries";

export const metadata: Metadata = { title: "Donations" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATUSES = ["succeeded", "pending", "refunded", "failed", "canceled"] as const;

function donorName(d: { firstName: string | null; middleName: string | null; lastName: string | null; suffix: string | null; email: string }): string {
  const name = [d.firstName, d.middleName, d.lastName, d.suffix].filter(Boolean).join(" ");
  return name || d.email;
}

interface Advisory {
  status?: string;
  advisories?: Array<{ code: string; message: string }>;
  advisoryDisclaimer?: string | null;
}

function advisoryOf(total: DonorTotal): Advisory | null {
  const a = total.substantialContributor as Advisory | null;
  return a && Array.isArray(a.advisories) && a.advisories.length > 0 ? a : null;
}

export default async function DonationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const on = today();
  const years = taxYearOptions(on, FIRST_TAX_YEAR);
  const year = pickTaxYear(first(params.year), years, years[0]!);
  const view = first(params.view) === "donors" ? "donors" : "gifts";
  const status = STATUSES.find((s) => s === first(params.status));
  const cursor = first(params.cursor)?.slice(0, 300) || null;
  const ctx = await requireSgoPage(`${SGO_PATHS.donations}?year=${year}`);
  const reader = readerOf(ctx.actor);

  const href = (q: { view?: string; status?: string | null; cursor?: string | null; y?: number }) => {
    const sp = new URLSearchParams({ year: String(q.y ?? year) });
    if ((q.view ?? view) === "donors") sp.set("view", "donors");
    if (q.status) sp.set("status", q.status);
    if (q.cursor) sp.set("cursor", q.cursor);
    return `${SGO_PATHS.donations}?${sp.toString()}`;
  };

  const totals = await donorTotalsForSgo(ctx.org.id, year, { mode: ctx.mode }, reader);
  const designated = totals.reduce((s, t) => s + t.designatedCents, 0);
  const nonDesignated = totals.reduce((s, t) => s + t.nonDesignatedCents, 0);
  const advisories = totals.filter((t) => advisoryOf(t) !== null);

  let gifts: { items: SgoDonationItem[]; nextCursor: string | null } = { items: [], nextCursor: null };
  if (view === "gifts") {
    const q = { mode: ctx.mode, taxYear: year, limit: DONATION_PAGE_SIZE, ...(status ? { status } : {}) };
    gifts = await listDonationsForSgo(ctx.org.id, { ...q, cursor }, reader).catch((e: unknown) => {
      if (cursor && isAppError(e) && (e.code === "bad_request" || e.code === "validation_failed")) return listDonationsForSgo(ctx.org.id, q, reader);
      throw e;
    });
  }

  const giftColumns: Array<TableColumn<SgoDonationItem>> = [
    {
      key: "donor",
      header: "Donor",
      primary: true,
      cell: ({ donor, donation }) => (
        <span>
          {donorName(donor)}
          <span className="block text-xs font-normal text-fg-muted">{`Order ${donation.orderNumber} · ${donation.id}`}</span>
        </span>
      ),
    },
    { key: "date", header: "Date", cell: ({ donation }) => <DateTime value={donation.contributedAt ?? donation.designatedAt} format="date" /> },
    { key: "status", header: "Status", cell: ({ donation }) => <StatusBadge kind="donation" status={donation.status} size="sm" /> },
    { key: "designated", header: "Designated (25F)", numeric: true, cell: ({ donation }) => <Money cents={donation.designatedAmountCents} showCents /> },
    { key: "other", header: "Not designated", numeric: true, hideWhenStacked: true, cell: ({ donation }) => <Money cents={donation.nonDesignatedAmountCents} showCents /> },
    {
      key: "credit",
      header: "Credit-eligible at the gift",
      wrap: true,
      cell: ({ donation }) =>
        donation.creditEligible ? (
          <Badge tone="success" size="sm">
            Yes
          </Badge>
        ) : (
          <span className="text-sm text-fg-muted">{donation.creditIneligibleReason ?? "No"}</span>
        ),
    },
  ];

  const totalColumns: Array<TableColumn<DonorTotal>> = [
    {
      key: "donor",
      header: "Donor",
      primary: true,
      cell: (t) => (
        <span>
          {donorName(t.donor)}
          <span className="block text-xs font-normal text-fg-muted">{t.donor.email}</span>
        </span>
      ),
    },
    { key: "gifts", header: "Gifts", numeric: true, cell: (t) => t.giftCount },
    { key: "designated", header: "Designated (25F)", numeric: true, cell: (t) => <Money cents={t.designatedCents} showCents /> },
    { key: "other", header: "Not designated", numeric: true, hideWhenStacked: true, cell: (t) => <Money cents={t.nonDesignatedCents} showCents /> },
    {
      key: "number",
      header: "Unique donor number",
      cell: (t) =>
        t.donorNumber?.number ? (
          <span className="inline-flex flex-col">
            <code className="text-xs">{t.donorNumber.number}</code>
            {t.donorNumber.source === "sandbox_generated" ? <span className="text-xs text-caution-fg">{SANDBOX_NUMBER_LABEL}</span> : null}
          </span>
        ) : (
          <span className="text-fg-subtle">Missing</span>
        ),
    },
    { key: "ack", header: "Acknowledgment", cell: (t) => <AckStatus status={t.acknowledgment.status} /> },
    { key: "delivery", header: "E-delivery", cell: (t) => (t.eDelivery.consented ? <Badge tone="success" size="sm">Consented</Badge> : <Badge tone="warning" size="sm">Paper required</Badge>) },
    { key: "advisory", header: "Large donor", cell: (t) => (advisoryOf(t) ? <Badge tone="warning" size="sm">Advisory</Badge> : <span className="text-fg-subtle">—</span>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Donations"
        description={`Gifts to your organization in ${year}, ${ctx.mode === "test" ? "sandbox gifts only" : "live gifts"}. The designated amount and any platform fee are always separate; a fee is never part of a qualified contribution.`}
        actions={<DownloadLink href={`${SGO_PATHS.donations}/export?year=${year}${status ? `&status=${status}` : ""}`}>Export CSV</DownloadLink>}
      />

      <form method="get" action={SGO_PATHS.donations} className="flex flex-wrap items-end gap-3">
        {view === "donors" ? <input type="hidden" name="view" value="donors" /> : null}
        <Field label="Tax year">
          <Select name="year" size="sm" defaultValue={String(year)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        {view === "gifts" ? (
          <Field label="Status">
            <Select name="status" size="sm" defaultValue={status ?? ""}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Button type="submit" size="sm" variant="secondary">
          Show
        </Button>
      </form>

      <StatGrid columns={4} tiles>
        <Stat label="Donors" value={totals.length} />
        <Stat label="Designated (25F)" value={<Money cents={designated} />} hint="Received; refunded gifts excluded" />
        <Stat label="Not designated" value={<Money cents={nonDesignated} />} />
        <Stat label="Large-donor advisories" value={advisories.length} />
      </StatGrid>

      {advisories.length > 0 ? (
        <Alert tone="warning" title="Large-donor advisories">
          <ul className="list-disc space-y-1 pl-5">
            {advisories.map((t) => (
              <li key={t.donor.id}>
                <strong>{donorName(t.donor)}</strong>: {advisoryOf(t)!.advisories!.map((a) => a.message).join(" ")}
              </li>
            ))}
          </ul>
          {advisoryOf(advisories[0]!)?.advisoryDisclaimer ? <p className="mt-2">{advisoryOf(advisories[0]!)!.advisoryDisclaimer}</p> : null}
        </Alert>
      ) : null}

      <Card padding="none">
        <div className="border-b border-line px-5 sm:px-6">
          <Tabs
            divider={false}
            label="Gifts or donor totals"
            current={href({ view, status: view === "gifts" ? status : null })}
            items={[
              { href: href({ view: "gifts", status }), label: "Gifts", match: "exact" },
              { href: href({ view: "donors" }), label: "Per-donor totals", count: totals.length, match: "exact" },
            ]}
          />
        </div>
        {view === "gifts" ? (
          <>
            <Table caption={`Gifts in ${year}`} density="compact" columns={giftColumns} rows={gifts.items} rowKey={(r) => r.donation.id} empty={<EmptyState size="sm" title="No gifts" description="Gifts made through your giving page appear here." />} />
            <CardFooter>
              <Pagination prevHref={cursor ? href({ view: "gifts", status }) : null} nextHref={gifts.nextCursor ? href({ view: "gifts", status, cursor: gifts.nextCursor }) : null} summary={`${gifts.items.length} shown`} />
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader title="Per-donor totals" description="Per donor, for this calendar year: what the acknowledgment and the IRS report will be built from." className="px-5 pt-5 sm:px-6" />
            <Table caption={`Donor totals for ${year}`} density="compact" columns={totalColumns} rows={totals} rowKey={(t) => t.donor.id} empty={<EmptyState size="sm" title="No donors this year" />} />
          </>
        )}
      </Card>
      <LegalNote>Large-donor advisories are for your staff only and never block or change a gift. Donor Social Security numbers are not collected.</LegalNote>
    </div>
  );
}
