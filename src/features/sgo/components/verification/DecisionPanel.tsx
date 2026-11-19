import { Alert, Badge, Card, CardHeader, DateTime, KeyValue, KeyValueList, Money, ProvisionalBadge, ProvisionalNotice, StatusBadge } from "@/components/ui";
import type { VerificationDetail } from "@/server/verifications";
import type { DecisionSummary } from "../../decision-summary";
import { DownloadLink } from "../DownloadLink";

export interface DecisionPanelProps {
  detail: VerificationDetail;
  summary: DecisionSummary | null;
  evidenceHref: (kind: "pdf" | "json") => string;
}

/** The decision in plain words, the limit with every reading and which one was relied on, and the evidence files. */
export function DecisionPanel({ detail, summary, evidenceHref }: DecisionPanelProps) {
  const v = detail.verification;
  const explanation = detail.explanation;
  const limit = summary?.limit ?? null;
  const decided = v.status === "eligible" || v.status === "ineligible";

  return (
    <Card>
      <CardHeader
        title="Decision"
        level={2}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="verification" status={v.status} provisional={v.provisional && decided} />
            {v.method ? <StatusBadge kind="method" status={v.method} size="sm" /> : null}
          </div>
        }
      />
      <div className="mt-4 space-y-4 text-sm">
        {explanation ? (
          <div className="space-y-2">
            <p className="text-base font-semibold text-fg">{explanation.headline}</p>
            {explanation.paragraphs.map((p) => (
              <p key={p} className="text-fg-muted">
                {p}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-fg-muted">No decision yet. The family has not submitted, or the check has not run.</p>
        )}

        {summary ? (
          <KeyValueList dense>
            <KeyValue label="Who decided">{summary.decidedByLine}</KeyValue>
            {summary.reviewerNotes ? <KeyValue label="Reviewer's notes">{summary.reviewerNotes}</KeyValue> : null}
            <KeyValue label="Income year">{summary.incomeYear}</KeyValue>
            <KeyValue label="Household income recorded" hint="Sum of the counted income lines for the income year.">
              <Money cents={summary.incomeCents} showCents />
            </KeyValue>
            {v.expiresAt ? (
              <KeyValue label="Result valid until">
                <DateTime value={v.expiresAt} format="date" />
              </KeyValue>
            ) : null}
          </KeyValueList>
        ) : null}

        {limit ? (
          <section aria-labelledby="limit-heading" className="space-y-3 rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="limit-heading" className="font-semibold text-fg">
                The limit used
              </h3>
              {limit.provisional ? <ProvisionalBadge size="sm" /> : <Badge tone="info" size="sm">{limit.sourceName}</Badge>}
            </div>
            <p className="text-fg-muted">
              {limit.countyName} · {limit.areaName} · household of {limit.householdSize} · {limit.capPct}% cap
            </p>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Readings of the limit</caption>
              <thead>
                <tr className="border-b border-line text-xs text-fg-muted uppercase">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Reading
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Limit
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Relied on
                  </th>
                </tr>
              </thead>
              <tbody>
                {limit.readings.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3">
                      <p className="text-fg">{r.name}</p>
                      <p className="text-xs text-fg-muted">{r.formula}</p>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Money cents={r.cents} showCents />
                    </td>
                    <td className="py-2">{r.reliedOn ? <Badge tone="brand" size="sm">Relied on</Badge> : <span className="text-fg-subtle">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-fg">{limit.reliedOnSentence}</p>
            {limit.capNote ? <p className="text-fg-muted">{limit.capNote}</p> : null}
            {limit.provisional ? (
              <ProvisionalNotice
                details={
                  <>
                    Source: {limit.sourceName}. Table {limit.tableVersion}, effective <DateTime value={limit.effectiveDate} format="date" />. Under the proposed rules the limit can be read two ways; both are
                    shown above and neither is the IRS&apos;s choice.
                  </>
                }
              />
            ) : (
              <p className="text-fg-muted">
                Source: {limit.sourceName}. Table {limit.tableVersion}, effective <DateTime value={limit.effectiveDate} format="date" />.
              </p>
            )}
          </section>
        ) : null}

        {explanation && explanation.reasons.length > 0 ? (
          <div>
            <h3 className="mb-1 font-semibold text-fg">Why</h3>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              {explanation.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {v.status === "needs_review" && explanation && explanation.reviewPoints.length > 0 ? (
          <Alert tone="warning" title="What a reviewer has to settle">
            <ul className="list-disc space-y-1 pl-5">
              {explanation.reviewPoints.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {v.hasEvidence ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="mr-2 font-semibold text-fg">Evidence pack</span>
            <DownloadLink href={evidenceHref("pdf")}>PDF</DownloadLink>
            <DownloadLink href={evidenceHref("json")}>Signed JSON</DownloadLink>
            <span className="text-xs text-fg-muted">Every download is recorded in the audit log.</span>
          </div>
        ) : decided ? (
          <p className="border-t border-line pt-4 text-fg-muted">The evidence pack is being generated. Reload in a moment.</p>
        ) : null}
      </div>
    </Card>
  );
}
