import type { Metadata } from "next";
import Form from "next/form";
import { Alert, Button, Card, DateTime, EmptyState, Field, Input, PageHeader, StatusBadge, Table, TextLink, type TableColumn } from "@/components/ui";
import { parseOutboxFilter } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { env } from "@/lib/env";
import { listOutbox, type Email } from "@/server/email";

export const metadata: Metadata = { title: "Email outbox" };

const PATH = "/admin/email";
const PAGE_SIZE = 200;

/**
 * POLICY (privacy): the admin outbox shows who was sent what and whether it went, never the message bodies. Bodies
 * can carry live sign-in links and codes (until the provider accepts them) and family details; the development
 * mailbox at /dev/mail is where bodies are read, and it does not exist in production.
 */
const COLUMNS: Array<TableColumn<Email>> = [
  { key: "created", header: "Recorded", cell: (e) => <DateTime value={e.createdAt} format="dateTime" /> },
  {
    key: "subject",
    header: "Message",
    primary: true,
    wrap: true,
    cell: (e) => (
      <span>
        {e.subject}
        <span className="block text-xs font-normal text-fg-muted">to {e.toEmail}</span>
      </span>
    ),
  },
  { key: "template", header: "Template", cell: (e) => <TextLink href={`${PATH}?template=${encodeURIComponent(e.template)}`} tone="quiet"><span className="font-mono text-xs">{e.template}</span></TextLink> },
  { key: "status", header: "Status", cell: (e) => <StatusBadge kind="email" status={e.status} size="sm" /> },
  { key: "provider", header: "Provider", hideWhenStacked: true, cell: (e) => e.provider },
  { key: "related", header: "About", hideWhenStacked: true, cell: (e) => (e.relatedType && e.relatedId ? <span className="font-mono text-xs">{`${e.relatedType} ${e.relatedId}`}</span> : <span className="text-fg-subtle">—</span>) },
  { key: "sent", header: "Sent", numeric: true, cell: (e) => <DateTime value={e.sentAt} format="dateTime" /> },
  { key: "error", header: "Error", wrap: true, cell: (e) => (e.error ? <span className="text-sm text-danger-fg">{e.error}</span> : <span className="text-fg-subtle">—</span>) },
];

export default async function EmailOutboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const filter = parseOutboxFilter(await searchParams);
  const emails = await listOutbox({ ...filter, limit: PAGE_SIZE });
  const provider = env().EMAIL_PROVIDER;

  return (
    <div className="space-y-6">
      <PageHeader title="Email outbox" description={`Every email the platform recorded, newest first (up to ${PAGE_SIZE}). Message bodies are not shown here.`} />
      {provider === "outbox" ? (
        <Alert tone="info">Email provider: local outbox. Nothing leaves this machine; messages are only recorded.</Alert>
      ) : null}

      <Form action={PATH} className="flex flex-wrap items-end gap-3">
        <Field label="Recipient">
          <Input name="to" type="search" size="sm" defaultValue={filter.to ?? ""} placeholder="name@example.com" className="w-72" />
        </Field>
        <Field label="Template">
          <Input name="template" size="sm" defaultValue={filter.template ?? ""} placeholder="magic_link" />
        </Field>
        <Button type="submit" size="sm" variant="secondary">
          Filter
        </Button>
        {filter.to || filter.template ? (
          <TextLink href={PATH} tone="quiet">
            Clear
          </TextLink>
        ) : null}
      </Form>

      <Card padding="none">
        <Table caption="Recorded emails" columns={COLUMNS} rows={emails} rowKey={(e) => e.id} density="compact" empty={<EmptyState size="sm" title="No email recorded" description={filter.to || filter.template ? "Nothing matches these filters." : undefined} />} />
      </Card>
    </div>
  );
}
