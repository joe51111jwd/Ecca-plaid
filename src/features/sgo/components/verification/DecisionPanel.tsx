import type { ReactNode } from "react";
import { Alert, Badge, Card, CardHeader, DateTime, Disclosure, Money, ProvisionalBadge, ProvisionalNotice, StatusBadge } from "@/components/ui";
import type { VerificationDetail } from "@/server/verifications";
import type { DecisionSummary } from "../../decision-summary";
import { DownloadLink } from "../DownloadLink";

export interface DecisionPanelProps {
  detail: VerificationDetail;
  summary: DecisionSummary | null;
  evidenceHref: (kind: "pdf" | "json") => string;
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-3" : "min-w-0"}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 font-medium break-words text-fg">{children}</dd>
    </div>
  );
}

/**
 * The decision: the outcome in one sentence, the facts it rests on, the limit with every reading and which one was
 * relied on, and the evidence files. The engine's full narrative stays one click away under "Full explanation".
 */
export function DecisionPanel({ detail, summary, evidenceHref }: DecisionPanelProps) {
  const v = detail.verification;
  const explanation = detail.explanation;
  const limit = summary?.limit ?? null;
  const decided = v.status === "eligible" || v.status === "ineligible";
  const household = detail.household;
  const size = limit?.householdSize ?? household?.size ?? null;
  const county = limit?.countyName ?? household?.countyName ?? null;
  const lead = summary?.outcome ?? explanation?.reasons[0] ?? null;
  const narrative = explanation ? [...explanation.paragraphs, ...explanation.reasons.filter((r) => r !== lead)] : [];

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
      <div className="mt-4 space-y-5 text-sm">
        {explanation ? (
          <div className="space-y-1">
            <p className="text-base font-semibold text-fg">{explanation.headline}</p>
            {lead ? <p className="text-fg">{lead}</p> : null}
          </div>
        ) : (
          <p className="text-fg-muted">No decision yet. The family has not submitted, or the check has not run.</p>
        )}

        {summary ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-card bg-canvas p-4 sm:grid-cols-3">
            <Fact label="Income year">{summary.incomeYear}</Fact>
            <Fact label="Household">{size !== null || county ? [size !== null ? `${size} ${size === 1 ? "person" : "people"}` : null, county].filter(Boolean).join(" · ") : "—"}</Fact>
            <Fact label="Limit used">
              {limit && limit.reliedOnCents !== null ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Money cents={limit.reliedOnCents} />
                  {limit.provisional ? <ProvisionalBadge size="sm" /> : null}
                </span>
              ) : limit ? (
                <span className="text-fg-muted">
                  <Money cents={limit.lowerCents} /> to <Money cents={limit.upperCents} />
                </span>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Recorded income">
              <Money cents={summary.incomeCents} showCents placeholder="No direct evidence" />
            </Fact>
            {decided ? (
              <>
                <Fact label="Result valid until">{v.expiresAt ? <DateTime value={v.expiresAt} format="date" /> : "—"}</Fact>
                <Fact label="Decided by">{summary.decidedByLine}</Fact>
              </>
            ) : null}
            {summary.reviewerNotes ? (
              <Fact label="Reviewer's notes" wide>
                <span className="font-normal whitespace-pre-line">{summary.reviewerNotes}</span>
              </Fact>
            ) : null}
          </dl>
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

        {limit ? (
          <section aria-labelledby="limit-heading" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="limit-heading" className="flex items-center gap-2 font-semibold text-fg">
                The limit used
                {limit.provisional ? <ProvisionalBadge size="sm" /> : <Badge tone="info" size="sm">{limit.sourceName}</Badge>}
              </h3>
              <p className="text-xs text-fg-muted">
                {limit.areaName} · household of {limit.householdSize} · {limit.capPct}% cap
              </p>
            </div>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Readings of the limit</caption>
              <thead>
                <tr className="border-b border-line text-xs text-fg-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Reading
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Limit
                  </th>
                  <th scope="col" className="w-24 py-2 font-semibold">
                    <span className="sr-only">Relied on</span>
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
                    <td className="py-2 text-right">{r.reliedOn ? <Badge tone="brand" size="sm">Relied on</Badge> : <span className="sr-only">Not relied on</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-fg-muted">{limit.reliedOnSentence}</p>
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
              <p className="text-xs text-fg-muted">
                Source: {limit.sourceName}. Table {limit.tableVersion}, effective <DateTime value={limit.effectiveDate} format="date" />.
              </p>
            )}
          </section>
        ) : null}

        {narrative.length > 0 ? (
          <Disclosure summary="Full explanation" variant="plain">
            <div className="space-y-2 border-l-2 border-line pl-4">
              {narrative.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </Disclosure>
        ) : null}

        {v.hasEvidence ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="mr-1 font-semibold text-fg">Evidence pack</span>
            <DownloadLink href={evidenceHref("pdf")}>PDF</DownloadLink>
            <DownloadLink href={evidenceHref("json")}>Signed JSON</DownloadLink>
            <span className="text-xs text-fg-muted">Downloads are recorded in the audit log.</span>
          </div>
        ) : decided ? (
          <p className="border-t border-line pt-4 text-fg-muted">The evidence pack is being generated. Reload in a moment.</p>
        ) : null}
      </div>
    </Card>
  );
}
