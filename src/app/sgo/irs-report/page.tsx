import type { Metadata } from "next";
import { Alert, Badge, Button, Card, CardHeader, DateTime, EmptyState, Field, Input, LegalNote, Money, PageHeader, Select, Stat, StatGrid, Table, type TableColumn } from "@/components/ui";
import { roleAtLeast } from "@/server/auth";
import { getIrsReportTable, listIrsReports, type IrsReportRow } from "@/server/acknowledgments";
import { DownloadLink } from "@/features/sgo/components/DownloadLink";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { currentReportingYear, deadlineOf, pickTaxYear, taxYearOptions } from "@/features/sgo/deadlines";
import { SGO_PATHS } from "@/features/sgo/nav";
import { FIRST_TAX_YEAR, MANAGE_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { readerOf, today } from "@/features/sgo/server/queries";
import { irsContributionReportDueDate } from "@/taxmath";
import { generateIrsReportAction, recordReportSubmissionAction } from "../_actions";

export const metadata: Metadata = { title: "IRS report" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const COLUMN_LABELS: Readonly<Record<string, string>> = {
  unique_donor_number: "Unique donor number",
  donor_name: "Donor name",
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  city: "City",
  state: "State",
  zip: "ZIP",
  aggregate_qualified_contributions: "Aggregate qualified contributions (USD)",
};

export default async function IrsReportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const on = today();
  const years = taxYearOptions(on, FIRST_TAX_YEAR);
  const year = pickTaxYear(first(params.year), years, years.includes(currentReportingYear(on)) ? currentReportingYear(on) : years[0]!);
  const ctx = await requireSgoPage(`${SGO_PATHS.irsReport}?year=${year}`);
  const reader = readerOf(ctx.actor);
  const canManage = roleAtLeast(ctx.role, MANAGE_ROLE);
  const test = ctx.mode === "test";
  const due = deadlineOf(on, irsContributionReportDueDate(year));

  const reports = await listIrsReports(ctx.org.id, { mode: ctx.mode, taxYear: year }, reader);
  const latest = reports[0] ?? null;
  const table = latest ? await getIrsReportTable(ctx.org.id, latest.id, reader) : null;
  const submitted = reports.find((r) => r.submittedOn !== null) ?? null;

  const history: Array<TableColumn<IrsReportRow>> = [
    { key: "version", header: "Version", primary: true, cell: (r) => `Version ${r.version}` },
    { key: "generated", header: "Generated", cell: (r) => <DateTime value={r.generatedAt} format="dateTime" /> },
    { key: "rows", header: "Donors", numeric: true, cell: (r) => r.rowCount },
    { key: "total", header: "Total", numeric: true, cell: (r) => <Money cents={r.totalDesignatedCents} showCents /> },
    {
      key: "issues",
      header: "Issues",
      cell: (r) => {
        const errors = r.issues.filter((i) => i.severity === "error").length;
        return errors > 0 ? <Badge tone="danger" size="sm">{`${errors} to fix`}</Badge> : <Badge tone="success" size="sm">None blocking</Badge>;
      },
    },
    {
      key: "consistency",
      header: "Matches acknowledgments",
      cell: (r) => ((r.consistency as { matches?: boolean }).matches === true ? <Badge tone="success" size="sm">Yes</Badge> : <Badge tone="warning" size="sm">No</Badge>),
    },
    {
      key: "submitted",
      header: "Entered in the IRS portal",
      wrap: true,
      cell: (r) =>
        r.submittedOn ? (
          <span>
            <DateTime value={r.submittedOn} format="date" />
            {r.submissionReference ? <span className="block text-xs text-fg-muted">Ref. {r.submissionReference}</span> : null}
          </span>
        ) : test ? (
          <span className="text-fg-subtle">Test reports are never filed</span>
        ) : canManage ? (
          <SgoActionForm action={recordReportSubmissionAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Record" submitVariant="secondary" submitSize="sm" layout="inline" aria-label={`Record submission of version ${r.version}`}>
            <input type="hidden" name="reportId" value={r.id} />
            <Field label="Date entered">
              <Input type="date" name="submittedOn" size="sm" />
            </Field>
            <Field label="Portal reference" optional>
              <Input name="reference" size="sm" maxLength={200} />
            </Field>
          </SgoActionForm>
        ) : (
          <span className="text-fg-subtle">Not recorded</span>
        ),
    },
    { key: "file", header: "File", cell: (r) => <DownloadLink href={`${SGO_PATHS.irsReport}/${encodeURIComponent(r.id)}/file`}>CSV</DownloadLink> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="IRS contribution report"
        description="Per unique donor number: the donor's name, address and aggregate qualified contributions for the calendar year, which your organization reports through the IRS SGO portal."
      />

      <Alert tone="info" title="How to file this report">
        <p>
          The IRS has not published a file format for the SGO portal, so this report is not an upload file. The table below is laid out for entering each row by hand in the portal. Generate it, fix every issue, enter it, then
          record the date you did.
        </p>
      </Alert>

      <form method="get" action={SGO_PATHS.irsReport} className="flex flex-wrap items-end gap-3">
        <Field label="Gifts made in">
          <Select name="year" size="sm" defaultValue={String(year)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" size="sm" variant="secondary">
          Show
        </Button>
      </form>

      <StatGrid columns={3} tiles>
        <Stat
          label="Due"
          value={<DateTime value={due.dueDate} format="date" />}
          badge={submitted ? <Badge tone="success">Submitted</Badge> : <Badge tone={due.state === "upcoming" ? "neutral" : due.state === "approaching" ? "warning" : "danger"}>{due.label}</Badge>}
          hint="Generally February 28 after the calendar year"
        />
        <Stat label="Versions generated" value={reports.length} />
        <Stat label="Latest total" value={latest ? <Money cents={latest.totalDesignatedCents} /> : "—"} />
      </StatGrid>

      {canManage ? (
        <Card>
          <CardHeader title={latest ? "Generate a new version" : "Generate the report"} level={2} description="Built from received designated gifts, your donor numbers and the acknowledgments you issued. A correction is a new version; earlier versions are kept." />
          <SgoActionForm action={generateIrsReportAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel={`Generate for ${year}`} pendingText="Generating…" className="mt-4">
            <input type="hidden" name="taxYear" value={year} />
          </SgoActionForm>
        </Card>
      ) : null}

      {latest ? (
        <Card>
          <CardHeader title={`Version ${latest.version}: issues`} level={2} />
          {latest.issues.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">No issues.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {latest.issues.map((i, n) => (
                <li key={`${i.code}-${i.donorId ?? n}`} className="flex items-start gap-2">
                  <Badge tone={i.severity === "error" ? "danger" : "warning"} size="sm">
                    {i.severity === "error" ? "Fix" : "Check"}
                  </Badge>
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {table ? (
        <Card padding="none">
          <CardHeader title={`Version ${table.report.version}: rows for manual entry`} className="px-5 pt-5 sm:px-6" description="Amounts are plain decimals, ready to type." />
          <div className="overflow-x-auto px-5 pb-5 sm:px-6">
            <table className="mt-3 w-full text-left text-sm">
              <caption className="sr-only">Report rows</caption>
              <thead>
                <tr className="border-b border-line text-xs text-fg-muted">
                  {table.columns.map((c) => (
                    <th key={c} scope="col" className="py-2 pr-3 font-semibold">
                      {COLUMN_LABELS[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr>
                    <td colSpan={table.columns.length} className="py-3 text-fg-muted">
                      No rows.
                    </td>
                  </tr>
                ) : (
                  table.rows.map((row, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="py-2 pr-3 font-mono text-xs">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card padding="none">
        <CardHeader title="History" className="px-5 pt-5 sm:px-6" />
        <Table caption={`Report versions for ${year}`} columns={history} rows={reports} rowKey={(r) => r.id} empty={<EmptyState size="sm" title="No report generated yet" />} />
      </Card>

      <LegalNote>The report must agree with the acknowledgments donors received; each version checks that and says where it does not. Test-mode reports use sandbox gifts and numbers and are never filed.</LegalNote>
    </div>
  );
}
