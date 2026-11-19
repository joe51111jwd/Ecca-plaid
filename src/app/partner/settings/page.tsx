import type { Metadata } from "next";
import { Alert, Card, CardBody, CardHeader, DateTime, EmptyState, Field, Input, KeyValueList, PageHeader, Section, Select, StatusBadge, Table } from "@/components/ui";
import type { MemberRole } from "@/db/schema";
import { ActionForm } from "@/features/handoff/components/ActionForm";
import { BrandingForm } from "@/features/handoff/components/BrandingForm";
import { PORTAL_HOME } from "@/features/handoff/policy";
import { requirePortalPage, type SearchParams } from "@/features/handoff/server/context";
import { listSgosAcceptingHandoffs } from "@/features/handoff/server/queries";
import { BRAND } from "@/lib/brand";
import { HOLD_WINDOW_HOURS, listPartnershipsForBusiness, MANAGE_ROLE, VENDOR_TYPES, vendorTypeLabel } from "@/server/businesses";
import { listMembers } from "@/server/orgs";
import { changeRoleAction, endPartnershipAction, inviteMemberAction, removeMemberAction, requestPartnershipAction, saveProfileAction } from "../actions";
import { PortalFrame } from "../_frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · Business portal", robots: { index: false, follow: false } };

const ROLES: Array<{ value: MemberRole; label: string; description: string }> = [
  { value: "owner", label: "Owner", description: "Everything, including other owners" },
  { value: "admin", label: "Admin", description: "Settings, keys, team and handoffs" },
  { value: "reviewer", label: "Reviewer", description: "Extend, complete and cancel handoffs" },
  { value: "viewer", label: "Viewer", description: "Read only" },
];

