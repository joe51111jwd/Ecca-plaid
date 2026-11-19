import type { Metadata } from "next";
import { Button, Card, CardHeader, DateTime, Money, PageHeader, Section, Stat, StatGrid } from "@/components/ui";
import { getActiveTable } from "@/engine/ami";
import { GateCards } from "@/features/admin/components/GateCards";
import { summarizeGates } from "@/features/admin/gates";
import { requireAdminPage } from "@/features/admin/server/guard";
import { countListedEntriesBySource, getOverviewCounts } from "@/features/admin/server/queries";
import { centralDateString, now } from "@/lib/clock";
import { getJobStats } from "@/server/jobs";
import { listSettings, type SettingSnapshot } from "@/server/settings";
import { describeFeeStructure } from "@/taxmath";

export const metadata: Metadata = { title: "Overview" };

function settingOf<K extends SettingSnapshot["key"]>(settings: SettingSnapshot[], key: K): SettingSnapshot<K> {
  const found = settings.find((s) => s.key === key);
  if (!found) throw new Error(`Setting ${key} is missing from the registry`);
  return found as SettingSnapshot<K>;
}

export default async function AdminOverviewPage() {
  await requireAdminPage("/admin");
  const at = now();
  const [counts, jobs, settings, listed] = await Promise.all([getOverviewCounts(), getJobStats(), listSettings(), countListedEntriesBySource()]);
  const table = getActiveTable();
  const fees = settingOf(settings, "fees.structure").value;
  const credit = settingOf(settings, "credit.startDate");
  const gates = summarizeGates({
    today: centralDateString(at),
    fees: { active: fees.active, counselMemoRef: fees.counselMemoRef, title: describeFeeStructure(fees.active).title },
    liveGiftsEnabled: settingOf(settings, "gifts.liveEnabled").value,
    creditStartDate: credit.value,
    creditStartLocked: credit.source === "production_locked",
    listSource: settingOf(settings, "sgoList.source").value,
    listedEntries: listed,
    incomeTable: { version: table.version, provisional: table.provisional },
  });

  const open = (mode: "test" | "live") => counts.verifications[mode].pending + counts.verifications[mode].needs_review;

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description="Platform-wide counts, queue health and the legal switches. Every change made in this console is written to the audit log." />

      <Section title="Counsel gates" description="The switches that decide whether gifts are taken, what they cost and which lists and limits apply.">
        <GateCards gates={gates} />
      </Section>

      <Section title="Activity">
        <StatGrid columns={4} tiles>
          <Stat label="Scholarship organizations" value={String(counts.orgs.sgo.active)} hint={`${counts.orgs.sgo.pending} pending, ${counts.orgs.sgo.suspended} suspended`} />
          <Stat label="Businesses" value={String(counts.orgs.business.active)} hint={`${counts.orgs.business.pending} pending, ${counts.orgs.business.suspended} suspended`} />
          <Stat label="Households" value={String(counts.households)} />
          <Stat label="Open review tasks" value={String(counts.openReviewTasks)} hint="Across every SGO" />
          <Stat label="Open verifications (live)" value={String(open("live"))} hint={`${counts.verifications.live.needs_review} need review`} />
          <Stat label="Open verifications (test)" value={String(open("test"))} hint={`${counts.verifications.test.needs_review} need review`} />
          <Stat label="Live gifts received" value={String(counts.succeededDonations.live.count)} hint={<>Designated <Money cents={counts.succeededDonations.live.designatedCents} /></>} />
          <Stat label="Sandbox gifts" value={String(counts.succeededDonations.test.count)} hint="No money moved" />
        </StatGrid>
      </Section>

      <Section title="Queue health" actions={<Button href="/admin/jobs" variant="secondary" size="sm">Open jobs</Button>}>
        <StatGrid columns={4} tiles>
          <Stat label="Due now" value={String(jobs.due)} hint={jobs.oldestDueAt ? <>Oldest waiting since <DateTime value={jobs.oldestDueAt} format="relative" now={at} /></> : "Nothing waiting"} />
          <Stat label="Retrying" value={String(jobs.retrying)} hint="Queued again after a failed attempt" />
          <Stat label="Failed" value={String(jobs.byStatus.dead)} hint={jobs.byStatus.dead > 0 ? "Out of attempts: needs a person" : "None"} />
          <Stat label="Running" value={String(jobs.byStatus.running)} hint={`${jobs.scheduled} scheduled for later`} />
        </StatGrid>
      </Section>

      {counts.failedEmails > 0 ? (
        <Card>
          <CardHeader
            title={`${counts.failedEmails} email${counts.failedEmails === 1 ? "" : "s"} failed to send`}
            description="The provider rejected them. Check the outbox for the error."
            actions={<Button href="/admin/email" variant="secondary" size="sm">Open outbox</Button>}
          />
        </Card>
      ) : null}
    </div>
  );
}
