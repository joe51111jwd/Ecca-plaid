import type { Metadata } from "next";
import { Callout, CodeBlock } from "@/components/ui";
import { apiExamples, EVENT_CATALOGUE, NODE_WEBHOOK_HANDLER, NODE_WEBHOOK_VERIFIER } from "@/server/api";
import { EVENT_TYPES } from "@/server/events";
import {
  AUTO_DISABLE_AFTER_DEAD_DELIVERIES,
  buildDeliveryBody,
  DEFAULT_TOLERANCE_SECONDS,
  MAX_ENDPOINTS_PER_ORG,
  SECRET_ROTATION_OVERLAP_MS,
  WEBHOOK_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
  WEBHOOK_TIMEOUT_MS,
} from "@/server/webhooks";
import { C, DocsHeader, DocsSection, RefTable } from "../_components";

export const metadata: Metadata = { title: "Webhooks" };

function humanMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  return `${ms / 1000} s`;
}

const EXAMPLE_EVENT = {
  id: apiExamples.EXAMPLE_EVENT.id,
  type: apiExamples.EXAMPLE_EVENT.type,
  mode: apiExamples.EXAMPLE_EVENT.mode,
  payload: apiExamples.EXAMPLE_EVENT.data,
  createdAt: new Date(apiExamples.EXAMPLE_EVENT.created_at),
};

export default function WebhooksPage() {
  const native = buildDeliveryBody(EXAMPLE_EVENT, "native");
  const csv = buildDeliveryBody({ ...EXAMPLE_EVENT, payload: { id: "ver_SYNTHETIC0000000000000A", status: "eligible", external_ref: "APP-1042", provisional: true } }, "generic_csv_row");
  return (
    <>
      <DocsHeader
        eyebrow="Webhooks"
        title="Get told when something happens"
        lead={
          <p>
            Register an HTTPS endpoint and we POST every event your organization subscribes to, signed per the{" "}
            <a href="https://www.standardwebhooks.com" rel="noreferrer">
              Standard Webhooks
            </a>{" "}
            specification. Treat the webhook as the source of truth; redirects and page events are only hints.
          </p>
        }
      />

      <DocsSection id="events" title="Event catalogue">
        <RefTable
          caption="Event types"
          head={["type", "sent to", "when", "data"]}
          rows={EVENT_TYPES.map((type) => [type, EVENT_CATALOGUE[type].receiver, EVENT_CATALOGUE[type].when, EVENT_CATALOGUE[type].data])}
        />
        <p>
          Subscribe to specific types with <C>event_types</C>, or to everything with <C>[&quot;*&quot;]</C>. Up to {MAX_ENDPOINTS_PER_ORG} endpoints per organization. The same
          events are readable at <C>GET /api/v1/events</C>.
        </p>
      </DocsSection>

      <DocsSection id="payload" title="Payload">
        <p>
          The body is the event: <C>id</C>, <C>type</C>, <C>created_at</C>, <C>mode</C> and <C>data</C> — the object the event is about, in the same shape the API returns.
        </p>
        <CodeBlock
          title="Request headers"
          language="http"
          code={`POST /your/webhook/path HTTP/1.1\nContent-Type: ${native.contentType}\n${WEBHOOK_HEADER.id}: ${apiExamples.EXAMPLE_EVENT.id}\n${WEBHOOK_HEADER.timestamp}: ${Math.floor(EXAMPLE_EVENT.createdAt.getTime() / 1000)}\n${WEBHOOK_HEADER.signature}: v1,<base64 HMAC-SHA256 signature>`}
        />
        <CodeBlock title="Body (format: native)" language="json" code={JSON.stringify(JSON.parse(native.body), null, 2)} />
        <p>
          Systems that ingest spreadsheet rows can choose the <C>generic_csv_row</C> format instead: a header line and one CSV row per event, with envelope columns first and then
          one <C>data.&lt;path&gt;</C> column per field. Signatures work the same way.
        </p>
        <CodeBlock title="Body (format: generic_csv_row)" language="csv" code={csv.body.trimEnd()} />
      </DocsSection>

      <DocsSection id="verify" title="Verify the signature">
        <p>
          The signed content is <C>{`\${webhook-id}.\${webhook-timestamp}.\${raw body}`}</C>, signed with HMAC-SHA256 under the base64-decoded part of your secret after{" "}
          <C>whsec_</C>. The <C>{WEBHOOK_HEADER.signature}</C> header holds one or more space-separated <C>v1,&lt;base64&gt;</C> signatures. Reject requests whose timestamp is
          more than {DEFAULT_TOLERANCE_SECONDS} seconds away from now. Always verify the raw bytes you received — never re-serialized JSON.
        </p>
        <CodeBlock title="verify-passport-webhook.js (Node 18+, no dependencies)" language="js" code={NODE_WEBHOOK_VERIFIER} />
        <CodeBlock title="Using it in a route handler" language="js" code={NODE_WEBHOOK_HANDLER} />
        <Callout title="This exact code is tested">
          <p>Our test suite runs this verifier against our own signer on valid, tampered, stale, future, rotated and malformed requests, and runs the route handler above.</p>
        </Callout>
      </DocsSection>

      <DocsSection id="retries" title="Delivery, retries and rotation">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Answer with any <C>2xx</C> within {WEBHOOK_TIMEOUT_MS / 1000} seconds. Anything else, a timeout or a redirect counts as a failure. Do slow work after you respond.
          </li>
          <li>
            Failed deliveries are retried after {WEBHOOK_RETRY_SCHEDULE_MS.map(humanMs).join(", ")} — {WEBHOOK_MAX_ATTEMPTS} attempts in all. A <C>Retry-After</C> header on a{" "}
            <C>429</C> or <C>503</C> pushes the next attempt later.
          </li>
          <li>
            Deliveries can arrive more than once and out of order. <C>{WEBHOOK_HEADER.id}</C> is the event id and stays the same across retries: use it to skip duplicates, and
            read the object&apos;s current state with the API when order matters.
          </li>
          <li>
            Answering <C>410 Gone</C> disables the endpoint. After {AUTO_DISABLE_AFTER_DEAD_DELIVERIES} deliveries in a row run out of retries, the endpoint is disabled
            automatically; re-enable it with <C>{`PATCH /api/v1/webhook_endpoints/{id}`}</C> and <C>{`{"status":"active"}`}</C>.
          </li>
          <li>
            Rotate a secret with <C>{`POST /api/v1/webhook_endpoints/{id}/rotate_secret`}</C>. For {SECRET_ROTATION_OVERLAP_MS / 3_600_000} hours both secrets sign each delivery,
            so you can switch without dropping anything; pass <C>{`{"expire_previous_now": true}`}</C> if the old secret leaked.
          </li>
          <li>
            Delivery history per endpoint: <C>{`GET /api/v1/webhook_endpoints/{id}/deliveries`}</C> (only the key&apos;s mode).
          </li>
        </ul>
      </DocsSection>
    </>
  );
}