/** /partner/settings — branding (with a live preview), business details and hold window, team, and SGO partnerships. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const path = `${PORTAL_HOME}/settings`;
  const ctx = await requirePortalPage(path, await searchParams);
  const manage = ctx.can(MANAGE_ROLE);
  const [members, partnerships, sgos] = await Promise.all([listMembers(ctx.org.id, { userId: ctx.user.id }), listPartnershipsForBusiness(ctx.org.id), manage ? listSgosAcceptingHandoffs() : Promise.resolve([])]);
  const partnered = new Set(partnerships.filter((p) => p.partnership.status !== "ended").map((p) => p.sgo.orgId));
  const requestable = sgos.filter((s) => !partnered.has(s.orgId));
  const p = ctx.profile;

  return (
    <PortalFrame ctx={ctx} path={path}>
      <PageHeader className="mb-8" title="Settings" />
      {!manage ? <Alert tone="neutral" className="mb-6">Only owners and admins can change settings.</Alert> : null}

      <Section title="Branding" description="Families see your name, color and logo beside ours on the handoff page.">
        <Card>
          {manage ? (
            <BrandingForm orgId={ctx.org.id} initial={{ displayName: p.displayName, brandColor: p.brandColor, logoUrl: p.logoUrl }} action={saveProfileAction} productName={BRAND.name} />
          ) : (
            <p className="text-sm">{p.displayName}</p>
          )}
        </Card>
      </Section>

      <Section title="Business details" className="mt-10">
        <Card>
          {manage ? (
          <ActionForm action={saveProfileAction} submitLabel="Save details" fieldLabels={{ vendorType: "Kind of business", holdWindowHours: "Hold window", billingEmail: "Billing email", website: "Website" }}>
            <input type="hidden" name="orgId" value={ctx.org.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind of business" hint="Which providers qualify is not final under the proposed rules, so this stays editable.">
                <Select name="vendorType" defaultValue={p.vendorType}>
                  {VENDOR_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {vendorTypeLabel(v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Hold window (hours)" hint={`How long a spot is held while the family verifies and the organization decides. ${HOLD_WINDOW_HOURS.min} to ${HOLD_WINDOW_HOURS.max} hours. Applies to new handoffs.`}>
                <Input name="holdWindowHours" type="number" inputMode="numeric" min={HOLD_WINDOW_HOURS.min} max={HOLD_WINDOW_HOURS.max} step={1} defaultValue={p.holdWindowHours} />
              </Field>
              <Field label="Billing email" hint="Where invoices for your success fees go.">
                <Input name="billingEmail" type="email" defaultValue={p.billingEmail ?? ""} />
              </Field>
              <Field label="Website" optional>
                <Input name="website" type="url" defaultValue={p.website ?? ""} />
              </Field>
            </div>
          </ActionForm>
          ) : (
            <KeyValueList
              items={[
                { label: "Kind of business", value: vendorTypeLabel(p.vendorType) },
                { label: "Hold window", value: `${p.holdWindowHours} hours` },
                { label: "Billing email", value: p.billingEmail ?? "—" },
                { label: "Website", value: p.website ?? "—" },
              ]}
            />
          )}
        </Card>
      </Section>

      <Section title="Scholarship organization partners" className="mt-10" description="Families can only be handed to organizations that accepted your request. With several partners, the family chooses.">
        <Card padding="none">
          <Table
            caption="Partnerships"
            rows={partnerships}
            rowKey={(r) => r.partnership.id}
            columns={[
              { key: "sgo", header: "Organization", primary: true, cell: (r) => r.sgo.displayName },
              { key: "status", header: "Status", cell: (r) => <StatusBadge kind="partnership" status={r.partnership.status} size="sm" /> },
              { key: "accepting", header: "Accepting families", cell: (r) => (r.sgo.acceptsHandoffs ? "Yes" : "Paused") },
              { key: "since", header: "Since", cell: (r) => <DateTime value={r.partnership.createdAt} /> },
              {
                key: "end",
                header: <span className="sr-only">End</span>,
                label: "End",
                cell: (r) =>
                  manage && r.partnership.status !== "ended" ? (
                    <ActionForm action={endPartnershipAction} submitLabel={r.partnership.status === "pending" ? "Withdraw" : "End"} submitVariant="ghost" submitSize="sm" quietSuccess confirm={{ title: `End the partnership with ${r.sgo.displayName}?`, description: "New families will not be handed to this organization. Open handoffs are not affected.", confirmLabel: "End partnership", tone: "danger" }}>
                      <input type="hidden" name="orgId" value={ctx.org.id} />
                      <input type="hidden" name="partnershipId" value={r.partnership.id} />
                    </ActionForm>
                  ) : null,
              },
            ]}
            empty={<EmptyState size="sm" title="No partners yet" description="Request a partnership below. The button cannot start a handoff until one is active." />}
          />
          {manage ? (
            <CardBody className="border-t border-line">
              {requestable.length > 0 ? (
                <ActionForm action={requestPartnershipAction} submitLabel="Request partnership" layout="inline" aria-label="Request a partnership" fieldLabels={{ sgoOrgId: "Organization" }}>
                  <input type="hidden" name="orgId" value={ctx.org.id} />
                  <Field label="Organization">
                    <Select name="sgoOrgId" placeholder="Choose an organization" required>
                      {requestable.map((s) => (
                        <option key={s.orgId} value={s.orgId}>
                          {s.displayName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </ActionForm>
              ) : (
                <p className="text-sm text-fg-muted">No other scholarship organizations are accepting booking handoffs right now.</p>
              )}
            </CardBody>
          ) : null}
        </Card>
      </Section>

      <Section title="Team" className="mt-10">
        <Card padding="none">
          <CardHeader title="Members" divided />
          <Table
            caption="Team members"
            rows={members}
            rowKey={(m) => m.membership.id}
            columns={[
              { key: "email", header: "Email", primary: true, cell: (m) => m.user.email },
              {
                key: "role",
                header: "Role",
                cell: (m) =>
                  manage && m.user.id !== ctx.user.id ? (
                    <ActionForm action={changeRoleAction} submitLabel="Change" submitVariant="ghost" submitSize="sm" layout="inline" quietSuccess aria-label={`Role of ${m.user.email}`}>
                      <input type="hidden" name="orgId" value={ctx.org.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <Field label="Role" hideLabel>
                        <Select name="role" defaultValue={m.membership.role} size="sm">
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </ActionForm>
                  ) : (
                    ROLES.find((r) => r.value === m.membership.role)?.label
                  ),
              },
              { key: "seen", header: "Last sign-in", cell: (m) => <DateTime value={m.user.lastLoginAt} placeholder="Not yet" /> },
              {
                key: "remove",
                header: <span className="sr-only">Remove</span>,
                label: "Remove",
                cell: (m) =>
                  manage && m.user.id !== ctx.user.id ? (
                    <ActionForm action={removeMemberAction} submitLabel="Remove" submitVariant="ghost" submitSize="sm" quietSuccess confirm={{ title: `Remove ${m.user.email}?`, description: "They lose access to this business right away.", confirmLabel: "Remove", tone: "danger" }}>
                      <input type="hidden" name="orgId" value={ctx.org.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                    </ActionForm>
                  ) : null,
              },
            ]}
          />
          {manage ? (
            <CardBody className="border-t border-line">
              <ActionForm action={inviteMemberAction} submitLabel="Add member" layout="inline" resetOnSuccess aria-label="Add a team member" fieldLabels={{ email: "Email", role: "Role" }}>
                <input type="hidden" name="orgId" value={ctx.org.id} />
                <Field label="Email">
                  <Input name="email" type="email" required placeholder="name@camp.example.org" />
                </Field>
                <Field label="Role">
                  <Select name="role" defaultValue="reviewer">
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label} — {r.description}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            </CardBody>
          ) : null}
        </Card>
      </Section>
    </PortalFrame>
  );
}
