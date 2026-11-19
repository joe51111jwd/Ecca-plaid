import type { Metadata } from "next";
import Form from "next/form";
import { Badge, Button, Card, CardHeader, CodeBlock, DateTime, Field, KeyValue, KeyValueList, Money, PageHeader, ProvisionalBadge, ProvisionalNotice, Section, Select, Table, type TableColumn } from "@/components/ui";
import { describeThresholdSource, getActiveTable, listCounties, listTables, thresholdReadingLabel, thresholdRow, thresholdSourceName, type AmiTableSummary, type ThresholdRow } from "@/engine/ami";
import { parseCountyParam } from "@/features/admin/forms";
import { IRS_TABLE_SWAP_IN_STEPS, SWAP_IN_RUNBOOK_PATH } from "@/features/admin/runbook";
import { requireAdminPage } from "@/features/admin/server/guard";

export const metadata: Metadata = { title: "Income limits" };

const PATH = "/admin/income-limits";

const TABLE_COLUMNS: Array<TableColumn<AmiTableSummary>> = [
  { key: "version", header: "Version", primary: true, cell: (t) => <span className="font-mono text-xs">{t.version}</span> },
  { key: "source", header: "Source", cell: (t) => thresholdSourceName(t.source) },
  { key: "effective", header: "Effective", numeric: true, cell: (t) => <DateTime value={t.effectiveDate} /> },
  { key: "counties", header: "Counties", numeric: true, cell: (t) => String(t.countyCount) },
  { key: "areas", header: "Areas", numeric: true, cell: (t) => String(t.areaCount) },
  { key: "active", header: "Active", cell: (t) => (t.active ? <Badge tone="brand" size="sm">Active</Badge> : <span className="text-fg-subtle">—</span>) },
];

type SizeRow = ThresholdRow["thresholds"][number];

function readingCents(row: SizeRow, id: "median_product" | "section8_vli" | "irs_published"): number | null {
  return row.readings.find((r) => r.id === id)?.thresholdCents ?? null;
}

export default async function IncomeLimitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const county = parseCountyParam(await searchParams);
  const table = getActiveTable();
  const description = describeThresholdSource(table);
  const tables = listTables();
  const counties = listCounties(table);
  const row = county && counties.some((c) => c.fips === county) ? thresholdRow(county, { table }) : null;

  const sizeColumns: Array<TableColumn<SizeRow>> = table.provisional
    ? [
        { key: "size", header: "Household size", primary: true, cell: (s) => String(s.householdSize) },
        { key: "median", header: "Median × multiplier", numeric: true, cell: (s) => <Money cents={readingCents(s, "median_product")} showCents /> },
        { key: "vli", header: "6 × very-low-income limit", numeric: true, cell: (s) => <Money cents={readingCents(s, "section8_vli")} showCents /> },
        { key: "lower", header: "Approve at or below", numeric: true, cell: (s) => <Money cents={s.lowerBoundCents} showCents /> },
        { key: "upper", header: "Decline above", numeric: true, cell: (s) => <Money cents={s.upperBoundCents} showCents /> },
        { key: "agree", header: "Readings", cell: (s) => (s.readingsAgree ? <Badge tone="success" size="sm">Agree</Badge> : <Badge tone="warning" size="sm">Differ: review band</Badge>) },
      ]
    : [
        { key: "size", header: "Household size", primary: true, cell: (s) => String(s.householdSize) },
        { key: "limit", header: "IRS-published limit", numeric: true, cell: (s) => <Money cents={readingCents(s, "irs_published")} showCents /> },
      ];

  return (
    <div className="space-y-8">
      <PageHeader title="Income limits" description="The table every income decision uses. This screen is read-only: changing the active table is a command-line step followed by code review." />

      {table.provisional ? (
        <ProvisionalNotice details={<span className="font-mono text-xs">{description.sourceLine}</span>}>{description.explanation}</ProvisionalNotice>
      ) : null}

      <Section title="Active table">
        <Card>
          <CardHeader title={description.limitLabel} actions={table.provisional ? <ProvisionalBadge /> : <Badge tone="neutral">{description.badge}</Badge>} />
          <KeyValueList className="mt-4" dense>
            <KeyValue label="Version">
              <span className="font-mono">{table.version}</span>
            </KeyValue>
            <KeyValue label="Source">{thresholdSourceName(table.source)}</KeyValue>
            <KeyValue label="Effective">
              <DateTime value={table.effectiveDate} format="dateLong" />
            </KeyValue>
            <KeyValue label="Counties">{String(table.countyByFips.size)}</KeyValue>
            <KeyValue label="Source file">
              <span className="font-mono text-xs wrap-anywhere">
                {table.dataset.sourceFile.name} · sha256 {table.dataset.sourceFile.sha256}
              </span>
            </KeyValue>
          </KeyValueList>
          {description.readingsNote ? <p className="mt-4 text-sm text-fg-muted">{description.readingsNote}</p> : null}
        </Card>
        <Card padding="none">
          <Table caption="Installed tables" showCaption columns={TABLE_COLUMNS} rows={tables} rowKey={(t) => t.version} density="compact" />
        </Card>
      </Section>

      <Section id="lookup" title="County lookup" description={table.provisional ? "Both readings of the proposed rule for household sizes 1 to 8, at the statutory 300 percent." : "The published limit for household sizes 1 to 8."}>
        <Form action={PATH} className="flex flex-wrap items-end gap-3">
          <Field label="County">
            <Select name="county" defaultValue={row?.county.fips ?? ""} placeholder="Choose a county" className="w-72">
              {counties.map((c) => (
                <option key={c.fips} value={c.fips}>
                  {c.name} ({c.fips})
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Show limits
          </Button>
        </Form>
        {row ? (
          <Card padding="none">
            <div className="border-b border-line px-5 py-4 text-sm sm:px-6">
              <p className="font-semibold text-fg">{row.county.name}</p>
              <p className="text-fg-muted">
                {row.area.name} · area median <Money cents={row.medianIncomeCents} /> · table <span className="font-mono">{row.tableVersion}</span>
              </p>
            </div>
            <Table caption={`Income limits for ${row.county.name}`} columns={sizeColumns} rows={row.thresholds} rowKey={(s) => String(s.householdSize)} density="compact" />
            {table.provisional ? (
              <p className="px-5 py-3 text-xs text-fg-muted sm:px-6">
                {thresholdReadingLabel("median_product")}. {thresholdReadingLabel("section8_vli")}.
              </p>
            ) : null}
          </Card>
        ) : null}
      </Section>

      <Section id="runbook" title="Swapping in the IRS table" description={`The procedure in ${SWAP_IN_RUNBOOK_PATH}. Nothing here changes the active table; step 7 is the only command that does, and its result goes through code review.`}>
        <Card>
          <ol className="space-y-4">
            {IRS_TABLE_SWAP_IN_STEPS.map((s) => (
              <li key={s.step} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-sunken text-sm font-semibold text-fg nums">{s.step}</span>
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium text-fg">{s.what}</p>
                  {s.command ? <CodeBlock code={s.command} language="bash" /> : <p className="text-sm text-fg-muted">Manual step.</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </Section>
    </div>
  );
}
