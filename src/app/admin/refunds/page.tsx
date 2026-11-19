import type { Metadata } from "next";
import Form from "next/form";
import { Alert, Button, Card, CardHeader, DateTime, EmptyState, Field, Input, KeyValue, KeyValueList, LegalNote, Money, PageHeader, Section, StatusBadge, Textarea } from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { textParam } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { getRefundCandidate } from "@/features/admin/server/queries";
import { donationsPolicy } from "@/server/donations";
import { refundAction } from "../_actions";

export const metadata: Metadata = { title: "Refunds" };

const PATH = "/admin/refunds";

export default async function RefundsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage(PATH);
  const id = textParam(await searchParams, "donation", 100);
  const candidate = id ? await getRefundCandidate(id) : null;

  return (
    <div className="space-y-8">
      <PageHeader title="Refunds" description="Operator refunds of designated gifts. There is no self-serve refund and no way to undo a designation." />

      <LegalNote title="Counsel's advice first">
        A section 25F designation is irrevocable, and whether a designated gift may be refunded at all is not settled in the sources. Record a refund only on counsel’s
        advice, with its reference. The whole payment is returned: on a joint gift, both spouses’ donations.
      </LegalNote>

      <Section title="Find the gift">
        <Form action={PATH} className="flex flex-wrap items-end gap-3">
          <Field label="Donation id">
            <Input name="donation" defaultValue={id ?? ""} className="w-80" autoComplete="off" placeholder="don_…" />
          </Field>
          <Button type="submit" variant="secondary">
            Look up
          </Button>
        </Form>
        {id && !candidate ? <EmptyState size="sm" title="No donation with this id" /> : null}
      </Section>

      {candidate ? (
        <Card>
          <CardHeader
            title={`Gift to ${candidate.orgName}`}
            description={<span className="font-mono text-xs">{candidate.donationId}</span>}
            actions={
              <>
                <StatusBadge kind="mode" status={candidate.mode} size="sm" />
                <StatusBadge kind="donation" status={candidate.status} size="sm" />
              </>
            }
          />
          <KeyValueList className="mt-4" layout="grid" columns={3} dense>
            <KeyValue label="Designated (section 25F)">
              <Money cents={candidate.designatedAmountCents} showCents />
            </KeyValue>
            <KeyValue label="Not designated">
              <Money cents={candidate.nonDesignatedAmountCents} showCents />
            </KeyValue>
            <KeyValue label="Donor service fee">
              <Money cents={candidate.donorServiceFeeCents} showCents />
            </KeyValue>
            <KeyValue label="Charged">
              <DateTime value={candidate.contributedAt} format="dateTime" />
            </KeyValue>
            <KeyValue label="Payment">{candidate.paymentId ?? "—"}</KeyValue>
            <KeyValue label="Donations on this payment">{candidate.siblingDonationIds.join(", ")}</KeyValue>
          </KeyValueList>
          {candidate.status !== "succeeded" ? (
            <Alert tone="info" className="mt-4">
              Only a succeeded gift can be refunded. This one is {candidate.status}
              {candidate.refundedAt ? (
                <>
                  {" "}
                  (refunded <DateTime value={candidate.refundedAt} />)
                </>
              ) : null}
              .
            </Alert>
          ) : (
            <AdminActionForm
              className="mt-6"
              action={refundAction}
              submitLabel="Refund the payment"
              submitVariant="danger"
              pendingText="Refunding…"
              fieldLabels={{ reason: "Reason", counselReference: "Counsel reference" }}
              confirm={{
                title: "Refund this payment?",
                description: `${candidate.siblingDonationIds.length > 1 ? `All ${candidate.siblingDonationIds.length} donations on the payment are` : "The gift is"} returned to the donor. This cannot be undone.`,
                confirmLabel: "Refund payment",
                tone: "danger",
              }}
            >
              <input type="hidden" name="donationId" value={candidate.donationId} />
              <Field label="Reason" hint={`At least ${donationsPolicy.REFUND_REASON_MIN_LENGTH} characters. Recorded in the audit log.`} id="reason">
                <Textarea name="reason" rows={3} maxLength={1000} />
              </Field>
              <Field label="Counsel reference" hint="Reference of counsel's advice for this refund." id="counselReference">
                <Input name="counselReference" autoComplete="off" maxLength={500} />
              </Field>
            </AdminActionForm>
          )}
        </Card>
      ) : null}
    </div>
  );
}
