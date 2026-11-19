import type { Metadata } from "next";
import type { Mode } from "@/db/schema";
import { Badge, Card, CardHeader, PageHeader, Checkbox, CheckboxGroup, DateTime, Disclosure, EmptyState, Field, Fieldset, Input, Select, StatusBadge, Table, TextLink, type TableColumn } from "@/components/ui";
import { roleAtLeast } from "@/server/auth";
import { EVENT_CATALOGUE, listApiKeys, listDeliveriesForMode, type ApiKeySummary } from "@/server/api";
import { listEndpoints, WEBHOOK_FORMATS, type WebhookDelivery, type WebhookEndpoint } from "@/server/webhooks";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { SGO_PATHS } from "@/features/sgo/nav";
import { DELIVERY_LOG_LIMIT, MANAGE_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import type { SgoFormAction } from "@/features/sgo/types";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  resendDeliveryAction,
  revokeApiKeyAction,
  rotateWebhookSecretAction,
  setWebhookStatusAction,
  updateWebhookEventsAction,
} from "../_actions";

export const metadata: Metadata = { title: "Developers" };

const SGO_EVENTS = Object.entries(EVENT_CATALOGUE)
  .filter(([, doc]) => doc.receiver === "SGO")
  .map(([type, doc]) => ({ type, when: doc.when }));

const FORMAT_LABELS: Readonly<Record<string, string>> = { native: "Native JSON (recommended)", generic_csv_row: "Generic CSV row (for spreadsheet-style vendor tools)" };

function EventPicker({ selected }: { selected: readonly string[] }) {
  const all = selected.includes("*");
  return (
    <div className="space-y-2">
      <Checkbox name="allEvents" label="All events, including ones added later" defaultChecked={all} />
      {/* Closed <details> content is still part of the form, so the choices submit either way. */}
      <Disclosure summary={all ? "Or choose only some events" : `Only these events (${selected.length})`} variant="plain" defaultOpen={!all}>
        <Fieldset label="Only these events" optional hideLabel>
          <CheckboxGroup className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {SGO_EVENTS.map((e) => (
              <Checkbox key={e.type} name="eventTypes" value={e.type} label={<code className="text-xs">{e.type}</code>} description={e.when} defaultChecked={!all && selected.includes(e.type)} />
            ))}
          </CheckboxGroup>
        </Fieldset>
      </Disclosure>
    </div>
  );
}

function DeliveryLog({ deliveries, orgId, mode, canManage, resend }: { deliveries: WebhookDelivery[]; orgId: string; mode: Mode; canManage: boolean; resend: SgoFormAction }) {
  const columns: Array<TableColumn<WebhookDelivery>> = [
    { key: "event", header: "Event", primary: true, cell: (d) => <code className="text-xs">{d.eventType}</code> },
    { key: "status", header: "Status", cell: (d) => <StatusBadge kind="webhook_delivery" status={d.status} size="sm" /> },
    { key: "attempts", header: "Attempts", numeric: true, cell: (d) => d.attempt },
    { key: "response", header: "Response", wrap: true, cell: (d) => (d.responseStatus ? `HTTP ${d.responseStatus}` : (d.error ?? "—")) },
    { key: "at", header: "Created", numeric: true, cell: (d) => <DateTime value={d.createdAt} format="dateTime" /> },
    {
      key: "resend",
      header: <span className="sr-only">Resend</span>,
      cell: (d) =>
        canManage ? (
          <SgoActionForm action={resend} orgId={orgId} mode={mode} submitLabel="Resend" submitVariant="ghost" submitSize="sm" layout="inline" aria-label={`Resend ${d.eventType}`}>
            <input type="hidden" name="deliveryId" value={d.id} />
          </SgoActionForm>
        ) : null,
    },
  ];
  return (
    <Table
      caption="Recent deliveries"
      density="compact"
      columns={columns}
      rows={deliveries}
      rowKey={(d) => d.id}
      empty={<EmptyState size="sm" title="No deliveries in this mode yet" description="Deliveries appear here as events happen, for the mode on screen." />}
    />
  );
}

