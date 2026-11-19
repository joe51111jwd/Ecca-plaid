import type { Metadata } from "next";
import { Alert, Card, DateTime, EmptyState, LegalNote, PageHeader, StatusBadge, Table, TextLink, type TableColumn } from "@/components/ui";
import { roleAtLeast } from "@/server/auth";
import { listPartnershipsForSgo, vendorTypeLabel, type PartnershipSummary } from "@/server/businesses";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { SGO_PATHS } from "@/features/sgo/nav";
import { MANAGE_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { endPartnershipAction, respondPartnershipAction } from "../../_actions";

export const metadata: Metadata = { title: "Camps and schools" };

export default async function PartnersPage() {
  const ctx = await requireSgoPage(SGO_PATHS.partners);
  const canManage = roleAtLeast(ctx.role, MANAGE_ROLE);
  const partnerships = await listPartnershipsForSgo(ctx.org.id);

  const columns: Array<TableColumn<PartnershipSummary>> = [
    {
      key: "business",
      header: "Business",
      primary: true,
      cell: ({ business }) => (
        <span>
          {business.displayName}
          <span className="block text-xs font-normal text-fg-muted">{vendorTypeLabel(business.vendorType)}</span>
        </span>
      ),
    },
    { key: "website", header: "Website", cell: ({ business }) => (business.website ? <TextLink href={business.website}>{business.website.replace(/^https?:\/\//, "")}</TextLink> : <span className="text-fg-subtle">—</span>) },
    { key: "status", header: "Status", cell: ({ partnership }) => <StatusBadge kind="partnership" status={partnership.status} size="sm" /> },
    { key: "requested", header: "Requested", cell: ({ partnership }) => <DateTime value={partnership.createdAt} format="date" /> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: ({ partnership, business }) =>
        !canManage ? null : partnership.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <SgoActionForm action={respondPartnershipAction} orgId={ctx.org.id} submitLabel="Accept" submitSize="sm" layout="inline" aria-label={`Accept ${business.displayName}`}>
              <input type="hidden" name="partnershipId" value={partnership.id} />
              <input type="hidden" name="decision" value="active" />
            </SgoActionForm>
            <SgoActionForm action={respondPartnershipAction} orgId={ctx.org.id} submitLabel="Decline" submitVariant="secondary" submitSize="sm" layout="inline" aria-label={`Decline ${business.displayName}`}>
              <input type="hidden" name="partnershipId" value={partnership.id} />
              <input type="hidden" name="decision" value="ended" />
            </SgoActionForm>
          </div>
        ) : partnership.status === "active" ? (
          <SgoActionForm
            action={endPartnershipAction}
            orgId={ctx.org.id}
            submitLabel="End"
            submitVariant="ghost"
            submitSize="sm"
            layout="inline"
            aria-label={`End the partnership with ${business.displayName}`}
            confirm={{ title: `End the partnership with ${business.displayName}?`, description: "New families from their bookings can no longer be handed to you.", confirmLabel: "End partnership", tone: "danger" }}
          >
            <input type="hidden" name="partnershipId" value={partnership.id} />
          </SgoActionForm>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Camps and schools" description="Businesses that asked to hand families to your organization from their booking flow. Accepting lets their families start a verification with you; it does not commit you to any award." />
      {!ctx.profile.acceptsHandoffs ? (
        <Alert tone="info" title="You are not accepting families from bookings">
          <p>
            Turn it on in <TextLink href={SGO_PATHS.settings}>Settings</TextLink> before businesses can request a partnership.
          </p>
        </Alert>
      ) : null}
      <Card padding="none">
        <Table caption="Partnership requests and partners" columns={columns} rows={partnerships} rowKey={(p) => p.partnership.id} empty={<EmptyState size="sm" title="No requests yet" description="When a camp or school asks to partner with you, it appears here." />} />
      </Card>
      <LegalNote>The business pays its own success fee on its own invoice. No fee is ever charged to a family or taken from scholarship funds.</LegalNote>
    </div>
  );
}
