import type { Metadata } from "next";
import { Card, CardHeader, Checkbox, Field, Input, KeyValue, KeyValueList, LegalNote, PageHeader, Select, Switch, Textarea } from "@/components/ui";
import { roleAtLeast } from "@/server/auth";
import { getSgoPolicy, SGO_POLICY_LIMITS, STATUTORY_MAX_INCOME_CAP_PCT, US_STATES } from "@/server/sgos";
import { getSgoNotificationSettings } from "@/server/verifications";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { SGO_PATHS } from "@/features/sgo/nav";
import { MANAGE_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { setDashboardOnlyAction, setPortalRegisteredAction, updateNotificationsAction, updatePolicyAction, updateProfileAction } from "../_actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireSgoPage(SGO_PATHS.settings);
  const canManage = roleAtLeast(ctx.role, MANAGE_ROLE);
  const p = ctx.profile;
  const [policy, notifications] = await Promise.all([getSgoPolicy(ctx.org.id), getSgoNotificationSettings(ctx.org.id)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description={canManage ? "Your organization's profile, verification policy and notifications." : "Only admins and owners can change these settings."} />

      <Card>
        <CardHeader title="Profile" level={2} description="Shown to donors on your giving page and printed on acknowledgments." />
        {canManage ? (
          <SgoActionForm action={updateProfileAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save profile" className="mt-4" fieldLabels={{ displayName: "Name", ein: "EIN", website: "Website", supportEmail: "Support email" }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input name="displayName" defaultValue={p.displayName} maxLength={200} />
              </Field>
              <Field label="Legal name" optional>
                <Input name="legalName" defaultValue={p.legalName ?? ""} maxLength={200} />
              </Field>
              <Field label="EIN" optional hint="NN-NNNNNNN. Required on every acknowledgment.">
                <Input name="ein" defaultValue={p.ein ?? ""} placeholder="12-3456789" maxLength={10} />
              </Field>
              <Field label="Website" optional>
                <Input name="website" defaultValue={p.website ?? ""} />
              </Field>
              <Field label="City" optional>
                <Input name="city" defaultValue={p.city ?? ""} maxLength={100} />
              </Field>
              <Field label="State">
                <Select name="state" defaultValue={p.state}>
                  {Object.entries(US_STATES).map(([code, s]) => (
                    <option key={code} value={code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Support email" optional>
                <Input name="supportEmail" type="email" defaultValue={p.supportEmail ?? ""} />
              </Field>
            </div>
            <Field label="Description" optional>
              <Textarea name="description" rows={3} defaultValue={p.description ?? ""} maxLength={2000} />
            </Field>
            <Checkbox name="acceptsDonations" label="Accept gifts through the giving page" defaultChecked={p.acceptsDonations} />
            <Checkbox name="acceptsHandoffs" label="Accept families handed over from camp and school bookings" defaultChecked={p.acceptsHandoffs} />
          </SgoActionForm>
        ) : (
          <KeyValueList dense className="mt-4">
            <KeyValue label="Name">{p.displayName}</KeyValue>
            <KeyValue label="EIN">{p.ein ?? "Not on file"}</KeyValue>
            <KeyValue label="State">{p.state}</KeyValue>
          </KeyValueList>
        )}
      </Card>

      <Card>
        <CardHeader title="Verification policy" level={2} description="Used by every new decision. Decisions already made keep the policy they were made with." />
        {canManage ? (
          <SgoActionForm action={updatePolicyAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save policy" className="mt-4" fieldLabels={{ incomeCapPct: "Income cap", reviewBandBps: "Review band", rawRetentionDays: "Retention" }}>
            <Field
              label="Income cap (% of area median income)"
              hint={`The statute caps eligibility at ${STATUTORY_MAX_INCOME_CAP_PCT} percent of area median gross income. Your organization may focus below that with a lower cap, never a higher one.`}
            >
              <Input name="incomeCapPct" inputMode="numeric" defaultValue={String(policy.incomeCapPct)} min={SGO_POLICY_LIMITS.incomeCapPct.min} max={SGO_POLICY_LIMITS.incomeCapPct.max} />
            </Field>
            <Field
              label="Review band (basis points)"
              hint={`While the income limits are provisional (HUD-derived), incomes within this distance of the limit go to a reviewer instead of being decided automatically. 100 basis points is 1 percent; 0 turns the band off. At most ${SGO_POLICY_LIMITS.reviewBandBps.max}.`}
            >
              <Input name="reviewBandBps" inputMode="numeric" defaultValue={String(policy.reviewBandBps)} />
            </Field>
            <Field
              label="Keep raw uploads for (days after a decision)"
              hint={`After this many days the uploaded files themselves are deleted. Each file's fingerprint (SHA-256) and the fields read from it are kept for the evidence pack. ${SGO_POLICY_LIMITS.rawRetentionDays.min} to ${SGO_POLICY_LIMITS.rawRetentionDays.max} days.`}
            >
              <Input name="rawRetentionDays" inputMode="numeric" defaultValue={String(policy.rawRetentionDays)} />
            </Field>
          </SgoActionForm>
        ) : (
          <KeyValueList dense className="mt-4">
            <KeyValue label="Income cap">{policy.incomeCapPct}% of area median income</KeyValue>
            <KeyValue label="Review band">{policy.reviewBandBps} basis points</KeyValue>
            <KeyValue label="Raw uploads kept">{policy.rawRetentionDays} days after a decision</KeyValue>
          </KeyValueList>
        )}
      </Card>

      <Card>
        <CardHeader title="IRS SGO portal and integration" level={2} />
        {canManage ? (
          <div className="mt-4 space-y-4">
            <SgoActionForm action={setPortalRegisteredAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save" submitVariant="secondary" submitSize="sm">
              <Switch name="registered" label="Our organization is registered in the IRS SGO portal" description="Your own statement. Real unique donor numbers exist only after you register there." defaultChecked={p.irsPortalRegistered} />
            </SgoActionForm>
            <SgoActionForm action={setDashboardOnlyAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save" submitVariant="secondary" submitSize="sm">
              <Switch name="dashboardOnly" label="We work in this dashboard only" description="No webhook endpoint is needed. You can add one later in Developers." defaultChecked={p.dashboardOnly} />
            </SgoActionForm>
          </div>
        ) : (
          <KeyValueList dense className="mt-4">
            <KeyValue label="IRS SGO portal">{p.irsPortalRegistered ? "Registered" : "Not registered"}</KeyValue>
            <KeyValue label="Integration">{p.dashboardOnly ? "Dashboard only" : "API or webhooks"}</KeyValue>
          </KeyValueList>
        )}
      </Card>

      <Card>
        <CardHeader title="Notifications" level={2} description="Emails to your reviewers, owners and admins." />
        {canManage ? (
          <SgoActionForm action={updateNotificationsAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save notifications" submitVariant="secondary" className="mt-4">
            <Switch name="needsReview" label="A verification needs review" defaultChecked={notifications.needsReview} />
            <Switch name="decided" label="A verification was decided" defaultChecked={notifications.decided} />
          </SgoActionForm>
        ) : (
          <KeyValueList dense className="mt-4">
            <KeyValue label="Needs review">{notifications.needsReview ? "On" : "Off"}</KeyValue>
            <KeyValue label="Decided">{notifications.decided ? "On" : "Off"}</KeyValue>
          </KeyValueList>
        )}
      </Card>

      <LegalNote>Changes here are recorded in your organization&apos;s audit log with who made them.</LegalNote>
    </div>
  );
}
