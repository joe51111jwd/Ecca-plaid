import type { Metadata } from "next";
import Form from "next/form";
import { Badge, Button, Card, CardHeader, DateTime, EmptyState, Field, Input, KeyValue, KeyValueList, PageHeader, Section, Textarea } from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { DELETION_REASON_LIMITS, textParam } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { findHouseholds } from "@/features/admin/server/queries";
import { processDeletionAction } from "../_actions";

export const metadata: Metadata = { title: "Privacy requests" };

const PATH = "/admin/privacy";

export default async function PrivacyRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const q = textParam(await searchParams, "q", 320);
  const matches = q ? await findHouseholds(q) : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Privacy requests"
        description="Process a family's request to delete their data. The request arrives through support, so confirm who is asking before you search."
      />

      <Section title="What a deletion does">
        <Card>
          <div className="grid grid-cols-1 gap-6 text-sm md:grid-cols-2">
            <div>
              <h3 className="font-semibold text-fg">Deleted or cleared now</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
                <li>Every raw uploaded file: bytes deleted and their encryption keys destroyed.</li>
                <li>The household’s street address, city, ZIP and county.</li>
                <li>Every member’s date of birth, and the phone number of each linked sign-in.</li>
                <li>Every still-active consent is revoked; open data connections are disconnected and open verifications canceled.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-fg">Kept, as the scholarship organization’s record</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
                <li>Decisions already made, with the threshold, county and household size used.</li>
                <li>Document records with their file hashes and extracted fields; evidence packs.</li>
                <li>Member names and the consent records that authorized each share.</li>
                <li>The audit log, including this request and its reason.</li>
              </ul>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Find the household">
        <Form action={PATH} className="flex flex-wrap items-end gap-3">
          <Field label="Owner's email or household id" hint="Exact match only.">
            <Input name="q" type="search" defaultValue={q ?? ""} className="w-96" autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Form>

        {q && matches.length === 0 ? <EmptyState size="sm" title="No household found" description="Check the address or id. Only exact matches are shown." /> : null}

        {matches.map((h) => (
          <Card key={h.householdId}>
            <CardHeader
              title={h.ownerEmail}
              description={<span className="font-mono text-xs">{h.householdId}</span>}
              actions={h.addressCleared ? <Badge tone="neutral">Address already cleared</Badge> : null}
            />
            <KeyValueList className="mt-4" layout="grid" columns={3} dense>
              <KeyValue label="Created">
                <DateTime value={h.createdAt} />
              </KeyValue>
              <KeyValue label="County">{h.countyName ?? "—"}</KeyValue>
              <KeyValue label="Members">{String(h.members)}</KeyValue>
              <KeyValue label="Documents">{`${h.documents} (${h.documentsWithFiles} with files not yet purged)`}</KeyValue>
              <KeyValue label="Open verifications">{String(h.openVerifications)}</KeyValue>
              <KeyValue label="Active consents">{String(h.activeConsents)}</KeyValue>
              <KeyValue label="Open data connections">{String(h.openRailConnections)}</KeyValue>
            </KeyValueList>
            <AdminActionForm
              className="mt-6"
              action={processDeletionAction}
              submitLabel="Process deletion request"
              submitVariant="danger"
              pendingText="Processing…"
              fieldLabels={{ reason: "Request details" }}
              confirm={{
                title: `Delete ${h.ownerEmail}'s data?`,
                description: "Uploaded files are destroyed and cannot be recovered. Open verifications are canceled. This cannot be undone.",
                confirmLabel: "Delete data",
                tone: "danger",
              }}
            >
              <input type="hidden" name="householdId" value={h.householdId} />
              <Field
                label="Request details"
                hint={`Who asked, how they were identified, and the support ticket. Recorded in the audit log (${DELETION_REASON_LIMITS.min}–${DELETION_REASON_LIMITS.max} characters).`}
                id="reason"
              >
                <Textarea name="reason" rows={3} maxLength={DELETION_REASON_LIMITS.max} />
              </Field>
            </AdminActionForm>
          </Card>
        ))}
      </Section>
    </div>
  );
}
