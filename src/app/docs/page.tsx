import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Card, CodeBlock } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { API_BASE_PATH, API_KEY_PREFIX, API_RATE_LIMIT, HTTP_SAMPLES, LIVE_KEY_ORG_STATUSES, MAX_ACTIVE_KEYS_PER_MODE } from "@/server/api";
import { C, DocsHeader, DocsSection, Sample } from "./_components";

export const metadata: Metadata = { title: "Overview & authentication" };

const PATHS = [
  { href: "/docs/quickstart", title: "Quickstart", body: "Create a verification with curl, open the family link, receive the webhook, download the evidence." },
  { href: "/docs/verifications", title: "The Verification object", body: "Every field: status and stage, the provisional flag, both threshold readings, what expires when." },
  { href: "/docs/webhooks", title: "Webhooks", body: "Event catalogue, payloads, signature verification you can paste into Node, retries." },
  { href: "/docs/handoffs", title: "Camps & schools", body: "Hold a booking while a family verifies with a partner SGO: redirect or embed." },
];

export default function DocsOverviewPage() {
  return (
    <>
      <DocsHeader
        eyebrow="Developers"
        title={`The ${BRAND.name} API`}
        lead={
          <p>
            A small HTTP API for scholarship granting organizations (SGOs) and for the camps and schools that send them families. Create income verifications, get a webhook
            when a decision is ready, download an auditor-ready evidence pack, and export results in the column layout your other systems import.
          </p>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {PATHS.map((p) => (
          <Card key={p.href} href={p.href} className="space-y-1.5">
            <p className="font-semibold text-fg">{p.title} →</p>
            <p className="text-sm text-fg-muted">{p.body}</p>
          </Card>
        ))}
      </div>

      <DocsSection id="base-url" title="Base URL and format">
        <p>
          Every endpoint lives under <C>{`https://YOUR-PASSPORT-HOST${API_BASE_PATH}`}</C>. Requests and responses are JSON with <C>snake_case</C> fields; money is either integer
          cents (<C>_cents</C>) or a dollar decimal string (<C>_usd</C>), never a float; times are ISO 8601 in UTC. Responses are never cached (<C>Cache-Control: no-store</C>) and
          carry an <C>X-Request-Id</C> — quote it when you contact us.
        </p>
        <p>
          Lists return <C>{`{ "object": "list", "data": [...], "has_more": true, "next_cursor": "…" }`}</C>, newest first. Pass <C>next_cursor</C> back as{" "}
          <C>starting_after</C> for the next page; cursors are opaque and stay stable while new records arrive.
        </p>
      </DocsSection>

      <DocsSection id="authentication" title="Authentication">
        <p>
          Authenticate every request with a secret API key in the <C>Authorization</C> header. Keys are created by an admin of your organization in the dashboard, shown once,
          and stored by us only as a hash. Each key belongs to one organization and one mode.
        </p>
        <Sample sample={HTTP_SAMPLES.me} />
        <ul className="list-disc space-y-2 pl-6">
          <li>
            A missing, malformed, unknown or revoked key always gets the same <C>401</C> answer, so the API never tells anyone which keys exist.
          </li>
          <li>
            Secret keys are for your server. Never put one in a browser, a mobile app or a public repository. The booking embed uses a separate, public{" "}
            <Link href="/docs/handoffs">publishable key</Link>.
          </li>
          <li>
            Up to {MAX_ACTIVE_KEYS_PER_MODE} active keys per mode, so you can rotate without downtime: create the new key, deploy it, then revoke the old one.
          </li>
          <li>SGO keys reach the verification and donation endpoints; business keys reach the handoff endpoints. Both reach events, webhooks and <C>/me</C>.</li>
        </ul>
      </DocsSection>

      <DocsSection id="test-mode" title="Test mode and live mode">
        <p>
          Keys starting <C>{API_KEY_PREFIX.test}</C> work in <strong>test mode</strong>; keys starting <C>{API_KEY_PREFIX.live}</C> work in <strong>live mode</strong>. The two
          modes are separate worlds: a test key never sees live records and a live key never sees test records, in reads, lists, events, exports and webhook delivery history.
          Every object carries <C>mode</C>.
        </p>
        <Callout title="Build everything in test mode first">
          <p>
            Test keys are available immediately. Live keys can be created once your organization is approved (status {LIVE_KEY_ORG_STATUSES.join(", ")}). Test-mode gifts move no
            money and are never credit-eligible. Test-mode verifications run the same flow and engine: use synthetic documents there, never a real family&apos;s files.
          </p>
        </Callout>
        <p>
          Webhook endpoints belong to your organization, not to a mode: one endpoint receives both modes&apos; events, each marked with <C>mode</C>. For that reason, once your
          organization holds a live key, endpoints are created and changed with a live key (or in the dashboard).
        </p>
      </DocsSection>

      <DocsSection id="limits" title="Limits">
        <p>
          {API_RATE_LIMIT.limit} requests per minute per key, reported on every response in <C>RateLimit-Limit</C>, <C>RateLimit-Remaining</C> and <C>RateLimit-Reset</C>.
          See <Link href="/docs/errors">errors, rate limits and idempotency</Link>.
        </p>
        <CodeBlock
          title="Response headers"
          language="http"
          code={`HTTP/1.1 200 OK\nContent-Type: application/json; charset=utf-8\nCache-Control: no-store\nX-Request-Id: req_3kq0Zt7vS1mXb2Yc\nRateLimit-Limit: ${API_RATE_LIMIT.limit}\nRateLimit-Remaining: ${API_RATE_LIMIT.limit - 1}\nRateLimit-Reset: 60`}
        />
      </DocsSection>
    </>
  );
}
