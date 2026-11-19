import type { Metadata } from "next";
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, CodeBlock, CopyField, DateTime, EmptyState, Field, Input, PageHeader, Section, Select, StatusBadge, Table, Textarea, TextLink } from "@/components/ui";
import { ActionForm } from "@/features/handoff/components/ActionForm";
import { businessWebhookEvents, embedSnippet, serverCreateExample } from "@/features/handoff/portal";
import { DEMO_CAMP_HOME, demoEnabled, PORTAL_HOME } from "@/features/handoff/policy";
import { requirePortalPage, type SearchParams } from "@/features/handoff/server/context";
import { appUrl } from "@/lib/env";
import { API_KEY_MANAGER_ROLE, listApiKeys } from "@/server/api";
import { MANAGE_ROLE } from "@/server/businesses";
import { listEndpoints } from "@/server/webhooks";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  revokeApiKeyAction,
  rotatePublishableKeyAction,
  rotateWebhookSecretAction,
  saveOriginsAction,
  toggleWebhookAction,
} from "../actions";
import { PortalFrame } from "../_frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Install · Business portal", robots: { index: false, follow: false } };

/**
 * /partner/install — everything needed to put the scholarship button on a booking checkout: the publishable key and
 * snippet, allowed origins (which also bound return URLs), the server-side create call with a secret key, webhooks and
 * their events, and a test-mode walkthrough.
 */
