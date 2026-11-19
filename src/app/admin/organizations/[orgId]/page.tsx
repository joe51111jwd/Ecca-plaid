import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  DateTime,
  EmptyState,
  Field,
  Input,
  KeyValue,
  KeyValueList,
  PageHeader,
  Section,
  Select,
  StatusBadge,
  Table,
  TextLink,
  Textarea,
  type TableColumn,
} from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { bpsToPercentInput, centsToDollarsInput, MEMBER_ROLE_VALUES, ORG_STATUS_REASON_LIMITS, SUCCESS_FEE_FORM_LIMITS } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { getListEntry, getOrganization } from "@/features/admin/server/queries";
import { formatUsd } from "@/lib/money";
import { describeFeeTerms, getBusinessProfile, isVendorType, vendorTypeLabel } from "@/server/businesses";
import { listMembers, type MemberSummary } from "@/server/orgs";
import { getListStatus, getSgoProfile, listSgoListEntries } from "@/server/sgos";
import { addMemberAction, changeRoleAction, linkListEntryAction, removeMemberAction, setOrgStatusAction, setSuccessFeeAction } from "../../_actions";

export const metadata: Metadata = { title: "Organization" };

const TYPE_LABEL = { sgo: "Scholarship organization", business: "Business", platform: "Platform" } as const;
const ROLE_LABEL = { owner: "Owner", admin: "Admin", reviewer: "Reviewer", viewer: "Viewer" } as const;

