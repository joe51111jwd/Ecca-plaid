import { Alert, Badge, Card, CardHeader, Checkbox, DateTime, Field, Input, Money, Select, StatusBadge, Textarea } from "@/components/ui";
import type { AwardContext, AwardRow } from "@/server/awards";
import { PAYMENT_METHOD_LABELS } from "../../labels";
import type { SgoFormAction } from "../../types";
import { SgoActionForm } from "../SgoActionForm";
import type { Mode } from "@/db/schema";

export interface AwardPanelProps {
  orgId: string;
  /** The mode the page was rendered in (see SgoActionForm). */
  mode: Mode;
  verificationId: string;
  context: AwardContext;
  awards: AwardRow[];
  canDecide: boolean;
  paymentMethods: readonly string[];
  students: Array<{ id: string; name: string }>;
  offerAction: SgoFormAction;
  statusAction: SgoFormAction;
}

/**
 * The award decision, kept apart from the verification: a verified income is not an award, and offering one is the
 * organization's explicit choice, made after reading the compliance reminders the awards service returns.
 */
export function AwardPanel({ orgId, mode, verificationId, context, awards, canDecide, paymentMethods, students, offerAction, statusAction }: AwardPanelProps) {
  const live = awards.filter((a) => a.status !== "revoked");
  return (
    <Card id="award">
      <CardHeader title="Award" level={2} description="A separate decision. Verifying income does not award a scholarship." />
      <div className="mt-4 space-y-4 text-sm">
        {awards.length > 0 ? (
          <ul className="space-y-3">
            {awards.map((a) => (
              <li key={a.id} className="rounded-card border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Money cents={a.amountCents} showCents className="font-semibold" />
                  <StatusBadge kind="award" status={a.status} size="sm" />
                  <span className="text-fg-muted">
                    {PAYMENT_METHOD_LABELS[a.paymentMethod] ?? a.paymentMethod} · decided <DateTime value={a.decidedAt} format="date" />
                  </span>
                </div>
                {a.notes ? <p className="mt-1 text-fg-muted">{a.notes}</p> : null}
                {canDecide && (a.status === "offered" || a.status === "accepted") ? (
                  <SgoActionForm action={statusAction} orgId={orgId} mode={mode} submitLabel="Record" submitVariant="secondary" submitSize="sm" layout="inline" className="mt-2" aria-label="Record what happened to the award">
                    <input type="hidden" name="awardId" value={a.id} />
                    <Field label="What happened">
                      <Select name="status" size="sm" defaultValue={a.status === "offered" ? "accepted" : "paid"}>
                        {a.status === "offered" ? <option value="accepted">The family accepted</option> : null}
                        <option value="paid">Paid under our procedures</option>
                        <option value="revoked">Revoked</option>
                      </Select>
                    </Field>
                    <Field label="Note or reason" hint="A reason is required to revoke.">
                      <Input name="note" size="sm" maxLength={500} />
                    </Field>
                  </SgoActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {context.handoff ? (
          <p className="text-fg-muted">
            This verification came from a booking with {context.handoff.business.displayName} ({context.handoff.booking.ref}).
            {context.maxAmountCents !== null ? (
              <>
                {" "}
                The award cannot exceed the booking amount, <Money cents={context.maxAmountCents} showCents />.
              </>
            ) : null}
          </p>
        ) : null}

        {!context.verification.awardable ? (
          <p className="text-fg-muted">
            {context.verification.status !== "eligible"
              ? "An award can be offered only once the verification is eligible."
              : "This result can no longer take an award (it has expired, or the booking's hold has ended)."}
          </p>
        ) : !canDecide ? (
          <p className="text-fg-muted">Reviewers and admins can offer awards.</p>
        ) : live.length > 0 ? (
          <p className="text-fg-muted">An award is already on file for this verification.</p>
        ) : (
          <>
            <Alert tone="warning" title="Read before deciding">
              <ul className="list-disc space-y-1 pl-5">
                {context.reminders.map((r) => (
                  <li key={r.code}>
                    {r.text}
                    {r.severity === "info" ? null : (
                      <Badge size="sm" tone="warning" className="ml-2">
                        Caution
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
            <SgoActionForm
              action={offerAction}
              orgId={orgId}
              mode={mode}
              submitLabel="Offer award"
              pendingText="Offering…"
              fieldLabels={{ amount: "Amount", paymentMethod: "Payment method", remindersRead: "Reminders" }}
              confirm={{ title: "Offer this award?", description: "The award is recorded as your organization's decision and sent to your webhooks. No money moves through this platform.", confirmLabel: "Offer award" }}
            >
              <input type="hidden" name="verificationId" value={verificationId} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (USD)">
                  <Input name="amount" inputMode="decimal" />
                </Field>
                <Field label="How it will be paid">
                  <Select name="paymentMethod" placeholder="Choose…">
                    {paymentMethods.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m] ?? m}
                      </option>
                    ))}
                  </Select>
                </Field>
                {students.length > 0 ? (
                  <Field label="Student" optional>
                    <Select name="studentMemberId" defaultValue="">
                      <option value="">Not specified</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
              <Field label="Notes" optional>
                <Textarea name="notes" rows={2} maxLength={2000} />
              </Field>
              <Checkbox name="remindersRead" variant="card" label="I have read the reminders above" description="The award is your organization's own decision; this platform does not decide it." />
            </SgoActionForm>
          </>
        )}
      </div>
    </Card>
  );
}
