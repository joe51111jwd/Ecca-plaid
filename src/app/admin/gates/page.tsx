import type { Metadata } from "next";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Checkbox,
  DateTime,
  Field,
  Input,
  KeyValue,
  KeyValueList,
  LegalNote,
  LineItems,
  PageHeader,
  RadioGroup,
  Section,
  Select,
  StatusBadge,
  Table,
  type TableColumn,
} from "@/components/ui";
import { AdminActionForm } from "@/features/admin/components/AdminActionForm";
import { buildFeePreviews, ILLUSTRATIVE_GIFT_CENTS } from "@/features/admin/fee-preview";
import { bpsToPercentInput, MAX_PLATFORM_FEE_BPS } from "@/features/admin/forms";
import { requireAdminPage } from "@/features/admin/server/guard";
import { countListedEntriesBySource } from "@/features/admin/server/queries";
import { formatUsd } from "@/lib/money";
import { formatBps } from "@/server/businesses";
import { listSettings, STATUTORY_CREDIT_START_DATE, type SettingSnapshot } from "@/server/settings";
import { saveFeeStructureAction, setCreditStartDateAction, setListSourceAction, setLiveGiftsAction } from "../_actions";

export const metadata: Metadata = { title: "Gates & fees" };

function settingOf<K extends SettingSnapshot["key"]>(settings: SettingSnapshot[], key: K): SettingSnapshot<K> {
  const found = settings.find((s) => s.key === key);
  if (!found) throw new Error(`Setting ${key} is missing from the registry`);
  return found as SettingSnapshot<K>;
}

const SOURCE_LABEL: Record<SettingSnapshot["source"], string> = {
  default: "Default (no value saved)",
  stored: "Saved by an admin",
  invalid_stored: "Saved value is invalid: the default applies",
  production_locked: "Fixed in production",
};

const SETTING_COLUMNS: Array<TableColumn<SettingSnapshot>> = [
  { key: "key", header: "Setting", primary: true, cell: (s) => <span className="font-mono text-xs">{s.key}</span> },
  { key: "description", header: "What it controls", wrap: true, cell: (s) => s.description },
  { key: "value", header: "Value in effect", wrap: true, cell: (s) => <code className="font-mono text-xs wrap-anywhere">{JSON.stringify(s.value)}</code> },
  { key: "source", header: "Source", cell: (s) => SOURCE_LABEL[s.source] },
  { key: "updatedAt", header: "Last changed", numeric: true, cell: (s) => <DateTime value={s.updatedAt} format="dateTime" /> },
];

