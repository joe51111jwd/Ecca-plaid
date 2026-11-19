import type { Metadata } from "next";
import type { ReactNode } from "react";
import Form from "next/form";
import { Button, Card, DateTime, Disclosure, EmptyState, Field, Input, PageHeader, Pagination, Table, TextLink, type TableColumn } from "@/components/ui";
import { hrefWith, parseAuditFilter } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { redirect } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { listAuditLogs, type AuditLog, type AuditLogPage } from "@/server/audit";

export const metadata: Metadata = { title: "Audit log" };

const PATH = "/admin/audit";
const PAGE_SIZE = 50;

/** Link that narrows the log to one value of a column, keeping the other filters. */
function FilterLink({ base, name, value, children }: { base: Record<string, string | undefined>; name: string; value: string; children: ReactNode }) {
  return (
    <TextLink href={hrefWith(PATH, { ...base, before: undefined, [name]: value })} tone="quiet">
      {children}
    </TextLink>
  );
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const filter = parseAuditFilter(await searchParams);
  const base = { orgId: filter.orgId, actorId: filter.actorId, action: filter.action, targetType: filter.targetType, targetId: filter.targetId };
  let page: AuditLogPage;
  try {
    page = await listAuditLogs({ ...filter, limit: PAGE_SIZE });
  } catch (e) {
    // A stale or hand-edited cursor: start again from the newest entry.
    if (isAppError(e) && e.code === "bad_request" && filter.before) redirect(hrefWith(PATH, base));
    throw e;
  }

  const columns: Array<TableColumn<AuditLog>> = [
    { key: "at", header: "When", cell: (e) => <DateTime value={e.at} format="dateTime" /> },
    { key: "action", header: "Action", primary: true, cell: (e) => <FilterLink base={base} name="action" value={e.action}><span className="font-mono text-xs">{e.action}</span></FilterLink> },
    {
      key: "actor",
      header: "Actor",
      cell: (e) => (
        <span className="text-sm">
          {e.actorType}
          {e.actorId ? (
            <>
              {" "}
              <FilterLink base={base} name="actorId" value={e.actorId}>
                <span className="font-mono text-xs">{e.actorId}</span>
              </FilterLink>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: "org",
      header: "Organization",
      cell: (e) => (e.orgId ? <FilterLink base={base} name="orgId" value={e.orgId}><span className="font-mono text-xs">{e.orgId}</span></FilterLink> : <span className="text-fg-subtle">—</span>),
    },
    {
      key: "target",
      header: "Target",
      cell: (e) =>
        e.targetType && e.targetId ? (
          <span className="text-sm">
            <FilterLink base={base} name="targetType" value={e.targetType}>
              {e.targetType}
            </FilterLink>{" "}
            <TextLink href={hrefWith(PATH, { ...base, before: undefined, targetType: e.targetType, targetId: e.targetId })} tone="quiet">
              <span className="font-mono text-xs">{e.targetId}</span>
            </TextLink>
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "metadata",
      header: "Details",
      wrap: true,
      cell: (e) =>
        (e.metadata && Object.keys(e.metadata).length > 0) || e.ip || e.userAgent ? (
          <Disclosure summary="Show">
            <pre className="mt-2 max-h-64 max-w-xl overflow-auto rounded-control bg-sunken p-3 font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify({ ...(e.metadata ?? {}), ...(e.ip ? { ip: e.ip } : {}), ...(e.userAgent ? { userAgent: e.userAgent } : {}) }, null, 2)}
            </pre>
          </Disclosure>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  const filtered = Object.values(base).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" description="Every read of sensitive data and every change, newest first. Entries are never edited or deleted. Click a value to filter by it." />

      <Form action={PATH} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Organization id">
          <Input name="orgId" size="sm" defaultValue={filter.orgId ?? ""} />
        </Field>
        <Field label="Actor id">
          <Input name="actorId" size="sm" defaultValue={filter.actorId ?? ""} />
        </Field>
        <Field label="Action">
          <Input name="action" size="sm" defaultValue={filter.action ?? ""} placeholder="settings.update" />
        </Field>
        <Field label="Target type">
          <Input name="targetType" size="sm" defaultValue={filter.targetType ?? ""} />
        </Field>
        <Field label="Target id">
          <Input name="targetId" size="sm" defaultValue={filter.targetId ?? ""} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="secondary">
            Filter
          </Button>
          {filtered ? (
            <TextLink href={PATH} tone="quiet">
              Clear
            </TextLink>
          ) : null}
        </div>
      </Form>

      <Card padding="none">
        <Table caption="Audit log entries" columns={columns} rows={page.items} rowKey={(e) => e.id} density="compact" empty={<EmptyState size="sm" title="No entries match" />} />
      </Card>
      <Pagination
        summary={`${page.items.length} entr${page.items.length === 1 ? "y" : "ies"}${filter.before ? " (older page)" : ""}`}
        prevHref={filter.before ? hrefWith(PATH, base) : null}
        nextHref={page.nextCursor ? hrefWith(PATH, { ...base, before: page.nextCursor }) : null}
        labels={{ previous: "Newest", next: "Older" }}
      />
    </div>
  );
}
