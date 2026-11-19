import type { Metadata } from "next";
import { Alert, Badge, Button, Card, CardFooter, CardHeader, Checkbox, DateTime, Disclosure, Drawer, EmptyState, Field, Input, LegalNote, Money, PageHeader, Pagination, Select, Stat, StatGrid, Table, Tabs, type TableColumn } from "@/components/ui";
import { isAppError } from "@/lib/errors";
import { roleAtLeast } from "@/server/auth";
import { acknowledgmentWorklist, DONOR_NUMBER_IMPORT_COLUMNS, WORKLIST_ACTIONS, type WorklistAction, type WorklistItem } from "@/server/acknowledgments";
import { AckStatus } from "@/features/sgo/components/AckStatus";
import { DownloadLink } from "@/features/sgo/components/DownloadLink";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { currentReportingYear, deadlineOf, pickTaxYear, taxYearOptions } from "@/features/sgo/deadlines";
import { WORKLIST_ACTION_LABELS, WORKLIST_ACTION_TONES } from "@/features/sgo/labels";
import { SGO_PATHS } from "@/features/sgo/nav";
import { FIRST_TAX_YEAR, MANAGE_ROLE, SANDBOX_NUMBER_LABEL, WORKLIST_PAGE_SIZE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { loadAcknowledgmentPreview, readerOf, today } from "@/features/sgo/server/queries";
import { generateSandboxNumberAction, generateSandboxNumbersAction, importDonorNumbersAction, issueAcknowledgmentAction, markMailedAction, setDonorNumberAction } from "../_actions";

export const metadata: Metadata = { title: "Acknowledgments" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AcknowledgmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const on = today();
  const years = taxYearOptions(on, FIRST_TAX_YEAR);
  const year = pickTaxYear(first(params.year), years, years.includes(currentReportingYear(on)) ? currentReportingYear(on) : years[0]!);
  const action = WORKLIST_ACTIONS.find((a) => a === first(params.action));
  const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(first(params.offset) ?? "0", 10) || 0));
  const previewDonor = first(params.preview)?.slice(0, 100) ?? null;
  const ctx = await requireSgoPage(`${SGO_PATHS.acknowledgments}?year=${year}`);
  const canManage = roleAtLeast(ctx.role, MANAGE_ROLE);
  const test = ctx.mode === "test";

  const worklist = await acknowledgmentWorklist(ctx.org.id, { mode: ctx.mode, taxYear: year, limit: WORKLIST_PAGE_SIZE, offset, ...(action ? { action } : {}) }, readerOf(ctx.actor));
  const due = deadlineOf(on, worklist.acknowledgmentDueDate);
  const href = (q: { action?: WorklistAction | null; offset?: number; preview?: string | null }) => {
    const sp = new URLSearchParams({ year: String(year) });
    const a = q.action === undefined ? action : q.action;
    if (a) sp.set("action", a);
    if (q.offset) sp.set("offset", String(q.offset));
    if (q.preview) sp.set("preview", q.preview);
    return `${SGO_PATHS.acknowledgments}?${sp.toString()}`;
  };

  let preview = null;
  if (previewDonor) {
    const item = worklist.items.find((i) => i.donor.id === previewDonor);
    try {
      preview = await loadAcknowledgmentPreview(ctx.actor, previewDonor, year, (item?.acknowledgment.version ?? 0) + 1);
    } catch (e) {
      if (!(isAppError(e) && (e.code === "not_found" || e.code === "bad_request" || e.code === "validation_failed"))) throw e;
    }
  }

  const columns: Array<TableColumn<WorklistItem>> = [
    {
      key: "donor",
      header: "Donor",
      primary: true,
      cell: (i) => (
        <span>
          {i.donor.fullName}
          <span className="block text-xs font-normal text-fg-muted">{i.donor.email}</span>
        </span>
      ),
    },
    { key: "designated", header: "Designated total", numeric: true, cell: (i) => <Money cents={i.designatedCents} showCents /> },
    {
      key: "number",
      header: "Unique donor number",
      wrap: true,
      cell: (i) =>
        i.donorNumber.number ? (
          <span className="inline-flex flex-col">
            <code className="text-xs">{i.donorNumber.number}</code>
            {i.donorNumber.source === "sandbox_generated" ? <span className="text-xs text-caution-fg">{SANDBOX_NUMBER_LABEL}</span> : null}
          </span>
        ) : canManage && i.designatedCents > 0 ? (
          <div className="space-y-2">
            {test ? (
              <SgoActionForm action={generateSandboxNumberAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Generate sandbox number" submitVariant="secondary" submitSize="sm" layout="inline" aria-label={`Generate a sandbox number for ${i.donor.fullName}`}>
                <input type="hidden" name="donorId" value={i.donor.id} />
                <input type="hidden" name="taxYear" value={year} />
              </SgoActionForm>
            ) : null}
            <SgoActionForm action={setDonorNumberAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save" submitVariant="secondary" submitSize="sm" layout="inline" aria-label={`Enter the unique donor number for ${i.donor.fullName}`}>
              <input type="hidden" name="donorId" value={i.donor.id} />
              <input type="hidden" name="taxYear" value={year} />
              <Field label="From the IRS SGO portal" hideLabel>
                <Input name="number" size="sm" placeholder={test ? "Or enter one" : "From the IRS SGO portal"} maxLength={64} autoComplete="off" />
              </Field>
            </SgoActionForm>
          </div>
        ) : (
          <span className="text-fg-subtle">Missing</span>
        ),
    },
    {
      key: "ack",
      header: "Acknowledgment",
      cell: (i) => (
        <span className="inline-flex flex-col gap-1">
          <AckStatus status={i.acknowledgment.status} />
          {i.acknowledgment.issued ? (
            <span className="text-xs text-fg-muted">
              v{i.acknowledgment.issued.version} issued <DateTime value={i.acknowledgment.issued.issuedAt} format="date" />
              {i.acknowledgment.needsRegeneration ? " · changed since" : ""}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "delivery",
      header: "Delivery",
      cell: (i) => (i.eDelivery.active ? <Badge tone="success" size="sm">Email (consented)</Badge> : <Badge tone="warning" size="sm">Paper required</Badge>),
    },
    {
      key: "next",
      header: "Next step",
      wrap: true,
      cell: (i) => (
        <div className="space-y-2">
          <Badge tone={WORKLIST_ACTION_TONES[i.action] ?? "neutral"} size="sm">
            {WORKLIST_ACTION_LABELS[i.action] ?? i.action}
          </Badge>
          {i.blockers.length > 0 ? (
            <ul className="list-disc pl-4 text-xs text-fg-muted">
              {i.blockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <a href={href({ preview: i.donor.id })} className="text-sm underline">
              Preview
            </a>
            {i.acknowledgment.issued ? <DownloadLink href={`${SGO_PATHS.acknowledgments}/${encodeURIComponent(i.acknowledgment.issued.acknowledgmentId)}/pdf`}>PDF</DownloadLink> : null}
          </div>
          {canManage && i.action === "issue" ? (
            <SgoActionForm
              action={issueAcknowledgmentAction}
              orgId={ctx.org.id}
              mode={ctx.mode}
              submitLabel={i.acknowledgment.issued ? "Reissue" : "Issue"}
              submitSize="sm"
              layout="inline"
              aria-label={`Issue the acknowledgment for ${i.donor.fullName}`}
              confirm={{
                title: `${i.acknowledgment.issued ? "Reissue" : "Issue"} the acknowledgment?`,
                description: i.eDelivery.active ? "It is emailed to the donor, who consented to electronic delivery." : "This donor has not consented to electronic delivery: print it and mail it, then record the mailing.",
                confirmLabel: i.acknowledgment.issued ? "Reissue" : "Issue",
              }}
            >
              <input type="hidden" name="donorId" value={i.donor.id} />
              <input type="hidden" name="taxYear" value={year} />
            </SgoActionForm>
          ) : null}
          {canManage && i.action === "mail_paper" && i.acknowledgment.issued ? (
            <SgoActionForm action={markMailedAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Record mailing" submitVariant="secondary" submitSize="sm" layout="inline" aria-label={`Record mailing for ${i.donor.fullName}`}>
              <input type="hidden" name="acknowledgmentId" value={i.acknowledgment.issued.acknowledgmentId} />
            </SgoActionForm>
          ) : null}
        </div>
      ),
    },
  ];

  const tabs = [
    { key: null, label: "All", count: worklist.counts.donors },
    { key: "issue" as const, label: "Ready to issue", count: worklist.byAction.issue },
    { key: (test ? "generate_sandbox_number" : "enter_donor_number") as WorklistAction, label: "Number missing", count: worklist.byAction.enter_donor_number + worklist.byAction.generate_sandbox_number },
    { key: "review" as const, label: "Needs a person", count: worklist.byAction.review },
    { key: "mail_paper" as const, label: "Paper to mail", count: worklist.byAction.mail_paper },
    { key: "none" as const, label: "Done", count: worklist.byAction.none },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acknowledgments"
        description={`The official written acknowledgment to each donor, per donor and calendar year: your EIN, the total designated, the unique donor number and the goods-or-services statement. The immediate email receipt is not the acknowledgment.`}
      />

      <form method="get" action={SGO_PATHS.acknowledgments} className="flex flex-wrap items-end gap-3">
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

      <StatGrid columns={4} tiles>
        <Stat
          label="Due"
          value={<DateTime value={worklist.acknowledgmentDueDate} format="date" />}
          badge={<Badge tone={due.state === "upcoming" ? "neutral" : due.state === "approaching" ? "warning" : "danger"}>{due.label}</Badge>}
          hint="January 31 after the calendar year"
        />
        <Stat label="Donors" value={worklist.counts.donors} />
        <Stat label="Up to date" value={worklist.counts.upToDate} />
        <Stat label="Need action" value={worklist.counts.outstanding} />
      </StatGrid>

      {!worklist.sgo.ein ? (
        <Alert tone="danger" title="Your EIN is missing">
          <p>
            Every acknowledgment must show your EIN. <a href={SGO_PATHS.settings} className="underline">Add it in Settings</a>.
          </p>
        </Alert>
      ) : null}
      {!test && !worklist.sgo.portalRegistered ? (
        <Alert tone="danger" title="Not registered in the IRS SGO portal">
          <p>Unique donor numbers are created in the IRS SGO portal. Until you register there, no real number can exist and no acknowledgment can be issued.</p>
        </Alert>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader title="Unique donor numbers" level={2} description="Numbers come from the IRS SGO portal. They are never invented here: enter each one in the table below, or import a file." />
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <Disclosure summary="Import a CSV of numbers">
              <div className="space-y-3 pt-3 text-sm">
                <p className="text-fg-muted">
                  Columns: <code>{DONOR_NUMBER_IMPORT_COLUMNS.join(", ")}</code>. Donor ids are the ones in the donations export. Nothing is imported unless every row is valid.
                </p>
                <SgoActionForm action={importDonorNumbersAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Import" submitVariant="secondary" encType="multipart/form-data">
                  <Field label="CSV file">
                    <Input type="file" name="file" accept=".csv,text/csv" />
                  </Field>
                  <Checkbox name="replace" label="Replace numbers already recorded" description="Only when the IRS SGO portal changed a number." />
                </SgoActionForm>
              </div>
            </Disclosure>
            {test ? (
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-fg">Sandbox numbers</p>
                <p className="text-fg-muted">In test mode you can generate numbers starting with TEST-. {SANDBOX_NUMBER_LABEL}; live mode refuses them.</p>
                <SgoActionForm action={generateSandboxNumbersAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Generate for every donor without one" submitVariant="secondary" submitSize="sm">
                  <input type="hidden" name="taxYear" value={year} />
                </SgoActionForm>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card padding="none">
        <div className="border-b border-line px-5 sm:px-6">
          <Tabs divider={false} label="Filter the worklist" current={href({ action: action ?? null })} items={tabs.map((t) => ({ href: href({ action: t.key }), label: t.label, count: t.count, match: "exact" as const }))} />
        </div>
        <Table
          caption={`Acknowledgment worklist for ${year}`}
          columns={columns}
          rows={worklist.items}
          rowKey={(i) => i.donor.id}
          empty={<EmptyState size="sm" title="No donors here" description={`Donors who designated a gift to you in ${year} appear here.`} />}
        />
        <CardFooter>
          <Pagination
            prevHref={offset > 0 ? href({ offset: Math.max(0, offset - WORKLIST_PAGE_SIZE) }) : null}
            nextHref={offset + WORKLIST_PAGE_SIZE < worklist.total ? href({ offset: offset + WORKLIST_PAGE_SIZE }) : null}
            summary={`${worklist.total === 0 ? 0 : offset + 1}–${Math.min(offset + WORKLIST_PAGE_SIZE, worklist.total)} of ${worklist.total}`}
          />
        </CardFooter>
      </Card>

      <LegalNote>
        Under the temporary rules the acknowledgment is due by January 31 of the year after the gifts and may be electronic only with the donor&apos;s consent. Each spouse who gives receives a separate acknowledgment and
        number.
      </LegalNote>

      <Drawer open={previewDonor !== null} closeHref={href({})} size="lg" title="Acknowledgment preview" description="What issuing would produce now. Nothing is issued or sent from here.">
        {preview ? (
          preview.letter ? (
            <article className="space-y-3 text-sm">
              {preview.letter.testNotice ? <Alert tone="warning">{preview.letter.testNotice}</Alert> : null}
              <h3 className="text-base font-semibold">{preview.letter.title}</h3>
              <p className="text-fg-muted">{preview.letter.donor.lines.join(", ")}</p>
              <h4 className="font-semibold">{preview.letter.requiredHeading}</h4>
              <ul className="list-disc space-y-1 pl-5">
                {preview.letter.required.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <h4 className="font-semibold">{preview.letter.gifts.heading}</h4>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-xs text-fg-muted">
                    {preview.letter.gifts.columns.map((c) => (
                      <th key={c} scope="col" className="py-1 pr-2 font-semibold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...preview.letter.gifts.rows, preview.letter.gifts.total].map((row, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="py-1 pr-2">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-fg-muted">{preview.letter.gifts.note}</p>
              <ul className="list-disc space-y-1 pl-5 text-fg-muted">
                {preview.letter.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </article>
          ) : (
            <Alert tone="warning" title={preview.build.status === "not_required" ? "No acknowledgment is needed" : "Not ready to issue"}>
              <ul className="list-disc space-y-1 pl-5">
                {preview.build.blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </Alert>
          )
        ) : previewDonor ? (
          <p className="text-sm text-fg-muted">This donor has no gifts to your organization in {year}.</p>
        ) : null}
      </Drawer>
    </div>
  );
}
