import type { Metadata } from "next";
import Form from "next/form";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DateTime,
  EmptyState,
  Field,
  Input,
  KeyValue,
  KeyValueList,
  PageHeader,
  ProvisionalNotice,
  Section,
  Select,
  StatusBadge,
  Table,
  TextLink,
  type TableColumn,
} from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { firstParam, hrefWith, LIST_UPLOAD_MAX_BYTES, parseListEntryFilter } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { getListEntry, listOrganizations } from "@/features/admin/server/queries";
import { centralDateString, now } from "@/lib/clock";
import { getSetting } from "@/server/settings";
import { LIST_CSV_COLUMNS, LIST_STATUS_COPY, listSgoListEntries, type ListEntryWithLink } from "@/server/sgos";
import { importListAction, linkListEntryAction, removeListEntryAction } from "../_actions";

export const metadata: Metadata = { title: "SGO list" };

const PATH = "/admin/sgo-list";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SgoListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAdminPage(PATH);
  const params = await searchParams;
  const filter = parseListEntryFilter(params);
  const actor = { userId: user.id };
  const [activeSource, entries] = await Promise.all([getSetting("sgoList.source"), listSgoListEntries({ ...filter, limit: 500 }, actor)]);
  const today = centralDateString(now());

  const removeId = firstParam(params, "remove");
  const linkId = firstParam(params, "link");
  const removing = removeId ? await getListEntry(removeId) : null;
  const linking = linkId ? await getListEntry(linkId) : null;
  const linkCandidates = linking
    ? (await listOrganizations({ type: "sgo" })).filter((o) => o.sgo && o.sgo.state === linking.state && !o.sgo.listEntryId && (!o.sgo.ein || !linking.ein || o.sgo.ein === linking.ein))
    : [];

  const keep = { source: filter.source, state: filter.state, status: filter.status, q: filter.query };
  const columns: Array<TableColumn<ListEntryWithLink>> = [
    {
      key: "name",
      header: "Organization",
      primary: true,
      wrap: true,
      cell: (e) => (
        <span>
          {e.name}
          <span className="block text-xs font-normal text-fg-muted">{e.ein ?? "No EIN on the list"}</span>
        </span>
      ),
    },
    { key: "state", header: "State", cell: (e) => e.state },
    { key: "source", header: "List", cell: (e) => <StatusBadge kind="sgo_list_source" status={e.source} size="sm" /> },
    { key: "status", header: "Status", cell: (e) => <StatusBadge kind="sgo_list" status={e.status} size="sm" /> },
    { key: "listedFrom", header: "Listed from", numeric: true, cell: (e) => <DateTime value={e.listedFrom} /> },
    { key: "removedOn", header: "Removed on", numeric: true, cell: (e) => <DateTime value={e.removedOn} /> },
    { key: "retrieved", header: "Retrieved", numeric: true, hideWhenStacked: true, cell: (e) => <DateTime value={e.sourceRetrievedAt ?? e.importedAt} /> },
    {
      key: "linked",
      header: "Linked SGO",
      cell: (e) =>
        e.linkedOrgId ? (
          <TextLink href={`/admin/organizations/${e.linkedOrgId}`}>Open</TextLink>
        ) : (
          <TextLink href={hrefWith(PATH, { ...keep, link: e.id })} tone="quiet">
            Link…
          </TextLink>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      align: "right",
      cell: (e) => (
        <TextLink href={hrefWith(PATH, { ...keep, remove: e.id })} tone="quiet">
          {e.status === "removed" ? "Change removal…" : "Mark removed…"}
        </TextLink>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="SGO list" description="The organizations a donor may give to. Rows are written only by list imports; every import is recorded with the file's SHA-256." />

      {activeSource === "provisional_curated" ? (
        <ProvisionalNotice title="The SGO list is provisional">
          {LIST_STATUS_COPY.provisional}. Donors are checked against the curated provisional list, and every surface labels it provisional.
        </ProvisionalNotice>
      ) : null}

      {removing ? (
        <Card id="remove">
          <CardHeader title={`Mark ${removing.name} removed`} description="Enter the removal exactly as the source shows it." actions={<Button href={hrefWith(PATH, keep)} variant="ghost" size="sm">Close</Button>} />
          <KeyValueList className="mt-4" dense>
            <KeyValue label="List">{removing.source === "irs_published" ? "IRS-published" : "Provisional curated"}</KeyValue>
            <KeyValue label="State and EIN">{`${removing.state} · ${removing.ein ?? "no EIN"}`}</KeyValue>
            <KeyValue label="Listed from">
              <DateTime value={removing.listedFrom} />
            </KeyValue>
            <KeyValue label="Current status">
              <StatusBadge kind="sgo_list" status={removing.status} size="sm" /> {removing.removedOn ? <DateTime value={removing.removedOn} /> : null}
            </KeyValue>
          </KeyValueList>
          <Alert tone="warning" className="mt-4">
            Gifts on or after the effective date are refused, and every linked SGO gets an audit entry. A later import of the full list replaces this row with what that file
            says, so the next file must show the removal too.
          </Alert>
          <AdminActionForm
            className="mt-4"
            action={removeListEntryAction}
            submitLabel="Record removal"
            submitVariant="danger"
            fieldLabels={{ removedOn: "Effective date", learnedOn: "Confirmed at the source on", sourceUrl: "Source address" }}
            confirm={{
              title: `Record the removal of ${removing.name}?`,
              description: "Gifts to this organization on or after the effective date will be refused.",
              confirmLabel: "Record removal",
              tone: "danger",
            }}
          >
            <input type="hidden" name="entryId" value={removing.id} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Effective date" hint="The removal date the source gives." id="removedOn">
                <Input name="removedOn" type="date" defaultValue={removing.removedOn ?? ""} />
              </Field>
              <Field label="Confirmed at the source on" id="learnedOn">
                <Input name="learnedOn" type="date" defaultValue={today} max={today} />
              </Field>
              <Field label="Source address" optional hint="Defaults to the address of the last import." id="sourceUrl">
                <Input name="sourceUrl" type="url" defaultValue={removing.sourceUrl ?? ""} />
              </Field>
            </div>
          </AdminActionForm>
        </Card>
      ) : null}

      {linking ? (
        <Card id="link">
          <CardHeader title={`Link ${linking.name} to an SGO`} description={`SGOs in ${linking.state} that are not linked to any entry${linking.ein ? " and whose EIN matches or is not on file" : ""}.`} actions={<Button href={hrefWith(PATH, keep)} variant="ghost" size="sm">Close</Button>} />
          {linkCandidates.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">
              No SGO can be linked to this entry. Create the organization first on <TextLink href="/admin/organizations">Organizations</TextLink>.
            </p>
          ) : (
            <AdminActionForm
              className="mt-4"
              layout="inline"
              action={linkListEntryAction}
              submitLabel="Link"
              fieldLabels={{ orgId: "Organization", entryId: "List entry" }}
              confirm={{ title: "Link this list entry?", description: "The SGO will be treated as listed (or removed) exactly as this entry says.", confirmLabel: "Link entry" }}
            >
              <input type="hidden" name="entryId" value={linking.id} />
              <Field label="Organization" id="orgId">
                <Select name="orgId" defaultValue={linkCandidates[0]?.org.id}>
                  {linkCandidates.map((o) => (
                    <option key={o.org.id} value={o.org.id}>
                      {o.org.name}
                      {o.sgo?.ein ? ` (${o.sgo.ein})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </AdminActionForm>
          )}
        </Card>
      ) : null}

      <Section title="Import a list file">
        <Card>
          <p className="text-sm text-fg-muted">
            A CSV with exactly these columns: <code className="font-mono text-xs">{LIST_CSV_COLUMNS.join(",")}</code>. Lines starting with # are ignored. A file with any
            problem is refused as a whole and nothing changes. Entries the file does not mention are left as they are. Largest file: {Math.floor(LIST_UPLOAD_MAX_BYTES / 1024)} KB.
          </p>
          <AdminActionForm
            className="mt-4"
            action={importListAction}
            submitLabel="Import list"
            pendingText="Importing…"
            resetOnSuccess
            fieldLabels={{ source: "List", file: "List file", sourceUrl: "Source address", retrievedOn: "Downloaded on" }}
            confirm={{ title: "Import this list file?", description: "Rows are added or updated as the file says, including removals. The file's SHA-256 is recorded in the audit log.", confirmLabel: "Import" }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="List" id="source">
                <Select name="source" defaultValue="provisional_curated">
                  <option value="provisional_curated">Provisional curated list</option>
                  <option value="irs_published">IRS-published list</option>
                </Select>
              </Field>
              <Field label="List file" id="file">
                <Input name="file" type="file" accept=".csv,text/csv" />
              </Field>
              <Field label="Source address" optional hint="Where the file was downloaded from (http or https)." id="sourceUrl">
                <Input name="sourceUrl" type="url" placeholder="https://" />
              </Field>
              <Field label="Downloaded on" id="retrievedOn">
                <Input name="retrievedOn" type="date" defaultValue={today} max={today} />
              </Field>
            </div>
          </AdminActionForm>
        </Card>
      </Section>

      <Section title="Entries" description={`${entries.length} shown, ordered by State and name.`}>
        <Form action={PATH} className="flex flex-wrap items-end gap-3">
          <Field label="List">
            <Select name="source" size="sm" defaultValue={filter.source ?? ""}>
              <option value="">Both lists</option>
              <option value="provisional_curated">Provisional curated</option>
              <option value="irs_published">IRS-published</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" size="sm" defaultValue={filter.status ?? ""}>
              <option value="">Any</option>
              <option value="listed">Listed</option>
              <option value="removed">Removed</option>
            </Select>
          </Field>
          <Field label="State">
            <Input name="state" size="sm" maxLength={2} defaultValue={filter.state ?? ""} placeholder="TX" className="w-20" />
          </Field>
          <Field label="Name or EIN">
            <Input name="q" size="sm" type="search" defaultValue={filter.query ?? ""} />
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
            caption="SGO list entries"
            columns={columns}
            rows={entries}
            rowKey={(e) => e.id}
            density="compact"
            selectedKey={removing?.id ?? linking?.id ?? null}
            empty={<EmptyState size="sm" title="No entries" description="Import a list file, or change the filters." />}
          />
        </Card>
      </Section>
    </div>
  );
}