export default async function DevelopersPage() {
  const ctx = await requireSgoPage(SGO_PATHS.developers);
  const canManage = roleAtLeast(ctx.role, MANAGE_ROLE);
  const [keys, endpoints] = await Promise.all([listApiKeys(ctx.org.id, { mode: ctx.mode }), listEndpoints(ctx.org.id)]);
  const logs = new Map<string, WebhookDelivery[]>();
  await Promise.all(endpoints.map(async (e) => logs.set(e.id, (await listDeliveriesForMode({ orgId: ctx.org.id, endpointId: e.id, mode: ctx.mode, limit: DELIVERY_LOG_LIMIT })).items)));

  const keyColumns: Array<TableColumn<ApiKeySummary>> = [
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (k) => (
        <span>
          {k.name}
          <code className="block text-xs font-normal text-fg-muted">{k.prefix}…</code>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (k) => (k.revokedAt ? <Badge tone="neutral" size="sm">Revoked</Badge> : <Badge tone="success" size="sm">Active</Badge>) },
    { key: "created", header: "Created", cell: (k) => <DateTime value={k.createdAt} format="date" /> },
    { key: "used", header: "Last used", cell: (k) => <DateTime value={k.lastUsedAt} format="dateTime" placeholder="Never" /> },
    {
      key: "revoke",
      header: <span className="sr-only">Revoke</span>,
      cell: (k) =>
        canManage && !k.revokedAt ? (
          <SgoActionForm
            action={revokeApiKeyAction}
            orgId={ctx.org.id}
            mode={ctx.mode}
            submitLabel="Revoke"
            submitVariant="ghost"
            submitSize="sm"
            layout="inline"
            aria-label={`Revoke ${k.name}`}
            confirm={{ title: `Revoke "${k.name}"?`, description: "Requests with this key fail immediately. This cannot be undone.", confirmLabel: "Revoke", tone: "danger" }}
          >
            <input type="hidden" name="keyId" value={k.id} />
          </SgoActionForm>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developers"
        description={
          <>
            Connect your own system with the API and webhooks. The <TextLink href="/docs">API documentation</TextLink> has the requests, signatures and samples.
          </>
        }
      />

      <Card padding="none">
        <CardHeader
          title={`${ctx.mode === "live" ? "Live" : "Test"} API keys`}
          className="px-5 pt-5 pb-4 sm:px-6"
          description={
            <>
              A key works in one mode only; switch modes in the top bar to see the other. Send it as <code className="text-xs">Authorization: Bearer {ctx.mode === "live" ? "ecca_live_" : "ecca_test_"}…</code>
            </>
          }
        />
        <Table
          caption="API keys"
          density="compact"
          columns={keyColumns}
          rows={keys}
          rowKey={(k) => k.id}
          empty={<EmptyState size="sm" title={`No ${ctx.mode} keys yet`} description={canManage ? "Name a key below to call the API from your own system." : "An admin can create one."} />}
        />
        {canManage ? (
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <SgoActionForm action={createApiKeyAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel={`Create ${ctx.mode} key`} submitVariant="secondary" layout="inline" resetOnSuccess>
              <Field label="Key name" hint="Where it will be used, e.g. “Admissions system”.">
                <Input name="name" maxLength={100} autoComplete="off" />
              </Field>
            </SgoActionForm>
          </div>
        ) : null}
      </Card>

      <section aria-labelledby="webhooks-heading" className="space-y-4">
        <div>
          <h2 id="webhooks-heading" className="text-lg font-semibold text-fg">
            Webhook endpoints
          </h2>
          <p className="text-sm text-fg-muted">Endpoints receive signed requests for both modes; each delivery says which. Delivery logs show the mode on screen.</p>
        </div>
        {endpoints.length === 0 && !canManage ? (
          <Card>
            <EmptyState size="sm" title="No endpoints" description="An admin can add one to receive results in your own system. Everything also works in the dashboard alone." />
          </Card>
        ) : null}
        {endpoints.map((e: WebhookEndpoint) => (
          <Card key={e.id} padding="none">
            <CardHeader
              className="px-5 pt-5 sm:px-6"
              title={<span className="break-all">{e.url}</span>}
              description={e.description ?? undefined}
              actions={<StatusBadge kind="webhook_endpoint" status={e.status} size="sm" />}
            />
            <div className="space-y-3 px-5 pb-4 text-sm sm:px-6">
              <p className="text-fg-muted">
                Events: {e.eventTypes.includes("*") ? "all" : e.eventTypes.join(", ")} · format {e.format}
                {e.failureCount > 0 ? ` · ${e.failureCount} deliveries in a row ran out of retries` : ""}
                {e.lastSuccessAt ? (
                  <>
                    {" "}
                    · last success <DateTime value={e.lastSuccessAt} format="dateTime" />
                  </>
                ) : null}
              </p>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Disclosure summary="Choose events">
                    <div className="pt-3">
                      <SgoActionForm action={updateWebhookEventsAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Save events" submitVariant="secondary" submitSize="sm">
                        <input type="hidden" name="endpointId" value={e.id} />
                        <EventPicker selected={e.eventTypes} />
                      </SgoActionForm>
                    </div>
                  </Disclosure>
                  <Disclosure summary="Rotate the signing secret">
                    <div className="pt-3">
                      <SgoActionForm action={rotateWebhookSecretAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Rotate secret" submitVariant="secondary" submitSize="sm" confirm={{ title: "Rotate the signing secret?", confirmLabel: "Rotate" }}>
                        <input type="hidden" name="endpointId" value={e.id} />
                        <Checkbox name="immediate" label="Stop the old secret now" description="Only if it leaked. Otherwise both secrets sign deliveries for 24 hours." />
                      </SgoActionForm>
                    </div>
                  </Disclosure>
                  <SgoActionForm action={setWebhookStatusAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel={e.status === "active" ? "Disable" : "Enable"} submitVariant="secondary" submitSize="sm" layout="inline">
                    <input type="hidden" name="endpointId" value={e.id} />
                    <input type="hidden" name="status" value={e.status === "active" ? "disabled" : "active"} />
                  </SgoActionForm>
                  <SgoActionForm
                    action={deleteWebhookAction}
                    orgId={ctx.org.id}
                    mode={ctx.mode}
                    submitLabel="Delete"
                    submitVariant="ghost"
                    submitSize="sm"
                    layout="inline"
                    confirm={{ title: "Delete this endpoint?", description: "Its delivery history is deleted too. Events themselves are kept.", confirmLabel: "Delete", tone: "danger" }}
                  >
                    <input type="hidden" name="endpointId" value={e.id} />
                  </SgoActionForm>
                </div>
              ) : null}
            </div>
            <DeliveryLog deliveries={logs.get(e.id) ?? []} orgId={ctx.org.id} mode={ctx.mode} canManage={canManage} resend={resendDeliveryAction} />
          </Card>
        ))}
        {canManage ? (
          <Card>
            <CardHeader
              title={endpoints.length === 0 ? "Add your first endpoint" : "Add an endpoint"}
              level={3}
              description={
                endpoints.length === 0
                  ? "No endpoints yet: results stay in the dashboard. Add an https address that accepts POST requests to receive them in your own system. Private and local addresses are refused."
                  : "An https address that accepts POST requests. Private and local addresses are refused."
              }
            />
            <SgoActionForm action={createWebhookAction} orgId={ctx.org.id} mode={ctx.mode} submitLabel="Add endpoint" className="mt-4" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Endpoint URL">
                  <Input name="url" type="url" placeholder="https://example.org/webhooks/passport" autoComplete="off" />
                </Field>
                <Field label="Format">
                  <Select name="format" defaultValue="native">
                    {WEBHOOK_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABELS[f] ?? f}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Description" optional>
                <Input name="description" maxLength={500} />
              </Field>
              <EventPicker selected={["*"]} />
            </SgoActionForm>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
