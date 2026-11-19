import type { Metadata } from "next";
import Form from "next/form";
import { Badge, Button, Card, CardHeader, DateTime, EmptyState, Field, Input, PageHeader, Section, Select, StatusBadge, Table, TextLink, type TableColumn } from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { parseOrgFilter } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { listOrganizations, ORG_LIST_LIMIT, type OrgListRow } from "@/features/admin/server/queries";
import { formatUsd } from "@/lib/money";
import { formatBps, VENDOR_TYPES, vendorTypeLabel, isVendorType } from "@/server/businesses";
import { createBusinessAction, createSgoAction } from "../_actions";

export const metadata: Metadata = { title: "Organizations" };

const PATH = "/admin/organizations";
const TYPE_LABEL = { sgo: "SGO", business: "Business", platform: "Platform" } as const;

const COLUMNS: Array<TableColumn<OrgListRow>> = [
  {
    key: "name",
    header: "Organization",
    primary: true,
    cell: (r) => (
      <span>
        {r.org.name}
        <span className="block text-xs font-normal text-fg-muted">{r.org.slug}</span>
      </span>
    ),
  },
  { key: "type", header: "Type", cell: (r) => <Badge tone={r.org.type === "platform" ? "brand" : "neutral"} size="sm">{TYPE_LABEL[r.org.type]}</Badge> },
  { key: "status", header: "Status", cell: (r) => <StatusBadge kind="org" status={r.org.status} size="sm" /> },
  {
    key: "details",
    header: "Details",
    wrap: true,
    cell: (r) =>
      r.sgo ? (
        <span className="text-sm">
          {r.sgo.state} · {r.sgo.ein ?? "no EIN"} · {r.sgo.listEntryId ? "linked to a list entry" : <span className="text-warning-fg">not linked to the list</span>}
        </span>
      ) : r.business ? (
        <span className="text-sm">
          {isVendorType(r.business.vendorType) ? vendorTypeLabel(r.business.vendorType) : r.business.vendorType} · fee {formatUsd(r.business.successFeeFlatCents)} + {formatBps(r.business.successFeeBps)}
        </span>
      ) : (
        <span className="text-sm text-fg-muted">—</span>
      ),
  },
  { key: "members", header: "Members", numeric: true, cell: (r) => String(r.memberCount) },
  { key: "created", header: "Created", numeric: true, cell: (r) => <DateTime value={r.org.createdAt} /> },
];

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const filter = parseOrgFilter(await searchParams);
  const rows = await listOrganizations(filter);

  return (
    <div className="space-y-8">
      <PageHeader title="Organizations" description="Scholarship organizations, businesses and the platform itself. Open one to manage members, status, list link or success fee." />

      <Section title="Directory" description={rows.length >= ORG_LIST_LIMIT ? `Showing the newest ${ORG_LIST_LIMIT}. Narrow the filters to see others.` : `${rows.length} shown, newest first.`}>
        <Form action={PATH} className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <Select name="type" size="sm" defaultValue={filter.type ?? ""}>
              <option value="">Any</option>
              <option value="sgo">SGO</option>
              <option value="business">Business</option>
              <option value="platform">Platform</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" size="sm" defaultValue={filter.status ?? ""}>
              <option value="">Any</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </Field>
          <Field label="Name or slug">
            <Input name="q" type="search" size="sm" defaultValue={filter.q ?? ""} />
          </Field>
          <Button type="submit" size="sm" variant="secondary">
            Filter
          </Button>
          <TextLink href={PATH} tone="quiet">
            Clear
          </TextLink>
        </Form>
        <Card padding="none">
          <Table
            caption="Organizations"
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.org.id}
            rowHref={(r) => `${PATH}/${r.org.id}`}
            density="compact"
            empty={<EmptyState size="sm" title="No organizations match" description="Change the filters, or create one below." />}
          />
        </Card>
      </Section>

      <Section title="Create">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="New scholarship organization" description="Creates the organization, its profile and the owner's membership. It is not on any list until you link it to a list entry." />
            <AdminActionForm
              className="mt-4"
              action={createSgoAction}
              submitLabel="Create SGO"
              resetOnSuccess
              fieldLabels={{ name: "Name", ein: "EIN", city: "City", state: "State", ownerEmail: "Owner's email" }}
            >
              <Field label="Name" id="name">
                <Input name="name" autoComplete="off" />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="EIN" optional hint="NN-NNNNNNN" id="ein">
                  <Input name="ein" autoComplete="off" />
                </Field>
                <Field label="City" optional id="city">
                  <Input name="city" autoComplete="off" />
                </Field>
                <Field label="State" id="state">
                  <Input name="state" defaultValue="TX" maxLength={2} />
                </Field>
              </div>
              <Field label="Owner's email" hint="They sign in with this address. No email is sent." id="ownerEmail">
                <Input name="ownerEmail" type="email" autoComplete="off" />
              </Field>
            </AdminActionForm>
          </Card>

          <Card>
            <CardHeader title="New business" description="A camp, school or other vendor that installs the point-of-booking handoff. Its success fee starts at $0." />
            <AdminActionForm
              className="mt-4"
              action={createBusinessAction}
              submitLabel="Create business"
              resetOnSuccess
              fieldLabels={{ name: "Name", vendorType: "Kind of business", website: "Website", billingEmail: "Billing email", ownerEmail: "Owner's email" }}
            >
              <Field label="Name" id="name">
                <Input name="name" autoComplete="off" />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Kind of business" id="vendorType">
                  <Select name="vendorType" defaultValue={VENDOR_TYPES[0]}>
                    {VENDOR_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {vendorTypeLabel(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Website" optional id="website">
                  <Input name="website" type="url" placeholder="https://" />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Billing email" hint="Invoices for the success fee go here." id="billingEmail">
                  <Input name="billingEmail" type="email" autoComplete="off" />
                </Field>
                <Field label="Owner's email" id="ownerEmail">
                  <Input name="ownerEmail" type="email" autoComplete="off" />
                </Field>
              </div>
            </AdminActionForm>
          </Card>
        </div>
      </Section>
    </div>
  );
}
