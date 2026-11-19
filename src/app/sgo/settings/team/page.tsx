import type { Metadata } from "next";
import { Badge, Card, CardHeader, DateTime, Field, Input, PageHeader, Select, Table, type TableColumn } from "@/components/ui";
import type { MemberRole } from "@/db/schema";
import { roleAtLeast } from "@/server/auth";
import type { MemberSummary } from "@/server/orgs";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { ROLE_LABELS } from "@/features/sgo/labels";
import { SGO_PATHS } from "@/features/sgo/nav";
import { MANAGE_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { loadTeam } from "@/features/sgo/server/queries";
import { addMemberAction, changeRoleAction, removeMemberAction } from "../../_actions";

export const metadata: Metadata = { title: "Team" };

const ROLES = Object.keys(ROLE_LABELS) as MemberRole[];

function RoleSelect({ name, defaultValue, allowOwner }: { name: string; defaultValue: MemberRole; allowOwner: boolean }) {
  return (
    <Select name={name} size="sm" defaultValue={defaultValue}>
      {ROLES.filter((r) => allowOwner || r !== "owner").map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r].label}
        </option>
      ))}
    </Select>
  );
}

export default async function TeamPage() {
  const ctx = await requireSgoPage(SGO_PATHS.team);
  const canManage = roleAtLeast(ctx.role, MANAGE_ROLE);
  const isOwner = ctx.role === "owner";
  const team = await loadTeam(ctx.actor);

  const columns: Array<TableColumn<MemberSummary>> = [
    {
      key: "who",
      header: "Person",
      primary: true,
      cell: (m) => (
        <span>
          {m.user.name?.trim() || m.user.email}
          {m.user.id === ctx.user.id ? (
            <Badge size="sm" tone="neutral" className="ml-2">
              You
            </Badge>
          ) : null}
          <span className="block text-xs font-normal text-fg-muted">{m.user.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (m) =>
        canManage && m.user.id !== ctx.user.id && (isOwner || m.membership.role !== "owner") ? (
          <SgoActionForm action={changeRoleAction} orgId={ctx.org.id} submitLabel="Change" submitVariant="secondary" submitSize="sm" layout="inline" aria-label={`Change role of ${m.user.email}`}>
            <input type="hidden" name="userId" value={m.user.id} />
            <Field label="Role" hideLabel>
              <RoleSelect name="role" defaultValue={m.membership.role} allowOwner={isOwner} />
            </Field>
          </SgoActionForm>
        ) : (
          ROLE_LABELS[m.membership.role].label
        ),
    },
    { key: "joined", header: "Added", cell: (m) => <DateTime value={m.membership.createdAt} format="date" /> },
    { key: "seen", header: "Last sign-in", cell: (m) => <DateTime value={m.user.lastLoginAt} format="dateTime" placeholder="Never" /> },
    {
      key: "remove",
      header: <span className="sr-only">Remove</span>,
      cell: (m) =>
        (canManage && (isOwner || m.membership.role !== "owner")) || m.user.id === ctx.user.id ? (
          <SgoActionForm
            action={removeMemberAction}
            orgId={ctx.org.id}
            submitLabel={m.user.id === ctx.user.id ? "Leave" : "Remove"}
            submitVariant="ghost"
            submitSize="sm"
            layout="inline"
            aria-label={`Remove ${m.user.email}`}
            confirm={{ title: m.user.id === ctx.user.id ? "Leave this organization?" : `Remove ${m.user.email}?`, description: "They lose access to this organization's dashboard at once.", confirmLabel: m.user.id === ctx.user.id ? "Leave" : "Remove", tone: "danger" }}
          >
            <input type="hidden" name="userId" value={m.user.id} />
          </SgoActionForm>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Who can see and act on your organization's data. People sign in with their email address; there are no passwords." />
      <Card padding="none">
        <Table caption="Team members" columns={columns} rows={team} rowKey={(m) => m.membership.id} />
      </Card>
      {canManage ? (
        <Card>
          <CardHeader title="Add a person" level={2} />
          <SgoActionForm action={addMemberAction} orgId={ctx.org.id} submitLabel="Add" className="mt-4" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Email address">
                <Input name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Role">
                <RoleSelect name="role" defaultValue="reviewer" allowOwner={isOwner} />
              </Field>
            </div>
          </SgoActionForm>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="What each role can do" level={2} />
        <dl className="mt-3 space-y-2 text-sm">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="font-semibold text-fg">{ROLE_LABELS[r].label}</dt>
              <dd className="text-fg-muted">{ROLE_LABELS[r].description}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