export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { user } = await requireAdminPage(`/admin/organizations/${encodeURIComponent(orgId)}`);
  const org = await getOrganization(orgId);
  if (!org) notFound();
  const actor = { userId: user.id };
  const members = await listMembers(org.id, actor);

  const sgo = org.type === "sgo" ? await getSgoProfile(org.id) : null;
  const listStatus = sgo ? await getListStatus(org.id) : null;
  const linkedEntry = sgo?.profile.listEntryId ? await getListEntry(sgo.profile.listEntryId) : null;
  const entryOptions = sgo
    ? (await listSgoListEntries({ state: sgo.profile.state, limit: 1000 }, actor)).filter(
        (e) => (e.linkedOrgId === null || e.linkedOrgId === org.id) && (!e.ein || !sgo.profile.ein || e.ein === sgo.profile.ein),
      )
    : [];
  const business = org.type === "business" ? await getBusinessProfile(org.id) : null;

  const memberColumns: Array<TableColumn<MemberSummary>> = [
    {
      key: "person",
      header: "Person",
      primary: true,
      cell: (m) => (
        <span>
          {m.user.name ?? m.user.email}
          <span className="block text-xs font-normal text-fg-muted">{m.user.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (m) => (
        <AdminActionForm action={changeRoleAction} layout="inline" submitLabel="Change" submitVariant="secondary" submitSize="sm" aria-label={`Role of ${m.user.email}`}>
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="userId" value={m.user.id} />
          <Field label={`Role of ${m.user.email}`} hideLabel>
            <Select name="role" size="sm" defaultValue={m.membership.role}>
              {MEMBER_ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </AdminActionForm>
      ),
    },
    { key: "lastLogin", header: "Last sign-in", numeric: true, cell: (m) => <DateTime value={m.user.lastLoginAt} format="dateTime" placeholder="Never" /> },
    {
      key: "remove",
      header: <span className="sr-only">Remove</span>,
      label: "Remove",
      align: "right",
      cell: (m) => (
        <AdminActionForm
          action={removeMemberAction}
          layout="inline"
          submitLabel="Remove"
          submitVariant="ghost"
          submitSize="sm"
          aria-label={`Remove ${m.user.email}`}
          confirm={{ title: `Remove ${m.user.email}?`, description: `They lose access to ${org.name} immediately. Their account is kept.`, confirmLabel: "Remove member", tone: "danger" }}
        >
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="userId" value={m.user.id} />
        </AdminActionForm>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={org.name}
        breadcrumbs={[{ label: "Organizations", href: "/admin/organizations" }]}
        meta={
          <>
            <Badge tone="neutral">{TYPE_LABEL[org.type]}</Badge>
            <StatusBadge kind="org" status={org.status} />
          </>
        }
        description={
          <>
            {org.slug} · <span className="font-mono">{org.id}</span> · created <DateTime value={org.createdAt} />
          </>
        }
      />

      {org.type !== "platform" ? (
        <Section title="Status" description="A suspended SGO takes no gifts; a suspended business's embed stops working. Members keep their accounts.">
          <Card>
            <AdminActionForm
              action={setOrgStatusAction}
              submitLabel={org.status === "suspended" ? "Reinstate organization" : "Suspend organization"}
              submitVariant={org.status === "suspended" ? "primary" : "danger"}
              resetOnSuccess
              fieldLabels={{ reason: "Reason" }}
              confirm={
                org.status === "suspended"
                  ? { title: `Reinstate ${org.name}?`, description: "It can use the platform again from now.", confirmLabel: "Reinstate" }
                  : { title: `Suspend ${org.name}?`, description: "Gifts to a suspended SGO are refused and a suspended business's embed stops working until it is reinstated.", confirmLabel: "Suspend", tone: "danger" }
              }
            >
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="status" value={org.status === "suspended" ? "active" : "suspended"} />
              <Field label="Reason" hint={`Recorded in the audit log. ${ORG_STATUS_REASON_LIMITS.min}–${ORG_STATUS_REASON_LIMITS.max} characters.`} id="reason">
                <Textarea name="reason" rows={2} maxLength={ORG_STATUS_REASON_LIMITS.max} />
              </Field>
            </AdminActionForm>
          </Card>
        </Section>
      ) : null}

      {sgo && listStatus ? (
        <Section title="SGO list" description="Gifts are taken only while the organization is on the active list. Only a platform admin links an SGO to a list entry.">
          <Card>
            <KeyValueList dense>
              <KeyValue label="Standing">{listStatus.label}</KeyValue>
              <KeyValue label="EIN">{sgo.profile.ein ?? "Not on file"}</KeyValue>
              <KeyValue label="State">{sgo.profile.state}</KeyValue>
              <KeyValue label="Linked entry">
                {linkedEntry ? (
                  <>
                    {linkedEntry.name} · <StatusBadge kind="sgo_list_source" status={linkedEntry.source} size="sm" /> <StatusBadge kind="sgo_list" status={linkedEntry.status} size="sm" />
                  </>
                ) : (
                  "None"
                )}
              </KeyValue>
              <KeyValue label="IRS SGO portal">{sgo.profile.irsPortalRegistered ? "Registered" : "Not registered yet"}</KeyValue>
            </KeyValueList>
            {entryOptions.length === 0 && !linkedEntry ? (
              <Alert tone="info" className="mt-4">
                No entry in {sgo.profile.state} can be linked. Import the list on the <TextLink href="/admin/sgo-list">SGO list</TextLink> page first.
              </Alert>
            ) : (
              <AdminActionForm
                className="mt-4"
                layout="inline"
                action={linkListEntryAction}
                submitLabel="Save link"
                submitVariant="secondary"
                fieldLabels={{ entryId: "List entry" }}
                confirm={{ title: "Change this organization's list link?", description: "Whether gifts can be taken follows the chosen entry from now on.", confirmLabel: "Save link" }}
              >
                <input type="hidden" name="orgId" value={org.id} />
                <Field label="List entry" id="entryId">
                  <Select name="entryId" defaultValue={sgo.profile.listEntryId ?? ""}>
                    <option value="">Not linked</option>
                    {entryOptions.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.ein ?? "no EIN"}) · {e.source === "irs_published" ? "IRS list" : "provisional list"} · {e.status}
                      </option>
                    ))}
                  </Select>
                </Field>
              </AdminActionForm>
            )}
          </Card>
        </Section>
      ) : null}

      {business ? (
        <Section title="Success fee" description="Billed to the business on its own invoice for each booking completed with scholarship funds.">
          <Card>
            <KeyValueList dense>
              <KeyValue label="Kind of business">{isVendorType(business.profile.vendorType) ? vendorTypeLabel(business.profile.vendorType) : business.profile.vendorType}</KeyValue>
              <KeyValue label="Billing email">{business.profile.billingEmail ?? "—"}</KeyValue>
              <KeyValue label="Current terms">{describeFeeTerms(business.profile)}</KeyValue>
            </KeyValueList>
            <AdminActionForm
              className="mt-4"
              action={setSuccessFeeAction}
              submitLabel="Save fee"
              fieldLabels={{ flatDollars: "Flat fee", percent: "Percentage fee" }}
              confirm={{ title: "Change this business's success fee?", description: "Applies to bookings completed from now on. Families are never charged.", confirmLabel: "Save fee" }}
            >
              <input type="hidden" name="orgId" value={org.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Flat fee per booking ($)" hint={`At most ${formatUsd(SUCCESS_FEE_FORM_LIMITS.maxFlatCents)}.`} id="flatDollars">
                  <Input name="flatDollars" inputMode="decimal" defaultValue={centsToDollarsInput(business.profile.successFeeFlatCents)} leading="$" />
                </Field>
                <Field label="Percentage of the booking (%)" hint={`At most ${bpsToPercentInput(SUCCESS_FEE_FORM_LIMITS.maxBps)}%.`} id="percent">
                  <Input name="percent" inputMode="decimal" defaultValue={bpsToPercentInput(business.profile.successFeeBps)} trailing="%" />
                </Field>
              </div>
            </AdminActionForm>
          </Card>
        </Section>
      ) : null}

      <Section title="Members" description={`${members.length} ${members.length === 1 ? "person" : "people"}. An organization always keeps at least one owner.`}>
        <Card padding="none">
          <Table caption={`Members of ${org.name}`} columns={memberColumns} rows={members} rowKey={(m) => m.membership.id} density="compact" empty={<EmptyState size="sm" title="No members" />} />
        </Card>
        <Card>
          <CardHeader title="Add a member" description="They sign in with their email address; no invitation is sent from here." level={3} />
          <AdminActionForm className="mt-4" action={addMemberAction} submitLabel="Add member" resetOnSuccess fieldLabels={{ email: "Email", role: "Role" }}>
            <input type="hidden" name="orgId" value={org.id} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Email" id="email">
                <Input name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Role" id="role">
                <Select name="role" defaultValue="viewer">
                  {MEMBER_ROLE_VALUES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </AdminActionForm>
        </Card>
      </Section>
    </div>
  );
}
