import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Card, CardBody, CardHeader, DateTime, Field, Input, KeyValueList, Money, PageHeader, Select, StatusBadge, Textarea, Timeline } from "@/components/ui";
import { ActionForm } from "@/features/handoff/components/ActionForm";
import { holdExtensionChoices } from "@/features/handoff/portal";
import { PORTAL_HOME } from "@/features/handoff/policy";
import { requirePortalPage, type SearchParams } from "@/features/handoff/server/context";
import { handoffTimeline } from "@/features/handoff/server/queries";
import { isAppError } from "@/lib/errors";
import { formatDeadline, getHandoff, HANDOFF_OPERATOR_ROLE, HOLD_EXTENSION_LIMITS, isFinal, isHolding, recordToApi } from "@/server/handoffs";
import { cancelHandoffAction, completeHandoffAction, extendHoldAction } from "../../actions";
import { PortalFrame } from "../../_frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Handoff · Business portal", robots: { index: false, follow: false } };

const PAYMENT_METHOD: Record<string, string> = { direct_to_vendor: "Paid by the SGO directly to you", qualified_digital_wallet: "Through a qualified digital wallet", other: "Another way the SGO arranges" };

/** /partner/handoffs/{id} — one handoff: its facts, its timeline, and what the business can do next. */
export default async function HandoffDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const path = `${PORTAL_HOME}/handoffs/${encodeURIComponent(id)}`;
  const ctx = await requirePortalPage(path, await searchParams);
  let record;
  try {
    record = await getHandoff(ctx.org.id, id, { mode: ctx.mode });
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { handoff: h, related } = record;
  const api = recordToApi(record);
  const timeline = await handoffTimeline(ctx.org.id, h.id);
  const operator = ctx.can(HANDOFF_OPERATOR_ROLE);
  const extendLeft = HOLD_EXTENSION_LIMITS.maxTotalHours - h.holdExtendedHours;
  const extendChoices = holdExtensionChoices(extendLeft);
  const needsAmount = h.bookingAmountCents !== null && !h.bookingAmountConfirmed;

  return (
    <PortalFrame ctx={ctx} path={path}>
      <PageHeader className="mb-8"
        title={`Booking ${h.bookingRef}`}
        description={h.bookingDescription ?? undefined}
        breadcrumbs={[{ label: "Handoffs", href: ctx.href(`${PORTAL_HOME}/handoffs`) }]}
        meta={<StatusBadge kind="handoff" status={h.status} />}
      />

      <Alert tone={h.status === "eligible" ? "info" : "neutral"} className="mb-6">
        {api.status_detail}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card padding="none">
            <CardHeader title="Details" divided />
            <CardBody>
              <KeyValueList
                items={[
                  { label: "Handoff id", value: <code className="text-sm">{h.id}</code> },
                  { label: "Your booking reference", value: h.bookingRef },
                  {
                    label: "Booking total",
                    value:
                      h.bookingAmountCents === null ? (
                        "Not sent"
                      ) : (
                        <span>
                          <Money cents={h.bookingAmountCents} /> {h.bookingAmountConfirmed ? "(confirmed by your server)" : "(sent from the browser, not yet confirmed)"}
                        </span>
                      ),
                  },
                  { label: "Scholarship organization", value: related.sgoName ?? "The family has not chosen yet" },
                  { label: "Verification", value: api.verification_status === "eligible" ? "Eligible" : api.verification_status === "not_eligible" ? "Not eligible" : "Pending" },
                  {
                    label: "Award",
                    value: api.award ? `$${api.award.amount_usd} · ${PAYMENT_METHOD[api.award.payment_method] ?? api.award.payment_method}` : "None offered",
                  },
                  { label: "Hold", value: h.holdExpiresAt && isHolding(h.status) ? `Until ${formatDeadline("en", h.holdExpiresAt)}` : "Not held" },
                  { label: "Started from", value: h.createdVia === "embed" ? "The button on your booking page" : "Your server (API)" },
                  { label: "Started", value: <DateTime value={h.createdAt} format="dateTime" /> },
                  ...(h.completedAt ? [{ label: "Completed", value: <DateTime value={h.completedAt} format="dateTime" /> }] : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card padding="none">
            <CardHeader title="Timeline" divided />
            <CardBody>
              <Timeline label="Handoff history" items={[...timeline].reverse().map((e) => ({ id: e.id, title: e.title, description: e.description, at: e.at, actor: e.actor, tone: e.tone }))} />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          {!operator ? (
            <Alert tone="neutral">Your role lets you view handoffs. Ask an owner or admin for reviewer access to change them.</Alert>
          ) : (
            <>
              {isHolding(h.status) ? (
                <Card>
                  <h2 className="mb-1 text-base font-semibold text-fg">Extend the hold</h2>
                  <p className="mb-4 text-sm text-fg-muted">
                    Give the family more time. {extendLeft > 0 ? `Up to ${extendLeft} more hours in total.` : "This hold cannot be extended further."}
                  </p>
                  {extendChoices.length > 0 ? (
                    <ActionForm action={extendHoldAction} submitLabel="Extend hold" submitVariant="secondary" layout="inline" aria-label="Extend the hold">
                      <input type="hidden" name="orgId" value={ctx.org.id} />
                      <input type="hidden" name="handoffId" value={h.id} />
                      <Field label="Add" hideLabel>
                        <Select name="hours" defaultValue={String(extendChoices[0])}>
                          {extendChoices.map((x) => (
                            <option key={x} value={x}>
                              {x} hours
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </ActionForm>
                  ) : null}
                </Card>
              ) : null}

              {h.status === "awarded" ? (
                <Card>
                  <h2 className="mb-1 text-base font-semibold text-fg">Mark the booking completed</h2>
                  <p className="mb-4 text-sm text-fg-muted">Do this once the booking is completed with scholarship funds. Your success fee for this booking is added to your next invoice.</p>
                  <ActionForm
                    action={completeHandoffAction}
                    submitLabel="Mark completed"
                    fieldLabels={{ bookingAmount: "Final booking total" }}
                    confirm={{ title: "Mark this booking completed?", description: "This records that the booking was completed with scholarship funds. It cannot be undone.", confirmLabel: "Mark completed" }}
                  >
                    <input type="hidden" name="orgId" value={ctx.org.id} />
                    <input type="hidden" name="handoffId" value={h.id} />
                    <Field label="Final booking total" hint={needsAmount ? "Required: the amount on this booking came from the browser." : "Optional. Leave blank to keep the amount on record."} required={needsAmount}>
                      <Input name="bookingAmount" inputMode="decimal" leading="$" placeholder="450.00" required={needsAmount} />
                    </Field>
                  </ActionForm>
                </Card>
              ) : null}

              {!isFinal(h.status) ? (
                <Card>
                  <h2 className="mb-1 text-base font-semibold text-fg">Cancel the handoff</h2>
                  <p className="mb-4 text-sm text-fg-muted">Ends the hold. The family&apos;s page will say the scholarship check was canceled. The reason stays in your records.</p>
                  <ActionForm
                    action={cancelHandoffAction}
                    submitLabel="Cancel handoff"
                    submitVariant="danger"
                    confirm={{ title: "Cancel this handoff?", description: "The reservation hold ends and cannot be restored.", confirmLabel: "Cancel handoff", tone: "danger" }}
                  >
                    <input type="hidden" name="orgId" value={ctx.org.id} />
                    <input type="hidden" name="handoffId" value={h.id} />
                    <Field label="Reason" optional>
                      <Textarea name="reason" rows={2} maxLength={500} />
                    </Field>
                  </ActionForm>
                </Card>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </PortalFrame>
  );
}
