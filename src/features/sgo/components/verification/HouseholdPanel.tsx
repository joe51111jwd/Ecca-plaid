import { Alert, Badge, Card, CardHeader, DateTime, EmptyState, KeyValue, KeyValueList, StatusBadge } from "@/components/ui";
import type { RailStatus } from "@/db/schema";
import type { VerificationDetail } from "@/server/verifications";
import { memberKindLabel } from "../../labels";
import { HashValue } from "../HashValue";

const CUSTODY_OUTCOME: Readonly<Record<string, string>> = {
  not_answered: "Not answered yet",
  single_household: "The student lives in one household",
  this_household_longest: "The student lived longest in this household",
  this_household_equal_time_higher_income: "Equal time; this household has the higher income",
  needs_review: "Unclear: a reviewer must decide",
};

const CERTIFICATION_KIND: Readonly<Record<string, string>> = {
  zero_income: "Had no income",
  no_other_income: "Has no other income",
};

/** Who is in the household (names and roles only), shared custody, the consent record and signed certifications. */
export function HouseholdPanel({ detail, memberName }: { detail: VerificationDetail; memberName: (id: string | null) => string }) {
  const h = detail.household;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Household" level={2} description="The student and everyone living with them, as the family described them. Dates of birth are never shown." />
        {h ? (
          <div className="mt-4 space-y-4 text-sm">
            {h.changedSinceCompleted ? (
              <Alert tone="warning" title="The household changed after it was completed">
                <p>The size or county on file no longer matches what this verification used. Ask the family before relying on it.</p>
              </Alert>
            ) : null}
            <KeyValueList dense layout="grid" columns={2}>
              <KeyValue label="Household size">{h.size ?? "—"}</KeyValue>
              <KeyValue label="County">{h.countyName ? `${h.countyName} (${h.countyFips})` : "—"}</KeyValue>
              <KeyValue label="HUD area">{h.hudAreaName ?? "—"}</KeyValue>
              <KeyValue label="Completed">
                <DateTime value={h.completedAt} format="date" />
              </KeyValue>
              <KeyValue label="Shared custody">{CUSTODY_OUTCOME[detail.custody.outcome ?? "not_answered"] ?? detail.custody.outcome}</KeyValue>
              {detail.custody.answers?.notes ? <KeyValue label="Family's custody notes">{detail.custody.answers.notes}</KeyValue> : null}
            </KeyValueList>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Household roster</caption>
              <thead>
                <tr className="border-b border-line text-xs text-fg-muted uppercase">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Name
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Role
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Relationship
                  </th>
                </tr>
              </thead>
              <tbody>
                {h.members.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 text-fg">
                      {m.firstName} {m.lastName}
                      {m.isOwner ? (
                        <Badge size="sm" tone="neutral" className="ml-2">
                          Account holder
                        </Badge>
                      ) : null}
                      {h.studentMemberIds.includes(m.id) ? (
                        <Badge size="sm" tone="brand" className="ml-2">
                          Applying student
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{memberKindLabel(m.kind)}</td>
                    <td className="py-2 text-fg-muted">{m.relationship ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState size="sm" title="The family has not opened the link yet" description="The household appears here once they start." />
        )}
      </Card>

      <Card>
        <CardHeader title="Consent record" level={2} description="What the family agreed to share with you, and when." />
        {detail.consents.length === 0 ? (
          <p className="mt-4 text-sm text-fg-muted">No consent recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm">
            {detail.consents.map((c) => (
              <li key={c.id} className="rounded-card border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block font-medium text-fg first-letter:uppercase">{c.kind.replace(/_/g, " ")}</span>
                  <Badge size="sm" tone={c.active ? "success" : "neutral"}>
                    {c.revokedAt ? "Revoked" : c.active ? "Active" : "Expired"}
                  </Badge>
                </div>
                <KeyValueList dense className="mt-2">
                  <KeyValue label="Wording version">{c.copyVersion}</KeyValue>
                  <KeyValue label="Wording SHA-256">
                    <HashValue value={c.copySha256} label="SHA-256 of the consent wording" />
                  </KeyValue>
                  <KeyValue label="Language">{c.locale === "es" ? "Spanish" : "English"}</KeyValue>
                  <KeyValue label="Granted">
                    <DateTime value={c.grantedAt} format="date" />
                  </KeyValue>
                  <KeyValue label="Expires">
                    <DateTime value={c.expiresAt} format="date" placeholder="No end date" />
                  </KeyValue>
                  {c.revokedAt ? (
                    <KeyValue label="Revoked">
                      <DateTime value={c.revokedAt} format="date" />
                    </KeyValue>
                  ) : null}
                </KeyValueList>
              </li>
            ))}
          </ul>
        )}
        {detail.certifications.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-fg">Signed certifications</h3>
            <ul className="space-y-1 text-sm text-fg-muted">
              {detail.certifications.map((c) => (
                <li key={c.id}>
                  {CERTIFICATION_KIND[c.kind] ?? c.kind.replace(/_/g, " ")} ({c.memberId ? memberName(c.memberId) : "household"}, {c.incomeYear}), signed by {memberName(c.signedByMemberId)} on <DateTime value={c.signedAt} format="date" /> · wording {c.copyVersion}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {detail.railConnections.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-fg">Data connections</h3>
            <ul className="space-y-1 text-sm text-fg-muted">
              {detail.railConnections.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="rail" status={r.status as RailStatus} size="sm" /> {r.provider} ({r.kind}) for {memberName(r.memberId)}
                  {r.reportSha256 ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      report <HashValue value={r.reportSha256} label="SHA-256 of the data connection report" />
                    </span>
                  ) : null}
                  {r.failureReason ? <span>· {r.failureReason}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
