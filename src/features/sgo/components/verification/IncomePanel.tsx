import { Badge, Card, CardHeader, Disclosure, Field, Input, Money, Select, Textarea } from "@/components/ui";
import type { VerificationDetail } from "@/server/verifications";
import type { SgoFormAction } from "../../types";
import { SgoActionForm } from "../SgoActionForm";

export interface IncomePanelProps {
  detail: VerificationDetail;
  orgId: string;
  canEdit: boolean;
  memberName: (id: string | null) => string;
  /** Income categories a reviewer may choose (key and English label). */
  categories: Array<{ key: string; label: string }>;
  addIncomeLineAction: SgoFormAction;
  removeIncomeLineAction: SgoFormAction;
}

const SOURCE_LABEL: Readonly<Record<string, string>> = { document: "Document", rail: "Data connection", reviewer: "Reviewer", self_reported: "Family (self-reported)" };

/** Every income line on file for the income year, which ones count, and the reviewer's add/remove tools. */
export function IncomePanel({ detail, orgId, canEdit, memberName, categories, addIncomeLineAction, removeIncomeLineAction }: IncomePanelProps) {
  const lines = detail.incomeItems;
  const counted = lines.filter((l) => l.counted).reduce((sum, l) => sum + l.annualAmountCents, 0);
  return (
    <Card>
      <CardHeader title="Income lines" level={2} description="Yearly household cash income read from documents, data connections or keyed by a reviewer. Excluded categories are listed but do not count." />
      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No income lines yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Income lines</caption>
          <thead>
            <tr className="border-b border-line text-xs text-fg-muted uppercase">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Income
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Person
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                From
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Per year
              </th>
              <th scope="col" className="py-2 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line align-top last:border-0">
                <td className="py-2 pr-3">
                  <p className="text-fg">{l.categoryLabel}</p>
                  {l.description ? <p className="text-xs text-fg-muted">{l.description}</p> : null}
                  {l.basis ? <p className="text-xs text-fg-subtle">Basis: {l.basis}</p> : null}
                  {!l.counted ? (
                    <Badge size="sm" tone="neutral" className="mt-1">
                      Not counted
                    </Badge>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-fg-muted">{memberName(l.memberId)}</td>
                <td className="py-2 pr-3 text-fg-muted">
                  {SOURCE_LABEL[l.source] ?? l.source} · {l.incomeYear}
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money cents={l.annualAmountCents} showCents />
                </td>
                <td className="py-2 text-right">
                  {canEdit && l.source === "reviewer" ? (
                    <SgoActionForm action={removeIncomeLineAction} orgId={orgId} submitLabel="Remove" submitVariant="ghost" submitSize="sm" layout="inline" aria-label={`Remove ${l.categoryLabel}`} confirm={{ title: "Remove this income line?", confirmLabel: "Remove", tone: "danger" }}>
                      <input type="hidden" name="itemId" value={l.id} />
                    </SgoActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} className="pt-2 pr-3 text-right font-semibold text-fg">
                Counted total
              </th>
              <td className="pt-2 pr-3 text-right font-semibold">
                <Money cents={counted} showCents />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      {canEdit ? (
        <Disclosure summary="Add an income line" className="mt-4">
          <div className="pt-3">
            <SgoActionForm action={addIncomeLineAction} orgId={orgId} submitLabel="Add income line" pendingText="Adding…" resetOnSuccess>
              <input type="hidden" name="verificationId" value={detail.verification.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kind of income">
                  <Select name="category" placeholder="Choose…">
                    {categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount per year (USD)" hint="Use a minus sign for a net loss where the category allows it.">
                  <Input name="annualAmount" inputMode="decimal" />
                </Field>
                <Field label="Person" optional>
                  <Select name="memberId" defaultValue="">
                    <option value="">Household (no one person)</option>
                    {(detail.household?.members ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.firstName} {m.lastName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Read from document" optional>
                  <Select name="documentId" defaultValue="">
                    <option value="">None</option>
                    {detail.documents
                      .filter((d) => d.removedAt === null)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.filename}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Income year" optional hint={detail.verification.incomeYear ? `Defaults to ${detail.verification.incomeYear}.` : undefined}>
                  <Input name="incomeYear" inputMode="numeric" />
                </Field>
              </div>
              <Field label="What it is">
                <Input name="description" maxLength={500} />
              </Field>
              <Field label="Where the figure comes from" hint="For the record: the document and box, the letter, the call.">
                <Textarea name="basis" rows={2} maxLength={500} />
              </Field>
            </SgoActionForm>
          </div>
        </Disclosure>
      ) : null}
    </Card>
  );
}
