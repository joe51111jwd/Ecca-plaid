import { Eye, FileX } from "lucide-react";
import Link from "next/link";
import { Alert, Badge, Card, CardHeader, Checkbox, DateTime, Disclosure, Field, Input, Select, StatusBadge, Textarea, buttonClasses, formatBytes } from "@/components/ui";
import type { DetailDocument, VerificationDetail } from "@/server/verifications";
import { AMOUNT_ROWS } from "../../forms";
import { APPROVAL_STATUS_LABELS, documentKindLabel, PROGRAM_LABELS } from "../../labels";
import type { SgoFormAction } from "../../types";
import { SgoActionForm } from "../SgoActionForm";
import type { Mode } from "@/db/schema";

export interface MeasureOption {
  value: string;
  label: string;
  kind: string;
}

export interface DocumentsPanelProps {
  detail: VerificationDetail;
  orgId: string;
  /** The mode the page was rendered in (see SgoActionForm). */
  mode: Mode;
  /** The reviewer may key fields now (reviewer role and the verification waits on a person or the family). */
  canEdit: boolean;
  /** The member's role may open raw uploads (see canOpenUploads); below it the file's state is shown without a link. */
  canViewFiles: boolean;
  viewHref: (documentId: string) => string;
  memberName: (id: string | null) => string;
  measureOptions: MeasureOption[];
  keyFieldsAction: SgoFormAction;
}

const KEYABLE = ["award_letter", "w2", "pay_stub", "tax_return", "irs_transcript"] as const;

function confidenceTone(c: number): "success" | "warning" | "danger" {
  return c >= 0.9 ? "success" : c >= 0.6 ? "warning" : "danger";
}