export default async function GatesPage() {
  await requireAdminPage("/admin/gates");
  const [settings, listed] = await Promise.all([listSettings(), countListedEntriesBySource()]);
  const fees = settingOf(settings, "fees.structure");
  const live = settingOf(settings, "gifts.liveEnabled");
  const credit = settingOf(settings, "credit.startDate");
  const listSource = settingOf(settings, "sgoList.source");
  const previews = buildFeePreviews({ active: fees.value.active, sgoFeeBps: fees.value.sgoFeeBps, donorServiceFeeBps: fees.value.donorServiceFeeBps });
  const active = previews.find((p) => p.isActive);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Gates & fees"
        description="The legal switches. Each change is recorded in the audit log with who made it, when, and the previous value."
      />

      {/* ------------------------------------------------------------------------------------------ fees */}
      <Section id="fees" title="Fee structure" description="How the platform is paid on donor gifts. The designated section 25F amount is never reduced by any fee.">
        <LegalNote title="Counsel memo required">
          The rules do not say how a third-party platform fee on a section 25F gift is treated. The structure stays “none” until counsel’s written memo is on file;
          choosing anything else requires the memo’s reference and date, and is refused without them.
        </LegalNote>

        <Card>
          <CardHeader title="In effect" actions={<Badge tone={fees.value.active === "none" ? "neutral" : "warning"}>{active?.title ?? fees.value.active}</Badge>} />
          <KeyValueList className="mt-4" dense>
            <KeyValue label="SGO-invoiced rate">{formatBps(fees.value.sgoFeeBps)}</KeyValue>
            <KeyValue label="Donor service fee rate">{formatBps(fees.value.donorServiceFeeBps)}</KeyValue>
            <KeyValue label="Counsel memo">{fees.value.counselMemoRef ?? "None on file"}</KeyValue>
            <KeyValue label="Memo date">{fees.value.approvedAt ? <DateTime value={fees.value.approvedAt.slice(0, 10)} /> : "—"}</KeyValue>
            <KeyValue label="Last changed">
              <DateTime value={fees.updatedAt} format="dateTime" /> {fees.updatedBy ? <span className="text-fg-muted">by {fees.updatedBy}</span> : null}
            </KeyValue>
          </KeyValueList>
        </Card>

        <div>
          <h3 className="text-base font-semibold text-fg">What each structure does to the money</h3>
          <p className="mt-1 text-sm text-fg-muted">
            Illustrated for a {formatUsd(ILLUSTRATIVE_GIFT_CENTS)} designated gift at the rates on file. The arithmetic and the wording are the ones checkout uses.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {previews.map((p) => (
              <Card key={p.structure} className={p.isActive ? "ring-2 ring-brand-500" : undefined}>
                <CardHeader title={p.title} level={4} actions={p.isActive ? <Badge tone="brand">In effect</Badge> : null} />
                <p className="mt-2 text-sm text-fg-muted">{p.sgoExplanation}</p>
                <LineItems
                  className="mt-4"
                  label={`Money lines under ${p.title}`}
                  items={p.lines.lines.map((l) => ({ label: l.label, amountCents: l.amountCents }))}
                  total={{ label: "Charged to the donor", amountCents: p.lines.chargedToDonorCents }}
                />
                <KeyValueList className="mt-4" dense>
                  <KeyValue label="Deposited to the SGO’s 25F account">{formatUsd(p.lines.depositedTo25fAccountCents, { cents: true })}</KeyValue>
                  <KeyValue label="Invoiced to the SGO separately">{formatUsd(p.lines.sgoInvoicedFeeCents, { cents: true })}</KeyValue>
                  <KeyValue label="Platform revenue">{formatUsd(p.lines.platformRevenueCents, { cents: true })}</KeyValue>
                </KeyValueList>
                {p.rateMissing ? (
                  <Alert tone="info" className="mt-4">
                    No rate is on file for this structure, so the illustration shows no fee.
                  </Alert>
                ) : null}
                <p className="mt-4 text-xs text-fg-muted">Donors are told: {p.donorExplanation}</p>
              </Card>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader title="Change the fee structure" description={`Rates are percentages of the gift, at most ${bpsToPercentInput(MAX_PLATFORM_FEE_BPS)}%.`} />
          <AdminActionForm
            className="mt-4"
            action={saveFeeStructureAction}
            submitLabel="Save fee structure"
            pendingText="Saving…"
            fieldLabels={{ active: "Structure", sgoFeePercent: "SGO-invoiced rate", donorServiceFeePercent: "Donor service fee rate", counselMemoRef: "Counsel memo reference", approvedOn: "Memo date" }}
            confirm={{
              title: "Change the fee structure?",
              description: "This changes what donors are charged or what SGOs are invoiced on every gift from now on. Confirm counsel's memo covers exactly this structure and rate.",
              confirmLabel: "Change fee structure",
              tone: "danger",
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Structure" id="active">
                <Select name="active" defaultValue={fees.value.active}>
                  {previews.map((p) => (
                    <option key={p.structure} value={p.structure}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Counsel memo reference" hint="Document id, matter number or link to the signed memo." id="counselMemoRef">
                <Input name="counselMemoRef" defaultValue={fees.value.counselMemoRef ?? ""} autoComplete="off" />
              </Field>
              <Field label="SGO-invoiced rate (%)" hint="Used only by the SGO-invoiced structure." id="sgoFeePercent">
                <Input name="sgoFeePercent" inputMode="decimal" defaultValue={bpsToPercentInput(fees.value.sgoFeeBps)} trailing="%" />
              </Field>
              <Field label="Donor service fee rate (%)" hint="Used only by the donor service fee structure." id="donorServiceFeePercent">
                <Input name="donorServiceFeePercent" inputMode="decimal" defaultValue={bpsToPercentInput(fees.value.donorServiceFeeBps)} trailing="%" />
              </Field>
              <Field label="Memo date" hint="The date on counsel's memo." id="approvedOn">
                <Input name="approvedOn" type="date" defaultValue={fees.value.approvedAt?.slice(0, 10) ?? ""} />
              </Field>
            </div>
          </AdminActionForm>
        </Card>
      </Section>

      {/* ------------------------------------------------------------------------------------ live gifts */}
      <Section id="live-gifts" title="Live gifts" description="Whether real-money section 25F gifts are accepted. While off, only sandbox gifts can be made and no money moves.">
        <Card>
          <CardHeader
            title={live.value ? "Live gifts are on" : "Live gifts are off"}
            actions={<Badge tone={live.value ? "success" : "neutral"}>{live.value ? "On" : "Off"}</Badge>}
            description={
              live.value
                ? `Gifts are still credit-eligible only from ${credit.value} and only for SGOs on the active list at the moment of the gift.`
                : "Turning this on lets donors pay real money. It does not make a gift credit-eligible before the credit start date or for an SGO that is not listed."
            }
          />
          <AdminActionForm
            className="mt-4"
            action={setLiveGiftsAction}
            submitLabel={live.value ? "Turn live gifts off" : "Turn live gifts on"}
            submitVariant={live.value ? "secondary" : "danger"}
            fieldLabels={{ acknowledged: "Counsel sign-off", counselReference: "Counsel reference" }}
            confirm={
              live.value
                ? { title: "Turn live gifts off?", description: "Donors will only be able to make sandbox gifts until this is turned on again.", confirmLabel: "Turn off" }
                : {
                    title: "Turn live gifts on?",
                    description: "Real money will move from this moment. Confirm counsel's written memo on the fee structure and acknowledgment copy is on file.",
                    confirmLabel: "Turn on live gifts",
                    tone: "danger",
                  }
            }
          >
            <input type="hidden" name="enabled" value={live.value ? "off" : "on"} />
            {live.value ? null : (
              <div className="space-y-4">
                <Field label="Counsel reference" hint="Reference of counsel's written sign-off. Recorded in the audit log with this change." id="counselReference">
                  <Input name="counselReference" autoComplete="off" />
                </Field>
                <Checkbox name="acknowledged" id="acknowledged" label="Counsel has signed off on accepting live section 25F gifts with the current fee structure and acknowledgment copy." />
              </div>
            )}
          </AdminActionForm>
        </Card>
      </Section>

      {/* ---------------------------------------------------------------------------------- credit start */}
      <Section id="credit-start" title="Credit start date" description={`Gifts before this date do not earn the credit. The statutory date is ${STATUTORY_CREDIT_START_DATE}.`}>
        <Card>
          <KeyValueList dense>
            <KeyValue label="In effect">
              <DateTime value={credit.value} />
            </KeyValue>
            <KeyValue label="Source">{SOURCE_LABEL[credit.source]}</KeyValue>
          </KeyValueList>
          {credit.productionLocked && credit.source === "production_locked" ? (
            <p className="mt-4 text-sm text-fg-muted">This date is fixed in production and cannot be changed here.</p>
          ) : (
            <>
              <Alert tone="warning" className="mt-4" title="Outside production only">
                Moving this date exists so tests and demos can exercise the gate. Production always uses {STATUTORY_CREDIT_START_DATE}.
              </Alert>
              <AdminActionForm
                className="mt-4"
                layout="inline"
                action={setCreditStartDateAction}
                submitLabel="Save date"
                submitVariant="secondary"
                fieldLabels={{ date: "Credit start date" }}
                confirm={{ title: "Move the credit start date?", description: "Sandbox gifts on or after the new date will be treated as credit-eligible in this environment.", confirmLabel: "Move date" }}
              >
                <Field label="New date" id="date">
                  <Input name="date" type="date" defaultValue={credit.value} />
                </Field>
              </AdminActionForm>
            </>
          )}
        </Card>
      </Section>

      {/* ------------------------------------------------------------------------------------ list source */}
      <Section id="list-source" title="SGO list source" description="Which list every gift is checked against at the moment of payment.">
        <Card>
          <CardHeader title="Active list" actions={<StatusBadge kind="sgo_list_source" status={listSource.value} />} />
          <KeyValueList className="mt-4" dense>
            <KeyValue label="Provisional curated list">{listed.provisional_curated} listed entries</KeyValue>
            <KeyValue label="IRS-published list">{listed.irs_published} listed entries</KeyValue>
          </KeyValueList>
          <Alert tone="warning" className="mt-4" title="Switch only when the IRS list is imported and checked">
            While the provisional list is active every surface labels it provisional. Switching to the IRS-published list makes it the only source: any SGO not on
            it is refused at payment. A source with no listed entries cannot be chosen.
          </Alert>
          <AdminActionForm
            className="mt-4"
            action={setListSourceAction}
            submitLabel="Switch list source"
            submitVariant="secondary"
            fieldLabels={{ source: "List source" }}
            confirm={{
              title: "Switch the SGO list source?",
              description: "Every gift from now on is checked against the chosen list. SGOs not on it cannot receive gifts.",
              confirmLabel: "Switch source",
              tone: "danger",
            }}
          >
            <Field label="List source" as="group" id="source">
              <RadioGroup
                name="source"
                defaultValue={listSource.value}
                options={[
                  { value: "provisional_curated", label: "Provisional curated list", description: "Used until the IRS publishes its SGO list. Labeled provisional." },
                  { value: "irs_published", label: "IRS-published list", description: "Once the IRS list has been imported from the IRS source." },
                ]}
              />
            </Field>
          </AdminActionForm>
        </Card>
      </Section>

      <Section title="All settings" description="Every platform setting, its value in effect and where it comes from.">
        <Card padding="none">
          <Table caption="Platform settings" columns={SETTING_COLUMNS} rows={settings} rowKey={(s) => s.key} density="compact" />
        </Card>
      </Section>
    </div>
  );
}
