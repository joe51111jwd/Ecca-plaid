import { CircleCheck } from "lucide-react";
import { Card, CardHeader, Field, Fieldset, LegalNote, RadioGroup, Select, Textarea } from "@/components/ui";
import type { VerificationDetail } from "@/server/verifications";
import { documentKindLabel } from "../../labels";
import type { SgoFormAction } from "../../types";
import { SgoActionForm } from "../SgoActionForm";
import type { Mode } from "@/db/schema";

export interface ReviewerPanelProps {
  detail: VerificationDetail;
  orgId: string;
  /** The mode the page was rendered in (see SgoActionForm). */
  mode: Mode;
  currentUserId: string;
  reviewers: Array<{ id: string; name: string }>;
  /** Waiting on a person (needs review) or on the family's answer: the reviewer tools apply. */
  editable: boolean;
  actions: { resolve: SgoFormAction; requestMoreInfo: SgoFormAction; rerun: SgoFormAction; assign: SgoFormAction; cancel: SgoFormAction };
}

/** The reviewer's decisions: re-run the check, resolve with mandatory notes, ask the family for more, assign, cancel. */
export function ReviewerPanel({ detail, orgId, mode, currentUserId, reviewers, editable, actions }: ReviewerPanelProps) {
  const v = detail.verification;
  const openTask = detail.reviewTasks.find((t) => t.status === "open") ?? null;
  const letters = detail.documents.filter((d) => (d.detectedKind ?? d.declaredKind) === "award_letter" && d.removedAt === null);
  const decided = v.status === "eligible" || v.status === "ineligible";
  const closed = v.status === "canceled" || v.status === "expired";
  const submitted = v.submittedAt !== null;
  const canAsk = editable && v.stage !== "awaiting_family" && detail.household !== null;
  const hasTools = openTask !== null || (editable && submitted) || v.status === "needs_review" || canAsk || v.familyRequest !== null || (!decided && !closed);

  if (!hasTools) {
    return (
      <Card id="review" padding="sm" className="flex items-center gap-2 text-sm text-fg-muted">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-600" />
        <span>
          <span className="font-semibold text-fg">Reviewer actions:</span> nothing is waiting on a reviewer.
        </span>
      </Card>
    );
  }

  return (
    <Card id="review">
      <CardHeader title="Reviewer actions" level={2} description={editable ? "Settle what the check could not, then resolve or re-run." : undefined} />
      <div className="mt-4 space-y-6">
        {openTask ? (
          <SgoActionForm action={actions.assign} orgId={orgId} mode={mode} submitLabel="Assign" submitVariant="secondary" submitSize="sm" layout="inline" aria-label="Assign the review">
            <input type="hidden" name="verificationId" value={v.id} />
            <Field label="Assigned to">
              <Select name="assignee" size="sm" defaultValue={openTask.assignedTo === currentUserId ? "me" : (openTask.assignedTo ?? "none")}>
                <option value="none">No one</option>
                <option value="me">Me</option>
                {reviewers
                  .filter((r) => r.id !== currentUserId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </SgoActionForm>
        ) : null}

        {editable && submitted ? (
          <section aria-labelledby="rerun-heading" className="space-y-2">
            <h3 id="rerun-heading" className="text-sm font-semibold text-fg">
              Re-run the check
            </h3>
            <p className="text-sm text-fg-muted">Runs the engine again with everything on file, including fields and income lines you keyed. It may decide on its own.</p>
            <SgoActionForm action={actions.rerun} orgId={orgId} mode={mode} submitLabel="Re-run the check" submitVariant="secondary" pendingText="Running…">
              <input type="hidden" name="verificationId" value={v.id} />
            </SgoActionForm>
          </section>
        ) : null}

        {v.status === "needs_review" ? (
          <section aria-labelledby="resolve-heading" className="space-y-2 border-t border-line pt-4">
            <h3 id="resolve-heading" className="text-sm font-semibold text-fg">
              Resolve
            </h3>
            <SgoActionForm
              action={actions.resolve}
              orgId={orgId}
              mode={mode}
              submitLabel="Resolve"
              pendingText="Resolving…"
              fieldLabels={{ notes: "Notes", resolution: "Result", method: "Method", documentId: "Award letter" }}
              confirm={{ title: "Resolve this verification?", description: "The decision is recorded with your name and notes, goes into the evidence pack and is sent to the family and your webhooks.", confirmLabel: "Resolve" }}
            >
              <input type="hidden" name="verificationId" value={v.id} />
              <Fieldset label="Result">
                <RadioGroup
                  name="resolution"
                  options={[
                  { value: "eligible", label: "Eligible", description: "Income is within the limit. Refused above the statutory limit under every reading." },
                  { value: "ineligible", label: "Not eligible", description: "Only when the evidence shows income over the limit. Missing evidence is not a reason: ask the family for more instead." },
                  ]}
                />
              </Fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Method relied on">
                  <Select name="method" defaultValue="direct">
                    <option value="direct">Direct: income documents</option>
                    <option value="categorical">Categorical: benefits award letter</option>
                  </Select>
                </Field>
                <Field label="Award letter" optional hint="Required for the categorical method.">
                  <Select name="documentId" defaultValue="">
                    <option value="">None</option>
                    {letters.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.filename} ({documentKindLabel(d.detectedKind ?? d.declaredKind)})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Notes" hint="Required. What you checked and why. They go into the evidence pack.">
                <Textarea name="notes" rows={3} maxLength={4000} required />
              </Field>
            </SgoActionForm>
          </section>
        ) : null}

        {canAsk ? (
          <section aria-labelledby="ask-heading" className="space-y-2 border-t border-line pt-4">
            <h3 id="ask-heading" className="text-sm font-semibold text-fg">
              Ask the family for more
            </h3>
            <SgoActionForm action={actions.requestMoreInfo} orgId={orgId} mode={mode} submitLabel="Send the request" submitVariant="secondary" pendingText="Sending…" resetOnSuccess>
              <input type="hidden" name="verificationId" value={v.id} />
              <Field label="Message to the family" hint="Shown on their screen and emailed in their language, as you write it.">
                <Textarea name="message" rows={3} maxLength={2000} />
              </Field>
              <Field label="What to send" hint="One item per line.">
                <Textarea name="items" rows={3} />
              </Field>
            </SgoActionForm>
          </section>
        ) : null}

        {v.familyRequest ? (
          <LegalNote>
            Waiting for the family since {new Date(v.familyRequest.requestedAt).toISOString().slice(0, 10)}: {v.familyRequest.items.join("; ")}.
          </LegalNote>
        ) : null}

        {!decided && !closed ? (
          <section aria-labelledby="cancel-heading" className="space-y-2 border-t border-line pt-4">
            <h3 id="cancel-heading" className="text-sm font-semibold text-fg">
              Cancel
            </h3>
            <p className="text-sm text-fg-muted">Stops the verification: the family link no longer works and uploads follow your retention policy.</p>
            <SgoActionForm
              action={actions.cancel}
              orgId={orgId}
              mode={mode}
              submitLabel="Cancel verification"
              submitVariant="danger"
              confirm={{ title: "Cancel this verification?", description: "The family link stops working. This cannot be undone.", confirmLabel: "Cancel verification", tone: "danger" }}
            >
              <input type="hidden" name="verificationId" value={v.id} />
            </SgoActionForm>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