export default async function InstallPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const path = `${PORTAL_HOME}/install`;
  const ctx = await requirePortalPage(path, await searchParams);
  const manage = ctx.can(MANAGE_ROLE);
  const developer = ctx.can(API_KEY_MANAGER_ROLE);
  const appOrigin = new URL(appUrl("/")).origin;
  const [keys, endpoints] = await Promise.all([developer ? listApiKeys(ctx.org.id, { activeOnly: true }) : Promise.resolve([]), developer ? listEndpoints(ctx.org.id) : Promise.resolve([])]);
  const events = businessWebhookEvents();
  const key = ctx.profile.publishableKey;

  return (
    <PortalFrame ctx={ctx} path={path}>
      <PageHeader className="mb-8" title="Install the scholarship button" description="Families click “Pay with a scholarship” at checkout, check whether they qualify with a partner scholarship organization, and you hold their spot meanwhile." />

      <Section title="1. Your publishable key" description="Identifies your business to the button. It is not a secret, but it only works on the websites you allow below.">
        <Card>
          <CopyField label="Publishable key" value={key} hint={key.startsWith("pk_test_") ? "A test key: handoffs it creates are sandbox data." : "A live key."} />
          {manage ? (
            <div className="mt-4">
              <ActionForm
                action={rotatePublishableKeyAction}
                submitLabel="Replace this key"
                submitVariant="secondary"
                submitSize="sm"
                confirm={{ title: "Replace the publishable key?", description: "The current key stops working immediately. The button shows nothing on your site until you paste the new snippet.", confirmLabel: "Replace key", tone: "danger" }}
              >
                <input type="hidden" name="orgId" value={ctx.org.id} />
              </ActionForm>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="2. Allowed websites" className="mt-10" description="The exact origins (scheme and host) of the pages that show the button. Return URLs must be on one of them too.">
        <Card>
          {manage ? (
            <ActionForm action={saveOriginsAction} submitLabel="Save allowed websites" fieldLabels={{ allowedOrigins: "Allowed websites" }}>
              <input type="hidden" name="orgId" value={ctx.org.id} />
              <Field label="Allowed websites" hint="One per line, like https://www.camp.example.org. No paths and no wildcards. http://localhost works in development only.">
                <Textarea name="allowedOrigins" rows={4} defaultValue={ctx.profile.allowedOrigins.join("\n")} spellCheck={false} />
              </Field>
            </ActionForm>
          ) : ctx.profile.allowedOrigins.length > 0 ? (
            <ul className="list-inside list-disc text-sm">
              {ctx.profile.allowedOrigins.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">No websites allowed yet. An owner or admin can add them.</p>
          )}
        </Card>
      </Section>

      <Section title="3. Paste the snippet" className="mt-10" description="Put it on your checkout page where the button should appear, and fill in the booking for each checkout.">
        <div className="space-y-4">
          <CodeBlock title="Button (sends the family to the hosted page)" language="html" code={embedSnippet(appOrigin, key, "button")} />
          <CodeBlock title="Inline (opens the handoff inside your page)" language="html" code={embedSnippet(appOrigin, key, "inline")} />
          <Alert tone="info">
            An amount sent from the browser is recorded as unconfirmed. You confirm the final amount when you mark the booking completed, so the success fee is never based on a number a browser could change.
          </Alert>
        </div>
      </Section>

      <Section title="Or create handoffs from your server" className="mt-10" description="Use a secret key from your booking system. Send the family to the url in the response; keep the handoff id with the booking.">
        <div className="space-y-4">
          <CodeBlock title="Create a handoff" language="bash" code={serverCreateExample(appOrigin)} />
          {developer ? (
            <Card padding="none">
              <CardHeader title="Secret keys" description="Shown once when created. Never put a secret key in a web page." divided />
              <Table
                caption="Secret API keys"
                rows={keys}
                rowKey={(k) => k.id}
                density="compact"
                columns={[
                  { key: "name", header: "Name", primary: true, cell: (k) => k.name },
                  { key: "prefix", header: "Key", cell: (k) => <code className="text-sm">{k.prefix}…</code> },
                  { key: "mode", header: "Mode", cell: (k) => <StatusBadge kind="mode" status={k.mode} size="sm" /> },
                  { key: "used", header: "Last used", cell: (k) => <DateTime value={k.lastUsedAt} placeholder="Never" /> },
                  {
                    key: "revoke",
                    header: <span className="sr-only">Revoke</span>,
                    label: "Revoke",
                    cell: (k) => (
                      <ActionForm action={revokeApiKeyAction} submitLabel="Revoke" submitVariant="ghost" submitSize="sm" quietSuccess confirm={{ title: `Revoke “${k.name}”?`, description: "Requests with this key fail from now on.", confirmLabel: "Revoke key", tone: "danger" }}>
                        <input type="hidden" name="orgId" value={ctx.org.id} />
                        <input type="hidden" name="keyId" value={k.id} />
                      </ActionForm>
                    ),
                  },
                ]}
                empty={<EmptyState size="sm" title="No secret keys" description="Create one for your booking system's server." />}
              />
              <CardBody className="border-t border-line">
                <ActionForm action={createApiKeyAction} submitLabel="Create secret key" layout="inline" resetOnSuccess aria-label="Create a secret key" fieldLabels={{ name: "Name", mode: "Mode" }}>
                  <input type="hidden" name="orgId" value={ctx.org.id} />
                  <Field label="Name">
                    <Input name="name" placeholder="Booking server" maxLength={100} />
                  </Field>
                  <Field label="Mode">
                    <Select name="mode" defaultValue="test">
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </Select>
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <p className="text-sm text-fg-muted">An owner or admin can create secret keys.</p>
          )}
        </div>
      </Section>

      <Section title="4. Get status updates (webhooks)" className="mt-10" description="We send a signed POST to your endpoint each time a handoff changes. Verify the webhook-signature header with the signing secret.">
        <Card padding="none">
          <CardHeader title="Events you receive" divided />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
              {events.map((e) => (
                <div key={e.type} className="contents">
                  <dt>
                    <code>{e.type}</code>
                  </dt>
                  <dd className="text-fg-muted">{e.when}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        {developer ? (
          <Card padding="none" className="mt-4">
            <CardHeader title="Your endpoints" divided />
            <Table
              caption="Webhook endpoints"
              rows={endpoints}
              rowKey={(e) => e.id}
              columns={[
                { key: "url", header: "URL", primary: true, wrap: true, cell: (e) => <span className="break-all">{e.url}</span> },
                { key: "events", header: "Events", wrap: true, cell: (e) => (e.eventTypes.includes("*") ? "All events" : e.eventTypes.join(", ")) },
                { key: "status", header: "Status", cell: (e) => <StatusBadge kind="webhook_endpoint" status={e.status} size="sm" /> },
                {
                  key: "actions",
                  header: <span className="sr-only">Actions</span>,
                  label: "Actions",
                  cell: (e) => (
                    <div className="flex flex-wrap gap-1">
                      <ActionForm action={toggleWebhookAction} submitLabel={e.status === "active" ? "Disable" : "Enable"} submitVariant="ghost" submitSize="sm" quietSuccess>
                        <input type="hidden" name="orgId" value={ctx.org.id} />
                        <input type="hidden" name="endpointId" value={e.id} />
                        <input type="hidden" name="enable" value={e.status === "active" ? "false" : "true"} />
                      </ActionForm>
                      <ActionForm action={rotateWebhookSecretAction} submitLabel="New secret" submitVariant="ghost" submitSize="sm">
                        <input type="hidden" name="orgId" value={ctx.org.id} />
                        <input type="hidden" name="endpointId" value={e.id} />
                      </ActionForm>
                      <ActionForm action={deleteWebhookAction} submitLabel="Delete" submitVariant="ghost" submitSize="sm" quietSuccess confirm={{ title: "Delete this endpoint?", description: "Events stop being sent to it.", confirmLabel: "Delete endpoint", tone: "danger" }}>
                        <input type="hidden" name="orgId" value={ctx.org.id} />
                        <input type="hidden" name="endpointId" value={e.id} />
                      </ActionForm>
                    </div>
                  ),
                },
              ]}
              empty={<EmptyState size="sm" title="No endpoints" description="Add the URL on your server that should receive handoff events." />}
            />
            <CardBody className="border-t border-line">
              <ActionForm action={createWebhookAction} submitLabel="Add endpoint" resetOnSuccess fieldLabels={{ url: "Endpoint URL", eventTypes: "Events" }}>
                <input type="hidden" name="orgId" value={ctx.org.id} />
                <Field label="Endpoint URL" hint="A public https address on your server.">
                  <Input name="url" type="url" placeholder="https://www.camp.example.org/webhooks/passport" />
                </Field>
                <Field label="Description" optional>
                  <Input name="description" maxLength={500} />
                </Field>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-fg">Events</legend>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {events.map((e) => (
                      <Checkbox key={e.type} name="eventTypes" value={e.type} label={<code>{e.type}</code>} defaultChecked />
                    ))}
                  </div>
                </fieldset>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </Section>

      <Section title="5. Try it in test mode" className="mt-10">
        <Card>
          <ol className="list-inside list-decimal space-y-2 text-sm">
            <li>Add the website you are testing on to the allowed websites (for a local site, http://localhost:PORT).</li>
            <li>Paste the snippet with your test key and a made-up booking, then click “Pay with a scholarship”.</li>
            <li>On the handoff page, follow “Check if I qualify” and complete the income check with sample information. Nothing is real in test mode.</li>
            <li>
              Watch the handoff appear under <TextLink href={ctx.href(`${PORTAL_HOME}/handoffs`)}>Handoffs</TextLink> and, if you added an endpoint, the events arrive at your server.
            </li>
            <li>Extend the hold, cancel it, or (after the scholarship organization offers an award) mark the booking completed.</li>
          </ol>
          {demoEnabled() ? (
            <p className="mt-4 text-sm">
              <Badge tone="caution" size="sm">
                Demo
              </Badge>{" "}
              See the whole flow on a fictional camp site: <TextLink href={DEMO_CAMP_HOME}>Camp Cedar Creek (demo)</TextLink>.
            </p>
          ) : null}
        </Card>
      </Section>
    </PortalFrame>
  );
}