function FileState({ doc, viewHref, canView }: { doc: DetailDocument; viewHref: string; canView: boolean }) {
  if (doc.viewable && !canView) return <span className="text-sm text-fg-muted">File kept. Reviewers and above can open it.</span>;
  if (doc.viewable) {
    return (
      <Link href={viewHref} scroll={false} prefetch={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>
        <Eye aria-hidden="true" className="size-4" />
        View file
      </Link>
    );
  }
  const reason = doc.purgedAt ? (
    <>
      Raw file deleted on <DateTime value={doc.purgedAt} format="date" />, hash kept
    </>
  ) : doc.removedAt ? (
    <>
      Taken back by the family on <DateTime value={doc.removedAt} format="date" />, hash kept
    </>
  ) : doc.sourceDocumentId ? (
    "Carried over from an earlier verification; its file is not shared again"
  ) : (
    "Raw file deleted, hash kept"
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
      <FileX aria-hidden="true" className="size-4" />
      {reason}
    </span>
  );
}

function KeyFieldsForm({ doc, orgId, mode, memberOptions, measureOptions, action }: { doc: DetailDocument; orgId: string; mode: Mode; memberOptions: Array<{ id: string; name: string }>; measureOptions: MeasureOption[]; action: SgoFormAction }) {
  const e = doc.extraction;
  const kindDefault = (KEYABLE as readonly string[]).includes(doc.detectedKind ?? "") ? doc.detectedKind! : (KEYABLE as readonly string[]).includes(doc.declaredKind) ? doc.declaredKind : "w2";
  const award = e?.award ?? null;
  const amounts = e?.income?.amounts ?? [];
  return (
    <SgoActionForm action={action} orgId={orgId} mode={mode} submitLabel="Save keyed fields" pendingText="Saving…" aria-label={`Key fields for ${doc.filename}`}>
      <input type="hidden" name="documentId" value={doc.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What this document is">
          <Select name="kind" defaultValue={kindDefault}>
            {KEYABLE.map((k) => (
              <option key={k} value={k}>
                {documentKindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Whose document" optional>
          <Select name="memberId" defaultValue={doc.memberId ?? ""}>
            <option value="">Household (no one person)</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-fg">For a benefits award letter</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Program">
            <Select name="program" defaultValue={award?.program ?? ""}>
              <option value="">Not one of the five listed programs</option>
              {Object.entries(PROGRAM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Letter date" optional>
            <Input name="letterDate" type="date" defaultValue={award?.letterDate ?? ""} />
          </Field>
          <Field label="What the letter shows">
            <Select name="approvalStatus" defaultValue={award?.approvalStatus ?? "unclear"}>
              {Object.entries(APPROVAL_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Recipient as printed" optional>
            <Input name="recipientName" defaultValue={award?.recipientName ?? ""} autoComplete="off" />
          </Field>
          <Field label="Benefit period start" optional>
            <Input name="benefitStart" type="date" defaultValue={award?.benefitPeriod?.start ?? ""} />
          </Field>
          <Field label="Benefit period end" optional>
            <Input name="benefitEnd" type="date" defaultValue={award?.benefitPeriod?.end ?? ""} />
          </Field>
        </div>
        <Field label="People the letter lists" optional hint="One name per line, as printed.">
          <Textarea name="householdMembers" rows={2} defaultValue={award?.householdMembers.join("\n") ?? ""} />
        </Field>
        <Field label="Issuing agency" optional>
          <Input name="issuingAgency" defaultValue={award?.issuingAgency ?? ""} autoComplete="off" />
        </Field>
      </fieldset>

      <fieldset className="space-y-3 rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-fg">For an income document</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tax year" optional hint="Required except for a pay stub.">
            <Input name="taxYear" inputMode="numeric" defaultValue={e?.income?.taxYear ?? ""} />
          </Field>
          <Field label="Pay date" optional hint="Pay stubs only.">
            <Input name="payDate" type="date" defaultValue={e?.income?.payDate ?? ""} />
          </Field>
        </div>
        <div className="space-y-2">
          {Array.from({ length: AMOUNT_ROWS }, (_, i) => {
            const a = amounts[i];
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_5rem]">
                <Field label={`Figure ${i + 1}`} hideLabel={i > 0}>
                  <Select name={`measure_${i}`} defaultValue={a?.measure ?? ""}>
                    <option value="">—</option>
                    {measureOptions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount (USD)" hideLabel={i > 0}>
                  <Input name={`amount_${i}`} inputMode="decimal" defaultValue={a ? (a.amountCents / 100).toFixed(2) : ""} />
                </Field>
                <Field label="Person" hideLabel={i > 0}>
                  <Input name={`person_${i}`} defaultValue={a?.person ?? ""} autoComplete="off" />
                </Field>
                <Field label="Payer" hideLabel={i > 0}>
                  <Input name={`payer_${i}`} defaultValue={a?.payer ?? ""} autoComplete="off" />
                </Field>
                <Field label="W-2 #" hideLabel={i > 0}>
                  <Input name={`statement_${i}`} inputMode="numeric" defaultValue="1" />
                </Field>
              </div>
            );
          })}
        </div>
        <Checkbox name="selfEmploymentIndicated" label="The document shows self-employment income" defaultChecked={e?.income?.selfEmploymentIndicated ?? false} />
      </fieldset>

      <Field label="Why you keyed or corrected these fields" optional>
        <Textarea name="notes" rows={2} maxLength={2000} />
      </Field>
    </SgoActionForm>
  );
}

/** Every document with what was read from it (values, confidences, review reasons) and the file's state. */
export function DocumentsPanel({ detail, orgId, mode, canEdit, canViewFiles, viewHref, memberName, measureOptions, keyFieldsAction }: DocumentsPanelProps) {
  const memberOptions = (detail.household?.members ?? []).map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }));
  return (
    <Card id="documents">
      <CardHeader title="Documents" level={2} description="What the family uploaded, what was read from each file and how sure the reader was. Opening a file is recorded in the audit log." />
      {detail.documents.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No documents uploaded.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {detail.documents.map((doc) => (
            <li key={doc.id} className="rounded-card border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-all text-fg">{doc.filename}</p>
                  <p className="text-sm text-fg-muted">
                    {documentKindLabel(doc.declaredKind)} declared · {doc.detectedKind ? `${documentKindLabel(doc.detectedKind)} detected` : "kind not detected"} · {formatBytes(doc.size)} · for {memberName(doc.memberId)}
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    SHA-256 <code className="break-all">{doc.sha256}</code>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge kind="document" status={doc.status} size="sm" />
                  <FileState doc={doc} viewHref={viewHref(doc.id)} canView={canViewFiles} />
                </div>
              </div>

              {doc.reviewReasons.length > 0 ? (
                <Alert tone="warning" title="Why a person needs to look" className="mt-3">
                  <ul className="list-disc space-y-1 pl-5">
                    {doc.reviewReasons.map((r) => (
                      <li key={r.code}>{r.message}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}

              {doc.extraction ? (
                <div className="mt-3 space-y-2 text-sm">
                  <p className="text-fg-muted">
                    Read by {doc.extraction.readBy === "reviewer" ? "a reviewer" : doc.extraction.readBy === "model" ? "the model-assisted reader" : "the document parser"} ({doc.extraction.parserVersion})
                    {doc.extractedAt ? (
                      <>
                        {" "}
                        on <DateTime value={doc.extractedAt} format="dateTime" />
                      </>
                    ) : null}
                    {doc.extraction.synthetic ? (
                      <Badge size="sm" tone="caution" className="ml-2">
                        Synthetic sample
                      </Badge>
                    ) : null}
                  </p>
                  {doc.extraction.fields.length > 0 ? (
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">Fields read from {doc.filename}</caption>
                      <thead>
                        <tr className="border-b border-line text-xs text-fg-muted uppercase">
                          <th scope="col" className="py-1.5 pr-3 font-semibold">
                            Field
                          </th>
                          <th scope="col" className="py-1.5 pr-3 font-semibold">
                            Value
                          </th>
                          <th scope="col" className="py-1.5 font-semibold">
                            Confidence
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.extraction.fields.map((f) => (
                          <tr key={f.key} className="border-b border-line align-top last:border-0">
                            <td className="py-1.5 pr-3 text-fg-muted">{f.key.replace(/_/g, " ")}</td>
                            <td className="py-1.5 pr-3 break-all text-fg">{f.value === null ? <span className="text-fg-subtle">not read</span> : String(f.value)}</td>
                            <td className="py-1.5">
                              <Badge size="sm" tone={confidenceTone(f.confidence)}>
                                {Math.round(f.confidence * 100)}%
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-fg-muted">No fields could be read from this file.</p>
                  )}
                  {doc.extraction.warnings.length > 0 ? (
                    <ul className="list-disc pl-5 text-xs text-fg-muted">
                      {doc.extraction.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  {doc.extraction.keyedByReviewer?.notes ? <p className="text-fg-muted">Reviewer&apos;s note: {doc.extraction.keyedByReviewer.notes}</p> : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-fg-muted">Nothing has been read from this file yet.</p>
              )}

              {canEdit && doc.removedAt === null && doc.sourceDocumentId === null ? (
                <Disclosure summary={doc.extraction?.readBy === "reviewer" ? "Correct the keyed fields" : "Key or correct the fields"} className="mt-3">
                  <div className="pt-3">
                    <KeyFieldsForm doc={doc} orgId={orgId} mode={mode} memberOptions={memberOptions} measureOptions={measureOptions} action={keyFieldsAction} />
                  </div>
                </Disclosure>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
